/* The credit history: every line has a category, a month adds up, and plan
   credits that arrive or expire are recorded by the database. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-credit-history");
mkdirSync(out, { recursive: true });
execFileSync("npx", ["tsc", join(root, "src/app/dashboard/credit-history.ts"), "--outDir", out, "--module", "esnext", "--target", "es2022", "--skipLibCheck"], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const H = await import(join(out, "credit-history.js"));

let passed = 0;
let failed = 0;
const has = (ok, name) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
};

const line = (credits, extra = {}) => ({ id: String(Math.random()), action: "generate", credits, description: "", created_at: "2026-11-10T12:00:00Z", project_id: null, dedupe_key: null, source: null, ...extra });
has(H.categoryOf(line(-3, { dedupe_key: "video-job:v:2:video:1", description: "Video video 1: Launch" })) === "Video", "a video clip is Video");
has(H.categoryOf(line(-1, { description: "Character: Leo" })) === "Video", "a character is Video");
has(H.categoryOf(line(-2, { dedupe_key: "flyer:1" })) === "Fliers", "a flyer is Fliers");
has(H.categoryOf(line(-1, { action: "publish" })) === "Publishing", "a publish is Publishing");
has(H.categoryOf(line(-1, { description: "Built the checkout page" })) === "Websites & apps", "a build is Websites & apps");
has(H.categoryOf(line(100, { action: "topup" })) === "Credits added", "a top-up is added credit");
has(H.categoryOf(line(-50, { action: "grant", source: "plan" })) === "Plan credits", "expired plan credits are plan credits, not spending");

const s = H.statementOf([
  line(-3, { dedupe_key: "video-cut:a:1" }),
  line(-2, { dedupe_key: "video-job:a:1:video:1", created_at: "2026-11-11T09:00:00Z" }),
  line(-1, { action: "publish" }),
  line(100, { action: "grant", source: "plan" }),
  line(-20, { action: "grant", source: "plan" }),
  line(25, { action: "topup" }),
]);
has(s.spent === 6 && s.charges === 3, "spent counts charges only");
has(s.added === 125 && s.expired === 20, "added and expired are kept apart from spending");
has(s.byCategory[0].category === "Video" && s.byCategory[0].credits === 5, "where it went, largest first");
has(s.days.length === 2 && s.days[0].day === new Date("2026-11-11T09:00:00Z").toDateString(), "days newest first");
has(H.shiftMonth("2026-01", -1) === "2025-12" && H.shiftMonth("2026-12", 1) === "2027-01", "months step across years");
const csv = H.statementCsv([line(-1.5, { description: 'Edit, "quoted"', project_id: "p" })], () => "My app");
has(csv.split("\n")[1].includes('"Edit, ""quoted"""') && csv.includes("My app") && csv.includes("-1.50"), "the CSV quotes text and names the project");

const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
const ecb = schema.slice(schema.indexOf("create or replace function public.ensure_credit_balance"), schema.indexOf("$$;", schema.indexOf("create or replace function public.ensure_credit_balance")));
has(/Monthly %s plan credits/.test(ecb) && /expired/.test(ecb) && /rolled over/.test(ecb) && /'plan'/.test(ecb), "the database records plan credits that arrive, roll over and expire");
const modal = readFileSync(join(root, "src/app/dashboard/components/AccountSettingsModal.tsx"), "utf8");
has(/<CreditStatement /.test(modal) && /line\.source !== "plan"/.test(modal), "the settings show monthly statements; plan credits stay out of purchases");
const credits = readFileSync(join(root, "src/lib/credits-server.ts"), "utf8");
has(/videoId/.test(credits) && /if \(error && input\.dedupeKey\)/.test(credits), "video charges name their project, and a failed charge is tried once more");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
