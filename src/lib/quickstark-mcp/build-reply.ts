/* Reading /api/build for an AI assistant, and saying what came of it.
 *
 * The route answers in newline-delimited JSON: a line per step as it happens,
 * text as it is written, and a last `result` line carrying what the workspace
 * gets. An assistant has no panel to fill in, so this reads the stream to that
 * last line — or to a deadline, because a build can outlast the request asking
 * for it — and turns the result into a few sentences and the links that matter.
 *
 * Pure: no Next, no Supabase, so check:mcp runs it offline. */

export type BuildPayload = {
  continuable?: boolean;
  intent?: string;
  needsConfirmation?: boolean;
  needsKind?: boolean;
  kindOptions?: { kind: string; label: string; blurb?: string }[];
  needsStack?: boolean;
  stackOptions?: { stack: string; label: string; blurb?: string }[];
  needsArchitecture?: boolean;
  architectureOptions?: { value: string; label: string; blurb?: string }[];
  needsUpgrade?: boolean;
  needsSqlConfirm?: boolean;
  surgery?: unknown;
  needsDatabase?: boolean;
  build?: { message?: string; status?: string; links?: { preview?: string; repo?: string; admin?: string } };
  project?: { id?: string; name?: string; preview_url?: string | null } | null;
  buildKind?: string;
  stack?: string;
  error?: string;
  messageLinks?: { label: string; href: string }[];
  code?: string;
  cardRequired?: boolean;
};

export type BuildRead = {
  /** The result line arrived. False when the deadline came first. */
  finished: boolean;
  status: number;
  payload: BuildPayload | null;
  /** Prose streamed as it was written — an answer to a question arrives this way. */
  text: string;
  /** The last few step labels, to say where an unfinished build had got to. */
  lastSteps: string[];
};

/** Reads the stream until its result line, or until `deadline` (epoch ms). */
export async function readBuildStream(response: Response, deadline: number): Promise<BuildRead> {
  const read: BuildRead = { finished: false, status: response.status, payload: null, text: "", lastSteps: [] };

  /* Not a stream at all: a refusal before the route began (a 4xx from
     middleware, a platform error page). Read it as one JSON body if it is one. */
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("ndjson") || !response.body) {
    const body = (await response.json().catch(() => null)) as BuildPayload | null;
    return { ...read, finished: true, payload: body };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const take = (line: string) => {
    if (!line.trim()) return;
    let parsed: { type?: string; step?: { label?: string; id?: string }; delta?: string; status?: number; body?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.type === "text" && typeof parsed.delta === "string") read.text += parsed.delta;
    else if (parsed.type === "step" && parsed.step?.label) {
      const label = parsed.step.label;
      read.lastSteps = [...read.lastSteps.filter((seen) => seen !== label), label].slice(-3);
    } else if (parsed.type === "result") {
      read.finished = true;
      read.status = parsed.status ?? read.status;
      read.payload = (parsed.body as BuildPayload | null) ?? null;
    }
  };

  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), left)),
    ]);
    if (chunk === "timeout") break;
    if (chunk.done) {
      take(buffer + decoder.decode());
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(take);
    if (read.finished) break;
  }

  /* Stop listening without stopping the build: the route records its work
     whether or not anyone is still reading. */
  reader.cancel().catch(() => undefined);
  return read;
}

export type Summary = {
  text: string;
  isError: boolean;
};

/** What an assistant should be told about one build request. */
export function summarise(read: BuildRead, links: { workspace: string; projectId: string | null }): Summary {
  const { payload } = read;
  const workspace = `Open it in QuickStark: ${links.workspace}`;

  if (!read.finished) {
    const where = read.lastSteps.length > 0 ? ` Last step: ${read.lastSteps[read.lastSteps.length - 1]}.` : "";
    return {
      text:
        `The build is still running and carries on without this call.${where} ` +
        `Check on it in a minute with get_project${links.projectId ? ` (project_id ${links.projectId})` : ""}.\n${workspace}`,
      isError: false,
    };
  }

  if (!payload) {
    return { text: `QuickStark didn't answer that one (status ${read.status}). Try again in a moment.\n${workspace}`, isError: true };
  }

  if (payload.cardRequired || payload.code === "card_required") {
    return {
      text: `${payload.error ?? "A card is needed before building."} The person can add one at ${links.workspace} — they won't be charged.`,
      isError: true,
    };
  }

  const said = (payload.build?.message ?? read.text ?? "").trim();

  /* Questions come back as options to put to the person, with the exact value
     to send back. Nothing has been built or charged yet. */
  if (payload.needsKind && payload.kindOptions?.length) {
    return question(payload, "What kind of thing should this be?", "kind", payload.kindOptions.map((o) => ({ value: o.kind, label: o.label, blurb: o.blurb })));
  }
  if (payload.needsStack && payload.stackOptions?.length) {
    return question(payload, "Should this be a single page or a full app?", "stack", payload.stackOptions.map((o) => ({ value: o.stack, label: o.label, blurb: o.blurb })));
  }
  if (payload.needsArchitecture && payload.architectureOptions?.length) {
    return question(payload, "Does this need a database and sign-ins behind it?", "architecture", payload.architectureOptions);
  }
  if (payload.needsConfirmation) {
    return {
      text:
        `${said || "This would replace the app already in this project."} Nothing has changed yet. ` +
        `If the person wants to replace it, call again with confirm_replace: true — or use create_app to start a separate project.`,
      isError: false,
    };
  }
  if (payload.needsUpgrade) {
    return {
      text: `${said || "That needs this page upgraded to a full app."} Nothing has changed yet. If the person agrees, call again with upgrade: true.`,
      isError: false,
    };
  }
  if (payload.needsSqlConfirm || payload.surgery || payload.needsDatabase) {
    return {
      text: `${payload.error ?? (said || "This change touches the app's database.")} For safety, database changes are approved in the QuickStark workspace, not from here.\n${workspace}`,
      isError: false,
    };
  }

  if (read.status >= 400 || (!payload.build && payload.error)) {
    return { text: `${payload.error || said || "That didn't go through."}\n${workspace}`, isError: true };
  }

  const lines: string[] = [];
  if (said) lines.push(said);
  const preview = payload.build?.links?.preview || payload.project?.preview_url;
  if (preview) lines.push(`Preview: ${preview}`);
  for (const link of payload.messageLinks ?? []) lines.push(`${link.label}: ${link.href}`);
  if (payload.continuable) lines.push("The change stopped at the time limit with work left — call edit_app again with \"carry on\" to finish it.");
  lines.push(workspace);
  return { text: lines.join("\n"), isError: false };
}

function question(
  payload: BuildPayload,
  fallback: string,
  argument: string,
  options: { value: string; label: string; blurb?: string }[],
): Summary {
  const asked = payload.build?.message?.trim() || fallback;
  const listed = options.map((o) => `- ${o.label}${o.blurb ? ` — ${o.blurb}` : ""} (${argument}: "${o.value}")`).join("\n");
  /* The reading of the brief that produced the question, sent back with the
     answer so it lands on the same reading rather than a fresh one. */
  const carried = [
    payload.buildKind && argument !== "kind" ? `kind: "${payload.buildKind}"` : null,
    payload.stack && argument !== "stack" ? `stack: "${payload.stack}"` : null,
  ].filter(Boolean);
  const also = carried.length > 0 ? ` Also send ${carried.join(" and ")}.` : "";
  return {
    text: `${asked}\nNothing has been built or charged yet. Ask the person, then call again with the same request and ${argument} set to their choice.${also}\n${listed}`,
    isError: false,
  };
}
