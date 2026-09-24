#!/usr/bin/env node
/* An edit survives the connection that asked for it.
 *
 *   npm run check:edit-task
 *
 * ── What this is defending ────────────────────────────────────────────────
 *
 * An edit used to live inside its HTTP request. The platform kills that
 * request at sixty seconds whatever a route declares, so a change needing
 * sixty-one produced a dead socket, an untouched page, and a message telling
 * the customer to ask for less — for a request that was never too large.
 *
 * lib/builder/edit-task.ts puts the edit on the durable job machinery that
 * build_jobs has had all along. Four properties fall out of that, and every
 * one of them is a thing somebody could quietly remove without a compile
 * error, which is why they are asserted here rather than only written down:
 *
 *   IDEMPOTENT   the same request twice is ONE task
 *   LOCKED       a second edit mid-edit is refused, not raced
 *   RESUMABLE    an interruption leaves the task LIVE, with its steps
 *   ROLLED BACK  a checkpoint is written BEFORE anything changes
 *
 * And one property that is about honesty rather than mechanism: an
 * interruption must not be recorded as a failure, because the customer did
 * nothing wrong and the work is still there to be picked up.
 *
 * The Supabase client is a stub. There is no database here and no key: every
 * call is recorded and answered, so what is being checked is the DECISIONS
 * this module makes, which is the part that can regress.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-edit-task");
mkdirSync(out, { recursive: true });

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
      include: [
        join(root, "src/lib/builder/edit-task.ts"),
        join(root, "src/lib/jobs/state.ts"),
      ],
    },
    null,
    2,
  ),
);
execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });

/* The compiled module imports "@/..." paths, which node cannot resolve on its
   own. A symlink from node_modules/@ to the compiled tree is the smallest
   thing that makes require work without a bundler. */
const shim = join(root, "node_modules", "@");
try {
  const { symlinkSync, rmSync } = await import("node:fs");
  rmSync(shim, { recursive: true, force: true });
  symlinkSync(out, shim, "dir");
} catch {
  /* Already there, or the filesystem said no. The require below reports it. */
}

const require = createRequire(import.meta.url);
const task = require(join(out, "lib/builder/edit-task.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* ── A database that is a notebook ────────────────────────────────────────
 *
 * Enough of supabase-js to answer the four tables this module touches, and it
 * records every write so the assertions can read what was decided. The one
 * rule it actually enforces is the one that matters: ONE live job per project,
 * which is the unique index in supabase/schema.sql. */
function stubService(seed = {}) {
  const jobs = seed.jobs ? [...seed.jobs] : [];
  const steps = [];
  const checkpoints = [];
  let nextId = 1;

  const live = (projectId) =>
    jobs.find(
      (job) =>
        job.project_id === projectId &&
        !["ready", "failed", "cancelled"].includes(job.state),
    ) ?? null;

  const table = (name) => {
    const filters = {};
    let notIn = null;

    const api = {
      select: () => api,
      eq(column, value) { filters[column] = value; return api; },
      not(column, _op, value) { notIn = { column, value }; return api; },
      order: () => api,
      limit: () => api,
      /* Awaited directly by readSteps, which never calls maybeSingle. */
      then(resolve) {
        if (name === "build_steps") {
          resolve({ data: steps.filter((row) => row.job_id === filters.job_id), error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
      maybeSingle: async () => {
        if (name !== "build_jobs") return { data: null, error: null };
        if (filters.id) return { data: jobs.find((job) => job.id === filters.id) ?? null, error: null };
        if (notIn && filters.project_id) return { data: live(filters.project_id), error: null };
        return { data: null, error: null };
      },
      single: async () => api.maybeSingle(),
      insert(row) {
        if (name === "build_jobs") {
          if (live(row.project_id)) {
            return {
              select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }),
            };
          }
          const made = {
            id: `job-${nextId++}`,
            request_id: null, error: null, detail: {}, attempts: 0,
            locked_until: null, created_at: new Date().toISOString(), finished_at: null,
            ...row,
          };
          jobs.push(made);
          return { select: () => ({ single: async () => ({ data: made, error: null }) }) };
        }
        if (name === "project_checkpoints") checkpoints.push(row);
        return Promise.resolve({ error: null });
      },
      update(patch) {
        const applied = { ...patch };
        const chain = {
          eq(column, value) { filters[column] = value; return chain; },
          or: () => chain,
          not: () => chain,
          select: () => chain,
          maybeSingle: async () => {
            const job = jobs.find(
              (row) =>
                row.id === filters.id &&
                (filters.state === undefined || row.state === filters.state),
            );
            if (!job) return { data: null, error: null };
            Object.assign(job, applied);
            return { data: job, error: null };
          },
          then: (resolve) => resolve({ error: null }),
        };
        return chain;
      },
      upsert(row) {
        if (name === "build_steps") {
          const at = steps.findIndex((s) => s.job_id === row.job_id && s.step === row.step);
          if (at >= 0) steps[at] = { ...steps[at], ...row };
          else steps.push(row);
        }
        return Promise.resolve({ error: null });
      },
    };
    return api;
  };

  return { from: table, _jobs: jobs, _steps: steps, _checkpoints: checkpoints };
}

const PROJECT = "project-1";
const USER = "user-1";

/* ── IDEMPOTENT ──────────────────────────────────────────────────────────── */
{
  const id = task.editTaskId(PROJECT, "make the hero fit on mobile");
  const again = task.editTaskId(PROJECT, "Make the hero fit on   MOBILE  ");
  has(id === again, "the same request is the same task id, whatever the spacing and case");
  has(
    task.editTaskId("project-2", "make the hero fit on mobile") !== id,
    "and a different project is a different task",
  );

  const service = stubService();
  const first = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER, requestId: id, request: "make the hero fit on mobile",
  });
  const second = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER, requestId: id, request: "make the hero fit on mobile",
  });

  has(first.ok && second.ok, "sending the same message twice opens a task both times");
  has(
    first.ok && second.ok && first.job.id === second.job.id,
    "AND IT IS THE SAME TASK",
    "two tasks means two edits writing the same file, and the second erases the first",
  );
  has(second.ok && second.resumed === true, "the second one knows it is rejoining rather than starting");
  has(service._jobs.length === 1, "one row, not two");
}

