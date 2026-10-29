import type { ReactNode } from "react";

import Q3DCanvas from "./Q3DCanvas";

/* The screens shown instead of a page: loading, an error, a missing route.
 *
 * The mark is the landing page's own: Q3DCanvas, which paints the flat QMark
 * with the first bytes of HTML — before React or three.js exist — and fades
 * the spinning 3D mark in over it once it has drawn. So a loading screen is
 * never blank, and it is the same logo somebody saw on the way in. Dark like
 * the app. The rest of the motion lives in globals.css (.qs-status-*). */

/** Full-screen loading: the spinning mark, and a thin bar along the top. */
export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="qs-status-in fixed inset-0 z-[100] flex items-center justify-center bg-brandBg">
      <div aria-hidden className="qs-status-bar" />
      <Q3DCanvas scale={1.1} spinDirection={-1} className="h-20 w-20" />
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
        <Q3DCanvas scale={1.1} spinDirection={-1} className="h-20 w-20" />
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
