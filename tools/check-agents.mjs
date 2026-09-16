#!/usr/bin/env node
/* The agents on the front-door composer, and the thing that got them deleted.
 *
 *   npm run check:agents
 *
 * Q1, Q2, Prototype and Mobile were offered once before and removed, for a
 * reason this file exists to stop happening twice: picking an agent set a
 * LABEL and nothing else. The build ran on a hardcoded "Q1" whatever the chip
 * said, the settings panel marked one "in use" from a prop nobody wrote to, and
 * the whole control was reachable only on a phone. Somebody who chose Q2 got
 * Q1, was charged for it, and nothing anywhere admitted it.
 *
 * So the one property that matters is not how the list looks: it is that every
 * agent offered as selectable names a real model, and that choosing it sets
 * that model through the provider both composers and the settings panel read.
 * A chip that cannot do that is a chip that lies, and this is what asserts it.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-agents");
mkdirSync(out, { recursive: true });

/* Compiled through the project's own tsconfig, because credits.ts reaches for
   `@/...` and a bare tsc invocation has never heard of the alias. */
writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/app/dashboard/agents.ts")],
    },
    null,
    2,
  ),
);
execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
mkdirSync(join(out, "node_modules"), { recursive: true });
try { execFileSync("ln", ["-sfn", out, join(out, "node_modules", "@")]); } catch { /* already there */ }

const require = createRequire(import.meta.url);
const { AGENTS, agentForModel, agentProblems, modelForAgent } =
  require(join(out, "app/dashboard/agents.js"));
const { MODELS } = require(join(out, "app/dashboard/models.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* ── THE ONE THAT MATTERS ────────────────────────────────────────────────── */
{
  const problems = agentProblems();
  has(problems.length === 0, "every selectable agent runs on a model this platform offers", problems.join("; "));

  for (const agent of AGENTS) {
    if (agent.soon) continue;
    const model = modelForAgent(agent.id);
    has(model !== null, `${agent.id} resolves to a model`, `${agent.id} → ${agent.model}`);
  }
}

/* ── The list itself ─────────────────────────────────────────────────────── */
{
  has(AGENTS.some((a) => a.id === "Q1"), "Q1 is offered");
  has(AGENTS.some((a) => a.id === "Q2"), "Q2 is offered");
  has(AGENTS.some((a) => a.soon), "and something is marked coming soon, because it is the plan");

  const soon = AGENTS.filter((a) => a.soon);
  has(
    soon.every((a) => a.model === null),
    "a coming-soon agent names no model, so it cannot be half-wired",
    soon.map((a) => `${a.id}=${a.model}`).join(", "),
  );

  has(
    AGENTS.every((a) => a.subtitle && a.subtitle.length > 0),
    "each one says what it is for, rather than only what it is called",
  );
}

/* ── The round trip, which is what "in use" depends on ───────────────────── */
{
  for (const agent of AGENTS.filter((a) => !a.soon)) {
    const back = agentForModel(agent.model);
    has(
      back?.id === agent.id,
      `${agent.id} is recognised again from the model it set`,
      `got ${back?.id ?? "nothing"}`,
    );
  }

  const unknown = MODELS.find((model) => !AGENTS.some((agent) => agent.model === model.id));
  has(
    unknown === undefined || agentForModel(unknown.id) === null,
    "a model no agent claims is not attributed to one",
    "the chip would otherwise name an agent the account never chose",
  );
}

/* ── And that the composer is wired to it, not to a label ────────────────── */
{
  const page = readFileSync(join(root, "src/app/dashboard/page.tsx"), "utf8");

  has(/AGENTS\.map\(/.test(page), "the home composer lists the agents");
  has(
    /setModel\(agent\.model\)/.test(page),
    "and choosing one SETS THE MODEL, which is the whole difference from last time",
    "a chip that only sets a label is what got this deleted",
  );
  has(
    /if \(!agent\.model\) return;/.test(page),
    "a coming-soon agent cannot be chosen",
  );
  has(
    /agentForModel\(model\)\?\.title \?\? shortModelName/.test(page),
    "the chip names the agent, or the model when no agent claims it",
    "a model picked in the workspace's fuller list has no agent, and naming nothing is worse",
  );

  /* The workspace composer keeps the full list — this is the front door, that
     is the workbench, and somebody who wants a model by name works there. */
  const composer = readFileSync(
    join(root, "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");
  has(
    /groupedModels\(\)/.test(composer),
    "the workspace composer still offers every model by name",
    "the agent list is the front door's vocabulary, not a reduction of what the product can do",
  );
}

console.log(failed === 0 ? "\nAll agent checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
