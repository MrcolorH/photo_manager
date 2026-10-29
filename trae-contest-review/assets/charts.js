(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // ── Radar Chart: 四维评分 ──
  var radar = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  radar.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true
    },
    radar: {
      indicator: [
        { name: '产品完成度\n(87)', max: 100 },
        { name: '技术实现\n(85)', max: 100 },
        { name: '实用性\n(83)', max: 100 },
        { name: '创新性\n(84)', max: 100 }
      ],
      shape: 'polygon',
      radius: '62%',
      center: ['50%', '52%'],
      splitNumber: 4,
      axisName: {
        color: ink,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 16
      },
      splitLine: {
        lineStyle: { color: rule, width: 1 }
      },
      splitArea: {
        areaStyle: {
          color: ['rgba(212,118,60,0.02)', 'rgba(212,118,60,0.04)', 'rgba(212,118,60,0.06)', 'rgba(212,118,60,0.08)']
        }
      },
      axisLine: {
        lineStyle: { color: rule }
      }
    },
    series: [{
      type: 'radar',
      data: [{
        value: [87, 85, 83, 84],
        name: '拾光舱',
        areaStyle: {
          color: 'rgba(212,118,60,0.15)'
        },
        lineStyle: {
          color: accent,
          width: 2
        },
        itemStyle: {
          color: accent
        },
        label: {
          show: true,
          formatter: function(p) { return p.value; },
          color: accent,
          fontSize: 13,
          fontWeight: 700
        }
      }]
    }]
  });
  window.addEventListener('resize', function() { radar.resize(); });

  // ── Bar Chart: 子项得分分布 ──
  var bar = echarts.init(document.getElementById('chart-bar'), null, { renderer: 'svg' });
  bar.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      formatter: function(params) {
        var p = params[0];
        return p.name + '<br/>得分: <strong>' + p.value + '</strong>';
      }
    },
    grid: {
      left: 8,
      right: 16,
      top: 16,
      bottom: 8,
      containLabel: true
    },
    xAxis: {
      type: 'value',
      min: 60,
      max: 100,
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    yAxis: {
      type: 'category',
      data: [
        'TRAE技术创新',
        '持续使用价值',
        '运行稳定性',
        '体验稳定性',
        '解决效果',
        '场景成熟度',
        '技术方案质量',
        '解决思路创新',
        '交互友好性',
        '需求创新',
        '功能完整性'
      ],
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: ink, fontSize: 11 }
    },
    series: [{
      type: 'bar',
      data: [
        { value: 84, itemStyle: { color: accent2 + 'cc' } },
        { value: 80, itemStyle: { color: accent2 + 'cc' } },
        { value: 85, itemStyle: { color: accent + 'cc' } },
        { value: 86, itemStyle: { color: accent + 'cc' } },
        { value: 83, itemStyle: { color: accent + 'cc' } },
        { value: 85, itemStyle: { color: accent } },
        { value: 85, itemStyle: { color: accent } },
        { value: 83, itemStyle: { color: accent + 'cc' } },
        { value: 85, itemStyle: { color: accent } },
        { value: 85, itemStyle: { color: accent } },
        { value: 88, itemStyle: { color: accent } }
      ],
      barWidth: '55%',
      label: {
        show: true,
        position: 'right',
        formatter: '{c}',
        color: ink,
        fontSize: 11,
        fontWeight: 600
      }
    }]
  });
  window.addEventListener('resize', function() { bar.resize(); });
})();
