import sharp from "sharp";

export async function loadWallMask(imagePath) {
  const { data, info } = await sharp(imagePath).grayscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const dark = (x, y) => x >= 0 && y >= 0 && x < W && y < H && data[y * W + x] < 80;
  const pts = [];
  for (let y = 3; y < H - 3; y += 2) {
    for (let x = 3; x < W - 3; x += 2) {
      if (dark(x, y) && dark(x - 3, y) && dark(x + 3, y) && dark(x, y - 3) && dark(x, y + 3)) pts.push([x, y]);
    }
  }
  return pts;
}

export async function loadColorRaw(imagePath) {
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, ch: info.channels };
}

export function snapPoint(x, y, pts, R) {
  let bx = 0, by = 0, bd = R;
  for (const [px, py] of pts) {
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; bx = px; by = py; }
  }
  if (bd >= R) return null;
  let sx = 0, sy = 0, n = 0;
  for (const [px, py] of pts) {
    if (Math.hypot(px - bx, py - by) < 6) { sx += px; sy += py; n++; }
  }
  return n ? { x: sx / n, y: sy / n } : { x: bx, y: by };
}

export function nearMask(x, y, pts, r) {
  return pts.some(([px, py]) => Math.hypot(px - x, py - y) < r);
}

export function buildMaskGrid(pts, cell = 6) {
  const g = new Set();
  for (const [x, y] of pts) g.add(Math.floor(x / cell) * 100000 + Math.floor(y / cell));
  return { cell, g };
}

export function nearGrid(x, y, grid, r = 6) {
  const c = grid.cell;
  const cx = Math.floor(x / c), cy = Math.floor(y / c);
  const rad = Math.ceil(r / c);
  for (let i = cx - rad; i <= cx + rad; i++) {
    for (let j = cy - rad; j <= cy + rad; j++) {
      if (grid.g.has(i * 100000 + j)) return true;
    }
  }
  return false;
}

// 校验失败的墙沿垂直方向滑搜重拟合：平行偏移的整体错位（吸附到错墙后回退原坐标）可救回
function centerOnMask(w, pts) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const offs = [];
  for (const [mx, my] of pts) {
    const rx = mx - w.x1, ry = my - w.y1;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > len) continue;
    const perp = rx * px + ry * py;
    if (Math.abs(perp) < 12) offs.push(perp);
  }
  if (offs.length < 8) return;
  offs.sort((a, b) => a - b);
  const med = offs[Math.floor(offs.length / 2)];
  w.x1 += px * med; w.y1 += py * med; w.x2 += px * med; w.y2 += py * med;
}

export function slideRefit(w, pts, grid, limit) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  let cand = null;
  for (let o = -limit; o <= limit; o += 4) {
    if (o === 0) continue;
    let hit = 0;
    for (let i = 0; i <= 8; i++) {
      if (nearGrid(w.x1 + px * o + dx * i / 8, w.y1 + py * o + dy * i / 8, grid, 6)) hit++;
    }
    if (hit / 9 > 0.75 && (!cand || hit > cand.hit)) cand = { hit, o };
  }
  if (!cand) return false;
  const c = { x1: w.x1 + px * cand.o, y1: w.y1 + py * cand.o, x2: w.x2 + px * cand.o, y2: w.y2 + py * cand.o };
  centerOnMask(c, pts);
  let hit = 0;
  for (let i = 0; i <= 8; i++) {
    if (nearMask(c.x1 + (c.x2 - c.x1) * i / 8, c.y1 + (c.y2 - c.y1) * i / 8, pts, 8)) hit++;
  }
  if (hit / 9 < 0.75) return false;
  w.x1 = Math.round(c.x1); w.y1 = Math.round(c.y1);
  w.x2 = Math.round(c.x2); w.y2 = Math.round(c.y2);
  return true;
}

