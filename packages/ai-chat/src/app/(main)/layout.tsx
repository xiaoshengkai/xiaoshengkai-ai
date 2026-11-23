"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import LeftSidebar from "@/components/layout/left-sidebar";
import { ConversationProvider, useConversation } from "@/components/layout/conversation-context";

function MainLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { activeConversationId, setActiveConversationId, newConversation, sidebarOpen, setSidebarOpen } = useConversation();

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, [setActiveConversationId]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {pathname === "/" && (
        <>
          {sidebarOpen && (
            <div
              className="md:hidden fixed inset-0 z-40 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={`fixed inset-y-0 left-0 z-50 w-[240px] transition-transform md:static md:translate-x-0 ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <LeftSidebar
              activeConversationId={activeConversationId}
              onNewConversation={newConversation}
              onSelectConversation={handleSelectConversation}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        </>
      )}
      <main className={`flex-1 min-w-0 min-h-0 ${pathname === "/" ? "overflow-hidden" : "overflow-y-auto"}`}>
        {children}
      </main>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConversationProvider>
      <MainLayoutInner>{children}</MainLayoutInner>
    </ConversationProvider>
  );
}