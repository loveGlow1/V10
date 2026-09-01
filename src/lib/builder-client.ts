/* The browser's side of /api/builder.
 *
 * Kept out of ProjectsContext deliberately: that context owns the projects
 * list and the orchestrator build, and this is a second, separate path. The
 * two do not share state, so nothing here can disturb a build in flight. */

export type BuilderIntent = "edit" | "new_project" | "question" | "revert";

export type BuilderReply =
  /* The change landed. `applied` names the files it touched. */
  | { kind: "edit"; applied: string[]; paths: string[] }
  /* A whole project was generated. */
  | { kind: "new_project"; paths: string[] }
  /* A question, answered without touching anything. */
  | { kind: "question"; message: string }
  | { kind: "revert"; message: string; paths: string[] }
  /* Destructive, so it stopped and asked. Nothing has changed yet. */
  | { kind: "confirm"; message: string }
  /* The patch would not apply cleanly, so nothing was modified. */
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string };

/** The paths this project already has, or [] if it has never been built here. */
export async function builderPaths(projectId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `/api/builder?projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { paths?: unknown };
    return Array.isArray(payload.paths) ? (payload.paths as string[]) : [];
  } catch {
    // Offline or the route is not deployed: treat it as "nothing to edit",
    // which sends the message down the orchestrator path instead.
    return [];
  }
}

export async function askBuilder(opts: {
  projectId: string;
  message: string;
  intentOverride?: BuilderIntent | null;
  confirmNewProject?: boolean;
}): Promise<BuilderReply> {
  let response: Response;
  try {
    response = await fetch("/api/builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: opts.projectId,
        message: opts.message,
        intentOverride: opts.intentOverride ?? null,
        confirmNewProject: opts.confirmNewProject === true,
      }),
    });
  } catch {
    return { kind: "error", message: "Could not reach the builder." };
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        intent?: BuilderIntent;
        needsConfirmation?: boolean;
        message?: string;
        error?: string;
        applied?: string[];
        files?: { path: string }[];
      }
    | null;

  if (!payload) return { kind: "error", message: "The builder sent nothing back." };

  const paths = Array.isArray(payload.files) ? payload.files.map((file) => file.path) : [];

  if (payload.needsConfirmation) {
    return { kind: "confirm", message: payload.message ?? "Replace the current project?" };
  }

  /* 422 is the patch refusing to apply rather than a failure: the project is
     untouched, and the wording the route sends is what the person needs to
     read before rephrasing. */
  if (response.status === 422) {
    return {
      kind: "refused",
      message: payload.error ?? "Could not apply that change. Nothing was modified.",
    };
  }

  if (!response.ok) {
    return { kind: "error", message: payload.error ?? "The builder could not answer." };
  }

  switch (payload.intent) {
    case "question":
      return { kind: "question", message: payload.message ?? "" };
    case "revert":
      return { kind: "revert", message: payload.message ?? "Reverted.", paths };
    case "new_project":
      return { kind: "new_project", paths };
    default:
      return { kind: "edit", applied: payload.applied ?? [], paths };
  }
}
