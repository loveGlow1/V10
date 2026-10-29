import type { ReactNode } from "react";

/* The screens shown instead of a page: loading, an error, a missing route.
 *
 * Markup and CSS only — no hooks, no script — so a loading screen paints with
 * the first bytes of HTML, before React exists, and an error screen still
 * draws when the thing that failed was the JavaScript. Dark like the app (the
 * canvas, not white), with the mark in the middle and nothing that pops in
 * later. The motion lives in globals.css (.qs-status-*), and stands still for
 * anyone who has asked for less of it. */

/* The Q: ring and tail, from the same numbers as QMark.tsx and brand-icon.tsx
   (ring radii 2.0 / 1.35, tail 0.55 → 2.75 on the diagonal, 0.8 thick). */
const RING_MID = (2.0 + 1.35) / 2;
const RING_WIDTH = 2.0 - 1.35;
const D = Math.SQRT1_2;

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="-2.4 -2.4 5.2 5.2" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor">
        <circle cx="0" cy="0" r={RING_MID} strokeWidth={RING_WIDTH} />
        <line x1={0.55 * D} y1={0.55 * D} x2={2.75 * D} y2={2.75 * D} strokeWidth={0.8} />
      </g>
    </svg>
  );
}

/** Full-screen loading: the mark, breathing, and a thin bar along the top. */
export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="qs-status-in fixed inset-0 z-[100] flex items-center justify-center bg-brandBg">
      <div aria-hidden className="qs-status-bar" />
      <BrandMark className="qs-status-mark h-11 w-11 text-ink/80" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** A full-screen message: an error, a missing page. */
export function MessageScreen({
  title,
  body,
  actions,
  detail,
}: {
  title: string;
  body: string;
  actions: ReactNode;
  detail?: string | null;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-brandBg px-6 py-16 text-ink">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line/[0.08] bg-layer/[0.04]">
          <BrandMark className="h-7 w-7 text-ink/80" />
        </span>
        <h1 className="mt-6 text-[20px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
        <div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">{actions}</div>
        {detail ? <p className="mt-6 font-mono text-[11px] text-muted/70">Reference: {detail}</p> : null}
      </div>
    </main>
  );
}

export const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-xl bg-solid px-5 text-[15px] font-medium text-onSolid transition-colors hover:bg-layer/90 sm:h-10 sm:text-[14px]";
export const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-xl border border-line/[0.1] px-5 text-[15px] text-soft transition-colors hover:bg-layer/[0.06] hover:text-ink sm:h-10 sm:text-[14px]";
