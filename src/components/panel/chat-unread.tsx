"use client";

import { createContext, useContext } from "react";

/** The chat reports its live unread count to the shell, so the navigation marker follows reading (C-F127). */
export const ChatUnreadContext = createContext<((count: number) => void) | null>(null);

export function useReportChatUnread(): (count: number) => void {
  return useContext(ChatUnreadContext) ?? noop;
}

function noop() {}
