const express = require('express');
const router = express.Router();
const FileService = require('../services/fileService');
const fileServicePool = require('../services/fileServicePool');
const taskManager = require('../services/taskManager');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 存储仓库配置文件路径 - 与 app.js 保持一致
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', '..', 'config');
const REPOS_CONFIG_PATH = path.join(CONFIG_DIR, 'repos.json');

// 确保数据目录存在
async function ensureDataDir() {
  const dataDir = path.dirname(REPOS_CONFIG_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// 读取存储仓库列表
// 注意：本应用不预设备用默认仓库。首次安装后若无 repos.json 或仓库列表为空，
// 返回空数组，由前端引导用户手动添加（避免自动写入 C 盘等系统目录）。
async function getRepos() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(REPOS_CONFIG_PATH, 'utf8');
    const repos = JSON.parse(data);
    return Array.isArray(repos) ? repos : [];
  } catch {
    return [];
  }
}

// 保存存储仓库列表
async function saveRepos(repos) {
  await ensureDataDir();
  await fs.writeFile(REPOS_CONFIG_PATH, JSON.stringify(repos, null, 2));
}

// ============== 固定路径路由（必须注册在 /:taskId 之前） ==============

// 创建导入任务（POST，body 参数：sourcePath, repoId, smartNaming, mirrorPath, archiveByExif）
// 创建成功后立即返回 taskId，导入在后台异步执行，前端通过 SSE 获取进度
router.post('/', async (req, res) => {
  try {
    const { sourcePath, repoId, smartNaming, mirrorPath, archiveByExif } = req.body || {};

    if (!sourcePath) {
      return res.status(400).json({ success: false, error: '请提供存储卡路径' });
    }

    // 获取目标仓库路径
    const repos = await getRepos();
    if (repos.length === 0) {
      return res.status(400).json({
        success: false,
        error: '尚未配置任何存储仓库，请先到「仓库配置」页面添加仓库'
      });
    }
    const targetRepo = repoId
      ? repos.find(r => r.id === repoId)
      : repos.find(r => r.isDefault) || repos[0];

    if (!targetRepo) {
      return res.status(404).json({ success: false, error: '未找到指定的存储仓库' });
    }

    // 路径校验：镜像盘不能与目标仓库路径相同（用 path.resolve 归一化后比较）
    if (mirrorPath && path.resolve(mirrorPath) === path.resolve(targetRepo.path)) {
      return res.status(400).json({ success: false, error: '镜像盘路径不能与目标仓库路径相同' });
    }

    // 创建任务
    const taskId = await taskManager.create({
      sourcePath,
      repoId: targetRepo.id,
      repoPath: targetRepo.path,
      repoName: targetRepo.name,
      smartNaming: !!smartNaming,
      archiveByExif: !!archiveByExif,
      mirrorPath: mirrorPath || null
    });

    console.log(`[导入] 创建任务 ${taskId}，源路径: ${sourcePath}，目标仓库: ${targetRepo.name}`);

    // 异步启动任务（不 await，立即返回 taskId 给前端）
    taskManager.start(taskId, async (ctx) => {
      const fileService = fileServicePool.get(targetRepo.path);
      const results = await fileService.importFromCard(sourcePath, ctx, !!smartNaming, {
        archiveByExif: !!archiveByExif,
        mirrorPath: mirrorPath || null
      });
      // 导入完成，清空缓存使最新数据可见
      fileServicePool.invalidate(targetRepo.path);
      return {
        jpgCount: results.jpg.length,
        rawCount: results.raw.length,
        videoCount: results.video.length,
        errorCount: results.errors.length,
        skippedCount: results.skipped.length,
        mirrorSuccessCount: results.mirrorSuccess.length,
        mirrorErrorCount: results.mirrorErrors.length,
        targetRepo: targetRepo.name,
        details: results
      };
    }).catch(err => console.error(`[导入] 任务 ${taskId} 执行失败:`, err));

    res.json({ success: true, data: { taskId } });
  } catch (error) {
    console.error('创建导入任务失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取当前活跃任务（running / paused / pending）
router.get('/active', (req, res) => {
  const task = taskManager.getActive();
  if (!task) {
    return res.json({ success: true, data: null });
  }
  res.json({ success: true, data: task });
});

// 获取默认导入路径
router.get('/default-path', async (req, res) => {
  try {
    const defaultPath = process.env.DEFAULT_IMPORT_PATH || getDefaultImportPath();
    res.json({
      success: true,
      data: {
        defaultPath
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

function getDefaultImportPath() {
  if (process.platform === 'win32') {
    return 'C:\\';
  }
  return '/Volumes';
}

// 获取所有存储仓库
router.get('/repos', async (req, res) => {
  try {
    const repos = await getRepos();
    res.json({
      success: true,
      data: repos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 添加存储仓库
router.post('/repos', async (req, res) => {
  try {
    const { name, path: repoPath, isDefault } = req.body;

    if (!name || !repoPath) {
      return res.status(400).json({
        success: false,
        error: '请提供仓库名称和路径'
      });
    }

    // 检查路径是否存在
    try {
      await fs.access(repoPath);
    } catch {
      // 路径不存在，尝试创建
      await fs.mkdir(repoPath, { recursive: true });
    }

    const repos = await getRepos();

    // 如果设为默认，取消其他默认
    if (isDefault) {
      repos.forEach(r => r.isDefault = false);
    }

    const newRepo = {
      id: Date.now().toString(),
      name,
      path: repoPath,
      isDefault: isDefault || repos.length === 0
    };

    repos.push(newRepo);
    await saveRepos(repos);

    res.json({
      success: true,
      data: newRepo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除存储仓库
router.delete('/repos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const repos = await getRepos();

    const index = repos.findIndex(r => r.id === id);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: '仓库不存在'
      });
    }

    repos.splice(index, 1);

    // 如果删除的是默认仓库，设置第一个为默认
    if (repos.length > 0 && !repos.some(r => r.isDefault)) {
      repos[0].isDefault = true;
    }

    await saveRepos(repos);

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 设置默认仓库
router.put('/repos/:id/default', async (req, res) => {
  try {
    const { id } = req.params;
    const repos = await getRepos();

    repos.forEach(r => {
      r.isDefault = (r.id === id);
    });

    await saveRepos(repos);

    res.json({
      success: true,
      message: '设置成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 打开文件夹选择对话框
router.get('/select-folder', async (req, res) => {
  try {
    const { selectFolder } = require('../utils/winDialog');
    const selectedPath = await selectFolder();

    if (!selectedPath) {
      return res.json({
        success: false,
        error: '用户取消选择'
      });
    }

    return res.json({
      success: true,
      data: {
        path: selectedPath
      }
    });
  } catch (error) {
    console.error('文件夹选择失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '无法打开文件夹选择对话框'
    });
  }
});

// ============== 动态路径路由（/:taskId，必须放在固定路径之后） ==============

// 获取任务详情
router.get('/:taskId', (req, res) => {
  const task = taskManager.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  res.json({ success: true, data: task });
});

// SSE 推送任务进度（前端通过 EventSource 监听）
// 断线重连安全：基于 taskId 查询当前状态，不会触发重复导入
router.get('/:taskId/stream', (req, res) => {
  const task = taskManager.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');  // 禁用反代缓冲

  let interval = null;
  let ended = false;

  const pushState = () => {
    if (ended) return false;
    const t = taskManager.get(req.params.taskId);
    if (!t) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: '任务不存在' })}\n\n`);
      ended = true;
      res.end();
      return false;
    }
    // 推送当前进度
    res.write(`data: ${JSON.stringify({
      type: 'progress',
      data: {
        status: t.status,
        phase: t.phase,
        progress: t.progress,
        mirrorProgress: t.mirrorProgress
      }
    })}\n\n`);

    // 终态推送
    if (t.status === 'completed') {
      res.write(`data: ${JSON.stringify({ type: 'complete', data: t.stats })}\n\n`);
      ended = true;
      res.end();
      return false;
    }
    if (t.status === 'cancelled') {
      res.write(`data: ${JSON.stringify({ type: 'cancelled' })}\n\n`);
      ended = true;
      res.end();
      return false;
    }
    if (t.status === 'failed') {
      res.write(`data: ${JSON.stringify({ type: 'error', error: t.error })}\n\n`);
      ended = true;
      res.end();
      return false;
    }
    return true;
  };

  // 立即推送一次当前状态
  if (!pushState()) {
    return;
  }

  // 轮询推送（每 300ms）
  interval = setInterval(() => {
    if (!pushState() && interval) {
      clearInterval(interval);
      interval = null;
    }
  }, 300);

  // 客户端断开时清理
  req.on('close', () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    ended = true;
  });
});

// 暂停任务
router.post('/:taskId/pause', async (req, res) => {
  try {
    await taskManager.pause(req.params.taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 恢复任务
router.post('/:taskId/resume', async (req, res) => {
  try {
    await taskManager.resume(req.params.taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 取消任务
router.post('/:taskId/cancel', async (req, res) => {
  try {
    await taskManager.cancel(req.params.taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 清理已结束的任务记录（允许新建下一个任务）
router.delete('/:taskId', async (req, res) => {
  try {
    await taskManager.clear(req.params.taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
