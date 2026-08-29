import type { MetadataRoute } from "next";

/* Chrome on Android reads this when the site is installed or added to a home
   screen; without it the icon there falls back to a screenshot of the page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QuickStart.Ai",
    short_name: "QuickStart.Ai",
    description:
      "Build full-stack web and mobile apps in minutes — interface, backend, database and sign-in from one description.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
