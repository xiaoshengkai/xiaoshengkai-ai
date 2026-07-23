function fmt(val, decimals = 2) {
  if (val == null) return "--";
  return Number(val).toFixed(decimals);
}

function fmtPrice(item) {
  if (item.error) return "--";
  if (item.priceCny != null) {
    return `<span style="display:block;font-weight:700;color:#0f172a;font-size:clamp(14px,4vw,16px);line-height:1.3">¥${fmt(item.priceCny)}/g</span>` +
      `<span style="display:block;margin-top:2px;font-size:clamp(10px,2.5vw,12px);color:#94a3b8;line-height:1.2">${fmt(item.price)}${item.unit}</span>`;
  }
  return `<span style="font-weight:600;color:#1e293b">${fmt(item.price)}${item.unit}</span>`;
}

function fmtChange(item) {
  if (item.change == null) return { text: "--", cls: "neutral" };
  const abs = Math.abs(item.change).toFixed(2);
  return {
    text: item.change >= 0 ? `▲${abs}%` : `▼${abs}%`,
    cls: item.change >= 0 ? "up" : "down",
  };
}

function buildRow(item) {
  if (item.error) {
    return (
      `<tr style="border-bottom:1px solid #f1f5f9">` +
      `<td colspan="3" style="padding:8px 4%;font-size:clamp(12px,3.5vw,14px);color:#94a3b8">${item.emoji} ${item.name} 获取失败</td>` +
      `</tr>`
    );
  }

  const ch = fmtChange(item);
  const bg = ch.cls === "up" ? "#fef2f2" : ch.cls === "down" ? "#f0fdf4" : "transparent";
  const color = ch.cls === "up" ? "#dc2626" : ch.cls === "down" ? "#16a34a" : "#94a3b8";

  return (
    `<tr style="border-bottom:1px solid #f1f5f9">` +
    `<td style="padding:8px 0 8px 4%">` +
    `<span style="font-size:clamp(13px,3.8vw,15px);font-weight:500;color:#1e293b">${item.emoji} ${item.name}</span>` +
    `</td>` +
    `<td style="padding:8px 0 8px 4px;text-align:right">${fmtPrice(item)}</td>` +
    `<td style="padding:8px 4% 8px 0;text-align:right">` +
    `<span style="display:inline-block;padding:2px clamp(4px,1.5vw,8px);border-radius:4px;font-size:clamp(11px,3vw,13px);font-weight:600;background:${bg};color:${color};min-width:3.5em;text-align:center">${ch.text}</span>` +
    `</td>` +
    `</tr>`
  );
}

function buildRangeRow(item) {
  if (item.high52 == null || item.low52 == null || item.price == null) return "";
  if (item.high52 === item.low52) return "";

  const pct = ((item.price - item.low52) / (item.high52 - item.low52)) * 100;
  const clamped = Math.max(0, Math.min(100, pct));

  const h = fmt(item.high52, 0);
  const l = fmt(item.low52, 0);
  const hCny = item.highCny != null ? ` ¥${fmt(item.highCny)}` : "";
  const lCny = item.lowCny != null ? ` ¥${fmt(item.lowCny)}` : "";

  return (
    `<tr style="border-bottom:1px solid #f1f5f9">` +
    `<td colspan="3" style="padding:2px 4% 6px">` +
    `<div style="display:flex;align-items:center;gap:0 6px">` +
    `<span style="font-size:clamp(10px,2.5vw,11px);color:#94a3b8;white-space:nowrap">10年最低${l}${lCny}</span>` +
    `<span style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;min-width:30px">` +
    `<span style="display:block;width:${clamped.toFixed(0)}%;height:100%;background:#64748b;border-radius:2px"></span>` +
    `</span>` +
    `<span style="font-size:clamp(10px,2.5vw,11px);color:#94a3b8;white-space:nowrap">10年最高${h}${hCny}</span>` +
    `</div>` +
    `</td>` +
    `</tr>`
  );
}

