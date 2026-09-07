"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { isPublishedStatus } from "@/lib/project-status";
import type { BuildKind } from "@/lib/builder/kinds";
import type { BuildStep } from "@/lib/builder/steps";

export type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  /* Written by the build orchestrator when a build finishes — see
     n8n/README.md. Null on a project that has not been built yet, which is
     every project the moment it is named. */
  intent: string | null;
  preview_url: string | null;
  repo_url: string | null;
  admin_url: string | null;
  last_build_at: string | null;
};

/* The orchestrator's answer to one build, as /api/build passes it on. */
export type BuildOutcome = {
  message: string;
  status: string;
  intent: string;
  links: { preview: string; repo: string; admin: string };
  configKeys: Record<string, string>;
};

/** What a message was taken to mean. See src/lib/builder/intent.ts. */
export type BuildIntent = "edit" | "new_project" | "question" | "revert" | "clarify";

/* One reply to one message. Not every message is a build any more, so this
   carries which of the four things happened — and, for the one that would
   replace someone's page, a request to be asked again rather than an outcome. */
export type BuildReply = {
  intent?: BuildIntent;
  /* What the server actually did, in order, with what each operation cost.
     Absent only when the request never got far enough to do anything. */
  steps?: BuildStep[];
  /** A new build over an existing page. Nothing has happened yet. */
  needsConfirmation?: boolean;
  /* The rules could not tell what kind of thing this is, so it is being asked
     rather than guessed. Nothing has happened yet; answering re-sends the same
     message with the kind attached. */
  needsKind?: boolean;
  kindOptions?: { kind: BuildKind; label: string; blurb: string }[];
  /* One page, or a project of files — asked when the brief did not say. See
     lib/builder/stack.ts. buildKind rides along so the answer is applied to
     the same reading of the brief that produced the question. */
  needsStack?: boolean;
  stackOptions?: { stack: "standalone-html" | "nextjs"; label: string; blurb: string }[];
  buildKind?: BuildKind;
  outcome?: BuildOutcome;
  /** Set when nothing was changed. The page is exactly as it was. */
  error?: string;
  /** Chips this reply carries, already labelled. See BuildPayload. */
  messageLinks?: { label: string; href: string }[];
  /* Whether the server has already put this reply in the stored thread. It
     writes what it answers now — see lib/thread-server.ts — so the panel
     renders it but must not write it a second time. */
  stored?: boolean;
};

/* The last line of the stream, which is what the whole response used to be. */
type BuildPayload = {
  intent?: BuildIntent;
  steps?: BuildStep[];
  needsConfirmation?: boolean;
  needsKind?: boolean;
  kindOptions?: { kind: BuildKind; label: string; blurb: string }[];
  /* One page, or a project of files — asked when the brief did not say. See
     lib/builder/stack.ts. buildKind rides along so the answer is applied to
     the same reading of the brief that produced the question. */
  needsStack?: boolean;
  stackOptions?: { stack: "standalone-html" | "nextjs"; label: string; blurb: string }[];
  buildKind?: BuildKind;
  build?: BuildOutcome;
  project?: Project | null;
  error?: string;
  /* Whether the route has already put this reply in the stored thread. It
     writes what it answers now — see lib/thread-server.ts — so the panel
     renders it but must not write it a second time. */
  stored?: boolean;
  /* Chips that belong to this message rather than to the project — the file a
     download request is answered with. Already labelled, because only the route
     knows what they are. */
  messageLinks?: { label: string; href: string }[];
};

