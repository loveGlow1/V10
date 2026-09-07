import { brandIcon } from "./brand-icon";

/* The tab icon. See brand-icon.tsx for the geometry and why it is generated
   rather than checked in.
 *
 * 64 rather than 32: browsers ask for 16 and 32 and downscale whatever they
 * are given, and a 64 halved twice stays crisp where a 32 halved once already
 * softens the ring. */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return brandIcon(size.width);
}
