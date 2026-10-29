const path = require('path');
const FileService = require('./fileService');

class FileServicePool {
  constructor() {
    this.pool = new Map(); // normalized repoPath -> FileService instance
  }

  // 获取或创建对应仓库路径的 FileService 单例
  get(repoPath) {
    if (!repoPath) return null;
    const normalized = path.resolve(repoPath);
    if (!this.pool.has(normalized)) {
      this.pool.set(normalized, new FileService(normalized));
    }
    return this.pool.get(normalized);
  }

  // 使特定仓库或所有仓库的内存缓存失效
  invalidate(repoPath) {
    if (repoPath) {
      const normalized = path.resolve(repoPath);
      const service = this.pool.get(normalized);
      if (service) {
        service.invalidateCache();
      }
    } else {
      for (const service of this.pool.values()) {
        service.invalidateCache();
      }
    }
  }

  // 仓库删除或路径变更时，从池中清理
  remove(repoPath) {
    if (repoPath) {
      const normalized = path.resolve(repoPath);
      const service = this.pool.get(normalized);
      if (service) {
        service.invalidateCache();
        this.pool.delete(normalized);
      }
    }
  }
}

const fileServicePool = new FileServicePool();
module.exports = fileServicePool;
