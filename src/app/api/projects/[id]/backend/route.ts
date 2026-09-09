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

/** Where this project's data currently lives. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot read backends." }, { status: 503 });
  }

  const connection = await resolveBackend(service, owned.projectId);
  if (!connection) {
    return NextResponse.json({ error: "No Supabase is configured." }, { status: 503 });
  }

  /* The connection string is not in this response and cannot be: the column is
     revoked from every role the browser can be, and there is nothing here that
     would put it back. `hasDbUrl` is what the settings pane needs — whether the
     migration can be applied — and it is a boolean rather than the string. */
  const { data } = await service
    .from("project_backends")
    .select("db_url")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ db_url: string | null }>();

  return NextResponse.json({
    kind: connection.kind,
    url: connection.url,
    schema: connection.schema,
    ready: connection.ready,
    hasDbUrl: Boolean(data?.db_url),
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

  /* applied_at is cleared, deliberately. The tables were created somewhere else
     — pointing at a new instance means this project's schema is not there until
     the next build puts it there, and a stale applied_at would tell the builder
     it already had. */
  const { error } = await service.from("project_backends").upsert(
    {
      project_id: owned.projectId,
      user_id: owned.userId,
      kind: "own",
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
    url: body.url,
    schema: "public",
    ready: false,
    hasDbUrl: Boolean(dbUrl),
    message: dbUrl
      ? "Linked. The next build will create this project's tables in your Supabase."
      : "Linked. The next build will be built against your Supabase — add a connection string, or run the migration yourself, to create the tables.",
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