export type BuildOptions = {
  /** Overrides the classifier. What the composer's mode chip says. */
  intentOverride?: BuildIntent | null;
  /** The second press of "Replace project". */
  confirmNewProject?: boolean;
  /** Files uploaded with this message. Ids only — the bytes stay in Storage. */
  attachmentIds?: string[];
  /**
   * Which blueprint to build from, when something already knows.
   *
   * Set by the target chip pressed on Home — the person said "landing page"
   * before they said anything else, and that is a better answer than reading it
   * back out of their sentence. Left off, the server classifies the brief. See
   * src/lib/builder/kinds.ts.
   */
  buildKind?: BuildKind | null;
  /**
   * One page, or a Next.js project — when the person has been asked and has
   * answered.
   *
   * Left off, the server reads it from the brief and asks only if the brief did
   * not say. Set, it is taken as the answer and nothing is asked again: the
   * person has already decided, and asking twice about the same message is how
   * a question stops being worth reading. See lib/builder/stack.ts.
   */
  stack?: "standalone-html" | "nextjs" | null;
  /**
   * Which model to build with, as the composer's picker has it.
   *
   * "auto" is a real value to send rather than an absence: the server resolves
   * it, so what Auto means is decided in one place and can change without every
   * caller learning about it. Left off entirely, the server also defaults — a
   * caller that does not care never has to name a model.
   */
  model?: string | null;
  /**
   * Called for each operation as the server reports it, before the reply.
   *
   * This is what makes the tracker live. Steps still arrive in the final reply
   * as well, so a caller that does not pass this loses nothing but the timing —
   * it just sees them all at the end, the way everything did before.
   */
  onStep?: (step: BuildStep) => void;
  /**
   * The reply, a piece at a time, as the model writes it.
   *
   * Deltas — append them. Only sent where the text is the answer itself, which
   * is a question or a clarification; an edit writes search/replace blocks and
   * never streams here.
   *
   * The complete text still arrives in the final reply and remains the
   * authority. A caller that ignores this loses nothing but the watching.
   */
  onText?: (delta: string) => void;
  /**
   * Stops this session waiting, when somebody presses stop in the composer.
   *
   * It aborts the request and the poll that follows it — and that is the whole
   * of what it can honestly do. The work is already elsewhere: an edit is
   * running inside the route, a build is running in the orchestrator, and
   * neither hears a browser hang up. So this ends the WAIT, never the work, and
   * the panel says so in those words rather than "cancelled".
   */
  signal?: AbortSignal;
};

/* How the workspace waits for a page.
 *
 * Generation is not bounded by an HTTP request, so these are patience rather
 * than timeouts — nothing is cancelled when they run out, and the page lands
 * whether anybody is still looking.
 *
 * Three seconds while it is plausibly about to finish, then slower. A build
 * that has been going twelve minutes is not going to land in the next three
 * seconds, and polling it at the same rate is a row of identical queries for
 * the benefit of nobody.
 *
 * Twenty-five minutes of patience rather than eight. Eight was chosen as
 * "longer than any page has taken", which stopped being true — and the message
 * it produced was the worst thing the chat said all day: "I've stopped waiting
 * on it", to somebody who has been waiting eight minutes and now has to reload
 * the page themselves to find out. */
const BUILD_POLL_MS = 3_000;
const BUILD_SLOW_POLL_MS = 8_000;
const BUILD_SLOW_AFTER_MS = 2 * 60 * 1000;
const BUILD_WATCH_MS = 25 * 60 * 1000;

/* How long a failed row is given to turn out to be a finished one.
 *
 * "Failed" used to end the wait on the spot, which is right when it is true and
 * indefensible when it is not — and the orchestrator has a way of writing it
 * when it is not. `Save Page` gives the save route two minutes to answer, and
 * `Flag Build Failure` sits on that node's error output. A save that runs long
 * — a large document, a dozen photographs being fetched into it — is abandoned
 * by the node and marked Failed while the app is still storing the page, which
 * it then finishes doing. The row goes Failed, then Built, seconds apart.
 *
 * So a failure has to survive a few polls to be believed. Twenty seconds is
 * several polls' worth of room, and it costs a genuine failure a short pause at
 * the end of a wait already measured in minutes — against telling somebody
 * their build died while their page is being written to the table. */
const BUILD_FAILED_GRACE_MS = 20_000;

/* Every read asks for the same columns. Written once so a column added to the
   type cannot be missed in one of the two queries below. */
const COLUMNS =
  "id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at";

/* The projects table is the only place a project exists, so one loader serves
   the switcher and the list below it — otherwise creating a project in one
   would leave the other showing yesterday's answer. */
