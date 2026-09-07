/* What to check, derived from what the project actually is.
 *
 * The failure this prevents is a QA stage that fails a landing page for having
 * no sign-in. Every check below is conditional on a layer the architecture
 * manifest says exists, so a dentist's one-pager is judged on its navigation
 * and its layout and nothing else, and a store is judged on its cart, its
 * admin and its orders.
 *
 * The manifest is READ, never re-derived. It is already the source of truth for
 * the prompt, the schema and the scaffold; a QA stage that decided for itself
 * what a project ought to have would be testing a different project from the
 * one that was built. When it is absent — an old build, a caller that sends no
 * manifest — the functional gate does not run rather than falling back to a
 * guess. See types.ts: a gate that did not run is not a gate that passed.
 */

import type { ArchitectureManifest } from "@/lib/builder/architecture";
import type { BuildKind } from "@/lib/builder/kinds";

/** One thing the finished project has to be able to do. */
export type Expectation = {
  rule: string;
  /** What has to be true, in a sentence a failure can be reported as. */
  what: string;
  /* How the static pass looks for it: a pattern over the markup, or over the
     file paths of a project. Absent means only a rendered run can answer it,
     and the static pass reports nothing rather than guessing. */
  markup?: RegExp;
  paths?: RegExp;
  /* A soft expectation is reported and never fails the gate. Used where the
     absence is suspicious rather than certainly wrong — a store with no visible
     search is unusual and not broken. */
  soft?: boolean;
};

/* ── The layers ────────────────────────────────────────────────────────────
 *
 * Keyed to manifest layers rather than to kinds, because that is where the
 * truth is: an ecommerce project without authentication has no account page to
 * look for, and a webapp with one does.
 */

const AUTHENTICATION: Expectation[] = [
  {
    rule: "auth/sign-in",
    what: "there is a way to sign in",
    markup: /\b(sign[ -]?in|log[ -]?in|sign[ -]?up)\b/i,
    paths: /app\/(login|signin|sign-in|auth)\//,
  },
  {
    rule: "auth/session",
    what: "the session is read from Supabase rather than from storage by hand",
    paths: /lib\/supabase/,
  },
];

const ADMIN: Expectation[] = [
  {
    rule: "admin/route",
    what: "there is an admin area",
    paths: /app\/admin\//,
  },
  {
    rule: "admin/guard",
    what: "the admin renders nothing until the role has been checked",
    paths: /AdminGuard|admin.*guard/i,
  },
];

const DATABASE: Expectation[] = [
  {
    rule: "database/client",
    what: "the project reads its data through the generated Supabase client",
    paths: /lib\/supabase/,
  },
  {
    rule: "database/types",
    what: "queries are typed against the real schema",
    paths: /lib\/database\.types/,
  },
];

const STORAGE: Expectation[] = [
  {
    rule: "storage/upload",
    what: "there is an upload that reaches storage",
    markup: /\btype\s*=\s*["']file["']/i,
    soft: true,
  },
];

/* ── The states ────────────────────────────────────────────────────────────
 *
 * §8. Only asked of a project that loads data: a landing page whose content is
 * in the markup has nothing to be loading, empty or in error about, and
 * demanding an empty state from one is how a QA gate teaches people to ignore
 * it.
 */
const STATES: Expectation[] = [
  {
    rule: "state/loading",
    what: "a list that loads says so while it loads",
    markup: /\b(loading|skeleton|spinner|isLoading|pending)\b/i,
  },
  {
    rule: "state/empty",
    what: "a list that can be empty says so when it is",
    markup: /\b(no results|nothing here|no products|no posts|no orders|empty|none yet)\b/i,
  },
  {
    rule: "state/error",
    what: "a request that can fail says so when it does",
    markup: /\b(went wrong|could not|couldn't|failed to|try again|error)\b/i,
  },
];

/* ── Per kind, over and above the layers ───────────────────────────────────
 *
 * Deliberately short. These are the things whose absence means the project is
 * not the thing it claims to be — a store you cannot add to a basket is not a
 * store — rather than a checklist of everything a store could have.
 */
const BY_KIND: Partial<Record<BuildKind, Expectation[]>> = {
  ecommerce: [
    { rule: "shop/cart", what: "there is a cart", markup: /\b(cart|basket|bag)\b/i },
    {
      rule: "shop/add",
      what: "products can be added to it",
      markup: /\b(add to (cart|basket|bag))\b/i,
    },
    { rule: "shop/price", what: "products carry prices", markup: /[£$€₦]\s?\d/ },
    { rule: "shop/checkout", what: "there is a checkout", markup: /\bcheckout\b/i },
  ],
  blog: [
    { rule: "blog/articles", what: "there are articles", markup: /<article\b/i },
    { rule: "blog/dates", what: "articles are dated", markup: /<time\b|\b20\d\d\b/i, soft: true },
  ],
  news: [
    { rule: "news/articles", what: "there are articles", markup: /<article\b/i },
    { rule: "news/lead", what: "one story leads the front", markup: /<h1\b/i },
  ],
  landing: [
    { rule: "landing/action", what: "there is something to do", markup: /<(button|a)\b[^>]*>/i },
  ],
  webapp: [],
};

export type QaPlan = {
  /** Every expectation this project is judged against. */
  expectations: Expectation[];
  /* Whether the functional gate has anything to work from. False when no
     manifest was supplied — see the header. */
  derivable: boolean;
};

/**
 * What this project has to be able to do.
 *
 * Never throws. A manifest that is missing produces an empty plan marked
 * underivable, and the caller reports the functional gate as not run.
 */
export function planFor(manifest: ArchitectureManifest | null | undefined): QaPlan {
  if (!manifest) return { expectations: [], derivable: false };

  const expectations: Expectation[] = [...(BY_KIND[manifest.type] ?? [])];

  if (manifest.authentication) expectations.push(...AUTHENTICATION);
  if (manifest.admin) expectations.push(...ADMIN);
  if (manifest.database) expectations.push(...DATABASE, ...STATES);
  if (manifest.storage) expectations.push(...STORAGE);

  /* Payments deliberately expects the honest unplugged state rather than a
     working charge: a statically exported project has nowhere to hold a secret
     key, so a checkout that claimed to take money would be the fake success the
     blueprints forbid. What is checked is that it says so. */
  if (manifest.payments) {
    expectations.push({
      rule: "payments/honest",
      what: "the payment step says it is not connected rather than faking a confirmation",
      markup: /\b(not connected|isn't connected|is not attached|isn't attached|coming soon|demonstration)\b/i,
    });
  }

  return { expectations, derivable: true };
}
