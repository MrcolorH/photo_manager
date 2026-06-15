/**
 * 生成所有需要的图标文件
 * 运行: node scripts/generate-all-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS_DIR = path.join(__dirname, '..', 'electron', 'assets');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// 生成指定大小的蓝色相机图标 PNG
function generateCameraPNG(size) {
  const pixels = Buffer.alloc(size * (1 + size * 3));
  const scale = size / 32;
  
  for (let y = 0; y < size; y++) {
    const rowOff = y * (1 + size * 3);
    pixels[rowOff] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = rowOff + 1 + x * 3;
      const sx = x / scale;
      const sy = y / scale;
      
      const color = getPixelColor(sx, sy);
      pixels[px] = color[0];     // R
      pixels[px + 1] = color[1]; // G
      pixels[px + 2] = color[2]; // B
    }
  }
  
  return encodePNG(size, size, pixels);
}

function getPixelColor(x, y) {
  const blue = [0x18, 0x90, 0xff];
  const white = [0xff, 0xff, 0xff];
  const transparent = [0, 0, 0]; // unused for RGB

  // 圆角矩形背景 (0,0)-(32,32) radius=6
  if (!inRoundedRect(x, y, 0, 0, 32, 32, 6)) return transparent;
  
  // 相机身体: roundRect(5, 12, 22, 14, 2)
  if (inRoundedRect(x, y, 5, 12, 22, 14, 2)) return white;
  
  // 相机顶部突起: rect(11, 8, 10, 5)
  if (x >= 11 && x < 21 && y >= 8 && y < 13) return white;
  
  // 镜头外圈: circle(16, 19, 5)
  const dx = x - 16, dy = y - 19;
  if (dx * dx + dy * dy <= 25) return blue;
  
  // 镜头内圈: circle(16, 19, 3)
  if (dx * dx + dy * dy <= 9) return white;
  
  return blue; // 默认背景
}

function inRoundedRect(px, py, rx, ry, rw, rh, radius) {
  if (px < rx || px >= rx + rw || py < ry || py >= ry + rh) return false;
  // 检查四个角
  const corners = [
    [rx + radius, ry + radius],
    [rx + rw - radius, ry + radius],
    [rx + radius, ry + rh - radius],
    [rx + rw - radius, ry + rh - radius]
  ];
  for (const [cx, cy] of corners) {
    const inCornerRegion = 
      (px < rx + radius && py < ry + radius) ||
      (px >= rx + rw - radius && py < ry + radius) ||
      (px < rx + radius && py >= ry + rh - radius) ||
      (px >= rx + rw - radius && py >= ry + rh - radius);
    if (inCornerRegion) {
      const ddx = px - cx, ddy = py - cy;
      if (ddx * ddx + ddy * ddy > radius * radius) return false;
    }
  }
  return true;
}

function encodePNG(width, height, rawData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // 8-bit RGB
  const ihdr = createChunk('IHDR', ihdrData);
  
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

var crc32Table;
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32Table[i] = c >>> 0;
    }
  }
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成 32x32 托盘图标
const tray32 = generateCameraPNG(32);
fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), tray32);
console.log('✅ tray-icon.png (32x32)');

// ⽣成 512x512 应⽤图标 (electron-builder macOS 要求至少 512x512)
const app512 = generateCameraPNG(512);
fs.writeFileSync(path.join(ASSETS_DIR, 'app-icon.png'), app512);
console.log('✅ app-icon.png (512x512)');

// 同时生成 ICO 格式 (多分辨率: 16, 32, 48, 64, 128, 256)
const icoPath = path.join(ASSETS_DIR, 'app-icon.ico');
const ico = createICO([16, 32, 48, 64, 128, 256].map(s => ({ size: s, png: generateCameraPNG(s) })));
fs.writeFileSync(icoPath, ico);
console.log('✅ app-icon.ico (多分辨率 ICO)');

function createICO(images) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type: ICO
  header.writeUInt16LE(images.length, 4); // count
  
  // Each entry: 16 bytes
  let dataOffset = 6 + images.length * 16;
  const entries = [];
  const pngBuffers = [];
  
  for (const img of images) {
    const entry = Buffer.alloc(16);
    const s = img.size;
    entry[0] = s >= 256 ? 0 : s;       // width (0 = 256)
    entry[1] = s >= 256 ? 0 : s;       // height (0 = 256)
    entry[2] = 0;                       // color palette
    entry[3] = 0;                       // reserved
    entry.writeUInt16LE(1, 4);          // color planes
    entry.writeUInt16LE(32, 6);         // bits per pixel
    entry.writeUInt32LE(img.png.length, 8); // image data size
    entry.writeUInt32LE(dataOffset, 12);    // offset to image data
    entries.push(entry);
    pngBuffers.push(img.png);
    dataOffset += img.png.length;
  }
  
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

console.log('\n所有图标已生成!');
