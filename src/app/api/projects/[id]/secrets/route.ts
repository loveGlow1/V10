import { NextResponse } from "next/server";

import { existingVercelProject } from "@/lib/publish/deployment-store";
import {
  deploymentName,
  projectSecretNames,
  removeProjectSecret,
  secretKeyProblem,
  setProjectSecret,
  vercelCredentials,
} from "@/lib/publish/vercel-deploy";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

/* The keys a project's server code needs and its visitors must never see.
 *
 * ── Nothing here is stored by QuickStark ──────────────────────────────────
 *
 * There is no table behind this route and that is the design rather than an
 * omission. A secret arrives, goes to Vercel, and is dropped: Vercel encrypts
 * it at rest and decrypts it into the build and the running function, which is
 * the only place it is needed. A copy held here would be a second thing to
 * breach for no benefit — and this database holds customers' projects, which
 * is enough responsibility for one table.
 *
 * So the LIST is read back from Vercel too. That makes it true: it says what is
 * really set on the project, rather than what we remember setting. And it means
 * a key removed in Vercel's own dashboard disappears from here, which is the
 * behaviour somebody would expect and the opposite of what a mirrored table
 * would do.
 *
 * Values are never returned. Vercel will not give them back and this would not
 * ask: a secret that can be read out of the interface that set it is a secret
 * with an extra way to leak.
 *
 * ── Why a project that has never deployed still works ─────────────────────
 *
 * The Vercel project is created on demand — see setProjectSecret, which ensures
 * it before writing. Somebody pastes their Stripe key and then publishes, in
 * that order, far more often than the reverse.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { key?: unknown; value?: unknown };

/* Which Vercel project this is, by the same rule everything else uses: the name
   the first deployment recorded, or the one derived from the title when there
   has not been one. Deriving it twice differently is how a project ends up with
   its keys on one Vercel project and its code on another. */
async function vercelProjectFor(projectId: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  if (!service) return null;

  const existing = await existingVercelProject(service, projectId);
  if (existing) return existing;

  const { data } = await service
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle<{ name: string | null }>();

  return deploymentName(data?.name ?? "app", projectId);
}

function unavailable() {
  return NextResponse.json(
    { error: "Server keys need Vercel, and this installation of QuickStark has no API token." },
    { status: 503 },
  );
}

/** The names of the keys set on this project. Never the values. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const creds = vercelCredentials();
  if (!creds) return NextResponse.json({ keys: [], configured: false });

  const name = await vercelProjectFor(owned.projectId);
  if (!name) return NextResponse.json({ keys: [], configured: true });

  return NextResponse.json({ keys: await projectSecretNames(name, creds), configured: true });
}

/** Sets one. The value is used and not kept. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const body = (await request.json().catch(() => ({}))) as Body;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const value = typeof body.value === "string" ? body.value : "";

  /* Checked here as well as in setProjectSecret, so the refusal comes back
     before the value has been anywhere. The important one is NEXT_PUBLIC_:
     accepting it would mark a secret encrypted on Vercel and then publish it in
     the customer's own bundle, having told them it was safe. */
  const problem = secretKeyProblem(key);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  if (value.trim().length === 0) {
    return NextResponse.json({ error: "Paste the value for that key." }, { status: 422 });
  }

  const creds = vercelCredentials();
  if (!creds) return unavailable();

  const name = await vercelProjectFor(owned.projectId);
  if (!name) return unavailable();

  const set = await setProjectSecret(name, key, value, creds);
  if (!set.ok) return NextResponse.json({ error: set.reason }, { status: 502 });

  return NextResponse.json({
    keys: await projectSecretNames(name, creds),
    /* Said rather than assumed. A key set now reaches the running site at the
       next deployment and not before, and somebody who pastes a key and sees
       their site behave the same way should be told why. */
    note: "Saved. It reaches your site the next time you publish.",
  });
}

/** Takes one off. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!key) return NextResponse.json({ error: "No key was named." }, { status: 400 });

  const creds = vercelCredentials();
  if (!creds) return unavailable();

  const name = await vercelProjectFor(owned.projectId);
  if (!name) return unavailable();

  const removed = await removeProjectSecret(name, key, creds);
  if (!removed.ok) return NextResponse.json({ error: removed.reason }, { status: 502 });

  return NextResponse.json({ keys: await projectSecretNames(name, creds) });
}
