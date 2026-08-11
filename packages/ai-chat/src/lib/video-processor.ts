/**
 * 视频处理器
 *
 * AI SDK 6 用 {type: 'file', mediaType: 'video/mp4', data: 'data:...'} 格式。
 * minimax fetch 拦截器根据 mediaType 把 file 转成 video_url。
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';
import { VIDEO_URL_REGEX, VIDEO_UPLOAD_REGEX, VIDEO_MARKER_STRIP } from './multimodal-markers';
import { m3ChatComplete } from './m3-raw-fetch';
import type { FilePart, Message, MessagePart, TextPart } from './types';
import { extToMime } from './mime';

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
    out.push({ type: 'file', mediaType: mime, data: `data:${mime};base64,${buffer.toString('base64')}` });
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
        .filter(Boolean);
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
        console.warn(`[video-processor] 跳过视频: ${(err as Error).message}`);
        if (!cleanText) continue;
        newParts.push({ type: 'text', text: cleanText });
      }
    }
    return { ...msg, parts: newParts };
  });
}

/** 剥离消息中的视频标记 */
export function stripVideos(msg: Message): Message {
  return {
    ...msg,
    parts: (msg.parts || []).map((p): MessagePart => {
      if (p.type !== 'text') return p;
      const tp = p as TextPart;
      return {
        ...tp,
        text: (tp.text || '').replace(VIDEO_MARKER_STRIP, '[视频]').replace(VIDEO_URL_REGEX, '[视频]'),
      };
    }),
  };
}

/** OpenAI 格式 part */
type OpenAIVideoPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'default' | 'high' } }
  | { type: 'video_url'; video_url: { url: string; detail?: string; fps?: number } };

interface OpenAIVideoMsg {
  role: string;
  content: OpenAIVideoPart[];
}

/** 视频预处理：M3 描述 → 文字给纯文本 provider */
export async function preprocessVideoDescription(messages: Message[]): Promise<string | undefined> {
  const attachments = extractAttachments(messages).filter((a) => a.modality === 'video');
  if (attachments.length === 0) return undefined;

  const openaiMessages: OpenAIVideoMsg[] = messages.map((m) => {
    const content: OpenAIVideoPart[] = [];
    for (const p of m.parts || []) {
      if (p.type === 'text') {
        const tp = p as TextPart;
        content.push({ type: 'text', text: tp.text });
      } else if (p.type === 'file') {
        const fp = p as FilePart;
        if (fp.mediaType?.startsWith('video/')) {
          content.push({
            type: 'video_url',
            video_url: { url: fp.data, detail: 'default', fps: 1 },
          });
        } else if (fp.mediaType?.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: { url: fp.data, detail: fp.mediaType === 'image/jpeg' ? 'low' : 'default' },
          });
        }
      }
    }
    return { role: m.role, content };
  });

  const hasVideoContent = openaiMessages.some((m) =>
    m.content?.some((p) => p.type === 'video_url')
  );

  if (!hasVideoContent) {
    const lastMsg = openaiMessages[openaiMessages.length - 1];
    if (!lastMsg) return undefined;
    for (const att of attachments) {
      if (att.localPath) {
        try {
          const fileParts = loadVideosAsFile([att.filename]);
          for (const fp of fileParts) {
            lastMsg.content.push({
              type: 'video_url',
              video_url: { url: fp.data, detail: 'default', fps: 1 },
            });
          }
        } catch (err) {
          console.warn(`[video-preprocess] 跳过视频 ${att.filename}:`, (err as Error).message);
        }
      }
    }
  }

  return m3ChatComplete(openaiMessages, {
    modelName: 'MiniMax-M3',
    systemPrompt: '请客观描述视频和图片的核心内容，不要做多余事情。用 1-2 句话总结。',
  });
}