/* ── LOCKED ──────────────────────────────────────────────────────────────── */
{
  const service = stubService();
  const mine = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER,
    requestId: task.editTaskId(PROJECT, "change the header"),
    request: "change the header",
  });
  const theirs = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER,
    requestId: task.editTaskId(PROJECT, "change the footer"),
    request: "change the footer",
  });

  has(mine.ok === true, "the first edit gets the project");
  has(theirs.ok === false, "a DIFFERENT edit arriving mid-edit is refused");
  has(
    theirs.ok === false && theirs.why === "busy",
    "and refused as busy, so the caller can say what is running",
    "racing them is how two edits each apply to their own copy and one silently wins",
  );
  has(
    theirs.ok === false && theirs.why === "busy" && theirs.job.id === mine.job.id,
    "handing back the job that IS running, rather than nothing",
  );
}

/* ── An abandoned task never becomes a lock ──────────────────────────────── */
{
  /* There is no worker on this plan: a function killed at the ceiling has
     nobody to finish its task. Without a staleness rule that row stays live
     forever and the one-live-job index — the thing that stops two edits — wedges
     the project shut for good. */
  const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const service = stubService({
    jobs: [{
      id: "job-old", project_id: PROJECT, user_id: USER, request_id: "edit:old",
      state: "generating", error: null, detail: { kind: "edit" }, attempts: 1,
      locked_until: null, created_at: old, finished_at: null,
    }],
  });

  const fresh = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER,
    requestId: task.editTaskId(PROJECT, "something new"),
    request: "something new",
  });

  has(fresh.ok === true, "a task abandoned half an hour ago does not block the next edit", 
    fresh.ok === false ? fresh.why : "");
  has(
    service._jobs.find((job) => job.id === "job-old")?.state === "cancelled",
    "the abandoned one is cancelled rather than left live forever",
  );
}

/* ── ROLLED BACK ─────────────────────────────────────────────────────────── */
{
  const service = stubService();
  await task.checkpointBeforeEdit(service, {
    projectId: PROJECT, userId: USER, request: "rewrite the pricing table",
  });
  has(service._checkpoints.length === 1, "a checkpoint is written before the edit");
  has(
    /^Before: /.test(service._checkpoints[0]?.label ?? ""),
    "named for what it precedes, so the list reads as decisions and not timestamps",
    service._checkpoints[0]?.label,
  );
}

