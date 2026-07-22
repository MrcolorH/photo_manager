const fs = require('fs').promises;
const path = require('path');
const { scanDirectory, ensureDir, copyFile, deleteFile, getFileNameWithoutExt, fileExists, getFileType, computeFileHash } = require('../utils/fileUtils');
const ManifestService = require('./manifestService');
const { readKeyExif } = require('./exifService');

// 有限并发执行：对 items 数组每个元素执行 async fn，并发度 concurrency
async function runWithConcurrency(items, concurrency, asyncFn) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await asyncFn(items[i], i);
    }
  }
  const workers = Array(Math.min(concurrency, items.length)).fill(0).map(worker);
  await Promise.all(workers);
}

class FileService {
  constructor(basePath) {
    this.basePath = basePath;
    this._scanCache = new Map();
    this._cacheTTL = 5000;
    // 仓库清单服务：作为照片列表的统一数据源
    this.manifest = new ManifestService(basePath);
  }

  // 获取分类目录路径
  getCategoryPath(category) {
    return path.join(this.basePath, category);
  }

  // 根据归档策略计算文件在仓库中的相对路径（forward slash）
  // archiveByExif 为 false：直接放在 category/ 下
  // archiveByExif 为 true：按 EXIF 拍摄时间或 mtime 归档到 category/YYYY/MM/ 下
  // fileName 为经过 smartNaming 处理后的最终文件名
  getArchiveRelativePath(fileName, exif, mtime, category, archiveByExif) {
    if (!archiveByExif) {
      return `${category}/${fileName}`;
    }

    // 取拍摄时间字符串，优先 EXIF，失败回退到 mtime（ISO 字符串）
    let dateStr = exif && exif.dateTimeOriginal ? exif.dateTimeOriginal : null;
    let year = null;
    let month = null;

    if (dateStr) {
      // EXIF 格式形如 "2024:03:15 14:30:00"，将前半段的冒号替换为横杠
      // 只取前 10 个字符 "2024:03:15" -> "2024-03-15"
      const normalized = dateStr.replace(/:/g, '-');
      const match = /^(\d{4})-(\d{2})/.exec(normalized);
      if (match) {
        year = match[1];
        month = match[2];
      }
    }

    // EXIF 解析失败，回退到 mtime
    if (!year || !month) {
      const date = mtime ? new Date(mtime) : new Date();
      if (isNaN(date.getTime())) {
        // mtime 也无效，回退到当前时间
        date.setTime(Date.now());
      }
      year = String(date.getFullYear());
      month = String(date.getMonth() + 1).padStart(2, '0');
    }

    return `${category}/${year}/${month}/${fileName}`;
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
    // 同时清空清单缓存，保证下次读取拿到最新数据
    this.manifest.invalidateCache();
  }

  // 初始化分类目录
  async initCategories() {
    const categories = ['jpg', 'raw', 'video'];
    for (const category of categories) {
      await ensureDir(this.getCategoryPath(category));
    }
  }

