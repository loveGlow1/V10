import { NextResponse } from "next/server";

import { dataModelFor, type DataModel } from "@/lib/builder/schema";
import { isolatedSchemaFor, parseSnapshot, planSchema, snapshotSql } from "@/lib/builder/backend/inspect";
import {
  allowRedirects,
  createProject,
  getProject,
  listOrganizations,
  listProjects,
  publicKey,
  runQuery,
} from "@/lib/builder/backend/supabase-api";
import { accessTokenFor, forgetTokens, oauthConfigured } from "@/lib/builder/backend/supabase-oauth";
import { verifyBackend } from "@/lib/builder/backend/verify";
import { AUTH_REDIRECT_GLOB, publishedUrl } from "@/lib/publish/naming";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../owned";

/* Connect Supabase, step three: pick the project, or have one made.
 *
 *   GET     whether Supabase is connected, and if so the person's
 *           organisations and projects to choose from.
 *   POST    { ref }                         link that project to this app.
 *           { create: { organizationId } }  make a new free project for it,
 *                                           then link it once it is up.
 *   DELETE  forget the Supabase sign-in (on this account, for every app).
 *
 * Linking does everything the paste form used to ask a person to do by hand:
 * reads the public key, checks the database answers, adds this platform's
 * addresses to the project's allowed sign-in redirects, and reads the
 * database to say — before anything is built — whether the app fits in
 * `public` or will get a schema of its own. Nothing is written to their
 * database here; the build does that, after scanning it again. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* The regions offered when a project is made for them. Supabase's own codes. */
const REGIONS = [
  { id: "eu-central-1", label: "Frankfurt" },
  { id: "eu-west-2", label: "London" },
  { id: "us-east-1", label: "North Virginia" },
  { id: "us-west-1", label: "North California" },
  { id: "ap-southeast-1", label: "Singapore" },
  { id: "ap-south-1", label: "Mumbai" },
  { id: "sa-east-1", label: "São Paulo" },
];

async function context(id: string) {
  const owned = await ownedProject(id);
  if ("error" in owned) return { error: owned.error };
  const service = createSupabaseServiceClient();
  if (!service) {
    return { error: NextResponse.json({ error: "This deployment cannot manage databases." }, { status: 503 }) };
  }
  return { owned, service };
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  if (!oauthConfigured()) return NextResponse.json({ configured: false, connected: false });

  const token = await accessTokenFor(service, owned.userId);
  if (!token) return NextResponse.json({ configured: true, connected: false, regions: REGIONS });

  const [organizations, projects] = await Promise.all([listOrganizations(token), listProjects(token)]);
  if (!projects.ok) {
    return NextResponse.json({
      configured: true,
      connected: projects.status === 401 ? false : true,
      regions: REGIONS,
      error: projects.reason,
    });
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    regions: REGIONS,
    organizations: organizations.ok ? organizations.value : [],
    projects: projects.value,
  });
}

