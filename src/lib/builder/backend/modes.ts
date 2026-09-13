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
}): BackendMode {
  if (!input.needsDatabase) return "none";

  /* An owner who linked their own Supabase has answered this, and nothing here
     may overrule them — it is their account and their data. */
  if (input.chosen === "own") return "own";
  if (input.chosen && input.chosen !== "quickstark_managed") return input.chosen;

  /* Managed is the default for anything that needs a database, and falls back
     to the shared preview only where this deployment cannot provision. That
     fallback is a degradation and should be described as one: see
     isProductionGrade, which is what the interface asks before a publish. */
  return input.canProvision ? "quickstark_managed" : "shared";
}
