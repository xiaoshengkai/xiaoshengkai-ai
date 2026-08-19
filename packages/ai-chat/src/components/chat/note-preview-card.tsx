
"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { cn } from "@/lib/utils/utils";
import { ExternalLink } from "lucide-react";
import type { NoteData } from "@/lib/utils/types";

export default function NotePreviewCard({ taskId }: { taskId: string }) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      while (!cancelled && attempts < 30) {
        try {
          const res = await fetch(`${BASE}/api/note/${taskId}/status`);
          const data = await res.json();
          if (!cancelled) {
            setNote(data);
            if (data.status === "ready" || data.status === "partial" || data.status === "failed") {
              return;
            }
          }
        } catch {
          // retry
        }
        attempts++;
        const wait = Math.max(3000 * Math.pow(0.9, attempts), 1800);
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!cancelled && !note) setError("笔记生成超时");
    }

    poll();
    return () => { cancelled = true; };
  }, [taskId]);

  if (error) {
    return (
      <div className="brutal bg-card p-4 my-2 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!note) {
    return (
      <div className="brutal bg-card p-4 my-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex gap-1">
            <span className="w-2 h-2 bg-primary animate-bounce" />
            <span className="w-2 h-2 bg-yellow animate-bounce" style={{ animationDelay: "0.1s" }} />
            <span className="w-2 h-2 bg-blue animate-bounce" style={{ animationDelay: "0.2s" }} />
          </span>
          小红书笔记生成中...
        </div>
      </div>
    );
  }

  const cover = note.images?.[0];
  const illustrations = note.images?.filter((img) => img.type === "illustration") || [];

  return (
    <div className="brutal bg-card my-2 overflow-hidden">
      {/* 封面 */}
      {cover?.url ? (
        <img src={cover.url} alt={note.title} className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center text-sm text-muted-foreground">
          封面生成中...
        </div>
      )}

      {/* 标题 + 正文 */}
      <div className="p-4">
        <h3 className="text-base font-bold mb-3">{note.title}</h3>
        <div className="text-sm space-y-2">
          {note.content?.map((seg, i) => {
            const match = seg.match(/^\[IMG-(\d+)\]$/);
            if (match) {
              const img = illustrations[parseInt(match[1], 10) - 1];
              if (img?.url) {
                return <img key={i} src={img.url} alt="插画" className="w-full border-[3px] shadow-md my-2" />;
              }
              return (
                <div key={i} className="h-32 bg-muted flex items-center justify-center text-xs text-muted-foreground my-2">
                  插画生成中...
                </div>
              );
            }
            return (
              <div key={i} className="prose prose-sm max-w-none [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:border-l-4 [&_h3]:border-red-400 [&_h3]:pl-3 [&_h3]:text-red-600 [&_blockquote]:border-l-4 [&_blockquote]:border-orange-300 [&_blockquote]:bg-orange-50 [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:my-2 [&_blockquote]:rounded-r [&_blockquote]:text-orange-800 [&_blockquote]:not-italic [&_strong]:text-gray-900 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {seg}
                </ReactMarkdown>
              </div>
            );
          })}
        </div>

        {/* 标签 */}
        <div className="flex flex-wrap gap-2 mt-3">
          {note.tags?.map((tag) => (
            <span key={tag} className="text-xs text-[#ff2442]">{tag}</span>
          ))}
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
          <a
            href={`/note/${taskId}`}
            target="_blank"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            rel="noreferrer"
          >
            <ExternalLink className="size-3" />
            打开预览
          </a>
          {note.status === "generating" && (
            <span className="text-xs text-muted-foreground ml-auto">
              {note.images?.filter((img) => img.status === "done").length}/{note.images?.length} 张图片
            </span>
          )}
        </div>
      </div>
    </div>
  );
}