import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { loadHistory, loadMacroHistory } from "./history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");
const FOREX_HISTORY_API = "https://api.frankfurter.app/2024-07-01..";

/**
 * 金融仪表盘生成器 —— Neo-Brutalism 糖果色版
 * 严格遵循项目根目录 DESIGN.md 的 UI 风格（与 hot-news 一家人）：
 * - 纯白背景 #FFFFFF / 次背景 #F5F5F5
 * - 纯黑实线边框(2-3px) + 零模糊纯黑硬阴影(Npx Npx 0 #000)
 * - 主色电光黄 #FFE135(黑字)，粉/蓝/紫/橙/深绿糖果色点缀
 * - 直角(无圆角)
 * - 字体: Inter / Plus Jakarta Sans / JetBrains Mono
 *
 * 金融语义保留：红涨(#E6162D) 绿跌(#16A34A)
 */

// 市场分类糖果色主题
const CATEGORY_THEME = {
  metals: { color: "#E6A700", soft: "#FFF3C4" },
  energy: { color: "#FB923C", soft: "#FFE7D3" },
  agriculture: { color: "#16A34A", soft: "#D9F2E2" },
  commodities: { color: "#4D7CFE", soft: "#D6E4FF" },
  stocks: { color: "#E6162D", soft: "#FFDCE0" },
  realestate: { color: "#8B5CF6", soft: "#E8DEFF" },
};

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

