import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

// 照片相关API
export const photoApi = {
  // 获取照片列表
  getPhotos: (category, params) => api.get('/photos', { params: { category, ...params } }),

  // 获取存储信息
  getStorageInfo: (repoId) => api.get('/photos/storage-info', { params: { repoId } }),

  // 获取孤立的RAW文件
  getOrphanRaws: (repoId) => api.get('/photos/orphan-raws', { params: { repoId } }),

  // 删除照片
  deletePhoto: (id, syncRaw = true, repoId) => api.delete(`/photos/${id}`, { params: { syncRaw, repoId } }),

  // 批量删除RAW文件
  batchDeleteRaws: (fileIds, repoId) => api.post('/photos/batch-delete-raws', { fileIds, repoId }),

  // 预览图片
  getPreviewUrl: (id) => `/uploads/photos/${id}/preview`,

  // 打开文件位置
  openLocation: (filePath, mode) => api.post('/photos/open-location', { filePath, mode }),

  // 批量导出照片
  batchExport: (fileIds, targetPath, repoId) =>
    api.post('/photos/batch-export', { fileIds, targetPath, repoId }),

  // 获取高级筛选项（相机/镜头列表）
  getFilterOptions: (repoId, category) =>
    api.get('/photos/filter-options', { params: { repoId, category } }),

  // 获取完整 EXIF 信息
  getFullExif: (photoId) => api.get(`/photos/${photoId}/exif`),

  // 校验仓库完整性；autoCleanup=true 时自动从清单移除缺失条目
  verifyIntegrity: (repoId, autoCleanup = false) =>
    api.post('/photos/verify-integrity', { repoId, autoCleanup }),

  // 批量刷新已有文件的 EXIF（补录旧版导入缺失的 EXIF）
  refreshExif: (repoId, category = 'jpg') =>
    api.post('/photos/refresh-exif', { repoId, category }),

  // 重建清单：删除旧清单→重新扫描→读取 EXIF
  rebuildManifest: (repoId) =>
    api.post('/photos/rebuild-manifest', { repoId })
};

// 设置相关API
export const settingsApi = {
  // 获取主题偏好
  getTheme: () => api.get('/settings/theme'),

  // 更新主题偏好
  setTheme: (theme) => api.post('/settings/theme', { theme })
};

// 导入相关API
export const importApi = {
  // 创建导入任务（POST），返回 taskId
  // 导入在后台异步执行，前端通过 streamTaskProgress 订阅进度
  createTask: (sourcePath, repoId, smartNaming = false, archiveByExif = false, mirrorPath = null) =>
    api.post('/import', {
      sourcePath,
      repoId: repoId || undefined,
      smartNaming,
      archiveByExif,
      mirrorPath: mirrorPath || undefined
    }),

  // 获取当前活跃任务（running / paused / pending）
  getActiveTask: () => api.get('/import/active'),

  // 获取任务详情
  getTask: (taskId) => api.get(`/import/${taskId}`),

  // SSE 订阅任务进度（返回 EventSource 实例，调用方自行管理生命周期）
  // 通过 onMessage 回调接收消息：{ type: 'progress'|'complete'|'cancelled'|'error', data }
  streamTaskProgress: (taskId, { onMessage, onError } = {}) => {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/api/import/${taskId}/stream`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data, eventSource);
        // 终态消息由调用方负责关闭连接；这里也兜底关闭
        if (['complete', 'cancelled', 'error'].includes(data.type)) {
          // 调用方应在 onMessage 中处理，这里不强制关闭
        }
      } catch (err) {
        console.error('解析 SSE 数据失败:', err);
        if (onError) onError(err, eventSource);
      }
    };

    eventSource.onerror = (err) => {
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      // CLOSED 状态说明连接已彻底断开；CONNECTING 是浏览器自动重连，不需要 reject
      if (eventSource.readyState === EventSource.CLOSED) {
        if (onError) onError(new Error('SSE 连接已关闭'), eventSource);
      }
    };

    return eventSource;
  },

  // 暂停任务
  pauseTask: (taskId) => api.post(`/import/${taskId}/pause`),

  // 恢复任务
  resumeTask: (taskId) => api.post(`/import/${taskId}/resume`),

  // 取消任务
  cancelTask: (taskId) => api.post(`/import/${taskId}/cancel`),

  // 清理已结束的任务记录（允许新建下一个任务）
  clearTask: (taskId) => api.delete(`/import/${taskId}`),

  // 获取默认导入路径
  getDefaultPath: () => api.get('/import/default-path'),

  // 获取所有存储仓库
  getRepos: () => api.get('/import/repos'),

  // 添加存储仓库
  addRepo: (data) => api.post('/import/repos', data),

  // 删除存储仓库
  deleteRepo: (id) => api.delete(`/import/repos/${id}`),

  // 设置默认仓库
  setDefaultRepo: (id) => api.put(`/import/repos/${id}/default`),

  // 打开文件夹选择对话框
  selectFolder: () => api.get('/import/select-folder')
};

// 追光功能 API
export const lightHuntApi = {
  // 内置城市表
  getBuiltinCities: () => api.get('/light-hunt/builtin'),

  // 收藏夹 + 内置城市
  getCities: () => api.get('/light-hunt/cities'),

  // 添加收藏城市
  addCity: (name, lat, lon, priority = false) =>
    api.post('/light-hunt/cities', { name, lat, lon, priority }),

  // 删除收藏城市
  removeCity: (id) => api.delete(`/light-hunt/cities/${encodeURIComponent(id)}`),

  // 设置重点城市
  setPriority: (id, priority) =>
    api.put(`/light-hunt/cities/${encodeURIComponent(id)}/priority`, { priority }),

  // 综合预测（首屏主用）：朝霞/晚霞/雷暴/夜间云量
  getForecast: (cityId, days = 7) =>
    api.get(`/light-hunt/forecast/${encodeURIComponent(cityId)}`, { params: { days } }),

  // 临时经纬度查询（"今日追光"临时地点）
  getForecastByCoord: (lat, lon, days = 7) =>
    api.get('/light-hunt/forecast-by-coord', { params: { lat, lon, days } }),

  // 单独雷暴
  getThunderstorm: (cityId, days = 7) =>
    api.get(`/light-hunt/thunderstorm/${encodeURIComponent(cityId)}`, { params: { days } }),

  // 单独朝霞/晚霞
  getSunriseSunset: (cityId, days = 7) =>
    api.get(`/light-hunt/sunrise-sunset/${encodeURIComponent(cityId)}`, { params: { days } }),
};

export default api;
