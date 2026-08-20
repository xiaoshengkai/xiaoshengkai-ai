/**
 * 处理器调度器 — 根据 provider/model 选策略
 *
 * ponytail: 2026-08-19 — 从 processor.ts 改名，体现"调度"本质
 *
 * 策略：
 * - direct: AI SDK 直传（M3 等支持多模态）
 * - preprocess: preprocess model 描述 → 文字注入 system（DeepSeek 等纯文本 provider）
 */

import { getModalityStrategy, isWithinHistoryDepth } from './multimodal-config';
import { processImagesDirect, stripImages } from './image';
import { processVideos, stripVideos } from './video';
import { preprocessAttachmentsDescription } from './preprocess';
import { IMAGE_URL_REGEX, VIDEO_URL_REGEX } from './attachment';
import type { Message, TextPart } from "../utils/types"

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
  const scopedMessages = messages.map((message, index) => {
    let scoped = message;
    if (!isWithinHistoryDepth(index, messages.length, 'image')) scoped = stripImages(scoped);
    if (!isWithinHistoryDepth(index, messages.length, 'video')) scoped = stripVideos(scoped);
    return scoped;
  });
  const imageStrategy = getModalityStrategy(provider, model, 'image');
  const videoStrategy = getModalityStrategy(provider, model, 'video');
  const containsImage = hasImage(scopedMessages);
  const containsVideo = hasVideo(scopedMessages);
  if (!containsImage && !containsVideo) return { messages: scopedMessages };

  const preprocessImage = containsImage && imageStrategy === 'none';
  const preprocessVideo = containsVideo && videoStrategy === 'none';
  const preprocessModalities = new Set<'image' | 'video'>();
  if (preprocessImage) preprocessModalities.add('image');
  if (preprocessVideo) preprocessModalities.add('video');
  const description = preprocessModalities.size > 0
    ? await preprocessAttachmentsDescription(scopedMessages, preprocessModalities)
    : undefined;

  let processed = scopedMessages;
  if (containsImage) {
    processed = imageStrategy === 'direct'
      ? await processImagesDirect(processed)
      : processed.map(stripImages);
  }
  if (containsVideo) {
    processed = videoStrategy === 'direct'
      ? processVideos(processed)
      : processed.map(stripVideos);
  }

  return {
    messages: processed,
    systemInjection: description,
  };
}

// ponytail: 用 String.search 而非 RegExp.test — 全局 regex 的 .test() 会保留 lastIndex，
// 第二次调用可能从上次匹配后位置开始，返回 false。search() 不修改 lastIndex。
function hasImage(messages: Message[]): boolean {
  return messages.some((msg) =>
    (msg.parts || []).some((p) => {
      if (p.type === 'file') return typeof p.mediaType === 'string' && p.mediaType.startsWith('image/');
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
      if (p.type === 'file') return typeof p.mediaType === 'string' && p.mediaType.startsWith('video/');
      if (p.type !== 'text') return false;
      const tp = p as TextPart;
      const text = tp.text || '';
      return /\[视频:[^\]]+\]/.test(text) || text.search(VIDEO_URL_REGEX) >= 0;
    })
  );
}
