/**
 * AOD550 亚太覆盖率验证（W1 dry-run）
 *
 * 目的：验证 Open-Meteo 的 aerosol_optical_depth 字段在亚太城市的返回情况，
 * 决定追光功能的朝霞算法能否直接上线，否则需要 fallback 默认值。
 *
 * 用法：node aod550_probe.js
 * 依赖：仅 Node 标准库（https），无第三方包
 */

const https = require('https');

const CITIES = [
  { name: '杭州', lat: 30.27, lon: 120.15 },
  { name: '北京', lat: 39.90, lon: 116.40 },
  { name: '广州', lat: 23.13, lon: 113.26 },
  { name: '成都', lat: 30.57, lon: 104.07 },
  { name: '乌鲁木齐', lat: 43.83, lon: 87.62 },
  { name: '上海', lat: 31.23, lon: 121.47 },
  { name: '哈尔滨', lat: 45.80, lon: 126.53 },
  { name: '昆明', lat: 24.88, lon: 102.83 },
];

function fetchCity(city) {
  return new Promise((resolve) => {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&hourly=aerosol_optical_depth&forecast_days=7`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ city, json, httpStatus: res.statusCode });
        } catch (e) {
          resolve({ city, error: `JSON parse: ${e.message}`, raw: data.slice(0, 300) });
        }
      });
    }).on('error', (e) => resolve({ city, error: e.message }));
  });
}

(async () => {
  console.log('='.repeat(72));
  console.log('AOD550 亚太覆盖率验证 · W1 dry-run');
  console.log(`时间：${new Date().toISOString()}`);
  console.log(`城市数：${CITIES.length} · 预报天数：7 · 字段：aerosol_optical_depth`);
  console.log('='.repeat(72));
  console.log('');

  const results = [];
  for (const city of CITIES) {
    const r = await fetchCity(city);
    if (r.error) {
      console.log(`[${city.name.padEnd(6)}] ERROR: ${r.error}`);
      if (r.raw) console.log(`         raw: ${r.raw}`);
      results.push({ city: city.name, status: 'ERROR', error: r.error });
      continue;
    }
    const hourly = r.json.hourly;
    if (!hourly || !hourly.aerosol_optical_depth) {
      console.log(`[${city.name.padEnd(6)}] 字段缺失 · 响应键: ${Object.keys(r.json).join(',')}`);
      console.log(`         原始: ${JSON.stringify(r.json).slice(0, 300)}`);
      results.push({ city: city.name, status: 'FIELD_MISSING' });
      continue;
    }
    const values = hourly.aerosol_optical_depth;
    const nonNull = values.filter((v) => v !== null && v !== undefined);
    const nullCount = values.length - nonNull.length;
    const nullRate = ((nullCount / values.length) * 100).toFixed(1);
    const min = nonNull.length ? Math.min(...nonNull).toFixed(3) : 'N/A';
    const max = nonNull.length ? Math.max(...nonNull).toFixed(3) : 'N/A';
    const mean = nonNull.length ? (nonNull.reduce((a, b) => a + b, 0) / nonNull.length).toFixed(3) : 'N/A';

    console.log(`[${city.name.padEnd(6)}] 总${values.length}h · 有效${nonNull.length}h (${100 - nullRate}%) · null率${nullRate}%`);
    console.log(`         min=${min}  max=${max}  mean=${mean}  http=${r.httpStatus}`);

    // 抽样前 3 个非 null 值
    const sample = nonNull.slice(0, 3).map((v) => v.toFixed(3));
    console.log(`         样本(前3): [${sample.join(', ')}]`);

    results.push({
      city: city.name,
      status: 'OK',
      total: values.length,
      valid: nonNull.length,
      nullRate: parseFloat(nullRate),
      min: parseFloat(min),
      max: parseFloat(max),
      mean: parseFloat(mean),
    });
  }

  console.log('');
  console.log('='.repeat(72));
  console.log('汇总结论');
  console.log('='.repeat(72));
  const okCities = results.filter((r) => r.status === 'OK');
  const okCoverage = okCities.filter((r) => r.nullRate < 30);
  console.log(`· ${okCities.length}/${CITIES.length} 城市字段可用`);
  console.log(`· ${okCoverage.length}/${CITIES.length} 城市 null 率 < 30%（可直接上线阈值）`);
  if (okCities.length > 0) {
    const avgNull = (okCities.reduce((a, r) => a + r.nullRate, 0) / okCities.length).toFixed(1);
    const avgMean = (okCities.reduce((a, r) => a + r.mean, 0) / okCities.length).toFixed(3);
    console.log(`· 平均 null 率：${avgNull}% · 平均 AOD550 均值：${avgMean}`);
  }
  console.log('');
  console.log('决策建议：');
  if (okCoverage.length >= CITIES.length * 0.75) {
    console.log('  ✅ AOD550 亚太覆盖率达标，朝霞算法可直接上线（aod_score 按原公式）');
  } else if (okCoverage.length >= CITIES.length * 0.5) {
    console.log('  ⚠️ 部分城市 AOD550 缺失，需 fallback：null 时 aod_score 用 0.3 默认值');
  } else {
    console.log('  ❌ AOD550 覆盖率不足，朝霞算法需降低 aod 权重或改用其他字段');
  }
})();
