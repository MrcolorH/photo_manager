# 相机管理后台

相机存储卡导入 + 硬盘仓库存储管理 + RAW/JPG 预览

---

## 构建

```bash
# Windows EXE 安装包
npm run build:win

# macOS DMG 安装包
npm run build:mac
```

产物输出到 `dist-electron/` 目录。

---

## 开发

```bash
# 启动后端（端口 9901）
cd backend && npm start

# 启动前端（端口 9900）
cd frontend && npm run dev
```

### Electron 开发模式

```bash
npm run start:electron
```

---

## 项目结构

```
.
├── electron/          # Electron 主进程（系统托盘 + 后端管理）
├── backend/           # Node.js 后端服务 (Express)
├── frontend/          # React + Vite 前端
├── resources/         # 外部工具 (ffmpeg.exe 等)
├── scripts/           # 构建 & 工具脚本
├── electron-builder.yml  # 打包配置
└── package.json       # 根项目配置
```

---

## 端口配置

- **前端**：`9900`
- **后端**：`9901`

---

## 系统要求

- **开发环境**：Node.js v18+
- **Windows**：Windows 10+ (x64)
- **macOS**：macOS 12.0+ (Intel / Apple Silicon)
- **独立版**：无需任何环境，开箱即用
