/* The signed-in area a brief asks for, and what is in it.
 *
 * "Build me a platform with login, sign up and a dashboard" has, for months,
 * come back as a sign-in page and nothing behind it — or, worse, an /admin page
 * reading "listing management will be built out in a later stage". Two things
 * made that happen and neither was the model disobeying anything:
 *
 *   - scaffold.ts told every web app "do NOT write app/dashboard/page.tsx
 *     unless the product genuinely is a dashboard", and nothing ever told it
 *     that a brief ASKING for one had said so. The only protected route it knew
 *     how to name was the owner's /admin, so a customer's dashboard became an
 *     owner's back office — the wrong audience — and then a stub.
 *   - Nothing listed the sections. A brief that spells out Overview, Saved
 *     Properties, Scheduled Viewings, Profile and Settings was answered with one
 *     file, because one file is all the file list asked for.
 *
 * So this reads the brief for the member area itself and for the parts of it
 * the person named, and scaffold.ts turns that into files to write. Pure: no
 * SDK, no network, so tools/check-tree-brief.mjs can compile it on its own. */

import type { BuildKind } from "./kinds";

export type MemberSection = {
  /** The route segment under /dashboard. */
  slug: string;
  /** What the sidebar calls it. */
  title: string;
  /** What the page is for, in one clause the generator can build against. */
  purpose: string;
};

export type MemberArea = {
  sections: MemberSection[];
  /** Whether the brief asked for a password reset flow. */
  passwordReset: boolean;
  /** The phrase that brought it in, for the step list and for anyone disputing it. */
  because: string;
};

/* Somebody asking for a place of their own behind a sign-in. "dashboard" is
   here, where architecture.ts deliberately keeps it out of ADMIN — the word
   means an admin about half the time, and the other half is this. The two are
   told apart below by who the dashboard is FOR. */
const MEMBER_AREA =
  /\b(dashboard|my account|account (?:area|page|dashboard|section|portal)|members?(?:'s)? (?:area|portal|dashboard|section|zone|lounge)|(?:user|client|customer|patient|student|member|tenant|guest|learner|athlete|investor|partner)(?:'s)? (?:area|portal|dashboard|panel|space|hub)|protected (?:pages?|area|routes?|section)|signed[- ]in (?:area|section|experience|view))\b/i;

/* A dashboard that belongs to whoever RUNS the thing. These are the admin's,
   and scaffold.ts already builds those under /admin with their own guard. */
