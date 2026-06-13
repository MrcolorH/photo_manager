/**
 * Windows EXE 构建脚本
 * 
 * 使用方式: node scripts/build-win.js
 * 
 * 前置条件:
 * 1. 已安装 Node.js v18+
 * 2. 已在根目录执行 npm install
 * 3. 已在 frontend/ 和 backend/ 目录分别执行 npm install
 * 4. resources/ 目录下已放置 ffmpeg.exe
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const BACKEND_DIR = path.join(ROOT, 'backend');
const RESOURCES_DIR = path.join(ROOT, 'resources');

function run(cmd, cwd = ROOT) {
  console.log(`\n>>> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

console.log('========================================');
console.log('  相机照片管理系统 - Windows 构建脚本');
console.log('========================================\n');

// Step 1: 检查 ffmpeg.exe
console.log('[1/5] 检查 ffmpeg.exe...');
const ffmpegPath = path.join(RESOURCES_DIR, 'ffmpeg.exe');
if (!fs.existsSync(ffmpegPath)) {
  console.warn('⚠️  警告: resources/ffmpeg.exe 不存在!');
  console.warn('   请从 https://www.gyan.dev/ffmpeg/builds/ 下载 ffmpeg');
  console.warn('   并将 ffmpeg.exe 放置到 resources/ffmpeg.exe');
  console.warn('   视频缩略图功能将不可用。\n');
  ensureDir(RESOURCES_DIR);
  // 创建一个占位文件以便 electron-builder 不报错
  fs.writeFileSync(ffmpegPath, 'PLACEHOLDER - Replace with real ffmpeg.exe');
  console.log('   已创建占位文件，视频缩略图功能将不可用');
} else {
  console.log('✅ ffmpeg.exe 已就绪');
}

// Step 2: 检查图标文件
console.log('\n[2/5] 检查图标文件...');
const assetsDir = path.join(ROOT, 'electron', 'assets');
ensureDir(assetsDir);

const iconPath = path.join(assetsDir, 'app-icon.ico');
const trayIconPath = path.join(assetsDir, 'tray-icon.png');

if (!fs.existsSync(iconPath)) {
  console.warn('⚠️  app-icon.ico 不存在，将使用默认图标');
}
if (!fs.existsSync(trayIconPath)) {
  console.warn('⚠️  tray-icon.png 不存在，将生成默认图标');
  // 生成一个简单的 32x32 PNG 图标（相机图标占位）
  generateDefaultTrayIcon(trayIconPath);
}

// Step 3: 构建前端
console.log('\n[3/5] 构建前端...');
try {
  run('npm run build', FRONTEND_DIR);
  console.log('✅ 前端构建完成');
} catch (e) {
  console.error('❌ 前端构建失败:', e.message);
  process.exit(1);
}

// Step 4: 确保后端依赖已安装
console.log('\n[4/5] 检查后端依赖...');
const backendNodeModules = path.join(BACKEND_DIR, 'node_modules');
if (!fs.existsSync(backendNodeModules)) {
  console.log('安装后端依赖...');
  run('npm install --production', BACKEND_DIR);
} else {
  console.log('✅ 后端依赖已就绪');
}

// Step 5: 打包 Electron 应用
console.log('\n[5/6] 打包 Electron 应用...');
try {
  run('npx electron-builder --win --config electron-builder.yml', ROOT);
} catch (e) {
  console.error('❌ Electron 打包失败:', e.message);
  process.exit(1);
}

// Step 6: 清理多余构建产物，只保留安装包
console.log('\n[6/6] 清理构建产物...');
const distDir = path.join(ROOT, 'dist-electron');
if (fs.existsSync(distDir)) {
  const keepFiles = new Set([
    'CameraManager Setup 1.0.0.exe',
    'CameraManager Setup 1.0.0.exe.blockmap',
    'latest.yml'
  ]);
  for (const entry of fs.readdirSync(distDir)) {
    if (!keepFiles.has(entry)) {
      const fullPath = path.join(distDir, entry);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log('  已清理: ' + entry);
    }
  }
}

console.log('\n========================================');
console.log('  ✅ 构建完成!');
console.log('  输出文件: dist-electron/CameraManager Setup 1.0.0.exe');
console.log('========================================');

// ============ 辅助函数 ============

function generateDefaultTrayIcon(outputPath) {
  // 生成一个最小的有效 PNG 文件 (16x16 蓝色相机图标)
  // 这是一个预编码的最小 PNG
  const { createCanvas } = tryRequireCanvas();
  
  if (createCanvas) {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d');
    
    // 背景
    ctx.fillStyle = '#1890ff';
    ctx.beginPath();
    ctx.roundRect(0, 0, 32, 32, 6);
    ctx.fill();
    
    // 相机图标 (简化)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(8, 12, 16, 12); // 相机身体
    ctx.fillRect(12, 8, 8, 4);   // 相机顶部
    ctx.beginPath();
    ctx.arc(16, 18, 4, 0, Math.PI * 2); // 镜头
    ctx.fillStyle = '#1890ff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(16, 18, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    
    fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
    console.log('✅ 已生成默认托盘图标');
  } else {
    // 最小有效 PNG: 1x1 蓝色像素
    const minPng = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, // 16x16
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x91, 0x68,
      0x36, 0x00, 0x00, 0x00, 0x3C, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x62, 0x60, 0x60, 0x60, 0xF8,
      0x0F, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
      0x60, 0x82
    ]);
    fs.writeFileSync(outputPath, minPng);
    console.log('⚠️  已生成占位托盘图标 (请替换为正式图标)');
  }
}

function tryRequireCanvas() {
  try {
    return require('canvas');
  } catch {
    return {};
  }
}
