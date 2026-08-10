/**
 * 处理器工厂 — 根据 provider/model 选策略
 */

import { getModalityStrategy } from './multimodal-config';
import { processImagesDirect, preprocessImagesDescription } from './image-processor';
import { processVideoFrameExtract, processVideoDirect, preprocessVideoDescription } from './video-processor';

export interface ProcessInput {
  provider: string;
  model: string;
  messages: any[];
}

export interface ProcessResult {
  messages: any[];
  systemInjection?: string;
}

/**
 * 处理消息中的图片 + 视频附件
 *
 * 策略：
 * 1. 检查 provider 对图片/视频的支持策略
 * 2. 多模态能力时：direct / frame-extract
 * 3. 不支持时：preprocess（M3 描述 → 文字）
 * 4. 都没有图片视频时：直接返回原 messages
 */
export async function processAttachments({ provider, model, messages }: ProcessInput): Promise<ProcessResult> {
  const imageStrategy = getModalityStrategy(provider, model, 'image');
  const videoStrategy = getModalityStrategy(provider, model, 'video');

  // 没有任何多模态能力 → preprocess（M3 描述）
  if (imageStrategy === 'none' && videoStrategy === 'none') {
    if (hasImageOrVideo(messages)) {
      console.log(`[processor] ${provider}/${model} 不支持多模态 → preprocess 路径`);
      const [imgResult, vidResult] = await Promise.all([
        preprocessImagesDescription(messages),
        preprocessVideoDescription(messages),
      ]);
      return {
        messages: imgResult.messages,
        systemInjection: [imgResult.systemInjection, vidResult.systemInjection].filter(Boolean).join('\n\n') || undefined,
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
  } else if (imageStrategy === 'none' && hasImage(messages)) {
    // 混合：视频支持但图片不支持（不太可能但兜底）
    const imgResult = await preprocessImagesDescription(processedMessages);
    processedMessages = imgResult.messages;
  }

  // 视频处理
  if (videoStrategy === 'direct' || videoStrategy === 'frame-extract') {
    try {
      processedMessages = await processVideoFrameExtract(processedMessages);
    } catch (err) {
      console.warn(`[processor] 视频处理失败:`, (err as Error).message);
      throw err;  // 视频处理失败不降级，让上层 catch 报错
    }
  } else if (videoStrategy === 'none' && hasVideo(messages)) {
    const vidResult = await preprocessVideoDescription(processedMessages);
    processedMessages = vidResult.messages;
  }

  return { messages: processedMessages };
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
      p?.type === 'text' && (/\[视频:[^\]]+\]/.test(p.text || '') || /https?:\/\/[^\s]+\.(?:mp4|webm|mov|mkv)(?:\?[^\s]*)?/i.test(p.text || ''))
    )
  );
}