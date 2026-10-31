/* Which keys this deployment has, for its owner: every feature, whether it is
 * on, and the names of what it still needs (lib/keys.ts).
 *
 * Names and booleans only — never a value, never part of one. Even so, which
 * services a deployment runs on is the owner's business: this answers only to
 * a signed-in account whose email is in OWNER_EMAILS (comma-separated), or
 * ALERT_EMAIL when that is not set. */

import { NextResponse } from "next/server";

import { keyStatus, ownerEmails } from "@/lib/keys";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const owners = ownerEmails();
  if (!owners.length) {
    return NextResponse.json({ error: "Set OWNER_EMAILS in Vercel to your email address to see this page.", setup: true }, { status: 403 });
  }
  if (!owners.includes((user.email ?? "").toLowerCase())) return NextResponse.json({ error: "Not available." }, { status: 404 });

  return NextResponse.json(
    { features: keyStatus(), environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
