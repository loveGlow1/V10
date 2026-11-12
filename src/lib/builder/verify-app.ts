/* The test a web app with sign-in must pass before it is called Built.
 *
 * A real browser opens the app as it was built — the same document the
 * workspace preview runs, pointed at the app's real database — and does what
 * a first customer does:
 *
 *   1. the app opens
 *   2. the sign-in page has a password field
 *   3. a test member signs in, and is taken somewhere other than sign-in
 *   4. the dashboard opens for them, without a database error on it
 *   5. they fill in a form and save it, and the row is in the database
 *
 * The test member is made directly in the app's own auth (see
 * verify-run.ts), already confirmed, so an app whose Supabase asks new
 * members to confirm their email can still be tested; that the sign-up itself
 * writes what it should is what live-check.ts tests, in the database.
 *
 * This file is pure: what to test, the script the browser runs, and how a
 * result reads. Nothing here touches the network. */

import type { ArchitectureManifest } from "./architecture";
import type { FileTree } from "./tree";
import { routesOf } from "./preview/routes";

/** How many times a failing app is repaired and tested again before it is handed back as failed. */
export const REPAIR_ROUNDS = 2;

/** Whether a build must pass the test to be Built: a project of files, with members and a database. */
export function needsVerification(manifest: Pick<ArchitectureManifest, "authentication" | "database"> | null | undefined, tree: FileTree): boolean {
  return Boolean(manifest?.authentication && manifest.database && tree.length > 0);
}

export type TestRoutes = {
  login: string;
  dashboard: string | null;
  /** Where a form that saves something might be, in the order they are tried. */
  forms: string[];
  /** Which file renders each address, for the repair. */
  files: Record<string, string>;
};

const LOGIN = /^\/(?:login|log-in|signin|sign-in|auth(?:\/login|\/sign-?in)?|account\/login)$/i;
const SIGNUP = /^\/(?:signup|sign-up|register|join|auth\/sign-?up)$/i;
const DASHBOARD = /^\/(?:dashboard|app|account|portal|admin|home|my-[a-z-]+)$/i;
const FORMISH = /\/(?:new|create|add|book|submit|compose)$/i;

/** The addresses the test visits, read off the project's own routes. Null when it has no sign-in page. */
export function testRoutes(tree: FileTree): TestRoutes | null {
  const routes = routesOf(tree).filter((route) => !route.dynamic);
  const files: Record<string, string> = {};
  for (const route of routes) files[route.pattern] = route.file;
  const login = routes.find((route) => LOGIN.test(route.pattern)) ?? routes.find((route) => SIGNUP.test(route.pattern));
  if (!login) return null;
  const dashboard =
    routes.find((route) => route.pattern === "/dashboard") ??
    routes.find((route) => DASHBOARD.test(route.pattern)) ??
    routes.find((route) => route.pattern.startsWith("/dashboard/")) ??
    null;
  const forms = [
    ...(dashboard ? [dashboard.pattern] : []),
    ...routes
      .filter((route) => route.pattern !== dashboard?.pattern && FORMISH.test(route.pattern))
      .map((route) => route.pattern),
    ...routes
      .filter((route) => route.pattern !== dashboard?.pattern && route.pattern.startsWith("/dashboard/") && !FORMISH.test(route.pattern))
      .map((route) => route.pattern),
  ].slice(0, 5);
  return { login: login.pattern, dashboard: dashboard?.pattern ?? null, forms, files };
}

export type StepName = "opens" | "sign-in page" | "sign in" | "dashboard" | "save";

export type BrowserStep = { name: StepName; ok: boolean; detail?: string };

export type BrowserRun = {
  steps: BrowserStep[];
  /** Errors the page threw while it ran. */
  errors: string[];
  /** Where the app was when the run ended. */
  path: string | null;
  /** What was on screen then, trimmed. */
  text: string;
  /** The address whose form was saved, when one was. */
  formPath: string | null;
};

/* Text on a screen that means the database refused the app. */
export const DATABASE_TROUBLE =
  /could not find the (?:table|relation)|relation "[^"]+" does not exist|permission denied for|row-level security|violates row-level|schema cache|JWT expired|Failed to fetch|Something went wrong/i;

