/* An email to the owner when somebody sends their page's form.
 *
 * The message is saved in the owner's own Supabase — see page-data.ts — and
 * stays there. What this adds is the knock on the door: a trigger in THEIR
 * database that, after a row really lands, asks QuickStark to email them.
 *
 *   visitor → their Supabase (row saved) → trigger → /api/forms/notify
 *           → QuickStark checks the secret → email from notifications@quickstark.tech
 *
 * Why a trigger and not the page calling us: anybody can call an endpoint a
 * page calls, with anything in the body. Only a row that actually landed in
 * their table fires a trigger, and the trigger carries a secret the page never
 * sees. Nothing to connect for the owner — the email goes to the address they
 * signed up with unless they choose another.
 *
 * The trigger can never cost them a message: pg_net queues the request after
 * the insert, and any error inside it is swallowed rather than rolling the
 * insert back.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackendConnection } from "./connection";
import { runnerFor } from "./schema-sync";
import { OWNED_MARK } from "../schema";
import { SITE_URL } from "@/lib/site";

export const NOTIFY_PATH = "/api/forms/notify";
export const NOTIFY_FROM_DEFAULT = "QuickStark <notifications@quickstark.tech>";

/** How many emails one project may send in a rolling hour. */
export const HOURLY_LIMIT = 30;

