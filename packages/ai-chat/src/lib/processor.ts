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

export interface ProcessInput {
  provider: string;
  model: string;
  messages: any[];
}

export interface ProcessResult {
  messages: any[];
  /** Preprocess 模式下注入到 system prompt 的图片/视频描述 */
  systemInjection?: string;
}

/**
 * 处理消息中的图片 + 视频附件
 */
export async function processAttachments({ provider, model, messages }: ProcessInput): Promise<ProcessResult> {
  const imageStrategy = getModalityStrategy(provider, model, 'image');
  const videoStrategy = getModalityStrategy(provider, model, 'video');

  // 没有任何多模态能力 → preprocess
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

  // 部分支持多模态（罕见）：回退到 preprocess
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

  // 完全支持多模态 → direct
  try {
    return { messages: processVideos(processImagesDirect(messages)) };
  } catch (err) {
    console.warn(`[processor] 直传失败，回退 preprocess:`, (err as Error).message);
    return processAttachments({ provider: 'minimax', model: 'MiniMax-M3', messages });
  }
}

/**
 * 同时剥离图片和视频标记（preprocess 后用）
 */
function stripBothAttachments(msg: any): any {
  return {
    ...msg,
    parts: (msg.parts || []).map((p: any) => {
      if (p?.type !== 'text') return p;
      return {
        ...p,
        text: (p.text || '')
          .replace(/\[图片:[^\]]+\]/g, '[图片]')
          .replace(/https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/gi, '[图片]')
          .replace(/\[视频:[^\]]+\]/g, '[视频]')
          .replace(/https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi, '[视频]'),
      };
    }),
  };
}

function hasImageOrVideo(messages: any[]): boolean {
  return hasImage(messages) || hasVideo(messages);
}

function hasImage(messages: any[]): boolean {
  return messages.some((msg) =>
    (msg.parts || []).some((p: any) =>
      p?.type === 'text' && (/\[图片:[^\]]+\]/.test(p.text || '') || /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/i.test(p.text || ''))
    )
  );
}

function hasVideo(messages: any[]): boolean {
  return messages.some((msg) =>
    (msg.parts || []).some((p: any) =>
      p?.type === 'text' && (/\[视频:[^\]]+\]/.test(p.text || '') || /https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/i.test(p.text || ''))
    )
  );
}