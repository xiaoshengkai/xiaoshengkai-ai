/**
 * 贝壳房源跟踪 HTML 仪表盘生成器
 * 项目 UI 风格：Neo-Brutalism（纯白底 / 黑实线 / 硬阴影 / 电光黄 / 等宽数字）
 * 数据内嵌 JSON + 原生 JS 渲染（支持表头排序）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elevatorText } from "./parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");

const GROUP_THEME = {
  donghu: { color: "#4D7CFE", soft: "#D6E4FF" },
  gaobu: { color: "#16A34A", soft: "#D9F2E2" },
  didang: { color: "#FF5C8A", soft: "#FFDCE7" },
  lianghu: { color: "#8B5CF6", soft: "#E8DEFF" },
};

const CHANGE_THEME = {
  added: { color: "#16A34A", label: "新上架", emoji: "🆕" },
  priceDown: { color: "#4D7CFE", label: "降价", emoji: "📉" },
  priceUp: { color: "#FF5C8A", label: "涨价", emoji: "📈" },
  removed: { color: "#6B7280", label: "下架/离场", emoji: "🚪" },
};

function jsonForScript(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");
}

function escapeHtmlText(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  return n == null ? "—" : Number(n).toLocaleString("zh-CN");
}

function buildPayload({ date, fetchedAt, houses, changes, groupLabels }) {
  // 街道 → 小区 二级分组（给定房源子集）
  const buildGroups = (list) => {
    const out = [];
    for (const [key, label] of Object.entries(groupLabels)) {
      const gh = list.filter((h) => h.group === key);
      const byCommunity = new Map();
      for (const h of gh) {
        if (!byCommunity.has(h.community)) byCommunity.set(h.community, []);
        byCommunity.get(h.community).push({
          id: h.id,
          title: h.title,
          url: h.url,
          layout: h.layout,
          size: h.size,
          floorLevel: h.floorLevel,
          totalFloors: h.totalFloors,
          elevator: elevatorText(h.totalFloors),
          orientation: h.orientation || "—",
          totalPrice: h.totalPrice,
          unitPrice: h.unitPrice,
          follows: h.follows,
          publishText: h.publishText,
          tags: h.tags || [],
          days: h.firstSeen ? Math.max(0, daysBetween(h.firstSeen, date)) : null,
          priceChanges: h.priceChanges || 0,
          reappeared: Boolean(h.reappeared),
        });
      }
      const communities = [...byCommunity.entries()]
        .map(([name, houses]) => ({ name, houses: houses.sort((a, b) => a.totalPrice - b.totalPrice) }))
        .sort((a, b) => a.houses[0]?.totalPrice - b.houses[0]?.totalPrice);
      if (communities.length) out.push({ key, label, communities, count: gh.length });
    }
    return out;
  };

  // 双区块：三室+（≥3室 全域）/ 二室+（≥2室 · 御景华庭一~五期，track2 标记）
  const groups = buildGroups(houses.filter((h) => h.rooms >= 3));
  const groups2 = buildGroups(houses.filter((h) => h.track2));

  return {
    date,
    fetchedAt,
    summary: buildSummary(houses, changes),
    totals: {
      houses: houses.length,
      communities: groups.reduce((n, g) => n + g.communities.length, 0),
      groups: Object.fromEntries(groups.map((g) => [g.label, g.count])),
    },
    groups,
    groups2,
    changes: changes
      ? {
          added: changes.added.map(toChangeItem),
          priceDown: changes.priceDown.map((c) => ({ ...toChangeItem(c.after), prevTotal: c.before.totalPrice, delta: c.deltaTotal })),
          priceUp: changes.priceUp.map((c) => ({ ...toChangeItem(c.after), prevTotal: c.before.totalPrice, delta: c.deltaTotal })),
          removed: changes.removed.map((h) => ({ ...toChangeItem(h), removedReason: h.removedReason || "" })),
        }
      : null,
  };
}

/** 每日结论：一行人话总结（页面给人看） */
function buildSummary(houses, changes) {
  const n = houses.length;
  if (!houses.length) return "当前筛选条件下暂无在售房源";
  const cheapest = [...houses].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  const low = `最低 ${cheapest.community} ${cheapest.totalPrice}万`;
  if (!changes) return `开始跟踪：在跟 ${n} 套 · ${low}`;
  const { added, priceDown, priceUp, removed } = changes;
  if (!added.length && !priceDown.length && !priceUp.length && !removed.length) {
    return `今日无变化 · 在跟 ${n} 套 · ${low}`;
  }
  const parts = [];
  if (added.length) parts.push(`新增 ${added.length}`);
  if (priceDown.length) parts.push(`降价 ${priceDown.length}`);
  if (priceUp.length) parts.push(`涨价 ${priceUp.length}`);
  if (removed.length) parts.push(`下架 ${removed.length}`);
  return `今日${parts.join(" · ")} · 在跟 ${n} 套 · ${low}`;
}

