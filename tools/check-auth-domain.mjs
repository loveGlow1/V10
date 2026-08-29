#!/usr/bin/env node
/* Checks a Supabase custom auth domain end to end.
 *
 *   npm run check:auth-domain                      — checks what NEXT_PUBLIC_SUPABASE_URL points at
 *   npm run check:auth-domain auth.quickstark.tech — checks that host instead
 *
 * Cutting over to a custom auth domain touches four things that are each
 * invisible from the others: DNS, the certificate Supabase issues, the URL the
 * app is built against, and the pair of values registered in the Google
 * console. When sign-in breaks afterwards the failure is always the same shape
 * — one of the four still names the old host — and nothing the browser shows
 * says which one. This runs all four in a single command, so the answer is a
 * line of output rather than an afternoon.
 *
 * Nothing here writes anything: it reads DNS, opens one TLS connection, and
 * makes one GET against the auth server's public health endpoint.
 */

import { promises as dns } from "node:dns";
import { readFileSync } from "node:fs";
import https from "node:https";
import { resolve as resolvePath } from "node:path";

let failures = 0;

function line(mark, text, detail) {
  console.log(`${mark} ${text}${detail ? `\n    ${detail}` : ""}`);
}
const pass = (text, detail) => line("PASS", text, detail);
const info = (text, detail) => line("    ", text, detail);
const warn = (text, detail) => line("WARN", text, detail);
function fail(text, detail) {
  failures += 1;
  line("FAIL", text, detail);
}

/* The app reads these through Next, which layers .env.local over .env. Read
   them the same way, so this agrees with what a build would actually use. */
