"use client";

/* The workspace's side of the preview frame — shared by the desktop pane
 * (PreviewPanel) and the phone sheet (PreviewSheet), so the two cannot drift
 * apart. Before this the phone sheet framed the preview by address and had
 * none of it: no staying signed in across reloads, no visual edit.
 *
 * What crosses the frame boundary, and only from our own frame:
 *   auth-storage   the app's Supabase session, kept for this tab (auth-seed.ts)
 *   ready          the design tokens, and edit mode put back after a reload
 *   select         what was clicked in edit mode
 *   rect           where the selected element is now, as the page scrolls
 *   deselect       the selection let go of in the frame (Escape)
 * and the other way: edit mode on/off, deselect, select the parent of what is
 * selected. */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { rememberAuthWrite } from "@/lib/builder/preview/auth-seed";

/* Where the selected element sits in the frame's viewport, in CSS pixels,
   with the viewport's own size so the workspace can place a prompt beside it. */
export type PickedRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

/* What was clicked in edit mode, as the frame describes it. */
export type Picked = {
  src: string;
  tag: string;
  className: string;
  text: string | null;
  imageSrc: string | null;
  repeated: number;
  rect: PickedRect | null;
  /* Which click this was, so two elements written at the same place (a card
     in a list) are still two picks. */
  pickId: number;
};

function rectFrom(value: unknown): PickedRect | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const keys = ["top", "left", "width", "height", "viewportWidth", "viewportHeight"] as const;
  if (!keys.every((key) => typeof r[key] === "number" && Number.isFinite(r[key]))) return null;
  return {
    top: r.top as number,
    left: r.left as number,
    width: r.width as number,
    height: r.height as number,
    viewportWidth: r.viewportWidth as number,
    viewportHeight: r.viewportHeight as number,
  };
}

export function usePreviewBridge(frameRef: RefObject<HTMLIFrameElement | null>, projectId: string | null | undefined, touch = false) {
  const [editMode, setEditMode] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  /* Every element clicked so far, oldest first — the newest is `picked`. One
     request covers them all. */
  const [picks, setPicks] = useState<Picked[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const editModeRef = useRef(false);
  editModeRef.current = editMode;

  const tellFrame = useCallback(
    (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ source: "quickstark-workspace", ...message }, "*");
    },
    [frameRef],
  );

  useEffect(() => {
    tellFrame({ editMode, touch });
    if (!editMode) {
      setPicked(null);
      setPicks([]);
    }
  }, [editMode, touch, tellFrame]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as { source?: string; state?: string; detail?: Record<string, unknown> | null } | null;
      if (!data || data.source !== "quickstark-preview") return;

      if (data.state === "auth-storage" && projectId) {
        try {
          rememberAuthWrite(window.sessionStorage, projectId, data.detail?.key, data.detail?.value);
        } catch {
          /* No sessionStorage: the session lasts as long as the frame. */
        }
        return;
      }

      if (data.state === "select") {
        const detail = data.detail as Partial<Picked> | null;
        if (detail && typeof detail.src === "string" && typeof detail.tag === "string") {
          const next: Picked = {
            src: detail.src,
            tag: detail.tag,
            className: typeof detail.className === "string" ? detail.className : "",
            text: typeof detail.text === "string" ? detail.text : null,
            imageSrc: typeof detail.imageSrc === "string" ? detail.imageSrc : null,
            repeated: typeof detail.repeated === "number" ? detail.repeated : 1,
            rect: rectFrom((detail as { rect?: unknown }).rect),
            pickId: typeof detail.pickId === "number" ? detail.pickId : 0,
          };
          setPicked(next);
          setPicks((current) =>
            current.some((one) => one.pickId === next.pickId && next.pickId !== 0)
              ? current.map((one) => (one.pickId === next.pickId ? next : one))
              : [...current, next],
          );
        }
        return;
      }

      /* Clicked a second time in the frame: let go of that one. */
      if (data.state === "unpick") {
        const id = (data.detail as { pickId?: unknown } | null)?.pickId;
        if (typeof id === "number") setPicks((current) => current.filter((one) => one.pickId !== id));
        return;
      }

      /* The selected element moved — a scroll, a picture loading above it. */
      if (data.state === "rect") {
        const rect = rectFrom(data.detail);
        if (rect) setPicked((current) => (current ? { ...current, rect } : current));
        return;
      }

      /* Let go of in the frame itself (Escape). */
      if (data.state === "deselect") {
        setPicked(null);
        setPicks([]);
        return;
      }

      if (data.state === "ready") {
        const offered = data.detail?.tokens;
        if (offered && typeof offered === "object") {
          setTokens(
            Object.fromEntries(
              Object.entries(offered as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
          );
        }
        /* A reloaded frame starts outside edit mode; put it back. */
        if (editModeRef.current) {
          setPicked(null);
          setPicks([]);
          frameRef.current.contentWindow?.postMessage({ source: "quickstark-workspace", editMode: true, touch }, "*");
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, projectId, touch]);

  const deselect = useCallback(() => {
    setPicked(null);
    setPicks([]);
    tellFrame({ deselect: true });
  }, [tellFrame]);
  const selectParent = useCallback(() => tellFrame({ selectParent: true }), [tellFrame]);

  return { editMode, setEditMode, picked, setPicked, picks, tokens, deselect, selectParent };
}
