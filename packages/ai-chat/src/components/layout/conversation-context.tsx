"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

function generateId() {
  return `conv-${Date.now().toString(36)}`;
}

interface ConversationContextType {
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  refreshKey: number;
  triggerRefresh: () => void;
  newConversation: () => string;
  clearMessagesRef: { current: (() => void) | null };
  newIdsRef: { current: Set<string> };
}

const ConversationContext = createContext<ConversationContextType>({
  activeConversationId: null,
  setActiveConversationId: () => {},
  refreshKey: 0,
  triggerRefresh: () => {},
  newConversation: () => "",
  clearMessagesRef: { current: null },
  newIdsRef: { current: new Set() },
});

export function useConversation() {
  return useContext(ConversationContext);
}

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const clearMessagesRef = useRef<(() => void) | null>(null);
  const newIdsRef = useRef<Set<string>>(new Set());

  const triggerRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  const newConversation = useCallback(() => {
    const id = generateId();
    newIdsRef.current.add(id);
    setActiveConversationId(id);
    return id;
  }, []);

  return (
    <ConversationContext.Provider value={{ activeConversationId, setActiveConversationId, refreshKey, triggerRefresh, newConversation, clearMessagesRef, newIdsRef }}>
      {children}
    </ConversationContext.Provider>
  );
}