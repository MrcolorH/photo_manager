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
const DMG_BUILDER_TMP = path.join(ROOT, '.dmg-builder-tmp');
const DMG_BUILDER_TAR = path.join(ROOT, 'resources', 'dmg-builder@1.2.0.tar.gz');

function run(cmd, cwd = ROOT) {
  console.log(`>>> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('========================================');
console.log('  相机照片管理系统 - macOS 构建脚本');
console.log('========================================');

// Step 1: 检查图标文件
console.log('\n[1/6] 检查图标文件...');
const iconPng = path.join(ROOT, 'electron', 'assets', 'app-icon.png');
if (!fs.existsSync(iconPng)) {
  console.error('❌ 缺少 app-icon.png，请先运行 node scripts/generate-all-icons.js');
  process.exit(1);
}
console.log('✅ 图标文件已就绪');

// Step 2: 构建前端
console.log('\n[2/6] 构建前端...');
try {
  run('npm run build', FRONTEND_DIR);
  console.log('✅ 前端构建完成');
} catch (e) {
  console.error('❌ 前端构建失败:', e.message);
  process.exit(1);
}

// Step 3: 检查后端依赖
console.log('\n[3/6] 检查后端依赖...');
const backendNodeModules = path.join(ROOT, 'backend', 'node_modules');
if (!fs.existsSync(backendNodeModules)) {
  console.log('后端 node_modules 不存在，正在安装...');
  run('npm install', path.join(ROOT, 'backend'));
}
console.log('✅ 后端依赖已就绪');

// Step 4: 准备 dmgbuild 工具
console.log('\n[4/6] 准备 dmgbuild 工具...');
if (!process.env.CUSTOM_DMGBUILD_PATH) {
  if (fs.existsSync(DMG_BUILDER_TAR)) {
    if (!fs.existsSync(path.join(DMG_BUILDER_TMP, 'dmgbuild'))) {
      fs.mkdirSync(DMG_BUILDER_TMP, { recursive: true });
      run(`tar xzf "${DMG_BUILDER_TAR}" -C "${DMG_BUILDER_TMP}"`);
      // 找到并解压 arm64 dmgbuild bundle
      const artifactsDir = fs.readdirSync(DMG_BUILDER_TMP)[0];
      const dmgBuilderArtifacts = path.join(DMG_BUILDER_TMP, artifactsDir, 'artifacts', 'dmg-builder');
      const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
      const bundleName = fs.readdirSync(dmgBuilderArtifacts).find(f => f.includes(arch));
      if (bundleName) {
        run(`tar xzf "${path.join(dmgBuilderArtifacts, bundleName)}" -C "${DMG_BUILDER_TMP}"`);
      }
    }
    const dmgbuildBin = path.join(DMG_BUILDER_TMP, 'dmgbuild');
    if (fs.existsSync(dmgbuildBin)) {
      process.env.CUSTOM_DMGBUILD_PATH = dmgbuildBin;
      console.log('✅ dmgbuild 已就绪: ' + dmgbuildBin);
    } else {
      console.warn('⚠️  dmgbuild 二进制未找到，将使用默认方式');
    }
  } else {
    console.warn('⚠️  未找到 dmg-builder tar.gz，跳过自定义 dmgbuild 配置');
  }
} else {
  console.log('✅ 使用外部 CUSTOM_DMGBUILD_PATH: ' + process.env.CUSTOM_DMGBUILD_PATH);
}

// 清除可能干扰 dmgbuild 内嵌 Python 的环境变量
// dmgbuild bundle 自带 Python，外部的 PYTHONHOME/PYTHONPATH 会破坏其标准库查找
// 导致 "Fatal Python error: Failed to import encodings module"
if (process.env.PYTHONHOME) {
  console.log('⚠️  检测到外部 PYTHONHOME，已清除以避免干扰 dmgbuild 内嵌 Python');
  delete process.env.PYTHONHOME;
}

// Step 5: 打包 Electron 应用
console.log('\n[5/7] 打包 Electron 应用...');
try {
  run('npx electron-builder --mac --config electron-builder.yml', ROOT);
} catch (e) {
  console.warn('⚠️  Electron 打包过程出错（dmgbuild 可能被沙箱阻断），将尝试用 hdiutil 生成 DMG');
  console.warn('   错误详情:', e.message);
}

// Step 6: 如果 electron-builder 未生成 DMG（或失败），用 hdiutil 生成标准可拖拽安装 DMG
console.log('\n[6/7] 检查并生成标准 DMG 安装包...');
const version = require('../package.json').version;
const dmgTargets = [
  { archDir: 'mac', suffix: '' },
  { archDir: 'mac-arm64', suffix: '-arm64' }
];
for (const { archDir, suffix } of dmgTargets) {
  const dmgName = `Shiguang Capsule-${version}${suffix}.dmg`;
  const dmgPath = path.join(DIST_ELECTRON, dmgName);
  // 已存在则跳过
  if (fs.existsSync(dmgPath)) {
    console.log(`✅ ${dmgName} 已存在，跳过`);
    continue;
  }
  const appPath = path.join(DIST_ELECTRON, archDir, '拾光舱.app');
  if (!fs.existsSync(appPath)) {
    console.warn(`⚠️  未找到 ${archDir}/拾光舱.app，跳过 ${dmgName}`);
    continue;
  }
  // 补 ad-hoc 签名（确保未签名的 .app 能被 Gatekeeper 放行）
  console.log(`  补 ad-hoc 签名: ${appPath}`);
  try {
    run(`codesign --force --deep --sign - "${appPath}"`);
  } catch (e) {
    console.warn('  ⚠️  签名失败，继续生成 DMG:', e.message);
  }
  // 不复制 .app（fs.cpSync 会破坏 Electron Framework 的符号链接结构）
  // 直接在 .app 所在目录临时创建 Applications 链接，从该目录创建 DMG
  // 这样 .app 内部的相对路径符号链接保持不变
  const archDirPath = path.join(DIST_ELECTRON, archDir);
  const appsLink = path.join(archDirPath, 'Applications');
  try {
    fs.symlinkSync('/Applications', appsLink);
  } catch (e) {
    // 已存在则忽略
  }
  console.log(`  生成 DMG: ${dmgName}`);
  try {
    run(`hdiutil create -volname "拾光舱" -srcfolder "${archDirPath}" -ov -format UDZO -fs HFS+ "${dmgPath}"`);
    console.log(`✅ ${dmgName} 生成完成`);
  } catch (e) {
    console.error(`❌ 生成 ${dmgName} 失败:`, e.message);
  } finally {
    // 清理临时 Applications 链接
    try { fs.unlinkSync(appsLink); } catch (e) { /* ignore */ }
  }
}

// Step 7: 清理多余构建产物，只保留 DMG
console.log('\n[7/7] 清理构建产物...');
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

// 清理 dmg-builder 临时目录
if (fs.existsSync(DMG_BUILDER_TMP)) {
  fs.rmSync(DMG_BUILDER_TMP, { recursive: true, force: true });
  console.log('  已清理: .dmg-builder-tmp');
}

console.log('\n========================================');
console.log('  ✅ 构建完成!');
console.log('  输出目录: dist-electron/');
console.log('========================================');
