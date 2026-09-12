# Build jobs, and the work that does not fit in a request

## What this replaced

`projects.status`, as the authority on what a build was doing. One free-text
column, no `CHECK` constraint, five writers — this app in nine places, the n8n
orchestrator in two, the save route, the publish route — and six values
describing three different kinds of thing: a project (`Draft`, `Built`), a run
(`Building`, `Failed`), and a publication (`Published`).

Two failures came out of that, and they are the same failure twice.

**A killed function wrote nothing.** `/api/build` declares `maxDuration = 60`
and could spend 10 seconds connecting to a database, 30 on a migration, 20
resolving assets and 55 waiting on n8n. Those budgets add up to more than the
function is allowed, so it was stopped partway through — and a function that is
stopped writes no status, no error and no message. The row stayed on `Building`
and the workspace polled it for its full twenty-five minutes.

**Two writers disagreed and the last one won.** n8n's `Save Page` node gives up
at 120 seconds. The save route routinely takes longer — it fetches a dozen
photographs, runs seven gates and stores megabytes — so n8n wrote `Failed` while
the save route was still working, and the save route then wrote `Built`. Which
was true depended on which finished last. The shipped mitigation was a
twenty-second grace period in the browser (`BUILD_FAILED_GRACE_MS`), which is a
sensible thing to do about a symptom.

Neither is a bug in a writer. Both are what happens when state has no rules.

## The rules

`src/lib/jobs/state.ts` — pure, no I/O, compiled on its own by
`npm run check:jobs`.

```
queued → planning → provisioning → generating → assembling → validating → deploying → ready
             ↓            ↓             ↓            ↓            ↓   ↑         ↓
        needs_input       └─────────────┴────────────┴────── repairing        failed
             ↓                                                                cancelled
         planning
```

- **Terminal is terminal.** `ready`, `failed` and `cancelled` have no outgoing
  transitions at all, which is what makes the Failed-then-Built race impossible
  to reproduce rather than merely unlikely. Whoever gets there first is the
  answer; the second writer is refused and logged.
- **Stages are skipped, legitimately.** A landing page has nothing to provision
  and nothing to deploy, so `planning → generating` and `validating → ready` are
  both real transitions. Inventing an empty stage to keep the sequence tidy
  would be worse.
- **Every live state can fail or be cancelled.** A state with no way out is a
  build that hangs, which is the thing this exists to remove.
- **Re-entering a state is a no-op**, so a re-claimed job and a webhook
  delivered twice are both harmless.

`projects.status` stays as a label on the project. Nothing decides on it — the
same move publication already made to `published_version_id`, for the same
reason, and the note there explains what breaks if it is put back.

## The tables

| Table | Holds |
|---|---|
| `build_jobs` | one row per build: state, error, `detail` jsonb, `attempts`, `locked_until`. A unique partial index enforces one live job per project. |
| `build_steps` | the timeline `stepRecorder` already produces, kept. Upserted on `(job_id, step)`, so a step that begins and finishes is one row ticking over. |
| `project_deployments` | every deployment by its **real Vercel id**, plus the Vercel **project** id. |

All three are readable by their owner and writable only by the service role. A
browser that could move a job's state could mark its own build ready.

### Why `project_deployments` exists

`deployProject` received the deployment id from Vercel, returned it, and both
call sites discarded it. So a deployment could be created and never asked about
again — which is exactly what happened to any build slower than the function
that started it. Without the id there was nothing to poll, no log to fetch
afterwards, and nothing to roll back *to*.

The Vercel **project** id is there for a second reason. It was re-derived on
every deploy from `deploymentName(project.name, project.id)`, so renaming a
project created a *second* Vercel project and left the first orphaned and still
serving. Stored once, it answers forever.

## The worker

`/api/cron/deployments` polls deployments that are still building and settles
the ones that have finished: it writes the URL or the failure, moves the job,
and says so in the thread.

This is a **slice, not a worker**. Each invocation does a bounded amount of work
and returns well inside the ceiling; progress happens because it is called
again. That is enough for polling somebody else's build.

It is **not** enough for the two stages that still need real compute — the QA
render loop and screenshot grounding both need a headless browser, which is
fifty megabytes of Chromium and cannot live in a serverless function at all.
Those wait on a container.

### Scheduling it — read this before assuming it runs

`vercel.json` asks for every two minutes.

**On Vercel's Hobby plan, cron jobs run once per day**, whatever the expression
says. So on Hobby this schedule is not what will happen, and a deployment will
sit in `queued` until the daily run finds it — better than being lost forever,
which is what happened before, but not what the file claims.

Two ways to get the real cadence, and this deployment already uses the first
one for payments:

1. **pg_cron + pg_net**, from the Supabase instance, exactly as
   `/api/cron/reconcile` is called today — see `docs/PAYMENTS.md`. It is not
   subject to Vercel's plan at all.
2. **Vercel Pro**, which honours the expression.

Either way the route is protected the same way as `reconcile`:
`Authorization: Bearer $CRON_SECRET`, and it refuses to run at all when the
variable is unset, because it writes to project rows.

## What is still on the request

Being honest about the scope of this change: generation already ran outside the
request in n8n, and deployment polling now does too. **Provisioning, asset
resolution and the save pipeline still run inline**, so `/api/build` and the
save route can still exceed their ceilings. Moving them is the rest of the job
system, and it wants the container rather than another cron slice — a migration
and a QA pass are not work that can be cut into sixty-second pieces and resumed.

The tables, the state machine and the store are in place for that; what is
missing is the process that calls them.