/* Run by Browserless (/function) with Puppeteer's page. Written as one
   function body so it can be sent as ESM or CommonJS — see verify-run.ts.
   It never throws: every outcome is a step with a reason. */
export const BROWSER_TEST_BODY = String.raw`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { steps: [], errors: [], path: null, text: "", formPath: null };
  const step = (name, ok, detail) => { out.steps.push(detail ? { name, ok, detail: String(detail).slice(0, 300) } : { name, ok }); return ok; };
  const trouble = new RegExp(context.trouble, "i");
  const finish = async () => {
    try {
      out.path = await page.evaluate(() => (window.__qsPath ? window.__qsPath() : null));
      out.text = await page.evaluate(() => (document.body ? document.body.innerText : "").slice(0, 1500));
    } catch (e) {}
    return { data: out, type: "application/json" };
  };
  page.on("pageerror", (e) => { if (out.errors.length < 12) out.errors.push(String((e && e.message) || e).slice(0, 240)); });
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(context.html, { waitUntil: "networkidle2", timeout: 30000 });
  } catch (e) {
    step("opens", false, "the app did not finish loading: " + ((e && e.message) || e));
    return finish();
  }
  let started = false;
  for (let i = 0; i < 20 && !started; i++) {
    started = await page.evaluate(() => typeof window.__qsNavigate === "function");
    if (!started) await wait(500);
  }
  if (!step("opens", started, started ? "" : "the app did not start in the browser")) return finish();
  const where = () => page.evaluate(() => (window.__qsPath ? window.__qsPath() : ""));
  const screen = () => page.evaluate(() => (document.body ? document.body.innerText : ""));
  const go = async (to) => { await page.evaluate((p) => window.__qsNavigate(p), to); await wait(2500); };

  /* ── Sign in ── */
  await go(context.login);
  let hasPassword = false;
  for (let i = 0; i < 12 && !hasPassword; i++) {
    hasPassword = await page.evaluate(() => Boolean(document.querySelector('input[type="password"]')));
    if (!hasPassword) await wait(500);
  }
  if (!step("sign-in page", hasPassword, hasPassword ? "" : "there is no password field on " + context.login)) return finish();

  const tag = () => page.evaluate(() => {
    const label = (el) => ((el.innerText || el.value || el.getAttribute("aria-label") || "") + "").trim();
    document.querySelectorAll("[data-qs-test]").forEach((el) => el.removeAttribute("data-qs-test"));
    const pw = document.querySelector('input[type="password"]');
    if (!pw) return null;
    const form = pw.closest("form") || document.body;
    const inputs = Array.from(form.querySelectorAll("input"));
    const email =
      inputs.find((i) => i.type === "email") ||
      inputs.find((i) => /mail/i.test([i.name, i.id, i.placeholder, i.getAttribute("autocomplete")].join(" "))) ||
      inputs.find((i) => i.type === "text");
    const buttons = Array.from(form.querySelectorAll('button, input[type="submit"]'));
    const submit = buttons.find((b) => (b.getAttribute("type") || "submit") === "submit") || buttons[buttons.length - 1];
    if (email) email.setAttribute("data-qs-test", "email");
    pw.setAttribute("data-qs-test", "password");
    if (submit) submit.setAttribute("data-qs-test", "submit");
    return { email: Boolean(email), submit: submit ? label(submit) : "" };
  });

  let form = await tag();
  const signUpWords = /sign ?up|create|register|join|get started/i;
  const signInWords = /sign ?in|log ?in|login/i;
  if (form && signUpWords.test(form.submit) && !signInWords.test(form.submit)) {
    /* The page opened on sign-up: switch it to sign-in. */
    await page.evaluate(() => {
      const submit = document.querySelector('[data-qs-test="submit"]');
      const toggles = Array.from(document.querySelectorAll("button, a, [role=button], [role=tab]"))
        .filter((el) => el !== submit && /sign ?in|log ?in|already have/i.test((el.innerText || "").trim()));
      if (toggles[0]) toggles[0].click();
    });
    await wait(900);
    form = await tag();
  }
  if (!form || !form.email) {
    step("sign in", false, "the sign-in form has no email field");
    return finish();
  }
  await page.type('[data-qs-test="email"]', context.email, { delay: 5 });
  await page.type('[data-qs-test="password"]', context.password, { delay: 5 });
  if (await page.$('[data-qs-test="submit"]')) await page.click('[data-qs-test="submit"]');
  else await page.keyboard.press("Enter");

  let left = false;
  let said = "";
  for (let i = 0; i < 30 && !left; i++) {
    await wait(500);
    const now = await where();
    left = Boolean(now) && now !== context.login;
    if (!left) {
      said = await page.evaluate(() => {
        const alert = document.querySelector('[role="alert"], .text-red-500, .text-red-600, .text-destructive');
        return alert ? (alert.innerText || "").trim() : "";
      });
    }
  }
  if (!step("sign in", left, left ? "" : said ? "signing in showed: " + said : "signing in did not lead anywhere — the member stayed on " + context.login)) return finish();

  /* ── The dashboard ── */
  if (context.dashboard) {
    if ((await where()) !== context.dashboard) await go(context.dashboard);
    else await wait(2500);
    const now = await where();
    const text = await screen();
    if (now === context.login) {
      step("dashboard", false, "the dashboard sent a signed-in member back to sign-in");
      return finish();
    }
    const bad = text.match(trouble);
    if (!step("dashboard", !bad, bad ? "the dashboard showed: " + text.slice(Math.max(0, bad.index - 60), bad.index + 160).replace(/\s+/g, " ") : "")) return finish();
  }

  /* ── Saving something ── */
  const findForm = () => page.evaluate((marker) => {
    const fillable = (el) => {
      if (el.disabled || el.readOnly || el.offsetParent === null) return false;
      if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "number", "date", "datetime-local", "time", "url", "tel", "email"].includes(t) && !/search/i.test([el.name, el.placeholder, el.getAttribute("aria-label")].join(" "));
    };
    const forms = Array.from(document.querySelectorAll("form")).filter((f) => !f.querySelector('input[type="password"]'));
    const target = forms.find((f) => Array.from(f.querySelectorAll("input, textarea, select")).some(fillable));
    if (!target) return false;
    const set = (el, value) => {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    let first = true;
    for (const el of Array.from(target.querySelectorAll("input, textarea, select")).filter(fillable)) {
      const t = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (el.tagName === "SELECT") {
        const options = Array.from(el.options).filter((o) => o.value);
        if (options.length && !el.value) set(el, options[0].value);
      } else if (t === "number") set(el, el.min && Number(el.min) > 1 ? el.min : "1");
      else if (t === "date") set(el, "2030-01-15");
      else if (t === "datetime-local") set(el, "2030-01-15T10:00");
      else if (t === "time") set(el, "10:00");
      else if (t === "url") set(el, "https://example.com");
      else if (t === "tel") set(el, "5550100");
      else if (t === "email") set(el, "check@example.com");
      else { set(el, first ? marker : "Checked by QuickStark"); first = false; }
    }
    target.querySelectorAll("[data-qs-test]").forEach((el) => el.removeAttribute("data-qs-test"));
    const buttons = Array.from(target.querySelectorAll('button, input[type="submit"]'));
    const submit = buttons.find((b) => (b.getAttribute("type") || "submit") === "submit") || buttons[buttons.length - 1];
    if (submit) submit.setAttribute("data-qs-test", "save");
    target.setAttribute("data-qs-test-form", "1");
    return true;
  }, context.marker);

  const openers = () => page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button, a, [role=button]"))
      .find((b) => b.offsetParent !== null && /^(?:\+\s*)?(?:add|new|create|book|submit|post)\b/i.test((b.innerText || "").trim()));
    if (el) { el.click(); return true; }
    return false;
  });

  let found = false;
  for (const at of context.forms) {
    if ((await where()) !== at) await go(at);
    found = await findForm();
    if (!found && (await openers())) { await wait(1200); found = await findForm(); }
    if (found) { out.formPath = at; break; }
  }
  if (!found) {
    step("save", false, "no form to add anything was found on " + (context.forms.join(", ") || "any page a member reaches"));
    return finish();
  }
  if (await page.$('[data-qs-test="save"]')) await page.click('[data-qs-test="save"]');
  else await page.evaluate(() => { const f = document.querySelector("[data-qs-test-form]"); if (f && f.requestSubmit) f.requestSubmit(); });
  await wait(4000);
  const after = await screen();
  const bad = after.match(trouble);
  step("save", !bad, bad ? "saving showed: " + after.slice(Math.max(0, bad.index - 60), bad.index + 160).replace(/\s+/g, " ") : "");
  return finish();
`;

