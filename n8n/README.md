# n8n — Build Orchestrator

The workflow behind the QuickStark.Ai chat "build my app" flow.

- **Workflow**: `QuickStark.Ai — Build Orchestrator` (`pIJ3Fu5QpGTotf2m`)
- **Editor**: https://neauraissystems.app.n8n.cloud/workflow/pIJ3Fu5QpGTotf2m
- **Source of truth**: [`build-orchestrator.workflow.ts`](./build-orchestrator.workflow.ts) — n8n Workflow SDK code.
  Edit it here, re-validate, and push the change to n8n rather than hand-editing the canvas.

## Shape

```
[ QuickStark.Ai Chat UI ]
          │  POST /webhook/api/v1/build
          ▼
[ Build Request Webhook ] → [ Normalize Build Request ]
          ▼
[ Intent Classifier ]  (Text Classifier, one category + "other" fallback)
          │
  ┌───────┴────────────────────────┐
  ▼                                ▼
WebApp / Landing            Manual Review
• Build Spec                (fallback — a prompt for something
                             not built yet is answered, not dropped)
  └───────┬────────────────────────┘
          ▼
[ Collect Build Outcome ]  (Merge, append, 3 inputs)
          │  the classifier's own error output is the third:
          │  [ Intent Classifier ] --error--> [ Flag Classifier Failure ]
          ▼
[ Assemble Build Result ] → [ Sync Project Row ]  (status: Building)
          ▼
[ Build Chat Payload ] → [ Return Payload to Chat UI ]   ← the chat is answered here
          ▼
[ If Webapp ] → [ Compose Page Prompt ] → [ Generate Page ] → [ Save Page ]
                                          (Anthropic API)     (→ the app stores it
                                                                 and sets preview_url)
```

**The reply comes before the page.** Everything above the response line takes a
few seconds — a classification, nothing more. Generating a page takes a minute
or two, so it runs *after* the webhook has answered, and the app finds out it
finished by watching the project row rather than by holding a request open.

That is not a preference. A serverless function is killed at sixty seconds, and
a page takes longer: execution 221 is the proof — `Generate Page` ran for
60,673ms and came back `504 An error occurred with your deployment`, with
nothing built. An n8n node has no such ceiling, which is the whole reason
generation lives here and not in the app.

## How the app reaches it

The browser never calls this webhook. The chat posts to `POST /api/build`
(`src/app/api/build/route.ts`), which reads the Supabase session, checks the
project belongs to the caller, and only then calls n8n with `N8N_WEBHOOK_URL`.
An n8n webhook cannot tell who is calling it, so that check has to happen on
the app's side of the line.

```
ChatPanel / StartBuildButton   (src/app/dashboard/…)
        │  POST /api/build  { projectId, prompt }
        ▼
/api/build            authenticates, verifies ownership, marks the row Building
        │  POST N8N_WEBHOOK_URL  { prompt, projectName, userId, projectId, requestId }
        ▼
this workflow         classifies, builds, writes the row back
        │
        ▼
/api/build            re-reads the row, returns { build, project }
```

The app creates the `projects` row before the build starts and passes its `id`,
so `Sync Project Row` **updates** that row — it does not insert. Two rows per
build was the bug that change fixed.

The update matches on **both** `id` and `user_id`. Because this node runs with
the service_role key, RLS will not stop a write to the wrong row, so a leaked
project UUID on its own must not be enough to reach someone's project.

`/api/build` also prices the build and charges `spend_credits` once the
orchestrator answers, using what the build itself reports — never anything the
caller sends. Report `filesTouched` in a branch's artifacts and it is billed
accordingly; report nothing and it prices at the floor.

## Request

`POST https://neauraissystems.app.n8n.cloud/webhook/api/v1/build`

```json
{
  "prompt": "Build me an online store that sells handmade ceramics.",
  "projectName": "Aurora Ceramics",
  "userId": "<auth.users.id>",
  "projectId": "",
  "requestId": "req_01HZY"
}
```

`projectId` and `requestId` are optional — `requestId` falls back to the n8n execution ID.
The normalizer reads both `body.*` and top-level fields, so browser calls and n8n test runs
behave identically.

## Response

```json
{
  "ok": true,
  "requestId": "req_01HZY",
  "projectId": "b2b1c0d9-…",
  "intent": "webapp | unclassified",
  "status": "Building | Failed | Needs Clarification",
  "links":      { "preview": "…", "repo": "…", "admin": "…" },
  "configKeys": {},
  "artifacts":  { "stack": "…", "…": "…" },
  "message": "Your webapp build is underway — the preview link updates as it finishes."
}
```

