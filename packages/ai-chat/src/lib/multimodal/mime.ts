/**
 * MIME 字典 + 扩展名工具
 */

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