【标签】 学习工作

【标题】 【学习工作赛道】拾光舱 · 摄影师专属影像管家

【正文】

## 一、Demo 简介

**是什么**：拾光舱（ShíGuāng Capsule）是一款基于 Electron 的跨平台桌面应用，支持 macOS 与 Windows，开箱即用、无需配置环境。它把摄影师拍完之后最头疼的「拷贝 + 整理」环节压缩成一次点击，让创作之后的收尾工作从一整晚缩短到一杯咖啡的时间。

**面向谁**：核心用户是摄影爱好者、独立摄影师、旅拍 / 婚礼 / 活动摄影师；次级用户包括需要处理大量图片素材的设计、剪辑等创意工作者。典型使用场景是旅拍归来、活动拍摄结束、客户交付前需要快速「倒数据 + 整理素材」的时刻。

**主要功能**：

1. **存储卡一键入库** —— 自动识别 SD / CF / XQD 卡的挂载路径，导入时带进度条、剩余时间预估、CRC 校验与断点续传。几百 GB 的 RAW 拷到一半也能安心暂停或中断，校验通过才算入库成功。

2. **RAW + JPG 智能配对** —— 基于 EXIF 时间戳与文件名双因子配对，让每一组「RAW + JPG 双胞胎」永远一起入仓、一起出仓。配对准确率实测超过 98%，覆盖 Canon、Nikon、Sony、Fuji 等主流厂商。

3. **孤儿 RAW 一键清理** —— 专治「删了 JPG 留下 RAW」或「删了 RAW 留下 JPG」导致的空间浪费。扫一遍即可找出缺少另一半的孤儿文件，确认后一键清理，彻底释放硬盘空间。

此外还提供多仓库统一管理（本地盘、外接 SSD、NAS 跨盘检索）与 RAW 缩略图即时预览（无需 Lightroom 即可浏览 RAW 大图）。

> 【 产品截图 1】照片浏览主界面
>
> ![image-20260701174930919](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174930919.png)【产品截图 2】存储卡导入界面
>
> ![image-20260701174956800](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174956800.png)

## 二、Demo 创作思路

**灵感来源**：这个项目来自我自己和身边摄影爱好者的真实困扰。每拍完一次活动或旅行，回来就得花一整晚连接读卡器、拖拽文件、检查是否拷全。几百 GB 的素材拷到一半不敢拔卡、又不敢中断，提心吊胆地干等 Finder。这套「收尾」流程占据了大量后期时间，却没有任何创造性可言。

**想解决的问题**：摄影师的真实痛点集中在四个方面——①系统复制没有进度反馈，几百 GB 不敢中断；②RAW 与 JPG 配对混乱，删一张忘一张，久了仓库堆满孤儿文件；③多硬盘 / NAS 没有统一视图，找一张旧照片得逐盘翻；④Lightroom、Capture One 一年动辄上千，主战场是调色，对「导入 + 整理」几乎零帮助。

**为什么做这个方向**：市场主流的后期软件都假设你「已经拷好了」，但拷贝和整理恰恰是最耗时的环节，却完全没人管。这是一块真实存在、又被忽视的空白。拾光舱不与 Lightroom 争调色，而是补上它前面的那一环——把素材安全、整齐地收进仓库，让摄影师把时间还给创作。

## 三、Demo 体验地址

采用「交互式可体验的 HTML 格式文件」方式：将 `app-demo.html` 连同 `images/` 目录打包为 Zip 上传社区。

**体验方式**：解压后用浏览器双击打开 `app-demo.html` 即可，无需安装任何环境。

`app-demo.html` 是一个独立的交互演示页，完整复刻了产品的视觉风格与交互逻辑，包含四个功能页面：

- 照片浏览（PhotoGallery）
- 存储卡导入（ImportPage）
- 同步删除 RAW（SyncDeletePage）
- 仓库配置（RepoSettings）

所有后端接口使用 Mock 模拟，响应格式与真实后端完全一致，因此交互体验与正式应用高度接近。少量真正依赖 Electron 原生能力（如系统文件夹选择对话框、打开文件位置）的功能，会在页面中提示「仅在完整项目包中可用」。

> 【待补充】Zip 上传后的社区下载链接（发帖时附上附件或外链）

## 四、TRAE 实践过程

整个 Demo 从需求拆解到可打包发布，全程在 TRAE 中完成。下面按开发顺序记录关键步骤，每一步都附上开发截图与对应的关键任务对话 Session ID。

### 步骤 1 · 需求拆解与架构设计

任务名「摄影师桌面应用需求拆解与技术选型」，耗时约 12 分钟。先和 TRAE 一起把摄影师的真实工作流拆解为「导入 → 配对 → 管理 → 清理 → 预览」五大模块，并为每个模块给出工程化的输入输出定义。其中配对模块在需求阶段就确定了核心算法思路——基于 EXIF 时间戳（±1s）与文件名主体的双因子决策树，产出高置信 / 中置信 / 孤儿三档结果。技术选型确定为三层架构：渲染层（React + Vite）负责界面，容器层（Electron 主进程）负责原生文件系统与托盘，服务层（Node + Express）作为本地后端处理 EXIF 与图像解码。TRAE 在此过程中实时检索了 exiftool 官方资料与 Electron 技术动态辅助决策，最终产出结构化的需求拆解与技术选型文档 `shiguangcang-spec.html`。

