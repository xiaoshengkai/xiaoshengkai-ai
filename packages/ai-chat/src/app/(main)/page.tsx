"use client";

import { BASE } from "@/lib/utils/utils";
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { Send, ChevronDown, Image as ImageIcon, Square } from "lucide-react";
import { toast } from "sonner";
import MessageItem from "@/components/chat/message-item";
import { ImageViewerProvider } from "@/components/ui/image-viewer";
import RightPanel from "@/components/layout/right-panel";
import { useConversation } from "@/components/layout/conversation-context";
import { calculateCost, formatTokens } from "@/lib/utils/cost";
import { uploadFile } from "@/lib/utils/upload-client";
import type { AttachedFile } from "@/lib/utils/types";
import Logo from "@/components/ui/logo";

const LoadingDots = React.memo(function LoadingDots() {
  return (
    <div className="flex gap-3 px-4 msg-enter">
      <div className="shrink-0 w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-mono font-bold border-2">
        AI
      </div>
      <div className="bg-card border-[3px] shadow-md px-4 py-3 flex items-center gap-1.5">
        <span className="w-2 h-2 bg-primary animate-bounce" />
        <span className="w-2 h-2 bg-yellow animate-bounce" style={{ animationDelay: "0.1s" }} />
        <span className="w-2 h-2 bg-blue animate-bounce" style={{ animationDelay: "0.2s" }} />
      </div>
    </div>
  );
});

const EmptyState = React.memo(function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4">
      <Logo size={12} />
      <h1 className="text-2xl font-bold tracking-widest font-heading">小盛开AI</h1>
      <p className="text-muted-foreground text-xs font-mono">PRESS ENTER TO CHAT ▸</p>
    </div>
  );
});

function generateId() {
  return `conv-${Date.now().toString(36)}`;
}

