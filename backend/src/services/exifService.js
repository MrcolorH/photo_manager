// EXIF 读取服务：基于 exiftool-vendored，提供精简与完整两种读取模式
// 注意：exiftool-vendored 是异步的，每个文件读取约 100ms，
// 导入时逐个读取即可（不需要并发），避免同时占用过多 exiftool 子进程

const { exiftool } = require('exiftool-vendored');

// 读取精简 EXIF 信息（用于清单存储与列表筛选）
// 异常时返回 null，不抛错（避免单个文件失败阻断整体导入）
async function readKeyExif(filePath) {
  try {
    const tags = await exiftool.read(filePath);
    // 调试日志：帮助排查 exiftool 返回的字段名/值
    console.log(`[EXIF DEBUG] ${filePath}`, {
      DateTimeOriginal: tags.DateTimeOriginal,
      Make: tags.Make,
      Model: tags.Model,
      LensModel: tags.LensModel,
      FocalLength: tags.FocalLength,
      FNumber: tags.FNumber,
      ISO: tags.ISO,
      ExposureTime: tags.ExposureTime,
      GPSLatitude: tags.GPSLatitude,
      GPSLongitude: tags.GPSLongitude
    });
    return {
      // 保留原始格式字符串如 "2024:03:15 14:30:00"
      dateTimeOriginal: tags.DateTimeOriginal != null
        ? String(tags.DateTimeOriginal)
        : null,
      make: tags.Make || null,
      model: tags.Model || null,
      lensModel: tags.LensModel || null,
      focalLength: tags.FocalLength != null ? Number(tags.FocalLength) : null,
      fNumber: tags.FNumber != null ? Number(tags.FNumber) : null,
      iso: tags.ISO != null ? Number(tags.ISO) : null,
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
    const tags = await exiftool.read(filePath);
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
