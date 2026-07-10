"use client";

import { useMemo } from "react";
import PixelLoading from "@/components/ui/pixel-loading";
import GeneratedImage from "@/components/ui/generated-image";

export function useMarkdownComponents(isLoading: boolean) {
  return useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img({ src, alt }: any) {
      if (!src) return null;
      if (isLoading) return <PixelLoading text="图片加载中..." />;
      return <GeneratedImage src={String(src)} alt={alt} />;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iframe({ src, ...props }: any) {
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