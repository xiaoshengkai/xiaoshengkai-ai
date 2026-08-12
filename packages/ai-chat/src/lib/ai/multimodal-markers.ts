/**
 * 多模态 marker / URL 正则常量
 *
 * 之前散落在 6 个文件里 — 现在统一导出
 */

export const UPLOAD_MARKER_MATCH = /^\[(图片|视频):([^\]]+)\]$/;
// ponytail: 用非捕获组 (?:...) 避免 split 重复插入捕获项（与 message-item.tsx 早期 bug 同根）
export const UPLOAD_MARKER_SPLIT = /(\[(?:图片|视频):[^\]]+\])/g;
export const IMAGE_UPLOAD_REGEX = /\[图片:([^\]]+)\]/g;
export const VIDEO_UPLOAD_REGEX = /\[视频:([^\]]+)\]/g;
export const IMAGE_MARKER_STRIP = /\[图片:[^\]]+\]/g;
export const VIDEO_MARKER_STRIP = /\[视频:[^\]]+\]/g;
export const IMAGE_MARKER_TRIM = /\[图片:[^\]]+\]\n?/g;

export const IMAGE_URL_REGEX = /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?/gi;
export const VIDEO_URL_REGEX = /https?:\/\/[^\s]+\.(?:mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi;
export const ATTACHMENT_REGEX = /\[(图片|视频):[^\]]+\]|https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|mp4|mov|avi|mkv)(?:\?[^\s]*)?/gi;