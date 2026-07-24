/**
 * 追光 · 星轨评分（前端纯算法，零网络成本）
 *
 * 输入：后端 /api/light-hunt/forecast 返回的 night_cloud 数组 + 城市经纬度
 * 输出：每日星轨概率 + 蹲守建议（月相、月升月落、推荐窗口、500 法则）
 *
 * 评分公式（PRD R3.5 v1）：
 *   score = 0.6*moon_score + 0.4*cloud_score
 *   moon_score  = 1 - illumination          （新月=1最佳，满月=0最差）
 *   cloud_score = 1 - min(1, night_avg_cloud/60)  （云量<30%接近满分，>60%归零）
 */

import * as SunCalc from 'suncalc';

const W_MOON = 0.6;
const W_CLOUD = 0.4;

/**
 * 月相名称（中文）
 */
function phaseName(fraction, phase) {
  if (fraction < 0.05) return '新月';
  if (fraction > 0.95) return '满月';
  if (phase < 0.5) {
    if (fraction < 0.45) return '蛾眉月';
    if (fraction < 0.55) return '上弦月';
    return '盈凸月';
  }
  if (fraction < 0.45) return '残月';
  if (fraction < 0.55) return '下弦月';
  return '亏凸月';
}

function fmtHM(d) {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toTimeString().slice(0, 5);
}

/**
 * 500 法则单张最长曝光（秒）—— 不拖星轨/拖线
 * @param {number} focalLength 等效焦距（mm，已含裁切系数）
 */
function rule500(focalLength) {
  if (!focalLength || focalLength <= 0) return null;
  return Math.round(500 / focalLength);
}

/**
 * 对一个夜晚算星轨概率 + 蹲守建议
 * @param {{ date, sunset, next_sunrise, night_cloud_avg, night_cloud_high_avg }} night
 * @param {number} lat
 * @param {number} lon
 * @param {number} focalLength 等效焦距（用于 500 法则，可选）
 * @returns {{ date, score, level, moon_illumination, moon_phase, moonrise, moonset, best_window, cloud_score, cloud, recommendation }}
 */
function scoreNight(night, lat, lon, focalLength = 24) {
  const sunsetDate = new Date(night.sunset);
  const moonIllum = SunCalc.getMoonIllumination(sunsetDate);
  const moonTimes = SunCalc.getMoonTimes(sunsetDate, lat, lon);

  const illumination = moonIllum.fraction;
  const moonScore = 1 - illumination;

  const cloud = night.night_cloud_avg ?? 50;
  const cloudScore = 1 - Math.min(1, cloud / 60);

  const score = W_MOON * moonScore + W_CLOUD * cloudScore;
  const level = score >= 0.7 ? '高' : score >= 0.5 ? '中' : '低';

  // 推荐窗口：月落后到次日日出前（无月纯黑窗口）；若月不在白天，则整个夜间可用
  let bestWindow = '';
  if (moonTimes.set && moonTimes.set > sunsetDate) {
    const moonsetHM = fmtHM(moonTimes.set);
    const sunriseHM = night.next_sunrise
      ? fmtHM(new Date(night.next_sunrise))
      : '05:00';
    bestWindow = `${moonsetHM} 月落后 → ${sunriseHM} 晨光前`;
  } else {
    bestWindow = `${night.sunset_hm ?? '19:00'} 日落后 → ${night.next_sunrise_hm ?? '05:00'} 晨光前`;
  }

  // 建议文本
  let recommendation = '';
  if (score >= 0.7) {
    recommendation = `${phaseName(illumination, moonIllum.phase)} + 晴空，星轨拍摄窗口优秀，建议机位远离光污染`;
  } else if (score >= 0.5) {
    recommendation = `${phaseName(illumination, moonIllum.phase)}，条件尚可，可尝试拍摄`;
  } else if (illumination > 0.7) {
    recommendation = `${phaseName(illumination, moonIllum.phase)}过亮，星轨易被洗掉，可考虑月光风光`;
  } else {
    recommendation = `云量偏多，不推荐星轨`;
  }

  return {
    date: night.date,
    score: Number(score.toFixed(3)),
    level,
    moon_illumination: Number(illumination.toFixed(3)),
    moon_phase: phaseName(illumination, moonIllum.phase),
    moonrise: moonTimes.rise ? fmtHM(moonTimes.rise) : '—',
    moonset: moonTimes.set ? fmtHM(moonTimes.set) : '—',
    best_window: bestWindow,
    cloud_score: Number(cloudScore.toFixed(3)),
    cloud_avg: cloud,
    rule500_sec: rule500(focalLength),
    focal_length: focalLength,
    recommendation,
  };
}

/**
 * 批量算星轨评分
 * @param {Array} nightCloudArr night_cloud 数组（后端返回）
 * @param {number} lat
 * @param {number} lon
 * @param {number} focalLength
 */
export function scoreStartrail(nightCloudArr, lat, lon, focalLength = 24) {
  if (!Array.isArray(nightCloudArr)) return [];
  return nightCloudArr.map((n) => scoreNight(n, lat, lon, focalLength));
}

/**
 * 把四类预测（朝霞/晚霞/雷暴/星轨）按日聚合成柱状图数据
 * 每日取最大概率，用于 7 天柱状图
 */
export function aggregateDailyMax(forecastPayload, lat, lon) {
  const sunrise = (forecastPayload.sunrise_glow || []).map((d) => ({
    date: d.date, type: '朝霞', score: d.score, level: d.level, detail: d,
  }));
  const sunset = (forecastPayload.sunset_glow || []).map((d) => ({
    date: d.date, type: '晚霞', score: d.score, level: d.level, detail: d,
  }));
  const thunder = (forecastPayload.thunderstorm || []).map((d) => ({
    date: d.date, type: '雷暴', score: d.score, level: d.level, detail: d,
  }));
  const startrail = scoreStartrail(forecastPayload.night_cloud, lat, lon).map((d) => ({
    date: d.date, type: '星轨', score: d.score, level: d.level, detail: d,
  }));

  const byDate = {};
  for (const item of [...sunrise, ...sunset, ...thunder, ...startrail]) {
    if (!byDate[item.date]) byDate[item.date] = [];
    byDate[item.date].push(item);
  }

  return Object.keys(byDate)
    .sort()
    .map((date) => ({
      date,
      items: byDate[date],
      maxScore: Math.max(...byDate[date].map((i) => i.score)),
    }));
}

/**
 * 等级 → 颜色（和后端 level 字段对应）
 */
export const LEVEL_COLORS = {
  低: '#94a3b8', // 灰
  中: '#f59e0b', // 橙
  高: '#ef4444', // 红
  很高: '#dc2626',
  极端: '#7f1d1d',
};

/**
 * 天象类型 → 颜色
 */
export const TYPE_COLORS = {
  朝霞: '#f59e0b', // 橙
  晚霞: '#dc2626', // 深红
  雷暴: '#3b82f6', // 蓝
  星轨: '#8b5cf6', // 紫
};
