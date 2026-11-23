import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "packages/ai-chat/public/icons");
mkdirSync(outDir, { recursive: true });

function svg(size) {
  const b = Math.round(size * 0.05); // 内缩黑边框
  const fs = Math.round(size * 0.62);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#FFE135"/>
  <rect x="${b}" y="${b}" width="${size - b * 2}" height="${size - b * 2}" fill="none" stroke="#000" stroke-width="${Math.round(size * 0.06)}"/>
  <text x="${size / 2}" y="${size / 2 + fs * 0.36}" font-size="${fs}" font-family="PingFang SC, Noto Sans SC, sans-serif" font-weight="900" text-anchor="middle" fill="#000">开</text>
</svg>`;
}

for (const size of [180, 192, 512]) {
  const png = await sharp(Buffer.from(svg(size))).png().toBuffer();
  writeFileSync(resolve(outDir, `icon-${size}.png`), png);
  console.log("wrote", `icon-${size}.png`, png.length, "bytes");
}
