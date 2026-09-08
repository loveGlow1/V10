import type { MetadataRoute } from "next";

/* Chrome on Android reads this when the site is installed or added to a home
   screen; without it the icon there falls back to a screenshot of the page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QuickStark.Ai",
    short_name: "QuickStark.Ai",
    description:
      "Build full-stack web and mobile apps in minutes — interface, backend, database and sign-in from one description.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      /* Generated from the brand mark rather than checked in — see icon.tsx,
         which owns these ids. Two files in public/ held a resampled copy of an
         older logo and were the reason the installed icon and the tab icon
         could disagree. */
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
