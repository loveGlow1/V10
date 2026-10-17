import { NextResponse } from "next/server";

import { toCsv, type InboxRow } from "@/lib/forms/inbox";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

/* The project's forms inbox, for its owner. See src/lib/forms/inbox.ts.
 *
 *   GET                 the newest messages, and how many are unread
 *   GET ?format=csv     every message, as a spreadsheet
 *   PATCH { ids?, read }   mark some (or, with no ids, all) read or unread
 *   DELETE { id }       remove one message
 *
 * Ownership is settled under the caller's own session (ownedProject); the
 * reads and writes then go through the service key, scoped to that project. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 200;
const CSV_MAX = 5000;
const COLUMNS = "id, form, name, email, message, data, read_at, created_at";

async function context(id: string) {
  const owned = await ownedProject(id);
  if ("error" in owned) return { error: owned.error };
  const service = createSupabaseServiceClient();
  if (!service) return { error: NextResponse.json({ error: "The inbox is unavailable right now." }, { status: 503 }) };
  return { owned, service };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  if (new URL(request.url).searchParams.get("format") === "csv") {
    const { data } = await service
      .from("form_submissions")
      .select("form, name, email, message, data, created_at")
      .eq("project_id", owned.projectId)
      .order("created_at", { ascending: false })
      .limit(CSV_MAX);
    return new NextResponse(toCsv((data ?? []) as InboxRow[]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="form-messages-${owned.projectId.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const [{ data, error }, { count: unread }, { count: total }] = await Promise.all([
    service
      .from("form_submissions")
      .select(COLUMNS)
      .eq("project_id", owned.projectId)
      .order("created_at", { ascending: false })
      .limit(PAGE),
    service
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", owned.projectId)
      .is("read_at", null),
    service.from("form_submissions").select("id", { count: "exact", head: true }).eq("project_id", owned.projectId),
  ]);
  if (error) return NextResponse.json({ error: "The inbox couldn't be read." }, { status: 500 });

  return NextResponse.json(
    { messages: data ?? [], unread: unread ?? 0, total: total ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; read?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((value): value is string => typeof value === "string").slice(0, PAGE) : null;
  const readAt = body.read === false ? null : new Date().toISOString();

  let query = service.from("form_submissions").update({ read_at: readAt }).eq("project_id", owned.projectId);
  if (ids && ids.length > 0) query = query.in("id", ids);
  else if (readAt) query = query.is("read_at", null);
  const { error } = await query;
  if (error) return NextResponse.json({ error: "That couldn't be saved." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const messageId = typeof body.id === "string" ? body.id : "";
  if (!messageId) return NextResponse.json({ error: "Which message?" }, { status: 400 });

  const { error } = await service
    .from("form_submissions")
    .delete()
    .eq("project_id", owned.projectId)
    .eq("id", messageId);
  if (error) return NextResponse.json({ error: "That message couldn't be deleted." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
