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

/* ── THE APP'S OWN ROUTES ───────────────────────────────────────────────────
 *
 * A published project is served at quickstark.tech/<slug>, which puts it in the
 * SAME namespace as every page this app has. Next resolves a static route ahead
 * of a dynamic one, so /dashboard will always be the dashboard — which means a
 * project published as "dashboard" would silently show the app instead of the
 * site, with nothing anywhere reporting a problem.
 *
 * So these are refused at publish time. Anything added to src/app/ at the top
 * level MUST be added here in the same edit, and that is the standing cost of
 * dropping the /s/ prefix: this list and the router have to agree forever.
 * check-publish.mjs compares the two and fails when they drift. */
const APP_ROUTES = [
  "api", "auth", "dashboard", "preview", "pricing", "privacy", "terms", "site",
  /* Files and generated documents Next serves from the root. */
  "favicon", "robots", "sitemap", "manifest",
  "opengraph-image", "twitter-image", "apple-icon", "icon",
  /* Kept although nothing serves it now: projects published while addresses
     were /s/<slug> may still be linked that way, and nothing may take it. */
  "s",
];

/* Names that must never become a project's address, because the platform
   answers on them itself or will need to. A project called "API" taking
   /api would take it from us, and there would be no way to get it back
   without breaking their site. */
const RESERVED = new Set([
  "www", "app", "api", "admin", "dashboard", "preview", "staging", "test",
  "mail", "email", "smtp", "imap", "ftp", "cdn", "assets", "static", "img",
  "images", "media", "files", "download", "downloads", "docs", "help",
  "support", "status", "blog", "news", "about", "billing", "pay", "payments",
  "checkout", "account", "accounts", "auth", "login", "logout", "signup",
  "register", "settings", "console", "internal", "system", "root", "ns1",
  "sites",
  "ns2", "dns", "vpn", "proxy", "webhook", "webhooks", "quickstark",
  ...APP_ROUTES,
]);

/** Exposed so a check can compare this against what src/app actually holds. */
export const RESERVED_APP_ROUTES = APP_ROUTES;

/* A DNS label: 63 characters, letters digits and hyphens, not starting or
   ending with one. Kept shorter than the limit — nobody types a 63-character
   subdomain, and the suffix has to fit beside it. */
const MAX_SLUG = 40;

/* The label a name reduces to, before any judgement about whether it may be
   used. Separated from slugFrom because addressFor needs to know the difference
   between "this name is unusable" and "this name is empty" — a name with no
   letters in it has nothing to qualify, and qualifying it produced an address
   of just "site". */
function labelFrom(name: string): string {
  return name
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
}

/** A project name as a hostname label, or null if it cannot make one. */
export function slugFrom(name: string): string | null {
  const slug = labelFrom(name);

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
 * A readable address for a project, trying harder than the name alone.
 *
 * The name is not always usable: it can be reserved, too short, or all digits.
 * The first version fell straight from there to `site-<8 hex>`, which is what a
 * project called "QuickStark" got — "quickstark" is reserved, so its address
 * became site-8975e2ca.quickstark.tech. Correct, permanent, and not an address
 * anybody would put on a business card.
 *
 * So a reserved or unusable name is qualified rather than abandoned:
 * "quickstark-app" is still recognisably theirs and takes nothing from the
 * platform. The hex remains only for a name with no letters in it at all,
 * where there is genuinely nothing to build on.
 */
export function addressFor(name: string, projectId: string): string | null {
  const stem = labelFrom(name);

  /* Nothing to build on. Qualifying an empty stem gave the qualifier by
     itself — a project called "!!!" published to site.quickstark.tech, which is
     both meaningless and the address every such project would fight over. */
  if (!stem) return slugFrom(`site-${projectId.slice(0, 8)}`);

  return (
    slugFrom(stem) ??
    slugFrom(`${stem} app`) ??
    slugFrom(`${stem} site`) ??
    slugFrom(`site-${projectId.slice(0, 8)}`)
  );
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

/* Where a published project is served.
 *
 * A PATH, not a subdomain. shop.quickstark.tech is the nicer address and it
 * needs two things this cannot assume: a wildcard DNS record, and a wildcard
 * domain on the Vercel project. The first fails silently — a publish succeeds,
 * takes the credits and hands back a hostname that does not resolve, which is
 * exactly what happened — and the second has historically needed a paid plan.
 *
 * This works the moment the code is deployed, on any plan, with no DNS. The
 * slug still has to be a legal label, so nothing here forecloses moving to
 * subdomains later: the same slugs would work unchanged.
 *
 * There is no /s/ prefix, which buys a shorter address and costs a permanent
 * obligation: published slugs and this app's own routes share one namespace.
 * See APP_ROUTES above — that list and src/app/ have to agree forever. */
export function publishedUrl(slug: string): string {
  return `${SITE_URL}/${slug}`;
}

/** The same address without its scheme, for showing rather than linking. */
export function publishedLabel(slug: string): string {
  return publishedUrl(slug).replace(/^https?:\/\//, "");
}

/* The same address with the half every project shares taken off, for a row
 * narrow enough that the whole thing does not fit.
 *
 * "www.quickstark.tech/peckham-sourdough" is thirty-seven characters and the
 * first twenty are identical on every project a person owns. In a 130px column
 * that is exactly backwards: the shared half is what survives the truncation
 * and the only half that identifies the site is what gets cut, so the row ends
 * up reading "www.quickstark.tec…" on every line. This drops the shared half
 * instead and keeps the part that differs.
 *
 * Derived from the address rather than written out, so this cannot describe a
 * shape publishedUrl no longer produces. */
export function publishedShortLabel(slug: string): string {
  const label = publishedLabel(slug);
  const slash = label.indexOf("/");
  /* An address with no path — a subdomain, were this ever to move to them —
     has no shared half to drop and is already as short as it gets. */
  return slash === -1 ? label : label.slice(slash);
}

/* Where a project is worked on. Owner-only, and never public.
 *
 * Two shapes, and the first is what a project gets as soon as it has a name:
 *
 *   /quickstark-app/preview      once a slug is reserved
 *   /preview/<uuid>              before that, and forever after
 *
 * The second is not a fallback to be tidied away later. It is what every link
 * already written points at — the download links, the chat's own chips, the
 * preview_url stored on older rows — and it keeps working. The first is simply
 * shorter, readable, and the same name the published site will answer on, so
 * publishing moves nothing. */
export function previewUrl(project: { id: string; slug?: string | null }): string {
  return project.slug
    ? `${SITE_URL}/${project.slug}/preview`
    : `${SITE_URL}/preview/${project.id}`;
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
