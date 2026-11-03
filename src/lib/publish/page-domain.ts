import { PUBLISH_SUBDOMAIN } from "@/lib/site";

import { attachProjectDomain, vercelCredentials } from "./vercel-deploy";

/* A published PAGE's address, attached to the platform's own Vercel project.
 *
 * A page is served by this app (routing.ts reads the slug out of the host), so
 * `<slug>.quickstark.tech` has to reach THIS deployment with a certificate for
 * that exact name. A wildcard would cover every slug at once — but Vercel only
 * issues a wildcard certificate when it runs the domain's DNS, and
 * quickstark.tech's DNS is at another registrar. Without this, every page
 * published after the move answered with a TLS reset: the DNS resolved, the
 * certificate did not exist, and the link "did not work".
 *
 * So each address is attached on its own, which Vercel can certify over plain
 * HTTP through the CNAME that is already there. Idempotent (a republish finds
 * it attached) and best effort: a refusal is logged, never allowed to undo a
 * publish that has already happened. */
export function pageHostFor(slug: string): string {
  const suffix = PUBLISH_SUBDOMAIN.startsWith(".") ? PUBLISH_SUBDOMAIN : `.${PUBLISH_SUBDOMAIN}`;
  return `${slug}${suffix}`.toLowerCase();
}

export async function attachPageDomain(slug: string): Promise<{ ok: boolean; reason?: string }> {
  const platform = process.env.VERCEL_PROJECT_ID;
  const creds = vercelCredentials();
  if (!platform || !creds) return { ok: false, reason: "VERCEL_API_TOKEN or VERCEL_PROJECT_ID is not set" };
  try {
    const bound = await attachProjectDomain(platform, pageHostFor(slug), creds);
    if (!bound.ok) {
      // eslint-disable-next-line no-console
      console.warn(`publish: ${pageHostFor(slug)} could not be attached: ${bound.reason}`);
      return { ok: false, reason: bound.reason };
    }
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("publish: attaching the page address failed:", error);
    return { ok: false, reason: "Vercel could not be reached" };
  }
}
