/**
 * macOS 构建脚本
 * 自动完成: 构建前端 → 打包 Electron DMG
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const DIST_ELECTRON = path.join(ROOT, 'dist-electron');

function run(cmd, cwd = ROOT) {
  console.log(`>>> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('========================================');
console.log('  相机照片管理系统 - macOS 构建脚本');
console.log('========================================');

// Step 1: 检查图标文件
console.log('\n[1/4] 检查图标文件...');
const iconPng = path.join(ROOT, 'electron', 'assets', 'app-icon.png');
if (!fs.existsSync(iconPng)) {
  console.error('❌ 缺少 app-icon.png，请先运行 node scripts/generate-all-icons.js');
  process.exit(1);
}
console.log('✅ 图标文件已就绪');

// Step 2: 构建前端
console.log('\n[2/4] 构建前端...');
try {
  run('npm run build', FRONTEND_DIR);
  console.log('✅ 前端构建完成');
} catch (e) {
  console.error('❌ 前端构建失败:', e.message);
  process.exit(1);
}

// Step 3: 检查后端依赖
console.log('\n[3/4] 检查后端依赖...');
const backendNodeModules = path.join(ROOT, 'backend', 'node_modules');
if (!fs.existsSync(backendNodeModules)) {
  console.log('后端 node_modules 不存在，正在安装...');
  run('npm install', path.join(ROOT, 'backend'));
}
console.log('✅ 后端依赖已就绪');

// Step 4: 打包 Electron 应用
console.log('\n[4/5] 打包 Electron 应用...');
try {
  run('npx electron-builder --mac --config electron-builder.yml', ROOT);
} catch (e) {
  console.error('❌ Electron 打包失败:', e.message);
  process.exit(1);
}

// Step 5: 清理多余构建产物，只保留 DMG
console.log('\n[5/5] 清理构建产物...');
if (fs.existsSync(DIST_ELECTRON)) {
  const keepPatterns = ['.dmg', '.dmg.blockmap', 'latest-mac.yml'];
  for (const entry of fs.readdirSync(DIST_ELECTRON)) {
    const shouldKeep = keepPatterns.some(p => entry.endsWith(p));
    if (!shouldKeep) {
      const fullPath = path.join(DIST_ELECTRON, entry);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log('  已清理: ' + entry);
    }
  }
}

console.log('\n========================================');
console.log('  ✅ 构建完成!');
console.log('  输出目录: dist-electron/');
console.log('========================================');
