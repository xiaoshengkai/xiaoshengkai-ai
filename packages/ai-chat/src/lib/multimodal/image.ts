/**
 * 图片处理器 — AI SDK 5/6 用 {type: 'file', mediaType, data} 格式
 *
 * ponytail: 2026-08-19 — 从 image-processor.ts 改名并拆出通用逻辑到 attachment.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';
import { IMAGE_URL_REGEX, IMAGE_UPLOAD_REGEX, downloadRemoteImage, assertMediaDataSize } from './attachment';
import type { FilePart, Message, MessagePart, TextPart } from "../utils/types"

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');
const IMAGE_DIR = path.resolve(ROOT_DIR, 'data', 'static', 'images');

/** 本地文件路径对应的 file part */
type ImageFilePart = FilePart;

/** 读图片 → AI SDK file 类型 */
function loadImagesAsFile(filenames: string[]): ImageFilePart[] {
  const out: ImageFilePart[] = [];
  for (const filename of filenames) {
    const filePath = path.resolve(IMAGE_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`图片文件不存在：${filename}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_CONFIG.maxImageFileSize) {
      throw new Error(`图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > ${DEFAULT_CONFIG.maxImageFileSize / 1024 / 1024}MB）`);
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
    out.push({ type: 'file', mediaType: mime, data: base64, name: filename });
  }
  return out;
}

export async function processImagesDirect(messages: Message[]): Promise<Message[]> {
  const depth = readHistoryDepth('image');
  const total = messages.length;

  return await Promise.all(messages.map(async (msg, i) => {
    const isCurrent = i === total - 1;
    if (!isCurrent && depth !== 'all') {
      if (typeof depth === 'number' && depth < total - i) {
        return stripImages(msg);
      }
    }

    const newParts: MessagePart[] = [];
    const existingNames = new Set<string>();
    for (const part of msg.parts || []) {
      if (part.type === 'file') {
        const file = part as FilePart;
        if (file.mediaType?.startsWith('image/')) {
          if (file.name) existingNames.add(file.name);
          assertMediaDataSize(file.data, 'image');
        }
      }
    }
    for (const part of msg.parts || []) {
      if (part.type !== 'text') {
        newParts.push(part);
        continue;
      }
      const tp = part as TextPart;
      const text = tp.text || '';
      const uploadRegex = IMAGE_UPLOAD_REGEX;
      const urlRegex = IMAGE_URL_REGEX;

      const uploads = [...text.matchAll(uploadRegex)].map((m) => {
        const url = m[1] ?? '';
        return url.split('/').pop() || '';
      }).filter(Boolean).filter((name) => !existingNames.has(name));

      const urls = [...text.matchAll(urlRegex)].map((m) => m[0]).filter((u): u is string => Boolean(u));

      if (uploads.length === 0 && urls.length === 0) {
        newParts.push(part);
        continue;
      }

      const cleanText = text.replace(uploadRegex, '').replace(urlRegex, '').trim();
      try {
        if (cleanText) {
          newParts.push({ type: 'text', text: cleanText });
        }
        if (uploads.length > 0) {
          newParts.push(...loadImagesAsFile(uploads));
        }
        if (urls.length > 0) {
          const localFiles: string[] = [];
          for (const url of urls) {
            const local = await downloadRemoteImage(url);
            if (local) {
              localFiles.push(local);
            } else {
              newParts.push({ type: 'file', mediaType: 'image/png', data: url });
            }
          }
          if (localFiles.length > 0) {
            newParts.push(...loadImagesAsFile(localFiles));
          }
        }
      } catch (err) {
        const strategy = DEFAULT_CONFIG.missingFileStrategy;
        if (strategy === 'error') throw err;
        if (strategy === 'ignore') {
          console.warn(`[image] 忽略缺失图片: ${(err as Error).message}`);
          if (!cleanText) continue;
          newParts.push({ type: 'text', text: cleanText });
        } else {
          return msg;
        }
      }
    }
    return { ...msg, parts: newParts };
  }));
}

/** 剥离消息中的图片标记，替换为 [图片] 占位符 */
export function stripImages(msg: Message): Message {
  const parts = (msg.parts || []).filter((p) =>
    !(p.type === 'file' && typeof p.mediaType === 'string' && p.mediaType.startsWith('image/'))
  ).map((p: MessagePart): MessagePart => {
    if (p.type !== 'text') return p;
    const textPart = p as TextPart;
    const stripped = (textPart.text || '').replace(/\[图片:[^\]]+\]/g, '[图片]').replace(IMAGE_URL_REGEX, '[图片]');
    return { ...textPart, text: stripped };
  });
  if (parts.length === 0) parts.push({ type: 'text', text: '[图片]' });
  return { ...msg, parts };
}
