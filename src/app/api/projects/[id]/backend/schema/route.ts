/* The migration, as SQL somebody can run themselves.
 *
 * Linking a Supabase without a connection string is a supported choice — the
 * link endpoint offers it in as many words: "add a connection string, or run
 * the migration yourself". Until this existed that sentence had nowhere to go.
 * toSql was called in exactly one place, inside provision.ts, against a
 * connection; the SQL existed for the length of one build and was never written
 * down. So the person who declined to hand over their database password was
 * told to run something they were never given.
 *
 * This is that something. The same model, through the same generator, so what
 * is copied out of here is what a build would have applied — not a description
 * of it, and not a second implementation that will drift.
 *
 * ── Why it is generated rather than stored ────────────────────────────────
 *
 * The schema follows the architecture, and the architecture changes as the
 * project is built. A stored copy would be right on the day it was written and
 * quietly wrong afterwards, which for a migration means creating the tables the
 * app used to need. Generating it per request costs nothing and cannot go
 * stale.
 */

import { NextResponse } from "next/server";

import { resolveBackend } from "@/lib/builder/backend/connection";
import { dataModelFor, schemaNameFor, toSql } from "@/lib/builder/schema";
import type { ArchitectureManifest } from "@/lib/builder/architecture";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../owned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot read schemas." }, { status: 503 });
  }

  /* Addressed by the id ownership already settled, so the service client is
     reading a row this caller is entitled to — the same arrangement the build
     route uses, and the reason project_backends can stay unreadable from any
     browser at all. */
  const { data: architecture } = await service
    .from("project_architecture")
    .select("manifest")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ manifest: ArchitectureManifest | null }>();

  const manifest = architecture?.manifest ?? null;

  /* Not an error. A project with no architecture row has not been built yet,
     and a landing page has no database however many times it is built — both
     are ordinary states with the same honest answer, and neither is worth an
     error page. */
  if (!manifest || !manifest.database) {
    return NextResponse.json({
      sql: null,
      tables: 0,
      reason: manifest
        ? "This app doesn't use a database, so there's nothing to create."
        : "This app hasn't been built yet, so its tables aren't decided.",
    });
  }

  /* The schema it would actually be applied to: `public` on somebody's own
     Supabase, a schema of this project's own on the shared instance. Getting
     this wrong would hand somebody a migration that creates tables their app
     does not look in. */
  const backend = await resolveBackend(service, owned.projectId);
  const model = dataModelFor(manifest, backend?.schema ?? schemaNameFor(owned.projectId));

  let sql: string;
  try {
    sql = toSql(model);
  } catch (error) {
    /* toSql refuses a table with row-level security on and no policy behind it.
       That is a bug in this repository rather than anything the caller did, and
       handing over a migration known to lock a table would be worse than
       refusing. */
    // eslint-disable-next-line no-console
    console.error("backend schema: the migration could not be written:", error);
    return NextResponse.json(
      { error: "That schema couldn't be written. Nothing is wrong with your database." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    sql,
    tables: model.tables.length,
    schema: model.schema,
  });
}
