# 相机管理后台

相机存储卡 + 硬盘仓库存储管理 + 预览

---

## 项目结构

```
.
├── backend/              # Node.js 后端服务
├── frontend/             # React + Vite 前端
├── CameraManager.app     # macOS 菜单栏启动器（开发版）
├── Standalone/           # 独立安装版
│   ├── CameraManager.app # 内嵌 Node.js + 代码，无需环境
│   └── CameraManager-Standalone.dmg
├── start.sh              # 服务启动脚本
├── stop.sh               # 服务停止脚本
└── build-standalone-app.sh # 打包独立版脚本
```

---

## 开发方式

### 1. 命令行启动

```bash
# 启动后端（端口 9901）
cd backend
npm start

# 启动前端（端口 9900）
cd frontend
npm run dev
```

### 2. 使用 CameraManager.app（开发版）

将 `CameraManager.app` 放在项目根目录下，双击即可启动。

- 自动检测项目路径
- 前后端并行启动
- 启动完成后自动打开 Safari
- 菜单栏显示状态

**功能**：
- ✅ 显示主页面（打开 Safari）
- ✅ 重新选择项目路径（App 不在项目内时使用）
- ✅ 退出（彻底停止所有服务）

---

## 独立安装版

### 给其他人使用

独立版内嵌了 **Node.js 运行时** + **前后端代码** + **所有依赖**，对方无需安装任何环境。

#### 方式一：使用打包好的 DMG

1. 将 `Standalone/CameraManager-Standalone.dmg` 发送给对方
2. 对方双击 DMG 挂载
3. 将 `CameraManager.app` 拖拽到 `Applications` 文件夹
4. 从启动台或 Applications 打开即可

#### 方式二：直接复制 App

```bash
cp -r "Standalone/CameraManager.app" /Applications/
```

---

## 打包独立版本

当你修改了平台功能（前后端代码），需要重新打包独立版：

```bash
./build-standalone-app.sh
```

打包完成后，独立版输出到 `Standalone/` 目录：

```
Standalone/
├── CameraManager.app              # 独立版 App（约 368MB）
└── CameraManager-Standalone.dmg   # DMG 安装包（约 156MB）
```

### 打包脚本做了什么？

1. 将 `backend/` 复制到 `App/Contents/Resources/Project/backend/`
2. 将 `frontend/` 复制到 `App/Contents/Resources/Project/frontend/`
3. 将系统 `node` 二进制复制到 `App/Contents/Resources/Project/node`
4. 创建内嵌的 `start.sh` / `stop.sh`（使用内嵌的 node 启动）
5. 编译 Swift 菜单栏应用（指向内嵌代码）
6. 打包为 `.dmg` 格式

### 何时需要重新打包？

| 修改内容 | 是否需要重新打包 |
|---------|-------------|
| 前端页面、组件、样式 | ✅ 需要 |
| 后端接口、业务逻辑 | ✅ 需要 |
| 端口配置 | ✅ 需要 |
| App 菜单功能 | ✅ 需要 |
| App 图标 | ✅ 需要 |

---

## 端口配置

- **前端**：`9900`
- **后端**：`9901`

配置位置：
- 后端端口：`backend/.env`
- 前端端口：`frontend/vite.config.js`

---

## 系统要求

- macOS 12.0+
- 开发版需要预先安装 Node.js（v18+）
- 独立版无需任何环境
