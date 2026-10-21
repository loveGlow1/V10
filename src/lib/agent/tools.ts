import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { Sandbox } from "e2b";
import { z } from "zod";

import { currentTree, storeTree } from "@/lib/builder/store-tree";
import type { FileTree } from "@/lib/builder/tree";
import { openSession, terminalConfigured } from "@/lib/terminal/sandbox";

import { signSnapshot } from "./persist";
import { documentFor, takeSnapshot } from "./snapshot";

/* What the agent can do, and the project it does it to.
 *
 * The files live in the project, not in the session: write_file and edit_file
 * change a working copy of the project's current version, and that copy is
 * saved as ONE new version when it matters — before a screenshot, so the
 * picture is of what was written, and when the turn ends. Saved the way every
 * other change here is saved (a project_builds row and its files), so the
 * version history, the preview, Undo and publishing all see the agent's work
 * like anyone else's.
 *
 * Commands run in the project's E2B sandbox — its own Linux VM, the same one
 * the workspace terminal opens — with the working copy written into it first,
 * so a build runs on what the agent just wrote. */

const PROJECT_DIR = "/home/user/project";
const MAX_FILE = 400_000;
const MAX_OUTPUT = 12_000;

/** Files whose change changes what the page looks like — worth a screenshot. */
export const VISUAL_FILE = /\.(?:tsx|jsx|html?|css)$/i;

const tail = (text: string) => (text.length > MAX_OUTPUT ? `…${text.slice(-MAX_OUTPUT)}` : text);
const lineCount = (text: string) => (text ? text.split("\n").length : 0);

/* A path the project could hold: relative, no climbing out, no hidden
   platform directories. */
