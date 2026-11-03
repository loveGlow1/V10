/* The design intelligence additions: the business domain a brief is for,
 * the three design blueprints added to the library, and the predefined pages
 * each website type carries. Compiled on their own, like check-design. */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
let failed = 0;
const has = (ok, label, detail = "") => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const dir = mkdtempSync(join(tmpdir(), "domain-"));
const compile = (from, to, swap = (s) => s) =>
  writeFileSync(join(dir, to), swap(ts.transpileModule(readFileSync(join(root, from), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText));
compile("src/lib/builder/domain.ts", "domain.mjs");
compile("src/lib/builder/qa/contrast.ts", "contrast.mjs");
compile("src/lib/builder/design.ts", "design.mjs", (s) => s.replace(/from "\.\/qa\/contrast"/, 'from "./contrast.mjs"'));
const D = await import(join(dir, "domain.mjs"));
const G = await import(join(dir, "design.mjs"));

console.log("Business domain");
const CASES = [
  ["a booking app for my salon in Accra", "booking"],
  ["website for my real estate agency with listings", "real-estate"],
  ["a customer portal for our freight and shipping company", "logistics"],
  ["mobile banking app for a microfinance company", "banking"],
  ["an online booking system for my dental clinic", "healthcare"],
  ["restaurant website with a menu and online ordering", "restaurant"],
  ["a CRM for my sales team", "crm"],
  ["church website with donations and events", "nonprofit"],
  ["sell my streetwear clothing online", "fashion"],
  ["an online store for furniture", "retail"],
  ["a store with daily deals on gadgets", "retail"],
  ["an ecommerce platform for shoes", "fashion"],
  ["a website for my roofing contractors business", "construction"],
];
for (const [brief, expect] of CASES) {
  const got = D.detectDomain(brief)?.id ?? null;
  has(got === expect, `${brief} → ${expect}`, `got ${got}`);
}
has(D.detectDomain("make me something nice") === null, "a brief that names no business gets no domain — the blueprint alone decides");

const realEstate = D.DOMAINS.find((d) => d.id === "real-estate");
const brief = D.domainBrief(realEstate, "webapp", true);
has(/Saved properties · Viewings · Recently viewed · Enquiries/.test(brief) && /Never invent live financial or operational figures/.test(brief), "a real-estate customer area gets real-estate navigation, never invented figures");
has(!/SIGNED-IN AREA/.test(D.domainBrief(realEstate, "landing", true)) && !/SIGNED-IN AREA/.test(D.domainBrief(realEstate, "webapp", false)), "no dashboard is described for a landing page, or for a product without accounts");
const banking = D.DOMAINS.find((d) => d.id === "banking");
has(/Accounts · Transactions · Transfers · Cards · Statements/.test(D.domainBrief(banking, "fintech", true)) && banking.rules.some((r) => /simulated transaction is labelled/.test(r)), "banking gets its own navigation, and simulated transactions are labelled as such");
has(D.DOMAINS.every((d) => d.dashboard.length >= 5 && d.modules.length >= 3 && d.rules.length >= 1), "every domain has a navigation, modules and conventions");
has(new Set(D.DOMAINS.map((d) => d.id)).size === D.DOMAINS.length, "domain ids are unique");

console.log("\nDesign blueprints");
const pick = (register, kind, text) => G.decideDesign(register, kind, text).dna.name;
has(pick("clear commercial", "landing", "a logistics and freight company") === "Corporate professional", "freight → F · Corporate professional");
has(pick("clear commercial", "landing", "a construction contractors website") === "Corporate professional", "construction → F · Corporate professional");
has(pick("technical and functional", "logistics", "fast parcels") === "Corporate professional", "the logistics kind defaults to Corporate professional");
has(pick("clear commercial", "webapp", "an inventory system for my shop") === "Modern dashboard", "an inventory system → H · Modern dashboard");
has(pick("functional and unadorned", "webapp", "a tool") === "Modern dashboard", "the web app kind defaults to Modern dashboard");
has(pick("luxury editorial", "portfolio", "portfolio for a graphic designer") === "Creative expressive", "a graphic designer → I · Creative expressive");
has(pick("clear commercial", "landing", "a bold expressive site for my studio") === "Creative expressive", "a bold, expressive look by name → Creative expressive");
has(pick("clinical trust", "fintech", "payments for small shops") === "Private capital", "the fintech kind defaults to G · Fintech precision (Private capital)");
has(pick("technical documentary", "webapp", "a log viewer") === "Technical" && pick("luxury editorial", "fintech", "payments for a luxury boutique") === "Editorial serif", "a register the brief asked for still decides over the kind's house design");
{
  const planner = readFileSync(join(root, "src/lib/builder/assets/asset-planner.ts"), "utf8");
  const inStep = Object.entries(G.KIND_DEFAULT_REGISTER).every(([kind, register]) => new RegExp(`\\n  ${kind}: \\{\\n    register: "${register}"`).test(planner));
  has(inStep, "the kinds' default registers match asset-planner's, so the house design is reached");
}
has(G.SYSTEMS.length === 12 && G.SYSTEMS.every((s) => /^[A-I] · /.test(s.blueprint)), "12 systems, each naming the A–I blueprint it serves");
const letters = new Set(G.SYSTEMS.map((s) => s.blueprint[0]));
has(["A", "B", "C", "D", "E", "F", "G", "H", "I"].every((l) => letters.has(l)), "every blueprint A–I is served by at least one system");
has(/design blueprint F · Corporate professional/.test(G.designBrief(G.systemByName("Corporate professional"))), "the design brief names the blueprint to the model");

console.log("\nPredefined pages");
const kinds = ["landing", "ecommerce", "blog", "news", "webapp", "saas", "fintech", "logistics", "portfolio"];
for (const kind of kinds) {
  const src = readFileSync(join(root, `src/lib/builder/blueprints/${kind}.ts`), "utf8");
  has(/\n  pages: \[/.test(src), `${kind} carries its page architecture`);
}
const index = readFileSync(join(root, "src/lib/builder/blueprints/index.ts"), "utf8");
has(/blueprint\.pages\?\.length/.test(index) && /domainBrief\(context\.domain, kind/.test(index), "the build prompt states the pages and the business");
const route = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");
has(/const domain = detectDomain\(brief\.text\);/.test(route) && /domain: domain \?\? undefined,/.test(route), "the build detects the business and hands it to the prompt");

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
