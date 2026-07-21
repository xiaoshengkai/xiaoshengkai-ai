"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { Send, ChevronDown, Image, Square } from "lucide-react";
import { toast } from "sonner";
import MessageItem from "@/components/chat/message-item";
import { ImageViewerProvider } from "@/components/ui/image-viewer";
import RightPanel from "@/components/layout/right-panel";
import { useConversation } from "@/components/layout/conversation-context";
import { calculateCost, formatTokens } from "@/lib/cost";

const LoadingDots = React.memo(function LoadingDots() {
  return (
    <div className="flex gap-3 px-4 msg-enter">
      <div className="pixel-avatar shrink-0 w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-mono font-bold">
        AI
      </div>
      <div className="pixel-bubble-ai px-4 py-3 flex items-center gap-1.5">
        <span className="pixel-load-dot" />
        <span className="pixel-load-dot" />
        <span className="pixel-load-dot" />
        <span className="pixel-load-dot" />
      </div>
    </div>
  );
});

function PixelLogo() {
  const PX = 12;
  const pixels = [
    "..██..",
    ".████.",
    "██████",
    ".████.",
    "..██..",
    "..██..",
    ".█..█.",
  ];

  return (
    <div className="relative" style={{ width: pixels[0].length * PX, height: pixels.length * PX }}>
      {pixels.map((row, y) =>
        row.split("").map((cell, x) =>
          cell === "█" ? (
            <div
              key={`${x}-${y}`}
              className="absolute"
              style={{
                left: x * PX,
                top: y * PX,
                width: PX,
                height: PX,
                background: "var(--primary)",
              }}
            />
          ) : null
        )
      )}
    </div>
  );
}