function cleanPath(path: string): string | null {
  const trimmed = path.trim().replace(/^\.?\/+/, "");
  if (!trimmed || trimmed.length > 300 || /(^|\/)\.\.(\/|$)/.test(trimmed) || /^(?:node_modules|\.git|\.next)\//.test(trimmed)) return null;
  return /^[\w@./()[\]+ -]+$/.test(trimmed) ? trimmed : null;
}

export class Workspace {
  private files = new Map<string, string>();
  private dirty = new Set<string>();
  readonly touched = new Set<string>();
  private singlePage: string | null = null;
  private loaded = false;
  private html: string | null = null;
  private synced = false;

  constructor(
    private service: SupabaseClient,
    readonly ctx: { userId: string; projectId: string | null; projectName: string | null; sessionId: string },
    /* projectId is cleared by load() when the project is not the user's. */
  ) {}

  async load(): Promise<void> {
    if (this.loaded || !this.ctx.projectId) return;
    this.loaded = true;
    /* The service key reads any project, and a session row names its project
       itself — so whose it is is checked here, where every read and write of
       the files begins. Not the caller's: no project at all. */
    const { data: owned } = await this.service
      .from("projects")
      .select("id")
      .eq("id", this.ctx.projectId)
      .eq("user_id", this.ctx.userId)
      .maybeSingle();
    if (!owned) {
      this.ctx.projectId = null;
      return;
    }
    const current = await currentTree(this.service, this.ctx.projectId);
    this.html = current.html;
    for (const file of current.tree) this.files.set(file.path, file.content);
    /* A single page is one document and nothing else: the stack has nowhere
       to keep a second file. Same test the visual editor uses. */
    if (!current.sourceMissing && current.html && !current.tree.some((file) => /\.(?:tsx|jsx)$/.test(file.path))) {
      this.singlePage = current.tree[0]?.path ?? "index.html";
      if (!this.files.has(this.singlePage)) this.files.set(this.singlePage, current.html);
    }
  }

  get hasProject(): boolean {
    return Boolean(this.ctx.projectId);
  }

  read(path: string): string | undefined {
    return this.files.get(path);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** Why this path cannot be written, or null when it can. */
  refuse(path: string): string | null {
    if (!this.hasProject) return "This session is not linked to a project, so there is nowhere to write files.";
    if (this.singlePage && path !== this.singlePage) {
      return `This project is a single page: everything lives in ${this.singlePage}. Write that file instead.`;
    }
    return null;
  }

  write(path: string, content: string) {
    this.files.set(path, content);
    this.dirty.add(path);
    this.touched.add(path);
  }

  get isDirty(): boolean {
    return this.dirty.size > 0;
  }

  tree(): FileTree {
    return [...this.files.entries()].map(([path, content]) => ({ path, content }));
  }

  /** The page as it stands now, unsaved edits included — what a screenshot renders. */
  document(): string | null {
    if (this.singlePage) return this.files.get(this.singlePage) ?? this.html;
    return documentFor(this.tree(), this.html, this.ctx.projectName);
  }

  /**
   * Saves the working copy as one new version, if anything changed. Returns
   * false only when the save itself failed — then the edits are still in the
   * working copy and the next flush tries again.
   */
  async flush(summary: string): Promise<boolean> {
    if (!this.isDirty || !this.ctx.projectId) return true;
    const page = this.singlePage ? (this.files.get(this.singlePage) ?? "") : (this.html ?? "");
    const { data: build, error } = await this.service
      .from("project_builds")
      .insert({
        project_id: this.ctx.projectId,
        user_id: this.ctx.userId,
        prompt: `Agent: ${summary}`.slice(0, 1000),
        html: page,
        model: "agent",
        files_touched: this.dirty.size,
      })
      .select("id")
      .single();
    if (error || !build) return false;
    if (!this.singlePage) {
      try {
        await storeTree(this.service, { buildId: build.id as string, projectId: this.ctx.projectId, userId: this.ctx.userId }, this.tree());
      } catch {
        await this.service.from("project_builds").delete().eq("id", build.id);
        return false;
      }
    }
    await this.service
      .from("projects")
      .update({ last_build_at: new Date().toISOString() })
      .eq("id", this.ctx.projectId)
      .eq("user_id", this.ctx.userId);
    this.dirty.clear();
    this.synced = false;
    return true;
  }

  /** Runs a command in the project's sandbox, on the working copy. */
  async run(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number } | { error: string }> {
    if (!this.ctx.projectId) return { error: "This session is not linked to a project." };
    if (!terminalConfigured()) return { error: "Commands need the project sandbox, which is not set up on this deployment (E2B_API_KEY)." };
    try {
      const session = await openSession({
        projectId: this.ctx.projectId,
        userId: this.ctx.userId,
        files: this.tree(),
        env: {},
        sync: !this.synced || this.isDirty,
      });
      this.synced = true;
      const sandbox = await Sandbox.connect(session.sandboxId);
      const result = await sandbox.commands.run(cmd, { cwd: PROJECT_DIR, timeoutMs: 120_000 }).catch((error: unknown) => {
        /* A non-zero exit throws with the result on it. */
        const failed = error as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
        if (typeof failed.exitCode === "number") return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", exitCode: failed.exitCode };
        throw error;
      });
      return { stdout: tail(result.stdout ?? ""), stderr: tail(result.stderr ?? ""), exitCode: result.exitCode ?? 0 };
    } catch (error) {
      return { error: error instanceof Error ? `The command could not run: ${error.message}` : "The command could not run." };
    }
  }
}

export type SnapshotState = { lastPath: string | null; previewUrl: string | null };

/** The five tools, bound to one session's workspace. */
export function createTools(service: SupabaseClient, workspace: Workspace, shots: SnapshotState) {
  return {
    write_file: tool({
      description:
        "Create or overwrite a file in the project with its complete contents. Use for new files, or when most of a file changes. Paths are relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative path, e.g. app/page.tsx"),
        content: z.string().describe("The whole file"),
      }),
      execute: async ({ path, content }) => {
        await workspace.load();
        const clean = cleanPath(path);
        if (!clean) throw new Error(`"${path}" is not a path this project can hold.`);
        const refused = workspace.refuse(clean);
        if (refused) throw new Error(refused);
        if (content.length > MAX_FILE) throw new Error("That file is too large to write in one go.");
        const existed = workspace.read(clean) !== undefined;
        workspace.write(clean, content);
        return { path: clean, lines: lineCount(content), created: !existed };
      },
    }),

    edit_file: tool({
      description:
        "Replace one exact passage in an existing file. `find` must occur exactly once — include enough surrounding lines to make it unique. Prefer this to write_file for small changes.",
      inputSchema: z.object({
        path: z.string(),
        find: z.string().describe("Exact text currently in the file, occurring once"),
        replace: z.string().describe("What it becomes"),
      }),
      execute: async ({ path, find, replace }) => {
        await workspace.load();
        const clean = cleanPath(path);
        if (!clean) throw new Error(`"${path}" is not a path this project can hold.`);
        const refused = workspace.refuse(clean);
        if (refused) throw new Error(refused);
        const current = workspace.read(clean);
        if (current === undefined) throw new Error(`${clean} does not exist. Use write_file to create it.`);
        const first = current.indexOf(find);
        if (!find || first < 0) throw new Error(`That passage is not in ${clean}. Read the file and copy the text exactly.`);
        if (current.indexOf(find, first + 1) >= 0) throw new Error(`That passage occurs more than once in ${clean}. Include more surrounding lines.`);
        workspace.write(clean, current.slice(0, first) + replace + current.slice(first + find.length));
        return { path: clean, added: lineCount(replace), removed: lineCount(find), find, replace };
      },
    }),

    read_file: tool({
      description: "Read a file from the project. Call with path \".\" to list every file.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        await workspace.load();
        if (!workspace.hasProject) throw new Error("This session is not linked to a project.");
        if (path.trim() === "." || path.trim() === "/") return { path: ".", files: workspace.paths() };
        const clean = cleanPath(path);
        const content = clean ? workspace.read(clean) : undefined;
        if (content === undefined) throw new Error(`${path} does not exist. Read "." to list the files.`);
        return { path: clean, lines: lineCount(content), content: content.length > MAX_FILE ? content.slice(0, MAX_FILE) : content };
      },
    }),

    run_command: tool({
      description:
        "Run a shell command in the project's sandbox (its own Linux VM) from the project root, e.g. `npm run build`. Returns stdout, stderr and the exit code. Two-minute limit.",
      inputSchema: z.object({ cmd: z.string().min(1).max(2000) }),
      execute: async ({ cmd }) => {
        await workspace.load();
        const result = await workspace.run(cmd);
        if ("error" in result) throw new Error(result.error);
        return result;
      },
    }),

    take_snapshot: tool({
      description:
        "Take a screenshot of the project as it is now (1280×800, plus a 390×844 phone view when mobile is true), and look at it. Use it to check your work.",
      inputSchema: z.object({
        path: z.string().optional().describe("A route on the preview, e.g. /pricing"),
        mobile: z.boolean().optional(),
      }),
      execute: async ({ path, mobile }) => {
        await workspace.load();
        /* Saved first, so the picture is of what was written. */
        if (workspace.isDirty) await workspace.flush("changes before a screenshot");
        const result = await takeSnapshot(service, {
          sessionId: workspace.ctx.sessionId,
          previewUrl: shots.previewUrl,
          path: path ?? null,
          html: shots.previewUrl ? null : workspace.document(),
          mobile: mobile ?? false,
        });
        if (!result.ok) throw new Error(result.error);
        const before = shots.lastPath ? await signSnapshot(service, shots.lastPath) : null;
        const output = {
          url: result.desktop.url,
          path: result.desktop.path,
          label: path ? `Screenshot of ${path}` : "Screenshot",
          ...(before && shots.lastPath ? { before, beforePath: shots.lastPath } : {}),
          ...(result.mobile ? { mobileUrl: result.mobile.url, mobilePath: result.mobile.path } : {}),
        };
        shots.lastPath = result.desktop.path;
        return output;
      },
      /* The picture itself goes back to the model — by its signed address, so
         the tool output stored and streamed stays a few hundred bytes. */
      toModelOutput: ({ output }) => {
        const shot = output as { url: string; mobileUrl?: string };
        return {
          type: "content",
          value: [
            { type: "text", text: "Here is the screenshot of the page as it is now. Check it against what you intended." },
            { type: "file", mediaType: "image/png", data: { type: "url", url: new URL(shot.url) } },
            ...(shot.mobileUrl
              ? [{ type: "file" as const, mediaType: "image/png", data: { type: "url" as const, url: new URL(shot.mobileUrl) } }]
              : []),
          ],
        };
      },
    }),
  };
}

export type AgentTools = ReturnType<typeof createTools>;
