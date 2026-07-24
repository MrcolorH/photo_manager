/**
 * 追光功能 · 评分模块
 *
 * 职责：把 Open-Meteo 原始数据转成"概率分 + 等级 + 蹲守提示"
 *   - scoreSunriseGlow / scoreSunsetGlow：朝霞/晚霞评分（cloud + dew + aod，第5-7天 aod fallback）
 *   - scoreThunderstorm：雷暴风险等级（CAPE + weather_code + showers 三信号，低/中/高/很高/极端）
 *   - extractNightCloud：夜间云量提取（给前端 suncalc 算星轨用，后端不重复算月相）
 *
 * 评分公式见 PRD R3 / R3.5，权重 W1 dry-run 校准后可热更新。
 */

const AOD_FALLBACK = 0.3; // 第 5-7 天 AOD 缺失时的保守降权值
const W_CLOUD = 0.5; // 低云量权重
const W_DEW = 0.3; // 露点差权重
const W_AOD = 0.2; // 气溶胶权重

// ─── 辅助 ────────────────────────────────────────────────────────────────
function parseTime(s) {
  return Date.parse(s); // Open-Meteo timezone=auto 返回无 Z 后缀本地时间，按本地时区解析
}

function fmtHM(s) {
  if (!s) return null;
  const m = String(s).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function findHourIndex(times, targetTs, offsetHours = 0) {
  const target = targetTs + offsetHours * 3600000;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(parseTime(times[i]) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

// ─── 朝霞 / 晚霞评分（同算法，仅窗口在日出 vs 日落）─────────────────────────
function scoreGlow(forecast, aerosol, type) {
  const daily = forecast.daily;
  const hourly = forecast.hourly;
  const events = daily[type];
  if (!events) return [];

  const result = [];
  for (let d = 0; d < events.length; d++) {
    const eventTs = parseTime(events[d]);
    const winStart = eventTs - 3600000; // 事件前 1h
    const winEnd = eventTs + 3600000; // 事件后 1h

    // 窗口内 hourly 索引
    const idxsInWin = [];
    for (let i = 0; i < hourly.time.length; i++) {
      const t = parseTime(hourly.time[i]);
      if (t >= winStart && t <= winEnd) idxsInWin.push(i);
    }

    // cloud_cover_low 均值（30%-70% 是好霞光窗口）
    const cloudVals = idxsInWin.map((i) => hourly.cloud_cover_low[i]).filter((v) => v != null);
    const cloudAvg = cloudVals.length ? cloudVals.reduce((a, b) => a + b, 0) / cloudVals.length : 50;
    const cloudScore = Math.max(0, 1 - Math.abs(cloudAvg - 50) / 50);

    // 露点差（取事件小时）
    const eIdx = findHourIndex(hourly.time, eventTs);
    const temp = hourly.temperature_2m[eIdx];
    const dew = hourly.dew_point_2m[eIdx];
    const dewDiff = temp != null && dew != null ? temp - dew : 0;
    const dewScore = Math.min(1, Math.max(0, dewDiff) / 5);

    // AOD（取事件小时，第 5-7 天 fallback）
    let aod = AOD_FALLBACK;
    let aodFallback = true;
    if (aerosol && aerosol.hourly) {
      const aodIdx = findHourIndex(aerosol.hourly.time, eventTs);
      const aodVal = aerosol.hourly.aerosol_optical_depth[aodIdx];
      if (aodVal != null) {
        aod = aodVal;
        aodFallback = false;
      }
    }
    const aodScore = Math.min(1, aod / 0.5);

    const score = W_CLOUD * cloudScore + W_DEW * dewScore + W_AOD * aodScore;

    result.push({
      date: events[d].slice(0, 10),
      event_time: events[d],
      event_hm: fmtHM(events[d]),
      window:
        idxsInWin.length > 0
          ? `${fmtHM(hourly.time[idxsInWin[0]])}–${fmtHM(hourly.time[idxsInWin[idxsInWin.length - 1]])}`
          : null,
      cloud_cover_low_avg: Number(cloudAvg.toFixed(1)),
      dew_diff: Number(dewDiff.toFixed(2)),
      aod: Number(aod.toFixed(3)),
      aod_fallback: aodFallback,
      score: Number(score.toFixed(3)),
      level: score >= 0.7 ? '高' : score >= 0.5 ? '中' : '低',
      direction: type === 'sunrise' ? '东偏南' : '西偏北',
    });
  }
  return result;
}

function scoreSunriseGlow(f, a) {
  return scoreGlow(f, a, 'sunrise');
}
function scoreSunsetGlow(f, a) {
  return scoreGlow(f, a, 'sunset');
}

// ─── 雷暴风险等级（CAPE + weather_code + showers 三信号）───────────────────
const THUNDERSTORM_CODES = new Set([95, 96, 99]);

function scoreThunderstorm(forecast) {
  const hourly = forecast.hourly;
  if (!hourly || !hourly.time) return [];

  // 按日期分组小时索引
  const byDate = {};
  for (let i = 0; i < hourly.time.length; i++) {
    const ds = hourly.time[i].slice(0, 10);
    if (!byDate[ds]) byDate[ds] = [];
    byDate[ds].push(i);
  }

  const result = [];
  for (const ds of Object.keys(byDate)) {
    const idxs = byDate[ds];
    let maxCape = 0;
    let hasThunder = false;
    let maxShowers = 0;
    const riskHours = [];

    for (const i of idxs) {
      const cape = hourly.cape ? hourly.cape[i] || 0 : 0;
      const wc = hourly.weather_code ? hourly.weather_code[i] : null;
      const showers = hourly.showers ? hourly.showers[i] || 0 : 0;
      const isT = THUNDERSTORM_CODES.has(wc);

      if (cape > maxCape) maxCape = cape;
      if (showers > maxShowers) maxShowers = showers;
      if (isT) hasThunder = true;

      // 高风险时段：CAPE≥1500 或雷暴代码 或 (CAPE≥1000 且 对流阵雨>0.5mm)
      if (cape >= 1500 || isT || (cape >= 1000 && showers > 0.5)) {
        riskHours.push({
          time: hourly.time[i],
          hm: fmtHM(hourly.time[i]),
          cape: Math.round(cape),
          weather_code: wc,
          showers: Number(showers.toFixed(2)),
        });
      }
    }

    // 综合等级
    let level;
    let score;
    if (hasThunder && maxCape >= 2500 && maxShowers > 1) {
      level = '极端';
      score = 0.95;
    } else if (hasThunder && maxCape >= 1500) {
      level = '很高';
      score = 0.85;
    } else if (hasThunder || maxCape >= 2000) {
      level = '高';
      score = 0.7;
    } else if (maxCape >= 1000) {
      level = '中';
      score = 0.5;
    } else {
      level = '低';
      score = 0.2;
    }

    result.push({
      date: ds,
      max_cape: Math.round(maxCape),
      has_thunderstorm: hasThunder,
      max_showers: Number(maxShowers.toFixed(2)),
      level,
      score: Number(score.toFixed(3)),
      risk_hours: riskHours,
    });
  }
  return result;
}

// ─── 夜间云量提取（给前端 suncalc 算星轨用）───────────────────────────────
function extractNightCloud(forecast) {
  const daily = forecast.daily;
  const hourly = forecast.hourly;
  if (!daily || !daily.sunset) return [];

  const result = [];
  for (let d = 0; d < daily.sunset.length; d++) {
    const sunsetTs = parseTime(daily.sunset[d]);
    // 夜 = 当天日落到次日日出
    const nextSunriseTs = daily.sunrise[d + 1] ? parseTime(daily.sunrise[d + 1]) : sunsetTs + 8 * 3600000;

    const idxs = [];
    for (let i = 0; i < hourly.time.length; i++) {
      const t = parseTime(hourly.time[i]);
      if (t >= sunsetTs && t <= nextSunriseTs) idxs.push(i);
    }

    const cv = idxs.map((i) => hourly.cloud_cover[i]).filter((v) => v != null);
    const hv = idxs.map((i) => hourly.cloud_cover_high[i]).filter((v) => v != null);

    result.push({
      date: daily.sunset[d].slice(0, 10),
      sunset: daily.sunset[d],
      next_sunrise: daily.sunrise[d + 1] || null,
      sunset_hm: fmtHM(daily.sunset[d]),
      next_sunrise_hm: daily.sunrise[d + 1] ? fmtHM(daily.sunrise[d + 1]) : null,
      night_cloud_avg: cv.length ? Number((cv.reduce((a, b) => a + b, 0) / cv.length).toFixed(1)) : null,
      night_cloud_high_avg: hv.length ? Number((hv.reduce((a, b) => a + b, 0) / hv.length).toFixed(1)) : null,
      note: '前端用 suncalc 算月相 illumination + 此处夜间云量算星轨概率',
    });
  }
  return result;
}

module.exports = {
  scoreSunriseGlow,
  scoreSunsetGlow,
  scoreThunderstorm,
  extractNightCloud,
  AOD_FALLBACK,
  WEIGHTS: { cloud: W_CLOUD, dew: W_DEW, aod: W_AOD },
};
