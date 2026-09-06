#!/usr/bin/env node
/* Applies the two orchestrator repairs to the live n8n workflow.
 *
 *   node tools/fix-orchestrator.mjs             — says what it would change
 *   node tools/fix-orchestrator.mjs --apply     — changes it
 *   node tools/fix-orchestrator.mjs --selftest  — checks the transform itself
 *
 * Both repairs are in n8n rather than in this repository, which is why they
 * were still outstanding after the app-side fix shipped. The workflow file in
 * n8n/ is a mirror and nothing reads it; the canvas is the thing that runs.
 *
 * ── 1. The connection that fails builds that worked ───────────────────────
 *
 * `Generate With Claude` fans its success output to TWO nodes: `Collect
 * Generation`, which is right, and `Save Page` directly, which is not. The
 * direct call hands the save route the raw Anthropic response — no `html`
 * field anywhere in it — so it is refused, takes the node's error output to
 * `Flag Build Failure`, and writes Failed on the project row seconds before
 * the real document arrives through `Extract Page` and is stored. OpenAI and
 * Gemini do not have this edge. See the DEPLOYED DEFECT note in
 * n8n/build-orchestrator.workflow.ts.
 *
 * ── 2. Ten minutes, against a ceiling that is now 64k ─────────────────────
 *
 * The generation nodes time out at 600s. That was ample against a 32k output
 * ceiling and is not obviously ample against 64k — a large page can take
 * longer than ten minutes to write, and a node that gives up mid-generation
 * fails a build that was going to succeed. 900s, which is still bounded.
 *
 * ── What this will not do ─────────────────────────────────────────────────
 *
 * Guess. Every edit is checked against the shape it expects first: the node
 * has to exist, the connection has to be where it is described, and removing
 * it has to leave `Collect Generation` still connected — because an edge
 * removed from a branch that has no other path out is not a repair, it is
 * generation deleted. Anything it does not recognise stops the run with the
 * reason, and nothing is written.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 *
 *   N8N_API_KEY      required. n8n → Settings → n8n API → Create an API key.
 *   N8N_API_URL      default https://neauraissystems.app.n8n.cloud/api/v1
 *   N8N_WORKFLOW_ID  default pIJ3Fu5QpGTotf2m
 *
 * The key is read from the environment and never written anywhere. --apply
 * saves the workflow as it was to n8n/backup-<id>-<timestamp>.json first, so
 * the state before this ran is on disk and restorable by hand.
 */

import { writeFileSync } from "node:fs";

const API_URL = (process.env.N8N_API_URL ?? "https://neauraissystems.app.n8n.cloud/api/v1").replace(/\/$/, "");
const WORKFLOW_ID = process.env.N8N_WORKFLOW_ID ?? "pIJ3Fu5QpGTotf2m";

/* The node whose success output goes one place too many, and the place it
   should not go. */
const CLAUDE = "Generate With Claude";
const WRONG_TARGET = "Save Page";
const RIGHT_TARGET = "Collect Generation";

/* Long enough for the largest blueprint at the 64k ceiling; short enough that a
   wedged call is still eventually a failure rather than a wait with no end. */
const GENERATION_TIMEOUT_MS = 900_000;
const GENERATION_NODES = [CLAUDE, "Generate With OpenAI", "Generate With Gemini"];

class Unrecognised extends Error {}

/**
 * The workflow as it should be, and what changed on the way.
 *
 * Pure, and separated from the fetching for one reason: it is the half that can
 * be wrong in a way that matters, and this is what --selftest exercises.
 */
