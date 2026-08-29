import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/* A favicon only appears beside a search result once the page has been indexed,
   so crawlability is part of getting the mark into Google. The signed-in app and
   the auth callback are excluded — they are per-account pages with nothing to
   rank, and the callback carries one-time codes in its query string. */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = SITE_URL;

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/auth/", "/api/"] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
