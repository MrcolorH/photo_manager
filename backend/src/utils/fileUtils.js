const fs = require('fs').promises;
const path = require('path');

// 支持的文件扩展名
const FILE_EXTENSIONS = {
  jpg: ['.jpg', '.jpeg'],
  raw: ['.raw', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.raf', '.rw2'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.3gp']
};

// 获取文件类型
function getFileType(ext) {
  const lowerExt = ext.toLowerCase();
  for (const [type, extensions] of Object.entries(FILE_EXTENSIONS)) {
    if (extensions.includes(lowerExt)) {
      return type;
    }
  }
  return null;
}

// 递归扫描目录
async function scanDirectory(dirPath, files = [], basePath = null) {
  try {
    // 如果是第一次调用，设置 basePath
    if (!basePath) {
      basePath = dirPath;
    }
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // 跳过 macOS 隐藏文件（资源派生文件）
      if (entry.name.startsWith('._')) {
        continue;
      }
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // 递归扫描子目录
        await scanDirectory(fullPath, files, basePath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        const type = getFileType(ext);
        
        if (type) {
          const stats = await fs.stat(fullPath);
          files.push({
            name: entry.name,
            path: fullPath,
            relativePath: path.relative(basePath, fullPath),
            type: type,
            extension: ext.toLowerCase(),
            size: stats.size,
            modifiedTime: stats.mtime
          });
        }
      }
    }
  } catch (error) {
    console.error(`扫描目录失败: ${dirPath}`, error.message);
  }
  
  return files;
}

// 确保目录存在
async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// 复制文件（增量导入，不覆盖已存在的相同文件）
async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  
  // 检查目标文件是否已存在
  const exists = await fileExists(dest);
  
  if (exists) {
    // 文件已存在，检查是否是相同的文件
    const same = await isSameFile(src, dest);
    
    if (same) {
      // 文件已存在且内容相同，跳过复制
      return { path: dest, skipped: true };
    }
    
    // 文件存在但内容不同，不覆盖，返回跳过状态
    return { path: dest, skipped: true, reason: 'file_exists' };
  }
  
  // 文件不存在，执行复制
  await fs.copyFile(src, dest);
  return { path: dest, skipped: false };
}

// 删除文件
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    console.error(`删除文件失败: ${filePath}`, error.message);
    return false;
  }
}

// 获取文件名（不含扩展名）
function getFileNameWithoutExt(filename) {
  return path.basename(filename, path.extname(filename));
}

// 检查文件是否存在
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// 根据相对路径生成重命名后的文件名（将目录层级编码到文件名中）
function generateRenamedFilename(relativePath) {
  // 提取扩展名
  const ext = path.extname(relativePath);
  // 去掉扩展名的部分
  const nameWithoutExt = relativePath.slice(0, -ext.length || relativePath.length);
  // 将路径分隔符（\ 和 /）替换为 _
  const safeName = nameWithoutExt.replace(/[/\\]/g, '_');
  return safeName + ext;
}

// 比较两个文件是否相同（通过文件大小和修改时间）
async function isSameFile(srcPath, destPath) {
  try {
    const [srcStats, destStats] = await Promise.all([
      fs.stat(srcPath),
      fs.stat(destPath)
    ]);
    
    // 如果文件大小相同且修改时间相同，认为是同一个文件
    return srcStats.size === destStats.size && 
           srcStats.mtimeMs === destStats.mtimeMs;
  } catch {
    return false;
  }
}

module.exports = {
  FILE_EXTENSIONS,
  getFileType,
  scanDirectory,
  ensureDir,
  copyFile,
  deleteFile,
  getFileNameWithoutExt,
  fileExists,
  isSameFile,
  generateRenamedFilename
};
