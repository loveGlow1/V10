#!/usr/bin/env node
/* What a failed provision says, and whether anybody could act on it.
 *
 *   npm run check:provision-diagnosis
 *
 * For a day, the whole answer to "why are my app's tables missing" was:
 *
 *     getaddrinfo ENOTFOUND db.esuatccbicekcohzgcvd.supabase.co
 *
 * True, unreadable, and — the part that matters — not ambiguous. The hostname
 * is in the connection string the platform was handed. A db.<ref>.supabase.co
 * that will not resolve is Supabase's direct endpoint, which publishes only an
 * IPv6 address, on a platform with no IPv6 egress. One cause, one fix, both
 * derivable without connecting to anything. Nobody said either, and every
 * project built in that time got no tables.
 *
 * These assert two things, and the second matters as much as the first:
 *
 *   WHEN THE STRING SETTLES IT, say so — name the cause and the remedy.
 *   WHEN IT DOES NOT, say nothing. An explanation attached to a failure it
 *   does not explain sends somebody to fix the wrong thing, which is worse
 *   than the raw message they would otherwise have read and searched for.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-provision-diagnosis");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: {
    noEmit: false, outDir: out, rootDir: join(root, "src"),
    module: "commonjs", moduleResolution: "node",
    declaration: false, incremental: false, plugins: [],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  include: [join(root, "src/lib/builder/backend/provision.ts")],
}, null, 2));
try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "pipe"] });
} catch {
  /* The emit is what matters; real type errors are caught by the repo's own
     tsc --noEmit, which this does not replace. */
}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { execFileSync("ln", ["-sfn", out, join(shim, "@")]); } catch { /* already there */ }

const require = createRequire(import.meta.url);
const { diagnose } = require(join(out, "lib/builder/backend/provision.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const DIRECT = "postgresql://postgres:secret@db.esuatccbicekcohzgcvd.supabase.co:5432/postgres";
const SESSION = "postgresql://postgres.esuatccbicekcohzgcvd:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const TXN = "postgresql://postgres.esuatccbicekcohzgcvd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

// ── The real one ──────────────────────────────────────────────────────────
//
// Verbatim, from project_backends.last_error, on four separate projects.

const REAL = "getaddrinfo ENOTFOUND db.esuatccbicekcohzgcvd.supabase.co";
const said = diagnose(DIRECT, REAL);

has(said !== "", "THE ONE: the real failure is explained at all");
has(/direct/i.test(said), "it names the direct endpoint as the cause");
has(/IPv6/i.test(said), "it says why that endpoint cannot be reached");
has(/session pooler/i.test(said), "it names the fix");
has(said.includes("postgres.esuatccbicekcohzgcvd"),
  "it spells the pooler username with THIS project's ref, not a placeholder");
has(/5432/.test(said), "it gives the right port");
has(!said.includes("secret"), "and it never repeats the password back");

/* Appended, not substituted. The driver's words are what somebody pastes into
   a search engine, and they must survive. */
has(diagnose(DIRECT, REAL).startsWith("\n\n"),
  "the explanation is appended — the raw message is not replaced");

// ── The other certainties ─────────────────────────────────────────────────

const auth = diagnose(SESSION, 'password authentication failed for user "postgres"');
has(/postgres\.<project-ref>|postgres\.<ref>/i.test(auth) || /username/i.test(auth),
  "on the pooler, a rejected password points at the username first",
  "switching to the pooler and keeping `postgres` is the usual cause");

const authDirect = diagnose(DIRECT, "password authentication failed for user \"postgres\"");
has(/percent-encoded/i.test(authDirect),
  "elsewhere it points at characters that must be encoded in a URL");

has(/transaction pooler/i.test(diagnose(TXN, "syntax error at or near \"set\"")),
  "port 6543 is named as the transaction pooler, which cannot run a migration");

const other = diagnose("postgresql://postgres:secret@example.internal:5432/postgres",
  "getaddrinfo ENOTFOUND example.internal");
has(other.includes("example.internal") && !/IPv6/i.test(other),
  "an unrelated host that will not resolve is not blamed on IPv6");

// ── Silence where there is nothing certain ────────────────────────────────
//
// This half is the discipline. An explanation attached to a failure it does
// not explain sends somebody to fix something that is not broken.

for (const [label, dsn, message] of [
  ["a timeout", SESSION, "Connection terminated due to connection timeout"],
  ["a server error", SESSION, "terminating connection due to administrator command"],
  ["a real SQL error", SESSION, 'relation "profiles" does not exist'],
  ["something unrecognised", SESSION, "socket hang up"],
  ["an empty message", SESSION, ""],
]) {
  has(diagnose(dsn, message) === "", `${label} is left to speak for itself`);
}

/* A direct endpoint that fails for a reason OTHER than name resolution is not
   the IPv6 problem, and must not be described as it. */
has(diagnose(DIRECT, "Connection terminated due to connection timeout") === "",
  "even the direct endpoint is only blamed when the failure is DNS");

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
