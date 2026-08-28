/**
 * hot-news HTML 仪表盘生成器 —— Tab 标签页版
 * 严格遵循项目 DESIGN.md 的 UI 风格：Neo-Brutalism 糖果色
 * - 纯白背景 #FFFFFF / 次背景 #F5F5F5
 * - 纯黑实线边框(2-4px) + 零模糊纯黑硬阴影(Npx Npx 0 #000)
 * - 主色电光黄 #FFE135(黑字)，粉/蓝/紫/橙/深绿点缀
 * - 直角(--radius: 0)
 * - 字体: Inter / Plus Jakarta Sans / JetBrains Mono
 *
 * Tab 排布：娱乐 / 财经 / 体育 / 科技数码 / 其他
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatHot } from "./classifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");

// Tab 展示顺序：娱乐 / 财经 / 体育 / 科技数码 / 其他
const CATEGORY_ORDER = ["entertainment", "finance", "sports", "tech", "other"];

// 糖果色点缀主题（每分类独立主色）
const CATEGORY_THEME = {
  sports: { color: "#4D7CFE", soft: "#D6E4FF" },
  finance: { color: "#16A34A", soft: "#D9F2E2" },
  entertainment: { color: "#FF5C8A", soft: "#FFDCE7" },
  tech: { color: "#8B5CF6", soft: "#E8DEFF" },
  other: { color: "#FB923C", soft: "#FFE7D3" },
};

// 来源品牌色（糖果色系）
const SOURCE_COLORS = {
  微博: "#E6162D",
  百度: "#2932E1",
  新浪: "#FF8200",
  知乎: "#0084FF",
  头条: "#F04142",
  抖音: "#111111",
};

// 前三名糖果色高亮块
const RANK_COLORS = ["#FFE135", "#FFB3C7", "#A8D8FF"];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderItems(items, theme, maxHot) {
  if (!items || !items.length) {
    return `<div class="empty">今日暂无该分类内容</div>`;
  }

  return items
    .map((it, i) => {
      const srcList = [...(it.sources || [])];
      const hot = it.hot != null ? it.hot : null;
      const hotLabel = hot != null ? formatHot(hot) : "";
      const pct = hot != null && maxHot > 0 ? Math.max(5, Math.round((hot / maxHot) * 100)) : 0;
      const url = it.url ? `href="${escapeHtml(it.url)}" target="_blank" rel="noopener"` : "";

      // 前三名用糖果色高亮，其余用分类软色
      const rankBg = i < 3 ? RANK_COLORS[i] : theme.soft;

      const srcs = srcList
        .map(
          (s) =>
            `<span class="src-chip" style="background:${SOURCE_COLORS[s] || "#111"}" title="${escapeHtml(s)}">${escapeHtml(s)}</span>`
        )
        .join("");

      return `
      <div class="item">
        <div class="item-main">
          <span class="rank" style="background:${rankBg}">${String(i + 1).padStart(2, "0")}</span>
          <a class="item-name" ${url}>${escapeHtml(it.title)}</a>
          <span class="hot">${hot != null ? "🔥 " + hotLabel : "—"}</span>
        </div>
        <div class="item-sub">
          <span class="srcs">${srcs}</span>
          ${hot != null ? `<div class="hot-bar"><div class="hot-fill" style="width:${pct}%;background:${theme.color}"></div></div>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

export async function generateDashboard(grouped, meta) {
  const { sourceStatus = [], totalRaw = 0 } = meta;
  const updateTime = nowText();

  const onlineCount = sourceStatus.filter((s) => s.ok).length;
  const totalCount = sourceStatus.length;
  let mergedCount = 0;
  for (const g of grouped.values()) mergedCount += (g.items || []).length;

  // 来源状态徽章
  const sourceBadges = sourceStatus
    .map(
      (s) => `
      <span class="src-badge ${s.ok ? "ok" : "fail"}">
        <span class="dot" style="background:${SOURCE_COLORS[s.label] || "#111"}"></span>
        ${escapeHtml(s.label)}<b>${s.ok ? s.count : "✗"}</b>
      </span>`
    )
    .join("");

  // ===== Tab 按钮 + Panel 面板 =====
  const tabs = [];
  const panels = [];

  CATEGORY_ORDER.forEach((key, idx) => {
    const group = grouped.get(key);
    const items = group?.items || [];
    const theme = CATEGORY_THEME[key] || CATEGORY_THEME.other;
    const label = group?.label || key;
    const emoji = group?.emoji || "";
    const maxHot = Math.max(...items.map((it) => (it.hot != null ? it.hot : 0)), 0);

    // Tab 按钮（第一个默认激活）
    const active = idx === 0 ? " active" : "";
    tabs.push(`
      <button class="tab${active}" data-tab="${key}" style="--tc:${theme.color}">
        <span class="tab-emoji">${emoji}</span>${escapeHtml(label)}
        <span class="tab-n">${items.length}</span>
      </button>`);

    // Panel 面板（第一个默认显示）
    const show = idx === 0 ? " show" : "";
    panels.push(`
    <div class="panel${show}" data-panel="${key}">
      <div class="card">
        ${renderItems(items, theme, maxHot)}
      </div>
    </div>`);
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>每日热点新闻</title>
<style>
:root{
  --bg:#FFFFFF;
  --muted:#F5F5F5;
  --ink:#000000;
  --yellow:#FFE135;
  --font-body:'Inter',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  --font-title:'Plus Jakarta Sans','Inter',-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--font-body);
  background:var(--bg);
  color:var(--ink);
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}

/* ===== 顶部 ===== */
.header{
  background:var(--yellow);
  border-bottom:3px solid var(--ink);
  padding:32px 20px 26px;
}
.header-inner{max-width:1080px;margin:0 auto}
.brand{
  display:inline-block;
  font-family:var(--font-title);
  font-weight:800;
  font-size:clamp(24px,5vw,34px);
  letter-spacing:-0.5px;
  background:var(--yellow);
  border:3px solid var(--ink);
  box-shadow:6px 6px 0 var(--ink);
  padding:10px 22px;
}
.meta{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:22px;
}
.stat{
  background:var(--bg);
  border:3px solid var(--ink);
  box-shadow:4px 4px 0 var(--ink);
  padding:8px 14px;
  font-family:var(--font-mono);
  font-size:12.5px;
  font-weight:700;
}
.stat b{font-size:15px}

