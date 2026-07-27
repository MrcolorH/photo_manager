const fs = require('fs').promises;
const path = require('path');
const { ensureDir } = require('../utils/fileUtils');

// 取消错误：任务被取消时抛出，便于上层 try/catch 区分
class CancelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CancelError';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 任务管理器（单例）
// - 内存维护当前任务，单任务约束（同时只允许一个活跃任务）
// - 任务详情持久化到 repo/.shiguang/tasks.json（随仓库走）
// - 全局活跃任务指针持久化到 .runtime/current_task.json
// - 启动时 loadAndRecover：把上次未完成的 running 任务降级为 paused，等待用户恢复
//
// .runtime 目录选择策略：
// - 打包后（ELECTRON_STANDALONE=true）：使用 Electron 的 userData 目录（用户可写）
//   - Windows: %APPDATA%/拾光舱/.runtime
//   - macOS: ~/Library/Application Support/拾光舱/.runtime  （.app 包内只读，必须用 userData）
// - 开发模式：使用 backend/.runtime
class TaskManager {
  constructor() {
    this.tasks = new Map();          // taskId -> task
    this.controllers = new Map();    // taskId -> AbortController
    this.currentTaskId = null;       // 单任务约束
    this.currentRepoPath = null;     // 当前任务所在仓库（用于恢复时定位 tasks.json）
    // 打包后用 Electron 提供的可写目录；开发时用 backend/.runtime
    const runtimeBase = process.env.ELECTRON_USER_DATA
      || path.join(__dirname, '..', '..');
    this.runtimeDir = path.join(runtimeBase, '.runtime');
    this.runtimeFilePath = path.join(this.runtimeDir, 'current_task.json');
    this.persistTimers = new Map();  // taskId -> setTimeout 句柄（节流写盘）
  }

  // 创建任务（不启动执行），返回 taskId
  // params: { sourcePath, repoId, repoPath, repoName, smartNaming, archiveByExif, mirrorPath }
  async create(params) {
    if (this.getActive()) {
      throw new Error('已有进行中的任务，请先完成或取消当前任务');
    }
    const taskId = generateId();
    const now = new Date().toISOString();
    const task = {
      taskId,
      status: 'pending',          // pending | running | paused | completed | cancelled | failed
      phase: 'pending',            // pending | scan | import | mirror | done | error
      params,
      progress: { total: 0, processed: 0, remaining: 0, currentFile: '', estimatedTimeRemaining: 0, percentage: 0 },
      mirrorProgress: { total: 0, processed: 0, currentFile: '', percentage: 0 },
      stats: null,                 // 完成后的结果统计
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      processedHashes: []          // 本次任务已处理的文件 hash（恢复时直接跳过，无需重新计算）
    };
    this.tasks.set(taskId, task);
    this.currentTaskId = taskId;
    this.currentRepoPath = params.repoPath;
    await this._persistGlobal();
    await this._persistTask(taskId);
    return taskId;
  }

  // 启动任务执行，runFn 接收 ctx：{ signal, waitIfPaused, isCancelled, updateProgress, updateMirrorProgress, recordProcessedHash, wasProcessed }
  async start(taskId, runFn) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('任务不存在');

    const controller = new AbortController();
    this.controllers.set(taskId, controller);

    task.status = 'running';
    task.startedAt = task.startedAt || new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    await this._persistTask(taskId);

    const ctx = this._createContext(taskId);

