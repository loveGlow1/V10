/* Pointing a project at your own Supabase, and unpointing it.
 *
 * A generated project's data lives on QuickStark's instance by default, in a
 * schema of its own. That is right for a preview and wrong for a business: the
 * data is in somebody else's account, the auth users are drawn from a pool
 * shared with every other project on the instance, and none of exporting it,
 * backing it up or leaving is something the owner can do on their own.
 *
 * So this is the exit. Paste a Supabase URL and its anon key, and the next
 * build of the project is built against that instance instead — same files,
 * same schema, different database. Add a connection string as well and the
 * build creates the tables there too; leave it out and the migration is
 * something the owner runs themselves.
 *
 * ── What is checked before anything is stored ────────────────────────────
 *
 * The anon key is checked for actually being an anon key, and that check is the
 * reason this route is not three lines. Both Supabase keys are JWTs and they sit
 * next to each other in the dashboard, so pasting the wrong one is the likely
 * accident rather than an unlikely one — and the consequence is not symmetric.
 * An anon key in the wrong field breaks a build. A SERVICE key in this field is
 * compiled into a statically exported bundle and served to every visitor of the
 * finished site, each of whom then holds full read and write over every table
 * with row-level security bypassed. It is refused here, by reading the role out
 * of the token, because there is no later point at which anybody would notice.
 */

import { NextResponse } from "next/server";

import {
  isAnonKey,
  isSupabaseUrl,
  resolveBackend,
} from "@/lib/builder/backend/connection";
import {
  BACKEND_MODES,
  MODE_BLURB,
  MODE_LABEL,
  isBackendMode,
  isProductionGrade,
  modeFor,
} from "@/lib/builder/backend/modes";
import { schemaIsServable, schemaProblem, verifyBackend } from "@/lib/builder/backend/verify";
import {
  configured as managedConfigured,
  provisionProject,
  unconfiguredReason,
} from "@/lib/builder/backend/managed";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "./owned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkRequest = {
  url?: unknown;
  anonKey?: unknown;
  /* Optional, and the only secret here. Without it the link still works — the
     app is built against their instance — but the tables are theirs to create.
     With it, the build applies the migration for them. */
  dbUrl?: unknown;
};

/** Where this project's data currently lives, and where it should. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot read backends." }, { status: 503 });
  }

  /* Read before resolveBackend rather than through it, because the mode this
     route most needs to report is the one resolveBackend correctly answers
     `null` for. A project with no database has nothing to open a connection
     to — and answering 503 "No Supabase is configured" for it, which is what
     this did, turns a settled decision into an error message. */
  const { data: row } = await service
    .from("project_backends")
    .select("mode, db_url")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ mode: string | null; db_url: string | null }>();

  const chosen = isBackendMode(row?.mode) ? row.mode : null;
  const canProvision = managedConfigured();

  /* What the last build decided this product actually needs, which is the only
     thing that may decide IF there is a database. The mode decides only whose
     it is. A project with no architecture yet has not been understood, and
     `false` is the safe reading of that: nothing is provisioned for a project
     nobody has described. */
  const { data: architecture } = await service
    .from("project_architecture")
    .select("manifest")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ manifest: { database?: unknown } | null }>();

  const needsDatabase = Boolean(architecture?.manifest?.database);

  /* The three options, with the one that costs money marked unavailable where
     this deployment cannot honour it. Offering a button that always fails is
     worse than not offering it: the person tries, waits, and is told about an
     environment variable. */
  const options = BACKEND_MODES.filter((mode) => mode !== "shared").map((mode) => ({
    mode,
    label: MODE_LABEL[mode],
    blurb: MODE_BLURB[mode],
    available: mode === "quickstark_managed" ? canProvision : true,
    unavailableBecause: mode === "quickstark_managed" && !canProvision ? unconfiguredReason() : null,
  }));

  /* Proposed, not applied. The build works out what the product needs and this
     says where it should live; choosing is somebody else's to do, on this
     panel, which is why nothing here writes. */
  const recommended = modeFor({ needsDatabase, chosen, canProvision });

  const common = { needsDatabase, recommended, options, chosen };

  /* No database, decided and written down — not an absent row, and not a
     failure to read one. */
  if (chosen === "none") {
    return NextResponse.json({
      ...common,
      kind: null,
      mode: "none",
      managedRef: null,
      url: null,
      schema: null,
      ready: false,
      verifiedAt: null,
      productionGrade: false,
      hasDbUrl: false,
    });
  }

  const connection = await resolveBackend(service, owned.projectId);

  /* Nowhere for data to go: no managed backend configured, no Supabase linked,
     and no shared instance either. An answer rather than an error, because the
     options below it are exactly what somebody does about it. */
  if (!connection) {
    return NextResponse.json({
      ...common,
      kind: null,
      mode: null,
      managedRef: null,
      url: null,
      schema: null,
      ready: false,
      verifiedAt: null,
      productionGrade: false,
      hasDbUrl: false,
      problem: "This project has nowhere to keep data yet. Choose one of the options below.",
    });
  }

  return NextResponse.json({
    ...common,
    kind: connection.kind,
    /* The field to branch on. `kind` cannot tell a database of the project's
       own from a schema on ours, and cannot say there is none. */
    mode: connection.mode,
    managedRef: connection.managedRef,
    url: connection.url,
    schema: connection.schema,
    ready: connection.ready,
    /* When this SERVER last reached it. Distinct from `ready`, which is about
       the migration, and from the shape checks, which prove nothing. */
    verifiedAt: connection.verifiedAt,
    /* Whether it is fit to put real customer data in. The shared instance is a
       preview — one auth.users pool for every project on it — and looked
       exactly like the others until something said so. */
    productionGrade: isProductionGrade(connection.mode),
    /* The connection string is not in this response and cannot be: the column
       is revoked from every role the browser can be, and there is nothing here
       that would put it back. This is whether the migration can be applied —
       a boolean rather than the string. */
    hasDbUrl: Boolean(row?.db_url),
  });
}

