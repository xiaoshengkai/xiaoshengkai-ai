"use client";

/** Neo-Brutalism 加载指示 — 三色跳动方块 */
export default function Loading({ text = "加载中..." }: { text?: string }) {
  return (
    <span className="brutal bg-card inline-flex items-center gap-2 px-3 py-2">
      <span className="flex gap-1">
        <span className="w-2 h-2 bg-primary animate-bounce" />
        <span className="w-2 h-2 bg-yellow animate-bounce" style={{ animationDelay: "0.1s" }} />
        <span className="w-2 h-2 bg-blue animate-bounce" style={{ animationDelay: "0.2s" }} />
      </span>
      <span className="text-xs text-muted-foreground font-mono">{text}</span>
    </span>
  );
}
