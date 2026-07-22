const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const photoRoutes = require('./routes/photoRoutes');
const importRoutes = require('./routes/importRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

const app = express();
const PORT = process.env.PORT || 3001;
const isStandalone = process.env.STANDALONE === 'true';
const isElectronStandalone = process.env.ELECTRON_STANDALONE === 'true';

// 中间件
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 存储仓库配置文件路径
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const REPOS_CONFIG_PATH_LOCAL = path.join(CONFIG_DIR, 'repos.json');

// 读取存储仓库列表
function getRepos() {
  try {
    const data = fs.readFileSync(REPOS_CONFIG_PATH_LOCAL, 'utf8');
    return JSON.parse(data);
  } catch {
    const defaultRepo = {
      id: 'default',
      name: '默认仓库',
      path: process.env.PHOTO_BASE_PATH || getDefaultPhotoPath(),
      isDefault: true
    };
    return [defaultRepo];
  }
}

function getDefaultPhotoPath() {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(require('os').homedir(), 'Pictures', 'CameraPhotos');
  }
  return '/Users/colorh/Pictures/相机照片';
}

// 动态静态文件服务 - 根据 repo 参数提供不同仓库的文件
app.use('/uploads', (req, res, next) => {
  const repoId = req.query.repo;
  const repos = getRepos();
  
  let targetPath;
  if (repoId) {
    const repo = repos.find(r => r.id === repoId);
    targetPath = repo ? repo.path : (process.env.PHOTO_BASE_PATH || '/Users/colorh/Pictures/相机照片');
  } else {
    // 默认使用默认仓库
    const defaultRepo = repos.find(r => r.isDefault);
    targetPath = defaultRepo ? defaultRepo.path : (process.env.PHOTO_BASE_PATH || '/Users/colorh/Pictures/相机照片');
  }
  
  // 使用 express.static 提供文件服务
  express.static(targetPath)(req, res, next);
});

// 路由
app.use('/api/photos', photoRoutes);
app.use('/api/import', importRoutes);
app.use('/api/settings', settingsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务器运行正常' });
});

// 独立版本：提供前端静态文件
if (isStandalone) {
  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  
  // 所有非 API 请求返回前端 index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;