// 墙厚（mask 垂直展宽 p10-p90）：外墙厚、内隔墙薄，用作承重启发式
export function wallThickness(w, pts) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy);
  if (!len) return 0;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const offs = [];
  for (let t = 0.3; t <= 0.71; t += 0.1) {
    const cx = w.x1 + dx * t, cy = w.y1 + dy * t;
    for (const [mx, my] of pts) {
      const rx = mx - cx, ry = my - cy;
      const along = rx * ux + ry * uy;
      const perp = rx * px + ry * py;
      if (Math.abs(along) < 8 && Math.abs(perp) < 24) offs.push(perp);
    }
  }
  if (offs.length < 8) return 0;
  offs.sort((a, b) => a - b);
  return offs[Math.floor(offs.length * 0.9)] - offs[Math.floor(offs.length * 0.1)];
}

export function snapPerimeter(walls, pts, W) {
  if (pts.length === 0) return;
  const xs = pts.map(p => p[0]).sort((a, b) => a - b);
  const ys = pts.map(p => p[1]).sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(arr.length * t))];
  const left = q(xs, 0.01), right = q(xs, 0.99), top = q(ys, 0.01), bottom = q(ys, 0.99);
  const band = W * 0.15;
  for (const w of walls) {
    if (!w.bearing) continue;
    const vertical = Math.abs(w.y2 - w.y1) >= Math.abs(w.x2 - w.x1);
    if (vertical && Math.abs(w.y2 - w.y1) > 0.3 * (bottom - top)) {
      const x = (w.x1 + w.x2) / 2;
      if (Math.abs(x - left) < band) { w.x1 = left; w.x2 = left; }
      else if (Math.abs(x - right) < band) { w.x1 = right; w.x2 = right; }
      else continue;
      w.y1 = Math.max(top, Math.min(bottom, w.y1));
      w.y2 = Math.max(top, Math.min(bottom, w.y2));
    } else if (!vertical && Math.abs(w.x2 - w.x1) > 0.3 * (right - left)) {
      const y = (w.y1 + w.y2) / 2;
      if (Math.abs(y - top) < band) { w.y1 = top; w.y2 = top; }
      else if (Math.abs(y - bottom) < band) { w.y1 = bottom; w.y2 = bottom; }
      else continue;
      w.x1 = Math.max(left, Math.min(right, w.x1));
      w.x2 = Math.max(left, Math.min(right, w.x2));
    }
  }
}

// 门窗像素检测：沿墙扫 mask 断口，断口带偏蓝=窗，否则=门；整墙即断口 → 该"墙"实为门窗，删除
// 门窗判型：中灰双线须横跨断口过半列=窗（窗线通长）；门弧只在一端=门
function classifyGap(w, s0, s1, ux, uy, px, py, img) {
  let cols = 0, midCols = 0;
  for (let s = s0; s <= s1; s += 3) {
    cols++;
    let hit = false;
    for (let o = -5; o <= 5; o += 2) {
      const x = Math.round(w.x1 + ux * s + px * o);
      const y = Math.round(w.y1 + uy * s + py * o);
      if (x < 0 || y < 0 || x >= img.W || y >= img.H) continue;
      const k = (y * img.W + x) * img.ch;
      const gray = (img.data[k] + img.data[k + 1] + img.data[k + 2]) / 3;
      if (gray >= 90 && gray <= 225) { hit = true; break; }
    }
    if (hit) midCols++;
  }
  return cols > 0 && midCols / cols >= 0.5 ? "window" : "door";
}

