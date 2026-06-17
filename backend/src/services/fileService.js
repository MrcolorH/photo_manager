const fs = require('fs').promises;
const path = require('path');
const { scanDirectory, ensureDir, copyFile, deleteFile, getFileNameWithoutExt, fileExists, getFileType } = require('../utils/fileUtils');

class FileService {
  constructor(basePath) {
    this.basePath = basePath;
    this._scanCache = new Map();
    this._cacheTTL = 5000;
  }

  // 获取分类目录路径
  getCategoryPath(category) {
    return path.join(this.basePath, category);
  }

  _getCachedScan(categoryPath) {
    const cached = this._scanCache.get(categoryPath);
    if (cached && Date.now() - cached.time < this._cacheTTL) {
      return cached.files;
    }
    return null;
  }

  async scanDirectoryCached(categoryPath) {
    const cached = this._getCachedScan(categoryPath);
    if (cached) return cached;
    const files = await scanDirectory(categoryPath);
    this._scanCache.set(categoryPath, { files, time: Date.now() });
    return files;
  }

  invalidateScanCache(categoryPath) {
    if (categoryPath) {
      this._scanCache.delete(categoryPath);
    } else {
      this._scanCache.clear();
    }
  }

  // 初始化分类目录
  async initCategories() {
    const categories = ['jpg', 'raw', 'video'];
    for (const category of categories) {
      await ensureDir(this.getCategoryPath(category));
    }
  }

  // 从存储卡导入照片（增量导入，不覆盖已有文件）
  async importFromCard(sourcePath, progressCallback = null, smartNaming = false) {
    console.log('开始扫描目录:', sourcePath);
    
    // 扫描存储卡中的所有媒体文件
    const files = await scanDirectory(sourcePath);
    
    console.log(`扫描完成，找到 ${files.length} 个媒体文件`);
    
    const results = {
      jpg: [],
      raw: [],
      video: [],
      errors: [],
      skipped: []  // 记录跳过的文件
    };

    // 确保分类目录存在
    await this.initCategories();

    const totalFiles = files.length;
    let processedFiles = 0;
    const startTime = Date.now();
    
    // 如果没有文件，立即返回结果
    if (totalFiles === 0) {
      console.log('没有找到媒体文件，导入结束');
      if (progressCallback) {
        progressCallback({
          total: 0,
          processed: 0,
          remaining: 0,
          currentFile: '',
          estimatedTimeRemaining: 0,
          percentage: 100
        });
      }
      return results;
    }
    
    // 发送初始进度
    if (progressCallback) {
      progressCallback({
        total: totalFiles,
        processed: 0,
        remaining: totalFiles,
        currentFile: '准备开始...',
        estimatedTimeRemaining: 0,
        percentage: 0
      });
    }

    // 智能命名：按子文件夹分组，使用每个文件的最后一级文件夹名称作为前缀
    const folderCounters = {};  // 每个子文件夹独立计数器
    const getSmartName = (file) => {
      if (!smartNaming) return file.name;
      const parentFolder = path.basename(path.dirname(file.path));
      if (!folderCounters[parentFolder]) {
        folderCounters[parentFolder] = 1;
      }
      const name = `${parentFolder}-${folderCounters[parentFolder]}${file.extension}`;
      folderCounters[parentFolder]++;
      return name;
    };

    // 按类型分类复制文件
    for (const file of files) {
      console.log(`处理文件 ${processedFiles + 1}/${totalFiles}: ${file.name}`);
      
      try {
        const targetDir = this.getCategoryPath(file.type);
        const targetFileName = getSmartName(file);
        const targetPath = path.join(targetDir, targetFileName);
        const copyResult = await copyFile(file.path, targetPath);
        
        if (copyResult.skipped) {
          // 文件被跳过（已存在）
          results.skipped.push({
            originalPath: file.path,
            newPath: copyResult.path,
            name: smartNaming ? targetFileName : file.name,
            size: file.size,
            reason: copyResult.reason || 'already_exists'
          });
          console.log(`  文件已存在，跳过: ${file.name}`);
        } else {
          // 文件成功复制
          results[file.type].push({
            originalPath: file.path,
            newPath: copyResult.path,
            name: smartNaming ? targetFileName : file.name,
            size: file.size
          });
          console.log(`  文件复制成功: ${file.name}`);
        }
      } catch (error) {
        results.errors.push({
          file: file.name,
          error: error.message
        });
        console.error(`  文件处理失败: ${file.name}`, error.message);
      }

      // 更新进度
      processedFiles++;
      if (progressCallback) {
        const elapsedTime = (Date.now() - startTime) / 1000; // 秒
        const avgTimePerFile = processedFiles > 0 ? elapsedTime / processedFiles : 0;
        const remainingFiles = totalFiles - processedFiles;
        const estimatedTimeRemaining = avgTimePerFile * remainingFiles; // 秒
        
        progressCallback({
          total: totalFiles,
          processed: processedFiles,
          remaining: remainingFiles,
          currentFile: file.name,
          estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
          percentage: Math.round((processedFiles / totalFiles) * 100)
        });
      }
    }
    
    console.log('导入完成:', {
      jpg: results.jpg.length,
      raw: results.raw.length,
      video: results.video.length,
      skipped: results.skipped.length,
      errors: results.errors.length
    });

    return results;
  }