    try {
      const result = await runFn(ctx);
      task.status = 'completed';
      task.phase = 'done';
      task.progress.percentage = 100;
      task.stats = result;
      task.completedAt = new Date().toISOString();
    } catch (err) {
      if (err.name === 'CancelError' || controller.signal.aborted) {
        task.status = 'cancelled';
      } else {
        task.status = 'failed';
        task.error = err.message;
        task.phase = 'error';
      }
    } finally {
      task.updatedAt = new Date().toISOString();
      this.controllers.delete(taskId);
      // 强制刷新一次磁盘状态（取消待节流的写入）
      if (this.persistTimers.has(taskId)) {
        clearTimeout(this.persistTimers.get(taskId));
        this.persistTimers.delete(taskId);
      }
      await this._persistTask(taskId);
    }
  }

  async pause(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'running') {
      throw new Error(`无法暂停状态为 ${task.status} 的任务`);
    }
    task.status = 'paused';
    task.updatedAt = new Date().toISOString();
    await this._persistTask(taskId);
  }

  async resume(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'paused') {
      throw new Error(`无法恢复状态为 ${task.status} 的任务`);
    }
    task.status = 'running';
    task.updatedAt = new Date().toISOString();
    await this._persistTask(taskId);
    // 恢复靠 _waitIfPaused 循环自动跳出，无需重启 runFn
  }

  async cancel(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('任务不存在');
    if (['completed', 'cancelled', 'failed'].includes(task.status)) {
      throw new Error('任务已结束，无法取消');
    }
    const controller = this.controllers.get(taskId);
    if (controller) {
      controller.abort({ type: 'cancel' });
    }
    task.status = 'cancelled';
    task.updatedAt = new Date().toISOString();
    await this._persistTask(taskId);
  }

  // 清理已结束的任务记录，允许新建下一个任务
  async clear(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (['running', 'paused', 'pending'].includes(task.status)) {
      throw new Error('任务尚未结束，无法清理');
    }
    this.tasks.delete(taskId);
    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
      this.currentRepoPath = null;
      await this._persistGlobal();
    }
  }

  get(taskId) {
    return this.tasks.get(taskId);
  }

  // 返回当前活跃任务（running/paused/pending），无则 null
  getActive() {
    if (!this.currentTaskId) return null;
    const task = this.tasks.get(this.currentTaskId);
    if (!task) return null;
    if (['running', 'paused', 'pending'].includes(task.status)) {
      return task;
    }
    return null;
  }

  // 构建任务上下文（注入到 runFn 中使用）
  _createContext(taskId) {
    const self = this;
    return {
      signal: self.controllers.get(taskId)?.signal,
      waitIfPaused: async () => {
        await self._waitIfPaused(taskId);
      },
      isCancelled: () => {
        const controller = self.controllers.get(taskId);
        if (controller && controller.signal.aborted) return true;
        const t = self.tasks.get(taskId);
        return t && t.status === 'cancelled';
      },
      updateProgress: (progress) => self._update(taskId, { progress, phase: 'import' }),
      updateMirrorProgress: (mirrorProgress) => self._update(taskId, { mirrorProgress, phase: 'mirror' }),
      recordProcessedHash: (hash) => self._update(taskId, { processedHash: hash }),
      wasProcessed: (hash) => {
        const t = self.tasks.get(taskId);
        return t && t.processedHashes && t.processedHashes.includes(hash);
      }
    };
  }

  async _update(taskId, patch) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (patch.phase) task.phase = patch.phase;
    if (patch.progress) task.progress = { ...task.progress, ...patch.progress };
    if (patch.mirrorProgress) task.mirrorProgress = { ...task.mirrorProgress, ...patch.mirrorProgress };
    if (patch.processedHash) {
      task.processedHashes.push(patch.processedHash);
    }
    task.updatedAt = new Date().toISOString();
    this._schedulePersist(taskId);
  }

  // 节流持久化：500ms 内多次更新合并为一次写盘
  _schedulePersist(taskId) {
    if (this.persistTimers.has(taskId)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(taskId);
      this._persistTask(taskId).catch(err => console.error('Persist task failed:', err));
    }, 500);
    this.persistTimers.set(taskId, timer);
  }

  async _persistTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const repoPath = task.params && task.params.repoPath;
    if (!repoPath) return;
    const dir = path.join(repoPath, '.shiguang');
    const filePath = path.join(dir, 'tasks.json');
    await ensureDir(dir);
    await fs.writeFile(filePath, JSON.stringify(task, null, 2), 'utf8');
  }

  async _persistGlobal() {
    await ensureDir(this.runtimeDir);
    const data = {
      currentTaskId: this.currentTaskId,
      currentRepoPath: this.currentRepoPath,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(this.runtimeFilePath, JSON.stringify(data, null, 2), 'utf8');
  }

  // 协作式暂停：被 pause 时循环 sleep，直到 status 变回 running 或被取消
  async _waitIfPaused(taskId) {
    while (true) {
      const task = this.tasks.get(taskId);
      if (!task) throw new CancelError('任务已消失');
      if (task.status === 'cancelled') throw new CancelError('任务已取消');
      if (task.status === 'failed') throw new Error('任务已失败');
      if (task.status === 'paused') {
        await sleep(500);
        continue;
      }
      return;
    }
  }

  // 应用启动时恢复：把上次未完成的 running 任务降级为 paused
  async loadAndRecover() {
    let globalData;
    try {
      const raw = await fs.readFile(this.runtimeFilePath, 'utf8');
      globalData = JSON.parse(raw);
    } catch {
      return;
    }
    if (!globalData || !globalData.currentTaskId || !globalData.currentRepoPath) {
      return;
    }

    const taskFilePath = path.join(globalData.currentRepoPath, '.shiguang', 'tasks.json');
    let task;
    try {
      const raw = await fs.readFile(taskFilePath, 'utf8');
      task = JSON.parse(raw);
    } catch (err) {
      console.warn('[TaskManager] 任务文件读取失败，清理全局指针:', err.message);
      await this._clearGlobal();
      return;
    }

    if (!task || !task.taskId) {
      console.warn('[TaskManager] 任务文件格式无效，清理全局指针');
      await this._clearGlobal();
      return;
    }

    // running 视为 paused（应用重启视为暂停，等待用户手动恢复）
    if (task.status === 'running') {
      task.status = 'paused';
      task.updatedAt = new Date().toISOString();
    }
    // pending 同样视为 paused
    if (task.status === 'pending') {
      task.status = 'paused';
      task.updatedAt = new Date().toISOString();
    }

    this.tasks.set(task.taskId, task);
    this.currentTaskId = task.taskId;
    this.currentRepoPath = globalData.currentRepoPath;

    await this._persistTask(task.taskId);
    console.log(`[TaskManager] 已恢复任务 ${task.taskId}，状态: ${task.status}`);
  }

  async _clearGlobal() {
    this.currentTaskId = null;
    this.currentRepoPath = null;
    try {
      await fs.unlink(this.runtimeFilePath);
    } catch {
      // 文件不存在也没关系
    }
  }
}

module.exports = new TaskManager();
module.exports.CancelError = CancelError;