type Body = { ref?: unknown; create?: { organizationId?: unknown; region?: unknown } };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  if (!oauthConfigured()) {
    return NextResponse.json({ error: "Connect Supabase is not set up on this deployment." }, { status: 503 });
  }
  const token = await accessTokenFor(service, owned.userId);
  if (!token) {
    return NextResponse.json({ error: "Connect Supabase first.", reconnect: true }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;

  const { data: projectRow } = await service
    .from("projects")
    .select("name, slug")
    .eq("id", owned.projectId)
    .maybeSingle<{ name: string | null; slug: string | null }>();

  /* ── A new project, made for them ───────────────────────────────────────
     Supabase answers straight away and builds the database behind it; the
     panel then links it by ref, asking again until it is up. */
  if (body.create) {
    const organizationId = typeof body.create.organizationId === "string" ? body.create.organizationId : "";
    const region =
      typeof body.create.region === "string" && REGIONS.some((r) => r.id === body.create?.region)
        ? body.create.region
        : "eu-central-1";
    if (!organizationId) return NextResponse.json({ error: "Choose which organisation it goes in." }, { status: 400 });

    const created = await createProject(token, {
      name: (projectRow?.name?.trim() || "QuickStark app").slice(0, 60),
      organizationId,
      region,
    });
    if (!created.ok) {
      return NextResponse.json(
        {
          error: /limit|maximum|free/i.test(created.reason)
            ? `${created.reason} — Supabase's free plan allows two active projects per organisation. Pick an existing project, or pause one you don't use.`
            : created.reason,
        },
        { status: created.status && created.status < 500 ? 400 : 502 },
      );
    }
    return NextResponse.json({ creating: true, ref: created.value.ref, name: created.value.name }, { status: 202 });
  }

  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!/^[a-z0-9]{10,40}$/.test(ref)) return NextResponse.json({ error: "Choose a Supabase project." }, { status: 400 });

  /* ── Is it up? ─────────────────────────────────────────────────────────── */
  const project = await getProject(token, ref);
  if (!project.ok) return NextResponse.json({ error: project.reason }, { status: 400 });
  if (project.value.status === "INACTIVE" || project.value.status === "PAUSED") {
    return NextResponse.json(
      { error: `${project.value.name} is paused. Restore it in your Supabase dashboard, then connect it again.` },
      { status: 409 },
    );
  }
  if (project.value.status !== "ACTIVE_HEALTHY") {
    return NextResponse.json(
      { pending: true, ref, message: "Supabase is still setting this database up. This usually takes a minute or two." },
      { status: 202 },
    );
  }

  /* ── The key, and proof it answers ─────────────────────────────────────── */
  const key = await publicKey(token, ref);
  if (!key.ok) return NextResponse.json({ pending: true, ref, message: key.reason }, { status: 202 });

  const url = `https://${ref}.supabase.co`;
  const reached = await verifyBackend(url, key.value);
  if (!reached.ok) {
    return reached.reachable
      ? NextResponse.json({ error: reached.problem }, { status: 422 })
      : NextResponse.json({ pending: true, ref, message: reached.problem }, { status: 202 });
  }

  /* ── Written down ───────────────────────────────────────────────────────
     Re-linking the same project keeps its schema and applied state — the
     tables are already where they are. A different project starts over in
     `public`, and the build's scan decides from there. A pasted connection
     string is dropped: signing in replaces it, and a database password with
     no remaining use is a liability. */
  const { data: existing } = await service
    .from("project_backends")
    .select("supabase_ref, schema_name, applied_at")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ supabase_ref: string | null; schema_name: string | null; applied_at: string | null }>();
  const same = existing?.supabase_ref === ref;

  const { error } = await service.from("project_backends").upsert(
    {
      project_id: owned.projectId,
      user_id: owned.userId,
      kind: "own",
      mode: "own",
      managed_ref: null,
      supabase_ref: ref,
      url,
      anon_key: key.value,
      db_url: null,
      schema_name: same ? existing?.schema_name ?? "public" : "public",
      applied_at: same ? existing?.applied_at ?? null : null,
      verified_at: new Date().toISOString(),
      verification_error: null,
      last_error: null,
      ...(same ? {} : { schema_report: null }),
    },
    { onConflict: "project_id" },
  );
  if (error) return NextResponse.json({ error: `That could not be saved: ${error.message}` }, { status: 500 });

  /* ── Sign-in on the deployed app ─────────────────────────────────────────
     Added to their allow-list, never replacing it — their Supabase may serve
     other apps. Not fatal: the database is linked either way. */
  const auth = await allowRedirects(token, ref, {
    redirects: [AUTH_REDIRECT_GLOB, `${SITE_URL}/**`, "http://localhost:3000/**"],
    siteUrl: projectRow?.slug ? publishedUrl(projectRow.slug) : null,
  });

  /* ── What the build will find ──────────────────────────────────────────── */
  let preview: string | null = null;
  const { data: architecture } = await service
    .from("project_architecture")
    .select("manifest")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ manifest: Parameters<typeof dataModelFor>[0] | null }>();

  if (architecture?.manifest?.database) {
    const schema = same ? existing?.schema_name ?? "public" : "public";
    const model: DataModel = dataModelFor(architecture.manifest, schema);
    const isolated = isolatedSchemaFor(projectRow?.name ?? "", owned.projectId);
    const scanned = await runQuery(token, ref, snapshotSql([schema, isolated, "public"]));
    const snapshot = scanned.ok ? parseSnapshot(scanned.value) : null;
    if (snapshot && model.tables.length > 0) {
      const plan = planSchema(model, snapshot, {
        settled: Boolean(same && existing?.applied_at),
        isolatedSchema: isolated,
        canExpose: true,
      });
      preview =
        plan.blocked.length > 0
          ? `Heads up: ${plan.blocked[0]}`
          : plan.isolated && plan.collisions.length > 0
            ? `Your database already has ${plan.collisions.map((c) => c.name).join(", ")}. This app will get its own schema, ${plan.schema}, so nothing of yours is touched.`
            : `${plan.create.length} ${plan.create.length === 1 ? "table" : "tables"} will be created on the next build${plan.reuse.length ? `, ${plan.reuse.length} already there` : ""}.`;
    }
  }

  return NextResponse.json({
    connected: true,
    ref,
    url,
    name: project.value.name,
    authConfigured: auth.ok,
    authNote: auth.ok ? null : auth.reason,
    preview,
  });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  await forgetTokens(got.service, got.owned.userId);
  return NextResponse.json({ connected: false });
}