  // 从存储卡导入照片（增量导入，支持哈希去重、EXIF 读取、按 EXIF 时间归档、双盘镜像）
  // options: { archiveByExif = false, mirrorPath = null }
  async importFromCard(sourcePath, progressCallback = null, smartNaming = false, options = {}) {
    const { archiveByExif = false, mirrorPath = null } = options;

    console.log('开始扫描目录:', sourcePath);
    console.log('归档策略 archiveByExif:', archiveByExif, '镜像盘 mirrorPath:', mirrorPath || '无');

    // 确保清单已初始化（首次访问会触发扫描并生成清单，便于哈希去重）
    await this.manifest.initFromScan();

    // 扫描存储卡中的所有媒体文件
    const files = await scanDirectory(sourcePath);

    console.log(`扫描完成，找到 ${files.length} 个媒体文件`);

    const results = {
      jpg: [],
      raw: [],
      video: [],
      errors: [],
      skipped: [],          // 哈希重复或已存在的文件
      mirrorSuccess: [],    // 镜像成功（Task 5）
      mirrorErrors: []      // 镜像失败
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
    const chineseRegex = /[\u4e00-\u9fff]/;  // 匹配中文字符
    const getSmartName = (file) => {
      if (!smartNaming) return file.name;
      const parentFolder = path.basename(path.dirname(file.path));
      const originalName = path.basename(file.name, file.extension);

      // 如果原文件名包含中文，使用 文件夹名_原中文名 格式，不用序号
      if (chineseRegex.test(originalName)) {
        return `${parentFolder}_${originalName}${file.extension}`;
      }

      // 非中文名使用 文件夹名-序号 格式
      if (!folderCounters[parentFolder]) {
        folderCounters[parentFolder] = 1;
      }
      const name = `${parentFolder}-${folderCounters[parentFolder]}${file.extension}`;
      folderCounters[parentFolder]++;
      return name;
    };

    // 生成不冲突的目标文件名：若 destPath 已存在且哈希不同，加 -1/-2/-3 后缀
    const resolveAvailablePath = async (destPath) => {
      if (!await fileExists(destPath)) {
        return destPath;
      }
      const dir = path.dirname(destPath);
      const ext = path.extname(destPath);
      const baseName = path.basename(destPath, ext);
      let idx = 1;
      let candidate;
      do {
        candidate = path.join(dir, `${baseName}-${idx}${ext}`);
        idx++;
      } while (await fileExists(candidate));
      return candidate;
    };

    // 按类型分类处理文件（并发，IO 密集型，并发度 8）
    const IMPORT_CONCURRENCY = 8;
    await runWithConcurrency(files, IMPORT_CONCURRENCY, async (file) => {
      try {
        // 1. 计算 SHA-256 哈希
        const hash = await computeFileHash(file.path);

        // 2. 哈希去重：命中清单则跳过
        const existed = await this.manifest.findByHash(hash);
        if (existed) {
          results.skipped.push({
            originalPath: file.path,
            name: file.name,
            size: file.size,
            reason: 'duplicate_hash',
            hash: hash,
            existingRelPath: existed.relPath
          });
        } else {
          // 3. 未命中：确定归档相对路径（基于 smartNaming 后的最终文件名）
          const targetFileName = getSmartName(file);
          const mtimeIso = new Date(file.modifiedTime).toISOString();

          // 先读取 EXIF（归档路径依赖 EXIF 时间），异常时 exif=null，不阻断
          let exif = null;
          try {
            exif = await readKeyExif(file.path);
          } catch (e) {
            console.error(`  读取 EXIF 异常: ${file.name}`, e.message);
          }

          const relPath = this.getArchiveRelativePath(
            targetFileName,
            exif,
            mtimeIso,
            file.type,
            archiveByExif
          );

          // 4. 检查目标路径是否已存在
          const targetPath = path.join(this.basePath, relPath);

          // 兜底去重：若目标路径已存在，比对哈希判断是否为相同内容
          let isDuplicateAtTarget = false;
          if (await fileExists(targetPath)) {
            try {
              const existingHash = await computeFileHash(targetPath);
              if (existingHash === hash) {
                isDuplicateAtTarget = true;
              }
            } catch (e) {
              console.error(`  计算已存在文件哈希失败: ${targetPath}`, e.message);
            }
          }

          if (isDuplicateAtTarget) {
            results.skipped.push({
              originalPath: file.path,
              newPath: targetPath,
              name: smartNaming ? targetFileName : file.name,
              size: file.size,
              reason: 'duplicate_hash',
              hash: hash,
              existingRelPath: relPath
            });
            // 补全清单条目（若之前 hash 为 null 或不存在），后续可正常去重
            const existingEntry = await this.manifest.getEntry(relPath);
            if (!existingEntry || !existingEntry.hash) {
              await this.manifest.addEntry(relPath, {
                hash: hash,
                size: file.size,
                mtime: mtimeIso,
                exif: exif
              });
            }
          } else {
            // 5. 目标路径不存在或内容不同：自动重命名避免覆盖，再复制
            const finalTargetPath = await resolveAvailablePath(targetPath);
            const finalRelPath = path.relative(this.basePath, finalTargetPath).replace(/\\/g, '/');

            // 6. 复制文件到主仓库
            const copyResult = await copyFile(file.path, finalTargetPath);

            if (copyResult.skipped) {
              results.skipped.push({
                originalPath: file.path,
                newPath: copyResult.path,
                name: smartNaming ? targetFileName : file.name,
                size: file.size,
                reason: copyResult.reason || 'already_exists'
              });
            } else {
              // 7. 文件成功复制，记录到清单
              await this.manifest.addEntry(finalRelPath, {
                hash: hash,
                size: file.size,
                mtime: mtimeIso,
                exif: exif
              });

              results[file.type].push({
                originalPath: file.path,
                newPath: copyResult.path,
                relPath: finalRelPath,
                name: smartNaming ? targetFileName : file.name,
                size: file.size,
                hash: hash,
                exif: exif
              });
            }
          }
        }
      } catch (error) {
        results.errors.push({
          file: file.name,
          error: error.message
        });
        console.error(`  文件处理失败: ${file.name}`, error.message);
      }

      // 更新进度（processedFiles++ 在单线程下是原子的）
      processedFiles++;
      if (progressCallback) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        const avgTimePerFile = processedFiles > 0 ? elapsedTime / processedFiles : 0;
        const remainingFiles = totalFiles - processedFiles;
        const estimatedTimeRemaining = avgTimePerFile * remainingFiles;

        progressCallback({
          total: totalFiles,
          processed: processedFiles,
          remaining: remainingFiles,
          currentFile: file.name,
          estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
          percentage: Math.round((processedFiles / totalFiles) * 100)
        });
      }
    });

    // 统一保存清单
    await this.manifest.save();

    // Task 5: 双盘镜像（主导入完成后，若提供 mirrorPath，并发复制到镜像盘）
    if (mirrorPath) {
      const allImported = [
        ...results.jpg,
        ...results.raw,
        ...results.video
      ];

      await runWithConcurrency(allImported, IMPORT_CONCURRENCY, async (item) => {
        try {
          if (!item.relPath) return;
          const mirrorTarget = path.join(mirrorPath, item.relPath);
          await ensureDir(path.dirname(mirrorTarget));
          await fs.copyFile(item.newPath, mirrorTarget);
          results.mirrorSuccess.push({
            originalPath: item.originalPath,
            newPath: item.newPath,
            mirrorPath: mirrorTarget,
            relPath: item.relPath
          });
        } catch (error) {
          results.mirrorErrors.push({
            originalPath: item.originalPath,
            newPath: item.newPath,
            mirrorPath: mirrorPath,
            error: error.message
          });
          console.error(`  镜像失败: ${item.newPath}`, error.message);
        }
      });
    }

    console.log('导入完成:', {
      jpg: results.jpg.length,
      raw: results.raw.length,
      video: results.video.length,
      skipped: results.skipped.length,
      errors: results.errors.length,
      mirrorSuccess: results.mirrorSuccess.length,
      mirrorErrors: results.mirrorErrors.length
    });

    return results;
  }

