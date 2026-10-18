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

import { applyClassChange, type ClassGroup } from "@/lib/builder/visual-edit";

import { askChat, trackTypedSave } from "./visual-ask";

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
  /* The computed size, e.g. "18px" — where the size steps start from when no
     size class says. */
  fontSize?: string;
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

/* A change made by hand, as the visual-edit route takes it. */
type HandEdit = {
  src: string;
  tag: string;
  className: string;
  text: string;
  change: { text?: string; classes?: { group: ClassGroup; value: string }[]; remove?: boolean };
};

/* What the agent is asked when a removal cannot be cut by hand — usually
   because a script or a link still uses something inside the element. */
const REMOVE_FOR_AGENT = "Remove it, and update any script, form handler or link that used it so nothing on the page breaks";

/* What became of the last words typed into the page. */
export type SaveState = null | "saving" | "saved" | "waiting" | "agent" | "conflict" | "error";

export function usePreviewBridge(frameRef: RefObject<HTMLIFrameElement | null>, projectId: string | null | undefined, touch = false) {
  const [editMode, setEditMode] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  /* Every element clicked so far, oldest first — the newest is `picked`. One
     request covers them all. */
  const [picks, setPicks] = useState<Picked[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  /* Typing straight into the page: whether it is happening, and how the last
     words typed were kept — written into the source by hand, or handed to
     the agent when they could not be placed exactly. */
  const [typing, setTyping] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(null);
  /* Bumped when typing was saved after the agent's change landed: the frame
     then shows the agent's page without the typing, so it is reloaded. */
  const [reloadAfterSave, setReloadAfterSave] = useState(0);
  const editModeRef = useRef(false);
  editModeRef.current = editMode;

  const tellFrame = useCallback(
    (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ source: "quickstark-workspace", ...message }, "*");
    },
    [frameRef],
  );

  /* ── Saving a change made by hand — typed words or a quick style ──────
     Written straight into the source by /api/projects/[id]/visual-edit: no
     model, no charge, a new version. When it cannot be placed exactly it
     goes to the agent naming the element, so it still happens. While the
     agent is changing the page it is held and tried again once the agent
     has finished — on top of its change, never under it. The first try is
     what the chat waits for before sending (trackTypedSave). */
  const saveHandEdits = useCallback(
    (edits: HandEdit[], forAgent: string[]) => {
      if (!projectId || edits.length === 0) return;
      const toAgent = (indices: number[]) => {
        const lines = indices
          .filter((i) => edits[i])
          .map((i, n) => {
            const edit = edits[i];
            const words = (edit.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
            return `${n + 1}. <${edit.tag}> in ${edit.src}${words ? ` ("${words}")` : ""}: ${forAgent[i] ?? forAgent[0]}`;
          });
        if (!lines.length) return;
        askChat({ projectId, texts: [`Change these exact elements (picked in the visual editor):\n${lines.join("\n")}`] });
        setSaveState("agent");
      };
      const all = edits.map((_, i) => i);
      /* Saved by hand, with whatever could not be placed exactly handed on. */
      const settle = (body: { applied?: number; needsAi?: { index: number }[] } | null, reload: boolean) => {
        const missed = (body?.needsAi ?? []).map((one) => one.index);
        if ((body?.applied ?? 0) > 0) {
          if (reload) setReloadAfterSave((count) => count + 1);
          if (missed.length) return toAgent(missed);
          return setSaveState("saved");
        }
        return toAgent(missed.length ? missed : all);
      };
      setSaveState("saving");
      const post = () =>
        fetch(`/api/projects/${projectId}/visual-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits }),
        }).then(async (response) => ({ response, body: (await response.json().catch(() => null)) as { applied?: number; code?: string; needsAi?: { index: number }[] } | null }));

      const first = trackTypedSave(post().catch(() => null));
      void first.then(async (result) => {
        if (!result) {
          setReloadAfterSave((count) => count + 1);
          return setSaveState("error");
        }
        if (result.response.ok) return settle(result.body, false);
        if (result.body?.code !== "agent_busy") return toAgent(all);
        setSaveState("waiting");
        const until = Date.now() + 10 * 60_000;
        while (Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          const again = await post().catch(() => null);
          if (!again) continue;
          if (again.body?.code === "agent_busy") continue;
          if (again.response.ok && (again.body?.applied ?? 0) > 0) return settle(again.body, true);
          /* The agent changed this same element first: say so, rather than
             write over its change or hand the agent a second request. */
          setSaveState("conflict");
          setReloadAfterSave((count) => count + 1);
          return;
        }
        setSaveState("error");
      });
    },
    [projectId],
  );
  const saveHandEdit = useCallback((edit: HandEdit, forAgent: string) => saveHandEdits([edit], [forAgent]), [saveHandEdits]);
  const saveRef = useRef(saveHandEdit);
  saveRef.current = saveHandEdit;

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
            fontSize: typeof detail.fontSize === "string" ? detail.fontSize : undefined,
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

      if (data.state === "typing") {
        setTyping(true);
        setSaveState(null);
        return;
      }

      /* Words typed into the page: written into the source by hand (no model,
         no charge, a new version), or — when they cannot be placed exactly —
         sent to the agent naming the element, so the change still happens. */
      if (data.state === "typed") {
        setTyping(false);
        const typed = data.detail as { src?: unknown; tag?: unknown; className?: unknown; before?: unknown; text?: unknown; changed?: unknown } | null;
        if (!typed || typed.changed !== true || typeof typed.src !== "string" || typeof typed.text !== "string") return;
        const tag = typeof typed.tag === "string" ? typed.tag : "span";
        const before = typeof typed.before === "string" ? typed.before : "";
        saveRef.current(
          { src: typed.src, tag, className: typeof typed.className === "string" ? typed.className : "", text: before, change: { text: typed.text } },
          `change the text to "${typed.text.trim()}"`,
        );
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
  /* A quick style — colour, size, weight, alignment — on everything picked:
     shown in the frame at once, then saved by hand like typed words. */
  const applyStyle = useCallback(
    (group: ClassGroup, value: string, words: string) => {
      const targets = picks.length ? picks : picked ? [picked] : [];
      for (const target of targets) {
        const className = applyClassChange(target.className, group, value);
        tellFrame({ preview: { src: target.src, className } });
        saveHandEdit({ src: target.src, tag: target.tag, className: target.className, text: target.text ?? "", change: { classes: [{ group, value }] } }, words);
      }
      const restyled = (one: Picked) => (targets.some((t) => t.pickId === one.pickId && t.src === one.src) ? { ...one, className: applyClassChange(one.className, group, value) } : one);
      setPicks((current) => current.map(restyled));
      setPicked((current) => (current ? restyled(current) : current));
    },
    [picks, picked, tellFrame, saveHandEdit],
  );

  /* Remove everything picked: hidden in the frame at once, cut from the
     source by hand — or, where a script or link still uses it, handed to the
     agent to remove and tidy up after. */
  const removePicked = useCallback(() => {
    const targets = picks.length ? picks : picked ? [picked] : [];
    if (!targets.length) return;
    for (const target of targets) tellFrame({ preview: { src: target.src, hide: true } });
    saveHandEdits(
      targets.map((target) => ({ src: target.src, tag: target.tag, className: target.className, text: target.text ?? "", change: { remove: true } })),
      targets.map(() => REMOVE_FOR_AGENT),
    );
    setPicked(null);
    setPicks([]);
    tellFrame({ deselect: true });
  }, [picks, picked, tellFrame, saveHandEdits]);

  /* Type into the selected element in place. */
  const editText = useCallback(() => tellFrame({ editText: true }), [tellFrame]);
  const stopTyping = useCallback(() => tellFrame({ stopTyping: true }), [tellFrame]);

  /* "Saved" says itself and goes. */
  useEffect(() => {
    if (saveState !== "saved" && saveState !== "agent" && saveState !== "error" && saveState !== "conflict") return;
    const timer = window.setTimeout(() => setSaveState(null), saveState === "conflict" ? 7000 : 3500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  return { editMode, setEditMode, picked, setPicked, picks, tokens, deselect, selectParent, editText, stopTyping, typing, saveState, reloadAfterSave, applyStyle, removePicked };
}

/* The page held still while somebody is typing into it. A build landing
   mid-typing would otherwise replace the frame under their fingers and the
   words with it. The newer page is shown once typing ends — and, when one
   arrived meanwhile, the frame is reloaded after the words are saved, so it
   shows the agent's change and the typing together. */
export function useHeldWhileTyping(html: string, typing: boolean, saveState: SaveState, reload: () => void): string {
  const held = useRef(html);
  const arrived = useRef(false);
  if (!typing) held.current = html;
  else if (html !== held.current) arrived.current = true;
  useEffect(() => {
    if (saveState === "saved" && arrived.current) {
      arrived.current = false;
      reload();
    }
  }, [saveState, reload]);
  return typing ? held.current : html;
}
