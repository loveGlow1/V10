"use client";

import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import ActionRow, { type ActionState } from "./ActionRow";

/* A screenshot the agent took: "Took a screenshot", with a 120px thumbnail
   under it — before and after side by side when there is a before. Tap for
   the full picture, which pinches and wheels to zoom and drags to pan. */
export default function SnapshotPart({
  state,
  url,
  before,
  label,
  error,
}: {
  state: ActionState;
  url?: string;
  before?: string;
  label?: string;
  error?: string;
}) {
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <ActionRow kind="snapshot" verb={state === "running" ? "Taking a screenshot" : "Took a screenshot"} state={state} detail={state === "error" ? error : undefined}>
      {url && (
        <div className="mb-2 mt-1 flex max-w-full gap-2 overflow-x-auto">
          {before && (
            <Thumb src={before} caption="Before" onOpen={() => setViewing(before)} />
          )}
          <Thumb src={url} caption={before ? "After" : undefined} label={label} onOpen={() => setViewing(url)} />
        </div>
      )}
      {viewing && <Viewer src={viewing} onClose={() => setViewing(null)} />}
    </ActionRow>
  );
}

function Thumb({ src, caption, label, onOpen }: { src: string; caption?: string; label?: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="shrink-0 text-left" aria-label={`Open ${caption ?? label ?? "screenshot"} full screen`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL; nothing to optimise */}
      <img
        src={src}
        alt={label ?? "Screenshot of the page"}
        loading="lazy"
        className="h-[120px] w-auto max-w-[260px] rounded-lg border border-zinc-200 bg-zinc-100 object-cover object-top dark:border-zinc-800 dark:bg-zinc-900"
      />
      {caption && <span className="mt-1 block text-[11.5px] text-zinc-500 dark:text-zinc-400">{caption}</span>}
    </button>
  );
}

/* Full screen, with zoom: two fingers pinch, a wheel or trackpad zooms, one
   finger or the mouse pans once zoomed in, a double tap resets. Escape, the
   close button or a tap on the dark backdrop closes. */
function Viewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const clamp = (scale: number) => Math.min(6, Math.max(1, scale));
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-black/90"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onWheel={(event) => setView((v) => ({ ...v, scale: clamp(v.scale * (event.deltaY < 0 ? 1.12 : 0.89)) }))}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        style={{ top: "max(12px, env(safe-area-inset-top))" }}
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL */}
      <img
        src={src}
        alt="Screenshot, full size"
        draggable={false}
        className="max-h-full max-w-full touch-none select-none object-contain"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: pointers.current.size ? "none" : "transform 120ms ease-out" }}
        onPointerDown={(event) => {
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) pinch.current = { distance: distance(), scale: view.scale };
          const now = Date.now();
          if (pointers.current.size === 1 && now - lastTap.current < 300) setView({ scale: 1, x: 0, y: 0 });
          lastTap.current = now;
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2 && pinch.current) {
            const scale = clamp(pinch.current.scale * (distance() / pinch.current.distance));
            setView((v) => ({ ...v, scale }));
          } else if (pointers.current.size === 1) {
            setView((v) => (v.scale > 1 ? { ...v, x: v.x + event.clientX - previous.x, y: v.y + event.clientY - previous.y } : v));
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          setView((v) => (v.scale <= 1 ? { scale: 1, x: 0, y: 0 } : v));
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current = null;
        }}
      />
    </div>
  );
}
