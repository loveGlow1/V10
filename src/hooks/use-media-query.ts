"use client";

import { useCallback, useSyncExternalStore } from "react";

/* A useState + useEffect version renders one thing on the server and another on the
   client, which React reports as a hydration mismatch. useSyncExternalStore takes a
   separate server snapshot, so the two passes agree by construction.

   The server snapshot is false — assume a phone. That way a handset gets the correct
   markup in the first paint and only a desktop pays for a re-render. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
