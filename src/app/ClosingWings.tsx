import Image from "next/image";

/* The sides of the closing artwork.
 *
 * The picture at /page.jpg is a 1024px square with its wordmark, headline and
 * button painted into it, and the headline spans 90% of that canvas. So the
 * picture itself can never be stretched to fill a wide screen — enlarging it
 * enlarges every letter with it, which is the thing that was asked not to
 * happen. It stays at 1024, exactly as painted.
 *
 * That leaves the page ground showing either side on anything wider, which is
 * the thing that was asked to stop happening. This builds those sides out of
 * the picture itself, so the scene reaches both edges of the screen while the
 * picture in the middle is untouched and unscaled.
 *
 * Two techniques, because the picture has two halves and they need different
 * things.
 *
 * ── Below the button: the picture, reflected ──────────────────────────────
 *
 * Everything from the button's last row down is cloud, sky-glow, grass and a
 * rock — no words anywhere. Reflected outward it is genuinely seamless: the
 * column against the join IS the picture's own edge column, so there is no
 * seam to hide, and clouds and grass have no handedness to give the trick
 * away. Measured on the render, the two columns either side of the join agree
 * to the value at every height.
 *
 * It is a reflection repeated, not a single mirror. A single mirror runs out
 * at 372px a side and then starts dragging the Q mark into frame — measured,
 * that is where the mark's leftmost pixel sits. So the reflection turns around
 * every HALF_PERIOD and folds back, the way a kaleidoscope does. Each fold
 * meets the last on a shared column, so every fold is as invisible as the
 * first, and the mark is never reached however wide the screen is.
 *
 * ── Above it: the sky, continued ──────────────────────────────────────────
 *
 * Reflecting the top would fold the headline back into frame — "on" and
 * "today." appearing again, reversed, out in the margin. So the top is built
 * rather than reflected, out of two measured pieces:
 *
 *   EDGE_*     a one-pixel-wide PNG of the picture's own outermost column, all
 *              1024 rows of it, stretched across the panel. Horizontally flat,
 *              but it carries the real vertical gradient and it meets the
 *              picture on exactly the colour the picture ends on — measured,
 *              every row agrees to the value.
 *
 *   FALLOFF_*  the panel darkened outward until there is nothing left of it.
 *              The left curve is steep on purpose. Matching the picture's own
 *              measured falloff was the first attempt and it was wrong: the
 *              picture's left edge carries a glow, and carried outward at the
 *              rate it actually decays it spread a dusty green haze across the
 *              margin, banded by the row-to-row noise in the column. That haze
 *              is not in the artwork and has no business being invented beside
 *              it. So the light is let go within about 150px and the margin
 *              settles into the dark the sky is already heading for. The right
 *              edge is near-black to begin with and needs almost nothing.
 *
 * The two meet across rows 47%–60%: sky above, reflection below, and nothing
 * to see at the handover because the reflection at the join is the same edge
 * column the sky layer ends on.
 *
 * ── If the artwork is replaced ────────────────────────────────────────────
 *
 * Every number below is a measurement of THIS file and none of them survive a
 * new one. Re-measure, in this order: the lowest row that still has a letter or
 * the button in it (sets HANDOVER), the leftmost pixel of the mark (caps
 * HALF_PERIOD), the outermost column of each side (regenerates EDGE_*), and the
 * horizontal falloff across a text-free strip (regenerates FALLOFF_*). Left as
 * they are against a different picture, the sides will continue a scene that is
 * not there. */

/* How far the reflection runs before it folds back. Under 372, the mark's
   leftmost pixel. */
const HALF_PERIOD = 340;

/* Four folds a side: 1360px of built scenery, which is the panel on a 3700px
   screen. They cost one <img> each, and all nine copies on the section are the
   same URL, so it stays one download and one decode. */
const FOLDS = [0, 1, 2, 3];

/* The outermost column of each side, 1 x 1024. Inline, so it is never a second
   request and can never arrive after the picture it is continuing. */
const EDGE_LEFT = "data:image/png;base64,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";
const EDGE_RIGHT = "data:image/png;base64,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";

/* The measured falloff, in pixels out from the join rather than in percentages
   of the panel — the light in the picture falls away over a fixed distance, not
   over a share of whatever screen this happens to be. */
const FALLOFF_LEFT =
  "linear-gradient(to left,rgba(0,0,0,0) 0px,rgba(0,0,0,0.40) 30px,rgba(0,0,0,0.65) 70px," +
  "rgba(0,0,0,0.80) 110px,rgba(0,0,0,0.88) 160px,rgba(0,0,0,0.93) 230px,rgba(0,0,0,0.96) 340px," +
  "rgba(0,0,0,0.97) 600px)";
const FALLOFF_RIGHT =
  "linear-gradient(to right,rgba(0,0,0,0) 0px,rgba(0,0,0,0.05) 120px,rgba(0,0,0,0.09) 260px," +
  "rgba(0,0,0,0.12) 420px,rgba(0,0,0,0.14) 700px)";

/* Where the built sky hands over to the reflection. Below 47% of the picture
   there is nothing left but the button's last rows, and by 60% the reflection
   is safely into cloud. */
const HANDOVER = "linear-gradient(180deg,#000 0 47%,transparent 60%)";

/* Half the picture's own width: the panel starts where the picture ends. */
const HALF_PICTURE = "calc(50% + 512px)";

export default function ClosingWings({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";

  return (
    <div
      aria-hidden
      /* Hidden below 1024, where there is no panel to fill: the picture already
         spans the screen there. */
      className="pointer-events-none absolute inset-y-0 hidden overflow-hidden lg:block"
      style={isLeft ? { left: 0, right: HALF_PICTURE } : { right: 0, left: HALF_PICTURE }}
    >
      {FOLDS.map((fold) => (
        <div
          key={fold}
          className="absolute inset-y-0 overflow-hidden"
          style={
            isLeft
              ? { width: HALF_PERIOD, right: fold * HALF_PERIOD }
              : { width: HALF_PERIOD, left: fold * HALF_PERIOD }
          }
        >
          {/* object-cover on a square source in a square-tall box is a 1:1 crop,
              so object-left / object-right pick out the picture's own outermost
              340 columns at their painted size. Every other fold is flipped,
              which is what makes consecutive folds meet on a shared column. */}
          <Image
            src="/page.jpg"
            alt=""
            fill
            /* The same sizes as the picture itself, so the browser resolves all
               nine copies to one file and fetches it once. */
            sizes="(min-width: 1024px) 1024px, 100vw"
            className={[
              "object-cover",
              isLeft ? "object-left" : "object-right",
              fold % 2 === 0 ? "-scale-x-100" : "",
            ].join(" ")}
            loading="eager"
          />
        </div>
      ))}

      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `${isLeft ? FALLOFF_LEFT : FALLOFF_RIGHT}, url("${
            isLeft ? EDGE_LEFT : EDGE_RIGHT
          }")`,
          backgroundRepeat: "no-repeat",
          /* The falloff sizes itself; the column stretches to fill the panel. */
          backgroundSize: "auto, 100% 100%",
          WebkitMaskImage: HANDOVER,
          maskImage: HANDOVER,
        }}
      />
    </div>
  );
}