/** The script, as an ES module (Browserless v2) or CommonJS (v1). */
export function browserScript(style: "esm" | "cjs"): string {
  return style === "esm"
    ? `export default async function ({ page, context }) {${BROWSER_TEST_BODY}}`
    : `module.exports = async ({ page, context }) => {${BROWSER_TEST_BODY}};`;
}

/** Reads what the browser sent back. Null when it is not a run. */
export function readBrowserRun(value: unknown): BrowserRun | null {
  const data = value && typeof value === "object" && "data" in value ? (value as { data: unknown }).data : value;
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) return null;
  const steps = raw.steps
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({ name: String(s.name) as StepName, ok: s.ok === true, ...(s.detail ? { detail: String(s.detail).slice(0, 300) } : {}) }));
  return {
    steps,
    errors: Array.isArray(raw.errors) ? raw.errors.map(String).slice(0, 12) : [],
    path: typeof raw.path === "string" ? raw.path : null,
    text: typeof raw.text === "string" ? raw.text.slice(0, 1500) : "",
    formPath: typeof raw.formPath === "string" ? raw.formPath : null,
  };
}

export type Verdict = {
  passed: boolean;
  /** The first step that failed. */
  failed: BrowserStep | null;
  /** One line per step, for the thread. */
  lines: string[];
};

