import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { loadHistory, loadMacroHistory } from "./history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");
const FOREX_HISTORY_API = "https://api.frankfurter.app/2024-07-01..";

function fmt(val, decimals = 2) {
  if (val == null) return "--";
  return Number(val).toFixed(decimals);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function fetchForexHistory() {
  try {
    const endDate = new Date().toISOString().split("T")[0];
    const url = `${FOREX_HISTORY_API}${endDate}?from=USD&to=CNY`;
    const res = await axios.get(url, { timeout: 15000 });
    if (!res.data || !res.data.rates) return [];
    const monthly = {};
    for (const [date, rates] of Object.entries(res.data.rates)) {
      const month = date.substring(0, 7);
      monthly[month] = { date: month, value: rates.CNY };
    }
    const result = Object.values(monthly).sort((a, b) => a.date.localeCompare(b.date));
    return result.slice(-24);
  } catch (err) {
    console.log(`[DASHBOARD] 外汇历史获取失败: ${err.message}`);
    return [];
  }
}

export async function generateDashboard(data) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const updateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const marketHistory = loadHistory();
  const macroHistory = loadMacroHistory();

  const marketData = data.categories.map(cat => ({
    key: cat.key,
    label: cat.label,
    items: cat.items.map(item => ({
      name: item.name,
      emoji: item.emoji,
      price: item.price,
      priceCny: item.priceCny,
      unit: item.unit,
      cnyUnit: item.cnyUnit,
      change: item.change,
      high52: item.high52,
      low52: item.low52,
      highCny: item.highCny,
      lowCny: item.lowCny,
      error: item.error,
    })),
  }));

  const macroData = (data.macroIndicators || []).map(ind => ({
    key: ind.key,
    name: ind.name,
    emoji: ind.emoji,
    unit: ind.unit,
    freq: ind.freq,
    value: ind.value,
    date: ind.date,
    prevValue: ind.prevValue,
    history: ind.history || [],
  }));

  const forexHistory = await fetchForexHistory();
  macroData.push({
    key: "usdcny",
    name: "美元/人民币",
    emoji: "💱",
    unit: "",
    freq: "月",
    value: data.usdCny,
    date: forexHistory.length > 0 ? forexHistory[forexHistory.length - 1].date : null,
    prevValue: forexHistory.length > 1 ? forexHistory[forexHistory.length - 2].value : null,
    history: forexHistory,
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>金融仪表盘</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.header{text-align:center;padding:24px 16px 16px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid #334155}
.header h1{font-size:clamp(20px,5vw,28px);font-weight:700;color:#f8fafc}
.header .time{font-size:13px;color:#64748b;margin-top:6px}
.container{max-width:1400px;margin:0 auto;padding:16px}
.section-title{font-size:18px;font-weight:600;color:#94a3b8;margin:24px 0 12px;padding-bottom:8px;border-bottom:1px solid #334155}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.card{background:#1e293b;border-radius:10px;padding:14px 16px;border:1px solid #334155}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.card-header .label{font-size:14px;font-weight:600;color:#94a3b8}
.card-header .freq{font-size:11px;color:#64748b;background:#334155;padding:2px 8px;border-radius:4px}
.item-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1e293b}
.item-row:last-child{border-bottom:none}
.item-name{font-size:14px;color:#cbd5e1;flex:1}
.item-price{text-align:right;font-size:14px;font-weight:600;color:#f8fafc}
.item-price .sub{font-size:11px;color:#64748b;display:block}
.item-change{font-size:13px;font-weight:600;margin-left:10px;min-width:60px;text-align:right}
.up{color:#ef4444}.down{color:#22c55e}.neutral{color:#64748b}
.range-bar{height:3px;background:#334155;border-radius:2px;margin-top:4px;position:relative}
.range-bar .fill{height:100%;background:#475569;border-radius:2px;position:absolute;left:0}
.range-labels{display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:2px}
.macro-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.macro-card{background:#1e293b;border-radius:10px;padding:14px 16px;border:1px solid #334155}
.macro-card .title{font-size:14px;color:#94a3b8;margin-bottom:4px}
.macro-card .value-row{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
.macro-card .value{font-size:28px;font-weight:700;color:#f8fafc}
.macro-card .unit{font-size:14px;color:#64748b}
.macro-card .prev{font-size:12px;color:#64748b}
.macro-card .prev .up{color:#ef4444}.macro-card .prev .down{color:#22c55e}
.macro-card .date{font-size:11px;color:#475569}
.macro-card canvas{width:100%;height:80px;margin-top:8px}
.forex-bar{text-align:center;padding:8px;font-size:13px;color:#64748b;background:#1e293b;border-radius:8px;margin-top:16px}
.footer{text-align:center;padding:24px;font-size:12px;color:#475569}
</style>
</head>
<body>
<div class="header">
  <h1>📊 金融仪表盘</h1>
  <div class="time">更新时间: ${updateTime} | 美元/人民币: ${data.usdCny != null ? data.usdCny.toFixed(4) : "--"}</div>
</div>
<div class="container">
  <div class="section-title">📈 市场行情</div>
  <div class="grid">
    ${marketData.map(cat => `
    <div class="card">
      <div class="card-header"><span class="label">${escapeHtml(cat.label)}</span></div>
      ${cat.items.map(item => {
        if (item.error) {
          return `<div class="item-row"><span class="item-name">${item.emoji} ${escapeHtml(item.name)}</span><span class="item-price">获取失败</span></div>`;
        }
        const chg = item.change != null ? (item.change >= 0 ? "up" : "down") : "neutral";
        const chgText = item.change != null ? (item.change >= 0 ? "▲" : "▼") + Math.abs(item.change).toFixed(2) + "%" : "--";
        const priceText = item.priceCny != null
          ? `¥${fmt(item.priceCny)}<span class="sub">${fmt(item.price)}${item.unit}</span>`
          : `${fmt(item.price)}${item.unit}`;
        const hasRange = item.high52 != null && item.low52 != null && item.price != null && item.high52 !== item.low52;
        const rangePct = hasRange ? ((item.price - item.low52) / (item.high52 - item.low52)) * 100 : 0;
        const clampedPct = Math.max(0, Math.min(100, rangePct));
        return `
        <div class="item-row">
          <span class="item-name">${item.emoji} ${escapeHtml(item.name)}</span>
          <span class="item-price">${priceText}</span>
          <span class="item-change ${chg}">${chgText}</span>
        </div>
        ${hasRange ? `
        <div class="range-bar"><div class="fill" style="width:${clampedPct.toFixed(0)}%"></div></div>
        <div class="range-labels"><span>${item.cnyUnit ? "¥" + fmt(item.lowCny) : fmt(item.low52, 0)}</span><span>${item.cnyUnit ? "¥" + fmt(item.highCny) : fmt(item.high52, 0)}</span></div>
        ` : ""}`;
      }).join("")}
    </div>`).join("")}
  </div>

  <div class="section-title">🏛️ 宏观经济</div>
  <div class="macro-grid" id="macro-grid">
    ${macroData.map((ind, i) => `
    <div class="macro-card">
      <div class="title">${ind.emoji} ${escapeHtml(ind.name)} <span style="font-size:11px;color:#64748b">${ind.freq}</span></div>
      <div class="value-row">
        <span class="value">${ind.value != null ? fmt(ind.value) : "--"}</span>
        <span class="unit">${ind.unit}</span>
      </div>
      ${ind.prevValue != null && ind.value != null ? `
      <div class="prev">上期: ${fmt(ind.prevValue)}${ind.unit} <span class="${ind.value > ind.prevValue ? "up" : ind.value < ind.prevValue ? "down" : ""}">${ind.value > ind.prevValue ? "▲" : ind.value < ind.prevValue ? "▼" : ""}${fmt(Math.abs(ind.value - ind.prevValue))}${ind.unit}</span></div>
      ` : ""}
      <div class="date">${ind.date || "--"}</div>
      <canvas id="chart-${i}" width="600" height="160"></canvas>
    </div>`).join("")}
  </div>
</div>
<div class="footer">金融仪表盘 · 数据来源: 新浪财经 / 东方财富</div>

<script>
const MACRO_DATA = ${JSON.stringify(macroData)};

function drawChart(canvas, history) {
  if (!canvas || !history || history.length < 2) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  const pad = { top: 8, right: 8, bottom: 16, left: 8 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  const values = history.map(d => d.value).filter(v => v != null);
  if (values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max === min ? 1 : max - min;
  const yMin = min - range * 0.1;
  const yMax = max + range * 0.1;
  const yRange = yMax - yMin;
  const xStep = pw / (history.length - 1);

  const points = [];
  history.forEach((d, i) => {
    if (d.value == null) return;
    points.push({
      x: pad.left + i * xStep,
      y: pad.top + ph - ((d.value - yMin) / yRange) * ph,
      date: d.date ? d.date.substring(0, 7) : '',
      value: d.value,
      unit: '',
    });
  });

  function render(hoverIdx) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let first = true;
    for (const p of points) {
      if (first) { ctx.moveTo(p.x, p.y); first = false; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    for (const p of points) {
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hoverIdx != null) {
      const p = points[hoverIdx];
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.stroke();

      const label = p.date + '  ' + p.value.toFixed(2);
      ctx.font = '11px system-ui';
      const tw = ctx.measureText(label).width;
      let lx = p.x - tw / 2 - 6;
      let ly = p.y - 20;
      if (lx < 2) lx = 2;
      if (lx + tw + 12 > w) lx = w - tw - 14;
      if (ly < 2) ly = p.y + 12;
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 12, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 6, ly + 9);
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    if (points[0]) ctx.fillText(points[0].date, pad.left, h - 2);
    ctx.textAlign = 'right';
    if (points[points.length - 1]) ctx.fillText(points[points.length - 1].date, w - pad.right, h - 2);
  }

  render();

  canvas.addEventListener('mousemove', function(e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let nearest = null;
    let minDist = 12;
    for (let i = 0; i < points.length; i++) {
      const dx = mx - points[i].x;
      const dy = my - points[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    render(nearest);
  });

  canvas.addEventListener('mouseleave', function() { render(); });
}

MACRO_DATA.forEach((ind, i) => {
  if (ind.history && ind.history.length) {
    drawChart(document.getElementById('chart-' + i), ind.history);
  }
});
</script>
</body>
</html>`;

  fs.writeFileSync(DASHBOARD_FILE, html, "utf-8");
  console.log(`[DASHBOARD] 仪表盘已生成: ${DASHBOARD_FILE}`);
}