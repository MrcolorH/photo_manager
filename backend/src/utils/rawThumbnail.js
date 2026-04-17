const sharp = require('sharp');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const execPromise = util.promisify(exec);

// exiftool vendored 版本的路径
const EXIFTOOL_PATH = path.join(__dirname, '../../node_modules/exiftool-vendored.pl/bin/exiftool');

// 提取RAW文件中的嵌入预览图
async function extractEmbeddedPreview(rawPath, width = 300) {
  console.log('\n--- 开始提取嵌入预览 ---');
  console.log('rawPath:', rawPath);
  console.log('exiftool路径:', EXIFTOOL_PATH);
  
  try {
    // 尝试多个可能的预览图标签
    const previewTags = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'];
    
    for (const tag of previewTags) {
      try {
        console.log(`\n尝试使用 exiftool 提取 ${tag}...`);
        
        // 使用命令行调用exiftool提取二进制数据
        const command = `"${EXIFTOOL_PATH}" -b -${tag} "${rawPath}"`;
        console.log('执行命令:', command);
        
        const { stdout, stderr } = await execPromise(command, {
          encoding: 'buffer',  // 以buffer形式接收输出
          maxBuffer: 50 * 1024 * 1024  // 50MB缓冲区
        });
        
        if (stdout && stdout.length > 1000) {
          console.log(`✅ 成功使用 ${tag} 提取预览图，大小: ${stdout.length} bytes`);
          
          // 验证是否是有效的JPEG数据
          if (stdout[0] === 0xFF && stdout[1] === 0xD8) {
            console.log('✅ 确认为有效的JPEG数据');
            
            // 调整大小后返回
            const thumbnailBuffer = await sharp(stdout)
              .resize(width, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            
            return thumbnailBuffer;
          } else {
            console.log('⚠️  提取的数据不是有效的JPEG格式，跳过');
            console.log('前2字节:', stdout[0].toString(16), stdout[1].toString(16));
          }
        } else {
          console.log(`⚠️  ${tag} 数据太小或不存在 (${stdout ? stdout.length : 0} bytes)`);
          if (stderr) {
            console.log('stderr:', stderr.toString().substring(0, 200));
          }
        }
      } catch (error) {
        console.log(`❌ ${tag} 提取失败:`, error.message);
        // 这个标签不存在，尝试下一个
        continue;
      }
    }
    
    console.log('❌ 所有预览图标签都提取失败');
    return null; // 没有嵌入预览
  } catch (error) {
    console.error('提取嵌入预览异常:', error.message);
    console.error('异常堆栈:', error.stack);
    return null;
  }
}

// 使用sharp解码RAW文件
async function decodeWithSharp(rawPath, width = 300, quality = 80) {
  try {
    const thumbnailBuffer = await sharp(rawPath)
      .resize(width, null, { withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    
    return thumbnailBuffer;
  } catch (error) {
    console.error('sharp解码失败:', error.message);
    throw error;
  }
}

// 生成RAW缩略图（三级降级策略）
async function generateRawThumbnail(rawPath, width = 300, quality = 80) {
  console.log('=== RAW缩略图生成开始 ===');
  console.log('rawPath:', rawPath);
  console.log('width:', width);
  console.log('quality:', quality);
  console.log('rawPath类型:', typeof rawPath);
  
  if (!rawPath || typeof rawPath !== 'string') {
    console.error('❌ rawPath无效:', rawPath);
    return null;
  }
  
  // 第1级：尝试提取嵌入预览
  const embeddedPreview = await extractEmbeddedPreview(rawPath, width);
  if (embeddedPreview) {
    console.log('✅ 使用嵌入预览图生成缩略图');
    return embeddedPreview;
  }
  
  // 第2级：使用sharp解码
  try {
    console.log('使用sharp解码RAW文件');
    const thumbnail = await decodeWithSharp(rawPath, width, quality);
    return thumbnail;
  } catch (error) {
    // 第3级：返回null，由调用方生成占位图
    console.error('RAW缩略图生成失败，将使用占位图');
    return null;
  }
}

module.exports = { generateRawThumbnail };
