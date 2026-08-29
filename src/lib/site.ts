/* Where this site lives.
 *
 * Used for canonical URLs, Open Graph and Twitter images, the sitemap and
 * robots.txt — everything that has to be an absolute URL pointing at the real
 * production site.
 *
 * VERCEL_URL is deliberately NOT consulted. It holds the hostname of the
 * individual deployment (v10-a1b2c3-team.vercel.app), not the production alias,
 * so using it made every canonical URL and social image point at an address that
 * changed on each deploy and that nobody should be indexing.
 *
 * Set NEXT_PUBLIC_SITE_URL in the deployment to override — useful for a staging
 * environment that should reference itself.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.quickstark.tech"
).replace(/\/+$/, "");

/* The domain published projects are served from on plans without a custom one.
   Kept beside the site address so the two cannot drift apart. */
export const PUBLISH_SUBDOMAIN = ".quickstark.tech";
