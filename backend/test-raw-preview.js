const { exiftool } = require('exiftool-vendored');
const path = require('path');

// 测试exiftool提取RAW预览图
async function testExtractPreview() {
  // 请修改为您的RAW文件路径
  const testRawPath = '/Users/colorh/Pictures/相机照片/raw/test.arw'; // 修改为实际路径
  
  try {
    console.log('测试文件:', testRawPath);
    
    // 先读取元数据，看看有哪些可用的标签
    console.log('\n=== 读取元数据 ===');
    const tags = await exiftool.read(testRawPath);
    console.log('可用的预览相关标签:');
    
    const previewRelatedTags = Object.keys(tags).filter(key => 
      key.toLowerCase().includes('preview') || 
      key.toLowerCase().includes('thumbnail') ||
      key.toLowerCase().includes('jpgfromraw')
    );
    
    if (previewRelatedTags.length > 0) {
      previewRelatedTags.forEach(tag => {
        console.log(`  - ${tag}: ${typeof tags[tag]} (${tags[tag] ? '有数据' : '无数据'})`);
      });
    } else {
      console.log('  未找到预览相关的标签');
    }
    
    // 尝试提取二进制预览图
    console.log('\n=== 尝试提取预览图 ===');
    const previewTags = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'];
    
    for (const tag of previewTags) {
      try {
        console.log(`\n尝试提取 ${tag}...`);
        const binaryData = await exiftool.extractBinaryTag(testRawPath, tag);
        
        if (binaryData && binaryData.length > 0) {
          console.log(`✅ 成功提取 ${tag}，大小: ${binaryData.length} bytes`);
          
          // 检查是否是有效的JPEG（JPEG文件以FFD8开头）
          if (binaryData[0] === 0xFF && binaryData[1] === 0xD8) {
            console.log('✅ 这是有效的JPEG数据');
          } else {
            console.log('⚠️  这不是标准的JPEG格式');
          }
          
          return; // 成功提取一个就退出
        } else {
          console.log(`❌ ${tag} 不存在或为空`);
        }
      } catch (error) {
        console.log(`❌ ${tag} 提取失败:`, error.message);
      }
    }
    
    console.log('\n❌ 所有预览图标签都提取失败');
    
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await exiftool.end();
  }
}

testExtractPreview();
