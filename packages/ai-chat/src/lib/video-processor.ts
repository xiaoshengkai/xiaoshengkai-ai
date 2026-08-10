/**
 * 视频处理器
 *
 * M3 文档明确：使用 video_url content type 直传视频，M3 自己按 fps 采样。
 * 不再需要 ffmpeg 预抽帧（之前的 frame-extract 方案是错误实现）。
 *
 * 流程：
 * 1. 检测消息中的 [视频:uuid] 标记
 * 2. 读 data/static/videos/xxx → base64
 * 3. 构造 {type: 'image', image: 'data:video/...;base64,...'}
 *    （AI SDK 会转成 image_url，但 minimax 的 fetch 拦截器会重写为 video_url）
 * 4. 历史深度控制
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');

/**
 * 把视频文件读成 base64 data URL（image 类型，AI SDK 不区分 mime）
 * minimax fetch 拦截器会根据 mime 是 video/* 重写为 video_url
 */
export function loadVideosAsDataURL(filenames: string[]): {type: 'image'; image: string}[] {
  const out: {type: 'image'; image: string}[] = [];
  for (const filename of filenames) {
    const filePath = path.resolve(ROOT_DIR, 'data', 'static', 'videos', filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`视频文件不存在不存在不存在：${filename}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_CONFIG.maxFileSize) {
      throw new Error(`视频过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > ${DEFAULT_CONFIG.maxFileSize / 1024 / 1024}MB）`);
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = ext === 'mp4' ? 'video/mp4'
      : ext === 'mov' ? 'video/quicktime'
      : ext === 'avi' ? 'video/x-msvideo'
      : ext === 'mkv' ? 'video/x-matroska'
      : `video/${ext}`;
    const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
    out.push({ type: 'image', image: base64 });
  }
  return out;
}

/**
 * 把视频 URL 转为 image 类型（保留 URL 形式，节省 token）
 */
export function loadVideoUrlsAsImage(urls: string[]): {type: 'image'; image: string}[] {
  return urls.map((u) => ({ type: 'image', image: u.trim() }));
}

/**
 * 处理 messages 中的 [视频:...] 标记
 * - 当前消息强制保留
 * - 历史按 depth 决定保留/剥离
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
      const urlRegex = /\[视频:([^\]]+)\]|https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi;
      const matches = [...text.matchAll(urlRegex)];

      if (matches.length === 0) {
        newParts.push(part);
        continue;
      }

      const uploads = [...text.matchAll(/\[视频:([^\]]+)\]/g)].map((m) => {
        const url = m[1];
        return url.split('/').pop() || '';
      }).filter(Boolean);

      const urls = [...text.matchAll(/https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi)].map((m) => m[0]);

      const cleanText = text.replace(/\[视频:[^\]]+\]/g, '').replace(/https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi, '').trim();

      const content: any[] = [];
      if (cleanText) content.push({ type: 'text', text: cleanText });
      try {
        if (uploads.length > 0) content.push(...loadVideosAsDataURL(uploads));
        if (urls.length > 0) content.push(...loadVideoUrlsAsImage(urls));
      } catch (err) {
        const strategy = DEFAULT_CONFIG.missingFileStrategy;
        if (strategy === 'error') throw err;
        console.warn(`[video-processor] 跳过视频: ${(err as Error).message}`);
        if (!cleanText) continue;
      }
      newParts.push({ ...part, type: 'content', content });
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
 */
export async function preprocessVideoDescription(messages: any[]): Promise<string | undefined> {
  const attachments = extractAttachments(messages).filter((a) => a.modality === 'video');
  if (attachments.length === 0) return undefined;

  // 简化：调用 minimax（M3）描述视频
  // M3 视频描述需要从视频里抽帧作为图片传给 M3
  // 这里我们采用直接 base64 方式传视频，让 M3 自己处理
  const { generateText } = await import('ai');
  const { minimax } = await import('./providers');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const videoContent: any[] = [];
    for (const att of attachments) {
      if (att.localPath) {
        const videoPath = path.resolve(ROOT_DIR, 'data', 'static', 'videos', att.filename);
        if (!fs.existsSync(videoPath)) continue;
        const buffer = fs.readFileSync(videoPath);
        const ext = path.extname(att.filename).slice(1).toLowerCase();
        const mime = ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
        videoContent.push({ type: 'image', image: `data:${mime};base64,${buffer.toString('base64')}` });
      }
    }

    if (videoContent.length === 0) return undefined;

    const { text } = await generateText({
      model: minimax('MiniMax-M3'),
      abortSignal: controller.signal,
      maxOutputTokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请简要描述这个视频的关键内容（基于关键帧）：' },
            ...videoContent,
          ],
        },
      ],
    });
    clearTimeout(timeout);
    return text;
  } catch (err) {
    clearTimeout(timeout);
    console.error('[video-preprocess] 失败:', (err as Error).message);
    return undefined;
  }
}