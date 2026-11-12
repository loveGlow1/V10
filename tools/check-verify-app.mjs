/* Checks the web-app test (src/lib/builder/verify-app.ts): the pure parts,
 * and then the browser script itself, run in a real Chromium against a
 * generated-style app whose Supabase is answered here — one app that works,
 * one whose saving is broken, one whose sign-in never moves on.
 *
 *   node tools/check-verify-app.mjs        (the browser part needs Playwright) */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-verify");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: { outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"], baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } },
  files: ["src/lib/builder/verify-app.ts", "src/lib/builder/preview/app-preview.ts"].map((f) => join(process.cwd(), f)),
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
for (const entry of readdirSync(out, { recursive: true })) {
  if (!String(entry).endsWith(".js")) continue;
  const path = join(out, String(entry));
  const depth = String(entry).split("/").length - 1;
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/(from\s+["'])@\/([^"']+?)(["'])/g, (_, a, rest, c) => `${a}${"../".repeat(depth)}${rest}.js${c}`)
    .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (w, a, spec, c) => (spec.endsWith(".js") ? w : `${a}${spec}.js${c}`)));
}
const V = await import(join(out, "lib/builder/verify-app.js"));
const A = await import(join(out, "lib/builder/preview/app-preview.js"));

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

/* ── An app, the way the generator writes one ── */
const files = (dashboard) => [
  { path: "package.json", content: JSON.stringify({ name: "t", dependencies: { next: "15.0.0", react: "18.3.1", "@supabase/supabase-js": "2.110.7" } }) },
  { path: "app/layout.tsx", content: `export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }` },
  { path: "app/page.tsx", content: `import Link from "next/link";\nexport default function Home() { return <main><h1>Plant Log</h1><Link href="/login">Sign in</Link></main>; }` },
  { path: "lib/supabase.ts", content: `import { createClient } from "@supabase/supabase-js";\nexport const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);` },
  { path: "app/login/page.tsx", content: `"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("up");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const { error } = mode === "in" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    if (error) { setError(error.message); return; }
    router.push("/dashboard");
  }
  return <main><form onSubmit={submit}>
    <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{mode === "in" ? "Sign in" : "Create account"}</button>
  </form>
  <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "New here? Sign up" : "Already have an account? Sign in"}</button></main>;
}` },
  { path: "app/dashboard/page.tsx", content: dashboard },
];

const DASHBOARD = `"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
export default function Dashboard() {
  const router = useRouter();
  const [plants, setPlants] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState(""); const [notes, setNotes] = useState(""); const [error, setError] = useState("");
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { if (!data.session) router.push("/login"); else load(); }); }, []);
  async function load() { const { data, error } = await supabase.from("plants").select("*"); if (error) setError(error.message); else setPlants(data ?? []); }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from("plants").insert({ name, notes, user_id: session?.user.id });
    if (error) { setError(error.message); return; }
    setName(""); setNotes(""); load();
  }
  return <main><h1>Your plants</h1>{error && <p role="alert">{error}</p>}
    <form onSubmit={add}><input placeholder="Plant name" value={name} onChange={(e) => setName(e.target.value)} /><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /><button type="submit">Add plant</button></form>
    <ul>{plants.map((p) => <li key={p.id}>{p.name}</li>)}</ul></main>;
}`;

console.log("what is tested");
const tree = files(DASHBOARD);
has(V.needsVerification({ authentication: true, database: true }, tree), "an app with members and a database is tested");
has(!V.needsVerification({ authentication: false, database: true }, tree) && !V.needsVerification({ authentication: true, database: true }, []), "no members, or no files: not tested");
const routes = V.testRoutes(tree);
has(routes?.login === "/login" && routes?.dashboard === "/dashboard" && routes.forms[0] === "/dashboard", "sign-in and dashboard are read off the routes", JSON.stringify(routes));
has(routes?.files["/login"] === "app/login/page.tsx", "each address knows its file");
has(V.testRoutes(tree.filter((f) => !f.path.startsWith("app/login"))) === null, "no sign-in page: nothing to test, which is a failure");

console.log("judging");
const run = (steps, text = "") => ({ steps, errors: [], path: "/dashboard", text, formPath: "/dashboard" });
const all = [{ name: "opens", ok: true }, { name: "sign-in page", ok: true }, { name: "sign in", ok: true }, { name: "dashboard", ok: true }, { name: "save", ok: true }];
has(V.judge(run(all.map((s) => ({ ...s }))), { needsDashboard: true, saved: true, marker: "M" }).passed, "every step, and the row is in the database: passed");
const notSaved = V.judge(run(all.map((s) => ({ ...s }))), { needsDashboard: true, saved: false, marker: "M" });
has(!notSaved.passed && notSaved.failed?.name === "save" && /nothing was saved/.test(notSaved.failed.detail), "the form was sent but no row: failed at save");
has(V.judge(run(all.map((s) => ({ ...s })), "row M here"), { needsDashboard: true, saved: null, marker: "M" }).passed, "database unreachable: the screen must show what was typed");
has(!V.judge(run(all.slice(0, 3).map((s) => ({ ...s }))), { needsDashboard: true, saved: true, marker: "M" }).passed, "a step never reached is not a pass");
const signIn = V.judge(run([{ name: "opens", ok: true }, { name: "sign-in page", ok: true }, { name: "sign in", ok: false, detail: "x" }]), { needsDashboard: true, saved: null, marker: "M" });
const target = V.repairTarget(run([]), routes, signIn.failed);
has(target?.path === "app/login/page.tsx" && /signInWithPassword/.test(target.brief), "a failed sign-in repairs the sign-in page");
has(V.repairTarget(run([]), routes, { name: "save", ok: false })?.path === "app/dashboard/page.tsx", "a failed save repairs the page whose form it was");