  // 获取照片列表
  async getPhotos(category, options = {}) {
    const { page = 1, pageSize = 50, sortBy = 'modifiedTime', sortOrder = 'desc', repoId } = options;
    
    const categoryPath = this.getCategoryPath(category);
    
    try {
      await fs.access(categoryPath);
    } catch {
      return { photos: [], total: 0, page, pageSize };
    }

    const files = await this.scanDirectoryCached(categoryPath);
    
    // 只返回当前分类的文件
    const photos = files
      .filter(f => f.type === category)
      .map(f => ({
        id: Buffer.from(f.path).toString('base64'),
        name: f.name,
        filename: getFileNameWithoutExt(f.name),
        path: f.path,
        relativePath: path.relative(this.basePath, f.path),
        type: f.type,
        extension: f.extension,
        size: f.size,
        modifiedTime: f.modifiedTime,
        thumbnailUrl: `/api/photos/thumbnail?path=${encodeURIComponent(f.path)}`,  // 缩略图
        url: `/api/photos/preview?path=${encodeURIComponent(f.path)}&repo=${repoId || ''}`  // 原图
      }));

    // 排序
    photos.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'size') {
        comparison = a.size - b.size;
      } else {
        comparison = new Date(a.modifiedTime) - new Date(b.modifiedTime);
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const total = photos.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedPhotos = photos.slice(start, end);

    return {
      photos: paginatedPhotos,
      total,
      page,
      pageSize
    };
  }

  // 删除照片
  async deletePhoto(photoId, options = {}) {
    const { syncRaw = true } = options;
    
    // 解码ID获取路径
    const photoPath = Buffer.from(photoId, 'base64').toString('utf8');
    
    if (!await fileExists(photoPath)) {
      throw new Error('照片不存在');
    }

    const filename = path.basename(photoPath);
    const filenameWithoutExt = getFileNameWithoutExt(filename);
    const type = getFileType(path.extname(filename));

    const deletedFiles = [];

    // 删除主文件
    if (await deleteFile(photoPath)) {
      deletedFiles.push(photoPath);
    }

    // 如果是JPG且开启了同步删除，删除对应的RAW文件
    if (type === 'jpg' && syncRaw) {
      const rawDir = this.getCategoryPath('raw');
      const rawExtensions = ['.arw', '.cr2', '.cr3', '.nef', '.dng', '.orf', '.raf', '.rw2', '.raw'];
      
      for (const ext of rawExtensions) {
        const rawPath = path.join(rawDir, filenameWithoutExt + ext);
        if (await fileExists(rawPath)) {
          if (await deleteFile(rawPath)) {
            deletedFiles.push(rawPath);
          }
        }
      }
    }

    this.invalidateScanCache();

    return {
      success: true,
      deletedFiles
    };
  }