const STEP_WORDS: Record<StepName, string> = {
  opens: "The app opens",
  "sign-in page": "The sign-in page is there",
  "sign in": "A member can sign in",
  dashboard: "The dashboard opens for them",
  save: "They can save a record",
};

/**
 * The run, judged. A run passes only when every step it needed passed AND
 * the saved record was found in the database (`saved`: true found, false not
 * found, null when the database could not be asked — then the screen is
 * trusted, and only when it shows what was typed).
 */
export function judge(run: BrowserRun, input: { needsDashboard: boolean; saved: boolean | null; marker: string }): Verdict {
  const steps = [...run.steps];
  const save = steps.find((s) => s.name === "save");
  if (save?.ok) {
    const there = input.saved ?? run.text.includes(input.marker);
    if (!there) {
      save.ok = false;
      save.detail = input.saved === false
        ? "the form was sent, but nothing was saved in the database"
        : "the form was sent, but what was typed never appeared";
    }
  }
  const wanted: StepName[] = ["opens", "sign-in page", "sign in", ...(input.needsDashboard ? (["dashboard"] as StepName[]) : []), "save"];
  const failed = steps.find((s) => !s.ok) ?? null;
  const missing = wanted.find((name) => !steps.some((s) => s.name === name));
  const passed = !failed && !missing;
  const lines = wanted.map((name) => {
    const s = steps.find((x) => x.name === name);
    if (!s) return `– ${STEP_WORDS[name]} (not reached)`;
    return s.ok ? `✓ ${STEP_WORDS[name]}` : `✗ ${STEP_WORDS[name]} — ${s.detail ?? "it did not work"}`;
  });
  return { passed, failed: failed ?? (missing ? { name: missing, ok: false, detail: "not reached" } : null), lines };
}

