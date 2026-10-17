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

/* Whether this project's forms save to the owner's own Supabase (emails come
   from a trigger installed there) or to the QuickStark inbox (emails come from
   the submit route, on by default). See src/lib/forms/inbox.ts. */
async function usesOwnSupabase(service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, projectId: string) {
  const backend = await resolveBackend(service, projectId);
  return backend && backend.mode === "own" && backend.url ? backend : null;
}

async function state(service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, projectId: string, userId: string) {
  const [{ data: row }, { data: owner }, own] = await Promise.all([
    service
      .from("form_notifications")
      .select("enabled, email, installed_at, last_sent_at")
      .eq("project_id", projectId)
      .maybeSingle<Row>(),
    service.auth.admin.getUserById(userId),
    usesOwnSupabase(service, projectId),
  ]);
  return {
    configured: isEmailConfigured(),
    /* The inbox needs nothing installed: the submit route sends the email. */
    inbox: !own,
    installed: own ? Boolean(row?.installed_at) : true,
    /* With no row yet: off for an own Supabase (nothing is installed there
       until asked), on for the inbox (its first message turns it on). */
    enabled: row ? row.enabled : !own,
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
  const backend = await usesOwnSupabase(service, owned.projectId);
  if (patch.enabled && !row?.installed_at && backend) {
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
    const { error } = row
      ? await service.from("form_notifications").update(patch).eq("project_id", owned.projectId)
      : await service
          .from("form_notifications")
          /* A new row starts as it already behaved: off for an own Supabase,
             on for the inbox — then takes what was asked. */
          /* An upsert, because installing just above creates the row: it
             only sets these columns, so the installed secret is kept. */
          .upsert({ project_id: owned.projectId, user_id: owned.userId, enabled: !backend, ...patch }, { onConflict: "project_id" });
    if (error) return NextResponse.json({ error: `That couldn't be saved: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json(await state(service, owned.projectId, owned.userId));
}
