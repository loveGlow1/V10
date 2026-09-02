#!/usr/bin/env node
/* Checks the chat → n8n build orchestrator wiring end to end.
 *
 *   npm run check:builder          — checks what N8N_WEBHOOK_URL points at
 *   npm run check:builder <url>    — checks that webhook instead
 *
 * The symptom this exists for: n8n sitting on "waiting for the webhook call"
 * while the chat looks fine. Four things have to line up before a message
 * becomes an execution — the URL the app holds, the token it sends, the header
 * name the Webhook node's credential compares, and the workflow being published
 * — and every one of them fails from the browser as the same silent nothing.
 * n8n cannot tell you which, because a call that never arrives leaves no trace
 * on its side at all.
 *
 * So this makes the call the app would make and reads the answer:
 *
 *   no URL      → the app never calls n8n; that is the whole bug
 *   /webhook-test/ → the URL is the editor's listen-once address, not production
 *   404         → the workflow is not published
 *   401 / 403   → the token or the header name does not match the credential
 *                 (retried under Authorization, to say which)
 *   200         → the shape src/lib/n8n.ts parses, field by field
 *
 * It POSTs one real build request, so it runs one real execution: the intent
 * classifier bills an Anthropic call. It sends no projectId and no userId, so
 * `Sync Project Row` matches no row and writes nothing.
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/* Kept in step with WEBHOOK_TOKEN_HEADER in src/lib/n8n.ts. A dedicated header
   rather than Authorization: n8n's Header Auth compares the whole value, so
   Authorization would mean typing "Bearer <token>" into the credential exactly,
   and a missing prefix fails as a 403 that reads like a wrong token. */
const TOKEN_HEADER = "X-QuickStark-Token";

/* Generous, because a build branch calls out to provisioning services — and
   bounded, because so is the app: TIMEOUT_MS in src/lib/n8n.ts. */
const TIMEOUT_MS = 60_000;

let failures = 0;

function line(mark, text, detail) {
  console.log(`${mark} ${text}${detail ? `\n    ${detail}` : ""}`);
}
const pass = (text, detail) => line("PASS", text, detail);
const info = (text, detail) => line("    ", text, detail);
const warn = (text, detail) => line("WARN", text, detail);
function fail(text, detail) {
  failures += 1;
  line("FAIL", text, detail);
}

/* The app reads these through Next, which layers .env.local over .env. Read them
   the same way, so this agrees with what the running app would actually use. */
function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(resolvePath(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/* One request, with the timeout the app uses. Network failures are returned
   rather than thrown: a refused connection is a finding, not a crash. */
async function post(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timer);
  }
}

/* What every branch normalizes to before the Merge, as src/lib/n8n.ts reads it.
   Checked one field at a time: a branch that stops setting `links` should be
   named here rather than found later as a build with no preview. */
function checkShape(payload) {
  const expected = [
    ["ok", (value) => typeof value === "boolean"],
    ["requestId", (value) => typeof value === "string"],
    ["intent", (value) => typeof value === "string"],
    ["status", (value) => ["Building", "Failed", "Needs Clarification"].includes(value)],
    ["links", (value) => value !== null && typeof value === "object"],
    ["configKeys", (value) => value !== null && typeof value === "object"],
    ["artifacts", (value) => value !== null && typeof value === "object"],
    ["message", (value) => typeof value === "string"],
  ];

  const wrong = expected.filter(([key, ok]) => !ok(payload[key])).map(([key]) => key);
  if (wrong.length > 0) {
    fail(
      `The answer is missing or mistyped: ${wrong.join(", ")}`,
      "Every branch has to set the same seven fields before the Merge. See n8n/README.md → Response.",
    );
    return;
  }
  pass("The answer has the shape the chat parses.");

  if (payload.status === "Failed") {
    warn(
      `The workflow answered, but the build failed: ${payload.message}`,
      "That is the wiring working — the failure is inside a branch. artifacts carries the reason.",
    );
  } else if (payload.intent === "unclassified") {
    info(
      `Classified as "unclassified" — expected, for a probe prompt this vague.`,
      "The classifier was reached and answered, which is what this checks.",
    );
  } else {
    info(`Classified as "${payload.intent}", status "${payload.status}".`);
  }
}

