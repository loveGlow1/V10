import { NextResponse } from "next/server";
import Stripe from "stripe";

import { receiptUrlFor } from "@/lib/stripe-receipts";
import { stripeSecretKey } from "@/lib/stripe-key";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* GET ?line=<ledger id> — to Stripe's hosted receipt for a card payment in
 * the signed-in account's history (a top-up or a plan's month). The line is
 * read with the person's own session, so RLS ("Owners read their ledger")
 * decides whose it can be; the receipt is found from what Stripe holds for
 * it (lib/stripe-receipts.ts). Crypto payments are receipted by email. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const line = new URL(request.url).searchParams.get("line") ?? "";
  if (!UUID.test(line)) return NextResponse.json({ error: "No such payment." }, { status: 400 });
  const secretKey = stripeSecretKey();
  if (!secretKey) return NextResponse.json({ error: "Billing is not set up on this deployment yet." }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data } = await supabase.from("credit_ledger").select("dedupe_key").eq("id", line).eq("user_id", user.id).maybeSingle();
  const key = (data as { dedupe_key?: string | null } | null)?.dedupe_key ?? null;
  if (!key?.startsWith("stripe:")) return NextResponse.json({ error: "There is no card receipt for that line." }, { status: 404 });

  const url = await receiptUrlFor(new Stripe(secretKey), key).catch(() => null);
  if (!url) return NextResponse.json({ error: "Stripe has no receipt for that payment yet. Try again in a minute." }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
