const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const pLimit = require('p-limit');
const sharp = require('sharp');
const { spawn } = require('child_process');
const { generateRawThumbnail } = require('../utils/rawThumbnail');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// 格式化字节数工具函数
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// 视频扩展名集合
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp']);
// RAW 扩展名集合
const RAW_EXTS = new Set(['.arw', '.cr2', '.cr3', '.nef', '.dng', '.orf', '.raf', '.rw2', '.raw']);

class ThumbnailCacheService {
  constructor() {
    // 限制 sharp/ffmpeg 等繁重转码任务并发数，防止占满 Node 事件循环与 CPU
    const concurrency = Math.max(2, Math.floor((os.cpus() || []).length / 2) || 2);
    this.limit = pLimit(concurrency);

    // 缓存目录解析结果缓存 (repoBasePath -> cacheDir)
    this._dirCache = new Map();

    // 预热任务管理 (repoId -> taskState)
    this.preloadTasks = new Map();
  }

  // 计算原图相对路径或绝对路径的特征签名
  getCacheKey(relPath, mtime, size) {
    const raw = `${relPath}_${mtime || 0}_${size || 0}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  // 获得系统本地兜底目录（在外置盘只读时使用）
  getFallbackCacheDir(repoId = 'default') {
    const userData = process.env.ELECTRON_USER_DATA;
    let base;
    if (userData) {
      base = userData;
    } else if (process.platform === 'darwin') {
      base = path.join(os.homedir(), 'Library', 'Application Support', 'shiguang-capsule');
    } else if (process.platform === 'win32') {
      base = path.join(process.env.APPDATA || os.homedir(), 'shiguang-capsule');
    } else {
      base = path.join(os.homedir(), '.config', 'shiguang-capsule');
    }
    return path.join(base, 'cache', 'thumbnails', String(repoId));
  }

  // 解析并确保缩略图缓存目录可写（优先外置盘 repo/.shiguang/thumbnails）
  async getCacheDir(repoBasePath, repoId) {
    const cacheKey = `${repoBasePath || ''}_${repoId || ''}`;
    if (this._dirCache.has(cacheKey)) {
      return this._dirCache.get(cacheKey);
    }

    if (repoBasePath) {
      const primaryDir = path.join(repoBasePath, '.shiguang', 'thumbnails');
      try {
        await fs.mkdir(primaryDir, { recursive: true });
        // 测试写入权限
        const testFile = path.join(primaryDir, `.test_write_${Date.now()}`);
        await fs.writeFile(testFile, 'ok');
        await fs.unlink(testFile);
        this._dirCache.set(cacheKey, primaryDir);
        return primaryDir;
      } catch (err) {
        console.warn(`[ThumbnailCache] 外置盘目录不可写 (${err.message})，降级到本地系统缓存目录`);
      }
    }

    // 降级使用系统缓存目录
    const fallbackDir = this.getFallbackCacheDir(repoId);
    await fs.mkdir(fallbackDir, { recursive: true });
    this._dirCache.set(cacheKey, fallbackDir);
    return fallbackDir;
  }

  // 计算指定文件的缩略图缓存目标路径与 Key
  async getCacheFilePath(filePath, { repoBasePath, repoId, width = 300, format = 'webp', mtime, size }) {
    let fileMtime = mtime;
    let fileSize = size;

    if (!fileMtime || !fileSize) {
      try {
        const stat = await fs.stat(filePath);
        fileMtime = stat.mtimeMs;
        fileSize = stat.size;
      } catch {
        fileMtime = 0;
        fileSize = 0;
      }
    }

    // 相对路径标准化
    let relPath = filePath;
    if (repoBasePath && filePath.startsWith(repoBasePath)) {
      relPath = path.relative(repoBasePath, filePath).replace(/\\/g, '/');
    }

    const key = this.getCacheKey(relPath, fileMtime, fileSize);
    const filename = `${key}_w${width}.${format}`;
    const cacheDir = await this.getCacheDir(repoBasePath, repoId);
    const cachePath = path.join(cacheDir, filename);

    return {
      cacheDir,
      cachePath,
      key,
      filename,
      format
    };
  }

  // 检查缓存文件是否存在且有效（大小 > 0）
  async checkCache(cachePath) {
    try {
      const stat = await fs.stat(cachePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  // 将 Buffer 写入磁盘缓存（静默捕获异常并记录日志）
  async saveCache(cachePath, buffer) {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, buffer);
      return true;
    } catch (err) {
      console.error(`[ThumbnailCache] 保存缓存文件失败 (${cachePath}):`, err.message);
      return false;
    }
  }

  // 生成缩略图核心转码逻辑（受并发限制）
  async generateThumbnail({ filePath, width = 300, quality = 80, format = 'webp' }) {
    return this.limit(async () => {
      const ext = path.extname(filePath).toLowerCase();

      // 1. 视频首帧生成
      if (VIDEO_EXTS.has(ext)) {
        return this._generateVideoThumbnail(filePath, width, quality, format);
      }

      // 2. RAW 格式处理
      if (RAW_EXTS.has(ext)) {
        try {
          const rawBuffer = await generateRawThumbnail(filePath, parseInt(width, 10), parseInt(quality, 10), format);
          if (rawBuffer && rawBuffer.length > 0) {
            return {
              buffer: rawBuffer,
              contentType: format === 'webp' ? 'image/webp' : 'image/jpeg',
              isPlaceholder: false
            };
          }
        } catch (err) {
          console.error(`[ThumbnailCache] RAW缩略图生成异常:`, err.message);
        }
      }

      // 3. 通用照片处理 (JPG/PNG 等)
      try {
        const pipeline = sharp(filePath)
          .rotate()
          .resize(parseInt(width, 10), null, { withoutEnlargement: true });

        let buffer;
        if (format === 'webp') {
          buffer = await pipeline.webp({ quality: parseInt(quality, 10), effort: 4 }).toBuffer();
        } else {
          buffer = await pipeline.jpeg({ quality: parseInt(quality, 10) }).toBuffer();
        }

        return {
          buffer,
          contentType: format === 'webp' ? 'image/webp' : 'image/jpeg',
          isPlaceholder: false
        };
      } catch (err) {
        console.warn(`[ThumbnailCache] Sharp 解码失败，生成占位图:`, err.message);
        const placeholderSvg = this._generatePlaceholderSvg(ext, width);
        return {
          buffer: Buffer.from(placeholderSvg),
          contentType: 'image/svg+xml',
          isPlaceholder: true
        };
      }
    });
  }

  // 内部辅助：提取视频首帧并转为 WebP/JPEG
  _generateVideoThumbnail(filePath, width, quality, format) {
    return new Promise((resolve) => {
      let ffmpeg;
      try {
        ffmpeg = spawn(FFMPEG_PATH, [
          '-i', filePath,
          '-ss', '00:00:01',
          '-vframes', '1',
          '-vf', `scale=${width}:-1`,
          '-f', 'image2pipe',
          '-vcodec', 'mjpeg',
          '-q:v', '5',
          'pipe:1'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        console.error('ffmpeg 启动失败:', err.message);
        const svg = this._generatePlaceholderSvg(path.extname(filePath), width);
        return resolve({ buffer: Buffer.from(svg), contentType: 'image/svg+xml', isPlaceholder: true });
      }

      const chunks = [];
      ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
      ffmpeg.on('close', async (code) => {
        if (code === 0 && chunks.length > 0) {
          const rawJpeg = Buffer.concat(chunks);
          if (format === 'webp') {
            try {
              const webpBuffer = await sharp(rawJpeg)
                .webp({ quality: parseInt(quality, 10), effort: 4 })
                .toBuffer();
              return resolve({ buffer: webpBuffer, contentType: 'image/webp', isPlaceholder: false });
            } catch {
              return resolve({ buffer: rawJpeg, contentType: 'image/jpeg', isPlaceholder: false });
            }
          }
          return resolve({ buffer: rawJpeg, contentType: 'image/jpeg', isPlaceholder: false });
        }
        const svg = this._generatePlaceholderSvg(path.extname(filePath), width);
        resolve({ buffer: Buffer.from(svg), contentType: 'image/svg+xml', isPlaceholder: true });
      });
      ffmpeg.on('error', () => {
        const svg = this._generatePlaceholderSvg(path.extname(filePath), width);
        resolve({ buffer: Buffer.from(svg), contentType: 'image/svg+xml', isPlaceholder: true });
      });
    });
  }

  // 内部辅助：生成占位 SVG
  _generatePlaceholderSvg(ext, width = 300) {
    const fileExt = (ext || '').toUpperCase().replace(/^\./, '');
    return `<svg width="${width}" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#262626"/>
      <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="36" fill="#888" text-anchor="middle">📷</text>
      <text x="50%" y="65%" font-family="Arial, sans-serif" font-size="14" fill="#aaa" text-anchor="middle">${fileExt} 预览</text>
      <text x="50%" y="78%" font-family="Arial, sans-serif" font-size="11" fill="#666" text-anchor="middle">点击查看原图</text>
    </svg>`;
  }

  // 获取指定仓库的缓存统计信息
  async getCacheStats(repoBasePath, repoId) {
    const cacheDir = await this.getCacheDir(repoBasePath, repoId);
    let count = 0;
    let totalBytes = 0;

    try {
      const files = await fs.readdir(cacheDir);
      for (const name of files) {
        if (name.startsWith('.')) continue;
        try {
          const stat = await fs.stat(path.join(cacheDir, name));
          if (stat.isFile()) {
            count++;
            totalBytes += stat.size;
          }
        } catch {
          // 忽略单个文件 stat 失败
        }
      }
    } catch {
      // 目录不存在
    }

    const isExternal = repoBasePath ? cacheDir.startsWith(path.resolve(repoBasePath)) : false;

    return {
      cacheDir,
      count,
      totalBytes,
      formattedSize: formatBytes(totalBytes),
      isExternal
    };
  }

  // 清空指定仓库的缩略图缓存
  async clearCache(repoBasePath, repoId) {
    const cacheDir = await this.getCacheDir(repoBasePath, repoId);
    let deletedCount = 0;
    let freedBytes = 0;

    try {
      const files = await fs.readdir(cacheDir);
      for (const name of files) {
        if (name.startsWith('.')) continue;
        const fullPath = path.join(cacheDir, name);
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isFile()) {
            await fs.unlink(fullPath);
            deletedCount++;
            freedBytes += stat.size;
          }
        } catch {
          // 忽略单个文件错误
        }
      }
    } catch {
      // 目录可能为空
    }

    return {
      cacheDir,
      deletedCount,
      freedBytes,
      formattedFreed: formatBytes(freedBytes)
    };
  }

  // 获取预热任务状态
  getPreloadProgress(repoId) {
    const id = String(repoId || 'default');
    return this.preloadTasks.get(id) || {
      status: 'idle',
      total: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      percentage: 0,
      currentFile: ''
    };
  }

  // 取消预热任务
  cancelPreload(repoId) {
    const id = String(repoId || 'default');
    const task = this.preloadTasks.get(id);
    if (task && task.status === 'running') {
      task.cancelled = true;
      task.status = 'cancelled';
      return true;
    }
    return false;
  }

  // 启动预热任务（异步后台执行，通过 getPreloadProgress 轮询或查询状态）
  async startPreload(repoId, repoBasePath, fileList = [], { width = 300, quality = 80, format = 'webp' } = {}) {
    const id = String(repoId || 'default');
    const current = this.preloadTasks.get(id);
    if (current && current.status === 'running') {
      return current;
    }

    const task = {
      id,
      status: 'running',
      cancelled: false,
      total: fileList.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      percentage: 0,
      currentFile: '',
      startTime: Date.now(),
      endTime: null
    };

    this.preloadTasks.set(id, task);

    // 异步执行，不阻塞当前 HTTP 请求
    (async () => {
      for (let i = 0; i < fileList.length; i++) {
        if (task.cancelled) {
          task.status = 'cancelled';
          task.endTime = Date.now();
          break;
        }

        const file = fileList[i];
        const filePath = file.path;
        task.currentFile = path.basename(filePath);

        try {
          const { cachePath } = await this.getCacheFilePath(filePath, {
            repoBasePath,
            repoId,
            width,
            format,
            mtime: file.mtime || file.modifiedTime,
            size: file.size
          });

          const isHit = await this.checkCache(cachePath);
          if (isHit) {
            task.skipped++;
          } else {
            const { buffer, isPlaceholder } = await this.generateThumbnail({
              filePath,
              width,
              quality,
              format
            });
            if (!isPlaceholder && buffer) {
              await this.saveCache(cachePath, buffer);
            }
            task.processed++;
          }
        } catch (err) {
          task.failed++;
          console.warn(`[ThumbnailCache] 预热处理失败 (${filePath}):`, err.message);
        }

        const done = task.processed + task.skipped + task.failed;
        task.percentage = task.total > 0 ? Math.round((done / task.total) * 100) : 100;
      }

      if (!task.cancelled) {
        task.status = 'completed';
        task.endTime = Date.now();
        task.currentFile = '';
      }
    })().catch((err) => {
      console.error('[ThumbnailCache] 预热任务致命异常:', err);
      task.status = 'error';
      task.error = err.message;
      task.endTime = Date.now();
    });

    return task;
  }
}

const thumbnailCacheService = new ThumbnailCacheService();
module.exports = thumbnailCacheService;
