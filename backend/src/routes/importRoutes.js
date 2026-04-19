const express = require('express');
const router = express.Router();
const FileService = require('../services/fileService');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 存储仓库配置文件路径
const REPOS_CONFIG_PATH = path.join(__dirname, '../../data/repos.json');

// 确保数据目录存在
async function ensureDataDir() {
  const dataDir = path.dirname(REPOS_CONFIG_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// 读取存储仓库列表
async function getRepos() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(REPOS_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    // 根据操作系统设置默认路径
    let defaultPath;
    if (process.platform === 'win32') {
      // Windows: 使用用户图片目录
      defaultPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Pictures', '相机照片');
    } else if (process.platform === 'darwin') {
      // macOS: 使用用户图片目录
      defaultPath = path.join(process.env.HOME || '/Users/username', 'Pictures', '相机照片');
    } else {
      // Linux: 使用用户主目录
      defaultPath = path.join(process.env.HOME || '/home/username', 'Pictures', '相机照片');
    }
    
    // 默认仓库
    const defaultRepo = {
      id: 'default',
      name: '默认仓库',
      path: process.env.PHOTO_BASE_PATH || defaultPath,
      isDefault: true
    };
    await saveRepos([defaultRepo]);
    return [defaultRepo];
  }
}

// 保存存储仓库列表
async function saveRepos(repos) {
  await ensureDataDir();
  await fs.writeFile(REPOS_CONFIG_PATH, JSON.stringify(repos, null, 2));
}

// 获取默认照片路径（跨平台兼容）
function getDefaultPhotoPath() {
  if (process.env.PHOTO_BASE_PATH) {
    return process.env.PHOTO_BASE_PATH;
  }
  
  let defaultPath;
  if (process.platform === 'win32') {
    // Windows: 使用用户图片目录
    defaultPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Pictures', '相机照片');
  } else if (process.platform === 'darwin') {
    // macOS: 使用用户图片目录
    defaultPath = path.join(process.env.HOME || '/Users/username', 'Pictures', '相机照片');
  } else {
    // Linux: 使用用户主目录
    defaultPath = path.join(process.env.HOME || '/home/username', 'Pictures', '相机照片');
  }
  
  return defaultPath;
}

// 从存储卡导入照片（支持实时进度，使用 GET 以支持 SSE）
router.get('/', async (req, res) => {
  try {
    const { sourcePath, repoId } = req.query;
    
    if (!sourcePath) {
      // SSE 错误格式
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.write(`data: ${JSON.stringify({ type: 'error', error: '请提供存储卡路径' })}\n\n`);
      return res.end();
    }
    
    // 获取目标仓库路径
    const repos = await getRepos();
    let targetRepo;
    
    if (repoId) {
      targetRepo = repos.find(r => r.id === repoId);
    } else {
      targetRepo = repos.find(r => r.isDefault) || repos[0];
    }
    
    if (!targetRepo) {
      // SSE 错误格式
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.write(`data: ${JSON.stringify({ type: 'error', error: '未找到指定的存储仓库' })}\n\n`);
      return res.end();
    }
    
    // 如果路径是 AUTO，使用默认路径
    const repoPath = targetRepo.path === 'AUTO' ? getDefaultPhotoPath() : targetRepo.path;
    const fileService = new FileService(repoPath);
    
    // 设置 SSE 头部
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    console.log('开始导入，源路径:', sourcePath);
    console.log('目标仓库:', targetRepo.name);
    
    // 立即发送一个初始消息，确认连接已建立
    res.write(`data: ${JSON.stringify({ type: 'progress', data: { 
      total: 0, 
      processed: 0, 
      remaining: 0, 
      currentFile: '正在扫描文件...', 
      estimatedTimeRemaining: 0, 
      percentage: 0 
    }})}\n\n`);
    
    // 进度回调函数
    const progressCallback = (progress) => {
      try {
        const message = `data: ${JSON.stringify({ type: 'progress', data: progress })}\n\n`;
        res.write(message);
        console.log('发送进度:', progress.percentage + '% -', progress.currentFile);
      } catch (err) {
        console.error('发送进度失败:', err);
      }
    };
    
    // 执行导入
    const results = await fileService.importFromCard(sourcePath, progressCallback);
    
    console.log('导入完成，结果:', {
      jpg: results.jpg.length,
      raw: results.raw.length,
      video: results.video.length,
      errors: results.errors.length,
      skipped: results.skipped.length
    });
    
    // 发送最终结果
    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      data: {
        jpgCount: results.jpg.length,
        rawCount: results.raw.length,
        videoCount: results.video.length,
        errorCount: results.errors.length,
        skippedCount: results.skipped.length,
        targetRepo: targetRepo.name,
        details: results
      }
    })}\n\n`);
    
    res.end();
  } catch (error) {
    console.error('导入过程中出错:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// 获取默认导入路径
router.get('/default-path', async (req, res) => {
  try {
    let defaultPath;
    if (process.env.DEFAULT_IMPORT_PATH) {
      defaultPath = process.env.DEFAULT_IMPORT_PATH;
    } else {
      // 根据操作系统设置默认导入路径
      if (process.platform === 'win32') {
        // Windows: 使用 D:\ 或用户主目录
        defaultPath = 'D:\\';
      } else if (process.platform === 'darwin') {
        // macOS: 使用 /Volumes
        defaultPath = '/Volumes';
      } else {
        // Linux: 使用 /media
        defaultPath = '/media';
      }
    }
    
    res.json({
      success: true,
      data: {
        defaultPath
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取所有存储仓库
router.get('/repos', async (req, res) => {
  try {
    const repos = await getRepos();
    res.json({
      success: true,
      data: repos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 添加存储仓库
router.post('/repos', async (req, res) => {
  try {
    const { name, path: repoPath, isDefault } = req.body;
    
    if (!name || !repoPath) {
      return res.status(400).json({
        success: false,
        error: '请提供仓库名称和路径'
      });
    }
    
    // 检查路径是否存在
    try {
      await fs.access(repoPath);
    } catch {
      // 路径不存在，尝试创建
      await fs.mkdir(repoPath, { recursive: true });
    }
    
    const repos = await getRepos();
    
    // 如果设为默认，取消其他默认
    if (isDefault) {
      repos.forEach(r => r.isDefault = false);
    }
    
    const newRepo = {
      id: Date.now().toString(),
      name,
      path: repoPath,
      isDefault: isDefault || repos.length === 0
    };
    
    repos.push(newRepo);
    await saveRepos(repos);
    
    res.json({
      success: true,
      data: newRepo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除存储仓库
router.delete('/repos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const repos = await getRepos();
    
    const index = repos.findIndex(r => r.id === id);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: '仓库不存在'
      });
    }
    
    repos.splice(index, 1);
    
    // 如果删除的是默认仓库，设置第一个为默认
    if (repos.length > 0 && !repos.some(r => r.isDefault)) {
      repos[0].isDefault = true;
    }
    
    await saveRepos(repos);
    
    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 设置默认仓库
router.put('/repos/:id/default', async (req, res) => {
  try {
    const { id } = req.params;
    const repos = await getRepos();
    
    repos.forEach(r => {
      r.isDefault = (r.id === id);
    });
    
    await saveRepos(repos);
    
    res.json({
      success: true,
      message: '设置成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 打开文件夹选择对话框
router.get('/select-folder', async (req, res) => {
  try {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      // macOS - 使用 osascript 打开文件夹选择对话框
      // 使用 spawn 而不是 exec，以便更好地控制进程
      const result = await new Promise((resolve, reject) => {
        const script = `
          tell application "Finder"
            activate
            set selectedFolder to choose folder with prompt "请选择文件夹"
            return POSIX path of selectedFolder
          end tell
        `;
        
        const child = spawn('osascript', ['-e', script], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        child.on('close', (code) => {
          if (code !== 0) {
            if (stderr.includes('User canceled') || stderr.includes('-128')) {
              resolve(null); // 用户取消
            } else {
              reject(new Error(stderr || 'osascript failed'));
            }
          } else {
            resolve(stdout.trim());
          }
        });
        
        child.on('error', (err) => {
          reject(err);
        });
        
        // 30秒超时
        setTimeout(() => {
          child.kill();
          reject(new Error('timeout'));
        }, 30000);
      });
      
      if (!result) {
        return res.json({
          success: false,
          error: '用户取消选择'
        });
      }
      
      return res.json({
        success: true,
        data: {
          path: result
        }
      });
    } else if (platform === 'win32') {
      // Windows - 使用 PowerShell 和 .NET Framework
      console.log('开始打开文件夹选择对话框...');
      
      // 创建一个临时 PowerShell 脚本文件
      const tempScriptPath = path.join(__dirname, '../../temp-select-folder.ps1');
      const resultFilePath = path.join(__dirname, '../../temp-select-result.txt');
      const psScript = `
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    
    # 添加 Windows API 用于置顶窗口
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        
        public const int SW_RESTORE = 9;
    }
