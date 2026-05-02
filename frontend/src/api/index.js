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
  deletePhoto: (id, syncRaw = true, repoId) => api.delete('/photos', { params: { id, syncRaw, repoId } }),
  
  // 批量删除RAW文件
  batchDeleteRaws: (fileIds, repoId) => api.post('/photos/batch-delete-raws', { fileIds, repoId }),
  
  // 预览图片
  getPreviewUrl: (id) => `/uploads/photos/${id}/preview`,
  
  // 打开文件位置
  openLocation: (filePath, mode) => api.post('/photos/open-location', { filePath, mode }),
  
  // 批量导出照片
  batchExport: (fileIds, targetPath, repoId) => 
    api.post('/photos/batch-export', { fileIds, targetPath, repoId })
};

// 导入相关API
export const importApi = {
  // 从存储卡导入（使用 EventSource 进行实时进度跟踪）
  importFromCard: (sourcePath, repoId, autoRename = false) => {
    return new Promise((resolve, reject) => {
      // 构建完整的 URL
      const baseUrl = window.location.origin;
      const url = `${baseUrl}/api/import?sourcePath=${encodeURIComponent(sourcePath)}&repoId=${repoId || ''}&autoRename=${autoRename}`;
      
      console.log('开始 SSE 连接:', url);
      
      // 创建 EventSource 连接
      const eventSource = new EventSource(url);
      
      let progressData = null;
      let completeData = null;
      let hasError = false;
      
      // 监听打开事件
      eventSource.onopen = () => {
        console.log('SSE 连接已建立');
      };
      
      // 监听进度事件
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('收到 SSE 消息:', data.type);
          
          if (data.type === 'progress') {
            progressData = data.data;
            // 调用进度回调（如果有的话）
            if (importApi._progressCallback) {
              importApi._progressCallback(progressData);
            }
          } else if (data.type === 'complete') {
            completeData = data.data;
            console.log('导入完成');
            eventSource.close();
            resolve({ data: { success: true, data: completeData } });
          } else if (data.type === 'error') {
            console.error('导入错误:', data.error);
            hasError = true;
            eventSource.close();
            reject(new Error(data.error));
          }
        } catch (error) {
          console.error('解析 SSE 数据失败:', error);
        }
      };
      
      // 监听错误事件
      eventSource.onerror = (error) => {
        console.error('SSE 连接错误:', error);
        console.error('EventSource readyState:', eventSource.readyState);
        
        // 如果已经收到完成或错误消息，忽略此错误
        if (hasError || completeData) {
          return;
        }
        
        // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
        if (eventSource.readyState === EventSource.CLOSED) {
          console.log('SSE 连接已关闭');
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          console.log('SSE 正在重连...');
          // 不要立即拒绝，让 EventSource 尝试重连
          return;
        } else {
          console.log('SSE 连接中断');
          eventSource.close();
          if (!hasError && !completeData) {
            reject(new Error('连接中断'));
          }
        }
      };
      
      // 5分钟超时
      const timeoutId = setTimeout(() => {
        console.log('导入超时');
        eventSource.close();
        if (!completeData && !hasError) {
          reject(new Error('导入超时（5分钟）'));
        }
      }, 300000);
      
      // 清理函数
      const cleanup = () => {
        clearTimeout(timeoutId);
      };
      
      // 在 resolve 和 reject 时清理超时
      const originalResolve = resolve;
      const originalReject = reject;
      
      resolve = (value) => {
        cleanup();
        originalResolve(value);
      };
      
      reject = (reason) => {
        cleanup();
        originalReject(reason);
      };
    });
  },
  
  // 设置进度回调
  setProgressCallback: (callback) => {
    importApi._progressCallback = callback;
  },
  
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

export default api;