// 渲染单个市场条目（保留红涨绿跌 + 52 周范围条）
function renderMarketItem(item, theme) {
  if (item.error) {
    return `<div class="item-row"><span class="item-name">${item.emoji} ${escapeHtml(item.name)}</span><span class="item-price muted">获取失败</span></div>`;
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
    <div class="item-top">
      <span class="item-name">${item.emoji} ${escapeHtml(item.name)}</span>
      <span class="item-price">${priceText}</span>
      <span class="change ${chg}">${chgText}</span>
    </div>
    ${hasRange ? `
    <div class="range">
      <span class="range-label">${item.cnyUnit ? "¥" + fmt(item.lowCny) : fmt(item.low52, 0)}</span>
      <div class="range-bar"><div class="range-fill" style="width:${clampedPct.toFixed(0)}%;background:${theme.color}"></div></div>
      <span class="range-label">${item.cnyUnit ? "¥" + fmt(item.highCny) : fmt(item.high52, 0)}</span>
    </div>` : ""}
  </div>`;
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

  // 宏观指标数量
  const macroCount = macroData.length;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>金融仪表盘</title>
<style>
:root{
  --bg:#FFFFFF;
  --muted:#F5F5F5;
  --ink:#000000;
  --yellow:#FFE135;
  --up:#E6162D;
  --down:#16A34A;
  --font-body:'Inter',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  --font-title:'Plus Jakarta Sans','Inter',-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-body);background:var(--bg);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased}

/* ===== 顶部 ===== */
.header{background:var(--yellow);border-bottom:3px solid var(--ink);padding:32px 20px 26px}
.header-inner{max-width:1120px;margin:0 auto}
.brand{
  display:inline-block;font-family:var(--font-title);font-weight:800;
  font-size:clamp(24px,5vw,34px);letter-spacing:-0.5px;
  background:var(--yellow);border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);
  padding:10px 22px;
}
.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.stat{
  background:var(--bg);border:3px solid var(--ink);box-shadow:4px 4px 0 var(--ink);
  padding:8px 14px;font-family:var(--font-mono);font-size:12.5px;font-weight:700;
}
.stat b{font-size:15px}

/* ===== 主体 ===== */
.container{max-width:1120px;margin:0 auto;padding:30px 18px 50px}

.section-title{
  font-family:var(--font-title);font-weight:800;font-size:19px;
  display:flex;align-items:center;gap:10px;
  margin:28px 0 16px;padding-bottom:10px;border-bottom:3px solid var(--ink);
}
.section-title .tag{
  font-family:var(--font-mono);font-size:12px;font-weight:800;
  background:var(--yellow);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  padding:2px 8px;
}

/* ===== 市场行情卡片 ===== */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
.card{
  background:var(--bg);border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);
  padding:14px 16px 6px;transition:transform .1s, box-shadow .1s;
}
.card:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 var(--ink)}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.card-header .label{
  font-family:var(--font-title);font-weight:800;font-size:15px;
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);padding:3px 12px;
}
.card-header .count{font-family:var(--font-mono);font-size:13px;font-weight:800}

.item-row{padding:9px 0;border-bottom:2px solid var(--muted)}
.item-row:last-child{border-bottom:none}
.item-top{display:flex;align-items:baseline;gap:8px}
.item-name{flex:1;font-size:14px;font-weight:700}
.item-price{font-family:var(--font-mono);font-weight:800;font-size:15px;white-space:nowrap}
.item-price .sub{font-size:11px;color:#888;font-weight:600;display:block;text-align:right}
.item-price.muted{color:#aaa;font-weight:600;font-size:13px}
.change{
  font-family:var(--font-mono);font-weight:800;font-size:12px;
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  padding:2px 8px;min-width:60px;text-align:center;white-space:nowrap;
}
.change.up{background:var(--up);color:#fff}
.change.down{background:var(--down);color:#fff}
.change.neutral{background:var(--muted);color:#888}

.range{display:flex;align-items:center;gap:8px;margin-top:7px}
.range-label{font-family:var(--font-mono);font-size:10px;font-weight:700;color:#666;white-space:nowrap}
.range-bar{flex:1;height:8px;background:var(--muted);border:2px solid var(--ink)}
.range-fill{height:100%;display:block}

/* ===== 宏观卡片 ===== */
.macro-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
.macro-card{
  background:var(--bg);border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);
  padding:14px 16px;transition:transform .1s, box-shadow .1s;
}
.macro-card:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 var(--ink)}
.macro-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;margin-bottom:6px}
.macro-title .freq{
  font-family:var(--font-mono);font-size:10.5px;font-weight:800;
  background:var(--yellow);border:1.5px solid var(--ink);box-shadow:1.5px 1.5px 0 var(--ink);
  padding:1px 6px;
}
.macro-value{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.macro-value .value{font-family:var(--font-mono);font-size:30px;font-weight:800;letter-spacing:-1px}
.macro-value .unit{font-family:var(--font-mono);font-size:14px;font-weight:700;color:#555}
.chg-chip{
  font-family:var(--font-mono);font-weight:800;font-size:11px;
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);padding:1px 7px;
}
.chg-chip.up{background:var(--up);color:#fff}
.chg-chip.down{background:var(--down);color:#fff}
.macro-card .prev{font-family:var(--font-mono);font-size:11px;color:#888;margin-top:4px}
.macro-card .date{font-family:var(--font-mono);font-size:11px;color:#aaa;margin-top:2px}
.macro-card canvas{width:100%;height:88px;border:2px solid var(--ink);background:#fff;margin-top:10px;display:block}

.footer{
  max-width:1120px;margin:0 auto;padding:0 18px 50px;
  text-align:center;font-family:var(--font-mono);font-size:12px;color:#666;
}

@media (max-width:640px){
  .grid{grid-template-columns:1fr}
  .macro-grid{grid-template-columns:1fr}
  .item-top{flex-wrap:wrap}
  .item-name{flex-basis:100%}
}
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <span class="brand">📊 金融仪表盘</span>
    <div class="meta">
      <span class="stat">🕙 <b>${updateTime}</b></span>
      <span class="stat">💱 美元/人民币 <b>${data.usdCny != null ? data.usdCny.toFixed(4) : "--"}</b></span>
      <span class="stat">📈 市场分类 <b>${marketData.length}</b></span>
      <span class="stat">🏛️ 宏观指标 <b>${macroCount}</b></span>
    </div>
  </div>
</div>

<div class="container">
  <div class="section-title">📈 市场行情 <span class="tag">${marketData.length} 类</span></div>
  <div class="grid">
    ${marketData.map(cat => {
      const theme = CATEGORY_THEME[cat.key] || { color: "#FFE135", soft: "#FFF3C4" };
      return `
    <div class="card">
      <div class="card-header">
        <span class="label" style="background:${theme.soft}">${escapeHtml(cat.label)}</span>
        <span class="count" style="color:${theme.color}">${cat.items.length} 项</span>
      </div>
      ${cat.items.map(item => renderMarketItem(item, theme)).join("")}
    </div>`;
    }).join("")}
  </div>

  <div class="section-title">🏛️ 宏观经济 <span class="tag">${macroCount} 项</span></div>
  <div class="macro-grid">
    ${macroData.map((ind, i) => {
      const diff = (ind.prevValue != null && ind.value != null && ind.prevValue !== ind.value) ? ind.value - ind.prevValue : null;
      return `
    <div class="macro-card">
      <div class="macro-title">${ind.emoji} ${escapeHtml(ind.name)} <span class="freq">${ind.freq}</span></div>
      <div class="macro-value">
        <span class="value">${ind.value != null ? fmt(ind.value) : "--"}</span>
        <span class="unit">${ind.unit}</span>
        ${diff != null ? `<span class="chg-chip ${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"}${fmt(Math.abs(diff))}${ind.unit}</span>` : ""}
      </div>
      ${ind.prevValue != null ? `<div class="prev">上期 ${fmt(ind.prevValue)}${ind.unit}</div>` : ""}
      <div class="date">${ind.date || "--"}</div>
      <canvas id="chart-${i}"></canvas>
    </div>`;
    }).join("")}
  </div>
</div>
<div class="footer">金融仪表盘 · 数据来源: 新浪财经 / 东方财富 · Neo-Brutalism</div>

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
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let first = true;
    for (const p of points) {
      if (first) { ctx.moveTo(p.x, p.y); first = false; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    for (const p of points) {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hoverIdx != null) {
      const p = points[hoverIdx];
      ctx.fillStyle = '#FFE135';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.stroke();

      const label = p.date + '  ' + p.value.toFixed(2);
      ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace';
      const tw = ctx.measureText(label).width;
      let lx = p.x - tw / 2 - 8;
      let ly = p.y - 22;
      if (lx < 2) lx = 2;
      if (lx + tw + 16 > w) lx = w - tw - 18;
      if (ly < 2) ly = p.y + 12;
      ctx.fillStyle = '#FFE135';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(lx, ly, tw + 16, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 8, ly + 10);
    }

    ctx.fillStyle = '#000000';
    ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    if (points[0]) ctx.fillText(points[0].date, pad.left, h - 3);
    ctx.textAlign = 'right';
    if (points[points.length - 1]) ctx.fillText(points[points.length - 1].date, w - pad.right, h - 3);
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
