/** 日志行级别着色（Neo-Brutalism token）：ERR=红 / INFO=蓝 / WARN=橙 / 其余默认 */
export function getLogColor(line: string): { color?: string } {
  if (line.includes("[ERR]")) return { color: "var(--destructive)" };
  if (line.includes("[INFO]")) return { color: "var(--blue)" };
  if (line.includes("[WARN]")) return { color: "var(--orange)" };
  return {};
}