function toChangeItem(h) {
  return {
    id: h.id,
    community: h.community,
    layout: h.layout,
    size: h.size,
    totalPrice: h.totalPrice,
    url: h.url,
    reappeared: Boolean(h.reappeared),
    removedReason: h.removedReason || "",
  };
}

function daysBetween(from, to) {
  return Math.round((new Date(to) - new Date(from)) / 86400000);
}

function render(changes) {
  if (!changes) return "";
  const parts = [];
  for (const key of ["added", "priceDown", "priceUp", "removed"]) {
    const list = changes[key] || [];
    const t = CHANGE_THEME[key];
    const items = list
      .map((h) => {
        const price =
          h.prevTotal != null
            ? `${fmt(h.prevTotal)} → <span class="chg-badge">${fmt(h.totalPrice)}</span>万 <span class="delta">${h.delta > 0 ? "+" : ""}${h.delta}</span>`
            : `<span class="chg-badge">${fmt(h.totalPrice)}</span>万`;
        const badge = h.reappeared ? '<span class="re-badge">重新上架</span>' : "";
        const reason = h.removedReason ? `<span class="reason">${h.removedReason}</span>` : "";
        return `<a class="chg-item" href="${h.url}" target="_blank" rel="noopener">
          <span class="chg-addr">${h.community} · ${h.layout} · ${fmt(h.size)}㎡${badge}${reason}</span>
          <span class="chg-price">${price}</span></a>`;
      })
      .join("");
    parts.push(`<div class="chg-card" style="--cc:${t.color};--cs:${t.color}22">
      <div class="chg-head">${t.emoji} ${t.label} <span class="chg-n">${list.length}</span></div>
      ${list.length ? `<div class="chg-list">${items}</div>` : '<div class="chg-empty">无</div>'}
    </div>`);
  }
  return parts.join("");
}

