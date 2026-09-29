import sharp from "sharp";

/**
 * CV 墙段提取器 — 从像素确定性提取轴对齐墙段（治 vision 像素坐标不准根因）
 *
 * 原理：中介/开发商户型图的墙=纯黑厚线条。行/列扫描取黑游程 → 跨行合并成带（厚度=墙厚）
 * → 共线带按门洞上限合并（门洞断口保留在同一墙内，下游 detectOpenings 分类）→ T/L 交点端点吸附。
 * 家具描边为薄线（1-3px）、文字为短游程，均被厚度/长度滤波排除。
 *
 * 返回 null 表示图不符合"黑墙图"假设（墨量越界/墙段过少）→ 调用方回退 vision 墙。
 */

const THR = 80;

function runsOfLine(get, len, minLen) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= len; i++) {
    const d = i < len && get(i);
    if (d && start < 0) start = i;
    else if (!d && start >= 0) {
      if (i - start >= minLen) runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/** 跨行/列把游程合并成带：与活跃带重叠 ≥60% 则延伸，否则新开 */
function buildBands(lines, minLen, maxGapRows) {
  const bands = [];
  let active = [];
  for (let pos = 0; pos < lines.length; pos++) {
    const runs = lines[pos];
    if (!runs) { continue; }
    const next = [];
    for (const [a, b] of runs) {
      const hit = active.find(bd => {
        if (pos - bd.last > maxGapRows) return false;
        const ov = Math.min(bd.x1, b) - Math.max(bd.x0, a) + 1;
        // 双向重叠比：防 T 型交点处长游程被吸收进垂直带（反之亦然）
        return ov / (b - a + 1) >= 0.6 && ov / (bd.x1 - bd.x0 + 1) >= 0.6;
      });
      if (hit) {
        hit.x0 = Math.min(hit.x0, a); hit.x1 = Math.max(hit.x1, b);
        hit.last = pos; hit.rows++;
        hit.sum0 += a; hit.sum1 += b;
        next.push(hit);
      } else if (b - a + 1 >= minLen) {
        const bd = { x0: a, x1: b, first: pos, last: pos, rows: 1, sum0: a, sum1: b };
        bands.push(bd); next.push(bd);
      }
    }
    active = next;
  }
  return bands;
}

function bandToSeg(bd, horizontal) {
  const thickness = bd.last - bd.first + 1;
  const a = bd.sum0 / bd.rows, b = bd.sum1 / bd.rows;
  const c = (bd.first + bd.last) / 2;
  return horizontal
    ? { x1: Math.round(a), y1: Math.round(c), x2: Math.round(b), y2: Math.round(c), thickness }
    : { x1: Math.round(c), y1: Math.round(a), x2: Math.round(c), y2: Math.round(b), thickness };
}

function mergeCollinear(segs, maxTh, doorMax) {
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j];
        const aH = Math.abs(a.y2 - a.y1) < Math.abs(a.x2 - a.x1);
        const bH = Math.abs(b.y2 - b.y1) < Math.abs(b.x2 - b.x1);
        if (aH !== bH) continue;
        if (aH) {
          if (Math.abs(a.y1 - b.y1) > maxTh) continue;
          const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
          if (gap > doorMax) continue;
          segs[i] = { x1: Math.min(a.x1, b.x1), y1: Math.round((a.y1 * a.thickness + b.y1 * b.thickness) / (a.thickness + b.thickness)), x2: Math.max(a.x2, b.x2), y2: Math.round((a.y1 * a.thickness + b.y1 * b.thickness) / (a.thickness + b.thickness)), thickness: Math.max(a.thickness, b.thickness) };
        } else {
          if (Math.abs(a.x1 - b.x1) > maxTh) continue;
          const gap = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2);
          if (gap > doorMax) continue;
          segs[i] = { x1: Math.round((a.x1 * a.thickness + b.x1 * b.thickness) / (a.thickness + b.thickness)), y1: Math.min(a.y1, b.y1), x2: Math.round((a.x1 * a.thickness + b.x1 * b.thickness) / (a.thickness + b.thickness)), y2: Math.max(a.y2, b.y2), thickness: Math.max(a.thickness, b.thickness) };
        }
        segs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return segs;
}

