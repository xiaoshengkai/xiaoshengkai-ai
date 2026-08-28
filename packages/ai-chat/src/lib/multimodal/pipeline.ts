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
import { stripVideos } from './video';
import { preprocessAttachmentsDescription } from './preprocess';
import { IMAGE_URL_REGEX } from './attachment';
import type { Message, TextPart } from "../utils/types"

export interface ProcessInput {
  provider: string;
  model: string;
  messages: Message[];
}

export interface ProcessResult {
  messages: Message[];
  /** Preprocess 模式下注入到 system prompt 的图片描述 */
  systemInjection?: string;
}

/** 处理消息中的图片附件（视频已不支持，静默丢弃） */
export async function processAttachments({ provider, model, messages }: ProcessInput): Promise<ProcessResult> {
  // ponytail: 视频已不支持，无条件 strip（静默丢弃成 [视频] 占位）
  const scopedMessages = messages.map((message, index) => {
    let scoped = stripVideos(message);
    if (!isWithinHistoryDepth(index, messages.length, 'image')) scoped = stripImages(scoped);
    return scoped;
  });

  const imageStrategy = getModalityStrategy(provider, model, 'image');
  const containsImage = hasImage(scopedMessages);
  if (!containsImage) return { messages: scopedMessages };

  const preprocessImage = containsImage && imageStrategy === 'none';
  const description = preprocessImage
    ? await preprocessAttachmentsDescription(scopedMessages)
    : undefined;

  const processed = imageStrategy === 'direct'
    ? await processImagesDirect(scopedMessages)
    : scopedMessages.map(stripImages);

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
