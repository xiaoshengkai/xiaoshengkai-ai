"use client";

import { useEffect, useState, useRef } from "react";
import PixelLoading from "@/components/ui/pixel-loading";
import { useImageViewer } from "./image-viewer";

interface GeneratedImageProps {
  src: string;
  alt?: string;
}

export default function GeneratedImage({ src, alt }: GeneratedImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const { register, open } = useImageViewer();
  const indexRef = useRef<number>(0);

  useEffect(() => { indexRef.current = register(src); }, [src]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setState("loaded");
    img.onerror = () => setState("error");
    img.src = src;
  }, [src]);

  useEffect(() => {
    if (state === "loaded" || state === "error") {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("virtuoso-resize"));
      });
    }
  }, [state]);

  if (state === "loading") {
    return <PixelLoading text="图片加载中..." />;
  }

  if (state === "error") {
    return (
      <span className="pixel-bubble-ai p-3 my-2 text-xs text-destructive font-mono" style={{ display: "block" }}>
        [图片加载失败]
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className="pixel-img my-2 cursor-zoom-in"
      onClick={() => open(indexRef.current!)}
    />
  );
}