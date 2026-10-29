const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const FileService = require('../services/fileService');
const fileServicePool = require('../services/fileServicePool');
const thumbnailCacheService = require('../services/thumbnailCacheService');
const { readFullExif } = require('../services/exifService');

// 存储仓库配置文件路径 - 与 app.js / importRoutes.js 保持一致
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', '..', 'config');
const REPOS_CONFIG_PATH = path.join(CONFIG_DIR, 'repos.json');

// ffmpeg 路径 - 优先使用环境变量注入的路径
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// 读取存储仓库列表
// 注意：本应用不预设备用默认仓库。首次安装后若无 repos.json 或仓库列表为空，
// 返回空数组，由前端引导用户手动添加（避免自动写入 C 盘等系统目录）。
async function getRepos() {
  try {
    const data = await fs.readFile(REPOS_CONFIG_PATH, 'utf8');
    const repos = JSON.parse(data);
    return Array.isArray(repos) ? repos : [];
  } catch {
    return [];
  }
}

// 获取指定仓库配置与FileService实例池单例
async function getFileService(repoId) {
  const repos = await getRepos();
  const repo = repoId
    ? repos.find(r => r.id === repoId)
    : repos.find(r => r.isDefault) || repos[0];

  if (!repo) {
    const err = new Error('未配置可用仓库，请先到「仓库配置」页面添加仓库');
    err.code = 'NO_REPO';
    throw err;
  }

  return fileServicePool.get(repo.path);
}

