const sharp = require('sharp');
const { exiftool } = require('exiftool-vendored');
const fs = require('fs').promises;
const path = require('path');

// 提取RAW文件中的嵌入预览图
async function extractEmbeddedPreview(rawPath, width = 300) {
  console.log('\n--- 开始提取嵌入预览 ---');
  console.log('rawPath:', rawPath);
  
  try {
    // 检查文件是否存在
    await fs.access(rawPath);
    console.log('✅ 文件存在');
    
    // 尝试多个可能的预览图标签
    const previewTags = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'];
    
    for (const tag of previewTags) {
      try {
        console.log(`\n尝试提取 ${tag}...`);
        
        // 使用 exiftool-vendored API 提取二进制预览图到Buffer
        const buffer = await exiftool.extractBinaryTagToBuffer(tag, rawPath);
        
        if (buffer && buffer.length > 1000) {
          console.log(`✅ 成功提取 ${tag}，大小: ${buffer.length} bytes`);
          
          // 验证是否是有效的JPEG数据
          if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            console.log('✅ 确认为有效的JPEG数据');
            
            // 调整大小后返回
            const thumbnailBuffer = await sharp(buffer)
              .resize(width, null, { withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            
            return thumbnailBuffer;
          } else {
            console.log('⚠️  提取的数据不是有效的JPEG格式，跳过');
            console.log('前2字节:', buffer[0].toString(16), buffer[1].toString(16));
          }
        } else {
          console.log(`⚠️  ${tag} 数据太小或不存在 (${buffer ? buffer.length : 0} bytes)`);
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
  console.log('\n=== RAW缩略图生成开始 ===');
  console.log('rawPath:', rawPath);
  console.log('width:', width);
  console.log('quality:', quality);
  console.log('rawPath类型:', typeof rawPath);
  console.log('rawPath长度:', rawPath ? rawPath.length : 0);
  
  if (!rawPath || typeof rawPath !== 'string') {
    console.error('❌ rawPath无效:', rawPath);
    return null;
  }
  
  // 检查文件是否存在
  const fs = require('fs').promises;
  try {
    await fs.access(rawPath);
    console.log('✅ RAW文件存在');
    
    // 获取文件信息
    const stats = await fs.stat(rawPath);
    console.log('文件大小:', stats.size, 'bytes');
    console.log('文件扩展名:', require('path').extname(rawPath));
  } catch (err) {
    console.error('❌ RAW文件不存在或无法访问:', rawPath);
    console.error('错误信息:', err.message);
    return null;
  }
  
  // 第1级：尝试提取嵌入预览
  console.log('\n--- 开始第1级：提取嵌入预览 ---');
  const embeddedPreview = await extractEmbeddedPreview(rawPath, width);
  if (embeddedPreview) {
    console.log('✅ 使用嵌入预览图生成缩略图，大小:', embeddedPreview.length, 'bytes');
    return embeddedPreview;
  }
  
  // 第2级：使用sharp解码
  console.log('\n--- 开始第2级：使用sharp解码 ---');
  try {
    console.log('使用sharp解码RAW文件');
    const thumbnail = await decodeWithSharp(rawPath, width, quality);
    console.log('✅ sharp解码成功，大小:', thumbnail.length, 'bytes');
    return thumbnail;
  } catch (error) {
    // 第3级：返回null，由调用方生成占位图
    console.error('❌ RAW缩略图生成失败，将使用占位图');
    console.error('错误详情:', error.message);
    return null;
  }
}

module.exports = { generateRawThumbnail };
