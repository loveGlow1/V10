#!/usr/bin/env node
/* An address means one thing, and it is never the wrong thing.
 *
 *   npm run check:publish
 *
 * Publishing turns one deployment into three kinds of website: the app itself,
 * somebody's published project on a subdomain, and somebody's own domain. One
 * function decides which, from the hostname, and everything downstream trusts
 * it completely.
 *
 * So the failures here are not cosmetic. Getting it wrong in one direction
 * serves a 404 where a customer's homepage should be. Getting it wrong in the
 * other serves THIS APP — the dashboard, the API, the session cookie — on a
 * hostname we do not control, or serves one customer's site on another's
 * address. There is no error message for either; they simply work, wrongly.
 *
 * Two halves, as everywhere in this codebase:
 *
 *   THE APP'S OWN ADDRESSES must always resolve to the app. If any of these
 *   ever comes back as a customer site, the dashboard has gone missing.
 *
 *   EVERYTHING ELSE must resolve to a site, and to the RIGHT one.
 *
 * No keys, no network: naming and routing are pure.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-publish");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true,
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/publish/naming.ts"),
      join(process.cwd(), "src/lib/publish/routing.ts"),
    ],
  }),
);

execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

const rewrite = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { rewrite(path); continue; }
    if (!path.endsWith(".js")) continue;
    const depth = path.slice(out.length + 1).split("/").length - 1;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    writeFileSync(path, readFileSync(path, "utf8").replace(
      /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
        const asFile = join(out, `${rest}.js`);
        const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
        return `${q}${prefix}${target}${q}`;
      }));
  }
};
rewrite(out);

const { addressFor, isApex, normaliseDomain, publishedLabel, publishedUrl, recordName, slugAttempt, slugFrom, slugIsUsable } =
  await import(join(out, "lib/publish/naming.js"));
const { isAppPath, routeFor } = await import(join(out, "lib/publish/routing.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

// ── The app's own addresses ───────────────────────────────────────────────
/* Every one of these must be the app. A customer site answering on any of them
   is the dashboard gone. */
for (const host of [
  "www.quickstark.tech",
  "quickstark.tech",
  "WWW.QUICKSTARK.TECH",
  "www.quickstark.tech:443",
  "localhost:3000",
  "127.0.0.1:3000",
  /* Every deployment gets one of these. Serving a customer site here would take
     the dashboard away from an address people genuinely use. */
  "v10-git-main-loveglow1.vercel.app",
  "v10-a1b2c3.vercel.app",
]) {
  has(routeFor(host).kind === "app", `the app answers on ${host}`, routeFor(host).kind);
}

/* No host at all — a malformed request, or a runtime that did not set one.
   The app is the safe answer: it 404s, where guessing a site would not. */
has(routeFor(null).kind === "app", "a missing host is the app, not a site");
has(routeFor("").kind === "app", "and so is an empty one");

// ── A published project ───────────────────────────────────────────────────
has(routeFor("shop.quickstark.tech").kind === "slug", "a subdomain is a published project");
has(routeFor("shop.quickstark.tech").slug === "shop", "and it is the right one", routeFor("shop.quickstark.tech").slug);
has(routeFor("SHOP.QuickStark.tech").slug === "shop", "however it was capitalised");
has(routeFor("shop.quickstark.tech:8080").slug === "shop", "and whatever port it arrived on");
/* A trailing dot is a legal fully-qualified name and a real way to arrive. */
has(routeFor("shop.quickstark.tech.").slug === "shop", "and with a trailing dot");

/* Two labels deep is not an address this issues. Treating it as the project
   "a.b" would be inventing a site; treating it as "b" would serve one project
   at another's address, which is worse. */
has(routeFor("a.b.quickstark.tech").kind === "app", "a two-label subdomain is not a project", routeFor("a.b.quickstark.tech").kind);

/* THE ONE THAT MATTERS MOST. A hostname that merely ENDS with our domain but
   is not under it — registered by somebody else — must never be read as one of
   our projects. */
has(
  routeFor("evilquickstark.tech").kind !== "slug",
  "a lookalike domain is not read as one of our subdomains",
  JSON.stringify(routeFor("evilquickstark.tech")),
);
has(
  routeFor("notquickstark.tech").kind !== "slug",
  "and neither is another one",
  JSON.stringify(routeFor("notquickstark.tech")),
);

