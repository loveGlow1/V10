import type { SupabaseClient } from "@supabase/supabase-js";

import { PLANS, formatCredits, type PlanId } from "@/app/dashboard/credits";
import { publishedUrl } from "@/lib/publish/naming";

import { readBuildStream, summarise } from "./build-reply";
import { errorResult, textResult, type Tool, type ToolResult } from "./protocol";

/* What QuickStark offers an AI assistant.
 *
 * Each tool is a thin wrapper over something the workspace already does, and
 * goes through the same door the workspace does: reads under the person's own
 * session so RLS answers, and builds and publishing through /api/build and
 * /api/publish themselves, called as that person. Nothing here re-implements a
 * credit check, a card check, a plan rule or an ownership test — the routes
 * already hold those, and a second copy is the one that drifts.
 *
 * Deliberately left out: deleting anything, database changes (the workspace
 * shows the SQL and asks), GitHub, video and flyers. */

export type McpContext = {
  /** This deployment's own origin, e.g. https://www.quickstark.tech. */
  origin: string;
  userId: string;
  /** A client acting as the person, so RLS applies. */
  db: SupabaseClient;
  /** Calls one of this app's own routes as the person. */
  route: (path: string, init?: RequestInit) => Promise<Response>;
  /** When this request must have answered by (epoch ms). */
  deadline: number;
};

const PROJECT_COLUMNS = "id, name, status, updated_at, preview_url, slug, published_at, last_build_at";

type ProjectRow = {
  id: string;
  name: string | null;
  status: string | null;
  updated_at: string | null;
  preview_url: string | null;
  slug: string | null;
  published_at: string | null;
  last_build_at: string | null;
};

const REQUEST_SCHEMA = {
  kind: {
    type: "string",
    description: "Only when QuickStark asked what kind of thing this is: the value of the option the person chose.",
  },
  stack: {
    type: "string",
    enum: ["standalone-html", "nextjs"],
    description: "Only when QuickStark asked: a single page (standalone-html) or a full app (nextjs).",
  },
  architecture: {
    type: "string",
    enum: ["managed", "full", "frontend", "own", "later"],
    description: "Only when QuickStark asked whether the app needs a database: the value of the option the person chose.",
  },
} as const;

