/* Which backend a project has, as one decision with four answers.
 *
 * This was two booleans' worth of meaning spread across a `kind` column with
 * two values, and it could not express the commonest correct answer. "This
 * project has no database" was represented by the ABSENCE of a row — which is
 * indistinguishable from a row that failed to write, and which meant the
 * frontend-only case had no way to say it had been decided rather than missed.
 *
 * ── Why `shared` is not the production model ──────────────────────────────
 *
 * The instinct to give every project a schema on one Supabase is a good one
 * for a preview and wrong for a business, and the reasons are not stylistic:
 *
 *   auth.users is one table per Supabase PROJECT, not per schema. Every app on
 *   the shared instance draws its accounts from the same pool. They cannot
 *   read each other's rows — a policy in app_a never matches a row in app_b —
 *   but the identities are not separate, and somebody selling things to real
 *   customers is sharing an identity pool with strangers.
 *
 *   PostgREST serves only the schemas on its exposed list, and that list cannot
 *   be written in advance because the name contains a project id that does not
 *   exist yet. So the tables are created and the app cannot read them.
 *
 *   The data is in somebody else's account. Exporting it, backing it up,
 *   pointing another tool at it, or leaving are all things an owner is entitled
 *   to do and none of them work.
 *
 * So `shared` stays in the type because live rows point at it and removing a
 * value migrates nothing — but it is a transitional preview mechanism, and
 * `quickstark_managed` is what a production project should get.
 */

export const BACKEND_MODES = ["none", "quickstark_managed", "shared", "own"] as const;

export type BackendMode = (typeof BACKEND_MODES)[number];

export function isBackendMode(value: unknown): value is BackendMode {
  return typeof value === "string" && (BACKEND_MODES as readonly string[]).includes(value);
}

/** What each mode is called where a person chooses between them. */
export const MODE_LABEL: Record<BackendMode, string> = {
  none: "Frontend only",
  quickstark_managed: "QuickStark Managed",
  shared: "Shared preview",
  own: "Connect your own",
};

/**
 * What each mode means, said in terms of what the person gets rather than what
 * we run. "A database of its own, set up for you" is a sentence somebody can
 * choose on; "an isolated Supabase project provisioned via the Management API"
 * is a sentence about us.
 */
export const MODE_BLURB: Record<BackendMode, string> = {
  none: "No database. Right for a site people read — a brochure, a landing page, a menu.",
  quickstark_managed:
    "A database of your own, set up and looked after for you. Nothing to sign up for.",
  shared:
    "A preview database shared with other projects. Fine for trying something out, not for real customers.",
  own: "Your own Supabase project. Your data, your account, your bill.",
};

/** Whether a project in this mode has a database at all. */
export function hasDatabase(mode: BackendMode): boolean {
  return mode !== "none";
}

/**
 * Whether this mode is fit to put real customer data in.
 *
 * The question the UI should be asking before somebody publishes a store, and
 * the one the shared instance quietly answered wrong by looking like the
 * others. `shared` is a preview: its identity pool is common to every project
 * on it and its schemas are not reachable by PostgREST without per-build
 * configuration nobody can do in advance.
 */
export function isProductionGrade(mode: BackendMode): boolean {
  return mode === "quickstark_managed" || mode === "own";
}

/* ── How much backend, which is not the same question as whether ──────────
 *
 * "Does this project have a database" was the only question asked, and it has
 * two very different right answers underneath it:
 *
 *   A LANDING PAGE WITH A CONTACT FORM needs one table. Nobody signs in, there
 *   is no admin, nothing is uploaded and no money moves. What it needs is a
 *   place to put enquiries so they are not lost — and giving it a Supabase
 *   project of its own is a monthly bill and a dashboard nobody will open, for
 *   one table with an insert policy.
 *
 *   A WEB APP has accounts. The moment there are accounts, the shared instance
 *   is the wrong home and not as a matter of taste: `auth.users` is one table
 *   per Supabase PROJECT, so every app on it draws its identities from one
 *   pool. Two apps cannot read each other's rows, but they share the pool, and
 *   somebody selling to real customers is sharing it with strangers.
 *
 * That is the whole distinction, and it falls out of the layers rather than
 * being guessed at: authentication, an admin, storage or payments each mean a
 * real project of its own. A database with none of them is one or two tables
 * that the preview instance serves perfectly well.
 *
 * Read from the manifest, never from the brief. The layers were decided once,
 * carefully, in architecture.ts; a second reading of the same words here would
 * be a second answer to disagree with the first. */
