# W1 Dry-Run 验证报告 · 追光功能

> 时间：2026-07-24 · 脚本目录：`scripts/light-hunt-dryrun/`
> 验证目标：① suncalc 月相合理性 ② Open-Meteo AOD 亚太覆盖率
> 阻塞性问题：PRD 第 7 节 Q2（AOD550 亚太覆盖率）

---

## 一、月相验证（suncalc）· ✅ 通过

**脚本**：`moonphase_probe.js`（4 城市 × 30 天 = 120 检查点，含高纬哈尔滨 45.8°）

| 验证点 | 结果 | 判定 |
|--------|------|------|
| `require('suncalc')` 不报错 | 成功 | ✅ |
| NaN 异常数 | 0 / 120 | ✅ |
| illumination 范围 | 0.003 ~ 0.997 | ✅ 新月≈0、满月≈1 |
| 新月日（<0.05） | 2026-08-11~14（4 天连续） | ✅ 符合 29.5 天周期 |
| 满月日（>0.95） | 2026-07-28~31（4 天连续） | ✅ |
| 星轨高概率窗口（illumination≤0.3） | 10 天 / 30 天 | ✅ 合理 |
| 高纬度哈尔滨边界 | 无 NaN、无极地异常 | ✅ 45.8° 安全 |

**结论**：星轨评分公式 `score = 0.6×moon_score + 0.4×cloud_score`（moon_score = 1 − illumination）**可直接上线**。suncalc 是可靠的月相数据源，零网络成本、零配额消耗。

**月相分布**（30 天）：
- 盈凸月 24、亏凸月 20、蛾眉月 20、满月 16、残月 16、新月 16、上弦 4、下弦 4

---

## 二、AOD 验证（Open-Meteo）· ⚠️ 部分通过，需调整数据源

**脚本**：`aod550_probe.js`（8 亚太城市 × 7 天预报）

### 关键发现：字段不在 forecast endpoint，在 Air Quality API

首跑用 `api.open-meteo.com/v1/forecast?hourly=aerosol_optical_depth_550` → **8 城全报错**：
```
"Cannot initialize ... from invalid String value aerosol_optical_depth_550"
```
即 PRD R3 原假设的数据源 endpoint **错了**——AOD 字段不在 forecast API。

改用 `air-quality-api.open-meteo.com/v1/air-quality?hourly=aerosol_optical_depth`（注意字段名去掉 `_550` 后缀）后，**8 城全部成功返回**。

### 8 城覆盖率数据（air-quality endpoint）

| 城市 | 总h | 有效h | null率 | min | max | mean | 样本 |
|------|-----|--------|--------|-----|-----|------|------|
| 杭州 | 168 | 109 | 35.1% | 0.100 | 0.740 | 0.238 | 0.42, 0.41, 0.40 |
| 北京 | 168 | 109 | 35.1% | 0.340 | 1.250 | 0.767 | 1.25, 1.10, 0.99 |
| 广州 | 168 | 109 | 35.1% | 0.190 | 0.960 | 0.465 | 0.33, 0.33, 0.33 |
| 成都 | 168 | 109 | 35.1% | 0.350 | 0.800 | 0.524 | 0.44, 0.45, 0.44 |
| 乌鲁木齐 | 168 | 109 | 35.1% | 0.320 | 0.990 | 0.583 | 0.48, 0.46, 0.46 |
| 上海 | 168 | 109 | 35.1% | 0.110 | 0.400 | 0.183 | 0.35, 0.34, 0.33 |
| 哈尔滨 | 168 | 109 | 35.1% | 0.140 | 1.040 | 0.365 | 0.97, 1.04, 0.82 |
| 昆明 | 168 | 109 | 35.1% | 0.090 | 0.410 | 0.218 | 0.37, 0.39, 0.36 |

- 平均 AOD 均值：0.418（合理范围 0.1~1.25）
- 空间差异明显：北京 0.767（雾霾高）> 乌鲁木齐 0.583 > 成都 0.524 > 广州 0.465 > 哈尔滨 0.365 > 杭州 0.238 > 昆明 0.218 > 上海 0.183
- 数值合理，无极端异常

