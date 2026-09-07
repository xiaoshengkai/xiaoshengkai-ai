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