/* ===== 来源徽章 ===== */
.src-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.src-badge{
  display:inline-flex;align-items:center;gap:7px;
  font-family:var(--font-mono);font-size:12px;font-weight:700;
  background:var(--bg);border:2px solid var(--ink);
  box-shadow:3px 3px 0 var(--ink);
  padding:5px 12px;
}
.src-badge .dot{width:10px;height:10px;border:1.5px solid var(--ink);flex-shrink:0}
.src-badge b{font-size:13px}
.src-badge.fail{opacity:.45;text-decoration:line-through}

/* ===== 主体 ===== */
.container{max-width:1080px;margin:0 auto;padding:30px 18px 50px}

/* ===== Tab 导航 ===== */
.tabs{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-bottom:22px;
}
.tab{
  font-family:var(--font-title);
  font-weight:800;
  font-size:15px;
  color:var(--ink);
  background:var(--bg);
  border:3px solid var(--ink);
  box-shadow:4px 4px 0 var(--ink);
  padding:10px 18px;
  cursor:pointer;
  display:inline-flex;
  align-items:center;
  gap:8px;
  transition:transform .1s, box-shadow .1s, background .12s;
}
.tab:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--ink)}
.tab.active{
  background:var(--tc);
  color:#fff;
  transform:translate(-2px,-2px);
  box-shadow:6px 6px 0 var(--ink);
  text-shadow:0 1px 0 rgba(0,0,0,.15);
}
.tab-emoji{font-size:16px}
.tab-n{
  font-family:var(--font-mono);
  font-size:12px;
  font-weight:800;
  background:var(--bg);
  color:var(--ink);
  border:2px solid var(--ink);
  padding:1px 7px;
  text-shadow:none;
}

