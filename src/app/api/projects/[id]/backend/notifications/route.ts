import { NextResponse } from "next/server";

import { resolveBackend } from "@/lib/builder/backend/connection";
import { installFormNotifications, isEmailConfigured, validEmail } from "@/lib/builder/backend/form-notify";
import { PAGE_TABLE } from "@/lib/builder/backend/page-data";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../owned";

/* Email notifications for this app's form, as its owner sees and sets them.
 *
 *   GET    whether they are on, where they go, and whether they are set up.
 *   PATCH  { enabled?, email? } — email null or "" means the account email.
 *          Turning them on where the trigger is not installed yet installs it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { enabled: boolean; email: string | null; installed_at: string | null; last_sent_at: string | null };

async function context(id: string) {
  const owned = await ownedProject(id);
  if ("error" in owned) return { error: owned.error };
  const service = createSupabaseServiceClient();
  if (!service) {
    return { error: NextResponse.json({ error: "This deployment cannot manage notifications." }, { status: 503 }) };
  }
  return { owned, service };
}

async function state(service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, projectId: string, userId: string) {
  const [{ data: row }, { data: owner }] = await Promise.all([
    service
      .from("form_notifications")
      .select("enabled, email, installed_at, last_sent_at")
      .eq("project_id", projectId)
      .maybeSingle<Row>(),
    service.auth.admin.getUserById(userId),
  ]);
  return {
    configured: isEmailConfigured(),
    installed: Boolean(row?.installed_at),
    enabled: row ? row.enabled : false,
    email: row?.email ?? null,
    accountEmail: owner?.user?.email ?? null,
    lastSentAt: row?.last_sent_at ?? null,
  };
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  return NextResponse.json(await state(got.service, got.owned.projectId, got.owned.userId));
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; email?: unknown };
  const patch: { enabled?: boolean; email?: string | null } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.email !== undefined) {
    if (body.email === null || body.email === "") patch.email = null;
    else {
      const email = validEmail(body.email);
      if (!email) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
      patch.email = email;
    }
  }

  const { data: row } = await service
    .from("form_notifications")
    .select("installed_at")
    .eq("project_id", owned.projectId)
    .maybeSingle<{ installed_at: string | null }>();

  /* Turned on where nothing is installed yet: install it now, against the
     Supabase this app is connected to, so the switch does what it says. */
  if (patch.enabled && !row?.installed_at) {
    const backend = await resolveBackend(service, owned.projectId);
    if (!backend || backend.mode !== "own") {
      return NextResponse.json({ error: "Connect your Supabase first." }, { status: 409 });
    }
    const installed = await installFormNotifications(service, {
      projectId: owned.projectId,
      userId: owned.userId,
      connection: backend,
      schema: backend.schema,
      table: PAGE_TABLE,
    });
    if (!installed.ok) {
      return NextResponse.json({ error: `Notifications couldn't be set up: ${installed.reason}` }, { status: 502 });
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = row || patch.enabled
      ? await service.from("form_notifications").update(patch).eq("project_id", owned.projectId)
      : await service
          .from("form_notifications")
          .insert({ project_id: owned.projectId, user_id: owned.userId, enabled: false, ...patch });
    if (error) return NextResponse.json({ error: `That couldn't be saved: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json(await state(service, owned.projectId, owned.userId));
}
