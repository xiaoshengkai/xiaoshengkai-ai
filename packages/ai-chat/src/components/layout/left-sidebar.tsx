
"use client";

import { BASE } from "@/lib/utils/utils";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useConversation } from "@/components/layout/conversation-context";
import Logo from "@/components/ui/logo";
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
  Pencil,
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
  { href: "/workflow", label: "工作流", icon: GitBranch },
  { href: "/schedule", label: "定时任务", icon: Clock },
  { href: "https://node.tailddce43.ts.net", label: "博客", icon: FileText },
  { href: "/settings", label: "设置", icon: Settings },
];

function sortConversations(list: Conversation[]) {
  return [...list].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { clearMessagesRef, refreshKey } = useConversation();

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/conversations/getList`);
      if (res.ok) {
        const data = await res.json();
        setConversations(sortConversations(data));
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

  const startRename = (conv: Conversation) => {
    setMenuOpen(null);
    setEditingId(conv.id);
    setDraft(conv.title);
  };

  const commitRename = async (id: string) => {
    const title = draft.trim().slice(0, 30);
    setEditingId(null);
    if (!title) return;
    try {
      const res = await fetch(`${BASE}/api/conversations/rename?id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`, { method: "POST" });
      if (res.ok) setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    } catch { /* ignore */ }
  };

  const handlePin = async (id: string, pinned: boolean) => {
    setMenuOpen(null);
    try {
      await fetch(`${BASE}/api/conversations/pin?id=${id}&pinned=${!pinned}`, { method: "POST" });
      setConversations(prev => sortConversations(
        prev.map(c => c.id === id ? { ...c, pinned: !pinned } : c)
      ));
    } catch { /* ignore */ }
  };

  return (
    <aside className="w-[240px] shrink-0 h-dvh flex flex-col bg-card border-r-2 border-border">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 px-4 py-4 border-b-2 border-border">
        <Logo size={10} />
        <span className="text-sm font-bold font-heading tracking-wider">
          小盛开AI
        </span>
      </Link>

      {/* 新对话 */}
      <div className="px-3 py-2 border-b-2 border-border">
        <button
          onClick={handleNewClick}
          className="brutal-btn flex items-center gap-2 px-3 py-1.5 text-sm font-mono font-bold cursor-pointer w-full bg-primary text-primary-foreground"
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
              className={`group flex items-center gap-2 px-2 py-1.5 cursor-pointer text-sm font-mono border-2 relative
                ${activeConversationId === conv.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
            >
              {editingId === conv.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(conv.id);
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => commitRename(conv.id)}
                  className="flex-1 min-w-0 bg-card text-foreground border-2 border-border px-1 text-sm font-mono focus:outline-none"
                />
              ) : (
                <span className="flex-1 truncate">{conv.title}</span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.target as HTMLElement).closest("button")!.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom, left: rect.right + 4 });
                  setMenuOpen(menuOpen === conv.id ? null : conv.id);
                }}
                className={`shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer ${activeConversationId === conv.id ? "text-foreground/70 hover:text-foreground" : "text-muted-foreground/50 hover:text-foreground"}`}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menuOpen === conv.id && (
                <div
                  className="fixed z-50 brutal bg-card py-1 min-w-[100px]"
                  style={{ top: menuPos.top, left: menuPos.left }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handlePin(conv.id, !!conv.pinned)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono hover:bg-muted cursor-pointer w-full text-foreground"
                  >
                    <Pin className="size-3.5" />
                    <span>{conv.pinned ? "取消置顶" : "置顶"}</span>
                  </button>
                  <button
                    onClick={() => startRename(conv)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono hover:bg-muted cursor-pointer w-full text-foreground"
                  >
                    <Pencil className="size-3.5" />
                    <span>重命名</span>
                  </button>
                  <button
                    onClick={() => handleDelete(conv.id)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono hover:bg-muted cursor-pointer w-full text-destructive"
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
          const isExternal = typeof item.href === "string" && (item.href.startsWith("http") || item.href.startsWith("//"));
          return (
            <Link
              key={item.href}
              href={isDisabled ? "#" : item.href}
              target={isExternal ? "_blank" : undefined}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-mono transition-colors
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
      <div className="px-3 pb-3 text-[10px] text-muted-foreground font-mono text-center">
        © 2026 开盛
      </div>
    </aside>
  );
}