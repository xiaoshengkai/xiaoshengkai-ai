"use client";

import { useEffect, useState, useRef } from "react";
import Loading from "@/components/ui/loading";
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
    return <Loading text="图片加载中..." />;
  }

  if (state === "error") {
    return (
      <span className="brutal bg-card my-2 inline-block p-3 text-xs text-destructive font-mono">
        [图片加载失败]
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className="border-[3px] shadow-md my-2 cursor-zoom-in max-w-full"
      onClick={() => open(indexRef.current!)}
    />
  );
}