/* ===== Panel ===== */
.panel{display:none}
.panel.show{display:block;animation:pop .18s ease}
@keyframes pop{
  from{opacity:0;transform:translateY(6px)}
  to{opacity:1;transform:translateY(0)}
}

/* 卡片 */
.card{
  background:var(--bg);
  border:3px solid var(--ink);
  box-shadow:6px 6px 0 var(--ink);
  padding:4px 18px;
}

/* 单条热点 */
.item{padding:13px 0;border-bottom:2px solid var(--ink)}
.item:last-child{border-bottom:none}
.item-main{display:flex;align-items:flex-start;gap:12px}
.rank{
  font-family:var(--font-mono);font-weight:800;font-size:13px;
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  flex-shrink:0;margin-top:1px;
}
.item-name{
  flex:1;font-size:15px;line-height:1.55;font-weight:700;color:var(--ink);
  text-decoration:none;transition:background .12s;
}
.item-name:hover{background:var(--yellow);box-shadow:0 0 0 2px var(--yellow)}
.hot{
  font-family:var(--font-mono);font-size:13px;font-weight:800;
  background:var(--yellow);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  padding:3px 9px;white-space:nowrap;flex-shrink:0;
}
.item-sub{display:flex;align-items:center;gap:12px;margin:10px 0 2px 44px}
.srcs{display:flex;flex-wrap:wrap;gap:5px}
.src-chip{
  font-family:var(--font-mono);font-size:10.5px;font-weight:800;color:#fff;
  border:1.5px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  padding:2px 7px;text-shadow:0 1px 0 rgba(0,0,0,.2);
}
.hot-bar{flex:1;height:8px;background:var(--muted);border:2px solid var(--ink);overflow:hidden}
.hot-fill{height:100%;display:block}

.empty{
  text-align:center;padding:30px;font-size:14px;font-weight:700;
  color:#888;font-family:var(--font-mono);
}

/* ===== 页脚 ===== */
.footer{
  max-width:1080px;margin:0 auto;padding:0 18px 50px;
  text-align:center;font-family:var(--font-mono);font-size:12px;color:#666;
}

@media (max-width:640px){
  .tab{padding:9px 13px;font-size:14px}
  .item-main{flex-wrap:wrap}
  .item-name{flex-basis:calc(100% - 44px)}
  .hot{margin-left:44px}
  .item-sub{margin-left:0}
}
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <span class="brand">📰 每日热点新闻</span>
    <div class="meta">
      <span class="stat">🕙 <b>${updateTime}</b></span>
      <span class="stat">📡 来源 <b>${onlineCount}/${totalCount}</b></span>
      <span class="stat">📥 抓取 <b>${totalRaw}</b></span>
      <span class="stat">🧩 展示 <b>${mergedCount}</b></span>
    </div>
    <div class="src-row">${sourceBadges}</div>
  </div>
</div>

<div class="container">
  <div class="tabs">${tabs.join("")}</div>
  ${panels.join("")}
</div>

<div class="footer">每日热点新闻 · 微博 / 百度 / 知乎 / 今日头条 / 抖音 · 关键词自动分类 · Neo-Brutalism</div>

<script>
(function () {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.remove("active"); });
      panels.forEach(function (p) { p.classList.remove("show"); });
      t.classList.add("active");
      const target = document.querySelector('[data-panel="' + t.dataset.tab + '"]');
      if (target) target.classList.add("show");
    });
  });
})();
</script>
</body>
</html>`;

  fs.writeFileSync(DASHBOARD_FILE, html, "utf-8");
  console.log(`[DASHBOARD] 已生成: ${DASHBOARD_FILE}`);
}
