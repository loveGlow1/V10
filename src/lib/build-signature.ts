import { createHmac, timingSafeEqual } from "node:crypto";

/* How the build endpoint knows a request really came from a build this app
 * started.
 *
 * The chain is app → n8n → app: /api/build calls the orchestrator, and one of
 * the orchestrator's nodes calls back to /api/builder/webapp/generate. That
 * second call carries no session — n8n is making it, not the browser — and it
 * spends money on a model call and writes a row into someone's workspace. So it
 * has to prove two things: that it came from this app, and which project and
 * user it is allowed to write to.
 *
 * A shared header would prove the first but not the second: anyone holding the
 * secret could then generate into any project. Instead /api/build signs the
 * three ids it has already checked ownership of, and n8n carries the signature
 * through as an opaque field. The endpoint re-derives it. n8n never learns
 * anything it can use to address a different project, because the signature
 * only matches the ids it was made for.
 *
 * The secret is N8N_WEBHOOK_TOKEN, already shared with n8n for the webhook's
 * Header Auth. Reusing it adds no new exposure — n8n is the trusted caller
 * either way — and it is one fewer value to keep in step across two systems. */

/* Long enough for a slow build to finish, short enough that a signature caught
   in an n8n execution log is not a standing key to someone's workspace. The
   whole chain has 60 seconds to run; five minutes is generous. */
const MAX_AGE_MS = 5 * 60 * 1000;

export type BuildClaim = {
  requestId: string;
  projectId: string;
  userId: string;
};

function secret(): string | undefined {
  return process.env.N8N_WEBHOOK_TOKEN;
}

/* Newline-joined rather than concatenated: "ab" + "c" and "a" + "bc" are the
   same string, so a separator is what stops one field's tail from being read as
   the next field's head. */
function payload(claim: BuildClaim, issuedAt: number): string {
  return [claim.requestId, claim.projectId, claim.userId, String(issuedAt)].join("\n");
}

/** Signs a claim, or returns null when no secret is configured. */
export function signBuildClaim(claim: BuildClaim): string | null {
  const key = secret();
  if (!key) return null;

  const issuedAt = Date.now();
  const mac = createHmac("sha256", key).update(payload(claim, issuedAt)).digest("hex");
  return `${issuedAt}.${mac}`;
}

/**
 * Whether `signature` was made by {@link signBuildClaim} for exactly this claim
 * and has not expired.
 */
export function verifyBuildClaim(claim: BuildClaim, signature: unknown): boolean {
  const key = secret();
  /* No secret means nothing can be verified. Refusing rather than waving it
     through is the only safe reading: an unsigned caller is exactly what this
     exists to stop. */
  if (!key || typeof signature !== "string") return false;

  const [issuedAtRaw, mac] = signature.split(".");
  const issuedAt = Number(issuedAtRaw);
  if (!mac || !Number.isFinite(issuedAt)) return false;

  /* Both directions. A future timestamp is not a clock to be trusted — it is a
     signature that would outlive its window. */
  if (Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) return false;

  const expected = createHmac("sha256", key).update(payload(claim, issuedAt)).digest("hex");

  /* Compared byte by byte in constant time. Lengths first, because
     timingSafeEqual throws on a mismatch rather than returning false. */
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
