/**
 * suncalc 月相抽检验证（W1 dry-run）
 *
 * 目的：验证 suncalc 月相 illumination + 月升月落 在不同纬度、未来 30 天的合理性，
 * 决定追光功能的星轨评分公式（0.6*moon_score + 0.4*cloud_score）能否直接用。
 *
 * 验证点：
 *   1. require('suncalc') 不报错
 *   2. illumination 在新月日接近 0、满月日接近 1
 *   3. 月升月落时间合理（不是 NaN/Invalid Date）
 *   4. 高纬度（哈尔滨 45.8°）无极地边界异常
 *
 * 用法：node moonphase_probe.js
 * 依赖：suncalc（npm install suncalc）
 */

const SunCalc = require('suncalc');

const CITIES = [
  { name: '杭州', lat: 30.27, lon: 120.15 },
  { name: '北京', lat: 39.90, lon: 116.40 },
  { name: '广州', lat: 23.13, lon: 113.26 },
  { name: '哈尔滨', lat: 45.80, lon: 126.53 }, // 高纬边界测试
];

function phaseName(fraction, phase) {
  // fraction = illumination 0-1, phase = 月相位置 0-1（0=新月,0.5=满,1=回到新月）
  if (fraction < 0.05) return '新月';
  if (fraction > 0.95) return '满月';
  if (phase < 0.5) {
    if (fraction < 0.45) return '蛾眉月';
    if (fraction < 0.55) return '上弦月';
    return '盈凸月';
  } else {
    if (fraction < 0.45) return '残月';
    if (fraction < 0.55) return '下弦月';
    return '亏凸月';
  }
}

function fmtTime(d) {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toTimeString().slice(0, 5);
}

function isStartrailWindow(illumination) {
  // 星轨评分 v1：moon_score = 1 - illumination，>= 0.7 即 illumination <= 0.3 视为高概率
  return illumination <= 0.3;
}

const today = new Date();
today.setHours(12, 0, 0, 0); // 正午，避免月升月落跨日判定问题

console.log('='.repeat(72));
console.log('suncalc 月相抽检 · W1 dry-run');
console.log(`时间：${new Date().toISOString()}`);
console.log(`城市数：${CITIES.length}（含高纬哈尔滨） · 抽检天数：30`);
console.log('='.repeat(72));
console.log('');

let totalChecks = 0;
let nanCount = 0;
const phaseStats = {};

for (const city of CITIES) {
  console.log(`\n【${city.name}】(${city.lat}, ${city.lon})`);
  console.log('日期        illum  phase    月升    月落    星轨窗口');
  console.log('-'.repeat(56));

  for (let d = 0; d < 30; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);

    const moonIllum = SunCalc.getMoonIllumination(date);
    const moonTimes = SunCalc.getMoonTimes(date, city.lat, city.lon);

    totalChecks++;
    if (isNaN(moonIllum.fraction)) nanCount++;
    if (moonTimes.rise && isNaN(moonTimes.rise.getTime())) nanCount++;
    if (moonTimes.set && isNaN(moonTimes.set.getTime())) nanCount++;

    const frac = moonIllum.fraction;
    const phase = moonIllum.phase;
    const name = phaseName(frac, phase);
    phaseStats[name] = (phaseStats[name] || 0) + 1;

    const startrail = isStartrailWindow(frac) ? '★ 高概率' : '';

    console.log(
      `${dateStr}  ${frac.toFixed(2)}   ${name.padEnd(6)}  ${fmtTime(moonTimes.rise).padEnd(6)} ${fmtTime(moonTimes.set).padEnd(6)} ${startrail}`
    );
  }
}

console.log('\n');
console.log('='.repeat(72));
console.log('汇总结论');
console.log('='.repeat(72));
console.log(`· 总检查点：${totalChecks}`);
console.log(`· NaN 异常：${nanCount}（理想为 0）`);
console.log(`· 月相分布：`);
Object.entries(phaseStats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, count]) => {
    console.log(`    ${name.padEnd(6)} ${count} 天`);
  });

// 找新月日和满月日
const allIllums = [];
for (const city of [CITIES[0]]) {
  for (let d = 0; d < 30; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const mi = SunCalc.getMoonIllumination(date);
    allIllums.push({ date: date.toISOString().slice(0, 10), frac: mi.fraction });
  }
}
const newMoons = allIllums.filter((x) => x.frac < 0.05);
const fullMoons = allIllums.filter((x) => x.frac > 0.95);
const minIllum = allIllums.reduce((a, b) => (b.frac < a.frac ? b : a));
const maxIllum = allIllums.reduce((a, b) => (b.frac > a.frac ? b : a));

console.log(`· 杭州 30 天 illumination 范围：${minIllum.frac.toFixed(3)} ~ ${maxIllum.frac.toFixed(3)}`);
console.log(`· 新月日（<0.05）：${newMoons.length ? newMoons.map((x) => x.date).join(', ') : '本轮无'}`);
console.log(`· 满月日（>0.95）：${fullMoons.length ? fullMoons.map((x) => x.date).join(', ') : '本轮无'}`);
console.log(`· 星轨高概率窗口（illumination<=0.3）：${allIllums.filter((x) => x.frac <= 0.3).length} 天`);

console.log('\n决策建议：');
if (nanCount === 0 && minIllum.frac < 0.1 && maxIllum.frac > 0.9) {
  console.log('  ✅ suncalc 月相输出合理，星轨评分公式（0.6*moon_score+0.4*cloud_score）可直接上线');
  console.log('  ✅ 高纬度哈尔滨无 NaN，极地边界在 45.8° 内不触发');
} else if (nanCount > 0) {
  console.log('  ⚠️ 检测到 NaN，需在星轨评分加 NaN 防御（fallback illumination=0.5 中位值）');
} else {
  console.log('  ⚠️ illumination 范围异常，需复核 suncalc 版本');
}
