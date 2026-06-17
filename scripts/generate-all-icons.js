/**
 * 拾光舱 · ShíGuāng Capsule — 品牌图标生成脚本
 * 设计: 金色渐变圆 + 白色相机轮廓
 * 渲染: 256×256 虚拟坐标 + SDF 抗锯齿
 * 运行: node scripts/generate-all-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS_DIR = path.join(__dirname, '..', 'electron', 'assets');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

const V = 256;          // 虚拟坐标尺寸
const S = V / 32;       // 缩放因子 (8)

// ---- 颜色工具 ----
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

const GOLD_TOP    = [0xf4, 0xc5, 0x76];
const GOLD_MID    = [0xd4, 0xa5, 0x74];
const GOLD_BOTTOM = [0xa0, 0x68, 0x30];

function gradientColor(t) {
  if (t < 0.5) return lerpColor(GOLD_TOP, GOLD_MID, t * 2);
  return lerpColor(GOLD_MID, GOLD_BOTTOM, (t - 0.5) * 2);
}

// ---- SDF 工具 ----
function sdfCircle(px, py, cx, cy, r) {
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r;
}

function sdfRoundedRect(px, py, rx, ry, rw, rh, radius) {
  const x0 = rx, y0 = ry, x1 = rx + rw, y1 = ry + rh;
  const cx = Math.max(x0 + radius, Math.min(px, x1 - radius));
  const cy = Math.max(y0 + radius, Math.min(py, y1 - radius));
  const dx = px - cx, dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  // 判断点在内部还是外部
  const inside = px >= x0 && px < x1 && py >= y0 && py < y1;
  if (inside) return -d + radius > 0 ? Math.min(0, radius - d) : -(radius - d);
  return d - radius;
}

// SDF 值转 alpha (负=内部, 0=边缘, 正=外部)
function sdfAlpha(d) {
  return Math.max(0, Math.min(1, 0.5 - d));
}

// ---- 设计参数 (V=256 坐标系) ----
const CX = 128, CY = 128, CR = 120;       // 背景圆
const BODY = { x: 64, y: 104, w: 128, h: 88, r: 20 };  // 相机身体
const VF = { x: 96, y: 80, w: 64, h: 32 };             // 取景器
const LENS_CX = 128, LENS_CY = 148;
const LENS_RO = 33.6, LENS_RI = 22.4, LENS_RC = 12.8;  // 外圈/内圈/芯
const IND_X = 168, IND_Y = 124, IND_R = 8;              // 指示灯

// ---- 像素着色 ----
function getPixelRGBA(x, y) {
  // 1. 背景圆 SDF
  const dCircle = sdfCircle(x, y, CX, CY, CR);
  if (dCircle > 1.0) return [0, 0, 0, 0];
  const bgAlpha = sdfAlpha(dCircle);

  // 金色渐变 (对角线)
  const t = (x + y) / (V * 2);
  const gold = gradientColor(t);

  // 2. 相机身体 (圆角矩形 SDF)
  const dBody = sdfRoundedRect(x, y, BODY.x, BODY.y, BODY.w, BODY.h, BODY.r);
  const bodyAlpha = sdfAlpha(dBody);

  // 3. 取景器突起 (矩形, 轻微圆角)
  const dVF = sdfRoundedRect(x, y, VF.x, VF.y, VF.w, VF.h, 6);
  const vfAlpha = sdfAlpha(dVF);

  // 4. 镜头外圈 (环形)
  const dLensOuter = Math.abs(sdfCircle(x, y, LENS_CX, LENS_CY, LENS_RO)) ;
  const ringWidth = (LENS_RO - LENS_RI);
  const dRing = Math.abs(sdfCircle(x, y, LENS_CX, LENS_CY, (LENS_RO + LENS_RI) / 2)) - ringWidth / 2;
  const ringAlpha = sdfAlpha(dRing);

  // 5. 镜头内芯
  const dCore = sdfCircle(x, y, LENS_CX, LENS_CY, LENS_RC);
  const coreAlpha = sdfAlpha(dCore);

  // 6. 镜头挖空区域 (让金色透出)
  const dLensHole = sdfCircle(x, y, LENS_CX, LENS_CY, LENS_RO);
  const holeAlpha = sdfAlpha(dLensHole);

  // 7. 指示灯
  const dInd = sdfCircle(x, y, IND_X, IND_Y, IND_R);
  const indAlpha = sdfAlpha(dInd);

  const white = [255, 255, 255];

  // 合成逻辑
  let color, alpha;

  // 相机身体或取景器区域
  const inBody = bodyAlpha > 0 || vfAlpha > 0;
  const maxBodyAlpha = Math.max(bodyAlpha, vfAlpha);

  if (inBody && ringAlpha > 0.01) {
    // 镜头环覆盖在身体上
    color = white;
    alpha = Math.max(maxBodyAlpha, ringAlpha * 0.85);
  } else if (inBody && holeAlpha > 0.5) {
    // 镜头挖空区域 - 金色透出
    if (coreAlpha > 0.01) {
      color = white;
      alpha = coreAlpha * 0.55;
    } else {
      color = gold;
      alpha = bgAlpha;
    }
  } else if (inBody) {
    color = white;
    alpha = maxBodyAlpha * 0.95;
  } else if (ringAlpha > 0.01) {
    color = white;
    alpha = ringAlpha * 0.85;
  } else if (coreAlpha > 0.01) {
    color = white;
    alpha = coreAlpha * 0.55;
  } else if (indAlpha > 0.01) {
    color = white;
    alpha = indAlpha * 0.6;
  } else {
    color = gold;
    alpha = bgAlpha;
  }

  if (alpha > bgAlpha) alpha = bgAlpha;

  return [
    Math.round(color[0]),
    Math.round(color[1]),
    Math.round(color[2]),
    Math.round(alpha * 255)
  ];
}

// ---- PNG 编码 ----
function generateCameraPNG(size) {
  const scale = size / V;

  // 小尺寸用超采样抗锯齿
  const useSSAA = size <= 128;
  const ssFactor = useSSAA ? 2 : 1;
  const ssSize = size * ssFactor;

  let ssData;
  if (useSSAA) {
    ssData = [];
    const ssScale = ssSize / V;
    for (let y = 0; y < ssSize; y++) {
      const row = [];
      for (let x = 0; x < ssSize; x++) {
        row.push(getPixelRGBA(x / ssScale, y / ssScale));
      }
      ssData.push(row);
    }
  }

  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOff = y * (1 + size * 4);
    rawData[rowOff] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = rowOff + 1 + x * 4;
      let rgba;
      if (useSSAA) {
        const bx = x * ssFactor, by = y * ssFactor;
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < ssFactor; dy++) {
          for (let dx = 0; dx < ssFactor; dx++) {
            const p = ssData[by + dy][bx + dx];
            r += p[0]; g += p[1]; b += p[2]; a += p[3];
          }
        }
        const n = ssFactor * ssFactor;
        rgba = [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
      } else {
        rgba = getPixelRGBA(x / scale, y / scale);
      }
      rawData[px]     = rgba[0];
      rawData[px + 1] = rgba[1];
      rawData[px + 2] = rgba[2];
      rawData[px + 3] = rgba[3];
    }
  }
  return encodePNG(size, size, rawData, 6);
}

function encodePNG(width, height, rawData, colorType) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = colorType;
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

// ---- ICO 编码 ----
function createICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let dataOffset = 6 + images.length * 16;
  const entries = [];
  const pngBuffers = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    const s = img.size;
    entry[0] = s >= 256 ? 0 : s;
    entry[1] = s >= 256 ? 0 : s;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    entries.push(entry);
    pngBuffers.push(img.png);
    dataOffset += img.png.length;
  }
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

// ---- 生成图标 ----
console.log('📸 拾光舱 · 品牌图标生成 (SDF 高质量)\n');

const tray32 = generateCameraPNG(32);
fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), tray32);
console.log('✅ tray-icon.png  (32×32  RGBA)');

const app512 = generateCameraPNG(512);
fs.writeFileSync(path.join(ASSETS_DIR, 'app-icon.png'), app512);
console.log('✅ app-icon.png  (512×512 RGBA)');

const icoPath = path.join(ASSETS_DIR, 'app-icon.ico');
const ico = createICO([16, 32, 48, 64, 128, 256].map(s => ({
  size: s,
  png: generateCameraPNG(s)
})));
fs.writeFileSync(icoPath, ico);
console.log('✅ app-icon.ico  (16~256 多分辨率 ICO)');

console.log('\n🎉 所有图标已生成!');
