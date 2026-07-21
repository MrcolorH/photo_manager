const fs = require('fs').promises;
const path = require('path');
const { scanDirectory, ensureDir } = require('../utils/fileUtils');

// 仓库清单服务：为每个仓库维护 repo/.shiguang/manifest.json，
// 作为后续哈希去重、EXIF 筛选、归档的统一数据源
class ManifestService {
  constructor(basePath) {
    this.basePath = basePath;
    // 清单文件路径：仓库根目录下的 .shiguang/manifest.json
    this.manifestPath = path.join(basePath, '.shiguang', 'manifest.json');
    // 实例级内存缓存
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = 30000; // 30 秒内存缓存
  }

  // 将相对路径统一转为 forward slash（Windows 上 path.relative 返回 backslash）
  _normalizeRelPath(relPath) {
    return relPath.replace(/\\/g, '/');
  }

  // 读取清单文件；带 30s 内存缓存；文件不存在返回空清单结构
  async load() {
    // 命中缓存直接返回
    if (this._cache && Date.now() - this._cacheTime < this._cacheTTL) {
      return this._cache;
    }

    let raw;
    try {
      raw = await fs.readFile(this.manifestPath, 'utf8');
    } catch (error) {
      // 文件不存在或不可读，返回空清单结构
      const empty = { version: 1, lastUpdated: null, files: {} };
      this._cache = empty;
      this._cacheTime = Date.now();
      return empty;
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      console.error('清单 JSON 解析失败，重置为空清单:', error.message);
      manifest = { version: 1, lastUpdated: null, files: {} };
    }

    // 兜底字段保护
    if (!manifest.files || typeof manifest.files !== 'object') {
      manifest.files = {};
    }
    if (typeof manifest.version !== 'number') {
      manifest.version = 1;
    }

    this._cache = manifest;
    this._cacheTime = Date.now();
    return manifest;
  }

  // 写入清单文件：先 ensureDir .shiguang 目录，更新 lastUpdated 为当前 ISO 时间，清空内存缓存
  async save() {
    if (!this._cache) {
      // 内存中无清单，先加载一次保证有数据可写
      await this.load();
    }
    const manifest = this._cache;
    manifest.lastUpdated = new Date().toISOString();

    // 确保 .shiguang 目录存在
    await ensureDir(path.dirname(this.manifestPath));
    await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // 清空缓存，下次 load 会重新读盘
    this._cache = null;
    this._cacheTime = 0;
  }

  // 返回该相对路径的条目，不存在返回 undefined
  async getEntry(relPath) {
    const key = this._normalizeRelPath(relPath);
    const manifest = await this.load();
    return manifest.files[key];
  }

  // 新增/更新条目；data 含 { hash, size, mtime, exif }
  async addEntry(relPath, data) {
    const key = this._normalizeRelPath(relPath);
    const manifest = await this.load();
    manifest.files[key] = {
      hash: data.hash,
      size: data.size,
      mtime: data.mtime,
      exif: data.exif
    };
    return manifest.files[key];
  }

  // 删除条目
  async removeEntry(relPath) {
    const key = this._normalizeRelPath(relPath);
    const manifest = await this.load();
    if (Object.prototype.hasOwnProperty.call(manifest.files, key)) {
      delete manifest.files[key];
      return true;
    }
    return false;
  }

  // 按 hash 查找第一个匹配条目，返回 { relPath, ...entry } 或 null
  async findByHash(hash) {
    const manifest = await this.load();
    const files = manifest.files;
    for (const relPath of Object.keys(files)) {
      const entry = files[relPath];
      if (entry && entry.hash === hash) {
        return { relPath, ...entry };
      }
    }
    return null;
  }

  // 初始化清单：若清单文件已存在且 files 非空直接返回；否则扫描仓库 jpg/raw/video 三个子目录，
  // 为每个文件生成条目 { hash: null, exif: null, size, mtime }，写入清单并 save
  async initFromScan() {
    const existing = await this.load();
    if (existing.files && Object.keys(existing.files).length > 0) {
      return existing;
    }

    // 扫描三个分类目录
    const categories = ['jpg', 'raw', 'video'];
    for (const category of categories) {
      const categoryPath = path.join(this.basePath, category);
      let files = [];
      try {
        files = await scanDirectory(categoryPath);
      } catch (error) {
        // scanDirectory 内部已捕获错误并返回空数组，这里兜底
        console.error(`扫描分类目录失败: ${categoryPath}`, error.message);
        continue;
      }

      for (const file of files) {
        // scanDirectory 返回的 file.path 是绝对路径，需转成相对 basePath 的 forward-slash 路径作为 key
        const relPath = this._normalizeRelPath(path.relative(this.basePath, file.path));
        await this.addEntry(relPath, {
          hash: null,
          size: file.size,
          mtime: new Date(file.modifiedTime).toISOString(),
          exif: null
        });
      }
    }

    await this.save();
    return await this.load();
  }

  // 返回 files 对象（供 getPhotos 使用）
  async getAllFiles() {
    const manifest = await this.load();
    return manifest.files;
  }

  // 清空内存缓存
  invalidateCache() {
    this._cache = null;
    this._cacheTime = 0;
  }
}

module.exports = ManifestService;
