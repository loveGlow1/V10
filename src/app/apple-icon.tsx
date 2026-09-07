import { brandIcon } from "./brand-icon";

/* The home-screen icon. Apple's size, and the one place the mark is large
   enough for the ground's gradient and the stars to read as anything. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIcon(size.width);
}
