const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const photoRoutes = require('./routes/photoRoutes');
const importRoutes = require('./routes/importRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// 存储仓库配置文件路径
// 支持 DATA_DIR 环境变量（用于持久化用户数据）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const REPOS_CONFIG_PATH = path.join(DATA_DIR, 'repos.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 读取存储仓库列表
function getRepos() {
  try {
    const data = fs.readFileSync(REPOS_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    // 根据操作系统设置默认路径
    let defaultPath;
    if (process.platform === 'win32') {
      // Windows: 使用用户图片目录
      defaultPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Pictures', '相机照片');
    } else if (process.platform === 'darwin') {
      // macOS: 使用用户图片目录
      defaultPath = path.join(process.env.HOME || '/Users/username', 'Pictures', '相机照片');
    } else {
      // Linux: 使用用户主目录
      defaultPath = path.join(process.env.HOME || '/home/username', 'Pictures', '相机照片');
    }
    
    const defaultRepo = {
      id: 'default',
      name: '默认仓库',
      path: process.env.PHOTO_BASE_PATH || defaultPath,
      isDefault: true
    };
    return [defaultRepo];
  }
}

// 动态静态文件服务 - 根据 repo 参数提供不同仓库的文件
app.use('/uploads', (req, res, next) => {
  const repoId = req.query.repo;
  const repos = getRepos();
  
  let targetPath;
  if (repoId) {
    const repo = repos.find(r => r.id === repoId);
    targetPath = repo ? (repo.path === 'AUTO' ? getDefaultPhotoPath() : repo.path) : getDefaultPhotoPath();
  } else {
    // 默认使用默认仓库
    const defaultRepo = repos.find(r => r.isDefault);
    targetPath = defaultRepo ? (defaultRepo.path === 'AUTO' ? getDefaultPhotoPath() : defaultRepo.path) : getDefaultPhotoPath();
  }
  
  // 检查路径是否存在
  try {
    fs.accessSync(targetPath);
    // 使用 express.static 提供文件服务
    express.static(targetPath)(req, res, next);
  } catch (err) {
    console.error(`静态文件路径不存在: ${targetPath}`);
    res.status(404).json({ error: '存储路径不存在' });
  }
});

// 获取默认照片路径（跨平台兼容）
function getDefaultPhotoPath() {
  if (process.env.PHOTO_BASE_PATH) {
    return process.env.PHOTO_BASE_PATH;
  }
  
  let defaultPath;
  if (process.platform === 'win32') {
    // Windows: 使用用户图片目录
    defaultPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Pictures', '相机照片');
  } else if (process.platform === 'darwin') {
    // macOS: 使用用户图片目录
    defaultPath = path.join(process.env.HOME || '/Users/username', 'Pictures', '相机照片');
  } else {
    // Linux: 使用用户主目录
    defaultPath = path.join(process.env.HOME || '/home/username', 'Pictures', '相机照片');
  }
  
  return defaultPath;
}

// 路由
app.use('/api/photos', photoRoutes);
app.use('/api/import', importRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务器运行正常' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;
