/**
 * 模态识别器
 *
 * 从消息中提取图片/视频附件：
 *  - [图片:/api/uploads/xxx.png] 上传标记
 *  - [视频:/api/uploads/xxx.mp4] 上传标记
 *  - https://... 直接 URL
 */

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
 * 支持：
 *   - [图片:/api/uploads/xxx.png]
 *   - [视频:/api/uploads/xxx.mp4]
 *   - https://example.com/xxx.png
 */
export function parseAttachment(source: string): Attachment | null {
  source = source.trim();
  if (!source) return null;

  // 上传标记
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

  // 公网/内网 URL
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
export function extractAttachments(messages: any[]): Attachment[] {
  const out: Attachment[] = [];
  for (const msg of messages) {
    for (const part of msg.parts || []) {
      if (part?.type !== 'text') continue;
      const text = part.text || '';
      // 匹配 [图片:...] 或 [视频:...] 或 https://...图片视频URL
      const regex = /\[(图片|视频):[^\]]+\]|https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|mp4|webm|mov|mkv)(?:\?[^\s]*)?/gi;
      const matches = text.match(regex) || [];
      for (const m of matches) {
        const att = parseAttachment(m);
        if (att) out.push(att);
      }
    }
  }
  return out;
}

/**
 *  判断路径是否为视频文件
 */
export function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTS.includes(ext);
}

/**
 * 判断路径是否为图片文件
 */
export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTS.includes(ext);
}