  // 查找孤立的RAW文件（没有对应JPG的RAW）
  async findOrphanRawFiles() {
    const jpgPath = this.getCategoryPath('jpg');
    const rawPath = this.getCategoryPath('raw');

    // 获取所有JPG文件名（不含扩展名）
    const jpgFiles = await scanDirectory(jpgPath);
    const jpgNames = new Set(
      jpgFiles
        .filter(f => f.type === 'jpg')
        .map(f => getFileNameWithoutExt(f.name).toLowerCase())
    );

    // 获取所有RAW文件
    const rawFiles = await scanDirectory(rawPath);
    const orphanRaws = [];

    for (const rawFile of rawFiles) {
      if (rawFile.type === 'raw') {
        const rawName = getFileNameWithoutExt(rawFile.name).toLowerCase();
        
        if (!jpgNames.has(rawName)) {
          orphanRaws.push({
            id: Buffer.from(rawFile.path).toString('base64'),
            name: rawFile.name,
            filename: getFileNameWithoutExt(rawFile.name),
            path: rawFile.path,
            relativePath: path.relative(this.basePath, rawFile.path),
            size: rawFile.size,
            modifiedTime: rawFile.modifiedTime,
            url: `/uploads/${path.relative(this.basePath, rawFile.path)}`
          });
        }
      }
    }

    return orphanRaws;
  }

  // 批量删除RAW文件
  async deleteRawFiles(fileIds) {
    const results = {
      success: [],
      failed: []
    };

    for (const fileId of fileIds) {
      try {
        const filePath = Buffer.from(fileId, 'base64').toString('utf8');
        
        if (await fileExists(filePath)) {
          if (await deleteFile(filePath)) {
            results.success.push(fileId);
          } else {
            results.failed.push({ id: fileId, reason: '删除失败' });
          }
        } else {
          results.failed.push({ id: fileId, reason: '文件不存在' });
        }
      } catch (error) {
        results.failed.push({ id: fileId, reason: error.message });
      }
    }

    if (results.success.length > 0) {
      this.invalidateScanCache();
    }

    return results;
  }

  // 获取存储信息
  async getStorageInfo() {
    const categories = ['jpg', 'raw', 'video'];
    const info = {};

    for (const category of categories) {
      const categoryPath = this.getCategoryPath(category);
      
      try {
        const files = await scanDirectory(categoryPath);
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        
        info[category] = {
          count: files.length,
          size: totalSize,
          sizeFormatted: this.formatFileSize(totalSize)
        };
      } catch {
        info[category] = {
          count: 0,
          size: 0,
          sizeFormatted: '0 B'
        };
      }
    }

    return info;
  }

  // 格式化文件大小
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 获取孤立的 RAW 文件（没有对应 JPG 的 RAW）
  async getOrphanRaws() {
    const rawPath = this.getCategoryPath('raw');
    const jpgPath = this.getCategoryPath('jpg');
    
    try {
      // 获取所有 RAW 文件
      const rawFiles = await scanDirectory(rawPath);
      
      // 获取所有 JPG 文件名（不含扩展名）
      let jpgNames = new Set();
      try {
        const jpgFiles = await scanDirectory(jpgPath);
        jpgFiles.forEach(f => {
          const nameWithoutExt = getFileNameWithoutExt(f.name);
          jpgNames.add(nameWithoutExt.toLowerCase());
        });
      } catch {
        // JPG 目录不存在，所有 RAW 都是孤立的
      }
      
      // 找出没有对应 JPG 的 RAW 文件
      const orphanRaws = rawFiles
        .filter(f => {
          const nameWithoutExt = getFileNameWithoutExt(f.name).toLowerCase();
          return !jpgNames.has(nameWithoutExt);
        })
        .map(f => ({
          id: Buffer.from(f.path).toString('base64'),
          name: f.name,
          path: f.path,
          type: f.type,
          extension: f.extension,
          size: f.size,
          modifiedTime: f.modifiedTime
        }));
      
      return orphanRaws;
    } catch (error) {
      console.error('获取孤立 RAW 文件失败:', error);
      return [];
    }
  }

  // 批量删除 RAW 文件
  async batchDeleteRaws(fileIds) {
    const result = {
      success: [],
      failed: []
    };
    
    for (const id of fileIds) {
      try {
        const filePath = Buffer.from(id, 'base64').toString('utf8');
        await deleteFile(filePath);
        result.success.push({ id, path: filePath });
      } catch (error) {
        result.failed.push({
          id,
          error: error.message
        });
      }
    }
    
    if (result.success.length > 0) {
      this.invalidateScanCache();
    }

    return result;
  }
}

module.exports = FileService;
