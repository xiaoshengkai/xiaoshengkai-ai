/**
 * 模态识别器 — 从消息中提取图片/视频附件
 *
 * ponytail: 2026-08-19 — 移动到 multimodal/ 子目录，加前缀统一
 */

import { ATTACHMENT_REGEX } from './attachment';
import type { Message } from "../utils/types"

export type Modality = 'image' | 'video' | 'unknown';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv'];

export interface Attachment {
  modality: Modality;
  /** 上传标记或 URL */
  source: string;
  /** 文件名（从 source 解析） */
  filename: string;
  /** 上传文件的本地路径（仅 source 为 [图片:] / [视频:] 时有） */
  localPath?: string;
}

/**
 * 从字符串解析附件信息
 */
export function parseAttachment(source: string): Attachment | null {
  source = source.trim();
  if (!source) return null;

  const uploadMatch = source.match(/^\[(图片|视频):([^\]]+)\]$/);
  if (uploadMatch) {
    const tag = uploadMatch[1];
    const url = uploadMatch[2];
    const filename = url.split('/').pop() || '';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let modality: Modality = 'unknown';
    if (tag === '图片') modality = 'image';
    else if (tag === '视频') modality = 'video';
    else if (IMAGE_EXTS.includes(ext)) modality = 'image';
    else if (VIDEO_EXTS.includes(ext)) modality = 'video';
    if (modality === 'unknown') return null;
    return { modality, source, filename, localPath: filename };
  }

  if (/^https?:\/\//.test(source)) {
    const filename = source.split('?')[0].split('/').pop() || '';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let modality: Modality = 'unknown';
    if (IMAGE_EXTS.includes(ext)) modality = 'image';
    else if (VIDEO_EXTS.includes(ext)) modality = 'video';
    if (modality === 'unknown') return null;
    return { modality, source, filename };
  }

  return null;
}

/**
 * 从 messages 中提取所有附件
 */
export function extractAttachments(messages: Message[]): Attachment[] {
  const out: Attachment[] = [];
  for (const msg of messages) {
    for (const part of msg.parts || []) {
      if (part?.type !== 'text') continue;
      const text = (part as { text?: string }).text || '';
      const matches = text.match(ATTACHMENT_REGEX) || [];
      for (const m of matches) {
        const att = parseAttachment(m);
        if (att) out.push(att);
      }
    }
  }
  return out;
}