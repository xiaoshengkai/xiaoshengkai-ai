
"use client";

import { BASE } from "@/lib/api-path";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useConversation } from "@/components/layout/conversation-context";
import {
  Database,
  Wrench,
  GitBranch,
  Clock,
  FileText,
  Settings,
  Plus,
  MoreHorizontal,
  Pin,
  Trash2,
} from "lucide-react";

interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

interface LeftSidebarProps {
  activeConversationId: string | null;
  onNewConversation: () => string;
  onSelectConversation: (id: string) => void;
}

const menuItems = [
  { href: "/memory", label: "记忆库", icon: Database },
  { href: "/tools", label: "工具库", icon: Wrench, disabled: true },
  { href: "/workflow", label: "工作流", icon: GitBranch, disabled: true },
  { href: "/schedule", label: "定时任务", icon: Clock, disabled: true },
  { href: "https://node.tailddce43.ts.net", label: "博客", icon: FileText },
  { href: "/settings", label: "设置", icon: Settings, disabled: true },
];

export default function LeftSidebar({
  activeConversationId,
  onNewConversation,
  onSelectConversation,
}: LeftSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const { clearMessagesRef, refreshKey } = useConversation();

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/conversations/getList`);
      if (res.ok) {
        const data = await res.json();
        // 排序：置顶在前，然后按时间倒序
        data.sort((a: Conversation, b: Conversation) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        setConversations(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, refreshKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  const handleNewClick = () => {
    const id = onNewConversation();
    const now = Date.now();
    setConversations(prev => [{ id, title: "新对话", createdAt: now, updatedAt: now }, ...prev]);
    if (pathname !== "/") router.push("/");
  };

  const handleDelete = async (id: string) => {
    setMenuOpen(null);
    if (activeConversationId === id) {
      clearMessagesRef.current?.();
      onNewConversation();
    }
    try {
      await fetch(`${BASE}/api/conversations/delete?id=${id}`, { method: "DELETE" });
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch { /* ignore */ }
  };

  const handlePin = async (id: string, pinned: boolean) => {
    setMenuOpen(null);
    try {
      await fetch(`${BASE}/api/conversations/pin?id=${id}&pinned=${!pinned}`, { method: "POST" });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, pinned: !pinned } : c));
    } catch { /* ignore */ }
  };

  return (
    <aside className="pixel-sidebar w-[240px] shrink-0 h-dvh flex flex-col">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 px-4 py-4 border-b-2 border-border">
        <PixelLogo />
        <span className="text-sm font-bold font-[family-name:var(--font-pixel)] tracking-wider">
          小盛开AI
        </span>
      </Link>

      {/* 新对话 */}
      <div className="px-3 py-2 border-b-2 border-border">
        <button
          onClick={handleNewClick}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-[family-name:var(--font-pixel)] cursor-pointer w-full border-2 text-white"
          style={{
            background: "var(--pixel-red)",
            borderColor: "var(--pixel-red)",
            boxShadow: "3px 0 0 0 var(--pixel-red-dark), 0 3px 0 0 var(--pixel-red-dark), 3px 3px 0 0 var(--pixel-red-dark)",
          }}
        >
          <Plus className="size-3.5" />
          <span>新对话</span>
        </button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
        {conversations.length > 0 && conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => {
                onSelectConversation(conv.id);
                if (pathname !== "/") router.push("/");
              }}
              className={`group flex items-center gap-2 px-2 py-1.5 cursor-pointer text-sm font-[family-name:var(--font-pixel)] border-2 relative
                ${activeConversationId === conv.id ? "border-[var(--pixel-blue)]" : "border-border hover:bg-muted"}`}
              style={activeConversationId === conv.id ? { background: "var(--pixel-blue)", color: "#fff", borderColor: "var(--pixel-blue)" } : undefined}
            >
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.target as HTMLElement).closest("button")!.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom, left: rect.right + 4 });
                  setMenuOpen(menuOpen === conv.id ? null : conv.id);
                }}
                className={`shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer ${activeConversationId === conv.id ? "text-white/70 hover:text-white" : "text-muted-foreground/50 hover:text-foreground"}`}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menuOpen === conv.id && (
                <div
                  className="fixed z-50 border-2 border-border shadow-sm py-1 min-w-[100px]"
                  style={{ top: menuPos.top, left: menuPos.left, background: "var(--muted)", color: "var(--foreground)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handlePin(conv.id, !!conv.pinned)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-[family-name:var(--font-pixel)] hover:bg-muted cursor-pointer w-full text-foreground"
                  >
                    <Pin className="size-3.5" />
                    <span>{conv.pinned ? "取消置顶" : "置顶"}</span>
                  </button>
                  <button
                    onClick={() => handleDelete(conv.id)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-[family-name:var(--font-pixel)] hover:bg-muted cursor-pointer w-full text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    <span>删除</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

      {/* 菜单项 */}
      <nav className="px-3 py-3 space-y-1 border-t-2 border-border">
        {menuItems.map((item) => {
          const isDisabled = item.disabled;
          return (
            <Link
              key={item.href}
              href={isDisabled ? "#" : item.href}
              target={isDisabled ? undefined : "_blank"}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-[family-name:var(--font-pixel)] transition-colors
                ${isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer hover:bg-muted"}`}
              onClick={(e) => isDisabled && e.preventDefault()}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 版权 */}
      <div className="px-3 pb-3 text-[10px] text-muted-foreground font-[family-name:var(--font-pixel)] text-center">
        © 2026 开盛
      </div>
    </aside>
  );
}

function PixelLogo() {
  const PX = 10;
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
    <div className="relative shrink-0" style={{ width: pixels[0].length * PX, height: pixels.length * PX }}>
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