"@
    
    $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderBrowser.Description = "请选择文件夹"
    $folderBrowser.ShowNewFolderButton = $true
    $folderBrowser.RootFolder = [System.Environment+SpecialFolder]::MyComputer
    
    # 创建一个临时窗体作为父窗口，确保对话框置顶
    $tempForm = New-Object System.Windows.Forms.Form
    $tempForm.TopMost = $true
    $tempForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $tempForm.Size = New-Object System.Drawing.Size(1, 1)
    $tempForm.ShowInTaskbar = $false
    $tempForm.Opacity = 0
    $tempForm.Show()
    
    # 将临时窗体置顶
    [void][Win32]::SetForegroundWindow($tempForm.Handle)
    
    $result = $folderBrowser.ShowDialog($tempForm)
    
    # 关闭临时窗体
    $tempForm.Close()
    $tempForm.Dispose()
    
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        # 使用 UTF8 编码写入结果文件
        $folderBrowser.SelectedPath | Out-File -FilePath "${resultFilePath}" -Encoding UTF8
        Exit 0
    } else {
        Exit 1
    }
} catch {
    Write-Error $_.Exception.Message
    Exit 2
}
`;
      
      try {
        // 写入临时脚本文件（使用 UTF8 BOM 编码）
        const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
        const scriptContent = Buffer.concat([bom, Buffer.from(psScript, 'utf8')]);
        await fs.writeFile(tempScriptPath, scriptContent);
        
        console.log('PowerShell 脚本已创建:', tempScriptPath);
        
        // 删除之前的结果文件（如果存在）
        try {
          await fs.unlink(resultFilePath);
        } catch (e) {
          // 文件不存在，忽略
        }
        
        // 执行脚本
        const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tempScriptPath}"`;
        console.log('执行命令:', command);
        
        const { stdout, stderr } = await execPromise(command, { 
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024
        });
        
        console.log('PowerShell 标准输出:', stdout);
        if (stderr) {
          console.log('PowerShell 标准错误:', stderr);
        }
        
        // 从结果文件读取路径
        let selectedPath = '';
        try {
          selectedPath = await fs.readFile(resultFilePath, 'utf8');
          selectedPath = selectedPath.trim();
          console.log('从文件读取的路径:', selectedPath);
          
          // 删除结果文件
          await fs.unlink(resultFilePath);
        } catch (e) {
          console.log('无法读取结果文件，尝试从 stdout 获取:', e.message);
          selectedPath = stdout.trim();
        }
        
        // 删除临时脚本文件
        try {
          await fs.unlink(tempScriptPath);
          console.log('临时文件已删除');
        } catch (e) {
          console.error('删除临时文件失败:', e.message);
        }
        
        if (!selectedPath || selectedPath.length === 0) {
          console.log('用户取消选择或返回空路径');
          return res.json({
            success: false,
            error: '用户取消选择'
          });
        }
        
        console.log('成功选择路径:', selectedPath);
        return res.json({
          success: true,
          data: {
            path: selectedPath
          }
        });
      } catch (error) {
        console.error('=== PowerShell 执行错误 ===');
        console.error('错误消息:', error.message);
        console.error('错误代码:', error.code);
        console.error('错误信号:', error.signal);
        console.error('Killed:', error.killed);
        if (error.stdout) {
          console.error('标准输出:', error.stdout.toString());
        }
        if (error.stderr) {
          console.error('标准错误:', error.stderr.toString());
        }
        console.error('=========================');
        
        // 清理临时文件
        try {
          await fs.unlink(tempScriptPath);
        } catch (e) {
          // 忽略删除错误
        }
        try {
          await fs.unlink(resultFilePath);
        } catch (e) {
          // 忽略删除错误
        }
        
        // 判断是否是用户取消（退出码为1）
        if (error.code === 1 || 
            (error.message && error.message.includes('Exit code 1')) ||
            (error.stderr && error.stderr.toString().includes('Exit 1'))) {
          console.log('检测到用户取消');
          return res.json({
            success: false,
            error: '用户取消选择'
          });
        }
        
        return res.status(500).json({
          success: false,
          error: '打开文件夹选择对话框失败: ' + error.message
        });
      }
    } else {
      // Linux - 使用 zenity
      const command = `zenity --file-selection --directory`;
      const { stdout } = await execPromise(command, { timeout: 60000 });
      const selectedPath = stdout.trim();
      
      if (!selectedPath) {
        return res.json({
          success: false,
          error: '用户取消选择'
        });
      }
      
      return res.json({
        success: true,
        data: {
          path: selectedPath
        }
      });
    }
  } catch (error) {
    // 用户取消选择或超时
    if (error.message.includes('User canceled') || 
        error.message.includes('取消') ||
        error.message.includes('timeout') ||
        error.message.includes('error -128')) {
      return res.json({
        success: false,
        error: '用户取消选择'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
