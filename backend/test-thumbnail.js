const { generateRawThumbnail } = require('./src/utils/rawThumbnail');
const path = require('path');

async function test() {
  const testFile = '/Volumes/EXP/相机存档/raw/DSC00004.ARW';
  
  console.log('测试文件:', testFile);
  console.log('文件是否存在:', require('fs').existsSync(testFile));
  
  try {
    const result = await generateRawThumbnail(testFile, 300, 80);
    
    if (result) {
      console.log('\n✅ 成功生成缩略图!');
      console.log('缩略图大小:', result.length, 'bytes');
      
      // 保存为文件以便查看
      const fs = require('fs').promises;
      const outputPath = '/tmp/test-raw-thumbnail.jpg';
      await fs.writeFile(outputPath, result);
      console.log('缩略图已保存到:', outputPath);
    } else {
      console.log('\n❌ 生成失败，返回null');
    }
  } catch (error) {
    console.error('\n❌ 发生错误:', error.message);
    console.error(error.stack);
  }
}

test();