function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(resolvePath(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/* A DNS query either answers or it does not; one that hangs should not hang
   the rest of the checks. */
async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function get(url, headers) {
  return new Promise((resolveGet, reject) => {
    const request = https.get(url, { headers, timeout: 15000 }, (response) => {
      const certificate = response.socket.getPeerCertificate?.() ?? {};
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolveGet({ status: response.statusCode, body, certificate }));
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

/* A certificate matches a host on its common name or one of its alternative
   names, where a wildcard covers exactly one label. */
function certificateCovers(certificate, host) {
  const candidates = [
    certificate?.subject?.CN,
    ...String(certificate?.subjectaltname ?? "")
      .split(/,\s*/)
      .map((entry) => entry.replace(/^DNS:/, "")),
  ].filter(Boolean);

  return candidates.some((value) => {
    if (value === host) return true;
    return value.startsWith("*.") && host.split(".").slice(1).join(".") === value.slice(2);
  });
}

const configuredUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

let configuredHost;
if (configuredUrl) {
  try {
    configuredHost = new URL(configuredUrl).host;
  } catch {
    // Reported below as a malformed value rather than crashing here.
  }
}

const target = process.argv[2] ?? configuredHost;

if (!target) {
  console.error(
    "No host to check. Set NEXT_PUBLIC_SUPABASE_URL, or pass a hostname:\n" +
      "  npm run check:auth-domain auth.quickstark.tech",
  );
  process.exit(2);
}

console.log(`\nAuth domain: ${target}\n`);

/* 1 — the value the app is actually built against. A custom domain that is
   live but absent from the environment changes nothing a visitor sees. */
if (!configuredUrl) {
  fail("NEXT_PUBLIC_SUPABASE_URL is not set", "The app cannot reach Supabase at all.");
} else if (!configuredHost) {
  fail("NEXT_PUBLIC_SUPABASE_URL is not a URL", configuredUrl);
} else if (!configuredUrl.startsWith("https://")) {
  fail("NEXT_PUBLIC_SUPABASE_URL is not https", configuredUrl);
} else if (configuredHost !== target) {
  warn(
    `NEXT_PUBLIC_SUPABASE_URL still points at ${configuredHost}`,
    `Set it to https://${target} in .env and in Vercel → Settings → Environment Variables, then redeploy.`,
  );
} else {
  pass(`NEXT_PUBLIC_SUPABASE_URL is https://${target}`);
}

if (!anonKey) {
  warn("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set", "The health check below runs without it.");
}

/* 2 — DNS. The CNAME points the host at Supabase; the two TXT records are what
   let Supabase prove ownership and have a certificate issued. Their values come
   out of `supabase domains create`, so they are reported rather than matched —
   what matters here is whether they resolve at all. */
/* The project's own <ref>.supabase.co host is served directly and has no CNAME
   of its own, so demanding one there would report a failure that is not one. */
const isDefaultHost = /\.supabase\.(co|net)$/i.test(target);

const cname = isDefaultHost ? null : await withTimeout(dns.resolveCname(target), 8000);
if (isDefaultHost) {
  info(
    `${target} is the project's default host — no custom domain in use`,
    "See docs/AUTH-DOMAIN.md to put auth.quickstark.tech here instead.",
  );
} else if (cname && cname.length > 0) {
  const supabaseTarget = cname.find((value) => /\.supabase\.(co|net)$/i.test(value));
  if (supabaseTarget) {
    pass(`CNAME ${target} -> ${supabaseTarget}`);
  } else {
    fail(`CNAME ${target} -> ${cname.join(", ")}`, "Expected a <project-ref>.supabase.co target.");
  }
} else {
  fail(`No CNAME for ${target}`, `Add:  CNAME  ${target}  ->  <project-ref>.supabase.co`);
}

for (const prefix of isDefaultHost ? [] : ["_cf-custom-hostname", "_acme-challenge"]) {
  const name = `${prefix}.${target}`;
  const txt = await withTimeout(dns.resolveTxt(name), 8000);
  if (txt && txt.length > 0) {
    info(`TXT ${name} present (${txt.length} record${txt.length === 1 ? "" : "s"})`);
  } else {
    info(`TXT ${name} not visible — needed while verifying, harmless once issued`);
  }
}

/* 3 — the certificate, and the auth server behind it. /auth/v1/health is public
   and names the service, so a 200 mentioning GoTrue is proof the host is served
   by Supabase rather than by a parked page on the same name. */
try {
  const response = await get(
    `https://${target}/auth/v1/health`,
    anonKey ? { apikey: anonKey } : undefined,
  );

  if (certificateCovers(response.certificate, target)) {
    pass(`TLS certificate covers ${target}`, `issued to ${response.certificate?.subject?.CN ?? "—"}`);
  } else {
    fail(
      `TLS certificate does not cover ${target}`,
      `issued to ${response.certificate?.subject?.CN ?? "—"}`,
    );
  }

  if (response.status === 200 && /gotrue|supabase/i.test(response.body)) {
    pass(`Auth server answers on ${target}`, response.body.trim().slice(0, 160));
  } else {
    fail(
      `/auth/v1/health returned ${response.status}`,
      response.body.trim().slice(0, 160) || "empty response",
    );
  }
} catch (error) {
  fail(`Could not reach https://${target}/auth/v1/health`, String(error?.message ?? error));
}

/* 4 — the two values that have to be typed into someone else's console. They
   cannot be read from here, so they are printed to be checked by eye. */
console.log("\nRegister these in the Google Cloud console (APIs & Services -> Credentials):");
console.log(`  Authorised JavaScript origin   https://${target}`);
console.log(`  Authorised redirect URI        https://${target}/auth/v1/callback`);
console.log("\nSupabase -> Authentication -> URL Configuration still names the site, not this host:");
console.log("  Site URL                       https://www.quickstark.tech");
console.log("  Redirect URLs                  https://www.quickstark.tech/auth/callback\n");

if (failures > 0) {
  console.log(`${failures} check${failures === 1 ? "" : "s"} failed.\n`);
  process.exit(1);
}
console.log("All automatic checks passed.\n");