/* ── RESUMABLE, and the honesty rule ─────────────────────────────────────── */
{
  const service = stubService();
  const opened = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER,
    requestId: task.editTaskId(PROJECT, "fit the page to phones"),
    request: "fit the page to phones",
  });
  const job = opened.ok ? opened.job : null;

  await task.noteEditStep(service, job, { id: "plan", label: "Working out the change", state: "done" });
  await task.noteEditStep(service, job, { id: "edit", label: "Making the change", state: "running" });

  has(service._steps.length === 2, "each step is written down as it happens, not only streamed");

  await task.haltEditTask(service, job, {
    interrupted: true,
    reason: "the connection closed before the change finished",
  });

  const row = service._jobs.find((entry) => entry.id === job.id);
  has(
    !["ready", "failed", "cancelled"].includes(row.state),
    "AN INTERRUPTION LEAVES THE TASK LIVE",
    "marking it failed tells somebody their request was refused when it was our ceiling",
  );

  const back = await task.resumableEdit(service, PROJECT);
  has(back !== null, "so the next request finds it");
  has(back?.steps.length === 2, "with everything it had got through", String(back?.steps.length));
}

/* ── A refusal IS terminal ───────────────────────────────────────────────── */
{
  const service = stubService();
  const opened = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER,
    requestId: task.editTaskId(PROJECT, "edit a page that isn't there"),
    request: "edit a page that isn't there",
  });
  const job = opened.ok ? opened.job : null;

  await task.haltEditTask(service, job, {
    interrupted: false,
    reason: "This project's source files aren't in our store.",
  });

  const row = service._jobs.find((entry) => entry.id === job.id);
  has(row.state === "failed", "a gate that read the request and declined it fails the task");
  has(
    /source files/.test(row.error ?? ""),
    "with the reason it gave, so a resumed session can say why",
    row.error,
  );
}

/* ── Finishing walks the state machine instead of jumping it ─────────────── */
{
  /* planning → ready is a move lib/jobs/state.ts refuses outright. An edit that
     finished and jumped would have sat in `planning` forever, and the workspace
     would have polled a completed change as though it were still running. */
  const service = stubService();
  const opened = await task.openEditTask(service, {
    projectId: PROJECT, userId: USER,
    requestId: task.editTaskId(PROJECT, "swap the headline"),
    request: "swap the headline",
  });
  const job = opened.ok ? opened.job : null;

  await task.settleEditTask({ service, job }, { status: 200 });
  const row = service._jobs.find((entry) => entry.id === job.id);
  has(row.state === "ready", "an edit that landed reaches ready from planning", row.state);
  has(row.finished_at !== null, "and is stamped as finished");
}

/* ── The route actually uses all of it ───────────────────────────────────── */
{
  const route = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");

  has(/openEditTask\(/.test(route), "the edit path opens a task");
  has(/checkpointBeforeEdit\(/.test(route), "and writes the checkpoint before it changes anything");
  has(/settleEditTask\(/.test(route), "and settles it once the answer is known");
  has(
    /void noteEditStep\(/.test(route),
    "and every streamed step is stored as well as streamed",
    "streaming alone is what made a closed tab lose the whole timeline",
  );
  has(
    /code: "edit_busy"/.test(route),
    "a second edit into the same project is refused with a reason",
  );

  const edit = readFileSync(join(root, "src/lib/builder/edit.ts"), "utf8");
  const pushy = edit.match(/Ask for it a section at a time/g) ?? [];
  has(
    pushy.length === 0,
    "AND THE EDIT GATES STOPPED TELLING PEOPLE TO ASK FOR LESS",
    `${pushy.length} still do — our ceiling is not their request being too big`,
  );
}

/* Taken back out. It exists only so `require` can resolve this module's own
   "@/..." imports, and a symlink left pointing into a build cache is a thing
   the next tool to look at node_modules has to understand. */
try {
  const { rmSync } = await import("node:fs");
  rmSync(shim, { recursive: true, force: true });
} catch {
  /* Nothing depends on it going away. */
}

console.log("");
if (failed > 0) {
  console.log(`${failed} edit task check${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("All edit task checks passed.");