export const TOOLS: Tool<McpContext>[] = [
  {
    name: "list_projects",
    title: "List my QuickStark apps",
    description: "Lists the person's QuickStark projects, newest first, with each one's status, preview link and live link.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Only projects whose name contains this." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many to return. Default 20." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args, context) => {
      const limit = clamp(Number(args.limit) || 20, 1, 50);
      let query = context.db
        .from("projects")
        .select(PROJECT_COLUMNS)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit);
      const search = typeof args.search === "string" ? args.search.trim() : "";
      if (search) query = query.ilike("name", `%${search.replace(/[%_]/g, "")}%`);

      const { data, error } = await query;
      if (error) return errorResult(`Couldn't read the projects: ${error.message}`);
      const rows = (data ?? []) as ProjectRow[];
      if (rows.length === 0) {
        return textResult(search ? `No projects match "${search}".` : "No projects yet — create_app starts one.");
      }
      return textResult(rows.map((row) => describeProject(row, context.origin)).join("\n\n"));
    },
  },

  {
    name: "get_project",
    title: "Check on a QuickStark app",
    description:
      "Shows one project: its status, whether a build is still running and how far it has got, its preview link and its live link. Use it to follow up on a build that was still running.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string", description: "The project's id, from list_projects or create_app." } },
      required: ["project_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args, context) => {
      const id = String(args.project_id).trim();
      const row = await projectRow(context, id);
      if (!row) return errorResult(`No project with id ${id}. list_projects shows the ones available.`);

      const lines = [describeProject(row, context.origin)];
      const progress = await context.route(`/api/projects/${encodeURIComponent(id)}/build`).catch(() => null);
      const state = progress?.ok
        ? ((await progress.json().catch(() => null)) as
            | {
                building?: boolean;
                job?: { label?: string; state?: string; progress?: number } | null;
                steps?: { label?: string; state?: string }[];
                deployment?: { state?: string; url?: string | null; error?: string | null } | null;
              }
            | null)
        : null;

      if (state?.building) {
        const step = state.steps?.filter((s) => s.label).at(-1)?.label;
        const job = state.job?.label ?? state.job?.state ?? "building";
        lines.push(`A build is running: ${job}${step ? ` — ${step}` : ""}. Check again in a minute.`);
      } else if (state?.deployment?.state) {
        lines.push(
          `Latest deployment: ${state.deployment.state}${state.deployment.error ? ` (${state.deployment.error})` : ""}.`,
        );
      }
      return textResult(lines.join("\n"));
    },
  },

  {
    name: "create_app",
    title: "Build a new app with QuickStark",
    description:
      "Starts a new QuickStark project and builds an app from a plain-English description — pages, layout, mobile view and, if it needs one, a database. " +
      "Spends the person's credits, so confirm first. May answer with a question and options instead of building; ask the person and call again with their answer.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What to build, in the person's words, with any detail they gave (who it's for, pages, features, style).",
        },
        name: { type: "string", description: "A name for the project. Optional." },
        project_id: {
          type: "string",
          description: "Only when answering a question QuickStark asked about a create_app call: the project_id that call returned.",
        },
        ...REQUEST_SCHEMA,
      },
      required: ["description"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: async (args, context) => {
      const description = String(args.description).trim();
      let projectId = typeof args.project_id === "string" ? args.project_id.trim() : "";

      if (projectId) {
        if (!(await projectRow(context, projectId))) return errorResult(`No project with id ${projectId}.`);
      } else {
        const name = (typeof args.name === "string" && args.name.trim()) || nameFrom(description);
        const { data, error } = await context.db
          .from("projects")
          .insert({ user_id: context.userId, name })
          .select("id")
          .single();
        if (error || !data) return errorResult(`Couldn't create the project: ${error?.message ?? "no row came back"}.`);
        projectId = (data as { id: string }).id;
      }

      const result = await build(context, projectId, description, args);
      return withProjectId(result, projectId);
    },
  },

  {
    name: "edit_app",
    title: "Change a QuickStark app",
    description:
      "Changes an existing QuickStark app from a plain-English request (\"make the header black\", \"add a reviews section\"), or asks it a question about the app. " +
      "Spends the person's credits, so confirm first.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project's id, from list_projects." },
        request: { type: "string", description: "What to change, in the person's words." },
        confirm_replace: {
          type: "boolean",
          description: "Only when QuickStark said this would replace the existing app and the person agreed.",
        },
        upgrade: {
          type: "boolean",
          description: "Only when QuickStark offered to upgrade a single page to a full app and the person agreed.",
        },
        ...REQUEST_SCHEMA,
      },
      required: ["project_id", "request"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: async (args, context) => {
      const projectId = String(args.project_id).trim();
      if (!(await projectRow(context, projectId))) {
        return errorResult(`No project with id ${projectId}. list_projects shows the ones available.`);
      }
      return withProjectId(await build(context, projectId, String(args.request).trim(), args), projectId);
    },
  },

  {
    name: "publish_app",
    title: "Publish a QuickStark app",
    description:
      "Puts a project live on the internet and returns its public address. Spends the person's credits, so confirm first. Publishing again updates the live site.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string", description: "The project's id, from list_projects." } },
      required: ["project_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: async (args, context) => {
      const projectId = String(args.project_id).trim();
      const response = await context.route("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { published?: boolean; url?: string; error?: string; stage?: string }
        | null;

      if (!response.ok || !body?.published) {
        return errorResult(
          `${body?.error ?? `Publishing didn't go through (status ${response.status}).`}\nOpen it in QuickStark: ${workspaceUrl(context.origin)}`,
        );
      }
      return textResult(`Live at ${body.url}`);
    },
  },

  {
    name: "get_credits",
    title: "Check QuickStark credits",
    description: "Shows the person's plan and how many credits they have left.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (_args, context) => {
      const { data, error } = await context.db
        .from("credit_balances")
        .select("plan_id, daily, monthly, rollover, top_up")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) return errorResult(`Couldn't read the balance: ${error.message}`);
      if (!data) return textResult(`No balance yet — it is set up the first time the person opens ${workspaceUrl(context.origin)}.`);

      const row = data as { plan_id: string; daily: unknown; monthly: unknown; rollover: unknown; top_up: unknown };
      const total = [row.daily, row.monthly, row.rollover, row.top_up].reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
      const plan = PLANS[row.plan_id as PlanId]?.name ?? row.plan_id;
      return textResult(
        `Plan: ${plan}\nCredits left: ${formatCredits(total)}\nTop up or change plan: ${context.origin}/pricing`,
      );
    },
  },
];

async function build(
  context: McpContext,
  projectId: string,
  prompt: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const pick = (key: string) => (typeof args[key] === "string" && (args[key] as string).trim() ? (args[key] as string).trim() : null);

  const response = await context.route("/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      prompt,
      buildKind: pick("kind"),
      stack: pick("stack"),
      architecture: pick("architecture"),
      confirmNewProject: args.confirm_replace === true,
      upgrade: args.upgrade === true,
    }),
  });

  /* Answer a little before this request's own limit, so a long build is
     reported as still running rather than cut off mid-sentence. */
  const read = await readBuildStream(response, context.deadline);
  const summary = summarise(read, { workspace: workspaceUrl(context.origin), projectId });
  return summary.isError ? errorResult(summary.text) : textResult(summary.text);
}

async function projectRow(context: McpContext, id: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await context.db
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as ProjectRow | null) ?? null;
}

function describeProject(row: ProjectRow, origin: string): string {
  const lines = [`${row.name || "Untitled"} — project_id ${row.id}`, `Status: ${row.status ?? "Draft"}`];
  if (row.preview_url) lines.push(`Preview: ${row.preview_url}`);
  if (row.published_at && row.slug) lines.push(`Live: ${publishedUrl(row.slug)}`);
  if (row.updated_at) lines.push(`Updated: ${row.updated_at.slice(0, 16).replace("T", " ")} UTC`);
  lines.push(`Workspace: ${workspaceUrl(origin)}`);
  return lines.join("\n");
}

function withProjectId(result: ToolResult, projectId: string): ToolResult {
  return { ...result, content: [...result.content, { type: "text", text: `project_id: ${projectId}` }] };
}

function workspaceUrl(origin: string): string {
  return `${origin}/dashboard`;
}

/* A first name for the project, from the opening words of the brief. The
   workspace renames projects from what gets built, so this only has to be
   recognisable until then. */
function nameFrom(description: string): string {
  const words = description.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const name = words.length > 48 ? `${words.slice(0, 47)}…` : words;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "New app";
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}