/** 端点吸附到邻近墙的线上（闭合 T/L 交点） */
function snapJunctions(segs, tol) {
  for (const s of segs) {
    for (const key of [["x1", "y1"], ["x2", "y2"]]) {
      const px = s[key[0]], py = s[key[1]];
      let best = null;
      for (const o of segs) {
        if (o === s) continue;
        const oH = Math.abs(o.y2 - o.y1) < Math.abs(o.x2 - o.x1);
        if (oH) {
          if (py < o.y1 - tol || py > o.y1 + tol) continue;
          if (px < o.x1 - tol || px > o.x2 + tol) continue;
          const d = Math.abs(py - o.y1);
          if (!best || d < best.d) best = { d, x: px, y: o.y1 };
        } else {
          if (px < o.x1 - tol || px > o.x1 + tol) continue;
          if (py < o.y1 - tol || py > o.y2 + tol) continue;
          const d = Math.abs(px - o.x1);
          if (!best || d < best.d) best = { d, x: o.x1, y: py };
        }
      }
      if (best) { s[key[0]] = best.x; s[key[1]] = best.y; }
    }
  }
  return segs;
}

function dropContained(segs, maxTh) {
  return segs.filter(s => !segs.some(o => o !== s &&
    Math.abs((oH(o) ? o.y1 - s.y1 : o.x1 - s.x1)) <= maxTh &&
    oH(o) === oH(s) &&
    (oH(s)
      ? o.x1 - maxTh <= s.x1 && o.x2 + maxTh >= s.x2 && o.x2 - o.x1 > s.x2 - s.x1
      : o.y1 - maxTh <= s.y1 && o.y2 + maxTh >= s.y2 && o.y2 - o.y1 > s.y2 - s.y1)));
}
const oH = s => Math.abs(s.y2 - s.y1) < Math.abs(s.x2 - s.x1);

export async function extractWalls(imagePath) {
  const { data, info } = await sharp(imagePath).grayscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let darkCount = 0;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (data[i] < THR) { dark[i] = 1; darkCount++; }
  const darkRatio = darkCount / (W * H);
  if (darkRatio < 0.004 || darkRatio > 0.06) return null;

  const minLen = Math.max(24, Math.round(W * 0.03));
  const minRun = Math.max(10, Math.round(W * 0.01));
  const minTh = 3;
  const maxTh = Math.max(8, Math.round(W * 0.02));
  const doorMax = Math.round(W * 0.10);

  const rowLines = [];
  for (let y = 0; y < H; y++) rowLines.push(runsOfLine(x => dark[y * W + x] === 1, W, minRun));
  const colLines = [];
  for (let x = 0; x < W; x++) colLines.push(runsOfLine(y => dark[y * W + x] === 1, H, minRun));

  let segs = [
    ...buildBands(rowLines, minRun, 1).map(bd => bandToSeg(bd, true)),
    ...buildBands(colLines, minRun, 1).map(bd => bandToSeg(bd, false)),
  ].filter(s => s.thickness >= minTh && s.thickness <= maxTh);
  segs = mergeCollinear(segs, maxTh, doorMax);
  segs = dropContained(segs, maxTh);
  // 薄线滤波：门扇弧线/窗线等厚度远低于墙厚中位数的假墙段剔除
  const ths = segs.map(s => s.thickness).sort((a, b) => a - b);
  const med = ths.length ? ths[Math.floor(ths.length / 2)] : 0;
  if (med > 0) segs = segs.filter(s => s.thickness >= med * 0.4);
  segs = snapJunctions(segs, maxTh);
  segs = segs.filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minLen);
  if (segs.length < 6) return null;

  return {
    darkRatio: Number(darkRatio.toFixed(4)),
    walls: segs.map((s, i) => ({
      id: `w${i + 1}`,
      x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      thickness: s.thickness,
      bearing: false,
      confidence: 1,
    })),
  };
}