function buildHtml(payload) {
  const stats = Object.entries(payload.totals.groups)
    .map(([label, n]) => `<div class="stat">${label} <b>${n}</b> 套</div>`)
    .join("");
  const summary = `<div class="summary"><span class="s-label">每日结论</span><span class="s-text">${escapeHtmlText(payload.summary)}</span></div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>贝壳房源跟踪 · 绍兴越城</title>
<style>
:root{
  --bg:#FFFFFF;--muted:#F5F5F5;--ink:#000000;--yellow:#FFE135;
  --font-body:'Inter',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  --font-title:'Plus Jakarta Sans','Inter',-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-body);background:var(--bg);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased}
.header{background:var(--yellow);border-bottom:3px solid var(--ink);padding:30px 20px 24px}
.header-inner{max-width:1240px;margin:0 auto}
.brand{display:inline-block;font-family:var(--font-title);font-weight:800;font-size:clamp(22px,4vw,32px);letter-spacing:-.5px;background:var(--yellow);border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:10px 22px}
.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.stat{background:var(--bg);border:3px solid var(--ink);box-shadow:4px 4px 0 var(--ink);padding:8px 14px;font-family:var(--font-mono);font-size:12.5px;font-weight:700}
.stat b{font-size:15px}
.summary{max-width:1240px;margin:18px auto 0;display:flex;align-items:center;gap:14px;border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);background:var(--ink);padding:12px 18px;flex-wrap:wrap}
.summary .s-label{font-family:var(--font-title);font-weight:800;font-size:13px;background:var(--yellow);border:2px solid var(--yellow);padding:2px 10px;color:var(--ink);flex-shrink:0}
.summary .s-text{font-family:var(--font-mono);font-weight:700;font-size:14px;color:#fff;line-height:1.5}
.summary .s-text b{color:var(--yellow);font-size:16px}
.container{max-width:1240px;margin:0 auto;padding:26px 18px 60px}
.sect-title{font-family:var(--font-title);font-weight:800;font-size:20px;margin:26px 0 14px;display:flex;align-items:center;gap:10px}
.sect-title::before{content:"";width:14px;height:14px;background:var(--ink)}
.chg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.chg-card{border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);background:var(--bg)}
.chg-head{font-family:var(--font-title);font-weight:800;font-size:15px;padding:10px 14px;border-bottom:3px solid var(--ink);background:var(--cc);color:#fff}
.chg-n{font-family:var(--font-mono);background:var(--bg);color:var(--ink);border:2px solid var(--ink);padding:0 7px;margin-left:6px;font-size:12px}
.chg-list{max-height:340px;overflow:auto}
.chg-item{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 14px;border-bottom:2px dashed #ddd;text-decoration:none;color:var(--ink);font-size:13px}
.chg-item:hover{background:var(--muted)}
.chg-addr{font-weight:600}
.chg-price{font-family:var(--font-mono);font-weight:700;font-size:13px;white-space:nowrap}
.chg-price b{font-size:16px;font-weight:800}
.chg-price .chg-badge{background:var(--yellow);border:2px solid var(--ink);padding:0 6px;font-size:14px;font-weight:800}
.delta{background:var(--cc);color:#fff;padding:1px 6px;font-weight:800}
.re-badge{background:var(--yellow);border:2px solid var(--ink);padding:0 6px;font-size:11px;font-weight:800;margin-left:6px}
.reason{color:#666;font-size:11px;margin-left:6px}
.chg-empty{padding:14px;font-family:var(--font-mono);color:#999;font-size:13px}
.group{border:3px solid var(--ink);box-shadow:8px 8px 0 var(--ink);margin-bottom:26px;background:var(--bg)}
.group-head{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:3px solid var(--ink);background:var(--gc);color:#fff;cursor:pointer}
.group-head .g-label{font-family:var(--font-title);font-weight:800;font-size:17px}
.group-head .g-n{font-family:var(--font-mono);font-size:12px;background:var(--bg);color:var(--ink);border:2px solid var(--ink);padding:1px 8px;font-weight:800}
.community{border-bottom:3px solid var(--ink)}
.community:last-child{border-bottom:none}
.comm-head{display:flex;align-items:center;gap:10px;padding:9px 16px;background:var(--gs);border-bottom:2px solid var(--ink);font-weight:700;font-size:14px;cursor:pointer}
.comm-head .c-n{font-family:var(--font-mono);font-size:11.5px;background:var(--bg);border:2px solid var(--ink);padding:0 7px;font-weight:800}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{font-family:var(--font-mono);font-size:11px;font-weight:800;background:var(--muted);border-bottom:2px solid var(--ink);padding:7px 8px;cursor:pointer;user-select:none;white-space:nowrap;position:sticky;top:0;z-index:2}
th:hover{background:var(--yellow)}
th .arrow{font-size:9px}
td{padding:7px 8px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
tbody tr:hover{background:#FFFBE8}
td.num{font-family:var(--font-mono);font-weight:700;white-space:nowrap}
td.num .total{font-family:var(--font-mono);font-weight:800;font-size:16px;background:var(--yellow);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);padding:1px 8px;display:inline-block}
td.num .unit{font-size:12px}
td .title-link{color:var(--ink);text-decoration:none;font-weight:600;display:block;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
td .title-link:hover{text-decoration:underline}
.tagchip{display:inline-block;border:1.5px solid var(--ink);background:var(--muted);padding:0 5px;font-size:10.5px;font-weight:700;margin:1px 2px 1px 0;white-space:nowrap}
.dayschip{font-family:var(--font-mono);font-weight:800}
.dayschip.old{background:var(--yellow);padding:0 5px;border:1.5px solid var(--ink)}
.beike-link{font-family:var(--font-mono);font-size:11px;font-weight:800;color:var(--ink);text-decoration:none;border:2px solid var(--ink);padding:1px 7px;background:var(--muted);white-space:nowrap}
.beike-link:hover{background:var(--yellow)}
.footer{max-width:1240px;margin:0 auto;padding:0 18px 50px;font-family:var(--font-mono);font-size:11.5px;color:#888}
.empty-all{border:3px dashed var(--ink);padding:40px;text-align:center;font-family:var(--font-mono);font-size:14px;background:var(--muted)}
</style>
</head>
<body>
<div class="header"><div class="header-inner">
  <div class="brand">🏠 贝壳房源跟踪 · 绍兴越城</div>
  <div class="meta">
    <div class="stat">数据日期 <b>${payload.date}</b></div>
    ${stats}
    <div class="stat">在跟小区 <b>${payload.totals.communities}</b></div>
  </div>
  ${summary}
</div></div>
<div class="container">
  <div class="sect-title">今日变化</div>
  <div class="chg-grid">${render(payload.changes)}</div>
  <div class="sect-title">在售房源（99万内 · 三室+）</div>
  <div id="groups"></div>
  <div class="sect-title">在售房源（99万内 · 二室+ · 御景华庭一~五期）</div>
  <div id="groups2"></div>
</div>
<div class="footer">数据来源 sx.ke.com（贝壳）· 每日 9:30 更新 · 电梯按总层数≥7 推断 · 单位：总价 万 / 单价 元/㎡<br>更新时间 ${payload.fetchedAt} · 本页数据为抓取时点快照，房源状态以贝壳为准</div>
<script id="payload" type="application/json">${jsonForScript(payload)}</script>
<script>
(function(){
  var payload = JSON.parse(document.getElementById("payload").textContent);

  function renderGroups(containerId, groups) {
    var el = document.getElementById(containerId);
    if (!groups.length) {
      el.innerHTML = '<div class="empty-all">当前筛选条件下暂无在售房源</div>';
      return;
    }
    groups.forEach(function(g){
    var div = document.createElement("div");
    div.className = "group";
    div.style.setProperty("--gc", theme(g.key).color);
    div.style.setProperty("--gs", theme(g.key).soft);
    var head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = '<span class="g-label">' + esc(g.label) + '</span><span class="g-n">' + g.count + ' 套 · ' + g.communities.length + ' 个小区</span><span style="margin-left:auto;font-size:12px">点击折叠</span>';
    var body = document.createElement("div");
    head.onclick = function(){ body.style.display = body.style.display === "none" ? "" : "none"; };
    if (!g.communities.length) {
      body.innerHTML = '<div style="padding:22px;font-family:var(--font-mono);font-size:13px;color:#999;text-align:center">当前筛选条件下暂无在售房源</div>';
    }
    g.communities.forEach(function(c){
      var comm = document.createElement("div");
      comm.className = "community";
      var commHead = document.createElement("div");
      commHead.className = "comm-head";
      commHead.innerHTML = esc(c.name) + ' <span class="c-n">' + c.houses.length + ' 套</span>';
      var tblBox = document.createElement("div");
      commHead.onclick = function(){ tblBox.style.display = tblBox.style.display === "none" ? "" : "none"; };
      comm.appendChild(commHead);
      comm.appendChild(tblBox);
      tblBox.appendChild(buildTable(c.houses));
      body.appendChild(comm);
    });
    div.appendChild(head);
    div.appendChild(body);
    el.appendChild(div);
    });
  }

  renderGroups("groups", payload.groups);
  renderGroups("groups2", payload.groups2);
  function buildTable(houses){
    var cols = [
      ["房源", "title", null],
      ["总价", "totalPrice", "num"],
      ["单价", "unitPrice", "num"],
      ["户型", "layout", null],
      ["面积", "size", "num"],
      ["楼层", "floor", null],
      ["电梯", "elevator", null],
      ["朝向", "orientation", null],
      ["标签", "tags", null],
      ["关注", "follows", "num"],
      ["发布", "publishText", null],
      ["跟踪", "days", "num"],
      ["", "link", null]
    ];
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var tr = document.createElement("tr");
    var sortState = {};
    cols.forEach(function(col){
      var th = document.createElement("th");
      th.innerHTML = esc(col[0]) + ' <span class="arrow"></span>';
      th.onclick = function(){
        var key = col[1];
        sortState.key = key; sortState.asc = sortState.key === key && !sortState.asc;
        renderRows();
      };
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    table.appendChild(tbody);
    function val(h, key){
      if (key === "floor") return (h.floorLevel || "") + (h.totalFloors ? "(共" + h.totalFloors + "层)" : "");
      return h[key];
    }
    function cmp(a, b, key){
      var va = val(a, key), vb = val(b, key);
      var na = parseFloat(va), nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb) && (key !== "publishText")) return na - nb;
      return String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb), "zh");
    }
    function renderRows(){
      if (sortState.key) {
        houses.sort(function(a, b){
          var r = cmp(a, b, sortState.key);
          return sortState.asc ? r : -r;
        });
      }
      var ths = tr.querySelectorAll("th");
      cols.forEach(function(col, i){
        ths[i].querySelector(".arrow").textContent = sortState.key === col[1] ? (sortState.asc ? "▲" : "▼") : "";
      });
      tbody.innerHTML = "";
      houses.forEach(function(h){
        var trr = document.createElement("tr");
        cols.forEach(function(col){
          var td = document.createElement("td");
          if (col[2]) td.className = col[2];
          var key = col[1];
          if (key === "title") {
            td.innerHTML = '<a class="title-link" href="' + esc(h.url) + '" target="_blank" rel="noopener" title="' + esc(h.title) + '">' + (h.reappeared ? '<span class="re-badge">重新上架</span> ' : '') + esc(h.title) + '</a>';
          } else if (key === "totalPrice") {
            td.innerHTML = '<span class="total">' + h.totalPrice + '</span>';
          } else if (key === "unitPrice") {
            td.textContent = fmtNum(h.unitPrice);
          } else if (key === "floor") {
            td.textContent = (h.floorLevel || "—") + (h.totalFloors ? " 共" + h.totalFloors + "层" : "");
          } else if (key === "tags") {
            td.innerHTML = (h.tags || []).map(function(t){ return '<span class="tagchip">' + esc(t) + "</span>"; }).join("") || "—";
          } else if (key === "days") {
            if (h.days == null) { td.textContent = "今天"; }
            else {
              td.innerHTML = '<span class="dayschip' + (h.days >= 30 ? " old" : "") + '">' + h.days + "天</span>";
              if (h.priceChanges > 0) td.innerHTML += ' <span class="tagchip">变价×' + h.priceChanges + "</span>";
            }
          } else if (key === "link") {
            td.innerHTML = '<a class="beike-link" href="' + esc(h.url) + '" target="_blank" rel="noopener">贝壳↗</a>';
          } else {
            td.textContent = val(h, key) != null && val(h, key) !== "" ? val(h, key) : "—";
          }
          trr.appendChild(td);
        });
        tbody.appendChild(trr);
      });
    }
    renderRows();
    return table;
  }
  function theme(key){
    var map = {
      donghu: { color: "#4D7CFE", soft: "#D6E4FF" },
      gaobu: { color: "#16A34A", soft: "#D9F2E2" },
      didang: { color: "#FF5C8A", soft: "#FFDCE7" },
      lianghu: { color: "#8B5CF6", soft: "#E8DEFF" }
    };
    return map[key] || { color: "#111", soft: "#eee" };
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtNum(n){
    return n == null ? "—" : Number(n).toLocaleString("zh-CN");
  }
})();
</script>
</body>
</html>`;
}

/**
 * 生成仪表盘
 * @param {object} args { date, fetchedAt, houses, changes, groupLabels }
 */
export function generateDashboard(args) {
  const payload = buildPayload(args);
  fs.mkdirSync(path.dirname(DASHBOARD_FILE), { recursive: true });
  fs.writeFileSync(DASHBOARD_FILE, buildHtml(payload), "utf-8");
  return DASHBOARD_FILE;
}
