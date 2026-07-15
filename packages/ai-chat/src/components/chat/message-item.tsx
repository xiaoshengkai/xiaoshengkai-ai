"use client";

import { useMemo, useState, useCallback } from "react";
import { isToolUIPart, isReasoningUIPart, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import { cn } from "@/lib/utils";
import { calculateCost, formatTokens } from "@/lib/cost";
import { BookmarkPlus, Check, X, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import TooltipIcon from "@/components/ui/tooltip-icon";
import { useMarkdownComponents } from "@/components/chat/markdown-components";
import NotePreviewCard from "@/components/chat/note-preview-card";

export default function MessageItem({
  msg,
  isLoading,
}: {
  msg: UIMessage;
  isLoading: boolean;
}) {
  const markdownComponents = useMarkdownComponents(isLoading);
  const [saveState, setSaveState] = useState<"idle" | "loading" | "success" | "error">("idle");

  const meta = msg.metadata as {
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    provider?: string;
    model?: string;
    classifyUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  } | undefined;

  const modelName = meta?.model || "deepseek-v4-pro";
  const isMiniMax = meta?.provider === "minimax";
  const classifyName = "deepseek-v4-flash";

  const deduplicatedParts = useMemo(() => {
    return msg.parts.filter((p, i) => {
      if (!p.type || !isToolUIPart(p)) return true;
      const next = msg.parts[i + 1];
      if (next && isToolUIPart(next) && (next as { toolName: string }).toolName === (p as { toolName: string }).toolName) {
        return false;
      }
      return true;
    });
  }, [msg.parts]);

  const handleSave = useCallback(async () => {
    if (saveState !== "idle") return;
    const content = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n\n");
    if (!content.trim()) return;

    setSaveState("loading");
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("save failed");
setSaveState("success");
      toast("已保存到知识库", {
        duration: 1000,
        style: {
          border: "2px solid var(--pixel-green)",
          boxShadow: "2px 0 0 0 var(--pixel-green-dark), 0 2px 0 0 var(--pixel-green-dark), 2px 2px 0 0 var(--pixel-green-dark)",
          background: "var(--pixel-green)",
          color: "#fff",
          borderRadius: 0,
          fontFamily: "monospace",
          fontSize: "0.75rem",
          padding: "4px 12px",
          width: "auto",
        },
      });
    } catch {
      setSaveState("error");
toast.error("保存失败，请重试", {
        duration: 1000,
        style: {
          border: "2px solid var(--pixel-red)",
          boxShadow: "2px 0 0 0 var(--pixel-red-dark), 0 2px 0 0 var(--pixel-red-dark), 2px 2px 0 0 var(--pixel-red-dark)",
          background: "var(--pixel-red)",
          color: "#fff",
          borderRadius: 0,
          fontFamily: "monospace",
          fontSize: "0.75rem",
          padding: "4px 12px",
          width: "auto",
        },
      });
    }
  }, [saveState, msg.parts]);

  return (
    <div>
      <div className={cn("flex gap-3 msg-enter min-w-0", msg.role === "user" ? "justify-end" : "justify-start")}>
        {msg.role !== "user" && (
          <div className="pixel-avatar shrink-0 w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-[family-name:var(--font-pixel)] font-bold mt-0.5">
            AI
          </div>
        )}
        <div className={msg.role === "user" ? "max-w-[80%] min-w-0" : "w-[80%]"}>
          <div className={cn("px-4 py-2.5 text-sm font-[family-name:var(--font-pixel)]", msg.role === "user" ? "pixel-bubble" : "pixel-bubble-ai")}>
            <div className={msg.role !== "user" ? "prose dark:prose-invert prose-sm max-w-none [&_img]:pixel-img overflow-hidden" : "whitespace-pre-wrap break-words"}>
              {deduplicatedParts.map((part, i) => {
                if (part.type === "text") {
                  if (msg.role === "user") {
                    const displayText = part.text.replace(/\[图片数据:data:image\/[^\]]+\]\n?/g, "");
                    const segments = displayText.split(/(\[上传图片:\d+\])/g);
                    return (
                      <span key={i}>
                        {segments.map((seg, j) => {
                          const m = seg.match(/^\[上传图片:(\d+)\]$/);
                          if (m) {
                            const imgData = sessionStorage.getItem(`upload_img_${m[1]}`);
                            if (imgData) return <img key={j} src={imgData} className="max-w-full max-h-48 pixel-img mb-2" alt="上传图片" />;
                          }
                          return seg ? <span key={j}>{seg}</span> : null;
                        })}
                      </span>
                    );
                  }

                  return (
                    <ReactMarkdown
                      key={i}
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={markdownComponents}
                    >
                      {part.text}
                    </ReactMarkdown>
                  );
                }
                if (part.type === "file" && part.mediaType?.startsWith("image/")) {
                  return (
                    <div key={i} className="mb-2">
                      <img src={(part as any).data} alt={(part as any).name || "图片"} className="max-w-full max-h-48 pixel-img" />
                    </div>
                  );
                }
                if (isReasoningUIPart(part)) {
                  return (
                    <details key={i} open={isLoading} className="not-prose mb-2 text-xs opacity-70">
                      <summary className="cursor-pointer hover:opacity-100 transition-opacity">
                        [思考过程]
                      </summary>
                      <div className="mt-1 pl-3 border-l-2 border-current/20 whitespace-pre-wrap italic">
                        {part.text}
                      </div>
                    </details>
                  );
                }
                if (part.type && isToolUIPart(part)) {
                  const toolPart = part as { toolName: string; state: string; output: string };
                  if (toolPart.toolName === "generateXiaohongshuNote" && toolPart.state === "result") {
                    try {
                      const output = JSON.parse(toolPart.output);
                      if (output?.ok && output?.taskId) {
                        return <NotePreviewCard key={i} taskId={output.taskId} />;
                      }
                    } catch { /* fall through to tool label */ }
                  }
                  return <span key={i} className="text-xs text-muted-foreground/50">[{toolPart.toolName}]</span>;
                }
                return null;
              })}
            </div>
            {msg.role !== "user" && !isLoading && (
              <div className="flex justify-between items-start mt-2">
                <div>
                  {meta?.usage ? (
                    <div className="flex items-center gap-1 text-[11px] font-mono whitespace-nowrap">
                      <span style={{ color: isMiniMax ? "var(--pixel-yellow)" : modelName.includes("flash") ? "var(--pixel-blue)" : "var(--pixel-purple)" }}>
                        {isMiniMax ? "🎨 M3" : modelName.includes("flash") ? "⚡ flash" : "🚀 pro"}
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-muted-foreground/50">
                        {formatTokens(meta.usage.totalTokens ?? 0)} tokens
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-muted-foreground/50">
                        ¥{calculateCost(modelName, meta.usage.inputTokens ?? 0, meta.usage.outputTokens ?? 0).toFixed(4)}
                      </span>
                    </div>
                  ) : (
                    <span />
                  )}
                  {meta?.classifyUsage?.totalTokens ? (
                    <div className="flex items-center gap-1 text-[11px] font-mono mt-0.5">
                      <span className="text-muted-foreground/30">└</span>
                      <span className="text-muted-foreground/50">classify</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-muted-foreground/50">
                        {formatTokens(meta.classifyUsage.totalTokens)} tokens
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-muted-foreground/50">
                        ¥{calculateCost(classifyName, meta.classifyUsage.inputTokens, meta.classifyUsage.outputTokens).toFixed(4)}
                      </span>
                    </div>
                  ) : null}
                </div>
                <TooltipIcon
                  icon={
                    saveState === "loading" ? <LoaderCircle className="size-6 p-0.5 animate-spin" /> :
                    saveState === "success" ? <Check className="size-6 p-0.5" /> :
                    saveState === "error" ? <X className="size-6 p-0.5" /> :
                    <BookmarkPlus className="size-6 p-0.5" />
                  }
                  label={
                    saveState === "loading" ? "保存中…" :
                    saveState === "success" ? "已保存" :
                    saveState === "error" ? "保存失败" :
                    "记入知识库"
                  }
                  onClick={handleSave}
                  clickable={saveState === "idle"}
                />
              </div>
            )}
          </div>
        </div>
        {msg.role === "user" && (
          <div className="pixel-avatar shrink-0 w-8 h-8 bg-primary/20 text-primary flex items-center justify-center text-[10px] font-[family-name:var(--font-pixel)] font-bold mt-0.5">
            ME
          </div>
        )}
      </div>
    </div>
  );
}