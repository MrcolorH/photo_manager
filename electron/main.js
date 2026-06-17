const { app, Tray, Menu, shell, nativeImage, dialog, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');

// ============ 配置 ============
const BACKEND_PORT = 9901;
const HEALTH_CHECK_URL = `http://localhost:${BACKEND_PORT}/api/health`;
const APP_URL = `http://localhost:${BACKEND_PORT}`;
const HEALTH_CHECK_INTERVAL = 3000; // 3秒
const MAX_HEALTH_CHECK_ATTEMPTS = 30; // 最多30次 = 90秒超时

// ============ 全局变量 ============
let tray = null;
let backendProcess = null;
let healthCheckTimer = null;
let appState = 'starting'; // 'starting' | 'running' | 'stopped' | 'error'
let stopping = false; // 防止 stopBackend 并发调用

// ============ 路径计算 ============
function getResourcesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath);
  }
  return path.join(__dirname, '..', 'resources');
}

function getBackendPath() {
  return path.join(__dirname, '..', 'backend', 'src', 'app.js');
}

function getLogPath() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return path.join(logDir, 'camera-manager.log');
}

function getTrayIconPath() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return iconPath;
  }
  // 如果图标不存在，创建一个空的 16x16 图标
  return null;
}

// ============ 日志 ============
function writeLog(message) {
  const logFile = getLogPath();
  const timestamp = new Date().toLocaleString('zh-CN');
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(logLine.trim());
  try {
    fs.appendFileSync(logFile, logLine);
  } catch (e) {
    // 忽略日志写入错误
  }
}