export function plan(workflow) {
  const changes = [];
  const nodes = structuredClone(workflow.nodes ?? []);
  const connections = structuredClone(workflow.connections ?? {});

  // ── 1. The extra edge ───────────────────────────────────────────────────
  const outputs = connections[CLAUDE]?.main;
  if (!Array.isArray(outputs) || !Array.isArray(outputs[0])) {
    throw new Unrecognised(`"${CLAUDE}" has no main output 0 to read — the workflow is not the one this was written for.`);
  }

  const success = outputs[0];
  const wrong = success.filter((edge) => edge?.node === WRONG_TARGET);
  const keeps = success.filter((edge) => edge?.node !== WRONG_TARGET);

  if (wrong.length > 0) {
    if (!keeps.some((edge) => edge?.node === RIGHT_TARGET)) {
      throw new Unrecognised(
        `"${CLAUDE}" → "${WRONG_TARGET}" is the only edge out of its success output; "${RIGHT_TARGET}" is not connected. Removing it would delete the generation path rather than repair it.`,
      );
    }
    outputs[0] = keeps;
    changes.push(`disconnect ${CLAUDE} → ${WRONG_TARGET} (${keeps.map((e) => e.node).join(", ")} still connected)`);
  }

  // ── 2. The timeouts ─────────────────────────────────────────────────────
  for (const name of GENERATION_NODES) {
    const node = nodes.find((entry) => entry.name === name);
    if (!node) {
      throw new Unrecognised(`no node called "${name}" — the workflow is not the one this was written for.`);
    }
    node.parameters ??= {};
    node.parameters.options ??= {};
    const before = node.parameters.options.timeout;
    if (before !== GENERATION_TIMEOUT_MS) {
      node.parameters.options.timeout = GENERATION_TIMEOUT_MS;
      changes.push(`${name}: timeout ${before ?? "unset"} → ${GENERATION_TIMEOUT_MS}`);
    }
  }

  /* Exactly the four fields the update endpoint accepts. Sending back the whole
     workflow — id, active, createdAt, versionId — is rejected as additional
     properties, which reads like a malformed request and is really a copied
     object. */
  return {
    changes,
    next: { name: workflow.name, nodes, connections, settings: workflow.settings ?? {} },
  };
}

