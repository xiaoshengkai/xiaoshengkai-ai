/**
 * 视频处理器
 *
 * AI SDK 6 用 {type: 'file', mediaType: 'video/mp4', data: 'data:...'} 格式。
 * minimax fetch 拦截器根据 mediaType 把 file 转成 video_url。
 *
 * 历史深度控制：
 * - 视频默认 depth=1（base64 巨大）
 * - 通过 env MULTIMODAL_VIDEO_DEPTH=* 表示 all，=N 表示最近 N 条
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';
import { m3ChatComplete } from './m3-raw-fetch';

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');

/**
 * 读视频 → AI SDK file 类型（video MIME）
 */
function loadVideosAsFile(filenames: string[]): { type: 'file'; mediaType: string; data: string }[] {
  const out: { type: 'file'; mediaType: string; data: string }[] = [];
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
    const mime =
      ext === 'mp4' ? 'video/mp4' :
      ext === 'mov' ? 'video/quicktime' :
      ext === 'avi' ? 'video/x-msvideo' :
      ext === 'mkv' ? 'video/x-matroska' :
      `video/${ext}`;
    out.push({ type: 'file', mediaType: mime, data: `data:${mime};base64,${buffer.toString('base64')}` });
  }
  return out;
}

function loadVideoUrlsAsFile(urls: string[]): { type: 'file'; mediaType: string; data: string }[] {
  return urls.map((u) => {
    const url = u.trim();
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
    const ext = extMatch?.[1]?.toLowerCase() || 'mp4';
    const mime = ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
    return { type: 'file', mediaType: mime, data: url };
  });
}

/**
 * 处理 messages 中的 [视频:...] 标记
 * 历史消息按 depth 决定保留/剥离
 */
export function processVideos(messages: any[]): any[] {
  const depth = readHistoryDepth('video');
  const total = messages.length;

  return messages.map((msg, i) => {
    const isCurrent = i === total - 1;
    if (!isCurrent && depth !== 'all') {
      if (typeof depth === 'number' && depth < total - i) {
        return stripVideos(msg);
      }
    }

    const newParts: any[] = [];
    for (const part of msg.parts || []) {
      if (part?.type !== 'text') {
        newParts.push(part);
        continue;
      }
      const text = part.text || '';
      const uploadRegex = /\[视频:([^\]]+)\]/g;
      const urlRegex = /https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi;

      const uploads = [...text.matchAll(uploadRegex)]
        .map((m) => m[1].split('/').pop() || '')
        .filter(Boolean);
      const urls = [...text.matchAll(urlRegex)].map((m) => m[0]);

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

/**
 * 剥离消息中的视频标记
 */
export function stripVideos(msg: any): any {
  return {
    ...msg,
    parts: (msg.parts || []).map((p: any) => {
      if (p?.type !== 'text') return p;
      return {
        ...p,
        text: (p.text || '').replace(/\[视频:[^\]]+\]/g, '[视频]').replace(
          /https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi,
          '[视频]'
        ),
      };
    }),
  };
}

/**
 * 视频预处理：M3 描述 → 文字给纯文本 provider
 *
 * 注意：消息可能是 UIMessage 格式（text 含 [视频:xxx]）或 ModelMessage 格式（file part）
 * 两种都支持
 */
export async function preprocessVideoDescription(messages: any[]): Promise<string | undefined> {
  const attachments = extractAttachments(messages).filter((a) => a.modality === 'video');
  if (attachments.length === 0) return undefined;

  // 构造 OpenAI 格式 messages
  const openaiMessages = messages.map((m: any) => {
    const content: any[] = [];
    for (const p of m.parts || []) {
      if (p?.type === 'text') {
        content.push({ type: 'text', text: p.text });
      } else if (p?.type === 'file' && p.mediaType?.startsWith('video/')) {
        content.push({
          type: 'video_url',
          video_url: { url: p.data, detail: 'default', fps: 1 },
        });
      } else if (p?.type === 'file' && p.mediaType?.startsWith('image/')) {
        content.push({
          type: 'image_url',
          image_url: { url: p.data, detail: p.mediaType === 'image/jpeg' ? 'low' : 'default' },
        });
      }
    }
    return { role: m.role, content };
  });

  // 如果没有视频文件内容（UIMessage 模式，只有 [视频:xxx] 标记），需要先读文件
  const hasVideoContent = openaiMessages.some((m: any) =>
    m.content?.some((p: any) => p.type === 'video_url')
  );

  if (!hasVideoContent) {
    // 从 text 标记读视频文件并加到 last message
    const lastMsg = openaiMessages[openaiMessages.length - 1];
    if (!lastMsg) return undefined;
    for (const att of attachments) {
      if (att.localPath) {
        try {
          const fileParts = loadVideosAsFile([att.filename]);
          lastMsg.content.push(...fileParts.map((fp) => ({
            type: 'video_url',
            video_url: { url: fp.data, detail: 'default', fps: 1 },
          })));
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