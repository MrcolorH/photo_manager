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
    api.post('/photos/batch-export', { fileIds, targetPath, repoId })
};

// 导入相关API
export const importApi = {
  // 从存储卡导入
  importFromCard: (sourcePath, repoId) => api.post('/import', { sourcePath, repoId }),
  
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