// ── A custom domain ───────────────────────────────────────────────────────
has(routeFor("www.customer.com").kind === "domain", "an unknown host is a custom domain to look up");
has(routeFor("www.customer.com").domain === "www.customer.com", "carried through exactly");

// ── Paths that stay with the app ──────────────────────────────────────────
/* On a customer's hostname these must not be rewritten to their page: /api on
   somebody else's domain puts this app's endpoints on an origin we do not
   control. */
for (const path of ["/api/build", "/api/publish", "/_next/static/chunk.js", "/favicon.ico"]) {
  has(isAppPath(path), `${path} stays with the app`);
}
for (const path of ["/", "/about", "/pricing", "/anything"]) {
  has(!isAppPath(path), `${path} is served as the site`);
}

// ── Slugs ─────────────────────────────────────────────────────────────────
has(slugFrom("Premium, futuristic landing") === "premium-futuristic-landing", "a name becomes a slug", slugFrom("Premium, futuristic landing"));
has(slugFrom("Café Ganache") === "cafe-ganache", "accents become their letters", slugFrom("Café Ganache"));
has(slugFrom("  Shop  ") === "shop", "surrounding space is dropped");
has(slugFrom("A") === null, "a name too short to be an address is refused, not padded");
has(slugFrom("!!!") === null, "a name with nothing usable in it is refused");
has(slugFrom("12345") === null, "a number is not a name");

/* Reserved names. A project called "API" taking api.quickstark.tech would take
   it from us, with no way to get it back without breaking their site. */
for (const reserved of ["www", "api", "admin", "app", "mail", "preview", "quickstark"]) {
  has(slugFrom(reserved) === null, `"${reserved}" is reserved`);
}

/* A long name is cut, and never cut to something ending in a hyphen — that is
   not a legal DNS label. */
const long = slugFrom("An extremely long project name that goes well past what any subdomain should be");
has(long.length <= 40 && !long.endsWith("-"), "a long name is cut to a legal label", long);

has(slugIsUsable("shop") === true, "a clean slug is usable");
has(slugIsUsable("Shop") === false, "one that would change when cleaned is not");
has(slugIsUsable("api") === false, "and neither is a reserved one");

/* Collisions are numbered, not randomised: "shop-2" reads as somebody else
   having "shop", where "shop-x7f2" reads as a fault. */
has(slugAttempt("shop", 0) === "shop", "the first attempt is the name itself");
has(slugAttempt("shop", 1) === "shop-2", "the second is numbered", slugAttempt("shop", 1));
has(slugAttempt("shop", 2) === "shop-3", "and so on");
/* A suffix on a name already at the limit must still fit, and must still be
   legal — this is where an off-by-one produces a hostname nothing can serve. */
const bumped = slugAttempt("a".repeat(40), 9);
has(bumped.length <= 40 && !bumped.endsWith("-") && bumped.endsWith("-10"), "a suffix on a maximum-length name still fits", bumped);

/* ── The address a project actually gets ──────────────────────────────────
 *
 * slugFrom refuses a name it cannot turn into a safe label, which is right.
 * What was wrong was what happened next: it fell straight to `site-<8 hex>`.
 * A project called "QuickStark" published to site-8975e2ca.quickstark.tech —
 * correct, permanent, and not an address anybody would put on a business card.
 * The name is qualified now rather than abandoned. */
const ID = "8975e2ca-5cbc-4773-bc58-eb858894acd5";

has(addressFor("Premium, futuristic landing", ID) === "premium-futuristic-landing", "an ordinary name is used as it is");

/* THE ONE. Reserved, because nobody may take quickstark.quickstark.tech and
   look official — but the project is still recognisably theirs. */
has(addressFor("QuickStark", ID) === "quickstark-app", "a reserved name is qualified, not abandoned", addressFor("QuickStark", ID));
has(addressFor("API", ID) === "api-app", "and so is another reserved one", addressFor("API", ID));

/* A name too short to be a label on its own becomes usable with the suffix. */
has(addressFor("Hi", ID) === "hi-app", "a very short name is extended rather than replaced", addressFor("Hi", ID));

/* The hex remains for a name with nothing to build on. */
has(addressFor("!!!", ID) === "site-8975e2ca", "a name with no letters still falls back to the id", addressFor("!!!", ID));
has(addressFor("12345", ID) === "12345-app", "a number gets a suffix that makes it a name", addressFor("12345", ID));

