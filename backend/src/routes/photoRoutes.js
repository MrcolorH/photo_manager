const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const FileService = require('../services/fileService');

// 存储仓库配置文件路径
const REPOS_CONFIG_PATH = path.join(__dirname, '../../data/repos.json');

// 读取存储仓库列表
async function getRepos() {
  try {
    const data = await fsPromises.readFile(REPOS_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    const defaultRepo = {
      id: 'default',
      name: '默认仓库',
      path: process.env.PHOTO_BASE_PATH || '/Users/colorh/Pictures/相机照片',
      isDefault: true
    };
    return [defaultRepo];
  }
}

// 获取指定仓库的FileService实例
async function getFileService(repoId) {
  const repos = await getRepos();
  let repo;
  
  if (repoId) {
    repo = repos.find(r => r.id === repoId);
  } else {
    repo = repos.find(r => r.isDefault) || repos[0];
  }
  
  if (!repo) {
    throw new Error('未找到指定的存储仓库');
  }
  
  // 如果路径是 AUTO，使用默认路径
  const repoPath = repo.path === 'AUTO' ? getDefaultPhotoPath() : repo.path;
  
  return new FileService(repoPath);
}

// 获取默认照片路径（跨平台兼容）
function getDefaultPhotoPath() {
  if (process.env.PHOTO_BASE_PATH) {
    return process.env.PHOTO_BASE_PATH;
  }
  
  let defaultPath;
  if (process.platform === 'win32') {
    // Windows: 使用用户图片目录
    defaultPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Pictures', '相机照片');
  } else if (process.platform === 'darwin') {
    // macOS: 使用用户图片目录
    defaultPath = path.join(process.env.HOME || '/Users/username', 'Pictures', '相机照片');
  } else {
    // Linux: 使用用户主目录
    defaultPath = path.join(process.env.HOME || '/home/username', 'Pictures', '相机照片');
  }
  
  return defaultPath;
}

// 获取照片列表
router.get('/', async (req, res) => {
  try {
    const { category = 'jpg', page = 1, pageSize = 50, sortBy = 'modifiedTime', sortOrder = 'desc', repoId } = req.query;
    
    const fileService = await getFileService(repoId);
    const result = await fileService.getPhotos(category, {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      sortBy,
      sortOrder,
      repoId  // 传递 repoId 给 fileService
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
      await fsPromises.access(decodedPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    // 获取文件信息
    const stat = await fsPromises.stat(decodedPath);
    const fileSize = stat.size;
    const ext = path.extname(decodedPath).toLowerCase();
    
    // 判断是否为视频文件
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp'];
    const isVideo = videoExtensions.includes(ext);
    
    // 设置 Content-Type
    if (isVideo) {
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.m4v': 'video/mp4',
        '.3gp': 'video/3gpp'
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'video/mp4');
    }
    
    // 支持 Range 请求（视频流式播放）
    const range = req.headers.range;
    
    if (range && isVideo) {
      // 解析 Range 头
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      
      // 验证范围
      if (start >= fileSize) {
        return res.status(416).json({
          success: false,
          error: 'Range not satisfiable'
        });
      }
      
      const chunkSize = end - start + 1;
      
      // 设置响应头
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': res.getHeader('Content-Type') || 'video/mp4',
        'Cache-Control': 'public, max-age=3600'
      });
      
      // 使用流式传输，只读取请求的范围
      const stream = fs.createReadStream(decodedPath, { start, end });
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('视频流读取错误:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: '视频流读取失败' });
        }
      });
    } else {
      // 非视频文件或完整请求，使用流式传输
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      // 使用流式传输，避免一次性加载大文件到内存
      const stream = fs.createReadStream(decodedPath);
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('文件流读取错误:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: '文件读取失败' });
        }
      });
    }
  } catch (error) {
    console.error('预览文件失败:', error);
    // 只有在响应还未发送时才发送错误响应
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

// 获取缩略图（动态生成，不保存文件）
router.get('/thumbnail', async (req, res) => {
  try {
    const { path: filePath, width = 300, quality = 80 } = req.query;
    
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
      await fsPromises.access(decodedPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    // 获取文件扩展名
    const ext = path.extname(decodedPath).toLowerCase();
    
    // 如果是视频文件，使用 ffmpeg 提取首帧
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
      const { spawn } = require('child_process');
      
      return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', decodedPath,
          '-ss', '00:00:01',  // 从第1秒开始提取
          '-vframes', '1',     // 只提取1帧
          '-vf', `scale=${width}:-1`,  // 缩放到指定宽度
          '-f', 'image2pipe',  // 输出到管道
          '-vcodec', 'mjpeg',  // 使用 JPEG 编码
          '-q:v', '5',         // 质量参数（1-31，越小质量越高）
          'pipe:1'             // 输出到 stdout
        ], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        const chunks = [];
        let errorOutput = '';
        
        ffmpeg.stdout.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        ffmpeg.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
          if (code === 0 && chunks.length > 0) {
            const buffer = Buffer.concat(chunks);
            res.set({
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=86400'
            });
            res.send(buffer);
          } else {
            console.error('ffmpeg 提取视频帧失败:', errorOutput.substring(0, 200));
            // 返回一个错误占位图
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
          resolve();
        });
        
        ffmpeg.on('error', (err) => {
          console.error('ffmpeg 执行错误:', err.message);
          const placeholderSvg = `<svg width="${width}" height="200" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#333"/>
            <text x="50%" y="45%" font-family="Arial" font-size="48" fill="#fff" text-anchor="middle">🎬</text>
            <text x="50%" y="65%" font-family="Arial" font-size="16" fill="#ccc" text-anchor="middle">视频文件</text>
          </svg>`;
          
          res.set({
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=86400'
          });
          res.send(placeholderSvg);
          resolve();
        });
      });
    }
    
    // 如果是 RAW 文件，使用专门的缩略图生成策略
    const rawExtensions = ['.arw', '.cr2', '.cr3', '.nef', '.dng', '.orf', '.raf', '.rw2', '.raw'];
    if (rawExtensions.includes(ext)) {
      console.log('\n🔍 检测到RAW文件，开始生成缩略图');
      console.log('文件路径:', decodedPath);
      console.log('文件扩展名:', ext);
      
      const { generateRawThumbnail } = require('../utils/rawThumbnail');
      
      try {
        const thumbnailBuffer = await generateRawThumbnail(decodedPath, parseInt(width), parseInt(quality));
        
        if (thumbnailBuffer) {
          console.log('✅ RAW缩略图生成成功，大小:', thumbnailBuffer.length, 'bytes');
          // 成功生成缩略图
          res.set({
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400'
          });
          res.send(thumbnailBuffer);
          return;
        } else {
          console.log('⚠️  RAW缩略图生成返回null，将使用占位图');
        }
      } catch (error) {
        console.error('❌ RAW缩略图生成异常:', error.message);
        console.error('错误堆栈:', error.stack);
      }
      
      // 如果生成失败，继续执行下面的占位图逻辑
    }
    
    // 其他文件类型或RAW处理失败，使用sharp
    const sharp = require('sharp');
    try {
      const thumbnailBuffer = await sharp(decodedPath)
        .resize(parseInt(width), null, { withoutEnlargement: true })
        .jpeg({ quality: parseInt(quality) })
        .toBuffer();
          
      // 设置响应头
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400' // 缓存1天
      });
          
      res.send(thumbnailBuffer);
    } catch (error) {
      console.error('文件转换失败:', error.message);
      // 如果 sharp 不支持该格式,返回占位图
      const fileExt = ext.toUpperCase().substring(1);
      const placeholderSvg = `<svg width="${width}" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f0f0f0"/>
        <text x="50%" y="45%" font-family="Arial" font-size="48" fill="#999" text-anchor="middle">📷</text>
        <text x="50%" y="65%" font-family="Arial" font-size="16" fill="#999" text-anchor="middle">${fileExt} 文件</text>
        <text x="50%" y="75%" font-family="Arial" font-size="12" fill="#bbb" text-anchor="middle">点击打开原图</text>
      </svg>`;
          
      res.set({
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400'
      });
      res.send(placeholderSvg);
    }
  } catch (error) {
    console.error('生成缩略图失败:', error);
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
    
    // 检查文件是否存在
    try {
      await fsPromises.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    // 获取文件信息
    const stat = await fsPromises.stat(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    
    // 判断是否为视频文件
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp'];
    const isVideo = videoExtensions.includes(ext);
    
    // 设置 Content-Type
    if (isVideo) {
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.m4v': 'video/mp4',
        '.3gp': 'video/3gpp'
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'video/mp4');
    }
    
    // 支持 Range 请求（视频流式播放）
    const range = req.headers.range;
    
    if (range && isVideo) {
      // 解析 Range 头
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      
      // 验证范围
      if (start >= fileSize) {
        return res.status(416).json({
          success: false,
          error: 'Range not satisfiable'
        });
      }
      
      const chunkSize = end - start + 1;
      
      // 设置响应头
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': res.getHeader('Content-Type') || 'video/mp4',
        'Cache-Control': 'public, max-age=3600'
      });
      
      // 使用流式传输，只读取请求的范围
      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('视频流读取错误:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: '视频流读取失败' });
        }
      });
    } else {
      // 非视频文件或完整请求，使用流式传输
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      // 使用流式传输，避免一次性加载大文件到内存
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('文件流读取错误:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: '文件读取失败' });
        }
      });
    }
  } catch (error) {
    console.error('预览文件失败:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
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
      await fsPromises.access(decodedPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const platform = process.platform;
    
    let command;
    if (mode === 'folder') {
      // 打开文件夹
      const folderPath = path.dirname(decodedPath);
      if (platform === 'darwin') {
        command = `open "${folderPath}"`;
      } else if (platform === 'win32') {
        command = `explorer "${folderPath}"`;
      } else {
        command = `xdg-open "${folderPath}"`;
      }
    } else {
      // 打开文件
      if (platform === 'darwin') {
        command = `open "${decodedPath}"`;
      } else if (platform === 'win32') {
        command = `start "" "${decodedPath}"`;
      } else {
        command = `xdg-open "${decodedPath}"`;
      }
    }
    
    await execPromise(command);
    
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
          await fsPromises.access(sourcePath);
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
          await fsPromises.access(destPath);
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
        await fsPromises.copyFile(sourcePath, destPath);
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

module.exports = router;