async function main() {
  const url = process.argv[2] ?? readEnv("N8N_WEBHOOK_URL");
  const token = readEnv("N8N_WEBHOOK_TOKEN");

  if (!url) {
    fail(
      "N8N_WEBHOOK_URL is not set.",
      "This is the usual reason n8n never sees a call: /api/build answers 503 and nothing\n" +
        "    is ever sent. Put the production webhook in .env.local (and in the hosting\n" +
        "    platform's environment for the deployed app):\n" +
        "      N8N_WEBHOOK_URL=https://<instance>.app.n8n.cloud/webhook/api/v1/build\n" +
        "    See .env.local.example and n8n/README.md.",
    );
    return;
  }
  pass("N8N_WEBHOOK_URL is set.", url);

  if (url.includes("/webhook-test/")) {
    fail(
      "That is the editor's test URL, not the production one.",
      "A test URL accepts one call, and only while the canvas is open with\n" +
        '    "Listen for test event" running — which is what "waiting for the webhook call"\n' +
        "    on the canvas means. The app needs /webhook/ (no -test), and the workflow\n" +
        "    published.",
    );
  }

  if (!token) {
    fail(
      "N8N_WEBHOOK_TOKEN is not set.",
      "Not optional: the workflow writes to `projects` with the service_role key, which\n" +
        "    bypasses RLS, so an unauthenticated webhook lets anyone who learns the URL\n" +
        "    overwrite any project row. Generate one with:\n" +
        "      node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"\n" +
        "    then put the same string in the Webhook node's Header Auth credential.",
    );
  } else {
    pass(`N8N_WEBHOOK_TOKEN is set (${token.length} characters).`);
  }

  /* The request the app makes, minus the two ids that address a row: this must
     not be able to write over anyone's project. No projectId and no userId means
     `Sync Project Row` matches nothing. */
  const probe = {
    prompt: "Connectivity probe from tools/check-builder.mjs — no build is expected.",
    projectName: "check-builder probe",
    userId: "",
    projectId: "",
    requestId: `check-builder-${Date.now()}`,
    /* The app sends these two on every build now: which blueprint the page is
       built from, and the system prompt composed for it (src/lib/builder/
       blueprints, n8n/page-prompt.md). They are sent here so this probe still
       matches the request the app makes — a Normalize Build Request node that
       has not been given the two assignments drops them, and the page is then
       generated from whatever text is left on Compose Page Prompt. */
    buildKind: "landing",
    systemPrompt: "Connectivity probe — this prompt is never used to build anything.",
  };

  info("Sending one build request. This runs a real execution — give it a moment.");
  const attempt = await post(url, token ? { [TOKEN_HEADER]: token } : {}, probe);

  if (attempt.error) {
    fail(
      attempt.error?.name === "AbortError"
        ? `No answer within ${TIMEOUT_MS / 1000}s.`
        : `Could not reach the webhook: ${attempt.error?.message ?? attempt.error}`,
      "Check the host is right and reachable from here. A workflow that responds through\n" +
        '    a "Respond to Webhook" node answers nothing at all if the execution ends before\n' +
        "    reaching it — the n8n execution list will show that run.",
    );
    return;
  }

  const { response, text } = attempt;

  if (response.status === 404) {
    fail(
      "The webhook answered 404.",
      "Almost always an unpublished workflow: the production URL only exists once the\n" +
        "    workflow is active. Publishing is gated on every enabled node having its\n" +
        "    credentials attached. Otherwise, the path does not match the Webhook node's.",
    );
    return;
  }

  if (response.status === 401 || response.status === 403) {
    /* The one failure with two indistinguishable causes — a wrong secret and a
       wrong header name both come back as this. Sending the same token under
       Authorization separates them: if that is accepted, the secret was right
       all along and the credential is simply comparing the wrong header. */
    const underAuthorization = token
      ? await post(url, { Authorization: token }, probe)
      : null;

    if (underAuthorization?.response?.ok) {
      fail(
        `Rejected with ${response.status} under ${TOKEN_HEADER}, but accepted under Authorization.`,
        `The token is right; the Header Auth credential is comparing the wrong header.\n` +
          `    Set its Name field to ${TOKEN_HEADER} — the app sends the bare token with no\n` +
          `    "Bearer " prefix, and n8n compares the whole value.`,
      );
      return;
    }

    fail(
      `The webhook rejected the request (${response.status}).`,
      `The Header Auth credential on the Webhook node has to hold exactly:\n` +
        `      Name   ${TOKEN_HEADER}\n` +
        `      Value  the same string as N8N_WEBHOOK_TOKEN\n` +
        `    Neither name nor value is compared loosely. See n8n/README.md.\n` +
        /* Echoed because a 403 is not always n8n's: a corporate proxy between
           here and the instance refuses with the same status, and its body is
           the only thing that says so. */
        `    It answered: ${text.slice(0, 200) || "(nothing)"}`,
    );
    return;
  }

  if (!response.ok) {
    fail(`The webhook answered ${response.status}.`, text.slice(0, 400));
    return;
  }
  pass(`The webhook answered ${response.status}.`);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(
      "The answer was not JSON.",
      `The last node has to be "Respond to Webhook" returning the build payload.\n    Got: ${text.slice(0, 200)}`,
    );
    return;
  }

  checkShape(payload);
}

await main();

console.log("");
if (failures > 0) {
  console.log(`${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exitCode = 1;
} else {
  console.log("The chat can reach the orchestrator.");
}