Every branch normalizes to the same seven fields before the Merge
(`intent, previewUrl, repoUrl, adminUrl, configKeys, artifacts, branchStatus`),
so the chat UI has one response shape to render regardless of which branch ran.

`status` is derived in `Assemble Build Result` and written straight to
`projects.status`, which the dashboard already reads.

`artifacts.filesTouched` is what `/api/build` prices the build from. The
generate step derives it from the page it produced; a branch that reports
nothing prices at the action's floor.

`configKeys` is empty for now. It carried the environment a provisioned backend
would need, and there is no provisioning until publishing exists.

**The webhook always answers.** Every outbound call runs with
`onError: continueRegularOutput`, and `Intent Classifier` — the one node every
build passes through, and the only one that depends on an outside model — runs
with `onError: continueErrorOutput` into `Flag Classifier Failure`. Without that
error output a classifier failure ends the execution silently: the webhook never
responds, and the app waits out its 60-second timeout before telling the user
the build "may still finish", which is not true. Now it comes back as
`status: "Failed"` with the reason in `artifacts`, and `/api/build` does not
bill a build that never ran.

The classifier also **retries**: three tries, two seconds apart, on both the
Text Classifier and the model node under it. Execution 215 is why — a build
came back "the classifier could not be reached" on a bare
`Service unavailable` from Anthropic, which is a passing outage rather than
anything wrong with the setup, and the one node every build depends on. Three
tries fit comfortably inside the app's 60-second timeout. The error output is
not redundant with this: it is what answers once the retries are spent too.

`Flag Classifier Failure` is not the same thing as `Flag For Manual Review`:
that one is a prompt nobody could classify, which is a real answer and is
charged for. This one is the classifier being unreachable.

## Before this can run for real

Where this stands: the workflow is **published** and wired end to end. The
Webhook node carries a Header Auth credential, `Sync Project Row` the Supabase
one, `Intent Classifier Model` the Anthropic one, and the app holds the two
environment variables in step 1. Builds reach n8n, route to a branch, sync to
Supabase and answer the chat — verified by production executions 209 and 210.

Builds are real: the branch generates a page and stores it. Verify the chain
with `npm run check:builder`.

The graph is wired and tested; the outbound integrations are not yet connected.

Two different questions are easy to conflate here. **Running** the workflow needs
nothing — a manual execution works today, and did (see Testing). **Publishing**
it is what the chat needs, because the app reaches the production webhook, and
that is gated on every enabled node having a credential attached.

1. **Header Auth on the webhook (do this first).** The Webhook node requires
   Header Auth, and the credential it carries has to hold the header the app
   actually sends. Two fields, copied exactly:

   | Field | Value |
   | --- | --- |
   | Name | `X-QuickStark-Token` |
   | Value | the same string as `N8N_WEBHOOK_TOKEN` in the app |

   Set them on the `QuickStark.Ai Build Webhook` credential and attach it to the
   node; if a Header Auth credential is already attached and holds a value for
   something else, make a new one with these two fields and attach that instead.
   Until the two sides agree, every call from the app is a 403.

   A dedicated header rather than `Authorization`: n8n's Header Auth compares
   the whole value, so `Authorization` would mean typing `Bearer <token>` into
   the credential exactly, and a missing prefix fails as a 403 that reads like a
   wrong token. The header name lives in one place — `WEBHOOK_TOKEN_HEADER` in
   `src/lib/n8n.ts`.

   This is not optional hardening. `Sync Project Row` writes with the
   service_role key, which bypasses RLS, and the row it writes to comes from the
   request body. An open webhook here is a way for anyone who learns the URL to
   overwrite any project row in the database. `/api/build` checks ownership, but
   nothing forces a caller to go through `/api/build`.

