"use client";

import { useMemo, type ComponentPropsWithoutRef } from "react";
import PixelLoading from "@/components/ui/pixel-loading";
import GeneratedImage from "@/components/ui/generated-image";

export function useMarkdownComponents(isLoading: boolean) {
  return useMemo(() => ({
    img({ src, alt }: ComponentPropsWithoutRef<"img">) {
      if (!src) return null;
      if (isLoading) return <PixelLoading text="图片加载中..." />;
      return <GeneratedImage src={String(src)} alt={alt} />;
    },
    iframe({ src, ...props }: ComponentPropsWithoutRef<"iframe">) {
      if (!src) return null;
      return (
        <div className="my-2 flex justify-center">
          <iframe
            src={src}
            className="border-2 border-border rounded-2xl"
            {...props}
          />
        </div>
      );
    },
  }), [isLoading]);
}