type ProjectsValue = {
  projects: Project[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Project | null;
  select: (id: string) => void;
  create: (name: string) => Promise<Project | null>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Sends one message for a project and folds any result back into the list. */
  build: (id: string, prompt: string, options?: BuildOptions) => Promise<BuildReply>;
  /** Waits for a started build to land its page. See {@link watchBuild}. */
  watchBuild: (
    id: string,
    since: number,
    onPoll?: (row: Project | null, elapsedMs: number) => void,
    /* Stops the waiting, not the build. See `signal` on BuildOptions. */
    signal?: AbortSignal,
  ) => Promise<Project | null>;
};

const ProjectsContext = createContext<ProjectsValue | null>(null);

export function useProjects() {
  const value = useContext(ProjectsContext);
  if (!value) throw new Error("useProjects must be used inside ProjectsProvider");
  return value;
}

function describe(error: { code?: string; message: string }) {
  if (error.code === "42P01") {
    return "The projects table does not exist yet — run supabase/schema.sql in the SQL editor.";
  }
  return error.message;
}

/* The statuses themselves live in @/lib/project-status, because /api/credits/spend
   needs the same answer and cannot import a "use client" module. Re-exported
   here so existing callers keep their import. */
export { PUBLISHED_STATUSES } from "@/lib/project-status";

export function isPublished(project: Project) {
  return isPublishedStatus(project.status);
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    /* Deleted rows are gone from here, not merely from the lists that filter
       for them. A soft delete stamps deleted_at and leaves the row in place, so
       everything reading this context — the drawer's recent tasks, the
       switcher, the strip of open tabs — went on showing an app the Projects
       page had already removed. One filter at the source rather than the same
       filter repeated at each of them. */
    const { data, error: queryError } = await createSupabaseBrowserClient()
      .from("projects")
      .select(COLUMNS)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    setLoading(false);
    if (queryError) {
      setError(describe(queryError));
      return;
    }
    setError(null);
    const rows = (data ?? []) as unknown as Project[];
    setProjects(rows);
    setSelectedId((current) => current ?? rows[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (name: string): Promise<Project | null> => {
      if (!isSupabaseConfigured) return null;
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session is still loading — try again in a moment.");
        return null;
      }

      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name })
        .select(COLUMNS)
        .single();

      if (insertError) {
        setError(describe(insertError));
        return null;
      }
      setError(null);
      const created = data as unknown as Project | null;
      if (created?.id) {
        setProjects((current) => [created, ...current]);
        setSelectedId(created.id);
        return created;
      }
      // The row was written but not returned; re-read rather than guess.
      await load();
      return null;
    },
    [load],
  );

  const rename = useCallback(async (id: string, name: string) => {
    if (!isSupabaseConfigured) return false;
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("projects")
      .update({ name })
      .eq("id", id);

    if (updateError) {
      setError(describe(updateError));
      return false;
    }
    setError(null);
    setProjects((current) =>
      current.map((project) => (project.id === id ? { ...project, name } : project)),
    );
    return true;
  }, []);

  const remove = useCallback(async (id: string) => {
    if (!isSupabaseConfigured) return false;
    const { error: deleteError } = await createSupabaseBrowserClient()
      .from("projects")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(describe(deleteError));
      return false;
    }
    setError(null);
    setProjects((current) => {
      const next = current.filter((project) => project.id !== id);
      setSelectedId((selected) => (selected === id ? next[0]?.id ?? null : selected));
      return next;
    });
    return true;
  }, []);

  /* Starting a build is a server matter: /api/build holds the orchestrator's
     address, checks the project is yours, and answers with the row it wrote.
     Folding that row back in here is what makes the preview appear in the other
     half of the workspace without a reload.

     Errors are thrown rather than swallowed into `error` — the chat panel shows
     a failed build in the conversation, next to the message that caused it,
     rather than as a banner over the whole list. */
  const build = useCallback(
    async (id: string, prompt: string, options: BuildOptions = {}): Promise<BuildReply> => {
      const response = await fetch("/api/build", {
        method: "POST",
        signal: options.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          prompt,
          intentOverride: options.intentOverride ?? null,
          confirmNewProject: options.confirmNewProject === true,
          attachmentIds: options.attachmentIds ?? [],
          buildKind: options.buildKind ?? null,
          model: options.model ?? null,
        }),
      });

      /* The reply arrives as newline-delimited JSON: a line per operation as it
         happens, then one last line carrying what used to be the whole
         response. The status lives in that last line rather than in the HTTP
         status, because a stream commits its headers before any of the work has
         run — see the note on POST in the route. */
      let status = response.status;
      /* Collected rather than assigned to a variable declared out here. The
         only write is inside the reader's callback, which TypeScript's flow
         analysis does not follow — it would carry the initial null forward and
         narrow every later read of it to never. */
      const results: BuildPayload[] = [];

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        /* Split on newlines, keeping the tail: a chunk boundary lands wherever
           the network puts it, which is regularly mid-object. */
        const take = (chunk: string, last: boolean) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = last ? "" : (lines.pop() ?? "");

          for (const line of lines) {
            if (!line.trim()) continue;
            let parsed: {
              type?: string;
              step?: BuildStep;
              delta?: string;
              status?: number;
              body?: unknown;
            };
            try {
              parsed = JSON.parse(line);
            } catch {
              /* A truncated last line means the connection died mid-object.
                 Nothing useful is in it, and the missing result is what the
                 caller reports. */
              continue;
            }

            if (parsed.type === "step" && parsed.step) {
              options.onStep?.(parsed.step);
            } else if (parsed.type === "text" && typeof parsed.delta === "string") {
              options.onText?.(parsed.delta);
            } else if (parsed.type === "result") {
              status = parsed.status ?? status;
              if (parsed.body) results.push(parsed.body as BuildPayload);
            }
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            take(decoder.decode(), true);
            break;
          }
          take(decoder.decode(value, { stream: true }), false);
        }
      }

      const payload = results.length > 0 ? results[results.length - 1] : null;

      /* Returned rather than thrown. A refused edit is an ordinary answer —
         the page is untouched and the person needs to read why — and throwing
         made it indistinguishable in the chat from the app falling over. */
      if (status >= 400 || !payload?.build) {
        return {
          intent: payload?.intent,
          /* Carried on a refusal too. A message that was classified, read and
             then declined did real work, and the steps are how someone sees
             where it stopped. */
          steps: payload?.steps,
          error: payload?.error ?? "I couldn't send that one. Your message is still in the box — try it again.",
          stored: payload?.stored === true,
        };
      }

      if (payload.project) {
        const row = payload.project;
        setProjects((current) =>
          current.map((project) => (project.id === row.id ? { ...project, ...row } : project)),
        );
      }

      return {
        intent: payload.intent,
        steps: payload.steps,
        needsConfirmation: payload.needsConfirmation === true,
        needsKind: payload.needsKind === true,
        kindOptions: payload.kindOptions,
        needsStack: payload.needsStack === true,
        stackOptions: payload.stackOptions,
        buildKind: payload.buildKind,
        outcome: payload.build,
        stored: payload.stored === true,
        messageLinks: payload.messageLinks,
      };
    },
    [],
  );

  /* A build answers before it has finished.
     Generation runs in the orchestrator, which takes as long as the model takes
     — a minute or two — and the chat is answered as soon as the prompt has been
     classified, so nobody waits on a request that a serverless function would
     kill anyway. The page arrives later, written straight to the project row by
     the build's own save step.

     So this is the other half: poll that row until it carries a build newer
     than the one that started, then fold it into the list, which is what turns
     the spinner in the chat into a preview.

     `last_build_at` is HALF the signal, and believing it was the whole of it is
     how this came to end three seconds into every build.

     The sentence that used to be here said the stamp is written once, by the
     step that stores the page, because the app's own "Building" update
     deliberately leaves it alone — and then named the exact consequence of
     being wrong about that: "the very first poll would report a build that has
     not happened". The app does leave it alone. The orchestrator does not. Its
     `Sync Project Row` node writes `last_build_at` from `completedAt`, and
     `completedAt` is stamped in `Assemble Build Result`, which runs when the
     CHAT is answered — before a single token of the page has been generated.
     See n8n/build-orchestrator.workflow.ts.

     So on every build the row grew a stamp newer than `since` about three
     seconds after send, this returned it, and the panel — finding no preview on
     a row that was still Building — said "this one's taking a while" and
     stopped watching. The page then landed minutes later with nothing left
     waiting to notice, so it took a reload to appear. The build was honoured;
     the watching of it was not.

     The status is the other half, and it is the half that cannot be stamped
     early: "Building" is what both writers say WHILE it runs, and only the save
     step moves it off. A new stamp on a row that still says Building is the
     orchestrator saying hello, not a page. */
  const watchBuild = useCallback(
    async (
      id: string,
      since: number,
      /* Told on every poll, so the caller can say something true about a wait
         instead of showing one frozen line for eight minutes. It gets the row
         as it stands — the orchestrator writes `status` to it as the build
         moves — and how long this has been going. Nothing is invented here: a
         checklist ticking itself off on a timer would claim work nobody can see
         happening, and the clock and the status are the two things that are
         actually known. */
      onPoll?: (row: Project | null, elapsedMs: number) => void,
      signal?: AbortSignal,
    ): Promise<Project | null> => {
      if (!isSupabaseConfigured) return null;
      const supabase = createSupabaseBrowserClient();
      const startedAt = Date.now();
      const deadline = startedAt + BUILD_WATCH_MS;
      /* When this run first looked failed. Null again if it stops looking that
         way, which a row can: Building → Failed → Built is exactly the sequence
         the grace period exists for. */
      let firstFailedAt: number | null = null;

      while (Date.now() < deadline) {
        /* Somebody pressed stop. Returning null is the same answer as running
           out of patience, which is the truthful one: the build carries on and
           the caller says so. */
        if (signal?.aborted) return null;

        const elapsed = Date.now() - startedAt;
        const wait = elapsed < BUILD_SLOW_AFTER_MS ? BUILD_POLL_MS : BUILD_SLOW_POLL_MS;
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (signal?.aborted) return null;

        const { data } = await supabase.from("projects").select(COLUMNS).eq("id", id).maybeSingle();
        const row = data as unknown as Project | null;

        onPoll?.(row, Date.now() - startedAt);

        if (!row) continue;

        const landed = row.last_build_at ? Date.parse(row.last_build_at) : 0;
        /* Failed is written by whatever failed it — the orchestrator's error
           branch, or the save step, which also writes the reason into the
           thread. */
        const failed = row.status === "Failed";
        /* And this is the run still running. Both writers say Building while
           the page is being generated, so a fresh stamp under it is the
           orchestrator's early `completedAt` rather than a finished page. */
        const running = row.status === "Building";

        if (landed > since && !running && !failed) {
          setProjects((current) =>
            current.map((project) => (project.id === id ? { ...project, ...row } : project)),
          );
          return row;
        }

        /* A failure, held for a moment before it is believed. See
           BUILD_FAILED_GRACE_MS: a page refused by one call and stored by the
           next arrives seconds after the row says Failed, and reporting the
           first of those two is how a finished build came to be announced as a
           dead one. Kept as the moment it was FIRST seen, so the wait is bounded
           by the failure rather than by however many polls confirm it. */
        if (failed) {
          firstFailedAt ??= Date.now();
          if (Date.now() - firstFailedAt >= BUILD_FAILED_GRACE_MS) return row;
          continue;
        }
        firstFailedAt = null;
      }

      /* Out of patience rather than out of hope: the build may still land, and
         the row will show it on the next load. The caller says so. */
      return null;
    },
    [],
  );

  /* The open-workspace strip is a view of these rows, so it is reconciled here
     rather than in the strip itself: an app renamed anywhere gets its tab
     relabelled, and one deleted anywhere loses its tab, without the row above
     having to know where the projects list came from.

     Skipped while the first read is in flight — an empty list mid-flight would
     close every tab in the strip and lose the session's work. */
  const { sync: syncTabs } = useWorkspaceTabs();
  useEffect(() => {
    if (loading) return;
    syncTabs(projects.map((project) => ({ id: project.id, name: project.name })));
  }, [projects, loading, syncTabs]);

  const value = useMemo<ProjectsValue>(
    () => ({
      projects,
      loading,
      error,
      selectedId,
      selected: projects.find((project) => project.id === selectedId) ?? null,
      select: setSelectedId,
      create,
      rename,
      remove,
      build,
      watchBuild,
    }),
    [projects, loading, error, selectedId, create, rename, remove, build, watchBuild],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