// 获取照片列表（支持 EXIF 多维筛选）
router.get('/', async (req, res) => {
  try {
    const {
      category = 'jpg',
      page = 1,
      pageSize = 50,
      sortBy = 'modifiedTime',
      sortOrder = 'desc',
      repoId,
      // Task 6: EXIF 筛选参数
      dateFrom,
      dateTo,
      cameraModel,
      lensModel,
      focalMin,
      focalMax,
      fNumberMin,
      fNumberMax,
      isoMin,
      isoMax,
      fileName
    } = req.query;

    const fileService = await getFileService(repoId);
    const result = await fileService.getPhotos(category, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      sortBy,
      sortOrder,
      repoId,  // 传递 repoId 给 fileService
      // 传递 EXIF 筛选参数（数值类型做转换，未提供时为 undefined）
      dateFrom,
      dateTo,
      cameraModel,
      lensModel,
      focalMin: focalMin != null && focalMin !== '' ? Number(focalMin) : undefined,
      focalMax: focalMax != null && focalMax !== '' ? Number(focalMax) : undefined,
      fNumberMin: fNumberMin != null && fNumberMin !== '' ? Number(fNumberMin) : undefined,
      fNumberMax: fNumberMax != null && fNumberMax !== '' ? Number(fNumberMax) : undefined,
      isoMin: isoMin != null && isoMin !== '' ? Number(isoMin) : undefined,
      isoMax: isoMax != null && isoMax !== '' ? Number(isoMax) : undefined,
      fileName
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取存储信息
router.get('/storage-info', async (req, res) => {
  try {
    const { repoId } = req.query;
    const fileService = await getFileService(repoId);
    const info = await fileService.getStorageInfo();
    res.json({
      success: true,
      data: info
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取孤立的RAW文件
router.get('/orphan-raws', async (req, res) => {
  try {
    const { repoId } = req.query;
    const fileService = await getFileService(repoId);
    const orphanRaws = await fileService.findOrphanRawFiles();
    res.json({
      success: true,
      data: orphanRaws
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除照片
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { syncRaw = true, repoId } = req.query;
    
    const fileService = await getFileService(repoId);
    const result = await fileService.deletePhoto(id, { syncRaw: syncRaw === 'true' });
    fileServicePool.invalidate(fileService.basePath);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 批量删除RAW文件
router.post('/batch-delete-raws', async (req, res) => {
  try {
    const { fileIds, repoId } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供要删除的文件ID列表'
      });
    }

    const fileService = await getFileService(repoId);
    const result = await fileService.deleteRawFiles(fileIds);
    fileServicePool.invalidate(fileService.basePath);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 批量刷新已有文件的 EXIF（补录旧版导入缺失的 EXIF）
router.post('/refresh-exif', async (req, res) => {
  try {
    const { repoId, category = 'jpg' } = req.body || {};
    const fileService = await getFileService(repoId);
    const result = await fileService.refreshExif({ category });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('刷新 EXIF 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 重建清单：删除旧清单→重新扫描→读取 EXIF→写入新清单
router.post('/rebuild-manifest', async (req, res) => {
  try {
    const { repoId } = req.body || {};
    const fileService = await getFileService(repoId);
    const result = await fileService.rebuildManifest();
    fileServicePool.invalidate(fileService.basePath);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('重建清单失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 完整性校验：检查清单与文件系统的一致性（缺失/损坏/未追踪）
// autoCleanup=true 时自动从清单移除缺失条目
router.post('/verify-integrity', async (req, res) => {
  try {
    const { repoId, autoCleanup = false } = req.body || {};
    const fileService = await getFileService(repoId);
    const result = await fileService.verifyIntegrity({ autoCleanup: !!autoCleanup });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('完整性校验失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 预览图片（使用路径参数）
router.get('/preview', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: '请提供文件路径'
      });
    }
    
    // 解码 URL 编码的路径
    const decodedPath = decodeURIComponent(filePath);
    
    // 检查文件是否存在
    try {
      await fs.access(decodedPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    // 直接发送文件，让浏览器决定如何处理
    // 视频会在浏览器中播放，RAW 文件会显示原始数据或提示下载
    res.sendFile(decodedPath);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取缩略图（多级持久化缓存架构）
// 1. 优先命中外置盘持久化缓存 ({repoPath}/.shiguang/thumbnails/{hash}_{width}.webp)
// 2. 命中后以 30 天强缓存直接 sendFile (2~5ms)
// 3. 未命中则进入受控并发队列解码原图，生成 WebP 异步落盘并流式返回
router.get('/thumbnail', async (req, res) => {
  try {
    const { path: filePath, width = 300, quality = 80, format = 'webp', repoId } = req.query;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: '请提供文件路径'
      });
    }
    
    // 解码 URL 编码的路径
    const decodedPath = decodeURIComponent(filePath);
    
    // 获取文件元信息（mtime 与 size，用于生成特征签名）
    let stat;
    try {
      stat = await fs.stat(decodedPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    // 定位所属仓库
    const repos = await getRepos();
    const matchedRepo = repoId
      ? repos.find(r => r.id === repoId)
      : repos.find(r => decodedPath.startsWith(path.resolve(r.path))) || repos.find(r => r.isDefault) || repos[0];
    const repoBasePath = matchedRepo ? matchedRepo.path : null;
    const resolvedRepoId = matchedRepo ? matchedRepo.id : (repoId || 'default');

    const targetWidth = parseInt(width, 10) || 300;
    const targetQuality = parseInt(quality, 10) || 80;
    const targetFormat = format === 'jpeg' || format === 'jpg' ? 'jpeg' : 'webp';

    // 计算缓存文件目标路径
    const { cachePath } = await thumbnailCacheService.getCacheFilePath(decodedPath, {
      repoBasePath,
      repoId: resolvedRepoId,
      width: targetWidth,
      format: targetFormat,
      mtime: stat.mtimeMs,
      size: stat.size
    });

    // 1. 检查外置盘持久化缓存
    const isHit = await thumbnailCacheService.checkCache(cachePath);
    if (isHit) {
      res.set({
        'Content-Type': targetFormat === 'webp' ? 'image/webp' : 'image/jpeg',
        'Cache-Control': 'public, max-age=2592000' // 30天浏览器强缓存
      });
      return res.sendFile(cachePath);
    }

    // 2. 未命中：进入受控并发转码生成流程
    const result = await thumbnailCacheService.generateThumbnail({
      filePath: decodedPath,
      width: targetWidth,
      quality: targetQuality,
      format: targetFormat
    });

    // 3. 异步持久化写入外置盘 .shiguang/thumbnails
    if (!result.isPlaceholder && result.buffer) {
      thumbnailCacheService.saveCache(cachePath, result.buffer).catch(() => {});
    }

    res.set({
      'Content-Type': result.contentType,
      'Cache-Control': result.isPlaceholder ? 'no-cache' : 'public, max-age=2592000'
    });
    return res.send(result.buffer);
  } catch (error) {
    console.error('生成缩略图失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取指定仓库的缩略图缓存统计
router.get('/cache-stats', async (req, res) => {
  try {
    const { repoId } = req.query;
    const repos = await getRepos();
    const repo = repoId
      ? repos.find(r => r.id === repoId)
      : repos.find(r => r.isDefault) || repos[0];

    if (!repo) {
      return res.status(404).json({ success: false, error: '未找到指定仓库' });
    }

    const stats = await thumbnailCacheService.getCacheStats(repo.path, repo.id);
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取缓存统计失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 清空指定仓库的缩略图缓存
router.post('/clear-cache', async (req, res) => {
  try {
    const { repoId } = req.body || {};
    const repos = await getRepos();
    const repo = repoId
      ? repos.find(r => r.id === repoId)
      : repos.find(r => r.isDefault) || repos[0];

    if (!repo) {
      return res.status(404).json({ success: false, error: '未找到指定仓库' });
    }

    const result = await thumbnailCacheService.clearCache(repo.path, repo.id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('清空缓存失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 后台异步批处理预热缩略图
router.post('/preload-thumbnails', async (req, res) => {
  try {
    const { repoId, width = 300, quality = 80, format = 'webp' } = req.body || {};
    const repos = await getRepos();
    const repo = repoId
      ? repos.find(r => r.id === repoId)
      : repos.find(r => r.isDefault) || repos[0];

    if (!repo) {
      return res.status(404).json({ success: false, error: '未找到指定仓库' });
    }

    const fileService = fileServicePool.get(repo.path);
    const allFiles = await fileService.manifest.getAllFiles();
    const fileList = Object.entries(allFiles).map(([relPath, entry]) => ({
      path: path.join(repo.path, relPath),
      mtime: entry.mtime,
      size: entry.size
    }));

    const task = await thumbnailCacheService.startPreload(repo.id, repo.path, fileList, {
      width: parseInt(width, 10) || 300,
      quality: parseInt(quality, 10) || 80,
      format
    });

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('启动缩略图预热失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取预热任务进度
router.get('/preload-progress', async (req, res) => {
  try {
    const { repoId } = req.query;
    const progress = thumbnailCacheService.getPreloadProgress(repoId);
    res.json({
      success: true,
      data: progress
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取消预热任务
router.post('/cancel-preload', async (req, res) => {
  try {
    const { repoId } = req.body || {};
    const cancelled = thumbnailCacheService.cancelPreload(repoId);
    res.json({
      success: true,
      data: { cancelled }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 显式同步未追踪文件（当用户在界面点击刷新仓库时调用）
router.post('/sync-files', async (req, res) => {
  try {
    const { repoId } = req.body || {};
    const fileService = await getFileService(repoId);
    const result = await fileService.syncUntrackedFiles();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('同步未追踪文件失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取筛选选项（相机型号、镜头型号列表）
// 注意：必须放在 GET /:id/preview 之前，否则 "filter-options" 会被 :id 匹配
router.get('/filter-options', async (req, res) => {
  try {
    const { repoId, category = 'jpg' } = req.query;
    const fileService = await getFileService(repoId);
    const options = await fileService.getFilterOptions(category);

    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 预览图片（使用 base64 ID）
router.get('/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = Buffer.from(id, 'base64').toString('utf8');

    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取照片的完整 EXIF 信息（供详情面板使用）
// id 为 base64 编码的文件绝对路径
router.get('/:id/exif', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = Buffer.from(id, 'base64').toString('utf8');

    // 检查文件是否存在
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    const tags = await readFullExif(filePath);

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取孤立的 RAW 文件（没有对应 JPG 的 RAW）
router.get('/orphan-raws', async (req, res) => {
  try {
    const { repoId } = req.query;
    const fileService = await getFileService(repoId);
    const orphanRaws = await fileService.getOrphanRaws();
    
    res.json({
      success: true,
      data: orphanRaws
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 批量删除 RAW 文件
router.post('/batch-delete-raws', async (req, res) => {
  try {
    const { fileIds, repoId } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供要删除的文件ID列表'
      });
    }
    
    const fileService = await getFileService(repoId);
    const result = await fileService.batchDeleteRaws(fileIds);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 打开文件位置（文件夹或文件）
router.post('/open-location', async (req, res) => {
  try {
    const { filePath, mode = 'folder' } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: '请提供文件路径'
      });
    }
    
    // 解码 URL 编码的路径
    const decodedPath = decodeURIComponent(filePath);
    
    // 检查文件是否存在
    try {
      await fs.access(decodedPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    const { spawn, execFile } = require('child_process');
    const platform = process.platform;

    if (mode === 'folder') {
      // 打开文件所在文件夹
      const folderPath = path.dirname(decodedPath);
      if (platform === 'darwin') {
        spawn('open', [folderPath], { stdio: 'ignore' });
      } else if (platform === 'win32') {
        // 用 PowerShell 调用 explorer，再查找并置顶其窗口，避免黑窗且确保前台聚焦
        const escaped = folderPath.replace(/'/g, "''");
        const psCmd = `$p = Start-Process -FilePath 'explorer.exe' -ArgumentList '/n,\"${escaped}\"' -PassThru; Start-Sleep -Milliseconds 600; $w = Get-Process -Id $p.Id -ErrorAction SilentlyContinue; if ($w) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n); }' -ErrorAction SilentlyContinue; [W]::ShowWindow($w.MainWindowHandle, 9) | Out-Null; [W]::SetForegroundWindow($w.MainWindowHandle) | Out-Null }`;
        execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
          windowsHide: true,
          stdio: 'ignore'
        }, (err) => {
          if (err) {
            // 兜底：PowerShell 不可用时回退到 explorer 直接启动
            spawn('explorer', ['/n,', folderPath], { shell: false, stdio: 'ignore', detached: true, windowsHide: true });
          }
        });
      } else {
        spawn('xdg-open', [folderPath], { stdio: 'ignore' });
      }
    } else {
      // 打开文件本体：使用系统默认程序
      if (platform === 'darwin') {
        spawn('open', [decodedPath], { stdio: 'ignore' });
      } else if (platform === 'win32') {
        // 用 PowerShell Start-Process 调用系统默认程序，避免 cmd 黑窗
        const escaped = decodedPath.replace(/'/g, "''");
        const psCmd = `Start-Process -FilePath '${escaped}'`;
        execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
          windowsHide: true,
          stdio: 'ignore'
        }, (err) => {
          if (err) {
            // 兜底：回退到 cmd /c start
            spawn('cmd', ['/c', 'start', '""', decodedPath], { shell: true, stdio: 'ignore', detached: true, windowsHide: true });
          }
        });
      } else {
        spawn('xdg-open', [decodedPath], { stdio: 'ignore' });
      }
    }
    
    res.json({
      success: true,
      message: mode === 'folder' ? '已打开文件夹' : '已打开文件'
    });
  } catch (error) {
    console.error('打开位置失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 批量导出照片
router.post('/batch-export', async (req, res) => {
  try {
    const { fileIds, targetPath, repoId } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供要导出的文件ID列表'
      });
    }
    
    if (!targetPath) {
      return res.status(400).json({
        success: false,
        error: '请提供目标路径'
      });
    }
    
    // 确保目标目录存在
    const { ensureDir } = require('../utils/fileUtils');
    await ensureDir(targetPath);
    
    const results = {
      success: [],
      failed: [],
      skipped: []
    };
    
    for (const fileId of fileIds) {
      try {
        // 解码文件ID获取路径
        const sourcePath = Buffer.from(fileId, 'base64').toString('utf8');
        
        // 检查源文件是否存在
        try {
          await fs.access(sourcePath);
        } catch {
          results.failed.push({
            id: fileId,
            reason: '源文件不存在'
          });
          continue;
        }
        
        // 构建目标路径
        const fileName = path.basename(sourcePath);
        const destPath = path.join(targetPath, fileName);
        
        // 检查目标文件是否已存在（增量模式）
        try {
          await fs.access(destPath);
          results.skipped.push({
            id: fileId,
            name: fileName,
            reason: '文件已存在'
          });
          continue;
        } catch {
          // 文件不存在，可以复制
        }
        
        // 复制文件
        await fs.copyFile(sourcePath, destPath);
        results.success.push({
          id: fileId,
          name: fileName,
          sourcePath,
          destPath
        });
      } catch (error) {
        results.failed.push({
          id: fileId,
          reason: error.message
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        successCount: results.success.length,
        failedCount: results.failed.length,
        skippedCount: results.skipped.length,
        details: results
      }
    });
  } catch (error) {
    console.error('批量导出失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 发送视频占位图（ffmpeg 不可用时）
function sendVideoPlaceholder(res, width) {
  const placeholderSvg = `<svg width="${width}" height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#333"/>
    <text x="50%" y="45%" font-family="Arial" font-size="48" fill="#fff" text-anchor="middle">🎬</text>
    <text x="50%" y="65%" font-family="Arial" font-size="16" fill="#ccc" text-anchor="middle">视频文件</text>
    <text x="50%" y="75%" font-family="Arial" font-size="12" fill="#999" text-anchor="middle">点击播放</text>
  </svg>`;
  res.set({
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400'
  });
  res.send(placeholderSvg);
}

module.exports = router;