function buildCard(cat) {
  const rows = [];
  for (const item of cat.items) {
    rows.push(buildRow(item));
  }

  return (
    `<div style="background:#fff;border-radius:10px;margin-bottom:clamp(6px,2vw,10px);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04)">` +
    `<div style="padding:clamp(8px,2.5vw,10px) 4% 4px;font-size:clamp(11px,2.8vw,12px);font-weight:600;color:#94a3b8;letter-spacing:0.5px">${cat.label}</div>` +
    `<table style="width:100%;border-collapse:collapse">` +
    rows.join("") +
    `</table>` +
    `</div>`
  );
}

function buildMacroRow(ind) {
  const value = ind.value != null ? `${fmt(ind.value)}${ind.unit}` : "--";
  const date = ind.date ? ind.date.substring(0, 10) : "";

  let changeHtml = "";
  if (ind.prevValue != null && ind.value != null && ind.prevValue !== ind.value) {
    const diff = ind.value - ind.prevValue;
    const cls = diff > 0 ? "up" : "down";
    const bg = cls === "up" ? "#fef2f2" : "#f0fdf4";
    const color = cls === "up" ? "#dc2626" : "#16a34a";
    const arrow = diff > 0 ? "▲" : "▼";
    changeHtml = `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;font-size:clamp(10px,2.5vw,11px);font-weight:600;background:${bg};color:${color}">${arrow}${fmt(Math.abs(diff))}${ind.unit}</span>`;
  }

  return (
    `<span style="display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:2px 6px;padding:4px 0">` +
    `<span style="font-size:clamp(12px,3.5vw,14px);color:#1e293b">${ind.emoji} ${ind.name}</span>` +
    `<span style="font-weight:600;color:#0f172a;font-size:clamp(13px,3.8vw,15px)">${value}${changeHtml}</span>` +
    (date ? `<span style="font-size:10px;color:#94a3b8">${date}</span>` : "") +
    `</span>`
  );
}

function buildMacroCard(macroIndicators) {
  if (!macroIndicators || macroIndicators.length === 0) return "";

  const rows = macroIndicators.map(ind => {
    if (ind.error) {
      return `<span style="display:block;padding:4px 0;font-size:clamp(12px,3.5vw,14px);color:#94a3b8">${ind.emoji} ${ind.name} 获取失败</span>`;
    }
    return buildMacroRow(ind);
  });

  return (
    `<div style="background:#fff;border-radius:10px;margin-bottom:clamp(6px,2vw,10px);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04)">` +
    `<div style="padding:clamp(8px,2.5vw,10px) 4% 4px;font-size:clamp(11px,2.8vw,12px);font-weight:600;color:#94a3b8;letter-spacing:0.5px">🏛️ 宏观经济</div>` +
    `<div style="padding:4px 4% 8px;display:flex;flex-direction:column;gap:2px">` +
    rows.join("") +
    `</div>` +
    `</div>`
  );
}

export function formatMessage(categories, usdCny, macroIndicators) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const forex = usdCny != null
    ? `💱 美元/人民币 ${usdCny.toFixed(4)}`
    : "💱 美元/人民币 获取失败";

  return (
    `<div style="max-width:600px;margin:0 auto;background:#f1f5f9;padding:clamp(8px,2.5vw,14px);font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">` +
    `<div style="text-align:center;margin-bottom:clamp(8px,2.5vw,12px)">` +
    `<div style="font-size:clamp(16px,5vw,20px);font-weight:700;color:#0f172a">📊 市场早报</div>` +
    `<div style="font-size:clamp(11px,2.8vw,13px);color:#94a3b8;margin-top:2px">${dateStr} ${timeStr}</div>` +
    `</div>` +
    categories.map(buildCard).join("") +
    buildMacroCard(macroIndicators) +
    `<div style="text-align:center;font-size:clamp(11px,2.8vw,12px);color:#94a3b8;padding:4px 4% 0">${forex}</div>` +
    `</div>`
  );
}