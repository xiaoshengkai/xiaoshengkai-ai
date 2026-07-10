"use client";

interface PixelLoadingProps {
  text?: string;
}

export default function PixelLoading({ text = "加载中..." }: PixelLoadingProps) {
  return (
    <span className="pixel-bubble-ai p-3 my-2 flex items-center gap-2" style={{ display: "block" }}>
      <span className="pixel-load-dot" />
      <span className="pixel-load-dot" />
      <span className="pixel-load-dot" />
      <span className="pixel-load-dot" />
      <span className="text-xs text-muted-foreground/50 font-mono ml-1">{text}</span>
    </span>
  );
}