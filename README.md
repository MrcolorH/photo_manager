# 照片管理系统 (Photo Manager)

相机存储卡 + 硬盘仓库存储管理 + 预览系统

## 项目简介

本项目是一个专业的照片管理工具,支持从相机存储卡导入照片、管理多个存储仓库、浏览和预览照片(包括RAW格式)。

## 核心功能

### 1. 存储卡导入
- 实时进度显示(总文件数、已处理数、剩余数、预计剩余时间)
- 当前处理文件显示
- 支持JPG、RAW(.arw/.cr2/.nef等)、视频文件导入
- SSE(Server-Sent Events)实时推送进度
- 5分钟超时保护,适应大文件导入
- 自动跳过已存在的文件,避免重复导入

### 2. 照片浏览与管理
- 支持JPG、RAW、视频分类浏览
- RAW文件缩略图预览(使用exiftool-vendored提取嵌入预览)
- 多仓库管理,支持切换不同存储路径
- 照片同步删除功能

### 3. 仓库管理
- 支持多个存储仓库配置
- 可设置默认仓库
- 自定义仓库路径和名称

## 技术栈

### 后端
- **Node.js** + Express
- **SSE** (Server-Sent Events) 实时进度推送
- **exiftool-vendored** RAW文件元数据提取和缩略图生成
- **CORS** 跨域支持

### 前端
- **React** + Vite
- EventSource API 接收SSE消息
- 现代化UI组件库
- 热更新(HMR)开发体验

## 快速开始

### 环境要求
- Node.js (推荐 v16+)
- npm 或 yarn

### 安装与启动

#### 1. 安装依赖
```bash
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

#### 2. 配置文件
cd到config目录,复制示例配置文件:
```bash
cd ../config
cp repos.json.example repos.json
cp .env.example .env
```

编辑`repos.json`配置你的存储仓库路径:
```json
[
  {
    "id": "my-repo",
    "name": "我的照片库",
    "path": "/你的/照片/存储路径",
    "isDefault": true
  }
]
```

编辑`.env`配置环境变量:
```
PORT=3001
PHOTO_BASE_PATH=/你的/默认/照片路径
DEFAULT_IMPORT_PATH=/存储卡/默认/导入路径
```

#### 3. 启动服务
```bash
# 方式1: 使用启动脚本(推荐)
python launcher.py

# 方式2: 手动启动
# 启动后端(终端1)
cd backend
npm start

# 启动前端(终端2)
cd frontend
npm run dev
```

访问前端应用(通常为 `http://localhost:5173`)

## 配置说明

### 配置文件位置
- `config/repos.json` - 存储仓库配置(已加入.gitignore)
- `config/.env` - 环境变量配置(已加入.gitignore)
- `backend/data/repos.json` - 后端运行时使用的配置副本

### 配置项说明
- **repos.json**: 定义多个存储仓库,每个仓库包含id、name、path、isDefault
- **.env**: 服务器端口、默认路径等环境相关配置

### 注意事项
- 配置文件包含个人路径信息,已添加到`.gitignore`,不会提交到版本库
- 不同开发者可以有不同的配置,互不影响
- 如需分享配置,请使用`.example`文件作为模板

## 使用指南

### 导入照片
1. 插入相机存储卡到电脑
2. 在应用中导航到"存储卡导入"页面
3. 选择目标存储仓库
4. 输入或选择存储卡路径(可使用"选择文件夹"按钮)
5. 点击"开始导入",实时查看进度
6. 导入完成后查看统计信息(成功/跳过/错误)

### 浏览照片
1. 进入"照片库"页面
2. 选择仓库和分类(JPG/RAW/视频)
3. 浏览缩略图,点击查看详情
4. RAW文件会自动提取嵌入的JPEG预览图作为缩略图

### 管理仓库
1. 进入"仓库设置"页面
2. 添加/编辑/删除仓库配置
3. 设置默认仓库
4. 验证仓库路径是否可访问

## 技术细节

### RAW缩略图生成
- 使用`exiftool-vendored` Node.js模块(非命令行调用)
- 通过`extractBinaryTagToBuffer` API提取RAW文件嵌入的JPEG预览
- 支持多种RAW格式(.arw索尼、.cr2佳能、.nef尼康等)
- 自动处理跨平台差异(Windows/macOS/Linux)

### SSE进度推送
- 后端使用Server-Sent Events推送实时导入进度
- 前端使用EventSource API接收消息
- 支持进度、完成、错误三种消息类型
- 5分钟超时保护机制
- 浏览器兼容性: Chrome/Edge/Firefox/Safari均支持(IE11不支持)

### 跨平台支持
- 项目支持Windows和macOS平台
- 使用Git分支管理: `main-win` (Windows)、`main-mac` (macOS)
- 路径处理自动适配不同操作系统
- 前端环境检测使用`process.env.NODE_ENV`判断开发/生产环境

## 故障排除

### 导入进度不更新
- 检查浏览器控制台是否有SSE连接错误
- 确认后端是否正确发送SSE消息(查看后端日志)
- 检查网络连接是否稳定
- 验证存储卡路径是否存在且可访问

### RAW缩略图不显示
- 确认RAW文件包含嵌入的JPEG预览(部分RAW文件可能没有)
- 检查后端日志是否有exiftool相关错误
- 验证`exiftool-vendored`依赖是否正确安装

### CORS错误
- 确认后端`backend/src/app.js`中的CORS配置正确
- 重启后端服务

### 超时问题
- 导入大量文件时可能触发5分钟超时
- 可减少单次导入的文件数量
- 或修改`frontend/src/api/index.js`中的超时时间(300000ms)

## 项目结构
```
photo_manager/
├── backend/              # 后端服务
│   ├── src/
│   │   ├── routes/      # API路由
│   │   ├── services/    # 业务逻辑
│   │   └── utils/       # 工具函数
│   └── data/            # 运行时数据
├── frontend/            # 前端应用
│   └── src/
│       ├── pages/       # 页面组件
│       ├── components/  # 通用组件
│       └── api/         # API调用
├── config/              # 配置文件(已gitignore)
├── launcher.py          # 启动脚本
└── build.bat            # 打包脚本(Windows)
```

## 开发与构建

### 开发模式
```bash
# 后端开发
cd backend
npm start  # 监听文件变化自动重启

# 前端开发
cd frontend
npm run dev  # 热更新模式
```

### 打包桌面应用(Windows)
```bash
build.bat  # 使用PyInstaller打包launcher.py为exe
cd dist
CameraPhotoManager.exe
```

## 后续优化方向
- 暂停/恢复导入功能
- 显示实时传输速度(MB/s)
- 批量导入多个存储卡
- 导入历史记录
- 断点续传功能
