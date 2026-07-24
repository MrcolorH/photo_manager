/**
 * 追光功能 · 数据服务层
 *
 * 职责：
 *   1. 封装 Open-Meteo 两个 endpoint 的请求（forecast + air-quality）
 *   2. 城市收藏夹 CRUD（持久化到 config/lightHuntCities.json）
 *   3. 内置中国主要城市经纬度表（沿用 thunderstorm-forecast 技能 CITIES 思路）
 *
 * 不含评分逻辑（见 lightHuntScorer.js）。
 */

const fs = require('fs');
const path = require('path');

// ─── 内置城市表（经纬度来源：Open-Meteo geocoding，精度 0.01°）─────────────
const BUILTIN_CITIES = [
  { id: 'beijing', name: '北京', lat: 39.90, lon: 116.40 },
  { id: 'shanghai', name: '上海', lat: 31.23, lon: 121.47 },
  { id: 'hangzhou', name: '杭州', lat: 30.27, lon: 120.15 },
  { id: 'guangzhou', name: '广州', lat: 23.13, lon: 113.26 },
  { id: 'shenzhen', name: '深圳', lat: 22.54, lon: 114.05 },
  { id: 'chengdu', name: '成都', lat: 30.57, lon: 104.07 },
  { id: 'chongqing', name: '重庆', lat: 29.56, lon: 106.55 },
  { id: 'wuhan', name: '武汉', lat: 30.59, lon: 114.31 },
  { id: 'nanjing', name: '南京', lat: 32.04, lon: 118.78 },
  { id: 'xian', name: '西安', lat: 34.27, lon: 108.95 },
  { id: 'kunming', name: '昆明', lat: 24.88, lon: 102.83 },
  { id: 'haerbin', name: '哈尔滨', lat: 45.80, lon: 126.53 },
  { id: 'wulumuqi', name: '乌鲁木齐', lat: 43.83, lon: 87.62 },
  { id: 'lasa', name: '拉萨', lat: 29.65, lon: 91.13 },
  { id: 'haikou', name: '海口', lat: 20.04, lon: 110.20 },
  { id: 'sanya', name: '三亚', lat: 18.25, lon: 109.51 },
];

// ─── 收藏夹持久化 ────────────────────────────────────────────────────────
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const CITIES_PATH = path.join(CONFIG_DIR, 'lightHuntCities.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readCities() {
  ensureConfigDir();
  try {
    const data = fs.readFileSync(CITIES_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeCities(cities) {
  ensureConfigDir();
  fs.writeFileSync(CITIES_PATH, JSON.stringify(cities, null, 2), 'utf8');
}

/**
 * 查找城市：先查收藏夹（按 id 或 name），再查内置表（按 id 或 name）
 * @param {string} idOrName 收藏夹 id 或城市名（中文名）
 * @returns {{ id, name, lat, lon, priority? } | null}
 */
function findCity(idOrName) {
  if (!idOrName) return null;
  const saved = readCities();
  const hit =
    saved.find((c) => c.id === idOrName || c.name === idOrName) ||
    BUILTIN_CITIES.find((c) => c.id === idOrName || c.name === idOrName);
  return hit ? { ...hit } : null;
}

/**
 * 添加收藏城市
 * @param {{ name, lat, lon, priority? }} input
 */
function addCity(input) {
  const cities = readCities();
  const id = input.id || input.name.toLowerCase().replace(/\s+/g, '-');
  // 去重：同名城市已存在则更新
  const existingIdx = cities.findIndex((c) => c.name === input.name || c.id === id);
  const record = {
    id,
    name: input.name,
    lat: Number(input.lat),
    lon: Number(input.lon),
    priority: Boolean(input.priority),
  };
  if (existingIdx >= 0) cities[existingIdx] = record;
  else cities.push(record);
  writeCities(cities);
  return record;
}

function removeCity(id) {
  const cities = readCities().filter((c) => c.id !== id);
  writeCities(cities);
}

function setPriority(id, priority) {
  const cities = readCities();
  const idx = cities.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  cities[idx].priority = Boolean(priority);
  writeCities(cities);
  return cities[idx];
}

// ─── Open-Meteo fetcher ──────────────────────────────────────────────────

const FORECAST_FIELDS =
  'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,dew_point_2m,temperature_2m,cape,weather_code,showers,wind_direction_10m,wind_speed_10m';
const FORECAST_DAILY = 'sunrise,sunset';

/**
 * 拉 forecast endpoint（含雷暴 + 朝霞/晚霞 + 夜间云量所有字段）
 * @param {number} lat
 * @param {number} lon
 * @param {number} days 1-16（Open-Meteo forecast 最长 16 天）
 */
async function fetchForecastData(lat, lon, days = 7) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${FORECAST_FIELDS}&daily=${FORECAST_DAILY}` +
    `&timezone=auto&forecast_days=${Math.min(Math.max(days, 1), 16)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`forecast HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 拉 air-quality endpoint（AOD，仅 4.5 天预报窗口，W1 dry-run 已验证）
 * @param {number} lat
 * @param {number} lon
 * @param {number} days 上限 5，超出无效
 */
async function fetchAerosolData(lat, lon, days = 5) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=aerosol_optical_depth&timezone=auto&forecast_days=${Math.min(Math.max(days, 1), 5)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`air-quality HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 综合拉取：forecast + air-quality 一次合并（朝霞/晚霞算法需要双请求）
 * 失败容忍：air-quality 失败时返回 aod: null（评分模块走 fallback）
 */
async function fetchAll(lat, lon, days = 7) {
  const [forecast, aerosol] = await Promise.allSettled([
    fetchForecastData(lat, lon, days),
    fetchAerosolData(lat, lon, Math.min(days, 5)),
  ]);
  if (forecast.status !== 'fulfilled') {
    throw forecast.reason; // forecast 是核心数据，失败则整体抛
  }
  return {
    forecast: forecast.value,
    aerosol: aerosol.status === 'fulfilled' ? aerosol.value : null,
    aerosolError: aerosol.status === 'rejected' ? aerosol.reason.message : null,
  };
}

module.exports = {
  BUILTIN_CITIES,
  readCities,
  writeCities,
  findCity,
  addCity,
  removeCity,
  setPriority,
  fetchForecastData,
  fetchAerosolData,
  fetchAll,
};
