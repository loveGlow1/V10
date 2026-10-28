#!/usr/bin/env node
/* The MCP server — the parts that must not be wrong and need no network.
 *
 *   npm run check:mcp
 *
 * The protocol answers what a client sends and nothing it does not; a build
 * stream is read to its result, or reported as still running at the deadline;
 * every question a build can ask comes back with the exact values to answer
 * with; discovery points at Supabase Auth; and the tool list offers nothing
 * that deletes.
 *
 * Offline. No database, no MCP client, no Supabase.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-mcp");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      typeRoots: [join(process.cwd(), "node_modules", "@types")],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/quickstark-mcp/protocol.ts"),
      join(process.cwd(), "src/lib/quickstark-mcp/build-reply.ts"),
      join(process.cwd(), "src/lib/quickstark-mcp/discovery.ts"),
    ],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const protocol = await import(join(out, "lib/quickstark-mcp/protocol.js"));
const reply = await import(join(out, "lib/quickstark-mcp/build-reply.js"));
const discovery = await import(join(out, "lib/quickstark-mcp/discovery.js"));

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

const echo = {
  name: "echo",
  title: "Echo",
  description: "Says it back.",
  inputSchema: { type: "object", properties: { say: { type: "string" } }, required: ["say"] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  run: async (args) => protocol.textResult(String(args.say)),
};
const boom = { ...echo, name: "boom", inputSchema: { type: "object", properties: {} }, run: async () => { throw new Error("x"); } };
const tools = [echo, boom];
const call = (message) => protocol.dispatch(message, tools, {});

console.log("\nProtocol:");
const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
has(init.result.protocolVersion === "2025-03-26", "a supported protocol version is agreed as asked");
has(init.result.capabilities.tools && init.result.serverInfo.name === "QuickStark", "initialize offers tools and names the server");
const future = await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
has(future.result.protocolVersion === protocol.PROTOCOL_VERSIONS[0], "an unknown version is answered with the newest");
has((await call({ jsonrpc: "2.0", method: "notifications/initialized" })) === null, "a notification gets no reply");
has((await call({ jsonrpc: "2.0", id: 3, result: {} })) === null, "a response from the client is accepted without a reply");
has((await call({ jsonrpc: "2.0", id: 12 }))?.error?.code === protocol.ERRORS.invalidRequest, "a request without a method is refused");
const ping = await call({ jsonrpc: "2.0", id: 4, method: "ping" });
has(ping.id === 4 && JSON.stringify(ping.result) === "{}", "ping answers with an empty result and the same id");
const listed = await call({ jsonrpc: "2.0", id: 5, method: "tools/list" });
has(listed.result.tools.length === 2 && listed.result.tools[0].inputSchema && !("run" in listed.result.tools[0]), "tools/list describes tools without their code");
has(listed.result.tools[0].annotations.title === "Echo", "annotations carry the tool's title");
const said = await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "echo", arguments: { say: "hi" } } });
has(said.result.content[0].text === "hi" && !said.result.isError, "a tool call returns the tool's text");
const missing = await call({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo", arguments: {} } });
has(missing.result.isError && /say/.test(missing.result.content[0].text), "a missing required argument is a tool error naming it");
const unknownTool = await call({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope" } });
has(unknownTool.error?.code === protocol.ERRORS.invalidParams, "an unknown tool is a protocol error");
const thrown = await call({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "boom", arguments: {} } });
has(thrown.result.isError && /QuickStark's side/.test(thrown.result.content[0].text), "a tool that throws becomes a readable tool error, not a crash");
const unknownMethod = await call({ jsonrpc: "2.0", id: 10, method: "resources/list" });
has(unknownMethod.error?.code === protocol.ERRORS.methodNotFound, "an unsupported method is method-not-found");
const badVersion = await call({ jsonrpc: "1.0", id: 11, method: "ping" });
has(badVersion.error?.code === protocol.ERRORS.invalidRequest, "jsonrpc other than 2.0 is refused");
has((await call([1, 2])).error?.code === protocol.ERRORS.invalidRequest, "a non-object message is an invalid request");

console.log("\nReading a build:");
const ndjson = (lines, { hold = false } = {}) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      if (!hold) controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
};

const done = await reply.readBuildStream(
  ndjson([
    { type: "step", step: { id: "a", label: "Reading your brief" } },
    { type: "text", delta: "Here " },
    { type: "text", delta: "it is." },
    { type: "result", status: 200, body: { build: { message: "Built your barbershop.", links: { preview: "https://p.example/x" } } } },
  ]),
  Date.now() + 5000,
);
has(done.finished && done.status === 200 && done.text === "Here it is.", "the stream is read to its result line, text collected");
const doneSummary = reply.summarise(done, { workspace: "https://q.example/dashboard", projectId: "p1" });
has(!doneSummary.isError && doneSummary.text.includes("Preview: https://p.example/x") && doneSummary.text.includes("Built your barbershop."), "a finished build is summarised with its preview link");

const started = Date.now();
const running = await reply.readBuildStream(
  ndjson([{ type: "step", step: { id: "g", label: "Writing the pages" } }], { hold: true }),
  Date.now() + 300,
);
has(!running.finished && Date.now() - started < 2000, "a build still going at the deadline is let go on time");
const runningSummary = reply.summarise(running, { workspace: "https://q.example/dashboard", projectId: "p1" });
has(/still running/.test(runningSummary.text) && /get_project/.test(runningSummary.text) && /Writing the pages/.test(runningSummary.text), "an unfinished build says where it got to and how to follow up");

const refused = await reply.readBuildStream(
  new Response(JSON.stringify({ error: "Add a card to keep using QuickStark.", code: "card_required", cardRequired: true }), {
    status: 402,
    headers: { "content-type": "application/json" },
  }),
  Date.now() + 1000,
);
const refusedSummary = reply.summarise(refused, { workspace: "https://q.example/dashboard", projectId: null });
has(refusedSummary.isError && /card/.test(refusedSummary.text) && /q\.example\/dashboard/.test(refusedSummary.text), "a card refusal is an error that says where to add one");

const asked = (payload) => reply.summarise({ finished: true, status: 200, payload, text: "", lastSteps: [] }, { workspace: "w", projectId: "p" });
const kind = asked({ needsKind: true, kindOptions: [{ kind: "landing", label: "Landing page" }, { kind: "webapp", label: "Web app" }], build: { message: "Which is it?" } });
has(/kind: "landing"/.test(kind.text) && /kind: "webapp"/.test(kind.text) && /Which is it\?/.test(kind.text), "a kind question lists each option with the value to send");
const arch = asked({ needsArchitecture: true, buildKind: "webapp", stack: "nextjs", architectureOptions: [{ value: "managed", label: "Managed" }] });
has(/architecture: "managed"/.test(arch.text) && /kind: "webapp"/.test(arch.text) && /stack: "nextjs"/.test(arch.text), "an architecture question carries the reading of the brief to send back");
const stack = asked({ needsStack: true, stackOptions: [{ stack: "standalone-html", label: "One page" }] });
has(/stack: "standalone-html"/.test(stack.text), "a stack question lists its values");
has(/confirm_replace: true/.test(asked({ needsConfirmation: true }).text), "replacing an app waits for confirm_replace");
has(/upgrade: true/.test(asked({ needsUpgrade: true }).text), "an upgrade waits for upgrade: true");
has(/workspace/.test(asked({ needsSqlConfirm: true, sql: "drop table x" }).text) && !/drop table/.test(asked({ needsSqlConfirm: true, sql: "drop table x" }).text), "a database change is sent to the workspace, not approved from here");
const failedBuild = asked({ error: "That didn't work." });
has(failedBuild.isError && /That didn't work\./.test(failedBuild.text), "a refusal is an error in the route's own words");

console.log("\nDiscovery:");
const meta = discovery.protectedResourceMetadata("https://www.quickstark.tech", "https://abc.supabase.co");
has(meta.resource === "https://www.quickstark.tech/api/mcp", "the resource is the MCP endpoint");
has(meta.authorization_servers[0] === "https://abc.supabase.co/auth/v1", "the authorization server is Supabase Auth's issuer");
has(discovery.authorizationServerMetadataUrl("https://abc.supabase.co/") === "https://abc.supabase.co/.well-known/oauth-authorization-server/auth/v1", "its metadata URL uses RFC 8414 path insertion");
has(
  discovery.challenge("https://www.quickstark.tech", false) ===
    'Bearer resource_metadata="https://www.quickstark.tech/.well-known/oauth-protected-resource/api/mcp"',
  "a 401 names the resource metadata",
);
has(/invalid_token/.test(discovery.challenge("https://x", true)), "an expired token is named as invalid_token");

console.log("\nThe tools on offer:");
const toolsSource = readFileSync(join(process.cwd(), "src/lib/quickstark-mcp/tools.ts"), "utf8");
const names = [...toolsSource.matchAll(/^\s{4}name: "([a-z_]+)"/gm)].map((m) => m[1]);
has(
  JSON.stringify(names) === JSON.stringify(["list_projects", "get_project", "create_app", "edit_app", "publish_app", "get_credits"]),
  "exactly the six documented tools",
  `got ${names.join(", ")}`,
);
has(!/destructiveHint: true/.test(toolsSource) && !names.some((n) => /delete|remove|drop/.test(n)), "nothing offered deletes");
has(!/createSupabaseServiceClient|SERVICE_ROLE/.test(toolsSource), "tools never use the service role — RLS answers for the person");
const docs = readFileSync(join(process.cwd(), "docs/MCP.md"), "utf8");
has(names.every((n) => docs.includes(`\`${n}\``)), "docs/MCP.md describes every tool");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
