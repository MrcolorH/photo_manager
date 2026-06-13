const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Windows 文件夹选择对话框
 * 
 * 支持两种模式:
 * 1. Electron IPC 模式: 通过 Electron 主进程的 dialog.showOpenDialog 打开 (推荐)
 * 2. PowerShell 回退模式: 通过 PowerShell 调用系统对话框 (开发环境备用)
 */

// 通过 IPC 向 Electron 主进程请求文件夹选择
function selectFolderViaIPC(timeout = 120000) {
  return new Promise((resolve, reject) => {
    // 检查是否在 Electron 子进程中
    if (!process.send) {
      return reject(new Error('NOT_IPC'));
    }

    const requestId = `folder-select-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const timer = setTimeout(() => {
      process.removeListener('message', handler);
      reject(new Error('IPC_TIMEOUT'));
    }, timeout);

    function handler(msg) {
      if (msg && msg.type === 'folder-select-result' && msg.requestId === requestId) {
        clearTimeout(timer);
        process.removeListener('message', handler);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.path || null);
        }
      }
    }

    process.on('message', handler);
    
    process.send({
      type: 'folder-select-request',
      requestId: requestId
    });
  });
}

// 通过 PowerShell 打开文件夹选择对话框 (回退方案)
async function selectFolderViaPowerShell(timeout = 60000) {
  // 强制 UTF-8 输出编码，避免中文路径乱码
  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '请选择文件夹'
$dialog.ShowNewFolderButton = $false
$result = $dialog.ShowDialog()
if ($result -eq 'OK') {
  Write-Host $dialog.SelectedPath
}
`.trim();

  // 写入临时脚本文件避免命令行转义问题
  const tmpScript = require('path').join(
    require('os').tmpdir(),
    `camera-folder-select-${Date.now()}.ps1`
  );
  
  const fs = require('fs');
  fs.writeFileSync(tmpScript, psScript, 'utf8');

  try {
    const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`;
    const { stdout, stderr } = await execPromise(command, { 
      timeout,
      windowsHide: false,  // 不隐藏窗口，确保对话框可见
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    const selectedPath = stdout.trim();
    
    if (stderr && stderr.trim()) {
      console.error('PowerShell stderr:', stderr.trim());
    }

    return selectedPath || null;
  } finally {
    // 清理临时文件
    try { fs.unlinkSync(tmpScript); } catch (e) { /* ignore */ }
  }
}

// 使用 VBScript 打开文件夹选择对话框 (备用回退方案)
async function selectFolderViaVBScript(timeout = 60000) {
  const vbsScript = `
Set objShell = CreateObject("Shell.Application")
Set objFolder = objShell.BrowseForFolder(0, "请选择文件夹", 0, 0)
If Not objFolder Is Nothing Then
  WScript.Echo objFolder.Self.Path
End If
`.trim();

  const tmpVbs = require('path').join(
    require('os').tmpdir(),
    `camera-folder-select-${Date.now()}.vbs`
  );
  
  const fs = require('fs');
  fs.writeFileSync(tmpVbs, vbsScript, 'utf8');

  try {
    // 先用 chcp 65001 切换到 UTF-8 代码页，再执行 VBScript
    const command = `chcp 65001 >nul & cscript //Nologo "${tmpVbs}"`;
    const { stdout } = await execPromise(command, { 
      timeout,
      windowsHide: false,
      encoding: 'utf8'
    });
    return stdout.trim() || null;
  } finally {
    try { fs.unlinkSync(tmpVbs); } catch (e) { /* ignore */ }
  }
}

/**
 * 选择文件夹 - 自动选择最佳方式
 * @returns {Promise<string|null>} 选中的路径，null 表示用户取消
 */
async function selectFolder() {
  // 优先尝试 Electron IPC 模式
  if (process.env.ELECTRON_STANDALONE === 'true' && process.send) {
    try {
      console.log('[selectFolder] 尝试 IPC 模式...');
      const result = await selectFolderViaIPC();
      console.log('[selectFolder] IPC 模式成功:', result);
      return result;
    } catch (err) {
      console.warn('[selectFolder] IPC 模式失败:', err.message, ', 回退到 PowerShell');
    }
  }

  // 回退: PowerShell
  if (process.platform === 'win32') {
    try {
      console.log('[selectFolder] 尝试 PowerShell 模式...');
      const result = await selectFolderViaPowerShell();
      console.log('[selectFolder] PowerShell 模式成功:', result);
      return result;
    } catch (err) {
      console.warn('[selectFolder] PowerShell 失败:', err.message, ', 尝试 VBScript');
    }

    // 最终回退: VBScript
    try {
      console.log('[selectFolder] 尝试 VBScript 模式...');
      const result = await selectFolderViaVBScript();
      console.log('[selectFolder] VBScript 模式成功:', result);
      return result;
    } catch (err) {
      console.error('[selectFolder] 所有方式均失败:', err.message);
      throw new Error('无法打开文件夹选择对话框: ' + err.message);
    }
  }

  // macOS
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      const script = `
        tell application "Finder"
          activate
          set selectedFolder to choose folder with prompt "请选择文件夹"
          return POSIX path of selectedFolder
        end tell
      `;
      const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());
      child.on('close', (code) => {
        if (code !== 0) {
          if (stderr.includes('User canceled') || stderr.includes('-128')) resolve(null);
          else reject(new Error(stderr || 'osascript failed'));
        } else {
          resolve(stdout.trim() || null);
        }
      });
      child.on('error', reject);
      setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 30000);
    });
  }

  // Linux
  try {
    const { stdout } = await execPromise('zenity --file-selection --directory', { timeout: 60000 });
    return stdout.trim() || null;
  } catch (err) {
    throw new Error('无法打开文件夹选择对话框');
  }
}

module.exports = { selectFolder };