![image-20260701174200781](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174200781.png)
【SessionId】4390815359830576:4989ea43d00ba63c628478ceeb790558_6a436b64ca79443c02e39029.6a436b64ca79443c02e3902c.6a436b64ca79443c02e3902a:TRAE Work CN.0.1.25.no_sid.no_ppe.T(2026/6/30 15:08:20)

### 步骤 2 · 工程骨架与 Electron 主进程

用 TRAE 搭建 Electron 主进程（系统托盘 + 后端进程生命周期管理）、Express 后端与 React + Vite 前端的工程骨架，并配置 `electron-builder` 打包脚本（`build:mac` 产出 DMG、`build:win` 产出 EXE）。这一步让项目能在 macOS 与 Windows 上原生运行。

![image-20260701174305014](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174305014.png)

 【Session ID】4390815359830576:f3e6562eaca697252db10cc0499fa6ae_6a4374b8ca79443c02e3909f.6a4374b8ca79443c02e390a2.6a4374b8ca79443c02e390a0:TRAE Work CN.0.1.25.no_sid.no_ppe.T(2026/6/30 15:48:08)

### 步骤 3 · 后端核心能力（EXIF / 缩略图 / 导入校验）

后端用 exiftool-vendored 读取 EXIF 时间戳、相机型号、镜头信息作为配对依据，用 sharp 生成 RAW 缩略图供前端即时预览。存储卡导入流程实现挂载检测、带进度反馈的文件复制，以及 CRC 校验确保数据完整性——校验通过才算入库成功，避免「拷坏了却不自知」。

![image-20260701174326050](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174326050.png)

 【Session ID】4390815359830576:8e75a55fef75539ff37264f7d588f6d1_6a44ada0a9c1f4dc40e1c5cc.6a44ada0a9c1f4dc40e1c5cf.6a44ada0a9c1f4dc40e1c5cd:TRAE Work CN.0.1.25.no_sid.no_ppe.T(2026/7/1 14:03:12)

### 步骤 4 · RAW + JPG 智能配对与孤儿清理

这是产品的核心算法。配对采用 EXIF 时间戳与文件名双因子匹配：先按拍摄时间聚类，再在同名组内确认 RAW 与 JPG 的对应关系，实测准确率超过 98%。孤儿检测则反向利用配对结果——找出缺少另一半的文件并标记，由用户确认后清理，避免误删。

![image-20260701174353511](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174353511.png)

【Session ID】4390815359830576:59cabde728bed4ab17509a1ba3bb82ba_6a44c7574555e65801dcd8c8.6a44cd0a4555e65801dcd8cb.6a44c7574555e65801dcd8c9:TRAE Work CN.0.1.25.no_sid.no_ppe.T(2026/7/1 16:17:14)

### 步骤 5 · 前端界面与交互演示页

前端用 Ant Design 构建照片浏览、导入进度、仓库配置等界面，react-photo-view 实现大图预览。为了让大家无需安装就能体验，我又用 TRAE 生成了 `app-demo.html` 交互演示页——用 Mock 模拟后端，但响应格式与真实后端保持一致，保证了演示体验与正式应用的高度一致。

![image-20260701174427866](/Users/colorh/Library/Application Support/typora-user-images/image-20260701174427866.png)

【Session ID】4390815359830576:9aa56a7169e723bac51958b31a144198_6a44d2ed4555e65801dcda8b.6a44d2ed4555e65801dcda8e.6a44d2ed4555e65801dcda8c:TRAE Work CN.0.1.25.no_sid.no_ppe.T(2026/7/1 16:42:21)

## 五、技术栈

| 技术 | 版本 | 作用 |
| --- | --- | --- |
| Electron | 35.7.5 | 跨端容器，托盘 + 原生文件对话框 |
| React | 19.2.4 | 前端框架，SPA 单页应用 |
| Vite | 8.0.4 | 构建工具，HMR 热更新 |
| Ant Design | 6.3.5 | UI 组件库 |
| Express | 4.18.2 | 本地后端，REST API（端口 9901） |
| exiftool-vendored | 35.17.0 | EXIF 读取，配对依据 |
| sharp | 0.34.5 | RAW 缩略图解码 |
| electron-builder | 26.8.1 | 一键打包 DMG / EXE |

## 六、开发心得

**为什么选 Electron 而非 Tauri**：摄影师的素材动辄几百 GB，导入流程要直接操作本地文件系统、读取存储卡挂载路径、调用原生文件夹对话框。Electron 对这类原生能力的支持更成熟，配合 electron-builder 能一键产出 macOS 与 Windows 安装包，对目标用户而言是「下载即用」，不需要折腾环境。

**EXIF 双因子配对是关键取舍**：单纯靠文件名配对在连拍、重命名场景下会失准，单纯靠时间戳又无法区分同秒拍摄的多张照片。把两者结合——先按 EXIF 拍摄时间聚类，再在同名组内确认对应关系——是把准确率推到 98% 以上的核心。这个策略是和 TRAE 反复讨论、用真实素材验证后定下来的。

**演示页与真实后端接口对齐**：做 `app-demo.html` 时特意让 Mock 的响应格式与真实后端完全一致。这意味着演示页验证过的交互逻辑，可以几乎零改动地迁回正式应用，也方便评审在不安装应用的前提下完整体验产品。

---

报名帖链接：https://forum.trae.cn/t/topic/27448
