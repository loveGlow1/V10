import type { MetadataRoute } from "next";

/* The pages a stranger can actually open. The dashboard is behind sign-in, so it
   is deliberately absent. */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://v10-eight-jet.vercel.app");
  const lastModified = new Date();

  return [
    { url: siteUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];
}
