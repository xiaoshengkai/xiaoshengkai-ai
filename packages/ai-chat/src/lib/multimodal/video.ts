/**
 * 视频处理器 — 视频已不支持，仅保留 stripVideos 静默丢弃
 *
 * ponytail: 2026-08-28 — 视频能力移除，processVideos/loadVideosAsFile 一并删除
 */

import { VIDEO_URL_REGEX, VIDEO_MARKER_STRIP } from './attachment';
import type { Message, MessagePart, TextPart } from "../utils/types"

/** 剥离消息中的视频标记（静默丢弃成 [视频] 占位） */
export function stripVideos(msg: Message): Message {
  const parts = (msg.parts || []).filter((p) =>
    !(p.type === 'file' && typeof p.mediaType === 'string' && p.mediaType.startsWith('video/'))
  ).map((p): MessagePart => {
    if (p.type !== 'text') return p;
    const tp = p as TextPart;
    return {
      ...tp,
      text: (tp.text || '').replace(VIDEO_MARKER_STRIP, '[视频]').replace(VIDEO_URL_REGEX, '[视频]'),
    };
  });
  if (parts.length === 0) parts.push({ type: 'text', text: '[视频]' });
  return { ...msg, parts };
}
