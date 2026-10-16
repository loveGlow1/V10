import "server-only";

import { createHmac } from "node:crypto";

import { Sandbox } from "e2b";

import { BRIDGE_PATH, BRIDGE_PORT, BRIDGE_SOURCE } from "./bridge-source";

/* A project's terminal sandbox, on E2B.
 *
 * One isolated Linux microVM per (user, project), found again by its metadata
 * rather than stored anywhere: the same sandbox comes back across page loads
 * and devices, with its shells and whatever they are running. It is created
 * with the project's files and the PUBLIC half of its environment — never the
 * platform's service keys, which this module does not read — and the bridge
 * (bridge-source.ts) puts its shells on a WebSocket the browser connects to
 * directly, because a serverless function cannot hold one open.
 *
 * Idle for IDLE_MS it pauses with its memory kept, and resumes the next time
 * it is asked for: processes carry on where they were.
 *
 * Auth: the bridge accepts a connection only with a token signed by this
 * sandbox's own key. The key is derived here from TERMINAL_SECRET (or the
 * E2B key) and the sandbox id, handed to the bridge's process alone, and kept
 * out of every shell it starts. Tokens expire after TOKEN_SECONDS. */

const TEMPLATE = process.env.E2B_TEMPLATE || "base";
export const IDLE_MS = 30 * 60 * 1000;
const TOKEN_SECONDS = 60;
const PROJECT_DIR = "/home/user/project";

export function terminalConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

function secret(): string {
  return process.env.TERMINAL_SECRET || process.env.E2B_API_KEY || "";
}

function bridgeKey(sandboxId: string): string {
  return createHmac("sha256", secret()).update(`bridge:${sandboxId}`).digest("hex");
}

/** A connection token for this sandbox's bridge, good for TOKEN_SECONDS. */
export function connectionToken(sandboxId: string): { exp: string; token: string } {
  const exp = String(Math.floor(Date.now() / 1000) + TOKEN_SECONDS);
  return { exp, token: createHmac("sha256", bridgeKey(sandboxId)).update(exp).digest("hex") };
}

export type TerminalSession = {
  sandboxId: string;
  /** wss://… with the token on it, ready to open. */
  url: string;
  /** The address of a port inside the sandbox, with {port} to fill in. */
  portUrl: string;
  created: boolean;
};

async function find(projectId: string, userId: string): Promise<string | null> {
  const paginator = Sandbox.list({ query: { metadata: { qsProject: projectId, qsUser: userId } } });
  const found = await paginator.nextItems();
  return found[0]?.sandboxId ?? null;
}

async function healthy(host: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${host}/health`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function startBridge(sandbox: Sandbox): Promise<void> {
  await sandbox.files.write(BRIDGE_PATH, BRIDGE_SOURCE);
  await sandbox.commands.run(
    `nohup python3 ${BRIDGE_PATH} > /home/user/.quickstark/bridge.log 2>&1 & disown`,
    {
      envs: {
        QS_BRIDGE_KEY: bridgeKey(sandbox.sandboxId),
        QS_BRIDGE_PORT: String(BRIDGE_PORT),
        QS_PROJECT_DIR: PROJECT_DIR,
      },
      timeoutMs: 15_000,
    },
  );
  const host = sandbox.getHost(BRIDGE_PORT);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (await healthy(host)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("the terminal did not start in its sandbox");
}

/**
 * The project's sandbox, found or made, with its bridge running, and a URL to
 * connect to. `files` (the project's current source) are written when the
 * sandbox is new or when `sync` asks — the first open on each page load — so
 * the shell sees what the builder last produced.
 */
export async function openSession(input: {
  projectId: string;
  userId: string;
  files: { path: string; content: string }[];
  env: Record<string, string>;
  sync: boolean;
}): Promise<TerminalSession> {
  const existing = await find(input.projectId, input.userId);
  let sandbox: Sandbox;
  let created = false;
  if (existing) {
    /* Resumes a paused one; extends a running one's idle window. */
    sandbox = await Sandbox.connect(existing, { timeoutMs: IDLE_MS });
  } else {
    sandbox = await Sandbox.create(TEMPLATE, {
      timeoutMs: IDLE_MS,
      metadata: { qsProject: input.projectId, qsUser: input.userId },
      envs: input.env,
      lifecycle: { onTimeout: { action: "pause", keepMemory: true }, autoResume: true },
    });
    created = true;
  }

  if (created || input.sync) {
    const files = input.files
      .filter((file) => !file.path.startsWith(".devcontainer/"))
      .map((file) => ({ path: `${PROJECT_DIR}/${file.path}`, data: file.content }));
    if (files.length) await sandbox.files.write(files);
  }

  const host = sandbox.getHost(BRIDGE_PORT);
  if (!(await healthy(host))) await startBridge(sandbox);

  const { exp, token } = connectionToken(sandbox.sandboxId);
  return {
    sandboxId: sandbox.sandboxId,
    url: `wss://${host}/?exp=${exp}&token=${token}`,
    portUrl: `https://${host.replace(new RegExp(`^${BRIDGE_PORT}-`), "{port}-")}`,
    created,
  };
}

/** Keeps the sandbox from pausing while somebody is using it. */
export async function keepAlive(projectId: string, userId: string): Promise<boolean> {
  const id = await find(projectId, userId);
  if (!id) return false;
  await Sandbox.setTimeout(id, IDLE_MS);
  return true;
}

/** Ends it — every shell and process — so the next open starts fresh. */
export async function endSession(projectId: string, userId: string): Promise<boolean> {
  const id = await find(projectId, userId);
  if (!id) return false;
  return Sandbox.kill(id);
}