// ============ 后端服务管理 ============
function startBackend() {
  const backendFile = getBackendPath();
  const resourcesPath = getResourcesPath();
  const logFile = getLogPath();

  if (!fs.existsSync(backendFile)) {
    writeLog(`错误: 后端文件不存在 - ${backendFile}`);
    appState = 'error';
    updateTrayMenu();
    return;
  }

  writeLog(`启动后端服务...`);
  writeLog(`后端文件: ${backendFile}`);
  writeLog(`资源路径: ${resourcesPath}`);

  // 配置目录: 打包后放在用户 AppData，开发时放在项目根目录
  const configDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'config')
    : path.join(__dirname, '..', 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // 设置环境变量
  const env = {
    ...process.env,
    PORT: String(BACKEND_PORT),
    STANDALONE: 'true',
    ELECTRON_STANDALONE: 'true',
    CONFIG_DIR: configDir,
    FFMPEG_PATH: getFfmpegPath(resourcesPath),
    EXIFTOOL_PATH: getExiftoolPath(resourcesPath),
    PHOTO_BASE_PATH: path.join(app.getPath('pictures'), 'CameraPhotos'),
    DEFAULT_IMPORT_PATH: getWindowsDrives()[0] || 'C:\\'
  };

  // fork 后端子进程
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  backendProcess = fork(backendFile, [], {
    cwd: path.dirname(path.dirname(backendFile)),
    env: env,
    silent: true,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  // 将子进程输出重定向到日志文件
  if (backendProcess.stdout) {
    backendProcess.stdout.on('data', (data) => {
      logStream.write(data);
    });
  }
  if (backendProcess.stderr) {
    backendProcess.stderr.on('data', (data) => {
      logStream.write(data);
    });
  }

  backendProcess.on('error', (err) => {
    writeLog(`后端进程错误: ${err.message}`);
    appState = 'error';
    updateTrayMenu();
  });

  backendProcess.on('exit', (code, signal) => {
    writeLog(`后端进程退出 (code: ${code}, signal: ${signal})`);
    if (appState !== 'stopped') {
      appState = 'stopped';
      updateTrayMenu();
    }
  });

  // 处理后端通过 IPC 发送的请求 (如文件夹选择对话框)
  backendProcess.on('message', async (msg) => {
    if (msg && msg.type === 'folder-select-request') {
      writeLog(`收到文件夹选择请求 (requestId: ${msg.requestId})`);
      
      // 创建一个置顶的隐藏窗口作为对话框父窗口，确保对话框弹在最上层
      const dialogParent = new BrowserWindow({
        show: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        width: 0,
        height: 0
      });
      dialogParent.show(); // 必须先 show 才能作为父窗口生效
      
      try {
        const result = await dialog.showOpenDialog(dialogParent, {
          title: '请选择文件夹',
          properties: ['openDirectory']
        });
        const selectedPath = result.canceled ? null : (result.filePaths[0] || null);
        writeLog(`文件夹选择结果: ${selectedPath || '用户取消'}`);
        backendProcess.send({
          type: 'folder-select-result',
          requestId: msg.requestId,
          path: selectedPath
        });
      } catch (err) {
        writeLog(`文件夹选择对话框错误: ${err.message}`);
        backendProcess.send({
          type: 'folder-select-result',
          requestId: msg.requestId,
          error: err.message
        });
      } finally {
        dialogParent.destroy(); // 关闭并释放父窗口
      }
    }
  });

  writeLog(`后端进程已启动 (PID: ${backendProcess.pid})`);
  appState = 'starting';
  updateTrayMenu();

  // 开始健康检查
  startHealthCheck();
}

function stopBackend() {
  return new Promise((resolve) => {
    if (stopping) {
      writeLog('stopBackend 已在执行中，跳过重复调用');
      resolve();
      return;
    }
    stopping = true;

    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }

    // 检查进程是否已自行退出（exitCode !== null 表示进程已结束）
    // 旧代码用 !backendProcess.killed 无法检测进程自行退出的情况
    if (backendProcess && backendProcess.exitCode === null) {
      writeLog('正在停止后端服务...');

      // 8秒超时，防止进程卡住导致 Promise 永不 resolve
      const timeout = setTimeout(() => {
        if (backendProcess && !backendProcess.killed) {
          writeLog('停止超时，强制终止后端进程');
          backendProcess.kill('SIGKILL');
        }
      }, 8000);

      backendProcess.once('exit', () => {
        clearTimeout(timeout);
        writeLog('后端服务已停止');
        backendProcess = null;
        stopping = false;
        resolve();
      });

      backendProcess.kill('SIGTERM');
    } else {
      // 进程已退出或不存在，直接清理
      if (backendProcess) {
        writeLog('后端进程已退出 (exitCode: ' + backendProcess.exitCode + ')，无需重复停止');
      }
      backendProcess = null;
      stopping = false;
      resolve();
    }
  });
}

async function restartBackend() {
  writeLog('正在重启服务...');
  appState = 'starting';
  updateTrayMenu();
  await stopBackend();
  startBackend();
}

// ============ 健康检查 ============
function startHealthCheck() {
  let attempts = 0;

  healthCheckTimer = setInterval(async () => {
    attempts++;

    const isHealthy = await checkHealth();

    if (isHealthy && appState === 'starting') {
      appState = 'running';
      updateTrayMenu();
      writeLog('服务已就绪');
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;

      // 启动完成后自动打开浏览器
      shell.openExternal(APP_URL);

      // 继续定期检查健康状态
      healthCheckTimer = setInterval(async () => {
        const healthy = await checkHealth();
        if (!healthy && appState === 'running') {
          appState = 'error';
          updateTrayMenu();
        } else if (healthy && appState === 'error') {
          appState = 'running';
          updateTrayMenu();
        }
      }, 10000); // 10秒一次
    } else if (attempts > MAX_HEALTH_CHECK_ATTEMPTS && appState === 'starting') {
      appState = 'error';
      updateTrayMenu();
      writeLog('启动超时，请检查日志');
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;

      dialog.showErrorBox('启动超时', '后端服务启动超时，请查看日志了解详情。');
    }
  }, HEALTH_CHECK_INTERVAL);
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_CHECK_URL, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ============ 工具函数 ============
function getFfmpegPath(resourcesPath) {
  if (process.platform === 'win32') {
    // Windows: 使用打包的 ffmpeg.exe
    const bundledExe = path.join(resourcesPath, 'ffmpeg.exe');
    if (fs.existsSync(bundledExe)) {
      return bundledExe;
    }
    return 'ffmpeg.exe';
  }
  // macOS / Linux: 优先使用打包的 ffmpeg，否则回退到系统 PATH
  const bundledMac = path.join(resourcesPath, 'ffmpeg');
  if (fs.existsSync(bundledMac)) {
    return bundledMac;
  }
  return 'ffmpeg'; // 回退到系统 PATH (Homebrew 等)
}

function getExiftoolPath(resourcesPath) {
  // 优先使用 exiftool-vendored.exe (Windows)
  const vendoredExe = path.join(__dirname, '..', 'backend', 'node_modules', 'exiftool-vendored.exe', 'bin', 'exiftool.exe');
  if (fs.existsSync(vendoredExe)) {
    return vendoredExe;
  }
  // 如果已打包到 resources 中
  const bundled = path.join(resourcesPath, 'exiftool.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return 'exiftool'; // 回退到系统 PATH
}

function getWindowsDrives() {
  const drives = [];
  try {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const letter of letters) {
      const drive = `${letter}:\\`;
      if (fs.existsSync(drive)) {
        drives.push(drive);
      }
    }
  } catch (e) {
    // ignore
  }
  return drives.length > 0 ? drives : ['C:\\'];
}

// ============ 系统托盘 ============
function createTray() {
  // 创建托盘图标
  let trayIcon;
  const iconPath = getTrayIconPath();

  if (iconPath) {
    trayIcon = nativeImage.createFromPath(iconPath);
    // 确保图标大小合适
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } else {
    // 创建一个简单的纯色图标作为后备
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('拾光舱 · ShíGuāng Capsule');

  // 左键单击打开浏览器
  tray.on('click', () => {
    if (appState === 'running') {
      shell.openExternal(APP_URL);
    }
  });

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const statusText = getStatusText();

  const menuTemplate = [
    {
      label: `状态: ${statusText}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '打开主页页面',
      enabled: appState === 'running',
      click: () => {
        shell.openExternal(APP_URL);
      }
    },
    {
      label: '查看日志',
      click: () => {
        shell.openPath(getLogPath());
      }
    },
    { type: 'separator' },
    {
      label: '重新启动服务',
      enabled: appState === 'running' || appState === 'error' || appState === 'stopped',
      click: () => {
        restartBackend();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: async () => {
        await stopBackend();
        app.quit();
      }
    }
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);

  // 更新 tooltip
  tray.setToolTip(`拾光舱 - ${statusText}`);
}

function getStatusText() {
  switch (appState) {
    case 'starting': return '启动中...';
    case 'running': return '运行中';
    case 'stopped': return '已停止';
    case 'error': return '异常';
    default: return '未知';
  }
}

// ============ 应用生命周期 ============
// 隐藏 Dock 图标（macOS）
if (process.platform === 'darwin') {
  app.dock.hide();
}

// 防止关闭所有窗口时退出应用
app.on('window-all-closed', (e) => {
  // 不退出，保持托盘运行
});

app.on('ready', () => {
  writeLog('=== 应用启动 ===');
  writeLog(`版本: ${app.getVersion()}`);
  writeLog(`平台: ${process.platform} ${process.arch}`);
  writeLog(`用户数据: ${app.getPath('userData')}`);

  createTray();
  startBackend();
});

app.on('will-quit', async () => {
  writeLog('=== 应用关闭 ===');
  await stopBackend();
});

// 单实例锁 - 防止多开
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  dialog.showErrorBox('程序已在运行', '拾光舱已在后台运行，请查看系统托盘。');
  app.quit();
}
