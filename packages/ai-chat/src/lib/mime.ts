/**
 * MIME 字典 + 扩展名工具
 *
 * 单一来源：之前在 5 个文件里各写一份
 */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv'] as const;
// ponytail: webm 在 upload/route.ts 被禁（minimax 不支持），但 modality-detector 仍可识别
export const ALL_VIDEO_EXTS_FOR_DETECT = [...VIDEO_EXTS, 'webm'] as const;

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  srt: 'text/plain; charset=utf-8',
};

export function extToMime(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function getExt(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function isImageExt(ext: string): boolean {
  return (IMAGE_EXTS as readonly string[]).includes(ext);
}

export function isVideoExt(ext: string): boolean {
  return (ALL_VIDEO_EXTS_FOR_DETECT as readonly string[]).includes(ext);
}