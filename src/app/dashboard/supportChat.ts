"use client";

import { useSyncExternalStore } from "react";

/* A way to open the support chat from somewhere else on the page.

   The launcher lives in a fixed corner and owns its own open state, which is
   right for the button but leaves anything else — a Contact Support button in a
   modal, say — with no way to reach it. This is that way: a counter the chat
   watches, bumped by whoever wants it opened.

   A counter rather than a boolean, so two requests in a row are two events
   rather than one no-op, and there is no flag left set for the chat to clear. */
let requests = 0;
const listeners = new Set<() => void>();

export function requestSupportChat() {
  requests += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The number of times the chat has been asked to open. Watch it, don't read it:
    what matters is that it changed. */
export function useSupportChatRequests(): number {
  return useSyncExternalStore(
    subscribe,
    () => requests,
    () => 0,
  );
}
