import { brandIcon } from "./brand-icon";

/* Every raster size of the mark, from one drawing.
 *
 * Three rather than one, and each is a size something actually asks for:
 *
 *   64   the browser tab. Browsers want 16 and 32 and downscale whatever they
 *        are given; 64 halved twice stays crisp where 32 halved once softens.
 *   192  what Chrome and Google's search results prefer (Google asks for a
 *        square that is a multiple of 48).
 *   512  an installed app's icon, and the largest anything asks for.
 *
 * They were three checked-in PNGs in public/, made once at one size and
 * resampled. Generated per size, the ring is drawn 3px thick in the tab and
 * 24px thick on the install icon rather than blurred into it.
 *
 * The ids are stable and chosen here, so /icon/192 and /icon/512 are addresses
 * the web manifest can name. See manifest.ts, which does. */

export function generateImageMetadata() {
  return [
    { id: "tab", size: { width: 64, height: 64 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default function Icon({ id }: { id: string }) {
  return brandIcon(id === "512" ? 512 : id === "192" ? 192 : 64);
}