const EmptyState = React.memo(function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4">
      <PixelLogo />
      <h1 className="text-2xl font-bold tracking-widest font-mono">小盛开AI</h1>
      <p className="text-muted-foreground/60 text-xs font-mono">PRESS ENTER TO CHAT ▸</p>
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
  const [images, setImages] = useState<{ data: string; name: string }[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<"deepseek" | "minimax">("deepseek");
  const providerRef = useRef(selectedProvider);
  providerRef.current = selectedProvider;
  const { activeConversationId, setActiveConversationId, clearMessagesRef, triggerRefresh, newIdsRef } = useConversation();
  const convIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  clearMessagesRef.current = () => {
    setMessages([]);
    convIdRef.current = null;
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("xsk-provider") as "deepseek" | "minimax" | null;
    if (saved) setSelectedProvider(saved);
  }, []);

  const handleProviderChange = useCallback((p: "deepseek" | "minimax") => {
    sessionStorage.setItem("xsk-provider", p);
    setSelectedProvider(p);
  }, []);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    body: () => ({ provider: providerRef.current }),
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
    const title = (messages[0]?.parts?.find((p: any) => p.type === "text") as any)?.text?.slice(0, 30) || "未命名对话";
    try {
      await fetch("/api/conversations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: convIdRef.current,
          title,
          messages,
          model: selectedProvider,
        }),
      });
      triggerRefresh();
      newIdsRef.current.delete(convIdRef.current);
    } catch { /* ignore */ }
    savingRef.current = false;
  }, [messages, newIdsRef, selectedProvider, triggerRefresh]);

  // 切换对话时加载新对话
  useEffect(() => {
    if (activeConversationId === convIdRef.current) return;

    const switchConversation = async () => {
      stop(); // 中断AI回答
      if (activeConversationId && !newIdsRef.current.has(activeConversationId)) {
        try {
          const res = await fetch(`/api/conversations/getDetail?id=${activeConversationId}`);
          if (res.ok) {
            const data = await res.json();
            setMessages(data.messages || []);
            convIdRef.current = activeConversationId;
            setTimeout(() => {
              virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
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
  }, [activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // 发送前保存当前对话
    if (convIdRef.current && messages.length > 0) {
      await saveConversation();
    }

    let text = value || "请看这张图";

    if (images.length > 0) {
      images.forEach((img, i) => sessionStorage.setItem(`upload_img_${i}`, img.data));
      const imgDataTag = images.map((img) => `[图片数据:${img.data}]`).join("\n");
      const imgTag = images.map((_, i) => `[上传图片:${i}]`).join("\n");
      text = imgDataTag + "\n" + imgTag + "\n\n" + text;
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
      const res = await fetch("/api/chat/compress", {
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

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgItems = Array.from(items).filter((i) => i.type.startsWith("image/"));
    if (imgItems.length === 0) return;
    e.preventDefault();
    Promise.all(
      imgItems.map(
        (item) =>
          new Promise<{ data: string; name: string }>((resolve) => {
            const blob = item.getAsFile()!;
            const reader = new FileReader();
            reader.onload = () => resolve({ data: reader.result as string, name: blob.name || "paste.png" });
            reader.readAsDataURL(blob);
          })
      )
    ).then((newImgs) => setImages((prev) => [...prev, ...newImgs]));
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    Promise.all(
      files.map(
        (f) =>
          new Promise<{ data: string; name: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ data: reader.result as string, name: f.name });
            reader.readAsDataURL(f);
          })
      )
    ).then((newImgs) => setImages((prev) => [...prev, ...newImgs]));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeImage = useCallback((i: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  useEffect(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const handler = () => {
      if (atBottomRef.current) {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
      }
    };
    window.addEventListener("virtuoso-resize", handler);
    return () => window.removeEventListener("virtuoso-resize", handler);
  }, []);

  return (
    <ImageViewerProvider>
      <div className="flex h-full">
        {/* 聊天区 */}
        <div className="flex-1 flex flex-col min-w-0 pixel-bg overflow-hidden">
          <Virtuoso
            ref={virtuosoRef}
            className="flex-1 min-h-0"
            followOutput="auto"
            atBottomStateChange={(atBottom) => { atBottomRef.current = atBottom; setIsAtBottom(atBottom); }}
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
                  onClick={() => virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" })}
                  className="w-8 h-8 rounded-full flex items-center justify-center border-2 border-muted-foreground/15 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer absolute -top-12 right-0"
                >
                  <ChevronDown className="size-3.5 text-muted-foreground/50" />
                </button>
              )}
            </div>
            <div className="pixel-input-group max-w-3xl mx-auto">
              {images.length > 0 && (
                <div className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto">
                  {images.map((img, i) => (
                    <div key={i} className="relative shrink-0 h-10 border-2 border-muted-foreground/15">
                      <img src={img.data} className="w-auto h-10 object-contain" alt={img.name} />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-muted-foreground/80 text-white text-[10px] flex items-center justify-center cursor-pointer"
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
                      className="pixel-btn-ghost px-2 py-0.5 text-xs font-mono font-bold"
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
                className="pixel-input w-full min-h-10 max-h-80 px-3 py-2 text-sm outline-none resize-none overflow-y-auto placeholder:text-muted-foreground/30"
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
                  <input type="file" accept="image/*" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="pixel-btn-image px-2 py-0.5 text-xs font-mono font-bold cursor-pointer"
                  >
                    <Image className="size-3.5" />
                  </button>
                </div>
                {isLoading ? (
                  <button
                    type="button"
                    onClick={stop}
                    style={{ background: "#000", color: "#000", border: "2px solid #000" }}
                    className="h-8 w-8 flex items-center justify-center cursor-pointer font-bold"
                    title="停止生成"
                  >
                    <Square className="size-3.5" style={{ background: "#fff" }}/>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={false}
                    onClick={async () => await handleSend()}
                    className="pixel-btn h-8 w-8 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
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
          selectedProvider={selectedProvider}
          onProviderChange={handleProviderChange}
        />
      </div>
    </ImageViewerProvider>
  );
}