export function detectOpenings(walls, pts, img) {
  const grid = buildMaskGrid(pts);
  const minGap = Math.max(18, (img?.W || 1000) * 0.015);
  const maxGap = (img?.W || 1000) * 0.15;
  const openings = [];
  const drops = [];
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1 || !img) continue;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const step = 2;
    const on = [];
    for (let s = 0; s <= len; s += step) {
      const x = Math.floor((w.x1 + ux * s) / grid.cell);
      const y = Math.floor((w.y1 + uy * s) / grid.cell);
      on.push(grid.g.has(x * 100000 + y));
    }
    if (on.every(v => !v)) {
      if (classifyGap(w, 0, len, ux, uy, px, py, img) === "window") drops.push(w.id);
      continue;
    }
    let i = 0;
    while (i < on.length) {
      if (on[i]) { i++; continue; }
      let j = i;
      while (j < on.length && !on[j]) j++;
      const s0 = i * step, s1 = (j - 1) * step;
      i = j;
      if (s1 - s0 < minGap || s1 - s0 > maxGap) continue;
      const coversMost = s1 - s0 >= len * 0.7;
      if ((s0 < 4 || s1 > len - 4) && !coversMost) continue;
      const type = classifyGap(w, s0, s1, ux, uy, px, py, img);
      if (coversMost && type === "door") continue;
      openings.push({ wallId: w.id, s0, s1, pos: (s0 + s1) / 2 / len, len: s1 - s0, type });
      if (coversMost && type === "window") drops.push(w.id);
    }
  }
  // 窗梃把一扇窗拆成两段断口 → 同墙同型相邻开口合并
  openings.sort((a, b) => a.wallId === b.wallId ? a.s0 - b.s0 : a.wallId.localeCompare(b.wallId, undefined, { numeric: true }));
  const merged = [];
  const wlenOf = new Map(walls.map(w => [w.id, Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1]));
  for (const o of openings) {
    const p = merged[merged.length - 1];
    const wlen = wlenOf.get(o.wallId) || 1;
    if (p && p.wallId === o.wallId && p.type === o.type && o.s0 - p.s1 <= (img?.W || 1000) * 0.02) {
      p.s1 = o.s1; p.len = p.s1 - p.s0; p.pos = (p.s0 + p.s1) / 2 / wlen;
    } else {
      merged.push({ ...o });
    }
  }
  return { openings: merged, drops };
}

// 共线墙合并：同向、垂直距 < tol、轴向间隔 ≤ gapMax 的段并成一面（跨门洞的外墙本是一面墙）
export function mergeCollinearWalls(walls, tol, gapMax) {
  const span = (w, vertical) => vertical ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)];
  const out = [];
  for (const w of walls) {
    const vertical = Math.abs(w.y2 - w.y1) >= Math.abs(w.x2 - w.x1);
    const [lo, hi] = span(w, vertical);
    const m = out.find(o => {
      if (o._vertical !== vertical) return false;
      const off = vertical ? Math.abs((o.x1 + o.x2) / 2 - (w.x1 + w.x2) / 2) : Math.abs((o.y1 + o.y2) / 2 - (w.y1 + w.y2) / 2);
      if (off >= tol) return false;
      const [mlo, mhi] = span(o, vertical);
      return Math.max(mlo, lo) - Math.min(mhi, hi) <= gapMax;
    });
    if (!m) { out.push({ ...w, _vertical: vertical }); continue; }
    const [mlo, mhi] = span(m, vertical);
    if (vertical) { m.y1 = Math.min(mlo, lo); m.y2 = Math.max(mhi, hi); m.x1 = m.x2 = Math.round((m.x1 + w.x1) / 2); }
    else { m.x1 = Math.min(mlo, lo); m.x2 = Math.max(mhi, hi); m.y1 = m.y2 = Math.round((m.y1 + w.y1) / 2); }
    m.bearing = m.bearing || w.bearing;
    m.unverified = m.unverified && w.unverified;
  }
  return out.map(({ _vertical, ...w }) => w);
}

// 入户门 = 外围轮廓上的门（唯一则定，多个取最宽）
export function pickEntryDoor(openings, walls, extent, band) {
  if (!extent) return null;
  const doors = openings.filter(o => o.type === "door");
  const perim = doors.filter(o => {
    const w = walls.find(x => x.id === o.wallId);
    if (!w) return false;
    const vertical = Math.abs(w.y2 - w.y1) >= Math.abs(w.x2 - w.x1);
    const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
    return vertical
      ? Math.abs(mx - extent.left) < band || Math.abs(mx - extent.right) < band
      : Math.abs(my - extent.top) < band || Math.abs(my - extent.bottom) < band;
  });
  if (perim.length === 0) return null;
  const verified = perim.filter(o => walls.find(w => w.id === o.wallId && !w.unverified));
  return (verified.length ? verified : perim).sort((a, b) => b.len - a.len)[0].id;
}