const OWNER_DASHBOARD =
  /\b(?:admin|merchant|seller|vendor|staff|editor|publisher|owner|store|shop|back[- ]?office|analytics|sales|reporting)(?:'s)? (?:dashboard|portal|panel|area)\b/gi;

/* The sections people most often name, in the words they name them in. Order
   is the order they appear in a sidebar that was designed rather than
   accumulated: the things a person came for first, their own details last. */
const VOCABULARY: { pattern: RegExp; section: MemberSection }[] = [
  {
    pattern: /\b(saved (?:properties|items|listings|products|homes|jobs|searches|recipes|posts|articles|places)|favou?rites?|wish ?lists?|bookmarks?|shortlists?)\b/i,
    section: { slug: "saved", title: "Saved", purpose: "everything this person has saved, with a way to open each and remove it" },
  },
  {
    pattern: /\b(orders|purchases|order history|my order)\b/i,
    section: { slug: "orders", title: "Orders", purpose: "their orders, newest first, each with its status, items and total" },
  },
  {
    pattern: /\b(bookings?|appointments?|reservations?|viewings?|sessions? booked|scheduled (?:viewings?|visits?|calls?))\b/i,
    section: { slug: "bookings", title: "Bookings", purpose: "their upcoming and past bookings with date, time and status, and a way to cancel an upcoming one" },
  },
  {
    pattern: /\b(my courses|enrol(?:l)?ed courses|enrol(?:l)?ments?|course progress)\b/i,
    section: { slug: "courses", title: "Courses", purpose: "what they are enrolled in and how far through each they are" },
  },
  {
    pattern: /\b(my projects|projects (?:list|board|overview)|workspaces)\b/i,
    section: { slug: "projects", title: "Projects", purpose: "their projects, with status and last activity, and a way to create one" },
  },
  {
    pattern: /\b(messages|inbox|conversations|direct messages)\b/i,
    section: { slug: "messages", title: "Messages", purpose: "their conversations, unread first, and a way to reply" },
  },
  {
    pattern: /\b(my (?:documents|files|uploads)|document (?:library|vault)|downloads)\b/i,
    section: { slug: "documents", title: "Documents", purpose: "their documents, with a way to open, upload and remove one" },
  },
  {
    pattern: /\b(invoices|billing|payment history|my subscription|my plan)\b/i,
    section: { slug: "billing", title: "Billing", purpose: "their plan and invoice history" },
  },
  {
    pattern: /\b(notifications(?! preferences)|alerts)\b/i,
    section: { slug: "notifications", title: "Notifications", purpose: "their notifications, unread first, with a way to mark them read" },
  },
  {
    pattern: /\b(recently viewed|viewing history|browsing history)\b/i,
    section: { slug: "recently-viewed", title: "Recently viewed", purpose: "what they have recently looked at, newest first, each linking back to it" },
  },
  {
    pattern: /\b(recent activity|activity (?:feed|log))\b/i,
    section: { slug: "activity", title: "Recent activity", purpose: "what they have recently viewed or done, newest first" },
  },
];

/* Every member area has these two whether or not they were named: a person
   who can sign in has details to see and a password to change. Named ones keep
   their place in the brief's order; these join at the end otherwise. */
const PROFILE: MemberSection = {
  slug: "profile",
  title: "Profile",
  purpose: "their name, contact details, photo and preferences, editable and saved to their profile row",
};
const SETTINGS: MemberSection = {
  slug: "settings",
  title: "Settings",
  purpose: "account settings — email, password change, notification preferences, and signing out",
};

/* Segments written out as routes — "/dashboard/favorites" — are the most
   exact thing a brief can say, and they win over the vocabulary. */
const EXPLICIT_ROUTE = /\/dashboard\/([a-z][a-z0-9-]{1,30})\b/gi;

/* Past this a sidebar is a menu nobody reads, and each entry is a page the
   generation has to build in full. */
const MOST = 7;

function titleFor(slug: string): string {
  const known = [...VOCABULARY.map((entry) => entry.section), PROFILE, SETTINGS].find(
    (section) => section.slug === slug,
  );
  if (known) return known.title;
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function purposeFor(slug: string): string {
  for (const entry of VOCABULARY) {
    if (entry.section.slug === slug || entry.pattern.test(slug.replace(/-/g, " "))) return entry.section.purpose;
  }
  if (slug === PROFILE.slug) return PROFILE.purpose;
  if (slug === SETTINGS.slug || /setting|account|preference/.test(slug)) return SETTINGS.purpose;
  return `this person's own ${slug.replace(/-/g, " ")}, as the brief describes it`;
}

/**
 * The member area this brief asks for, or null when it asks for none.
 *
 * Null whenever the project has no accounts: a dashboard with nobody signed in
 * to it is a page, and the kind's own routes cover pages.
 */
export function memberAreaFor(
  brief: string,
  manifest: { authentication: boolean },
  kind: BuildKind,
): MemberArea | null {
  if (!manifest.authentication) return null;

  /* The owner's dashboards are taken out before asking, so "an admin
     dashboard" alone does not also produce a customer one. What is left has to
     ask for a place of its own. */
  const text = brief.replace(OWNER_DASHBOARD, " ");
  const asked = text.match(MEMBER_AREA);
  const explicit = [...brief.matchAll(EXPLICIT_ROUTE)].map((match) => match[1].toLowerCase());

  if (!asked && explicit.length === 0) return null;

  /* A store's shoppers already have /account (scaffold.ts ACCOUNT_ROUTES), and
     "a store with a dashboard" means the merchant's far more often than the
     shopper's. So a store gets a member dashboard only when the brief says
     whose it is. */
  if (kind === "ecommerce" && explicit.length === 0 && asked && /^dashboard$/i.test(asked[0])) {
    return null;
  }

  const seen = new Set<string>();
  const sections: MemberSection[] = [];
  const add = (section: MemberSection) => {
    if (seen.has(section.slug) || sections.length >= MOST) return;
    seen.add(section.slug);
    sections.push(section);
  };

  for (const slug of explicit) {
    add({ slug, title: titleFor(slug), purpose: purposeFor(slug) });
  }

  /* The vocabulary, in the order the brief mentions it, so the sidebar reads
     the way the person described their product. */
  const named = VOCABULARY.map((entry) => ({ entry, at: text.search(entry.pattern) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  for (const { entry } of named) {
    /* An explicit "/dashboard/favorites" already covers "saved". */
    if (explicit.some((slug) => entry.pattern.test(slug.replace(/-/g, " ")))) continue;
    add(entry.section);
  }

  if (![...seen].some((slug) => /profile/.test(slug))) add(PROFILE);
  if (![...seen].some((slug) => /setting|account/.test(slug))) add(SETTINGS);

  return {
    sections,
    passwordReset: /\b(forgot(?:ten)? password|reset (?:your |the )?password|password reset)\b/i.test(brief),
    because: asked?.[0] ?? `/dashboard/${explicit[0]}`,
  };
}