const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export function newSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Whether a presented secret matches the stored hash, in constant time. */
export function secretMatches(presented: string, storedHash: string | null): boolean {
  if (!storedHash || !presented) return false;
  const a = Buffer.from(hashSecret(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The SQL that installs the trigger in their database.
 *
 * Idempotent — `create or replace` throughout, no drops — so it runs again on
 * every change to the page, each time with a fresh secret.
 */
export function notifySql(input: {
  schema: string;
  table: string;
  projectId: string;
  secret: string;
  url?: string;
}): string {
  if (!SAFE_IDENT.test(input.schema) || !SAFE_IDENT.test(input.table)) {
    throw new Error("notifySql: unsafe identifier");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.projectId) || !/^[0-9a-f]{64}$/.test(input.secret)) {
    throw new Error("notifySql: unexpected project id or secret");
  }
  const url = input.url ?? `${SITE_URL}${NOTIFY_PATH}`;
  const fn = `${input.schema}.quickstark_notify_${input.table}`;

  return [
    "-- Sends QuickStark a note when a form row lands, so the owner gets an email.",
    "-- The row itself stays here; only the note leaves.",
    "create extension if not exists pg_net with schema extensions;",
    "",
    `create or replace function ${fn}()`,
    "returns trigger",
    "language plpgsql",
    "security definer",
    `set search_path = ${input.schema}, extensions, public`,
    "as $$",
    "begin",
    "  perform net.http_post(",
    `    url := ${literal(url)},`,
    `    body := jsonb_build_object('project', ${literal(input.projectId)}, 'table', ${literal(input.table)}, 'record', to_jsonb(new)),`,
    `    headers := jsonb_build_object('content-type', 'application/json', 'x-quickstark-secret', ${literal(input.secret)}),`,
    "    timeout_milliseconds := 5000",
    "  );",
    "  return new;",
    "exception when others then",
    "  -- A notification must never cost the message.",
    "  return new;",
    "end;",
    "$$;",
    "",
    `comment on function ${fn}() is ${literal(`${OWNED_MARK} emails the app owner (via QuickStark) when a form row is saved.`)};`,
    `revoke all on function ${fn}() from public, anon, authenticated;`,
    "",
    `create or replace trigger quickstark_notify`,
    `  after insert on ${input.schema}.${input.table}`,
    `  for each row execute function ${fn}();`,
  ].join("\n");
}

/**
 * Installs the trigger on their Supabase and records the secret's hash here.
 *
 * Never throws. A page whose notifications could not be set up still saves
 * every message; the reason comes back to be said.
 */
export async function installFormNotifications(
  service: SupabaseClient,
  input: { projectId: string; userId: string; connection: BackendConnection; schema: string; table: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const runner = await runnerFor(service, input.connection, input.projectId);
  if (!runner) return { ok: false, reason: "this database can't be reached to set up notifications" };

  const secret = newSecret();
  try {
    const ran = await runner.query(
      notifySql({ schema: input.schema, table: input.table, projectId: input.projectId, secret }),
    );
    if (!ran.ok) return { ok: false, reason: ran.reason };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "the trigger could not be installed" };
  } finally {
    await runner.close().catch(() => undefined);
  }

  /* After the trigger, so a secret is only ever recorded for a trigger that
     exists. Enabled and email are left as the owner set them. */
  const { data: existing } = await service
    .from("form_notifications")
    .select("project_id")
    .eq("project_id", input.projectId)
    .maybeSingle();

  const { error } = existing
    ? await service
        .from("form_notifications")
        .update({ secret_hash: hashSecret(secret), installed_at: new Date().toISOString() })
        .eq("project_id", input.projectId)
    : await service.from("form_notifications").insert({
        project_id: input.projectId,
        user_id: input.userId,
        enabled: true,
        secret_hash: hashSecret(secret),
        installed_at: new Date().toISOString(),
      });

  if (error) return { ok: false, reason: `notifications could not be recorded: ${error.message}` };
  return { ok: true };
}

/* ── The email ─────────────────────────────────────────────────────────── */

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function validEmail(value: unknown): string | null {
  const email = clip(value, 320);
  return email && EMAIL.test(email) ? email : null;
}

/** What the owner is sent, from the row that landed. Plain text, nothing rendered. */
export function composeNotification(input: {
  projectName: string;
  record: Record<string, unknown>;
  dashboardUrl: string | null;
}): { subject: string; text: string; replyTo: string | null } {
  const record = input.record;
  const data =
    record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};

  const name = clip(record.name, 120);
  const email = validEmail(record.email);
  const form = clip(record.form, 60) ?? "form";
  const topic = clip(data.topic ?? data.subject, 120);
  const who = name ?? email ?? "someone";
  const site = clip(input.projectName, 80) ?? "your site";

  const subject = `New ${form} message from ${who}${topic ? ` — ${topic}` : ""} (${site})`.slice(0, 200);

  const lines = [`${who} sent the ${form} form on ${site}.`, ""];
  if (name) lines.push(`Name: ${name}`);
  if (email) lines.push(`Email: ${email}`);
  for (const [key, value] of Object.entries(data).slice(0, 20)) {
    const shown =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? clip(String(value), 500)
        : null;
    if (shown) lines.push(`${clip(key, 40)}: ${shown}`);
  }
  const message = typeof record.message === "string" ? record.message.trim().slice(0, 5000) : "";
  if (message) lines.push("", "Message:", message);
  lines.push(
    "",
    "—",
    email ? "Reply to this email to answer them directly." : "They didn't leave an email address.",
    `Every message is saved in your own Supabase, in the submissions table${
      input.dashboardUrl ? `: ${input.dashboardUrl}` : "."
    }`,
    "You're getting this because email notifications are on for this app in QuickStark (Database panel).",
  );

  return { subject, text: lines.join("\n"), replyTo: email };
}

/** Sends one email through Resend. */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, reason: "RESEND_API_KEY is not set" };
  const from = process.env.FORM_NOTIFY_FROM?.trim() || NOTIFY_FROM_DEFAULT;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, reason: `Resend answered ${response.status}: ${await response.text()}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "the email could not be sent" };
  }
}

export const isEmailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

/**
 * Whether one more email fits in this project's rolling hour, and the window
 * to store. The email that fills the hour says so, and the rest are held back.
 */
export function nextWindow(
  row: { window_start: string | null; window_count: number },
  now: Date,
): { send: boolean; last: boolean; window_start: string; window_count: number } {
  const start = row.window_start ? new Date(row.window_start) : null;
  const fresh = !start || now.getTime() - start.getTime() >= 60 * 60 * 1000;
  const count = fresh ? 0 : row.window_count;
  if (count >= HOURLY_LIMIT) {
    return { send: false, last: false, window_start: start!.toISOString(), window_count: count };
  }
  return {
    send: true,
    last: count + 1 === HOURLY_LIMIT,
    window_start: fresh ? now.toISOString() : start!.toISOString(),
    window_count: count + 1,
  };
}