console.log("sql");
const member = V.testMemberSql({ id: "11111111-1111-1111-1111-111111111111", email: "a'b@x.y", password: "p" });
has(/insert into auth\.users/.test(member) && /auth\.identities/.test(member) && member.includes("'a''b@x.y'") && /confirmation_token/.test(member), "the test member is confirmed, has an identity, and is quoted");
has(/query_to_xml/.test(V.savedRecordSql("app_x", "QS-CHECK-AB'C")) && !V.savedRecordSql("app_x", "QS-CHECK-AB'C").includes("AB'C"), "the record search cannot be broken out of");
has(/delete from auth\.users/.test(V.removeMemberSql("bad schema;", "nope")) && !V.removeMemberSql("bad schema;", "nope").includes("bad schema;"), "the clean-up only takes a real schema and id");
has(V.browserScript("esm").startsWith("export default async function") && V.browserScript("cjs").startsWith("module.exports"), "the script is sent as ESM, or CommonJS for an older service");

/* ── The script, in a real browser ── */
let playwright = null;
try { playwright = (await import("playwright")).default ?? (await import("playwright")); } catch { try { const { createRequire } = await import("node:module"); playwright = createRequire(import.meta.url)("playwright"); } catch {} }
if (!playwright) {
  console.log("skip  the browser run (no Playwright)");
} else {
  console.log("in a browser");
  const browser = await playwright.chromium.launch();
  const SUPA = "https://check.supabase.co";
  const runApp = async (dashboard, options = {}) => {
    const page = await browser.newPage();
    const rows = [];
    const user = { id: "22222222-2222-2222-2222-222222222222", email: "check@quickstark.tech", aud: "authenticated", role: "authenticated" };
    await page.route(`${SUPA}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
      if (method === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      if (url.pathname === "/auth/v1/token") {
        if (options.badLogin) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
        return json(200, { access_token: "a.b.c", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user });
      }
      if (url.pathname === "/auth/v1/user") return json(200, user);
      if (url.pathname === "/rest/v1/plants") {
        if (method === "POST") {
          if (options.badSave) return json(404, { code: "PGRST205", message: "Could not find the table 'public.plants' in the schema cache" });
          rows.push({ id: String(rows.length + 1), ...JSON.parse(route.request().postData() || "{}") });
          return json(201, []);
        }
        return json(200, rows);
      }
      return json(404, { message: "not here" });
    });
    const html = A.appPreviewDocument({ tree: files(dashboard), projectName: "Plant Log", env: { NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } });
    /* Puppeteer's names, as Browserless gives them. */
    const shim = Object.create(page);
    shim.setViewport = (v) => page.setViewportSize(v);
    shim.setContent = (h, o) => page.setContent(h, { ...o, waitUntil: "load" });
    shim.on = (e, f) => page.on(e, f);
    const body = V.BROWSER_TEST_BODY;
    const fn = new Function("page", "context", `return (async () => {${body}})();`);
    const marker = "QS-CHECK-ABCD1234";
    const result = await fn(shim, { html, email: "check@quickstark.tech", password: "pw-123456", login: routes.login, dashboard: routes.dashboard, forms: routes.forms, marker, trouble: V.DATABASE_TROUBLE.source });
    await page.close();
    const runOut = V.readBrowserRun(result);
    const saved = options.badSave ? false : rows.some((r) => JSON.stringify(r).includes(marker));
    return { run: runOut, verdict: runOut && V.judge(runOut, { needsDashboard: true, saved, marker }), rows };
  };
  try {
    const good = await runApp(DASHBOARD);
    has(good.verdict?.passed, "a working app passes: signs in from a page that opened on sign-up, opens the dashboard, saves a row", JSON.stringify(good.run));
    has(good.rows.some((r) => r.user_id && r.name === "QS-CHECK-ABCD1234"), "the row it saved carries the member and what was typed", JSON.stringify(good.rows));
    const broken = await runApp(DASHBOARD, { badSave: true });
    has(!broken.verdict?.passed && broken.verdict?.failed?.name === "save" && /schema cache|nothing was saved/.test(broken.verdict.failed.detail ?? ""), "a missing table fails at save, saying why", JSON.stringify(broken.verdict));
    const badLogin = await runApp(DASHBOARD, { badLogin: true });
    has(!badLogin.verdict?.passed && badLogin.verdict?.failed?.name === "sign in" && /Invalid login/.test(badLogin.verdict.failed.detail ?? ""), "a refused sign-in fails at sign in, with what the page said", JSON.stringify(badLogin.verdict));
  } finally {
    await browser.close();
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
