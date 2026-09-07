import { PUBLISH_SUBDOMAIN, SITE_URL } from "@/lib/site";

/* Addresses: what a project is called once it is public.
 *
 * Two rules run through everything here, and both are about what a hostname
 * IS rather than what looks tidy.
 *
 * A SLUG IS GLOBAL. "shop" can belong to one project on the whole platform,
 * because shop.quickstark.tech resolves to one thing. That is unlike every
 * other name in this product — two people may both call a project "Shop" — so
 * the slug is derived from the name and then made unique, and the uniqueness
 * is settled by the database rather than by hoping.
 *
 * A HOSTNAME IS NOT A STRING. Everything below refuses rather than repairs
 * where a repair would change which address somebody gets. A slug that cleans
 * up to nothing is a slug this cannot make, not one to invent silently. */

/* Names that must never become a project's address, because the platform
   answers on them itself or will need to. A project called "API" taking
   api.quickstark.tech would take it from us, and there would be no way to get
   it back without breaking their site. */
const RESERVED = new Set([
  "www", "app", "api", "admin", "dashboard", "preview", "staging", "test",
  "mail", "email", "smtp", "imap", "ftp", "cdn", "assets", "static", "img",
  "images", "media", "files", "download", "downloads", "docs", "help",
  "support", "status", "blog", "news", "about", "billing", "pay", "payments",
  "checkout", "account", "accounts", "auth", "login", "logout", "signup",
  "register", "settings", "console", "internal", "system", "root", "ns1",
  "ns2", "dns", "vpn", "proxy", "webhook", "webhooks", "quickstark",
]);

/* A DNS label: 63 characters, letters digits and hyphens, not starting or
   ending with one. Kept shorter than the limit — nobody types a 63-character
   subdomain, and the suffix has to fit beside it. */
const MAX_SLUG = 40;

/** A project name as a hostname label, or null if it cannot make one. */
export function slugFrom(name: string): string | null {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    /* Accents dropped rather than encoded. "café" becoming "cafe" is the
       address somebody expects; punycode is not. */
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    /* Sliced before this, so a cut that lands on a hyphen is tidied after. */
    .replace(/-+$/g, "");

  if (slug.length < 3) return null;
  if (RESERVED.has(slug)) return null;
  /* All digits would be a valid label and a confusing address, and it reads as
     an id rather than a name. */
  if (/^\d+$/.test(slug)) return null;
  return slug;
}

/** Whether a slug somebody chose themselves may be used. */
export function slugIsUsable(slug: string): boolean {
  return slugFrom(slug) === slug;
}

/**
 * The next candidate when a slug is taken.
 *
 * Numbered rather than randomised: "shop-2" is somebody else already having
 * "shop", which is understandable, where "shop-x7f2" reads as a fault. The
 * caller walks these until the database accepts one — the unique index is what
 * actually settles it, because two people can publish in the same second.
 */
export function slugAttempt(base: string, attempt: number): string {
  if (attempt === 0) return base;
  const suffix = `-${attempt + 1}`;
  return `${base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/** Where a published project is served. */
export function publishedUrl(slug: string): string {
  return `https://${slug}${PUBLISH_SUBDOMAIN}`;
}

/** Where an unpublished project is worked on. Owner-only, and never public. */
export function previewUrl(projectId: string): string {
  return `${SITE_URL}/preview/${projectId}`;
}

/* ── Custom domains ────────────────────────────────────────────────────────
 *
 * What arrives from the box is whatever somebody pasted: a full URL, a
 * trailing slash, capitals, a space at the end, occasionally "https://www.
 * customer.com/home". All of that is the same domain and all of it is normal
 * to type. What is NOT repaired is anything that changes which domain it is. */

export type DomainProblem =
  | "empty"
  | "not-a-domain"
  | "no-tld"
  | "ours"
  | "too-long";

