// EXIF 读取服务：基于 exiftool-vendored，提供精简与完整两种读取模式
// 注意：exiftool-vendored 是异步的，每个文件读取约 100ms

const { ExifTool, exiftool } = require('exiftool-vendored');
const fs = require('fs');

// 如果 Electron 注入了 EXIFTOOL_PATH 且文件存在，使用自定义实例
// 解决打包后库默认路径查找失败的问题
const customPath = process.env.EXIFTOOL_PATH;
const exiftoolInstance = (customPath && fs.existsSync(customPath))
  ? new ExifTool({ exiftoolPath: customPath })
  : exiftool;

// exiftool-vendored 返回的数值字段可能是带单位的字符串（如 "70 mm"、"f/4"），
// 直接用 Number() 会得到 NaN。这里从字符串中提取第一个合法数字。
function parseExifNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

// 读取精简 EXIF 信息（用于清单存储与列表筛选）
// 异常时返回 null，不抛错（避免单个文件失败阻断整体导入）
async function readKeyExif(filePath) {
  try {
    const tags = await exiftoolInstance.read(filePath);
    return {
      // 保留原始格式字符串如 "2024:03:15 14:30:00"
      dateTimeOriginal: tags.DateTimeOriginal != null
        ? String(tags.DateTimeOriginal)
        : null,
      make: tags.Make || null,
      model: tags.Model || null,
      lensModel: tags.LensModel || null,
      focalLength: parseExifNumber(tags.FocalLength),
      fNumber: parseExifNumber(tags.FNumber),
      iso: parseExifNumber(tags.ISO),
      exposureTime: tags.ExposureTime != null ? String(tags.ExposureTime) : null,
      gpsLat: tags.GPSLatitude != null ? tags.GPSLatitude : null,
      gpsLon: tags.GPSLongitude != null ? tags.GPSLongitude : null
    };
  } catch (error) {
    console.error(`读取 EXIF 失败: ${filePath}`, error.message);
    return null;
  }
}

// 读取完整 EXIF tags 对象（供详情面板使用）
// 异常时返回 null
async function readFullExif(filePath) {
  try {
    const tags = await exiftoolInstance.read(filePath);
    return tags;
  } catch (error) {
    console.error(`读取完整 EXIF 失败: ${filePath}`, error.message);
    return null;
  }
}

module.exports = {
  readKeyExif,
  readFullExif
};