2. **The build steps**, all of which run after the chat has been answered:

   | Node | What it does |
   | --- | --- |
   | `If Webapp` | Only a web app build has anything left to do; the other two paths were answered in full. |
   | `Compose Page Prompt` | Builds the system and user messages as plain strings. |
   | `Generate Page` | POSTs the Anthropic Messages API directly, under the same credential the classifier uses. Ten-minute timeout, because nothing is waiting on it. |
   | `Save Page` | POSTs the document to `/api/builder/webapp/save`. |

   `Generate Page` calls the API with an HTTP node rather than an LLM chain on
   purpose: a generated page is full of `{` and `}`, and a chain reads those as
   prompt template variables. Editing an existing page would corrupt it.

   With thinking on, the first content block is the thinking, not the page —
   `Save Page` joins the `text` blocks rather than reading `content[0]`.

   **`Save Page` refuses anything unsigned.** `/api/build` signs `requestId`,
   `projectId` and `userId` — the three it has already checked ownership of —
   and the workflow carries that `signature` through as an opaque field. Since
   the page it stores is later served to its owner, an unsigned caller could put
   their own HTML on someone's preview, which is the one thing here worth
   attacking. If this step starts answering 401, the field is not reaching it:
   check that `Normalize Build Request` sets `signature` and that `Save Page`
   sends it.

   These two run after the response, so a failure cannot reach the chat. That is
   deliberate: they fail the execution instead, which shows up in the execution
   list, and the workspace's own wait gives up with "the build is taking longer
   than usual" rather than claiming a failure it cannot see.

   There is no `Apply Supabase Schema` step. Provisioning a schema is part of
   publishing, which is the owner's own paid choice, not something every build
   should do.

3. **Credentials** — connect these in n8n:
   - `Supabase QuickStark.Ai` on `Sync Project Row`. Credential type
     **Supabase API**, with two fields:

     | Field | Value |
     | --- | --- |
     | Host | `https://esuatccbicekcohzgcvd.supabase.co` |
     | Service Role Secret | Supabase dashboard → Project Settings → API Keys → `service_role` |

     That is the `loveGlow1's Project` database the app already runs against —
     verified to hold `projects` with all six build columns, and the
     `spend_credits` RPC with the signature `/api/build` calls.

     It needs the **service_role** key, not the anon key: the node updates a row
     on the user's behalf with no user session, and `projects` is owner-scoped by
     RLS, so an anon key updates nothing and reports success. It updates the row
     matching the `projectId` the app sent, writing `status, intent,
     preview_url, repo_url, admin_url, last_build_at`.
4. **Anthropic** — `Intent Classifier Model` is an **Anthropic Chat Model** node on
   `claude-opus-5`, replacing the OpenAI node that was bound to the shared
   "n8n free OpenAI API credits" pool (exhausted — it returned
   `400 … used all your free n8n AI credits`, and nothing routed).

   It needs an **Anthropic** credential (type `anthropicApi`): an API key from
   console.anthropic.com. Until one is attached the classifier fails, which now
   means every build takes the `Flag Classifier Failure` path rather than
   hanging.

   It runs adaptive thinking at **low** effort. Not thinking-disabled: the Text
   Classifier parses this model's output against a JSON schema, and with
   thinking off Opus 5 can leak reasoning tags into the visible response. Low
   effort is the cheap setting; off is the broken one. Routing is a small call
   on every build, so `claude-sonnet-5` or `claude-haiku-4-5` would also serve
   and cost less — that is a cost/quality call to make deliberately, not a
   default to drift into.
5. **Publish** — and publish again after every change. n8n serves production
   traffic from the *published* version, not from the draft, so an edit that is
   saved but not published is invisible to the app. That is worth knowing
   because the failure is silent and looks like the edit not working: the
   webhook's header name was corrected in a draft once and every call kept
   returning 403 against the old published version until it was published.

   n8n also refuses to publish while any enabled node is missing a credential,
   and names them:

   ```
   Cannot publish workflow: 2 nodes have configuration issues:
     Node "Sync Project Row":          Missing required credential: supabaseApi
     Node "Intent Classifier Model":   Missing required credential: anthropicApi
   ```

   Both are credentials this account can supply, so those two are the real gate.
   Until the workflow is published the production webhook answers 404, which the
   app reports as "the workflow is probably not published yet".

   Without it `Sync Project Row` writes nothing, every build stays "Building" in
   the dashboard, and `/api/build` reads back a row the orchestrator never
   touched.

Every external call runs with `onError: continueRegularOutput`, so one unconfigured
integration degrades that branch to `branchStatus: "failed"` instead of killing the
execution — the chat UI still gets a response.

## Adding a build type back

WordPress and E-Commerce were removed to get one branch working properly first.
They are not gone — they are in this workflow's **version history**, which is
where to restore them from rather than rebuilding eight nodes by hand.

Bringing one back is three changes, and all three or none:

1. A **category** on `Intent Classifier`, or nothing routes to it.
2. The **branch** itself, ending in a Collect node that sets the same seven
   fields (`intent, previewUrl, repoUrl, adminUrl, configKeys, artifacts,
   branchStatus`).
3. A **Merge input** — raise `Collect Build Outcome`'s input count and connect
   the Collect node to the new one.

