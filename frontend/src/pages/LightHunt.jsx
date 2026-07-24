/**
 * 追光页签 · 天象摄影概率预测（Redesign）
 *
 * 布局：
 *   顶部：城市选择器 + 今日追光 + 添加城市
 *   主体上：7 天标签 + 24h 甘特时间轴（朝霞/雷暴/星轨/晚霞 四泳道）
 *   主体下：选中时段详情面板（指标 + 信息 + 拍摄建议）
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Select, Button, Spin, message, Modal, Form, Input, InputNumber, Switch,
} from 'antd';
import {
  ThunderboltOutlined, ReloadOutlined, EnvironmentOutlined, PlusOutlined, StarOutlined, StarFilled, DeleteOutlined, CheckOutlined,
} from '@ant-design/icons';
import { lightHuntApi } from '../api';
import { aggregateDailyMax, scoreStartrail } from '../utils/startrailScore';
import './LightHunt.css';

const TYPE_META = {
  sunrise: { key: 'sunrise', name: '朝霞', cls: 'sunrise' },
  sunset: { key: 'sunset', name: '晚霞', cls: 'sunset' },
  thunder: { key: 'thunder', name: '雷暴', cls: 'thunder' },
  stars: { key: 'stars', name: '星轨', cls: 'stars' },
};

const ROW_ORDER = ['sunrise', 'thunder', 'stars', 'sunset'];

const pad = (n) => String(n).padStart(2, '0');

function fmtHour(decimal) {
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60) % 60;
  return `${pad(h)}:${pad(m)}`;
}

function hmToHour(s) {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
}

function parseEventTime(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() + d.getMinutes() / 60;
}

function getDayLabel(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return '今天';
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === tomorrow) return '明天';
  const d = new Date(dateStr);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[d.getDay()];
}

function formatMonthDay(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function buildWindows(dayItem, starItem) {
  const windows = [];

  dayItem.items.forEach((it) => {
    const t = Object.entries(TYPE_META).find(([, m]) => m.name === it.type)?.[0];
    const d = it.detail;
    if (!t) return;
    if (t !== 'stars' && !d) return;

    if (t === 'sunrise' || t === 'sunset') {
      const center = parseEventTime(d.event_time) || hmToHour(d.event_hm);
      if (center == null) return;
      const start = Math.max(0, center - 1);
      const end = Math.min(24, center + 1);
      windows.push({
        id: `${t}-${dayItem.date}`,
        type: t,
        start,
        end,
        label: `${fmtHour(start)}–${fmtHour(end)}`,
        desc: t === 'sunrise' ? '日出前后 1h' : '日落前后 1h',
        prob: Math.round(it.score * 100),
        data: d,
      });
    }

    if (t === 'thunder') {
      const hours = d.risk_hours || [];
      if (hours.length > 0) {
        const vals = hours.map((h) => hmToHour(h.hm)).filter(Boolean);
        const start = Math.min(...vals);
        const end = Math.max(...vals) + 1;
        windows.push({
          id: `thunder-${dayItem.date}`,
          type: 'thunder',
          start,
          end: Math.min(24, end),
          label: `${fmtHour(start)}–${fmtHour(end)}`,
          desc: '对流风险时段',
          prob: Math.round(it.score * 100),
          data: d,
        });
      } else {
        windows.push({
          id: `thunder-${dayItem.date}`,
          type: 'thunder',
          start: 8,
          end: 18,
          label: '08:00–18:00',
          desc: '白天对流窗口',
          prob: Math.round(it.score * 100),
          data: d,
        });
      }
    }
  });

  // 星轨：用 starItem（已包含月相/云量）
  if (starItem) {
    const sd = hmToHour(starItem.sunset_hm) || 18.5;
    const sr = hmToHour(starItem.next_sunrise_hm) || 6;
    // 日落后 → 24:00
    windows.push({
      id: `stars-evening-${dayItem.date}`,
      type: 'stars',
      start: sd,
      end: 24,
      label: `${fmtHour(sd)}→`,
      desc: '日落后延续',
      prob: Math.round(starItem.score * 100),
      data: starItem,
    });
    // 00:00 → 日出前
    windows.push({
      id: `stars-morning-${dayItem.date}`,
      type: 'stars',
      start: 0,
      end: sr,
      label: `00:00–${fmtHour(sr)}`,
      desc: '深夜至黎明前',
      prob: Math.round(starItem.score * 100),
      data: starItem,
    });
  }

  return windows;
}

function isShootable(w) {
  return w.type !== 'thunder' && w.prob >= 30;
}

export default function LightHunt() {
  const [builtinCities, setBuiltinCities] = useState([]);
  const [savedCities, setSavedCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedDateIdx, setSelectedDateIdx] = useState(0);
  const [selectedWindowId, setSelectedWindowId] = useState(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();

  // 初始化：拉城市列表
  const fetchCities = useCallback(async () => {
    try {
      const res = await lightHuntApi.getCities();
      const { saved, builtin } = res.data;
      setSavedCities(saved || []);
      setBuiltinCities(builtin || []);
      if (!selectedCity) {
        const priority = (saved || []).find((c) => c.priority);
        const def = priority || (saved || [])[0] || (builtin || []).find((c) => c.id === 'hangzhou') || (builtin || [])[0];
        if (def) setSelectedCity(def);
      }
    } catch (e) {
      message.error('城市列表加载失败：' + e.message);
    }
  }, [selectedCity]);

  useEffect(() => { fetchCities(); }, []); // eslint-disable-line

  // 拉预测
  const fetchForecast = useCallback(async (city, days = 7) => {
    if (!city) return;
    setLoading(true);
    try {
      const res = await lightHuntApi.getForecast(city.id || city.name, days);
      setForecast(res.data);
      setSelectedDateIdx(0);
      setSelectedWindowId(null);
    } catch (e) {
      message.error('预测拉取失败：' + (e.response?.data?.error || e.message));
      setForecast(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCity) fetchForecast(selectedCity);
  }, [selectedCity, fetchForecast]);

  // 7 天聚合数据
  const dailyMax = useMemo(() => {
    if (!forecast || !selectedCity) return [];
    return aggregateDailyMax(forecast, selectedCity.lat, selectedCity.lon);
  }, [forecast, selectedCity]);

  // 星轨评分（前端算）
  const startrailScores = useMemo(() => {
    if (!forecast || !selectedCity) return [];
    return scoreStartrail(forecast.night_cloud, selectedCity.lat, selectedCity.lon);
  }, [forecast, selectedCity]);

  // 城市下拉选项 = 收藏夹 + 内置
  const cityOptions = useMemo(() => {
    const opts = [];
    if (savedCities.length) {
      opts.push({
        label: '收藏城市',
        options: savedCities.map((c) => ({ label: `${c.name}${c.priority ? ' ★' : ''}`, value: c.id || c.name })),
      });
    }
    if (builtinCities.length) {
      opts.push({
        label: '内置城市',
        options: builtinCities.map((c) => ({ label: c.name, value: c.id })),
      });
    }
    return opts;
  }, [savedCities, builtinCities]);

  const onCityChange = (val) => {
    const hit = [...savedCities, ...builtinCities].find((c) => (c.id || c.name) === val);
    if (hit) setSelectedCity(hit);
  };

  // 添加城市
  const onAddCity = async () => {
    try {
      const v = await addForm.validateFields();
      await lightHuntApi.addCity(v.name, v.lat, v.lon, v.priority);
      message.success(`${v.name} 已加入收藏`);
      setAddModalOpen(false);
      addForm.resetFields();
      fetchCities();
    } catch (e) {
      if (e.errorFields) return;
      message.error('添加失败：' + (e.response?.data?.error || e.message));
    }
  };

  // 设置重点
  const onTogglePriority = async (city, e) => {
    e?.stopPropagation();
    try {
      await lightHuntApi.setPriority(city.id, !city.priority);
      fetchCities();
    } catch (e) {
      message.error('设置失败：' + (e.response?.data?.error || e.message));
    }
  };

  // 删除收藏
  const onRemoveCity = async (city, e) => {
    e?.stopPropagation();
    try {
      await lightHuntApi.removeCity(city.id);
      message.success(`${city.name} 已移除`);
      fetchCities();
    } catch (e) {
      message.error('删除失败：' + (e.response?.data?.error || e.message));
    }
  };

  // 当前日窗口
  const selectedDay = dailyMax[selectedDateIdx];
  const selectedStar = startrailScores[selectedDateIdx];
  const windows = useMemo(() => {
    if (!selectedDay) return [];
    return buildWindows(selectedDay, selectedStar);
  }, [selectedDay, selectedStar]);

  // 默认选中首个可拍窗口
  useEffect(() => {
    if (!windows.length) {
      setSelectedWindowId(null);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const isToday = selectedDay?.date === today;
    const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
    let pick = null;
    for (const w of windows) {
      if (isShootable(w) && (!isToday || w.start > nowHour)) {
        pick = w;
        break;
      }
    }
    if (!pick) {
      for (const w of [...windows].reverse()) {
        if (isShootable(w)) { pick = w; break; }
      }
    }
    if (!pick) pick = windows.find((w) => w.type === 'sunset') || windows[0];
    setSelectedWindowId(pick.id);
  }, [windows, selectedDay]);

  const selectedWindow = windows.find((w) => w.id === selectedWindowId);

  const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
  const today = new Date().toISOString().slice(0, 10);
  const isSelectedToday = selectedDay?.date === today;

  const renderPill = (w) => {
    const meta = TYPE_META[w.type];
    const leftPct = (w.start / 24) * 100;
    const widthPct = Math.max(((w.end - w.start) / 24) * 100, 5);
    return (
      <button
        key={w.id}
        type="button"
        className={`lh-pill lh-pill-${meta.cls} ${selectedWindowId === w.id ? 'selected' : ''}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        onClick={() => setSelectedWindowId(w.id)}
        aria-label={`${meta.name} ${w.label} ${w.desc}`}
      >
        <span className="lh-pill-time">{w.label}</span>
        {w.end >= 24 && <span className="lh-pill-arrow">→</span>}
        <span className="lh-pill-desc">{w.desc}</span>
      </button>
    );
  };

  const renderMetrics = (w) => {
    const d = w.data;
    const meta = TYPE_META[w.type];
    const common = [
      { label: '概率', value: w.prob, unit: '%', cls: w.type === 'thunder' ? 'storm' : w.type === 'stars' ? 'night' : 'warm', detail: `${meta.name}出现概率` },
    ];

    if (w.type === 'sunrise' || w.type === 'sunset') {
      return [
        ...common,
        { label: '低云', value: d.cloud_cover_low_avg, unit: '%', cls: 'cool', detail: '窗口内低云均值' },
        { label: '露点差', value: d.dew_diff, unit: '°C', cls: 'cool', detail: '空气通透度' },
        { label: 'AOD', value: d.aod, unit: '', cls: 'cool', detail: d.aod_fallback ? '第5-7天fallback值' : '气溶胶光学厚度' },
      ];
    }

    if (w.type === 'thunder') {
      return [
        ...common,
        { label: 'CAPE', value: d.max_cape, unit: 'J/kg', cls: 'storm', detail: d.max_cape > 3500 ? '对流旺盛' : '对流平稳' },
        { label: '阵雨', value: d.max_showers, unit: 'mm', cls: 'storm', detail: '最大小时阵雨' },
        { label: '风险时段', value: (d.risk_hours || []).length, unit: '个', cls: 'storm', detail: 'CAPE≥1000 或雷暴代码' },
      ];
    }

    if (w.type === 'stars') {
      return [
        ...common,
        { label: '月相', value: (d.moon_illumination * 100).toFixed(0), unit: '%', cls: 'night', detail: d.moon_phase },
        { label: '夜间云', value: d.cloud_avg, unit: '%', cls: 'cool', detail: '夜间总云量均值' },
        { label: '500法则', value: d.rule500_sec, unit: 's', cls: 'night', detail: `${d.focal_length}mm 焦距单张` },
      ];
    }

    return common;
  };

  const renderInfoRows = (w) => {
    const d = w.data;
    const rows = [];

    if (w.type === 'sunrise' || w.type === 'sunset') {
      rows.push(['事件时间', `${d.event_hm} · 机位朝 ${d.direction}`]);
      rows.push(['窗口', d.window || `${fmtHour(w.start)}–${fmtHour(w.end)}`]);
      rows.push(['AOD 来源', d.aod_fallback ? '30天均值 fallback' : 'Open-Meteo air-quality']);
    } else if (w.type === 'thunder') {
      rows.push(['雷暴代码', d.has_thunderstorm ? '检测到雷暴天气代码' : '无明确雷暴代码']);
      rows.push(['风险小时', (d.risk_hours || []).map((h) => h.hm).join(', ') || '—']);
      rows.push(['风险提示', d.max_cape > 2500
        ? '<span class="lh-alert-badge">⚠ 雷暴风险，谨慎外出</span>'
        : '条件可控，留意短时强对流']);
    } else if (w.type === 'stars') {
      rows.push(['推荐窗口', d.best_window]);
      rows.push(['月升月落', `月升 ${d.moonrise} · 月落 ${d.moonset}`]);
      rows.push(['拍摄建议', d.recommendation]);
    }

    return rows;
  };

  const TIPS = {
    sunrise: '日出前后空气通透、云层被染色的黄金窗口。建议提前 30 分钟到达机位，使用三脚架与渐变镜。民用曙暮光内红霞最浓。',
    sunset: '日落前后暖色调最浓郁，晚霞概率高。注意日落后 20 分钟内的“蓝调时刻”同样出片。建议面向日落方向拍摄。',
    thunder: '雷暴天气存在安全风险，不建议户外拍摄。如需记录，请在室内安全距离使用长焦。CAPE 值越高对流越强。',
    stars: '夜间晴朗无月时可拍摄星轨与银河。注意光污染与月相，月相值越低越利于星空。建议远离城市光害区域。',
  };

  return (
    <div className="light-hunt">
      <div className="lh-page">
        {/* Header */}
        <div className="lh-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Select
              showSearch
              className="lh-city-select"
              style={{ minWidth: 180 }}
              placeholder="选择城市"
              value={selectedCity ? (selectedCity.id || selectedCity.name) : undefined}
              onChange={onCityChange}
              options={cityOptions}
              optionFilterProp="label"
              dropdownMatchSelectWidth={220}
              suffixIcon={
                <svg className="lh-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              }
            />

            {/* 收藏夹快捷入口 */}
            {savedCities.length > 0 && (
              <div className="lh-favorites">
                <div className="lh-fav-list">
                  {savedCities.map((c) => (
                    <span
                      key={c.id}
                      className={`lh-fav-item ${selectedCity?.id === c.id ? 'active' : ''}`}
                      onClick={() => setSelectedCity(c)}
                    >
                      {c.name}
                      {c.priority && <StarFilled style={{ fontSize: 12, color: 'var(--lh-sunset)' }} />}
                      <span className="lh-fav-actions">
                        <button title={c.priority ? '取消重点' : '设为重点'} onClick={(e) => onTogglePriority(c, e)}>
                          {c.priority ? <StarFilled style={{ fontSize: 12 }} /> : <StarOutlined style={{ fontSize: 12 }} />}
                        </button>
                        <button title="删除" onClick={(e) => onRemoveCity(c, e)}>
                          <DeleteOutlined style={{ fontSize: 12 }} />
                        </button>
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lh-actions">
            <button className="lh-btn lh-btn-primary" onClick={() => selectedCity && fetchForecast(selectedCity)} disabled={loading}>
              <ReloadOutlined spin={loading} />
              <span>今日追光</span>
            </button>
            <button className="lh-btn lh-btn-secondary" onClick={() => setAddModalOpen(true)}>
              <PlusOutlined />
              <span>添加城市</span>
            </button>
          </div>
        </div>

        {forecast?.aerosol_error && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            ⚠ AOD 数据源告警：{forecast.aerosol_error}（第 5-7 天已用 fallback）
          </div>
        )}

        <Spin spinning={loading} tip="拉取 Open-Meteo 数据中…">
          {!selectedDay ? (
            <div className="lh-card">
              <div className="lh-empty-state">
                <ThunderboltOutlined style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }} />
                <div>{selectedCity ? '暂无预测数据' : '请选择城市开始追光'}</div>
              </div>
            </div>
          ) : (
            <>
              {/* Gantt Card */}
              <section className="lh-card">
                <div className="lh-card-header">
                  <div>
                    <h2 className="lh-card-title">追光 · 三类天象 24 小时蹲守周期</h2>
                    <p className="lh-card-subtitle">
                      {formatMonthDay(selectedDay.date)} · {getDayLabel(selectedDay.date)} · 白天雷暴 → 夜里星轨 → 清晨朝霞
                    </p>
                  </div>
                </div>
                <div className="lh-card-body">
                  <div className="lh-day-tabs" role="tablist" aria-label="日期选择">
                    {dailyMax.map((day, idx) => (
                      <button
                        key={day.date}
                        type="button"
                        className={`lh-day-tab ${idx === selectedDateIdx ? 'active' : ''}`}
                        onClick={() => setSelectedDateIdx(idx)}
                        role="tab"
                      >
                        <span className="dt-date">{formatMonthDay(day.date)}</span>
                        <span className="dt-sub">{getDayLabel(day.date)}</span>
                      </button>
                    ))}
                  </div>

                  <div className="lh-gantt-wrap">
                    <div className="lh-gantt-scroll">
                      <div className="lh-gantt-track">
                        <div className="lh-time-ruler">
                          {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t) => (
                            <span key={t} className="lh-ruler-tick">{t}</span>
                          ))}
                        </div>
                        <div className="lh-axis-overlay">
                          {isSelectedToday && (
                            <div className="lh-now-marker" style={{ left: `${(nowHour / 24) * 100}%` }} />
                          )}
                        </div>
                        {ROW_ORDER.map((type) => (
                          <div key={type} className="lh-swimlane-row">
                            <div className="lh-row-label">{TYPE_META[type].name}</div>
                            <div className="lh-row-track">
                              {windows.filter((w) => w.type === type).map(renderPill)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="lh-data-footer">
                    <strong>数据源：</strong>雷暴/朝霞用 Open-Meteo 免费 API · 星轨月相用 suncalc 纯算法（零网络成本）<br />
                    v1.0.3 基础版三类全发 · 加星轨深度功能（银河核心/光污染/曝光计算器/实时云图）+ 卷积云
                  </div>
                </div>
              </section>

              {/* Detail Card */}
              <section className="lh-card">
                <div className="lh-card-header">
                  <div>
                    <h2 className="lh-card-title">时段详情</h2>
                    <p className="lh-card-subtitle">点击上方时间窗口切换查看</p>
                  </div>
                </div>
                <div className="lh-card-body">
                  {selectedWindow ? (
                    <div className="lh-detail-grid">
                      <div className="lh-detail-main">
                        <div className="lh-detail-head">
                          <div className="lh-detail-time">
                            {fmtHour(selectedWindow.start)} – {selectedWindow.end >= 24 ? '24:00' : fmtHour(selectedWindow.end)}
                          </div>
                          <div>
                            <span className={`lh-detail-badge lh-badge-${TYPE_META[selectedWindow.type].cls}`}>
                              {TYPE_META[selectedWindow.type].name}
                            </span>
                            {isShootable(selectedWindow) && (
                              <span className="lh-reco-flag">
                                <CheckOutlined />
                                推荐时段
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="lh-metrics-grid">
                          {renderMetrics(selectedWindow).map((m, i) => (
                            <div key={i} className="lh-metric-card">
                              <div className="lh-metric-label">{m.label}</div>
                              <div className={`lh-metric-value ${m.cls}`}>
                                {m.value}
                                <span className="lh-metric-unit">{m.unit}</span>
                              </div>
                              <div className="lh-metric-detail">{m.detail}</div>
                            </div>
                          ))}
                        </div>

                        <div className="lh-tip-box">
                          <strong>拍摄建议：</strong>
                          {TIPS[selectedWindow.type]}
                        </div>
                      </div>

                      <div className="lh-info-section">
                        {renderInfoRows(selectedWindow).map(([label, value], i) => (
                          <div key={i} className="lh-info-row">
                            <span className="lh-info-label">{label}</span>
                            <span className="lh-info-value" dangerouslySetInnerHTML={{ __html: value }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="lh-empty-state">点击上方时间窗口查看详情</div>
                  )}
                </div>
              </section>
            </>
          )}
        </Spin>
      </div>

      {/* Add City Modal */}
      <Modal
        title="添加收藏城市"
        open={addModalOpen}
        onOk={onAddCity}
        onCancel={() => { setAddModalOpen(false); addForm.resetFields(); }}
        okText="添加"
        cancelText="取消"
      >
        <Form form={addForm} layout="vertical">
          <Form.Item name="name" label="城市名" rules={[{ required: true, message: '请输入城市名' }]}>
            <Input placeholder="如：丽江" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="lat" label="纬度" rules={[{ required: true, message: '请输入纬度' }]}>
              <InputNumber style={{ width: '100%' }} placeholder="如 26.87" step={0.01} />
            </Form.Item>
            <Form.Item name="lon" label="经度" rules={[{ required: true, message: '请输入经度' }]}>
              <InputNumber style={{ width: '100%' }} placeholder="如 100.23" step={0.01} />
            </Form.Item>
          </div>
          <Form.Item name="priority" label="设为重点城市（详细预测 + 系统通知）" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
