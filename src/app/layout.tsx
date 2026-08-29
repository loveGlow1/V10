import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

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
   preview blank. Set NEXT_PUBLIC_SITE_URL in the deployment to a custom domain;
   Vercel supplies VERCEL_URL for previews. */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://v10-eight-jet.vercel.app");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Quickstark.Ai | Build Full-Stack Applications Instantly",
    template: "%s | Quickstark.Ai",
  },
  description:
    "Describe your product in plain language and Quickstark.Ai builds it — the interface, the backend, the database and sign-in, live on a URL the same day.",
  applicationName: "Quickstark.Ai",
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
    siteName: "Quickstark.Ai",
    url: siteUrl,
    title: "Quickstark.Ai | Build Full-Stack Applications Instantly",
    description:
      "Describe your product in plain language and Quickstark.Ai builds it — interface, backend, database and sign-in, live on a URL the same day.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quickstark.Ai | Build Full-Stack Applications Instantly",
    description:
      "Describe your product in plain language and Quickstark.Ai builds it — interface, backend, database and sign-in, live on a URL the same day.",
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
    <html lang="en" className={`scroll-smooth ${dmSans.variable}`}>
      <body className="bg-brandBg text-white antialiased">
        {children}
      </body>
    </html>
  );
}