/** The file to repair for a failed step, and what to tell the model. */
export function repairTarget(run: BrowserRun, routes: TestRoutes, failed: BrowserStep): { path: string; brief: string } | null {
  const address =
    failed.name === "sign-in page" || failed.name === "sign in"
      ? routes.login
      : failed.name === "save"
        ? run.formPath ?? routes.dashboard ?? routes.forms[0] ?? null
        : failed.name === "dashboard"
          ? routes.dashboard
          : routes.login;
  const path = address ? routes.files[address] : null;
  if (!path) return null;
  const what: Record<StepName, string> = {
    opens: "The app did not start in a browser.",
    "sign-in page": "The sign-in page must have an email field and a password field inside one <form>, with a submit button.",
    "sign in":
      "Signing in with a correct email and password must call supabase.auth.signInWithPassword and, on success, go to /dashboard (or the `next` parameter). Errors must be shown inline in an element with role=\"alert\".",
    dashboard:
      "A signed-in member must see their dashboard. It must read the session with supabase.auth.getSession() before deciding to send anybody to sign-in, and its queries must use the tables and columns the app's database really has.",
    save:
      "A signed-in member must be able to add a record: a <form> with labelled inputs and a submit button that inserts a row with supabase (including user_id from the session where the table has one), then shows it in the list. Errors must be shown inline, never swallowed.",
  };
  const brief = [
    `An automatic test of this app failed at "${STEP_WORDS[failed.name]}": ${failed.detail ?? "it did not work"}.`,
    what[failed.name],
    run.errors.length ? `Errors the page threw: ${run.errors.slice(0, 4).join(" | ")}` : "",
    run.text ? `What was on screen: ${run.text.slice(0, 500).replace(/\s+/g, " ")}` : "",
    "Fix this file so the test passes. Keep the design and everything else that works.",
  ]
    .filter(Boolean)
    .join("\n");
  return { path, brief };
}

/** A password for the test member: long, random, never shown. */
export function testPassword(random: () => string): string {
  return `Qs-${random()}-${random()}!9a`;
}

/** SQL that finds the test record anywhere in the app's schema. Returns rows of { found: number }. */
export function savedRecordSql(schema: string, marker: string): string {
  const s = /^[a-z_][a-z0-9_]{0,62}$/.test(schema) ? schema : "public";
  const m = marker.replace(/[^A-Za-z0-9-]/g, "");
  return `select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I t where t::text like %L', table_schema, table_name, '%${m}%'), false, true, '')))[1]::text::int), 0) as found
from information_schema.tables where table_schema = '${s}' and table_type = 'BASE TABLE'`;
}

/** SQL that makes a confirmed member who can sign in with a password. */
export function testMemberSql(input: { id: string; email: string; password: string }): string {
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  return `with made as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ${q(input.id)}, 'authenticated', 'authenticated', ${q(input.email)}, extensions.crypt(${q(input.password)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"QuickStark Check"}'::jsonb, now(), now(), '', '', '', '')
  returning id
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', ${q(input.email)}, 'email_verified', true), 'email', now(), now(), now() from made
returning user_id`;
}

/** SQL that removes the test member and what they saved. Never fails. */
export function removeMemberSql(schema: string, id: string): string {
  const s = /^[a-z_][a-z0-9_]{0,62}$/.test(schema) ? schema : "public";
  const u = /^[0-9a-f-]{36}$/i.test(id) ? id : "00000000-0000-0000-0000-000000000000";
  return `do $qs$
declare r record;
begin
  /* Twice, so a row that another row points at goes on the second pass. */
  for pass in 1..2 loop
  for r in select table_name, column_name from information_schema.columns
    where table_schema = '${s}' and data_type = 'uuid'
      and (column_name in ('user_id', 'owner_id', 'created_by', 'author_id', 'profile_id', 'member_id') or (table_name = 'profiles' and column_name = 'id'))
  loop
    begin
      execute format('delete from %I.%I where %I = %L', '${s}', r.table_name, r.column_name, '${u}');
    exception when others then null;
    end;
  end loop;
  end loop;
  begin
    delete from auth.identities where user_id = '${u}';
    delete from auth.users where id = '${u}';
  exception when others then null;
  end;
end
$qs$`;
}
