/**
 * 图片处理器
 *
 * Direct 模式：[图片:uuid] → 读 data/static/images/xxx.png → base64 → image content
 * Preprocess 模式：调 M3 描述 → 文字注入 system prompt
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateText } from 'ai';
import { minimax } from './providers';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');

export interface ImageProcessResult {
  messages: any[];
  /** Preprocess 模式下注入到 system prompt 的图片描述 */
  systemInjection?: string;
}

/**
 * Direct：读本地文件 → base64 → 返回 image content parts
 */
function loadImagesAsBase64(filenames: string[]): { type: 'image'; image: string }[] {
  const out: { type: 'image'; image: string }[] = [];
  for (const filename of filenames) {
    const filePath = path.resolve(ROOT_DIR, 'data', 'static', 'images', filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`图片文件不存在：${filename}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_CONFIG.maxFileSize) {
      throw new Error(`图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > ${DEFAULT_CONFIG.maxFileSize / 1024 / 1024}MB）`);
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const base64 = `data:image/${mime};base64,${buffer.toString('base64')}`;
    out.push({ type: 'image', image: base64 });
  }
  return out;
}

/**
 * 把 URL 图片转为 image parts
 */
function loadUrlsAsImage(urls: string[]): { type: 'image'; image: string }[] {
  return urls.map((u) => ({ type: 'image', image: u.trim() }));
}

/**
 * 处理 messages 中的 [图片:...] 标记
 * - 历史消息根据 depth 决定保留/剥离
 * - 当前消息全部保留
 */
export function processImagesDirect(messages: any[]): any[] {
  const depth = readHistoryDepth('image');
  const total = messages.length;

  return messages.map((msg, i) => {
    const isCurrent = i === total - 1;
    // 当前消息强制保留；历史按 depth
    if (!isCurrent && depth !== 'all') {
      if (typeof depth === 'number' && depth < total - i) {
        return stripImages(msg);
      }
    }

    const newParts: any[] = [];
    for (const part of msg.parts || []) {
      if (part?.type !== 'text') {
        newParts.push(part);
        continue;
      }
      const text = part.text || '';
      // 收集 [图片:uuid] 和 URL
      const uploadRegex = /\[图片:([^\]]+)\]/g;
      const urlRegex = /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/gi;

      const uploads = [...text.matchAll(uploadRegex)].map((m) => {
        const url = m[1];
        return url.split('/').pop() || '';
      }).filter(Boolean);

      const urls = [...text.matchAll(urlRegex)].map((m) => m[0]);

      if (uploads.length === 0 && urls.length === 0) {
        newParts.push(part);
        continue;
      }

      // 替换文本为不含标记的版本
      const cleanText = text.replace(uploadRegex, '').replace(urlRegex, '').trim();
      const content: any[] = [];
      if (cleanText) content.push({ type: 'text', text: cleanText });
      try {
        if (uploads.length > 0) {
          content.push(...loadImagesAsBase64(uploads));
        }
        if (urls.length > 0) {
          content.push(...loadUrlsAsImage(urls));
        }
      } catch (err) {
        const strategy = DEFAULT_CONFIG.missingFileStrategy;
        if (strategy === 'error') throw err;
        if (strategy === 'ignore') {
          // 忽略图片，继续文本
          console.warn(`[image-processor] 忽略缺失图片: ${(err as Error).message}`);
          if (!cleanText) continue;
        }
        // preprocess fallback
        return msg;  // 让上层回退到 preprocess 路径
      }
      newParts.push({ ...part, type: 'content', content });
    }
    return { ...msg, parts: newParts };
  });
}

/**
 * 剥离消息中的图片标记，替换为 [图片] 占位符
 */
export function stripImages(msg: any): any {
  return {
    ...msg,
    parts: (msg.parts || []).map((p: any) => {
      if (p?.type !== 'text') return p;
      return {
        ...p,
        text: (p.text || '').replace(/\[图片:[^\]]+\]/g, '[图片]').replace(
          /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/gi,
          '[图片]'
        ),
      };
    }),
  };
}

/**
 * Preprocess：用 M3 描述最后一条消息的图片
 */
export async function preprocessImagesDescription(messages: any[]): Promise<ImageProcessResult> {
  const last = messages[messages.length - 1];
  if (!last?.parts) return { messages };

  const attachments = extractAttachments(messages).filter((a) => a.modality === 'image');
  if (attachments.length === 0) return { messages };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const imageContent: any[] = [];
    for (const att of attachments) {
      if (att.localPath) {
        // 上传文件：读 base64
        const filePath = path.resolve(ROOT_DIR, 'data', 'static', 'images', att.filename);
        if (!fs.existsSync(filePath)) continue;
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(att.filename).slice(1).toLowerCase();
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        imageContent.push({ type: 'image', image: `data:image/${mime};base64,${buffer.toString('base64')}` });
      } else {
        // URL
        imageContent.push({ type: 'image', image: att.source });
      }
    }

    if (imageContent.length === 0) return { messages };

    const tStart = Date.now();
    console.log(`[preprocess] 检测到 ${imageContent.length} 张图片，M3 调用中...`);

    const { text: description } = await generateText({
      model: minimax('MiniMax-M3'),
      abortSignal: controller.signal,
      maxOutputTokens: 300,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '请客观描述这张图片的内容即可，不要做多余事情。' }, ...imageContent],
        },
      ],
    });

    clearTimeout(timeout);
    console.log(`[preprocess] M3 完成: ${((Date.now() - tStart) / 1000).toFixed(1)}s, ${description.length} 字`);

    // 剥离标记，保留文本
    const cleanedParts = last.parts.map((p: any) => {
      if (p?.type !== 'text') return p;
      return {
        ...p,
        text: (p.text || '').replace(/\[图片:[^\]]+\]\n?/g, '').replace(
          /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/gi,
          ''
        ).trim(),
      };
    });

    return {
      messages: [...messages.slice(0, -1), { ...last, parts: cleanedParts }],
      systemInjection: description,
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error('[preprocess] 失败:', (err as Error).message);
    return { messages };
  }
}