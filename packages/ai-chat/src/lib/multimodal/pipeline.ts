/**
 * 处理器调度器 — 根据 provider/model 选策略
 *
 * ponytail: 2026-08-19 — 从 processor.ts 改名，体现"调度"本质
 *
 * 策略：
 * - direct: AI SDK 直传（M3 等支持多模态）
 * - preprocess: vision 模型逐图描述 → 内联替换消息占位符（DeepSeek 等纯文本 provider）
 */

import { getModalityStrategy, isWithinHistoryDepth } from './multimodal-config';
import { processImagesDirect, stripImages } from './image';
import { stripVideos } from './video';
import { preprocessAttachmentsDescriptions } from './preprocess';
import { ATTACHMENT_REGEX, IMAGE_MISSING_NOTE, IMAGE_URL_REGEX } from './attachment';
import { parseAttachment } from './modality-detector';
import type { FilePart, Message, MessagePart, TextPart } from "../utils/types"

export interface ProcessInput {
  provider: string;
  model: string;
  messages: Message[];
}

export interface ProcessResult {
  messages: Message[];
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
  if (!hasImage(scopedMessages)) return { messages: scopedMessages };

  if (imageStrategy === 'direct') {
    return { messages: await processImagesDirect(scopedMessages) };
  }

  const descs = await preprocessAttachmentsDescriptions(scopedMessages);
  return {
    messages: scopedMessages.map((message, index) =>
      isWithinHistoryDepth(index, scopedMessages.length, 'image')
        ? inlineDescriptions(message, descs)
        : message),
  };
}

/** 把视觉描述原位替换回占位符（marker/URL 文本 + file part） */
function inlineDescriptions(msg: Message, descs: Map<string, string>): Message {
  const parts: MessagePart[] = [];
  for (const part of msg.parts || []) {
    if (part.type === 'file') {
      const file = part as FilePart;
      if (!file.mediaType?.startsWith('image/')) {
        parts.push(part);
        continue;
      }
      parts.push({ type: 'text', text: descs.get(file.data) ?? IMAGE_MISSING_NOTE });
      continue;
    }
    if (part.type !== 'text') {
      parts.push(part);
      continue;
    }
    const text = (part as TextPart).text || '';
    const replaced = text.replace(ATTACHMENT_REGEX, (source) => {
      const attachment = parseAttachment(source);
      if (!attachment || attachment.modality !== 'image') return source;
      return descs.get(source) ?? source;
    });
    parts.push({ ...(part as TextPart), text: replaced });
  }
  return { ...msg, parts };
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
