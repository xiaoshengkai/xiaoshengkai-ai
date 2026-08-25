import axios from "axios";
import { config } from "../config.js";

const API_BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get";

async function fetchOneReport(reportName, pageSize = 24, sortColumns = "REPORT_DATE", sortTypes = "-1") {
  const url = `${API_BASE}?reportName=${reportName}&columns=ALL&pageNumber=1&pageSize=${pageSize}&sortTypes=${sortTypes}&sortColumns=${sortColumns}&source=WEB&client=WEB`;
  const res = await axios.get(url, { timeout: 15000 });
  if (!res.data || !res.data.success) {
    throw new Error(`API 返回异常: ${JSON.stringify(res.data)}`);
  }
  return res.data.result.data || [];
}

export async function fetchMacroIndicators() {
  const results = [];
  const indicators = config.macroIndicators;
  let gdpRawData = null;

  for (const ind of indicators) {
    if (ind.computed) continue;

    try {
      const data = await fetchOneReport(ind.reportName, 24, ind.sortColumns, ind.sortTypes);

      if (ind.key === "gdp") gdpRawData = data;

      const history = data.map(d => {
        let value = d[ind.field];
        if (value != null) {
          value = parseFloat(value);
          if (ind.divisor) value = value / ind.divisor;
        }
        return {
          date: d.REPORT_DATE ? d.REPORT_DATE.split(" ")[0] : null,
          label: ind.dateField ? d[ind.dateField] : null,
          value: value,
          _raw: d,
        };
      });

      const latest = history[0];
      const prev = history[1] || null;

      results.push({
        key: ind.key,
        name: ind.name,
        emoji: ind.emoji,
        unit: ind.unit,
        freq: ind.freq,
        value: latest ? latest.value : null,
        date: latest ? latest.date : null,
        label: latest ? latest.label : null,
        prevValue: prev ? prev.value : null,
        history: history.reverse(),
      });

      const valStr = latest && latest.value != null ? `${latest.value.toFixed(2)}${ind.unit}` : "获取失败";
      console.log(`[MACRO] ${ind.emoji} ${ind.name}: ${valStr}`);
    } catch (err) {
      console.log(`[MACRO] ${ind.emoji} ${ind.name} 获取失败: ${err.message}`);
      results.push({
        key: ind.key,
        name: ind.name,
        emoji: ind.emoji,
        unit: ind.unit,
        freq: ind.freq,
        value: null,
        date: null,
        label: null,
        prevValue: null,
        history: [],
        error: err.message,
      });
    }
  }

  for (const ind of indicators) {
    if (!ind.computed) continue;

    if (ind.key === "gdp_deflator" && gdpRawData) {
      try {
        const gdpByName = {};
        for (const d of gdpRawData) {
          const name = parseFloat(d.DOMESTICL_PRODUCT_BASE);
          const real = parseFloat(d.SUM_SAME);
          if (isNaN(name) || isNaN(real)) continue;
          const date = d.REPORT_DATE ? d.REPORT_DATE.split(" ")[0] : null;
          gdpByName[date] = { nominal: name, real, label: d.TIME };
        }

        const history = [];
        const dates = Object.keys(gdpByName).sort();
        for (const date of dates) {
          const cur = gdpByName[date];
          const y = date.substring(0, 4);
          const m = date.substring(5, 7);
          const prevYear = `${parseInt(y) - 1}-${m}-01`;
          const prev = gdpByName[prevYear];
          if (prev) {
            const nominalGrowth = ((cur.nominal / prev.nominal) - 1) * 100;
            const deflator = nominalGrowth - cur.real;
            history.push({ date, label: cur.label, value: +deflator.toFixed(2) });
          }
        }

        const latest = history[history.length - 1];
        const prev = history.length > 1 ? history[history.length - 2] : null;

        results.push({
          key: ind.key,
          name: ind.name,
          emoji: ind.emoji,
          unit: ind.unit,
          freq: ind.freq,
          value: latest ? latest.value : null,
          date: latest ? latest.date : null,
          label: latest ? latest.label : null,
          prevValue: prev ? prev.value : null,
          history: history.slice(-24),
        });

        const valStr = latest ? `${latest.value.toFixed(2)}${ind.unit}` : "获取失败";
        console.log(`[MACRO] ${ind.emoji} ${ind.name}: ${valStr}`);
      } catch (err) {
        console.log(`[MACRO] ${ind.emoji} ${ind.name} 计算失败: ${err.message}`);
        results.push({ key: ind.key, name: ind.name, emoji: ind.emoji, unit: ind.unit, freq: ind.freq, value: null, date: null, prevValue: null, history: [], error: err.message });
      }
    }
  }

  const successCount = results.filter(r => r.value != null).length;
  console.log(`[MACRO] 宏观指标获取完成: ${successCount}/${results.length}`);
  return results;
}