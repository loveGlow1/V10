"use client";

import dynamic from "next/dynamic";

// @react-three/fiber's Canvas relies on browser-only APIs (WebGL context,
// requestAnimationFrame, etc.) and cannot be rendered during SSR/prerendering,
// so the actual scene is loaded client-side only.
// loading={eager} ensures the scene starts rendering immediately upon hydration
// rather than being deferred, eliminating the 2-second appearance delay.
const Q3DCanvasScene = dynamic(() => import("./Q3DCanvasScene"), { ssr: false, loading: () => null });

export default function Q3DCanvas({
  scale = 1,
  className = "",
  withBackdrop = false,
}: {
  scale?: number;
  className?: string;
  withBackdrop?: boolean;
}) {
  return <Q3DCanvasScene scale={scale} className={className} withBackdrop={withBackdrop} />;
}
