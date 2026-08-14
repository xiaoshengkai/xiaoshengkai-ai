"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import LeftSidebar from "@/components/layout/left-sidebar";
import { ConversationProvider, useConversation } from "@/components/layout/conversation-context";

function MainLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { activeConversationId, setActiveConversationId, newConversation } = useConversation();

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, [setActiveConversationId]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {pathname === "/" && (
        <LeftSidebar
          activeConversationId={activeConversationId}
          onNewConversation={newConversation}
          onSelectConversation={handleSelectConversation}
        />
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