export default function ChatPage() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const [compressState, setCompressState] = useState<"idle" | "loading">("idle");
  const [isFocused, setIsFocused] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const { activeConversationId, setActiveConversationId, clearMessagesRef, triggerRefresh, newIdsRef } = useConversation();
  const convIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  clearMessagesRef.current = () => {
    setMessages([]);
    convIdRef.current = null;
  };

  const transport = useMemo(() => new DefaultChatTransport({
    api: `${BASE}/api/chat`,
    body: () => ({}),
  }), []);

  const { messages, setMessages, sendMessage, status, stop } = useChat({
    transport,
    onError: (err) => {
      console.error("[chat] error:", err.message);
      const msg = err.message && err.message !== "An error occurred."
        ? err.message
        : "请求失败，请重试";
      toast.error(msg);
    },
  });

  const saveConversation = useCallback(async () => {
    if (!convIdRef.current || messages.length === 0 || savingRef.current) return;
    savingRef.current = true;
    const firstTextPart = messages[0]?.parts?.find((p) => p.type === "text") as { text?: string } | undefined;
    const title = firstTextPart?.text?.slice(0, 30) || "未命名对话";
    try {
      await fetch(`${BASE}/api/conversations/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: convIdRef.current,
          title,
          messages,
          model: "default",
        }),
      });
      triggerRefresh();
      newIdsRef.current.delete(convIdRef.current);
    } catch { /* ignore */ }
    savingRef.current = false;
  }, [messages, newIdsRef, triggerRefresh]);

  // 切换对话时加载新对话
  useEffect(() => {
    if (activeConversationId === convIdRef.current) return;

    const switchConversation = async () => {
      console.log("[scroll-debug] 切换对话:", activeConversationId, "| isAtBottom:", isAtBottom, "| atBottomRef:", atBottomRef.current);
      stop(); // 中断AI回答
      if (activeConversationId && !newIdsRef.current.has(activeConversationId)) {
        try {
          const res = await fetch(`${BASE}/api/conversations/getDetail?id=${activeConversationId}`);
          if (res.ok) {
            const data = await res.json();
            setMessages(data.messages || []);
            convIdRef.current = activeConversationId;
            setTimeout(() => {
              virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
            }, 100);
            return;
          }
        } catch { /* ignore */ }
      }
      // 新对话
      setMessages([]);
      convIdRef.current = null;
    };

    switchConversation();
  }, [activeConversationId, newIdsRef, stop, setMessages]);

  // AI 回复完成后保存
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready" && convIdRef.current && messages.length > 0) {
      saveConversation();
    }
    prevStatusRef.current = status;
  }, [status, messages.length, saveConversation]);

  const isLoading = status === "streaming" || status === "submitted";
  const showFooter = isLoading && (messages.length === 0 || messages[messages.length - 1]?.role === "user");
  const hasMessages = messages.length > 0;

  const handleSend = async () => {
    const value = inputRef.current?.value.trim();
    if (!value && images.length === 0) return;
    if (uploading) return;

    // 发送前保存当前对话（fire-and-forget，不阻塞发送）
    if (convIdRef.current && messages.length > 0) {
      saveConversation();
    }

    let text = value || "请看这张图";

    if (images.length > 0) {
      const validPaths = images.filter((img) => img.path && img.modality === 'image');
      const validVideos = images.filter((img) => img.path && img.modality === 'video');
      const tags = ['image', 'video'] as const;
      const markers: string[] = [];
      for (const t of tags) {
        for (const img of t === 'image' ? validPaths : validVideos) {
          markers.push(`[${t === 'image' ? '图片' : '视频'}:${img.path}]`);
        }
      }
      if (markers.length > 0) {
        text = markers.join("\n") + "\n\n" + text;
      }
    }

    if (!convIdRef.current) {
      const id = activeConversationId || generateId();
      convIdRef.current = id;
      if (!activeConversationId) {
        newIdsRef.current.add(id);
        setActiveConversationId(id);
      }
    }

    sendMessage({ text });
    setImages([]);
    inputRef.current!.value = "";
    inputRef.current!.style.height = "auto";
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
    }, 50);
  };

  const handleInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const handleCompress = useCallback(async () => {
    if (!hasMessages) return;
    setCompressState("loading");

    const prevSummary = messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts?.filter((p) => p.type === "text") ?? [])
      .map((p) => (p as { text: string }).text)
      .filter((t) => t.startsWith("[上下文摘要] "))
      .map((t) => t.replace("[上下文摘要] ", ""))
      .join("\n\n");

    try {
      const res = await fetch(`${BASE}/api/chat/compress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, previousSummary: prevSummary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const cost = calculateCost("deepseek-v4-pro", data.usage.inputTokens, data.usage.outputTokens);

      const newMsg = {
        id: `compressed-${Date.now()}`,
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: `[上下文摘要] ${data.summary}` }],
        metadata: { usage: data.usage, modelTier: "pro" },
      };
      setMessages([newMsg]);
      toast(`已压缩 · ${formatTokens(data.usage.totalTokens)} tokens · ¥${cost.toFixed(4)}`, { duration: 1500 });
    } catch {
      toast.error("压缩失败，请重试", { duration: 1000 });
    } finally {
      setCompressState("idle");
    }
  }, [hasMessages, messages, setMessages]);

  /** 通用上传 + 容错 fallback（上传失败仍返回占位条目） */
  const uploadOrFallback = useCallback(async (file: File): Promise<AttachedFile> => {
    const name = file.name || `paste.${file.type.split('/')[1] || 'png'}`;
    try {
      return await uploadFile(file);
    } catch (err) {
      toast.error((err as Error).message);
      return { path: '', name, modality: file.type.startsWith('video/') ? 'video' : 'image' };
    }
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgItems = Array.from(items).filter((i) => i.type.startsWith("image/"));
    if (imgItems.length === 0) return;
    e.preventDefault();
    setUploading(true);
    const files = imgItems.map((i) => i.getAsFile()).filter((f): f is File => f !== null);
    const uploaded = await Promise.all(files.map(uploadOrFallback));
    setImages((prev) => [...prev, ...uploaded.filter((i) => i.path)]);
    setUploading(false);
  }, [uploadOrFallback]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploading(true);
    const uploaded = await Promise.all(files.map(uploadOrFallback));
    setImages((prev) => [...prev, ...uploaded.filter((i) => i.path)]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadOrFallback]);

  const removeImage = useCallback((i: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  useEffect(() => {
    console.log("[scroll-debug] msgs.length变化:", messages.length, "| atBottomRef:", atBottomRef.current, "| isAtBottom:", isAtBottom);
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const handler = () => {
      if (atBottomRef.current) {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
      }
    };
    window.addEventListener("virtuoso-resize", handler);
    return () => window.removeEventListener("virtuoso-resize", handler);
  }, []);

  useEffect(() => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!scroller) return;
    const onScroll = () => {
      const el = scroller as HTMLElement;
      const distBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [isAtBottom]);

  return (
    <ImageViewerProvider>
      <div className="flex h-full">
        {/* 聊天区 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Virtuoso
            ref={virtuosoRef}
            className="flex-1 min-h-0"
            followOutput="auto"
            atBottomStateChange={(atBottom) => {
              console.log("[scroll-debug] atBottomStateChange:", atBottom, "| msgs:", messages.length);
              atBottomRef.current = atBottom;
              setIsAtBottom(atBottom);
            }}
            data={messages}
            computeItemKey={(_, msg) => msg.id}
            itemContent={(index, msg) => (
              <div className="py-2 px-4">
                <div className="max-w-3xl mx-auto">
                  <MessageItem msg={msg} isLoading={isLoading && index === messages.length - 1} />
                </div>
              </div>
            )}
            components={{
              EmptyPlaceholder: () => <EmptyState />,
              Footer: () => (
                <>
                  {showFooter && (
                    <div className="py-2 px-4">
                      <div className="max-w-3xl mx-auto">
                        <LoadingDots />
                      </div>
                    </div>
                  )}
                </>
              ),
            }}
          />

          <div className="p-4">
            <div className="max-w-3xl mx-auto relative">
              {!isAtBottom && messages.length > 5 && (
                <button
                  onClick={() => {
                    console.log("[scroll-debug] 点击下滑 | isAtBottom:", isAtBottom, "| msgs:", messages.length);
                    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
                  }}
                  className="brutal-btn bg-yellow text-foreground w-8 h-8 flex items-center justify-center cursor-pointer absolute -top-12 right-0"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              )}
            </div>
            <div className="brutal bg-card max-w-3xl mx-auto">
              {images.length > 0 && (
                <div className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto">
                  {images.map((img, i) => (
                    <div key={i} className="relative shrink-0 h-10 border-2 border-border">
                      {img.modality === 'video' ? (
                        <div className="w-16 h-10 bg-black flex items-center justify-center text-white text-xs">
                          <span className="text-[10px]">▶ 视频</span>
                        </div>
                      ) : (
                        <img src={img.path} className="w-auto h-10 object-contain" alt={img.name} />
                      )}
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-ink text-white text-[10px] flex items-center justify-center cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {hasMessages && (
                <div className="flex items-center justify-between px-3 pt-2 pb-1">
                  <div className="flex items-center gap-1">
                    <button
                      className="brutal-btn bg-card px-2 py-0.5 text-xs font-mono font-bold"
                      onClick={handleCompress}
                      disabled={compressState === "loading"}
                    >
                      {compressState === "loading" ? "压缩中..." : "压缩对话"}
                    </button>
                  </div>
                </div>
              )}
              <textarea
                ref={inputRef}
                rows={1}
                placeholder="输入消息..."
                disabled={isLoading}
                className="w-full min-h-10 max-h-80 px-3 py-2 text-sm outline-none resize-none overflow-y-auto placeholder:text-muted-foreground/50 bg-transparent"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onInput={handleInput}
                onPaste={handlePaste}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    await handleSend();
                  }
                }}
              />
              <div className="flex items-center justify-between px-3 pt-1 pb-2">
                <div className="flex items-center gap-1">
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="brutal-btn bg-card px-2 py-0.5 text-xs font-mono font-bold cursor-pointer"
                  >
                    <ImageIcon className="size-3.5" />
                  </button>
                </div>
                {isLoading ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="brutal-btn bg-ink text-white h-8 w-8 flex items-center justify-center cursor-pointer font-bold"
                    title="停止生成"
                  >
                    <Square className="size-3.5" style={{ background: "#fff" }}/>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => await handleSend()}
                    className="brutal-btn bg-primary text-primary-foreground h-8 w-8 flex items-center justify-center cursor-pointer"
                  >
                    <Send className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 右侧状态面板 */}
        <RightPanel
          messages={messages}
          isLoading={isLoading}
        />
      </div>
    </ImageViewerProvider>
  );
}