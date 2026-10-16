/* The approval token: the only thing that lets a write reach a database.
 *
 * Issued by the server at the moment a person presses Approve on a surgery
 * card, under their own session, and spent in the same request. It is bound
 * to everything that could be swapped after the person looked:
 *
 *   project   this app, and no other
 *   ref       this Supabase project, and no other
 *   action    apply_migration | create_project | update_auth_config
 *   hash      sha256 of the exact SQL (or payload) that was shown
 *   subject   the surgery row it approves
 *   nonce     recorded on use, so a token works once
 *   expiry    five minutes
 *
 * The model never sees one. Nothing the model can produce is a token, and the
 * chat path can only PLAN — see tools.ts.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ApprovalAction = "apply_migration" | "create_project" | "update_auth_config";

export type ApprovalClaims = {
  projectId: string;
  ref: string;
  action: ApprovalAction;
  hash: string;
  subject: string;
  nonce: string;
  expiresAt: number;
};

const LIFETIME_MS = 5 * 60_000;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function key(): Buffer | null {
  const secret =
    process.env.DB_AGENT_APPROVAL_SECRET ||
    process.env.SUPABASE_OAUTH_CLIENT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret ? createHash("sha256").update(`quickstark-db-approval:${secret}`).digest() : null;
}

export function issueApproval(input: Omit<ApprovalClaims, "nonce" | "expiresAt">, now = Date.now()): { token: string; claims: ApprovalClaims } | null {
  const k = key();
  if (!k) return null;
  const claims: ApprovalClaims = { ...input, nonce: randomBytes(16).toString("base64url"), expiresAt: now + LIFETIME_MS };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", k).update(body).digest("base64url");
  return { token: `${body}.${mac}`, claims };
}

export type Verified = { ok: true; claims: ApprovalClaims } | { ok: false; reason: string };

/**
 * Checks a token against what is about to run. The nonce is NOT consumed
 * here — the caller records it atomically (a unique insert) and only then runs.
 */
export function verifyApproval(
  token: string | null | undefined,
  expected: { projectId: string; ref: string; action: ApprovalAction; hash: string; subject: string },
  now = Date.now(),
): Verified {
  const k = key();
  if (!k) return { ok: false, reason: "approvals are not configured on this deployment" };
  if (!token || !token.includes(".")) return { ok: false, reason: "no approval was given" };
  const [body, mac] = token.split(".");
  const want = createHmac("sha256", k).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "the approval is not genuine" };
  let claims: ApprovalClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ApprovalClaims;
  } catch {
    return { ok: false, reason: "the approval could not be read" };
  }
  if (claims.expiresAt < now) return { ok: false, reason: "the approval expired — approve it again" };
  if (claims.projectId !== expected.projectId) return { ok: false, reason: "the approval is for a different app" };
  if (claims.ref !== expected.ref) return { ok: false, reason: "the approval is for a different database" };
  if (claims.action !== expected.action) return { ok: false, reason: "the approval is for a different action" };
  if (claims.subject !== expected.subject) return { ok: false, reason: "the approval is for a different change" };
  if (claims.hash !== expected.hash) return { ok: false, reason: "the SQL changed after it was approved" };
  return { ok: true, claims };
}
