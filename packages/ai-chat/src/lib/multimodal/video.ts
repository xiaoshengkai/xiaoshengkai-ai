/**
 * 视频处理器 — AI SDK 6 用 {type: 'file', mediaType: 'video/mp4', data: 'data:...'} 格式
 *
 * ponytail: 2026-08-19 — 从 video-processor.ts 改名并拆出通用逻辑到 attachment.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';
import { VIDEO_URL_REGEX, VIDEO_UPLOAD_REGEX, VIDEO_MARKER_STRIP, assertMediaDataSize } from './attachment';
import { extToMime } from "./mime"
import type { FilePart, Message, MessagePart, TextPart } from "../utils/types"

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');

/** 读视频 → AI SDK file 类型（video MIME） */
function loadVideosAsFile(filenames: string[]): FilePart[] {
  const out: FilePart[] = [];
  for (const filename of filenames) {
    const filePath = path.resolve(ROOT_DIR, 'data', 'static', 'videos', filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`视频文件不存在：${filename}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_CONFIG.maxFileSize) {
      throw new Error(
        `视频过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > ${DEFAULT_CONFIG.maxFileSize / 1024 / 1024}MB）`
      );
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = extToMime(ext);
    out.push({ type: 'file', mediaType: mime, data: `data:${mime};base64,${buffer.toString('base64')}`, name: filename });
  }
  return out;
}

function loadVideoUrlsAsFile(urls: string[]): FilePart[] {
  return urls.map((u) => {
    const url = u.trim();
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
    const ext = extMatch?.[1]?.toLowerCase() ?? 'mp4';
    const mime = extToMime(ext);
    return { type: 'file', mediaType: mime, data: url };
  });
}

/** 处理 messages 中的 [视频:...] 标记 */
export function processVideos(messages: Message[]): Message[] {
  const depth = readHistoryDepth('video');
  const total = messages.length;

  return messages.map((msg, i) => {
    const isCurrent = i === total - 1;
    if (!isCurrent && depth !== 'all') {
      if (typeof depth === 'number' && depth < total - i) {
        return stripVideos(msg);
      }
    }

    const newParts: MessagePart[] = [];
    const existingNames = new Set<string>();
    for (const part of msg.parts || []) {
      if (part.type === 'file') {
        const file = part as FilePart;
        if (file.mediaType?.startsWith('video/')) {
          if (file.name) existingNames.add(file.name);
          assertMediaDataSize(file.data, 'video');
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
      const uploadRegex = VIDEO_UPLOAD_REGEX;
      const urlRegex = VIDEO_URL_REGEX;

      const uploads = [...text.matchAll(uploadRegex)]
        .map((m) => (m[1] ?? '').split('/').pop() || '')
        .filter(Boolean).filter((name) => !existingNames.has(name));
      const urls = [...text.matchAll(urlRegex)].map((m) => m[0]).filter((u): u is string => Boolean(u));

      if (uploads.length === 0 && urls.length === 0) {
        newParts.push(part);
        continue;
      }

      const cleanText = text.replace(uploadRegex, '').replace(urlRegex, '').trim();
      try {
        if (cleanText) newParts.push({ type: 'text', text: cleanText });
        if (uploads.length > 0) newParts.push(...loadVideosAsFile(uploads));
        if (urls.length > 0) newParts.push(...loadVideoUrlsAsFile(urls));
      } catch (err) {
        const strategy = DEFAULT_CONFIG.missingFileStrategy;
        if (strategy === 'error') throw err;
        console.warn(`[video] 跳过视频: ${(err as Error).message}`);
        if (!cleanText) continue;
        newParts.push({ type: 'text', text: cleanText });
      }
    }
    return { ...msg, parts: newParts };
  });
}

/** 剥离消息中的视频标记 */
export function stripVideos(msg: Message): Message {
  const parts = (msg.parts || []).filter((p) =>
    !(p.type === 'file' && typeof p.mediaType === 'string' && p.mediaType.startsWith('video/'))
  ).map((p): MessagePart => {
    if (p.type !== 'text') return p;
    const tp = p as TextPart;
    return {
      ...tp,
      text: (tp.text || '').replace(VIDEO_MARKER_STRIP, '[视频]').replace(VIDEO_URL_REGEX, '[视频]'),
    };
  });
  if (parts.length === 0) parts.push({ type: 'text', text: '[视频]' });
  return { ...msg, parts };
}
