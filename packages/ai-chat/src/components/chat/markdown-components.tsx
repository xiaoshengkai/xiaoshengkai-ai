"use client";

import { useMemo, type ComponentPropsWithoutRef } from "react";
import Loading from "@/components/ui/loading";
import GeneratedImage from "@/components/ui/generated-image";
import NotePreviewCard from "@/components/chat/note-preview-card";
import { parseNoteIframeSrc } from "@/lib/utils/note-src";

export function useMarkdownComponents(isLoading: boolean) {
  return useMemo(() => ({
    img({ src, alt }: ComponentPropsWithoutRef<"img">) {
      if (!src) return null;
      if (isLoading) return <Loading text="图片加载中..." />;
      return <GeneratedImage src={String(src)} alt={alt} />;
    },
    iframe({ src, ...props }: ComponentPropsWithoutRef<"iframe">) {
      if (!src) return null;
      // 小红书笔记：改用卡片渲染（同源 fetch，规避 iframe 的 basePath/端口/跨域问题，也修历史消息）
      const taskId = parseNoteIframeSrc(String(src));
      if (taskId) return <NotePreviewCard key={taskId} taskId={taskId} />;
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