  // 获取照片列表（数据来源：仓库清单，支持 EXIF 维度筛选）
  async getPhotos(category, options = {}) {
    const {
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
    } = options;

    const categoryPath = this.getCategoryPath(category);

    try {
      await fs.access(categoryPath);
    } catch {
      return { photos: [], total: 0, page, pageSize };
    }

    // 确保清单已初始化（首次访问会触发扫描并生成清单）
    await this.manifest.initFromScan();
    const allFiles = await this.manifest.getAllFiles();

    // 过滤出该分类的文件（清单 key 以 `${category}/` 开头）
    const prefix = `${category}/`;
    let photos = Object.keys(allFiles)
      .filter(relPath => relPath.startsWith(prefix))
      .map(relPath => {
        const entry = allFiles[relPath];
        const absolutePath = path.join(this.basePath, relPath);
        const name = path.basename(absolutePath);
        const ext = path.extname(name).toLowerCase();
        return {
          id: Buffer.from(absolutePath).toString('base64'),
          name: name,
          filename: getFileNameWithoutExt(name),
          path: absolutePath,
          relativePath: relPath,
          type: category,
          extension: ext,
          size: entry.size,
          modifiedTime: entry.mtime,
          thumbnailUrl: `/api/photos/thumbnail?path=${encodeURIComponent(absolutePath)}`,  // 缩略图
          url: `/api/photos/preview?path=${encodeURIComponent(absolutePath)}&repo=${repoId || ''}`,  // 原图
          exif: entry.exif  // 字段：取自清单条目，可能为 null
        };
      });

    // Task 6: EXIF 维度过滤
    photos = photos.filter(photo => this._matchFilters(photo, {
      dateFrom, dateTo, cameraModel, lensModel,
      focalMin, focalMax, fNumberMin, fNumberMax,
      isoMin, isoMax, fileName
    }));

    // 排序（保留原有逻辑：name/size/modifiedTime，asc/desc）
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

  // 判断单张照片是否匹配所有筛选条件（未指定的参数视为不限制）
  // 若指定了某个 EXIF 维度但 exif=null，该照片不匹配（排除）
  _matchFilters(photo, filters) {
    const {
      dateFrom, dateTo, cameraModel, lensModel,
      focalMin, focalMax, fNumberMin, fNumberMax,
      isoMin, isoMax, fileName
    } = filters;

    // 文件名关键字（不区分大小写）
    if (fileName) {
      if (!photo.name || !photo.name.toLowerCase().includes(String(fileName).toLowerCase())) {
        return false;
      }
    }

    // 日期范围：优先用 exif.dateTimeOriginal，回退到 mtime
    if (dateFrom || dateTo) {
      const dateStr = (photo.exif && photo.exif.dateTimeOriginal) || photo.modifiedTime;
      if (!dateStr) return false;
      // exif.dateTimeOriginal 格式 "2024:03:15 14:30:00"，替换冒号以便 Date 解析
      const normalized = String(dateStr).replace(/^(\d{4}):(\d{2}):/, '$1-$2-');
      const date = new Date(normalized);
      if (isNaN(date.getTime())) return false;
      if (dateFrom && date < new Date(dateFrom)) return false;
      if (dateTo && date > new Date(dateTo)) return false;
    }

    // 相机型号
    if (cameraModel) {
      if (!photo.exif || photo.exif.model !== cameraModel) return false;
    }

    // 镜头型号
    if (lensModel) {
      if (!photo.exif || photo.exif.lensModel !== lensModel) return false;
    }

    // 焦距范围
    if (focalMin != null || focalMax != null) {
      if (!photo.exif || photo.exif.focalLength == null) return false;
      const fl = photo.exif.focalLength;
      if (focalMin != null && fl < Number(focalMin)) return false;
      if (focalMax != null && fl > Number(focalMax)) return false;
    }

    // 光圈范围
    if (fNumberMin != null || fNumberMax != null) {
      if (!photo.exif || photo.exif.fNumber == null) return false;
      const fn = photo.exif.fNumber;
      if (fNumberMin != null && fn < Number(fNumberMin)) return false;
      if (fNumberMax != null && fn > Number(fNumberMax)) return false;
    }

    // ISO 范围
    if (isoMin != null || isoMax != null) {
      if (!photo.exif || photo.exif.iso == null) return false;
      const iso = photo.exif.iso;
      if (isoMin != null && iso < Number(isoMin)) return false;
      if (isoMax != null && iso > Number(isoMax)) return false;
    }

    return true;
  }

  // 获取筛选选项：返回该分类下所有相机型号与镜头型号（去重，过滤 null）
  async getFilterOptions(category) {
    await this.manifest.initFromScan();
    const allFiles = await this.manifest.getAllFiles();
    const prefix = `${category}/`;

    const cameraSet = new Set();
    const lensSet = new Set();

    for (const relPath of Object.keys(allFiles)) {
      if (!relPath.startsWith(prefix)) continue;
      const entry = allFiles[relPath];
      if (entry && entry.exif) {
        if (entry.exif.model) cameraSet.add(entry.exif.model);
        if (entry.exif.lensModel) lensSet.add(entry.exif.lensModel);
      }
    }

    return {
      cameraModels: Array.from(cameraSet),
      lensModels: Array.from(lensSet)
    };
  }

  // 完整性校验：检查清单中的文件是否真实存在且哈希匹配，并找出文件系统中未被清单追踪的文件
  // 返回 { missing: [...], corrupted: [...], untracked: [...] }，每项含 { relPath, path, reason }
  async verifyIntegrity() {
    const missing = [];
    const corrupted = [];
    const untracked = [];

    // 确保清单存在
    await this.manifest.initFromScan();
    const allFiles = await this.manifest.getAllFiles();

    // 1. 遍历清单，检查每个文件的存在性与哈希
    for (const relPath of Object.keys(allFiles)) {
      const entry = allFiles[relPath];
      const absPath = path.join(this.basePath, relPath);

      if (!await fileExists(absPath)) {
        missing.push({
          relPath: relPath,
          path: absPath,
          reason: 'file_missing'
        });
        continue;
      }

      // 清单中 hash=null 的旧文件只检查存在性，跳过哈希校验
      if (entry && entry.hash) {
        try {
          const currentHash = await computeFileHash(absPath);
          if (currentHash !== entry.hash) {
            corrupted.push({
              relPath: relPath,
              path: absPath,
              reason: 'hash_mismatch',
              expected: entry.hash,
              actual: currentHash
            });
          }
        } catch (error) {
          corrupted.push({
            relPath: relPath,
            path: absPath,
            reason: 'hash_compute_failed',
            error: error.message
          });
        }
      }
    }

    // 2. 扫描文件系统 jpg/raw/video 目录，找出不在清单中的文件
    const categories = ['jpg', 'raw', 'video'];
    for (const category of categories) {
      const categoryPath = this.getCategoryPath(category);
      let files = [];
      try {
        files = await scanDirectory(categoryPath);
      } catch (error) {
        // 目录不存在等，跳过
        continue;
      }

      for (const file of files) {
        const relPath = path.relative(this.basePath, file.path).replace(/\\/g, '/');
        if (!Object.prototype.hasOwnProperty.call(allFiles, relPath)) {
          untracked.push({
            relPath: relPath,
            path: file.path,
            reason: 'not_in_manifest'
          });
        }
      }
    }

    return { missing, corrupted, untracked };
  }

  // 对比文件系统与清单，返回差异（保留空壳方法以兼容旧调用）
  async reconcileManifest() {
    return this.verifyIntegrity();
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

  // 批量刷新已有文件的 EXIF：遍历清单中缺少有效 EXIF 的文件，重新读取并更新清单
  // options: { category = null } 限制只刷新某个分类；返回 { processed, success, failed, alreadyHasExif, noExifFound, sampleExif, firstError }
  async refreshExif(options = {}) {
    const { category = null } = options;
    await this.manifest.initFromScan();
    const allFiles = await this.manifest.getAllFiles();

    const results = {
      processed: 0,
      success: 0,
      failed: 0,
      alreadyHasExif: 0,  // 已有有效 EXIF，无需刷新
      noExifFound: 0,     // 读取后仍无有效 EXIF
      sampleExif: null,
      firstError: null
    };

    const relPaths = Object.keys(allFiles);
    for (const relPath of relPaths) {
      // 若指定了分类，只处理该分类
      if (category) {
        const prefix = `${category}/`;
        if (!relPath.startsWith(prefix)) continue;
      }

      const entry = allFiles[relPath];
      // 已存在有效 EXIF（至少 model 或 dateTimeOriginal 有值）的跳过
      if (entry && entry.exif && (entry.exif.model || entry.exif.dateTimeOriginal)) {
        results.alreadyHasExif++;
        continue;
      }

      const absPath = path.join(this.basePath, relPath);
      if (!await fileExists(absPath)) {
        results.failed++;
        if (!results.firstError) results.firstError = `${relPath}: 文件不存在`;
        continue;
      }

      results.processed++;
      try {
        const exif = await readKeyExif(absPath);
        if (exif && (exif.model || exif.dateTimeOriginal)) {
          await this.manifest.addEntry(relPath, {
            hash: entry.hash,
            size: entry.size,
            mtime: entry.mtime,
            exif
          });
          results.success++;
          if (!results.sampleExif) results.sampleExif = exif;
        } else {
          // 读取成功但没有关键字段，标记为已处理（exif 为空对象也存进去，避免反复读取）
          await this.manifest.addEntry(relPath, {
            hash: entry.hash,
            size: entry.size,
            mtime: entry.mtime,
            exif: exif || {}
          });
          results.noExifFound++;
        }
      } catch (error) {
        console.error(`刷新 EXIF 失败: ${absPath}`, error.message);
        results.failed++;
        if (!results.firstError) results.firstError = `${relPath}: ${error.message}`;
      }
    }

    if (results.processed > 0) {
      await this.manifest.save();
    }

    return results;
  }

  // 重建清单：删除旧清单→重新扫描全部文件→并发读取 EXIF→写入新清单
  // 用于修复路径失效、EXIF 缺失等问题
  async rebuildManifest() {
    // 1. 删除旧清单
    await this.manifest.deleteManifest();

    // 2. 重新扫描所有分类目录
    const categories = ['jpg', 'raw', 'video'];
    const allScannedFiles = [];
    for (const category of categories) {
      const categoryPath = this.getCategoryPath(category);
      let files = [];
      try {
        files = await scanDirectory(categoryPath);
      } catch (error) {
        console.error(`扫描分类目录失败: ${categoryPath}`, error.message);
        continue;
      }
      for (const file of files) {
        const relPath = this.manifest._normalizeRelPath(path.relative(this.basePath, file.path));
        allScannedFiles.push({ relPath, file, category });
      }
    }

    // 3. 并发写入清单条目，同时读取 EXIF（仅 jpg/raw）
    const EXIF_CONCURRENCY = 6;
    let exifSuccess = 0;
    let exifFailed = 0;
    await runWithConcurrency(allScannedFiles, EXIF_CONCURRENCY, async ({ relPath, file, category }) => {
      let exif = null;
      if (category === 'jpg' || category === 'raw') {
        try {
          exif = await readKeyExif(file.path);
          if (exif && (exif.model || exif.dateTimeOriginal)) {
            exifSuccess++;
          } else {
            exif = exif || {};
          }
        } catch (e) {
          exifFailed++;
        }
      }
      await this.manifest.addEntry(relPath, {
        hash: null,
        size: file.size,
        mtime: new Date(file.modifiedTime).toISOString(),
        exif: exif
      });
    });

    // 4. 保存清单
    await this.manifest.save();

    // 5. 清空文件扫描缓存
    this.invalidateScanCache();

    return {
      totalFiles: allScannedFiles.length,
      exifSuccess,
      exifFailed
    };
  }
}

module.exports = FileService;
