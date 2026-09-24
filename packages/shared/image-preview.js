/**
 * 图片预览压缩（单一真相源）
 * ============================================================================
 * 大图（漫画页/上传图/角色图）预览时按需生成小体积预览版：
 *   - 长边 1600 + JPEG q85（视觉无损），伴生缓存 `<原文件>.preview.jpg`
 *   - 缓存命中判据：preview 存在且 mtime ≥ 原文件（原图被重生成即失效）
 *   - tmp → rename 原子写，失败抛错由调用方回退原图
 * 导出/下载始终用原文件，不走这里。
 */
import fs from "node:fs";

const PREVIEW_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_EDGE = 1600;
const QUALITY = 85;

export function isPreviewImage(ext) {
  return PREVIEW_EXTS.has(String(ext || "").toLowerCase());
}

export function previewPathFor(filePath) {
  return `${filePath}.preview.jpg`;
}

/** 请求是否要预览版（`?preview=1` 且是图片扩展名） */
export function isPreviewRequest(url, ext) {
  if (!isPreviewImage(ext)) return false;
  try {
    return new URL(url).searchParams.get("preview") === "1";
  } catch {
    return false;
  }
}

/** 返回可用的预览文件路径（缓存命中或新生成）；失败抛错，由调用方回退原图 */
export async function getPreview(filePath, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const previewPath = previewPathFor(filePath);
  const srcStat = fs.statSync(filePath);
  if (fs.existsSync(previewPath) && fs.statSync(previewPath).mtimeMs >= srcStat.mtimeMs) {
    return previewPath;
  }
  const sharp = (await import("sharp")).default;
  const tmp = `${previewPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await sharp(filePath)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, progressive: true })
      .toFile(tmp);
    fs.renameSync(tmp, previewPath);
    return previewPath;
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}