/** Links a Supabase the caller owns. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  let body: LinkRequest;
  try {
    body = (await request.json()) as LinkRequest;
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }

  if (!isSupabaseUrl(body.url)) {
    return NextResponse.json(
      { error: "That does not look like a Supabase project URL. It should be https://<something>.supabase.co, with nothing after it." },
      { status: 400 },
    );
  }

  if (!isAnonKey(body.anonKey)) {
    return NextResponse.json(
      {
        error:
          "That key is not an anon key. Copy the one labelled anon / public — a service_role key would be compiled into your site and served to every visitor, giving each of them full access to your database.",
      },
      { status: 400 },
    );
  }

  const dbUrl =
    typeof body.dbUrl === "string" && body.dbUrl.trim().length > 0 ? body.dbUrl.trim() : null;

  if (dbUrl && !/^postgres(ql)?:\/\//i.test(dbUrl)) {
    return NextResponse.json(
      { error: "The connection string should start with postgresql://. Leave it out to create the tables yourself." },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot store backends." }, { status: 503 });
  }

  /* ── Reached, not merely well-formed ──────────────────────────────────────
   *
   * Everything above this line checks SHAPE: that the URL parses and is https,
   * that the key is an anon key rather than a service key. Both are worth
   * checking and neither is evidence the thing exists. A project was marked
   * connected on two regexes, and the first real test was a migration inside a
   * sixty-second build — minutes later, somewhere else, where failing looks
   * like a build problem rather than a typo.
   *
   * The browser's pre-flight is not this. It runs on the customer's network,
   * where a proxy or a blocker fails it while the Supabase is perfectly
   * reachable from where the builds actually run, which is why that check can
   * be overridden. This one cannot: it runs here. */
  const verification = await verifyBackend(body.url, body.anonKey);

  if (!verification.ok) {
    return NextResponse.json(
      {
        error: verification.problem,
        reachable: verification.reachable,
        authorised: verification.authorised,
      },
      { status: 422 },
    );
  }

  /* And the question that decides whether a built app can read its own tables.
     PostgREST serves only the schemas on its exposed list, so an app pointed at
     anything else gets PGRST106 on every query with the tables sitting there
     perfectly well made. `public` is the one schema exposed everywhere, which
     is why a linked project uses it — this catches the instance that has had
     even that changed. */
  if (!schemaIsServable("public", verification.schemas)) {
    return NextResponse.json(
      { error: schemaProblem("public", verification.schemas) },
      { status: 422 },
    );
  }

  /* applied_at is cleared, deliberately. The tables were created somewhere else
     — pointing at a new instance means this project's schema is not there until
     the next build puts it there, and a stale applied_at would tell the builder
     it already had. */
  const { error } = await service.from("project_backends").upsert(
    {
      project_id: owned.projectId,
      user_id: owned.userId,
      kind: "own",
      mode: "own",
      managed_ref: null,
      /* Set here and nowhere else. It means THIS SERVER reached that Supabase
         and was answered — not that the values looked right. */
      verified_at: new Date().toISOString(),
      verification_error: null,
      url: body.url,
      anon_key: body.anonKey,
      /* Only overwritten when one was sent. Re-linking to correct a typo'd URL
         should not silently discard a working connection string. */
      ...(dbUrl ? { db_url: dbUrl } : {}),
      schema_name: "public",
      applied_at: null,
    },
    { onConflict: "project_id" },
  );

  if (error) {
    return NextResponse.json({ error: `That could not be saved: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    kind: "own",
    mode: "own",
    url: body.url,
    schema: "public",
    ready: false,
    verified: true,
    productionGrade: true,
    hasDbUrl: Boolean(dbUrl),
    message: dbUrl
      ? "Linked. The next build will create this project's tables in your Supabase."
      : "Linked. The next build will be built against your Supabase — add a connection string, or run the migration yourself, to create the tables.",
  });
}

/**
 * Chooses which of the three backends this project has.
 *
 * PUT links a Supabase somebody already owns. This is the other two, which had
 * no route at all: "no database" could only be expressed by never creating a
 * row — indistinguishable from a row that failed to write — and "a database of
 * its own" did not exist as a thing anybody could ask for.
 *
 * Frontend-only is a DECISION here rather than an absence, and that is the
 * point of writing it down. A project whose owner has said it needs no database
 * should not be quietly given one by a later build whose brief happened to
 * mention accounts.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  if (!isBackendMode(body.mode)) {
    return NextResponse.json(
      { error: `Choose one of: ${BACKEND_MODES.join(", ")}.` },
      { status: 400 },
    );
  }

  /* Linking somebody's own Supabase needs their URL and key, which this route
     does not take. Sending them here instead of to PUT is a client mistake
     worth naming rather than storing a mode with nothing behind it. */
  if (body.mode === "own") {
    return NextResponse.json(
      { error: "To use your own Supabase, send its URL and anon key — see PUT on this route." },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot store backends." }, { status: 503 });
  }

  if (body.mode === "none") {
    const { error } = await service.from("project_backends").upsert(
      {
        project_id: owned.projectId,
        user_id: owned.userId,
        kind: "shared",
        mode: "none",
        /* Everything about a database, cleared. A row that says "no database"
           while still holding a URL and a schema name is a row that will be
           read as a database by the next thing that forgets to check the
           mode. */
        url: null,
        anon_key: null,
        schema_name: null,
        managed_ref: null,
        applied_at: null,
        verified_at: null,
        verification_error: null,
      },
      { onConflict: "project_id" },
    );

    if (error) {
      return NextResponse.json({ error: `That could not be saved: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      mode: "none",
      message:
        "This project has no database. Nothing will be provisioned for it, and nothing that was " +
        "already created has been deleted.",
    });
  }

  /* ── A database of its own ─────────────────────────────────────────────
   *
   * The mode the architecture actually calls for: Customer A gets Supabase
   * Project A, Customer B gets Project B, and neither is in QuickStark's
   * production database or sharing its auth.users pool.
   *
   * It costs real money per project, which is why it is gated on configuration
   * rather than assumed. A deployment that cannot provision says so and leaves
   * the project where it was, instead of silently writing a mode it cannot
   * honour — a row claiming a managed backend with no project behind it is
   * worse than an honest refusal. */
  if (!managedConfigured()) {
    return NextResponse.json(
      {
        error:
          "A managed database is not available on this deployment — " +
          `${unconfiguredReason()}. You can connect your own Supabase instead.`,
        canConnectOwn: true,
      },
      { status: 503 },
    );
  }

  const { data: project } = await service
    .from("projects")
    .select("name")
    .eq("id", owned.projectId)
    .maybeSingle<{ name: string | null }>();

  const provisioned = await provisionProject({
    projectName: project?.name ?? "app",
    projectId: owned.projectId,
  });

  if (!provisioned.ok) {
    /* Recorded against the project rather than only returned, so the reason
       survives the request that asked. The same argument as
       project_backends.last_error: the question "why has my app no database"
       is asked hours later and somewhere else. */
    await service.from("project_backends").upsert(
      {
        project_id: owned.projectId,
        user_id: owned.userId,
        kind: "shared",
        mode: "shared",
        verification_error: provisioned.reason,
      },
      { onConflict: "project_id" },
    );

    return NextResponse.json({ error: provisioned.reason }, { status: 502 });
  }

  const { error } = await service.from("project_backends").upsert(
    {
      project_id: owned.projectId,
      user_id: owned.userId,
      kind: "shared",
      mode: "quickstark_managed",
      managed_ref: provisioned.project.ref,
      url: provisioned.project.url,
      anon_key: provisioned.project.anonKey,
      /* `public`, because a project of its own has nothing to share a schema
         namespace with — which is exactly what the shared instance could never
         arrange, and why its apps could not read their own tables. */
      schema_name: provisioned.project.schema,
      applied_at: null,
      verified_at: new Date().toISOString(),
      verification_error: null,
    },
    { onConflict: "project_id" },
  );

  if (error) {
    /* The Supabase project EXISTS and we have just failed to write down where.
       Said plainly: an orphan in the organisation dashboard is somebody's
       monthly bill, and the operator needs to know it is there. */
    // eslint-disable-next-line no-console
    console.error(
      `backend: provisioned ${provisioned.project.ref} for ${owned.projectId} and could not record it:`,
      error.message,
    );
    return NextResponse.json(
      {
        error:
          "The database was created but could not be linked to this project. " +
          "Nothing is lost — try again, and tell us if it keeps happening.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    mode: "quickstark_managed",
    url: provisioned.project.url,
    schema: provisioned.project.schema,
    ready: false,
    productionGrade: true,
    message:
      "This project has a database of its own now. Its tables are created on the next build.",
  });
}

/** Unlinks, returning the project to the shared instance. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot change backends." }, { status: 503 });
  }

  /* The row goes; their data does not. Nothing here touches their Supabase —
     unlinking stops this project being built against it, and every table and
     row it created is still theirs, in their account, where it was. */
  const { error } = await service
    .from("project_backends")
    .delete()
    .eq("project_id", owned.projectId);

  if (error) {
    return NextResponse.json({ error: `That could not be undone: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    kind: "shared",
    message:
      "Unlinked. The next build goes back to QuickStark's Supabase. Nothing was deleted from yours.",
  });
}
