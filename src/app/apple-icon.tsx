import { brandIcon } from "./brand-icon";

/* The home-screen icon, at Apple's size and from the same drawing as the tab's.
   The gradient and stars this note once promised went with the flat ground; what
   makes it read on a home screen is the tile's own contrast, not depth. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIcon(size.width);
}
