import type { Metadata } from "next";
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