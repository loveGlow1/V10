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

export const metadata: Metadata = {
  title: "QuickStart.Ai | Build Full-Stack Applications Instantly",
  description: "Autonomous high-velocity AI system builder for web and mobile software ecosystems.",
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