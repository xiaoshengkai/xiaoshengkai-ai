"use client";

import { useEffect, useState, useRef } from "react";
import Loading from "@/components/ui/loading";
import { useImageViewer } from "./image-viewer";

interface GeneratedImageProps {
  src: string;
  alt?: string;
}

/** 本地上传图预览走压缩版（?preview=1）；lightbox 仍看原图（register 原 src）。远程/CDN 图不动。 */
function previewSrc(src: string): string {
  if (!/\/api\/uploads\//.test(src)) return src;
  if (!/\.(png|jpe?g|webp)(\?|$)/i.test(src)) return src;
  if (/[?&]preview=/.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}preview=1`;
}

export default function GeneratedImage({ src, alt }: GeneratedImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const { register, open } = useImageViewer();
  const indexRef = useRef<number>(0);
  const display = previewSrc(src);

  useEffect(() => { indexRef.current = register(src); }, [src]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setState("loaded");
    img.onerror = () => setState("error");
    img.src = display;
  }, [display]);

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
      src={display}
      alt={alt}
      className="border-[3px] shadow-md my-2 cursor-zoom-in max-w-full"
      onClick={() => open(indexRef.current!)}
    />
  );
}
