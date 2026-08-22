"use client";

import { useEffect, useState } from "react";
import Q3DCanvasScene from "./Q3DCanvasScene";

/**
 * The scene is imported statically rather than through next/dynamic. It still cannot be
 * server-rendered — @react-three/fiber's Canvas needs a WebGL context and rAF — so it is
 * gated behind a mount flag. The difference is *when the code downloads*: a
 * `dynamic(..., { ssr: false })` chunk is only requested once hydration runs the import,
 * which measured at ~185ms before the ~240kB of three.js even started arriving, and far
 * worse on a slow connection — that gap is the mark visibly popping in after the rest of
 * the page. Importing it statically puts it in the page's bundle graph, so Next preloads
 * it alongside the main chunks and it is already parsed by the time hydration mounts it.
 */
export default function Q3DCanvas({
  scale = 1,
  className = "",
  withBackdrop = false,
}: {
  scale?: number;
  className?: string;
  withBackdrop?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Same box on the server pass and the first client pass, so mounting the scene swaps
  // content into an already-reserved slot instead of shifting the layout around it.
  if (!mounted) return <div className={className} aria-hidden />;

  return <Q3DCanvasScene scale={scale} className={className} withBackdrop={withBackdrop} />;
}
