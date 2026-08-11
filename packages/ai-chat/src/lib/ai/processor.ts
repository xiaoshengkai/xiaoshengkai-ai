/**
 * 处理器工厂 — 根据 provider/model 选策略
 *
 * 策略：
 * - direct: AI SDK 直传（M3 等支持多模态）
 * - preprocess: M3 描述 → 文字注入 system（DeepSeek 等纯文本 provider）
 */

import { getModalityStrategy } from './multimodal-config';
import { processImagesDirect, preprocessImagesDescription } from './image-processor';
import { processVideos, preprocessVideoDescription } from './video-processor';
import {
  ATTACHMENT_REGEX, UPLOAD_MARKER_STRIP, IMAGE_URL_REGEX, VIDEO_URL_REGEX,
  IMAGE_MARKER_STRIP, VIDEO_MARKER_STRIP,
} from './multimodal-markers';
import type { Message, MessagePart, TextPart } from "../utils/types"

export interface ProcessInput {
  provider: string;
  model: string;
  messages: Message[];
}

export interface ProcessResult {
  messages: Message[];
  /** Preprocess 模式下注入到 system prompt 的图片/视频描述 */
  systemInjection?: string;
}

/** 处理消息中的图片 + 视频附件 */
export async function processAttachments({ provider, model, messages }: ProcessInput): Promise<ProcessResult> {
  const imageStrategy = getModalityStrategy(provider, model, 'image');
  const videoStrategy = getModalityStrategy(provider, model, 'video');

  if (imageStrategy === 'none' && videoStrategy === 'none') {
    if (hasImageOrVideo(messages)) {
      console.log(`[processor] ${provider}/${model} 不支持多模态 → preprocess 路径`);
      const [imgResult, vidDesc] = await Promise.all([
        preprocessImagesDescription(messages),
        preprocessVideoDescription(messages),
      ]);
      const imgDesc = imgResult.systemInjection;
      console.log(`[preprocess] img desc len=${imgDesc?.length || 0}, vid desc len=${vidDesc?.length || 0}`);
      return {
        messages: messages.map(stripBothAttachments),
        systemInjection: [imgDesc, vidDesc].filter(Boolean).join('\n\n') || undefined,
      };
    }
    return { messages };
  }

  if (imageStrategy === 'none' || videoStrategy === 'none') {
    if (hasImageOrVideo(messages)) {
      console.log(`[processor] ${provider}/${model} 部分支持多模态 → 回退 preprocess`);
      const [imgResult, vidDesc] = await Promise.all([
        preprocessImagesDescription(messages),
        preprocessVideoDescription(messages),
      ]);
      return {
        messages: messages.map(stripBothAttachments),
        systemInjection: [imgResult.systemInjection, vidDesc].filter(Boolean).join('\n\n') || undefined,
      };
    }
    return { messages };
  }

  try {
    return { messages: processVideos(await processImagesDirect(messages)) };
  } catch (err) {
    console.warn(`[processor] 直传失败，回退 preprocess:`, (err as Error).message);
    return processAttachments({ provider: 'minimax', model: 'MiniMax-M3', messages });
  }
}

/** 同时剥离图片和视频标记（preprocess 后用） */
function stripBothAttachments(msg: Message): Message {
  return {
    ...msg,
    parts: (msg.parts || []).map((p): MessagePart => {
      if (p.type !== 'text') return p;
      const tp = p as TextPart;
      return {
        ...tp,
        text: (tp.text || '')
          .replace(IMAGE_MARKER_STRIP, '[图片]')
          .replace(IMAGE_URL_REGEX, '[图片]')
          .replace(VIDEO_MARKER_STRIP, '[视频]')
          .replace(VIDEO_URL_REGEX, '[视频]'),
      };
    }),
  };
}

function hasImageOrVideo(messages: Message[]): boolean {
  return hasImage(messages) || hasVideo(messages);
}

// ponytail: 用 String.search 而非 RegExp.test — 全局 regex 的 .test() 会保留 lastIndex，
// 第二次调用可能从上次匹配后位置开始，返回 false。search() 不修改 lastIndex。
function hasImage(messages: Message[]): boolean {
  return messages.some((msg) =>
    (msg.parts || []).some((p) => {
      if (p.type !== 'text') return false;
      const tp = p as TextPart;
      const text = tp.text || '';
      return /\[图片:[^\]]+\]/.test(text) || text.search(IMAGE_URL_REGEX) >= 0;
    })
  );
}

function hasVideo(messages: Message[]): boolean {
  return messages.some((msg) =>
    (msg.parts || []).some((p) => {
      if (p.type !== 'text') return false;
      const tp = p as TextPart;
      const text = tp.text || '';
      return /\[视频:[^\]]+\]/.test(text) || text.search(VIDEO_URL_REGEX) >= 0;
    })
  );
}

// re-export for legacy callers
export { ATTACHMENT_REGEX, UPLOAD_MARKER_STRIP };