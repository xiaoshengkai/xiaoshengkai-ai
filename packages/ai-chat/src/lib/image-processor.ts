/**
 * 图片处理器
 *
 * AI SDK 5 使用 {type: 'file', mediaType, data} 格式传递多媒体。
 * minimax fetch 拦截器会根据 mediaType 把 file 改写成 image_url 或 video_url。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';

const ROOT_DIR = path.resolve(process.cwd(), '..', '..');
const IMAGE_DIR = path.resolve(ROOT_DIR, 'data', 'static', 'images');

/**
 * 下载远程图片到本地（带缓存）
 * 返回本地文件名，失败返回 null
 */
async function downloadRemoteImage(url: string): Promise<string | null> {
  // 已经是本地路径，跳过
  if (url.startsWith('/api/uploads/')) return null;
  // 检查是否已缓存
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

export interface ImageProcessResult {
  messages: any[];
  /** Preprocess 模式下注入到 system prompt 的图片描述 */
  systemInjection?: string;
}

/**
 * 读图片 → AI SDK file 类型
 */
function loadImagesAsFile(filenames: string[]): { type: 'file'; mediaType: string; data: string }[] {
  const out: { type: 'file'; mediaType: string; data: string }[] = [];
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
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
    out.push({ type: 'file', mediaType: mime, data: base64 });
  }
  return out;
}

/**
 * URL 图片 → AI SDK file 类型
 */
/**
 * 处理 messages 中的 [图片:...] 标记
 */
export async function processImagesDirect(messages: any[]): Promise<any[]> {
  const depth = readHistoryDepth('image');
  const total = messages.length;

  return await Promise.all(messages.map(async (msg, i) => {
    const isCurrent = i === total - 1;
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

      const cleanText = text.replace(uploadRegex, '').replace(urlRegex, '').trim();
      try {
        if (cleanText) {
          newParts.push({ type: 'text', text: cleanText });
        }
        if (uploads.length > 0) {
          newParts.push(...loadImagesAsFile(uploads));
        }
        if (urls.length > 0) {
          // 下载远程 URL 到本地（OSS 签名 24h 过期，缓存后下次追问可用）
          const localFiles: string[] = [];
          for (const url of urls) {
            const local = await downloadRemoteImage(url);
            if (local) {
              localFiles.push(local);
            } else {
              // 下载失败，保留原始 URL
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
          console.warn(`[image-processor] 忽略缺失图片: ${(err as Error).message}`);
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
 * Preprocess：用 M3 描述图片 → 文字注入 system prompt
 *
 * 支持 UIMessage 格式（text 含 [图片:xxx]）和 ModelMessage 格式（file part）
 */
export async function preprocessImagesDescription(messages: any[]): Promise<ImageProcessResult> {
  const last = messages[messages.length - 1];
  if (!last?.parts) return { messages };

  const attachments = extractAttachments(messages).filter((a) => a.modality === 'image');
  if (attachments.length === 0) return { messages };

  // 构造 OpenAI 格式 content
  const openaiMessages = messages.map((m: any) => {
    const content: any[] = [];
    for (const p of m.parts || []) {
      if (p?.type === 'text') {
        content.push({ type: 'text', text: p.text });
      } else if (p?.type === 'file' && p.mediaType?.startsWith('image/')) {
        content.push({
          type: 'image_url',
          image_url: { url: p.data, detail: p.mediaType === 'image/jpeg' ? 'low' : 'default' },
        });
      } else if (p?.type === 'file' && p.mediaType?.startsWith('video/')) {
        content.push({
          type: 'video_url',
          video_url: { url: p.data, detail: 'default', fps: 1 },
        });
      }
    }
    return { role: m.role, content };
  });

  // 如果没有图片内容（UIMessage 模式），从 text 标记读图片文件
  const hasImageContent = openaiMessages.some((m: any) =>
    m.content?.some((p: any) => p.type === 'image_url')
  );

  if (!hasImageContent) {
    const lastMsg = openaiMessages[openaiMessages.length - 1];
    if (lastMsg) {
      for (const att of attachments) {
        if (att.localPath) {
          try {
            const filePath = path.resolve(ROOT_DIR, 'data', 'static', 'images', att.filename);
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

  const hasAnyImage = openaiMessages.some((m: any) =>
    m.content?.some((p: any) => p.type === 'image_url')
  );
  if (!hasAnyImage) return { messages };

  const tStart = Date.now();
  console.log(`[preprocess] 检测到图片，M3 调用中...`);

  const { m3ChatComplete } = await import('./m3-raw-fetch');
  const description = await m3ChatComplete(
    [{ role: 'user', content: [{ type: 'text', text: '请客观描述这张图片的内容即可，不要做多余事情。' }, ...(openaiMessages[openaiMessages.length - 1]?.content || [])] }],
    { modelName: 'MiniMax-M3', systemPrompt: '' },
  );

  console.log(`[preprocess] M3 完成: ${((Date.now() - tStart) / 1000).toFixed(1)}s, ${description?.length || 0} 字`);

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
    systemInjection: description || undefined,
  };
}