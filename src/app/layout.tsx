import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "./theme";

/* The display face: a geometric grotesque, for the lines that are talking rather than
   working — the landing FAQ, the legal page titles, and the headline on the band at the
   foot of Home. Everything else stays on the system stack. Exposed as a CSS variable and
   mapped to Tailwind's `font-display`, so it is opt-in per section instead of a site-wide
   type change, and adding a fourth caller costs nothing: it is already downloaded. */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

/* The site's own origin. Next needs it to turn the relative image paths below
   into the absolute URLs that Open Graph and Twitter require — without it the
   build warns and falls back to localhost, which would make every shared link
   preview blank. */
const siteUrl = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "QuickStark.Ai | Build Full-Stack Applications Instantly",
    template: "%s | QuickStark.Ai",
  },
  description:
    "Describe your product in plain language and QuickStark.Ai builds it — the interface, the backend, the database and sign-in, live on a URL the same day.",
  applicationName: "QuickStark.Ai",
  keywords: [
    "AI app builder",
    "full-stack app generator",
    "Next.js app builder",
    "build web and mobile apps",
    "AI agents",
  ],
  /* NO `icons` BLOCK, and that absence is the point.
   *
   * Declaring metadata.icons REPLACES Next's file conventions rather than
   * adding to them. This block listed /icon-192.png, /icon-512.png,
   * /apple-icon.png and /favicon.ico from public/, so icon.tsx and
   * apple-icon.tsx were generated on every build, served at their own routes,
   * and linked by nothing — the tab kept showing the old logo and there was no
   * error anywhere to explain it. Two of those paths had by then been deleted,
   * so the browser was also asking for files that were not there.
   *
   * Left off, Next finds icon.tsx and apple-icon.tsx itself and emits the link
   * tags for every size they declare. One drawing, one source, no list here to
   * fall out of step with it. */
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "QuickStark.Ai",
    url: siteUrl,
    title: "QuickStark.Ai | Build Full-Stack Applications Instantly",
    description:
      "Describe your product in plain language and QuickStark.Ai builds it — interface, backend, database and sign-in, live on a URL the same day.",
  },
  twitter: {
    card: "summary_large_image",
    title: "QuickStark.Ai | Build Full-Stack Applications Instantly",
    description:
      "Describe your product in plain language and QuickStark.Ai builds it — interface, backend, database and sign-in, live on a URL the same day.",
  },
  /* A favicon only reaches a search result once the page is indexed. */
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  alternates: { canonical: "/" },
};

/* viewportFit "cover" is what turns env(safe-area-inset-*) into real numbers — without
   it a fixed bottom bar sits under the home indicator. interactiveWidget tells Chrome to
   shrink the layout when the keyboard opens rather than scrolling it; iOS Safari ignores
   it, which is what the VisualViewport listener in globals is for. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  /* The white frame on reload, and the only thing that can remove it.
   *
   * A stylesheet is render-blocking: the browser paints nothing of the document
   * until globals.css has arrived and parsed. But on a RELOAD it has already
   * thrown away the old page's pixels, so something has to be on screen in the
   * meantime — and that something is the compositor's base canvas, chosen
   * before any CSS exists. Undeclared, it is white. `body { background }` cannot
   * help; it is not known yet. An inline <style> cannot help; it is in the
   * document that is not being painted. A loading screen cannot help either —
   * it is markup, and markup is exactly what is blocked. The flash is upstream
   * of everything the page can say about itself.
   *
   * `color-scheme` is the one exception, because the browser reads it while
   * parsing the head, before stylesheets, precisely so it can pick that canvas.
   * Declared dark, the gap is painted near-black instead of white and the step
   * to #050505 at first paint is imperceptible.
   *
   * "dark light" rather than "dark": dark is the default and is listed first,
   * but light stays supported, so a browser whose visitor has chosen the light
   * theme is still allowed to render form controls and scrollbars to match. */
  colorScheme: "dark light",
  /* The mobile browser's own chrome, for the same reason: an undeclared bar is
     painted white above a black page. THEME_BOOT_SCRIPT rewrites this when the
     stored choice is light. */
  themeColor: "#050505",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* suppressHydrationWarning is here for one attribute and one only: the boot
       script below stamps data-theme on this element before React exists, so
       React finds an attribute the server did not send and reports a mismatch.
       It suppresses the warning for this element's own attributes, not for its
       subtree, which is exactly the scope of the discrepancy. */
    <html lang="en" suppressHydrationWarning className={`scroll-smooth ${dmSans.variable}`}>
      <head>
        {/* Before the first paint, and before React exists. A browser set to
            light would otherwise be shown the dark palette for one frame and
            corrected after hydration — the white flash every themed site used to
            have, except here it is a black one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-brandBg text-ink antialiased">
        {children}
      </body>
    </html>
  );
}