# The agentic build: build → review → fix → database

After a build lands, the builder carries on by itself:

```
build ─► inspect (QA gates) ─► review round: fix what the review found
      └► database autopilot: scan ─► compare with the app ─► plan ─► dry run
                               ─► apply if purely additive, else ask ─► verify ─► report
```

Both halves already had their parts: the QA gates record what they find on
the build row (`qa_issues`), and the database agent can scan, wire, plan,
dry-run, apply and verify (see `docs/DATABASE-AGENT.md`). The parts did not
run unless a person asked. Now they run after each build, and each step can
only do what its guardrails allow.

## 1. Review and fix: `lib/builder/review-round.ts`

When a build lands, the workspace asks `GET /api/projects/[id]/review` whether
it is due a round. If it is, the workspace sends one silent edit with
`{ review: "latest" }`.

| Guardrail | Where it is enforced |
|---|---|
| **Only findings.** The prompt is written on the server from the build's recorded errors. The browser names the build and nothing else, so a free round cannot carry an arbitrary edit. | `reviewEligibility`, and `prompt = due.prompt` in `/api/build` |
| **Once per build.** The round is claimed with a keyed thread message, and the unique index on `(project_id, dedupe_key)` refuses a second claim. The claim holds even if the first round failed. | `reviewEligibility` |
| **Never nested.** A round's own build is never reviewed again, so a partial fix cannot start a loop. | `isReviewPrompt` |
| **Latest and recent.** Only the newest build, within an hour of landing. | `reviewDue` |
| **Capped.** At most 8 findings in one round. | `MAX_FINDINGS` |
| **Free.** Every charge in `/api/build` goes through `bill`, which charges nothing for a review round. An empty balance does not block the round. | `/api/build` |
| **Visible and undoable.** The round is an ordinary edit: a new version in the history, revertible like any other. | edit path |
| **Stoppable.** The stop button ends the round like any other run. | ChatPanel |

## 2. The database autopilot: `lib/builder/backend/agent/autopilot.ts`

The autopilot runs after every build of an app that has a database (from
`after()` in the save route), when Supabase is connected (from ChatPanel), and
when "Set up my database now" is pressed in the Database panel.

| Guardrail | Where it is enforced |
|---|---|
| **Additive only.** Every statement must create something. Nothing is dropped, renamed, retyped, truncated or rewritten, and no row is inserted, updated or deleted. | `autoVerdict` |
| **Born here.** Access rules (policies, RLS, grants) are set only on tables created in the same change. Changing who can reach an existing table always waits for Approve, even when the change is a fix. | `autoVerdict` |
| **No code.** Functions, triggers, views, extensions and DO blocks always wait for a person. | `autoVerdict` |
| **Small.** At most 60 statements and 20 new tables in one change. | `MAX_STATEMENTS`, `MAX_NEW_TABLES` |
| **Checked twice.** `approveSurgery` takes the verdict again on the *stored* plan. It does so only for a migration the autopilot recorded itself, marked `[autopilot]`. The panel's Approve can never claim to be the autopilot. | `approveSurgery` |
| **Never Supabase's own.** `auth`, `storage`, roles, the server and transaction control are forbidden at any level. | `sql-guard.ts` |
| **Dry run first.** The change is planned and executed inside a block that rolls itself back. If the dry run fails, nothing is applied. | `planChange`, `probe.ts` |
| **Fresh.** The database is re-scanned before the change is applied. If it changed since planning, the change is not applied. | `approveSurgery` |
| **One transaction.** The whole change lands, or none of it does. | `apply_migration` |
| **Signed approval.** The autopilot gets the same single-use, five-minute token, bound to the exact SQL, that a person's Approve gets. | `approval.ts` |
| **Verified.** Afterwards: security advisors, an access test as a visitor and as a stranger, and regenerated types. If anything fails, the undo is planned at once and is one press away. | `verify`, `planUndo` |
| **Unsafe existing tables.** Tables the app uses that are unprotected (RLS off, or RLS on with no policies) are always planned for Approve, never fixed automatically. | `runAutopilot` |
| **One at a time.** A run is skipped while another run's plan is under two minutes old. | `IN_FLIGHT_MS` |
| **Rate-limited.** At most 3 automatic changes per project per hour. | `MAX_AUTO_PER_HOUR` |
| **Owner's switch.** `project_backends.db_autopilot`, on by default, is the "Set up automatically" switch in the Database panel. When it is off, every change waits for Approve. | `autopilotEnabled` |
| **Kill switch.** `DB_AUTOPILOT=off` on the deployment turns the autopilot off for everybody. | `autopilotKilled` |
| **Scoped.** The autopilot only works on the one database connected to this app, through the tool layer's scope check. Where nothing is connected, it skips quietly. | `dbToolsFor` |
| **Audited.** Every plan and change is a `db_surgeries` row, and every tool call is a `db_agent_audit` row, with the actor recorded as `agent`. | `tools.ts` |
| **Said.** What it did, what is waiting and why, or why it stopped, is written into the project's thread. | `runAutopilot` |
| **Untrusted data.** Database contents are data, never instructions. They are masked and fenced before any model sees them. | `untrusted.ts` |

What the app needs comes from its planned data model, through the wiring
report. The app is adapted to the tables that exist, never the other way
round: an existing table is never renamed to match new code.

## Checks

- `npm run check:db-agent`: the autopilot verdict on additive tables, renames,
  drops, new access rules on existing tables, grants, row writes, copies, code,
  DO blocks, Supabase's schemas and the size caps. It also checks that the
  verdict is re-taken in `approveSurgery`, and that the panel cannot claim it.
- `npm run check:review-round`: one round per build, never nested, latest and
  recent only, findings only, capped, and never billed.

## Configuration

- `DB_AUTOPILOT=off`: turns the database autopilot off for the whole
  deployment.
- Migration `20261017180000_db_autopilot.sql`: adds `project_backends.db_autopilot`.
- Approval tokens are signed as before; see `docs/DATABASE-AGENT.md`.
