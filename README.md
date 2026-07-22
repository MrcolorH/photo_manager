# 拾光舱 v1.0.1

> 相机存储卡导入 + 硬盘仓库存储管理 + RAW/JPG 预览

---

## 打包发布

本项目使用 [electron-builder](https://www.electron.build/) 打包，封装为 Windows NSIS 安装包与 macOS DMG 镜像。打包脚本会自动完成：检查资源 → 构建前端 → 安装/检查后端依赖 → 调用 electron-builder → 清理多余产物。

### 通用前置条件

- **Node.js v18+**（推荐 v20 LTS）
- 在项目**根目录**执行 `npm install`
- 在 `frontend/` 目录执行 `npm install`
- 在 `backend/` 目录执行 `npm install`
- `resources/` 目录下放置 ffmpeg 可执行文件：
  - Windows：`resources/ffmpeg.exe`
  - macOS：`resources/ffmpeg`（赋予执行权限 `chmod +x resources/ffmpeg`）
- `electron/assets/` 下存在图标文件（缺失时运行 `node scripts/generate-all-icons.js` 生成）

> Windows 用户若 electron 下载超时，脚本会自动使用 `npmmirror.com` 国内镜像。

---

### Windows 打包（生成 EXE 安装包）

**运行环境**：Windows 10+ (x64)

```bash
npm run build:win
```

脚本流程（[scripts/build-win.js](file:///d:/Project/photo_manager/scripts/build-win.js)）：

1. 检查 `resources/ffmpeg.exe`（缺失会创建占位文件，但视频缩略图功能不可用）
2. 检查 `electron/assets/app-icon.ico` 与 `tray-icon.png`
3. 构建前端 `npm run build`（输出到 `frontend/dist/`）
4. 检查并安装后端依赖
5. 调用 `electron-builder --win`，使用国内镜像加速下载
6. 清理 `dist-electron/` 中间产物，只保留安装包

**产物**：

```
dist-electron/Shiguang Capsule Setup 1.0.1.exe
dist-electron/Shiguang Capsule Setup 1.0.1.exe.blockmap
dist-electron/latest.yml
```

- 目标架构：`x64`
- 安装方式：NSIS（非一键安装，可自定义安装目录，创建桌面与开始菜单快捷方式）

---

### macOS 打包（生成 DMG 镜像）

**运行环境**：macOS 12.0+（Intel / Apple Silicon 均可）

```bash
npm run build:mac
```

脚本流程（[scripts/build-mac.js](file:///d:/Project/photo_manager/scripts/build-mac.js)）：

1. 检查 `electron/assets/app-icon.png`（缺失则报错退出，请先生成图标）
2. 构建前端 `npm run build`
3. 检查并安装后端依赖
4. 准备 `dmgbuild` 工具：若 `resources/dmg-builder@1.2.0.tar.gz` 存在，自动解压并设置 `CUSTOM_DMGBUILD_PATH`；也可通过环境变量手动指定
5. 调用 `electron-builder --mac`
6. 清理 `dist-electron/` 中的 `.app`、`mac/` 等中间目录，只保留 DMG

**产物**：

```
dist-electron/Shiguang Capsule-1.0.1-arm64.dmg
dist-electron/Shiguang Capsule-1.0.1-x64.dmg
dist-electron/Shiguang Capsule-1.0.1-arm64.dmg.blockmap
dist-electron/Shiguang Capsule-1.0.1-x64.dmg.blockmap
dist-electron/latest-mac.yml
```

- 目标架构：`x64` + `arm64`（通用二进制，Intel 与 Apple Silicon 均可运行）
- 安装方式：DMG（拖拽到 Applications 文件夹）

> **签名提示**：当前未配置代码签名，分发时用户首次打开可能需要在「系统设置 → 隐私与安全性」中点击「仍要打开」。如需正式分发，请在 `electron-builder.yml` 中配置 `mac.identity` 与开发者证书。

---

### 跨平台打包注意事项

| 平台 | 构建主机要求 | 产物格式 | 架构 |
| :--- | :--- | :--- | :--- |
| Windows | Windows 10+ | NSIS EXE 安装包 | x64 |
| macOS | macOS 12.0+ | DMG 镜像 | x64 + arm64 |

> electron-builder 不支持在 Windows 上原生打包 macOS DMG，反之亦然。如需在单台机器上同时产出两端安装包，请使用 GitHub Actions / CI 矩阵构建，或在各自平台分别执行。

---

## 开发模式

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
├── electron/             # Electron 主进程（系统托盘 + 后端管理）
│   ├── assets/           # 应用图标
│   └── main.js
├── backend/              # Node.js 后端服务 (Express)
│   ├── src/
│   ├── data/
│   └── package.json
├── frontend/             # React + Vite 前端
│   ├── src/
│   └── package.json
├── resources/            # 外部工具 (ffmpeg.exe / ffmpeg / dmg-builder)
├── scripts/              # 构建 & 工具脚本
│   ├── build-win.js
│   ├── build-mac.js
│   └── generate-all-icons.js
├── electron-builder.yml  # 打包配置
└── package.json          # 根项目配置
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
- **独立版**：无需任何运行环境，开箱即用

---

## 版本历史

### v1.0.2（下一版本，开发中）

> 后续改造将基于此版本进行，代码提交后升版本号。

### v1.0.1 — 当前版本

本次升级将拾光舱从「存储卡导入工具」升级为「可信归档 + 可检索仓库」，新增清单基础设施、EXIF 元数据读取、多维筛选、概览页等能力。主要包括以下改动：

**可信归档**

- 清单基础设施：每个仓库维护 `repo/.shiguang/manifest.json` 作为去重、归档、筛选的统一数据源，启用 30s 内存缓存
- 哈希校验：导入时 SHA-256 流式计算与去重，新增完整性校验接口，避免重复导入
- EXIF 时间归档：按拍摄时间归档到 `category/YYYY/MM/`，无 EXIF 时间时回退文件修改时间，可在导入时开关（默认关闭）
- 双盘镜像：导入完成后可选同步到镜像盘进行双重备份，含路径冲突校验；单文件复制失败不阻断主流程

**EXIF 元数据**

- 基于 exiftool-vendored 读取精简/完整 EXIF 并写入清单，读取异常返回 null 不阻断主流程
- 照片卡片展示相机参数摘要（文件大小、拍摄时间、相机、焦距、光圈、ISO），预览支持查看完整 EXIF
- 刷新 EXIF 功能：为旧版导入的照片补录相机元数据，完成后使用 Ant Design `notification` 给出场景化提示
- 修复焦距/光圈/ISO 数值解析，兼容带单位字符串（如 `50 mm`、`f/2.8`）

**多维筛选与浏览**

- 照片浏览页新增高级筛选模式：支持按日期、相机、镜头、焦距、光圈、ISO、文件名组合筛选
- 普通模式保留原有筛选行为（`advancedFilter=false` 时 `appliedFilter=null`），与改造前体验一致
- 高级筛选日期组件使用中文显示，表单采用 Row/Col 栅格布局

**概览 Dashboard**

- 新增概览页面，集中展示仓库统计信息
- 主题偏好持久化到后端设置

**体验优化**

- 打开文件使用系统默认程序；打开文件夹使用资源管理器新窗口并强制前置聚焦（Win32 API `SetForegroundWindow`）
- 隐藏 Windows 启动过程的黑色 CMD 窗口（PowerShell `Start-Process` + `-WindowStyle Hidden` + `windowsHide: true`）
- 新增重建清单功能，支持对已有扁平结构仓库初始化清单
- 已有扁平结构仓库首次访问时自动初始化清单，确保列表正常显示

**打包改进**

- `build-win.js` 追加 `--publish never`，避免因缺少 GH_TOKEN 导致构建失败
- 修正 Windows 构建安装包文件名与 archive 历史保留逻辑
- 改进 macOS 打包脚本，支持 dmgbuild 失败 fallback

### v1.0.0 — 初始发布

- 相机存储卡导入 + 硬盘仓库存储管理 + RAW/JPG 预览基础功能