export const BACKEND_WEIGHTS = ["none", "simple", "heavy"] as const;

export type BackendWeight = (typeof BACKEND_WEIGHTS)[number];

/* The layers a weight is read from, structurally.
 *
 * Deliberately not `ArchitectureManifest` imported from architecture.ts: this
 * module has no imports at all, which is what lets the browser, the build route
 * and tools/check-backend-modes.mjs each read it without pulling the builder in
 * behind it. The five fields below are the ones that decide, and a manifest
 * satisfies this shape without being named. */
export type BackendNeeds = {
  database: boolean;
  authentication: boolean;
  admin: boolean;
  storage: boolean;
  payments: boolean;
};

/** How much backend this project's layers add up to. */
export function weightOf(needs: BackendNeeds): BackendWeight {
  if (!needs.database) return "none";

  /* Any one of these is a project of its own. Accounts are the obvious one;
     the other three are here because each brings something the shared instance
     cannot separate per app — a storage bucket, an admin reaching tables
     across the schema, and a payment record that is somebody's money. */
  if (needs.authentication || needs.admin || needs.storage || needs.payments) return "heavy";

  return "simple";
}

/** What to call this, where a person is being told what their project got. */
export const WEIGHT_LABEL: Record<BackendWeight, string> = {
  none: "No database",
  simple: "A table or two",
  heavy: "A database of its own",
};

/**
 * What a weight means for somebody reading the step list.
 *
 * Said in terms of what they get rather than what we run, like MODE_BLURB
 * above — "somewhere for enquiries to go" is a sentence about their contact
 * form, and "a schema on the shared preview instance" is a sentence about us.
 */
export const WEIGHT_BLURB: Record<BackendWeight, string> = {
  none: "Nothing is stored. Everything on the page is in the page.",
  simple: "Somewhere for form submissions to go, so they are not lost.",
  heavy: "Its own database, with accounts kept separate from every other project.",
};

/**
 * The mode a project should get, given what it needs and what is configured.
 *
 * The decision is deliberately dumb, because the interesting part happened
 * upstream: the architecture manifest already decided whether this project has
 * a database, and this only picks where it lives. A project with no database
 * layer gets `none` and nothing is provisioned for it — not a row, not a
 * schema, not a connection.
 */
export function modeFor(input: {
  /** From the architecture manifest. The only thing that decides IF. */
  needsDatabase: boolean;
  /** What the owner chose, where they chose. */
  chosen?: BackendMode | null;
  /** Whether this deployment can provision a project per app. */
  canProvision: boolean;
  /* How much backend, from weightOf. Optional, and absent reads as `heavy` —
     every caller written before weights existed was asking about a project
     with accounts, and answering a narrower question with a broader default is
     the safe direction: the worst it does is give a contact form a database of
     its own, where the other way round puts accounts on a shared pool. */
  weight?: BackendWeight;
}): BackendMode {
  if (!input.needsDatabase) return "none";

  /* An owner who linked their own Supabase has answered this, and nothing here
     may overrule them — it is their account and their data. */
  if (input.chosen === "own") return "own";
  if (input.chosen && input.chosen !== "quickstark_managed") return input.chosen;

  /* ── A table or two does not need a project of its own ─────────────────
   *
   * The shared instance's disqualifying flaw is its identity pool: one
   * `auth.users` for every app on it. A simple backend HAS no accounts — that
   * is what makes it simple — so the flaw does not reach it, and the schema
   * isolation that is left is exactly what a contact form needs.
   *
   * This is the one case where `shared` is a correct answer rather than a
   * degraded one, and it is worth saying out loud because isProductionGrade
   * still reports it as not production grade. That reading stays right for
   * what it is asked about: a project that later grows accounts is upgraded by
   * capability-upgrade.ts, and this answer is re-taken then with the layers it
   * has by then. */
  if (input.weight === "simple") return "shared";

  /* Managed is the default for anything that needs a database, and falls back
     to the shared preview only where this deployment cannot provision. That
     fallback is a degradation and should be described as one: see
     isProductionGrade, which is what the interface asks before a publish. */
  return input.canProvision ? "quickstark_managed" : "shared";
}
