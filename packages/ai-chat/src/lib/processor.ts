/**
 * 处理器工厂 — 根据 provider/model 选策略
 *
 * 策略：
 * - direct: AI SDK 直传 image_url + video_url（M3 自己抽帧）
 * - preprocess: M3 描述 → 文字注入 system（DeepSeek 等纯文本 provider）
 */

import { getModalityStrategy } from './multimodal-config';
import { processImagesDirect, preprocessImagesDescription } from './image-processor';
import { processVideos, stripVideos, preprocessVideoDescription } from './video-processor';

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
      const [imgDesc, vidDesc] = await Promise.all([
        preprocessImagesDescription(messages).then((r) => r.systemInjection),
        preprocessVideoDescription(messages),
      ]);
      return {
        messages: messages.map(stripBothAttachments),
        systemInjection: [imgDesc, vidDesc].filter(Boolean).join('\n\n') || undefined,
      };
    }
    return { messages };
  }

  // 图片直传
  let processedMessages = messages;
  if (imageStrategy === 'direct') {
    try {
      processedMessages = processImagesDirect(processedMessages);
    } catch (err) {
      console.warn(`[processor] 图片直传失败，回退 preprocess:`, (err as Error).message);
      return processAttachments({ provider: 'minimax', model: 'MiniMax-M3', messages });
    }
  } else if (hasImage(processedMessages)) {
    // 视频支持但图片不支持（不太可能但兜底）
    const imgResult = await preprocessImagesDescription(processedMessages);
    processedMessages = imgResult.messages;
  }

  // 视频直传（video_url content type，M3 自己处理 fps）
  if (videoStrategy === 'direct') {
    try {
      processedMessages = processVideos(processedMessages);
    } catch (err) {
      console.error(`[processor] 视频处理失败:`, (err as Error).message);
      throw err;
    }
  } else if (hasVideo(processedMessages)) {
    const desc = await preprocessVideoDescription(processedMessages);
    processedMessages = processedMessages.map(stripVideos);
    if (desc) {
      // 叠加已有的 systemInjection（如果有）
      // 这里简单处理：描述作为单独的 system injection
      // 实际上需要和图片描述合并
    }
  }

  return { messages: processedMessages };
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