import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/* The pages a stranger can actually open. The dashboard is behind sign-in, so it
   is deliberately absent. */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = SITE_URL;
  const lastModified = new Date();

  return [
    { url: siteUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];
}