/* Whatever it returns must itself be a legal, usable address — otherwise the
   fallback has produced something the next publish would refuse. */
for (const name of ["QuickStark", "API", "Hi", "!!!", "12345", "Premium, futuristic landing", "www"]) {
  const got = addressFor(name, ID);
  has(got !== null && slugIsUsable(got), `the address for ${JSON.stringify(name)} is itself usable`, got);
}

/* ── The address is a path, not a subdomain ───────────────────────────────
 *
 * shop.quickstark.tech is the nicer form and it needs a wildcard DNS record
 * plus a wildcard domain on the Vercel project. The DNS half fails silently:
 * a publish succeeded, took 50 credits and handed back a hostname that did not
 * resolve, which is exactly what happened on the first real publish. A path
 * works the moment the code deploys, on any plan.
 *
 * The slug still has to be a legal DNS label, so nothing here forecloses
 * moving to subdomains later — that is what these two checks are guarding. */
has(publishedUrl("shop") === "https://www.quickstark.tech/s/shop", "a published project is served from a path", publishedUrl("shop"));
has(!publishedUrl("shop").includes("shop.quickstark"), "and never from a subdomain", publishedUrl("shop"));
has(publishedLabel("shop") === "www.quickstark.tech/s/shop", "the label drops the scheme", publishedLabel("shop"));

/* Every address this can issue must survive being put in a URL unchanged —
   if a slug ever needed escaping, the address shown and the address served
   would differ. */
for (const name of ["QuickStark", "Premium, futuristic landing", "Café Ganache", "12345"]) {
  const slug = addressFor(name, ID);
  has(
    slug !== null && encodeURIComponent(slug) === slug,
    `the address for ${JSON.stringify(name)} needs no escaping`,
    slug,
  );
}

// ── Domains people type ───────────────────────────────────────────────────
/* All of these are the same domain, and all of them are normal to paste. */
for (const typed of [
  "www.customer.com",
  "WWW.CUSTOMER.COM",
  "  www.customer.com  ",
  "https://www.customer.com",
  "http://www.customer.com/",
  "https://www.customer.com/home?x=1",
  "www.customer.com.",
  "https://www.customer.com:443/path",
]) {
  const got = normaliseDomain(typed);
  has(got.domain === "www.customer.com", `"${typed}" normalises`, JSON.stringify(got));
}

/* What must be refused, with something the person can act on. */
const refusals = [
  ["", "empty"],
  ["   ", "empty"],
  ["customer", "no-tld"],
  ["not a domain", "not-a-domain"],
  ["192.168.1.1", "no-tld"],
  ["-bad.com", "not-a-domain"],
  ["bad-.com", "not-a-domain"],
  /* Our own domain. Somebody will try it, either by mistake or to take a
     subdomain that is not theirs — and publishing already gives them one. */
  ["shop.quickstark.tech", "ours"],
  ["quickstark.tech", "ours"],
];
for (const [typed, problem] of refusals) {
  const got = normaliseDomain(typed);
  has(got.problem === problem, `"${typed}" is refused as ${problem}`, JSON.stringify(got));
}

// ── Which DNS record, and what to call it ─────────────────────────────────
/* A CNAME cannot legally sit on the apex of a zone, so an apex takes an A
   record. Telling somebody to put a CNAME on customer.com sends them to a form
   that refuses it without saying why. */
has(isApex("customer.com") === true, "customer.com is an apex");
has(isApex("www.customer.com") === false, "www.customer.com is not");
has(isApex("customer.co.uk") === true, "customer.co.uk is an apex too — the suffix is two labels");
has(isApex("www.customer.co.uk") === false, "and www.customer.co.uk is not");
has(isApex("shop.eu.customer.com") === false, "a deep subdomain is not an apex");

/* Providers ask for the LABEL, not the whole hostname. Typing the full domain
   into that box creates www.customer.com.customer.com, which is the commonest
   way for this to silently not work. */
has(recordName("www.customer.com") === "www", "the record is named www", recordName("www.customer.com"));
has(recordName("customer.com") === "@", "an apex record is named @", recordName("customer.com"));
has(recordName("www.customer.co.uk") === "www", "and www on a two-label suffix", recordName("www.customer.co.uk"));
has(recordName("shop.eu.customer.com") === "shop.eu", "a deep subdomain keeps its labels", recordName("shop.eu.customer.com"));

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
