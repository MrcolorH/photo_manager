const express = require('express');
const router = express.Router();
const FileService = require('../services/fileService');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 存储仓库配置文件路径
const REPOS_CONFIG_PATH = path.join(__dirname, '../../data/repos.json');

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
async function getRepos() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(REPOS_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    // 默认仓库
    const defaultRepo = {
      id: 'default',
      name: '默认仓库',
      path: process.env.PHOTO_BASE_PATH || '/Users/colorh/Pictures/相机照片',
      isDefault: true
    };
    await saveRepos([defaultRepo]);
    return [defaultRepo];
  }
}

// 保存存储仓库列表
async function saveRepos(repos) {
  await ensureDataDir();
  await fs.writeFile(REPOS_CONFIG_PATH, JSON.stringify(repos, null, 2));
}

// 从存储卡导入照片（支持实时进度，使用 GET 以支持 SSE）
router.get('/', async (req, res) => {
  try {
    const { sourcePath, repoId } = req.query;
    
    if (!sourcePath) {
      // SSE 错误格式
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.write(`data: ${JSON.stringify({ type: 'error', error: '请提供存储卡路径' })}\n\n`);
      return res.end();
    }
    
    // 获取目标仓库路径
    const repos = await getRepos();
    const targetRepo = repoId 
      ? repos.find(r => r.id === repoId)
      : repos.find(r => r.isDefault) || repos[0];
    
    if (!targetRepo) {
      // SSE 错误格式
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.write(`data: ${JSON.stringify({ type: 'error', error: '未找到指定的存储仓库' })}\n\n`);
      return res.end();
    }
    
    const fileService = new FileService(targetRepo.path);
    
    // 设置 SSE 头部
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    console.log('开始导入，源路径:', sourcePath);
    console.log('目标仓库:', targetRepo.name);
    
    // 立即发送一个初始消息，确认连接已建立
    res.write(`data: ${JSON.stringify({ type: 'progress', data: { 
      total: 0, 
      processed: 0, 
      remaining: 0, 
      currentFile: '正在扫描文件...', 
      estimatedTimeRemaining: 0, 
      percentage: 0 
    }})}\n\n`);
    
    // 进度回调函数
    const progressCallback = (progress) => {
      try {
        const message = `data: ${JSON.stringify({ type: 'progress', data: progress })}\n\n`;
        res.write(message);
        console.log('发送进度:', progress.percentage + '% -', progress.currentFile);
      } catch (err) {
        console.error('发送进度失败:', err);
      }
    };
    
    // 执行导入
    const results = await fileService.importFromCard(sourcePath, progressCallback);
    
    console.log('导入完成，结果:', {
      jpg: results.jpg.length,
      raw: results.raw.length,
      video: results.video.length,
      errors: results.errors.length,
      skipped: results.skipped.length
    });
    
    // 发送最终结果
    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      data: {
        jpgCount: results.jpg.length,
        rawCount: results.raw.length,
        videoCount: results.video.length,
        errorCount: results.errors.length,
        skippedCount: results.skipped.length,
        targetRepo: targetRepo.name,
        details: results
      }
    })}\n\n`);
    
    res.end();
  } catch (error) {
    console.error('导入过程中出错:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// 获取默认导入路径
router.get('/default-path', async (req, res) => {
  try {
    const defaultPath = process.env.DEFAULT_IMPORT_PATH || '/Volumes';
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
    const platform = process.platform;
    
    if (platform === 'darwin') {
      // macOS - 使用 osascript 打开文件夹选择对话框
      // 使用 spawn 而不是 exec，以便更好地控制进程
      const result = await new Promise((resolve, reject) => {
        const script = `
          tell application "Finder"
            activate
            set selectedFolder to choose folder with prompt "请选择文件夹"
            return POSIX path of selectedFolder
          end tell
        `;
        
        const child = spawn('osascript', ['-e', script], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        child.on('close', (code) => {
          if (code !== 0) {
            if (stderr.includes('User canceled') || stderr.includes('-128')) {
              resolve(null); // 用户取消
            } else {
              reject(new Error(stderr || 'osascript failed'));
            }
          } else {
            resolve(stdout.trim());
          }
        });
        
        child.on('error', (err) => {
          reject(err);
        });
        
        // 30秒超时
        setTimeout(() => {
          child.kill();
          reject(new Error('timeout'));
        }, 30000);
      });
      
      if (!result) {
        return res.json({
          success: false,
          error: '用户取消选择'
        });
      }
      
      return res.json({
        success: true,
        data: {
          path: result
        }
      });
    } else if (platform === 'win32') {
      // Windows - 使用 PowerShell
      const command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowDialog() | Out-Null; $f.SelectedPath"`;
      const { stdout } = await execPromise(command, { timeout: 60000 });
      const selectedPath = stdout.trim();
      
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
    } else {
      // Linux - 使用 zenity
      const command = `zenity --file-selection --directory`;
      const { stdout } = await execPromise(command, { timeout: 60000 });
      const selectedPath = stdout.trim();
      
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
    }
  } catch (error) {
    // 用户取消选择或超时
    if (error.message.includes('User canceled') || 
        error.message.includes('取消') ||
        error.message.includes('timeout') ||
        error.message.includes('error -128')) {
      return res.json({
        success: false,
        error: '用户取消选择'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
