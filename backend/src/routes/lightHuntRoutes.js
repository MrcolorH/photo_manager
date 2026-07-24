/**
 * 追光功能 · 路由层
 *
 * 挂载点：/api/light-hunt
 * 端点：
 *   城市收藏夹：
 *     GET    /cities              列出收藏 + 内置城市
 *     POST   /cities              添加收藏 { name, lat, lon, priority? }
 *     DELETE /cities/:id           删除收藏
 *     PUT    /cities/:id/priority  设置重点城市 { priority: bool }
 *     GET    /builtin              内置城市表（供前端选择）
 *   预测：
 *     GET    /forecast/:cityId              综合预测（朝霞/晚霞/雷暴/夜间云量）
 *     GET    /forecast-by-coord?lat=&lon=   临时经纬度查询
 *     GET    /thunderstorm/:cityId          单独雷暴
 *     GET    /sunrise-sunset/:cityId         单独朝霞/晚霞
 */

const express = require('express');
const router = express.Router();

const service = require('../services/lightHuntService');
const scorer = require('../services/lightHuntScorer');

// ─── 城市收藏夹 ──────────────────────────────────────────────────────────
router.get('/cities', (req, res) => {
  res.json({ saved: service.readCities(), builtin: service.BUILTIN_CITIES });
});

router.post('/cities', (req, res) => {
  const { name, lat, lon, priority } = req.body;
  if (!name || lat == null || lon == null) {
    return res.status(400).json({ error: '需要 name, lat, lon' });
  }
  const record = service.addCity({
    name,
    lat: Number(lat),
    lon: Number(lon),
    priority: Boolean(priority),
  });
  res.json(record);
});

router.delete('/cities/:id', (req, res) => {
  service.removeCity(req.params.id);
  res.json({ ok: true });
});

router.put('/cities/:id/priority', (req, res) => {
  const updated = service.setPriority(req.params.id, req.body.priority);
  if (!updated) return res.status(404).json({ error: '城市不存在' });
  res.json(updated);
});

router.get('/builtin', (req, res) => {
  res.json(service.BUILTIN_CITIES);
});

// ─── 预测端点 ──────────────────────────────────────────────────────────────

/**
 * 构建综合预测 payload（forecast + air-quality 双请求 + 四类评分）
 */
async function buildForecastPayload(city, days) {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 16);
  const { forecast, aerosol, aerosolError } = await service.fetchAll(city.lat, city.lon, safeDays);
  return {
    city,
    sunrise_glow: scorer.scoreSunriseGlow(forecast, aerosol),
    sunset_glow: scorer.scoreSunsetGlow(forecast, aerosol),
    thunderstorm: scorer.scoreThunderstorm(forecast),
    night_cloud: scorer.extractNightCloud(forecast),
    aerosol_error: aerosolError,
    weights: scorer.WEIGHTS,
    fetched_at: new Date().toISOString(),
  };
}

// 综合预测（追光页签首屏主用）
router.get('/forecast/:cityId', async (req, res) => {
  try {
    const city = service.findCity(req.params.cityId);
    if (!city) return res.status(404).json({ error: `未知城市: ${req.params.cityId}（先加入收藏夹或用内置城市 id）` });
    const payload = await buildForecastPayload(city, req.query.days);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 临时经纬度查询（"今日追光"临时地点，不入收藏夹）
router.get('/forecast-by-coord', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (lat == null || lon == null) {
      return res.status(400).json({ error: '需要 lat, lon 查询参数' });
    }
    const city = { name: '临时地点', lat: Number(lat), lon: Number(lon), priority: false };
    const payload = await buildForecastPayload(city, req.query.days);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 单独雷暴（雷暴页/通知用）
router.get('/thunderstorm/:cityId', async (req, res) => {
  try {
    const city = service.findCity(req.params.cityId);
    if (!city) return res.status(404).json({ error: `未知城市: ${req.params.cityId}` });
    const days = Math.min(Number(req.query.days) || 7, 16);
    const forecast = await service.fetchForecastData(city.lat, city.lon, days);
    res.json({
      city,
      thunderstorm: scorer.scoreThunderstorm(forecast),
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 单独朝霞/晚霞
router.get('/sunrise-sunset/:cityId', async (req, res) => {
  try {
    const city = service.findCity(req.params.cityId);
    if (!city) return res.status(404).json({ error: `未知城市: ${req.params.cityId}` });
    const payload = await buildForecastPayload(city, req.query.days);
    res.json({
      city: payload.city,
      sunrise_glow: payload.sunrise_glow,
      sunset_glow: payload.sunset_glow,
      aerosol_error: payload.aerosol_error,
      weights: payload.weights,
      fetched_at: payload.fetched_at,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
