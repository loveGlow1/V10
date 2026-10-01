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
 * and the other way: edit mode on/off, a change to show, deselect, select the
 * parent of what is selected. */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { rememberAuthWrite } from "@/lib/builder/preview/auth-seed";

import type { Picked, PreviewChange } from "./VisualEditPanel";

export function usePreviewBridge(frameRef: RefObject<HTMLIFrameElement | null>, projectId: string | null | undefined, touch = false) {
  const [editMode, setEditMode] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
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
    if (!editMode) setPicked(null);
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
          setPicked({
            src: detail.src,
            tag: detail.tag,
            className: typeof detail.className === "string" ? detail.className : "",
            text: typeof detail.text === "string" ? detail.text : null,
            imageSrc: typeof detail.imageSrc === "string" ? detail.imageSrc : null,
            repeated: typeof detail.repeated === "number" ? detail.repeated : 1,
          });
        }
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
          frameRef.current.contentWindow?.postMessage({ source: "quickstark-workspace", editMode: true, touch }, "*");
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, projectId, touch]);

  const previewVisual = useCallback((change: PreviewChange) => tellFrame({ preview: change }), [tellFrame]);
  const deselect = useCallback(() => {
    setPicked(null);
    tellFrame({ deselect: true });
  }, [tellFrame]);
  const selectParent = useCallback(() => tellFrame({ selectParent: true }), [tellFrame]);

  return { editMode, setEditMode, picked, setPicked, tokens, previewVisual, deselect, selectParent };
}
