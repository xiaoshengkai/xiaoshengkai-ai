"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare,
  Database,
  Wrench,
  GitBranch,
  Clock,
  FileText,
  Settings,
} from "lucide-react";

const menuItems = [
  { href: "/memory", label: "记忆库", icon: Database },
  { href: "/tools", label: "工具库", icon: Wrench, disabled: true },
  { href: "/workflow", label: "工作流", icon: GitBranch, disabled: true },
  { href: "/schedule", label: "定时任务", icon: Clock, disabled: true },
  { href: "/blog", label: "博客", icon: FileText, disabled: true },
  { href: "/settings", label: "设置", icon: Settings, disabled: true },
];

export default function LeftSidebar() {
  const pathname = usePathname();

  return (
    <aside className="pixel-sidebar w-[240px] shrink-0 h-dvh flex flex-col overflow-hidden">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 px-4 py-4 border-b-2 border-border">
        <PixelLogo />
        <span className="text-sm font-bold font-[family-name:var(--font-pixel)] tracking-wider">
          小盛开AI
        </span>
      </Link>

      {/* 对话 */}
      <div className="border-b-2 border-border px-3 py-3">
        <Link
          href="/"
          className={`flex items-center gap-3 px-3 py-2 text-sm font-[family-name:var(--font-pixel)] cursor-pointer
            ${pathname === "/" ? "pixel-sidebar-active" : "hover:bg-muted"}`}
        >
          <MessageSquare className="size-4" />
          <span>对话</span>
        </Link>
      </div>

      {/* 菜单项 */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const isDisabled = item.disabled;
          return (
            <Link
              key={item.href}
              href={isDisabled ? "#" : item.href}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-[family-name:var(--font-pixel)] transition-colors
                ${isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
                ${isActive ? "pixel-sidebar-active" : "hover:bg-muted"}`}
              onClick={(e) => isDisabled && e.preventDefault()}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
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