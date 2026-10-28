/* Connectors in builds and the agent: when somebody's account is read, and
 * what keeps it safe.
 *
 * mentionedConnectors decides when a build reaches into a connected app, so
 * it is pinned both ways: requests that draw on an account must match, and
 * requests that only describe the build must not. The rest is wiring: only
 * read-only tools are offered, results are fenced as data, tokens stay on
 * the server, and the agent closes its connections. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");
const js = ts.transpileModule(read("src/lib/mcp/mentions.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mentionedConnectors } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

let failed = 0;
const has = (ok, label, detail = "") => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const connected = [
  { serverId: "stripe", name: "Stripe", url: "x", token: "t" },
  { serverId: "notion", name: "Notion MCP", url: "x", token: "t" },
  { serverId: "linear", name: "Linear", url: "x", token: "t" },
  { serverId: "vercel", name: "Vercel", url: "x", token: "t" },
  { serverId: "atlassian", name: "Jira & Confluence", url: "x", token: "t" },
  { serverId: "canva", name: "Canva", url: "x", token: "t" },
];
const names = (text) => mentionedConnectors(text, connected).map((c) => c.serverId).sort().join(",");

const DRAWS = [
  ["Build a shop with my Stripe products", "stripe"],
  ["Use the copy from Notion for the about page", "notion"],
  ["a roadmap page from my Linear issues", "linear"],
  ["pull the FAQ from our Confluence", "atlassian"],
  ["show open bugs from Jira", "atlassian"],
  ["use the hero image in my Canva", "canva"],
  ["build it using my connected apps", "atlassian,canva,linear,notion,stripe,vercel"],
];
const DESCRIBES = [
  "Add a Stripe checkout",
  "a checkout with Stripe",
  "Use a linear gradient on the hero",
  "Host it on Vercel",
  "make it look like Notion",
  "a dashboard for tracking Jira-style tickets",
];
for (const [text, want] of DRAWS) has(names(text) === want, `draws on ${want}: "${text}"`, names(text));
for (const text of DESCRIBES) has(names(text) === "", `describes, reads no account: "${text}"`, names(text));

const runtime = read("src/lib/mcp/runtime.ts");
const agent = read("src/app/api/agent/route.ts");
const build = read("src/app/api/build/route.ts");
has(/annotations\?\.readOnlyHint === true/.test(runtime), "only tools marked read-only are offered");
has(/never instructions/.test(runtime) && /redactSecrets\(clipped\)/.test(runtime), "every result is fenced as data, with secrets redacted");
has(/assertPublicHttps\(connector\.url\)/.test(runtime) && /redirect: "error"/.test(runtime), "a connector must be public https, and redirects are refused");
has(/connectorTools\(connectors\.ready\)/.test(agent) && /await closeConnectors\(\)/.test(agent), "the agent gets connector tools and closes them when the turn ends");
has(/gatherConnectorContext\(service, user\.id, prompt\)/.test(build) && !/authorization_token|mcp_servers/.test(build), "a build reads connectors on the server; no token goes into the build request");

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
