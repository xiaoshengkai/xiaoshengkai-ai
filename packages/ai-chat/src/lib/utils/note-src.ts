/**
 * 从 markdown 里的 iframe src 提取小红书笔记 taskId。
 * 兼容相对路径、带 basePath（/ai）、绝对地址（含错端口）、尾斜杠与 query/hash。
 * 命中则聊天里改渲染 NotePreviewCard（同源、无 iframe），非笔记 iframe 返回 null。
 */
export function parseNoteIframeSrc(src?: string | null): string | null {
  if (!src) return null;
  const m = src.match(/^(?:https?:\/\/[^/?#]+)?\/(?:ai\/)?note\/([\w-]+)/);
  return m ? m[1] : null;
}
