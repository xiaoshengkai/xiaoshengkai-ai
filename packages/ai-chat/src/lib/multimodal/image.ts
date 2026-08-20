/**
 * 图片处理器 — AI SDK 5/6 用 {type: 'file', mediaType, data} 格式
 *
 * ponytail: 2026-08-19 — 从 image-processor.ts 改名并拆出通用逻辑到 attachment.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';
import { IMAGE_URL_REGEX, IMAGE_UPLOAD_REGEX, IMAGE_MARKER_STRIP, downloadRemoteImage } from './attachment';
import { preprocessChat } from '@/lib/core/preprocess-fetch';
import type { FilePart, Message, MessagePart, TextPart } from "../utils/types"

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');
const IMAGE_DIR = path.resolve(ROOT_DIR, 'data', 'static', 'images');

/** 本地文件路径对应的 file part */
type ImageFilePart = FilePart;

export interface ImageProcessResult {
  messages: Message[];
  /** Preprocess 模式下注入到 system prompt 的图片描述 */
  systemInjection?: string;
}

/** 读图片 → AI SDK file 类型 */
function loadImagesAsFile(filenames: string[]): ImageFilePart[] {
  const out: ImageFilePart[] = [];
  for (const filename of filenames) {
    const filePath = path.resolve(IMAGE_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`图片文件不存在：${filename}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_CONFIG.maxFileSize) {
      throw new Error(`图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > ${DEFAULT_CONFIG.maxFileSize / 1024 / 1024}MB）`);
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
    out.push({ type: 'file', mediaType: mime, data: base64 });
  }
  return out;
}

/** OpenAI 格式 content part（preprocess 路径用） */
type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'default' | 'high' } }
  | { type: 'video_url'; video_url: { url: string; detail?: string; fps?: number } };

interface OpenAIMsg {
  role: string;
  content: OpenAIPart[];
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
      }).filter(Boolean);

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
  return {
    ...msg,
    parts: (msg.parts || []).map((p: MessagePart): MessagePart => {
      if (p.type !== 'text') return p;
      const textPart = p as TextPart;
      const stripped = (textPart.text || '').replace(/\[图片:[^\]]+\]/g, '[图片]').replace(IMAGE_URL_REGEX, '[图片]');
      return { ...textPart, text: stripped };
    }),
  };
}

/**
 * Preprocess：用 M3 描述图片 → 文字注入 system prompt
 */
export async function preprocessImagesDescription(messages: Message[]): Promise<ImageProcessResult> {
  const last = messages[messages.length - 1];
  if (!last?.parts) return { messages };

  const attachments = extractAttachments(messages).filter((a) => a.modality === 'image');
  if (attachments.length === 0) return { messages };

  const openaiMessages: OpenAIMsg[] = messages.map((m) => {
    const content: OpenAIPart[] = [];
    for (const p of m.parts || []) {
      if (p.type === 'text') {
        const tp = p as TextPart;
        content.push({ type: 'text', text: tp.text });
      } else if (p.type === 'file') {
        const fp = p as FilePart;
        if (fp.mediaType?.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: { url: fp.data, detail: fp.mediaType === 'image/jpeg' ? 'low' : 'default' },
          });
        } else if (fp.mediaType?.startsWith('video/')) {
          content.push({
            type: 'video_url',
            video_url: { url: fp.data, detail: 'default', fps: 1 },
          });
        }
      }
    }
    return { role: m.role, content };
  });

  const hasImageContent = openaiMessages.some((m) =>
    m.content?.some((p) => p.type === 'image_url')
  );

  if (!hasImageContent) {
    const lastMsg = openaiMessages[openaiMessages.length - 1];
    if (lastMsg) {
      for (const att of attachments) {
        if (att.localPath) {
          try {
            const filePath = path.resolve(IMAGE_DIR, att.filename);
            if (!fs.existsSync(filePath)) continue;
            const buffer = fs.readFileSync(filePath);
            const ext = path.extname(att.filename).slice(1).toLowerCase();
            const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
            lastMsg.content.push({
              type: 'image_url',
              image_url: { url: base64, detail: mime === 'image/jpeg' ? 'low' : 'default' },
            });
          } catch (err) {
            console.warn(`[image-preprocess] 跳过图片 ${att.filename}:`, (err as Error).message);
          }
        }
      }
    }
  }

  const hasAnyImage = openaiMessages.some((m) =>
    m.content?.some((p) => p.type === 'image_url')
  );
  if (!hasAnyImage) return { messages };

  const tStart = Date.now();
  console.log(`[preprocess] 检测到图片，preprocess 调用中...`);

  const description = await preprocessChat(
    [{
      role: 'user',
      content: [
        { type: 'text', text: '请客观描述这张图片的内容即可，不要做多余事情。' },
        ...(openaiMessages[openaiMessages.length - 1]?.content || []),
      ],
    }],
    { modelName: '', systemPrompt: '' },
  );

  console.log(`[preprocess] 完成: ${((Date.now() - tStart) / 1000).toFixed(1)}s, ${description?.length || 0} 字`);

  const cleanedParts: MessagePart[] = last.parts.map((p): MessagePart => {
    if (p.type !== 'text') return p;
    const tp = p as TextPart;
    return {
      ...tp,
      text: (tp.text || '').replace(IMAGE_MARKER_STRIP, '').replace(IMAGE_URL_REGEX, '').trim(),
    };
  });

  return {
    messages: [...messages.slice(0, -1), { ...last, parts: cleanedParts }],
    systemInjection: description || undefined,
  };
}