Miss the category and the branch is dead code. Miss the Merge input and the
build runs and then vanishes, with the chat waiting out its 60-second timeout.

The classifier's outputs are ordered: one per category, then the `other`
fallback, then the error output. Adding a category shifts the last two along by
one, so their connections have to move too.

Then update `Build Chat Payload`'s Needs Clarification message, which names what
is currently built, and add a generate step for the new branch under
`src/app/api/builder/` alongside the web app one.

## "Waiting for the webhook call"

The canvas says it is waiting; the chat looks fine; nothing happens. That
message is the *test* URL listening — it accepts a single call, only while the
editor is open — and it is also what a published workflow looks like when no
call ever arrives. n8n cannot tell the two apart for you, because a request that
was never sent leaves nothing behind on this side. Check the execution list: if
every run says `manual`, nothing has ever reached the production webhook.

Run this from the app's directory:

```bash
npm run check:builder
```

It makes the call the app would make and names which link is broken:

| What it finds | What it means |
| --- | --- |
| `N8N_WEBHOOK_URL is not set` | `/api/build` answers 503 and never calls n8n. The usual one. |
| the URL contains `/webhook-test/` | That is the listen-once editor address. The app needs `/webhook/`. |
| `404` | The workflow is not published. |
| `401` / `403` | The token or the header name does not match the Header Auth credential. It retries under `Authorization` so it can say which. |
| `200` with a bad shape | A branch stopped setting one of the seven fields. |

The probe sends no `projectId` and no `userId`, so `Sync Project Row` matches no
row and writes nothing. It does run one real execution, so the classifier bills
an Anthropic call.

## Database

The build columns live on `public.projects` and are created by
[`supabase/schema.sql`](../supabase/schema.sql), which is safe to re-run:

| Column | Written by | Holds |
| --- | --- | --- |
| `status` | app, then workflow | `Building` / `Failed` / `Needs Clarification` |
| `prompt` | app | what was asked for |
| `intent` | workflow | `webapp` / `unclassified` (older rows may hold `wordpress` or `ecommerce`) |
| `preview_url` | workflow | where the built app can be seen |
| `repo_url` | workflow | the repository holding its code |
| `admin_url` | workflow | the CMS or store admin, where there is one |
| `last_build_at` | workflow | when the last build returned |

`preview_url` is what the workspace's preview pane loads, in a sandboxed frame.

## Testing

The whole path — webhook, normalize, branch, merge, assemble, sync, response —
was verified end to end with pinned data (executions 177, 178 and 183). To repeat
it, pin `Build Request Webhook`, `Intent Classifier`, the four HTTP nodes and
`Sync Project Row`, then run from the webhook trigger.

The failure path was verified without pinning the classifier, against the
exhausted OpenAI credential (executions 181 and 182): the run now ends at
`Return Payload to Chat UI` with `status: "Failed"` and the reason in
`artifacts`, where execution 176 — the same input before the error output
existed — ended at `Intent Classifier` having answered nothing at all.

Pinning `Intent Classifier` is what lets the rest of the graph be tested while
the model credential is missing; with a working credential, leave it unpinned so
the routing itself is exercised.

### The error output does not catch a missing model credential

Worth knowing before the Anthropic credential is attached, because it looks like
correct behaviour and is not.

`onError: continueErrorOutput` catches what the classifier throws while it runs —
an exhausted quota, a rejected key, a rate limit. It does **not** catch a
sub-node that fails to resolve at all. With no credential on
`Intent Classifier Model`, n8n raises a `configuration-node` error before the
classifier body executes, and the item leaves by **output 0** — the WebApp
branch — rather than the error output.

Execution 186 is that: "Build me an online store that sells handmade ceramics"
came back with `intent: "webapp"`, `WebApp Build Spec` sourced from
`previousNodeOutput: 0`, and `Flag Classifier Failure` never reached. It reported
`Failed` only because the placeholder URL fails; with the placeholder URLs filled
in, a store request would have been built as a Next.js app with nothing to say it
had gone wrong.

Two things keep this out of production. It needs the credential to be *absent*,
not merely broken — a bad key fails inside the classifier and does reach the
error output (executions 181 and 182). And n8n refuses to publish the workflow at
all while `anthropicApi` is missing, so the state cannot reach the production
webhook. Attaching the credential removes it.

### Node versions

Every node is on the current type version except the seven `Set` nodes, which are
on 3.4 where 3.5 exists. The difference is binary-field handling, which this
graph has none of, and n8n does not upgrade existing nodes in place — so they are
left alone rather than churned for a version number.
