/* The QuickStark forms inbox.
 *
 * A landing page's contact form, waitlist, RSVP or newsletter box needs
 * somewhere to send what people type — and nothing else. Making the owner
 * connect a database first, before a form on a brochure site can work, was
 * the one step between "build me a landing page" and a page that does its job.
 *
 * So a page that has no database of its own posts its forms here: one table in
 * QuickStark's own database, written only by the server, read only by the
 * project's owner (the Database panel, an email per message, a CSV). A page
 * whose owner HAS connected their Supabase keeps sending there instead — see
 * page-data.ts; this is the default, not a replacement.
 *
 * Everything in this file is pure — the rules for what a submission may hold,
 * how fast one address may send, and how the inbox exports — so
 * tools/check-forms-inbox.mjs exercises it without a network or a database. */

import { createHash } from "node:crypto";

/** Where a page posts. Absolute in the page, because a published site is on
    another origin, and the preview runs in an opaque one. */
export const SUBMIT_PATH = "/api/forms/submit";

/** The hidden field a person never sees and a bot fills in. */
export const HONEYPOT = "_hp";

/* What one submission may hold. Generous for a real form, small enough that
   the endpoint cannot be used as free storage. */
const LIMITS = { form: 60, name: 120, email: 320, message: 5000, key: 40, value: 1000, keys: 30, bytes: 20_000 };

export type Submission = {
  project: string;
  form: string;
  email: string | null;
  name: string | null;
  message: string | null;
  data: Record<string, string | number | boolean>;
};

export type Parsed =
  | { ok: true; value: Submission }
  /* A bot that filled the honeypot is answered exactly like a person, so it
     learns nothing; `spam` tells the route not to store it. */
  | { ok: false; reason: string; spam?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\u0000/g, "").trim();
  return text ? text.slice(0, max) : null;
}

/** Reads and cleans what a page sent. Never throws. */
export function parseSubmission(raw: unknown, rawLength = 0): Parsed {
  if (rawLength > LIMITS.bytes) return { ok: false, reason: "That message is too long." };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "Nothing was sent." };
  const body = raw as Record<string, unknown>;

  const project = typeof body.project === "string" ? body.project.trim() : "";
  if (!UUID.test(project)) return { ok: false, reason: "This form isn't connected to a site." };

  if (clip(body[HONEYPOT], 200)) return { ok: false, reason: "spam", spam: true };

  const emailText = clip(body.email, LIMITS.email);
  if (emailText && !EMAIL.test(emailText)) return { ok: false, reason: "That email address doesn't look right." };

  const data: Record<string, string | number | boolean> = {};
  const extra = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(extra).slice(0, LIMITS.keys)) {
    const name = clip(key, LIMITS.key);
    if (!name || name === HONEYPOT) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) data[name] = value;
    else {
      const text = clip(value, LIMITS.value);
      if (text) data[name] = text;
    }
  }

  const value: Submission = {
    project,
    form: clip(body.form, LIMITS.form)?.toLowerCase() ?? "contact",
    email: emailText,
    name: clip(body.name, LIMITS.name),
    message: clip(body.message, LIMITS.message),
    data,
  };

  if (!value.email && !value.name && !value.message && Object.keys(value.data).length === 0) {
    return { ok: false, reason: "The form was empty." };
  }
  return { ok: true, value };
}

/* ── How fast one sender may go ─────────────────────────────────────────
   Five from one address in ten minutes is a person resending; more is not.
   A project's whole inbox takes up to 300 an hour, so a flood on one site
   cannot fill the table for everyone. */
export const PER_SENDER = { max: 5, windowMs: 10 * 60 * 1000 };
export const PER_PROJECT = { max: 300, windowMs: 60 * 60 * 1000 };

/** The sender's address as a one-way token: enough to count, never stored raw. */
export function senderToken(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip || "unknown"}`).digest("hex").slice(0, 32);
}

/** Whether one more fits, given how many already arrived in each window. */
export function withinLimits(counts: { sender: number; project: number }): boolean {
  return counts.sender < PER_SENDER.max && counts.project < PER_PROJECT.max;
}

/* ── Exporting ────────────────────────────────────────────────────────── */

export type InboxRow = {
  created_at: string;
  form: string;
  name: string | null;
  email: string | null;
  message: string | null;
  data: Record<string, unknown> | null;
};

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  /* A cell starting with = + - @ is run as a formula by spreadsheet apps; a
     visitor controls this text, so it is defused with a leading quote. */
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The inbox as CSV, with a column for every extra field any row has. */
export function toCsv(rows: InboxRow[]): string {
  const extra: string[] = [];
  for (const row of rows) for (const key of Object.keys(row.data ?? {})) if (!extra.includes(key)) extra.push(key);
  const head = ["received", "form", "name", "email", "message", ...extra];
  const lines = rows.map((row) =>
    [row.created_at, row.form, row.name, row.email, row.message, ...extra.map((key) => row.data?.[key])].map(csvCell).join(","),
  );
  return [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

/* ── What the page editor is told ─────────────────────────────────────── */

/**
 * How a page with no database of its own sends its forms. Plain fetch from the
 * page to QuickStark's inbox — no keys, no client library, nothing to set up.
 */
export function inboxBrief(input: { projectId: string; siteUrl: string }): string {
  const url = `${input.siteUrl.replace(/\/+$/, "")}${SUBMIT_PATH}`;
  return [
    "FORMS ON THIS PAGE GO TO THE OWNER'S QUICKSTARK INBOX — already set up, nothing to configure.",
    "Wire every form that collects what a visitor types (contact, waitlist, newsletter, RSVP, quote request) to it. Do not invent any other backend, endpoint, service or key.",
    "",
    "How, exactly:",
    `- On submit: preventDefault, then fetch(${JSON.stringify(url)}, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ project: ${JSON.stringify(input.projectId)}, form, name, email, message, data, ${HONEYPOT} }) }).`,
    "  The Content-Type is text/plain on purpose: it lets the request go straight through from any site. Do not change it.",
    "  form: a short name for which form this is (\"contact\", \"waitlist\", \"rsvp\"). name, email, message: strings or omitted.",
    "  data: an object holding every other field the form asks for (a subject goes in data.topic). Only these keys exist.",
    `- Add a hidden honeypot input named ${HONEYPOT} (visually hidden with CSS, tabindex=\"-1\", autocomplete=\"off\") and send its value as ${HONEYPOT}. People leave it empty; bots fill it in.`,
    "- While sending, disable the button and show that it is sending. If the response is ok, replace the form with a short thank-you. Otherwise keep what they typed and show a one-line message to try again.",
    "- Use required and type=\"email\" on inputs so bad input is caught before it is sent.",
  ].join("\n");
}