/** A domain as it should be stored, or why it cannot be. */
export function normaliseDomain(input: string): { domain: string } | { problem: DomainProblem } {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return { problem: "empty" };

  /* Scheme, path, query, port and userinfo removed — every one of them is
     something a person pastes and none of them is part of the hostname. */
  const host = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]*@/, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .split(":")[0]
    .replace(/\.+$/, "");

  if (!host) return { problem: "not-a-domain" };
  if (host.length > 253) return { problem: "too-long" };

  /* Checked before the shape, so the reason given is the true one. "not a
     domain" has no dot in it, and reporting that as a missing ending sends
     somebody off to add ".com" to a sentence. */
  if (!/^[a-z0-9.-]+$/.test(host)) return { problem: "not-a-domain" };

  const labels = host.split(".");
  if (labels.length < 2) return { problem: "no-tld" };

  for (const label of labels) {
    if (!label || label.length > 63) return { problem: "not-a-domain" };
    if (!/^[a-z0-9-]+$/.test(label)) return { problem: "not-a-domain" };
    if (label.startsWith("-") || label.endsWith("-")) return { problem: "not-a-domain" };
  }

  /* The last label must look like a TLD rather than a number — "192.168.1.1"
     parses as labels and is not a domain anybody can point at us. */
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return { problem: "no-tld" };

  /* Our own domain, which somebody will try — either by mistake or to take a
     subdomain that is not theirs. Publishing already gives them one of those;
     this path is for domains they own. */
  const ours = PUBLISH_SUBDOMAIN.replace(/^\./, "");
  if (host === ours || host.endsWith(`.${ours}`)) return { problem: "ours" };

  return { domain: host };
}

/** What to tell somebody whose domain was refused. */
export const DOMAIN_PROBLEM: Record<DomainProblem, string> = {
  empty: "Enter the domain you want to use, like www.yourcompany.com.",
  "not-a-domain": "That doesn't look like a domain. Enter it like www.yourcompany.com.",
  "no-tld": "That's missing the ending — enter the whole domain, like www.yourcompany.com.",
  ours: "That's a QuickStark address, and your project already has one. This is for a domain you own.",
  "too-long": "That domain is too long to be a real one.",
};

/**
 * Whether a domain needs a CNAME or an A record, which is not a preference.
 *
 * A CNAME cannot legally sit on the apex of a zone — "customer.com" itself —
 * because the apex already carries SOA and NS records and CNAME may not
 * coexist with anything. So an apex domain takes an A record and a subdomain
 * takes a CNAME. Providers that offer "CNAME flattening" hide this; most do
 * not, and telling somebody to add a CNAME at the apex sends them to a form
 * that will refuse it with no explanation.
 *
 * The VALUES still come from Vercel — see vercel-domains.ts. This decides only
 * which shape of record to ask for.
 */
export function isApex(domain: string): boolean {
  /* Two labels is an apex: customer.com. Three or more is a subdomain, with
     the exception of the multi-part public suffixes people actually use. */
  const labels = domain.split(".");
  if (labels.length <= 2) return true;

  const lastTwo = labels.slice(-2).join(".");
  const MULTI_PART = new Set([
    "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "com.au", "net.au",
    "org.au", "co.nz", "co.za", "com.br", "com.mx", "co.jp", "co.in",
    "co.kr", "com.sg", "com.tr", "com.ar",
  ]);
  return labels.length === 3 && MULTI_PART.has(lastTwo);
}

/** The name half of the DNS record, as it is typed into a provider's form. */
export function recordName(domain: string): string {
  /* Providers ask for the label, not the whole hostname: "www", or "@" for the
     apex. Typing the full domain into that box is the commonest way for this to
     silently not work — it creates www.customer.com.customer.com. */
  if (isApex(domain)) return "@";
  const labels = domain.split(".");
  const rest = isApex(labels.slice(1).join(".")) ? 1 : labels.length - 2;
  return labels.slice(0, rest).join(".");
}