async function call(path, init = {}) {
  const key = process.env.N8N_API_KEY;
  if (!key) {
    console.error(
      "N8N_API_KEY is not set. n8n → Settings → n8n API → Create an API key, then:\n" +
        "  N8N_API_KEY=… node tools/fix-orchestrator.mjs --apply",
    );
    process.exit(2);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

  const body = await response.text();
  if (!response.ok) {
    /* The two that mean something specific, said as what they are. */
    if (response.status === 401) throw new Error("n8n refused the API key (401). It may be revoked or from another instance.");
    if (response.status === 404) throw new Error(`No workflow ${WORKFLOW_ID} on ${API_URL} (404).`);
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : null;
}

function selftest() {
  let failures = 0;
  const ok = (text) => console.log(`ok   ${text}`);
  const bad = (text, detail) => {
    failures += 1;
    console.log(`FAIL ${text}\n     ${detail}`);
  };

  /* The workflow as deployed, in the one region this touches. */
  const deployed = () => ({
    name: "QuickStark.Ai — Build Orchestrator",
    settings: { executionOrder: "v1" },
    nodes: [
      { name: CLAUDE, parameters: { options: { timeout: 600000 } } },
      { name: "Generate With OpenAI", parameters: { options: { timeout: 600000 } } },
      { name: "Generate With Gemini", parameters: { options: { timeout: 600000 } } },
      { name: WRONG_TARGET, parameters: { options: { timeout: 60000 } } },
    ],
    connections: {
      [CLAUDE]: {
        main: [
          [
            { node: WRONG_TARGET, type: "main", index: 0 },
            { node: RIGHT_TARGET, type: "main", index: 0 },
          ],
          [{ node: "Flag Build Failure", type: "main", index: 0 }],
        ],
      },
    },
  });

  const first = plan(deployed());
  const success = first.next.connections[CLAUDE].main[0];
  if (success.some((edge) => edge.node === WRONG_TARGET)) bad("the wrong edge is removed", JSON.stringify(success));
  else ok("the wrong edge is removed");

  if (!success.some((edge) => edge.node === RIGHT_TARGET)) bad("the right edge is kept", JSON.stringify(success));
  else ok("the right edge is kept");

  const errorBranch = first.next.connections[CLAUDE].main[1];
  if (errorBranch?.[0]?.node !== "Flag Build Failure") bad("the error output is untouched", JSON.stringify(errorBranch));
  else ok("the error output is untouched");

  const timeouts = first.next.nodes.filter((n) => GENERATION_NODES.includes(n.name)).map((n) => n.parameters.options.timeout);
  if (timeouts.some((value) => value !== GENERATION_TIMEOUT_MS)) bad("all three generation nodes are raised", timeouts.join(", "));
  else ok("all three generation nodes are raised");

  const save = first.next.nodes.find((n) => n.name === WRONG_TARGET);
  if (save.parameters.options.timeout !== 60000) bad("the save node's own timeout is left alone", String(save.parameters.options.timeout));
  else ok("the save node's own timeout is left alone");

  if (Object.keys(first.next).join(",") !== "name,nodes,connections,settings") bad("only the updatable fields are sent", Object.keys(first.next).join(","));
  else ok("only the updatable fields are sent");

  /* Run it against its own output: a repair applied twice must be a no-op, or
     an accidental second run is a second change. */
  const again = plan({ ...first.next });
  if (again.changes.length !== 0) bad("running it twice changes nothing the second time", again.changes.join("; "));
  else ok("running it twice changes nothing the second time");

  /* The refusals. */
  const onlyWrongEdge = deployed();
  onlyWrongEdge.connections[CLAUDE].main[0] = [{ node: WRONG_TARGET, type: "main", index: 0 }];
  try {
    plan(onlyWrongEdge);
    bad("refuses to cut the only path out", "it did it anyway");
  } catch (error) {
    if (error instanceof Unrecognised) ok("refuses to cut the only path out");
    else bad("refuses to cut the only path out", String(error));
  }

  const renamed = deployed();
  renamed.nodes[1].name = "Generate With OpenAI (old)";
  try {
    plan(renamed);
    bad("stops on a workflow it does not recognise", "it carried on");
  } catch (error) {
    if (error instanceof Unrecognised) ok("stops on a workflow it does not recognise");
    else bad("stops on a workflow it does not recognise", String(error));
  }

  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  const apply = process.argv.includes("--apply");

  console.log(`${API_URL}/workflows/${WORKFLOW_ID}\n`);
  const workflow = await call(`/workflows/${WORKFLOW_ID}`);
  console.log(`Read "${workflow.name}" — ${workflow.nodes?.length ?? 0} nodes, active: ${workflow.active}\n`);

  let planned;
  try {
    planned = plan(workflow);
  } catch (error) {
    if (error instanceof Unrecognised) {
      console.error(`Stopped without changing anything: ${error.message}`);
      console.error("Bring n8n/build-orchestrator.workflow.ts back in step with the canvas and read it again.");
      process.exit(1);
    }
    throw error;
  }

  if (planned.changes.length === 0) {
    console.log("Nothing to change — both repairs are already in place.");
    return;
  }

  for (const change of planned.changes) console.log(`  · ${change}`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write these to the workflow.");
    return;
  }

  const backup = `n8n/backup-${WORKFLOW_ID}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(workflow, null, 2));
  console.log(`\nWorkflow as it was → ${backup}`);

  await call(`/workflows/${WORKFLOW_ID}`, { method: "PUT", body: JSON.stringify(planned.next) });

  /* Read back rather than trusting the write. The two things worth confirming
     are that the edge is gone and that the workflow is still active — an
     orchestrator that is correct and switched off builds nothing. */
  const after = await call(`/workflows/${WORKFLOW_ID}`);
  const left = after.connections?.[CLAUDE]?.main?.[0] ?? [];
  const stillWrong = left.some((edge) => edge?.node === WRONG_TARGET);
  const raised = GENERATION_NODES.every(
    (name) => after.nodes?.find((node) => node.name === name)?.parameters?.options?.timeout === GENERATION_TIMEOUT_MS,
  );

  console.log(
    `\nAfter: ${CLAUDE} → ${left.map((edge) => edge.node).join(", ") || "(nothing)"}\n` +
      `       timeouts raised: ${raised ? "yes" : "NO"}\n` +
      `       active: ${after.active}`,
  );

  if (stillWrong || !raised) {
    console.error("\nThe workflow came back without the change. Nothing here can explain that — open the canvas and look.");
    process.exit(1);
  }
  if (!after.active) {
    console.error(
      `\nThe workflow is INACTIVE. Turn it back on — the editor, or:\n  curl -X POST -H "X-N8N-API-KEY: \$N8N_API_KEY" ${API_URL}/workflows/${WORKFLOW_ID}/activate`,
    );
    process.exit(1);
  }

  console.log("\nDone. Bring the change back into n8n/build-orchestrator.workflow.ts — it is a mirror, and it is now stale.");
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
