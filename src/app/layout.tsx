import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "./theme";

/* The FAQ is set in a geometric grotesque rather than the system stack the rest of the
   page uses. Exposed as a CSS variable and mapped to Tailwind's `font-display`, so it is
   opt-in per section instead of a site-wide type change. */
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
  /* Explicit rather than left to file-convention discovery alone: the .ico
     covers older browsers and the /favicon.ico path crawlers still probe, the
     192px PNG is what Chrome and Google's search results prefer (Google asks for
     a square that is a multiple of 48), and the Apple icon is what iOS uses when
     the site is added to a home screen. */
  icons: {
    /* favicon.ico is not listed here: src/app/favicon.ico is a file convention
       and Next emits its own link for it, so declaring it again only duplicates
       the tag. */
    icon: [
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"],
  },
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