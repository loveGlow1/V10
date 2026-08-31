import Image from "next/image";

/* The rendered mark, as an image.
 *
 * QMark next door is the same logo drawn as vector strokes, and it is still the
 * right thing on the hero — it paints with the first paint and cross-fades into
 * the three.js one. This is the finished render: the bevelled glass, the key
 * light along the upper ring, the green catch in the shoulder. None of that is
 * reproducible in two stroked paths, and in the workspace there is no 3D mark
 * arriving later for a flat one to stand in for.
 *
 * The file is cropped on the ring's own centre rather than on its bounding box.
 * That is what lets it spin: centred on the box, the tail's weight would pull
 * the axis off and the ring would orbit instead of turn. Its alpha falls away
 * radially at the rim, so there is no square to reveal as it goes round and no
 * background it has to match.
 *
 * 256px for a mark drawn at most at 30 — eight times over at a 32px render,
 * which is past any device pixel ratio. Larger was 275KB to look identical. */
export default function QLogo({
  size,
  spin = false,
  className = "",
}: {
  /** Rendered edge length in CSS pixels. */
  size: number;
  /** Turns once every twelve seconds. See .mark-drift in globals.css. */
  spin?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/quickstark-mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      /* Decorative in both places it appears — the words beside it already name
         the brand, so a screen reader announcing it would say it twice. */
      draggable={false}
      className={`shrink-0 select-none ${spin ? "mark-drift" : ""} ${className}`}
    />
  );
}
