/**
 * 多模态 marker / URL 正则常量 + 远程下载 / base64 编码工具
 *
 * ponytail: 2026-08-19 — 合并 multimodal-markers.ts + image-processor 下载逻辑
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_CONFIG } from './multimodal-config';

export const IMAGE_UPLOAD_REGEX = /\[图片:([^\]]+)\]/g;
export const VIDEO_UPLOAD_REGEX = /\[视频:([^\]]+)\]/g;
export const IMAGE_MARKER_STRIP = /\[图片:[^\]]+\]/g;
export const VIDEO_MARKER_STRIP = /\[视频:[^\]]+\]/g;
export const IMAGE_MARKER_TRIM = /\[图片:[^\]]+\]\n?/g;

export const IMAGE_URL_REGEX = /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/gi;
export const VIDEO_URL_REGEX = /https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi;
export const ATTACHMENT_REGEX = /\[(图片|视频):[^\]]+\]|https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi;

/** 校验内联 base64 媒体数据不超过大小上限（URL 引用跳过） */
export function assertMediaDataSize(data: string, modality: 'image' | 'video'): void {
  if (!data.startsWith('data:')) return;
  const b64 = data.slice(data.indexOf(',') + 1);
  const pad = (b64.match(/=+$/) || [''])[0].length;
  const size = Math.floor((b64.length * 3) / 4) - pad;
  const max = modality === 'image' ? DEFAULT_CONFIG.maxImageFileSize : DEFAULT_CONFIG.maxFileSize;
  if (size > max) {
    throw new Error(`${modality === 'image' ? '图片' : '视频'}过大（${(size / 1024 / 1024).toFixed(1)}MB > ${max / 1024 / 1024}MB）`);
  }
}

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');
const IMAGE_DIR = path.resolve(ROOT_DIR, 'data', 'static', 'images');

/**
 * 下载远程图片到本地（带缓存）
 * 返回本地文件名，失败返回 null
 */
export async function downloadRemoteImage(url: string): Promise<string | null> {
  if (url.startsWith('/api/uploads/')) return null;
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
  const existing = fs.readdirSync(IMAGE_DIR).find(f => f.includes(hash));
  if (existing) return existing;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return null;

    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || 'png';
    const filename = `${hash}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGE_DIR, filename), buffer);
    console.log(`[image-cache] downloaded ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return filename;
  } catch {
    return null;
  }
}