### 预报窗口：实际 4.5 天（109h）

通过对比不同 `forecast_days` 请求确认：

| forecast_days | 总h | 有效h | null率 | 最后有效小时 |
|---------------|-----|--------|--------|--------------|
| 3 | 72 | 72 | 0.0% | 2026-07-26T23:00 |
| 5 | 120 | 109 | 9.2% | 2026-07-28T12:00 |
| 7 | 168 | 109 | 35.1% | 2026-07-28T12:00 |

**结论**：Air Quality API 的 AOD 实际预报窗口是 **约 4.5 天（109h）**，请求 5 天或 7 天都只给到 109h（API 静默截断）。3 天请求 100% 有效。

---

## 三、对朝霞算法 R3 的影响 + 调整方案

### 原方案（PRD v3 R3）
- 单请求：`api.open-meteo.com/v1/forecast`，字段 `aerosol_optical_depth_550` + `cloud_cover_low` + `dew_point_2m` + `sunrise/sunset`
- 7 天预报

### 调整后方案
**双请求**（forecast + air-quality）：

1. **forecast endpoint**（不变）：`cloud_cover_low` + `dew_point_2m` + `temperature_2m` + `sunrise/sunset` —— 7 天预报，已验证全字段 200 OK
2. **air-quality endpoint**（新增）：`aerosol_optical_depth` —— 4.5 天预报，字段名去掉 `_550` 后缀

**第 5-7 天 AOD fallback**：
- 朝霞算法只需"日出那一小时"的 AOD，前 4-5 个日出有真实数据
- 第 5-7 天日出 AOD 缺失时，`aod_score` 用 **该城市 30 天滚动均值** 或 **默认 0.3**（取较低者，保守降权）
- UI 上第 5-7 天柱状图加"预报不确定性更高"灰底标记

**配额影响**：
- 单城市单次预测：2 次请求（forecast + air-quality）
- 重点城市 5 个 × 每天 4 次 × 2 = 40 次/天
- 普通城市 10 个 × 每天 1 次 × 2 = 20 次/天
- 合计 60 次/天，仍远低于 Open-Meteo 各 API 独立 10k/天配额（forecast 和 air-quality 配额分开计）

---

## 四、W1 结论

| 验证项 | 结果 | 对 v1.0.2 的影响 |
|--------|------|------------------|
| suncalc 月相 | ✅ 通过 | 星轨算法可直接上线，无需调整 |
| Open-Meteo AOD 数据源 | ⚠️ 需改 endpoint | 朝霞算法 R3 改双请求，第 5-7 天 fallback |
| Open-Meteo AOD 数值质量 | ✅ 合理 | 8 城全覆盖、空间差异明显、可作朝霞色彩饱和度指标 |
| 阻塞性问题 Q2 | ✅ 解除 | AOD 在 air-quality API 可用，不再是阻塞 |

**W1 完成度**：算法验证阶段目标达成，两个阻塞性问题（Q2 AOD 覆盖率 + suncalc 可用性）全部解除。

**W2 启动建议**：
1. 后端新增 `/api/light-hunt/aerosol/:cityId` 路由（air-quality endpoint 封装）
2. 朝霞评分模块拆成 `fetchForecast()` + `fetchAerosol()` 两个 fetcher，合并后算分
3. 第 5-7 天 fallback 逻辑写在评分模块，配 `aerosol_cache`（30 天滚动均值）
4. 雷暴模块（thunderstorm_watch 移植）继续用 forecast endpoint，不受影响

---

## 五、附：脚本清单

| 脚本 | 依赖 | 用途 |
|------|------|------|
| `aod550_probe.js` | Node 标准库（https） | 8 城 AOD 覆盖率验证（air-quality endpoint） |
| `moonphase_probe.js` | suncalc ^1.9.0 | 4 城 30 天月相抽检 |
| `package.json` | suncalc | 依赖声明 |

重跑命令：
```bash
cd scripts/light-hunt-dryrun
node aod550_probe.js     # AOD 覆盖率
node moonphase_probe.js  # 月相抽检
```
