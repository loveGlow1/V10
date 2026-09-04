# n8n — Build Orchestrator

The workflow behind the QuickStark.Ai chat "build my app" flow.

- **Workflow**: `QuickStark.Ai — Build Orchestrator` (`pIJ3Fu5QpGTotf2m`)
- **Editor**: https://neauraissystems.app.n8n.cloud/workflow/pIJ3Fu5QpGTotf2m
- **Reference**: [`build-orchestrator.workflow.ts`](./build-orchestrator.workflow.ts) — n8n Workflow SDK code.

  **Regenerated from the live workflow on 2026-09-03**, and a mirror of it:
  every node name, type, position and connection was diffed against
  `get_workflow_details` output, and the two agree. It had drifted badly before
  that — it still described the Text Classifier and the WordPress and
  e-commerce branches, and said nothing about the three generation nodes — so
  ten of twenty-three nodes matched.

  Nothing imports it, `n8n` is excluded from `tsconfig.json`, and
  `@n8n/workflow-sdk` is not a dependency, so it is never compiled and nothing
  will tell you when it goes stale again. Change the workflow in n8n, then
  bring the change back here by hand. When the two disagree, the workflow is
  right.

## What runs a model, and what does not

Two model calls used to sit in this workflow. Only one remains, and the
difference matters:

| | |
| --- | --- |
| **`Route By Provider`** | **The model choice, honoured.** A Switch on `provider` into one of three generation nodes. Three nodes rather than one, because a credential is bound to a node in n8n and cannot be an expression — three keys needs three nodes. Falls back to Claude. |
| **`Generate With Claude` / `Generate With OpenAI` / `Generate With Gemini`** | **The one that matters.** Each POSTs `generationBody` to `generationUrl` with `generationHeaders`, all three shaped by the app for that vendor's API, and attaches its own credential. Ten-minute timeout. |
| **`Extract Page`** | The document, out of whichever answer came back — all three bury it at a different depth, and Anthropic puts the thinking in the FIRST block, so this joins the text blocks rather than indexing. |
| ~~`Intent Classifier` + `Intent Classifier Model`~~ | **Deleted.** A routing call that re-decided what the app had already decided, on the one node every build passed through — so an outage or an exhausted key took down every build to answer a question nobody had asked. |

So the canvas has no AI node before generation, and that is the intended state
rather than something missing. The kind arrives as `buildKind`; the prompt
arrives as `systemPrompt`; a request carrying neither is answered rather than
guessed at.

## Shape

**Only new builds reach this workflow.** The app classifies every message
first — edit, new_project, question or revert — and handles three of the four
itself: an edit is a search/replace patch applied in the app in seconds, and a
question or a revert never leaves it. A build that would replace a page someone
already has is confirmed with them before it is sent. See
`src/lib/builder/intent.ts`.

So the page here is always generated fresh, and there is no `previousHtml`.

**And the app decides what kind of thing it is.** A second classification runs
before the call — landing page, storefront, blog, web app — and the request
carries both the answer (`buildKind`) and the whole system prompt composed for
it (`systemPrompt`). There used to be one prompt on the `Compose Page Prompt`
node for all four, which is why every build came back looking like the same
page with different words in it. See `src/lib/builder/kinds.ts`,
`src/lib/builder/blueprints/`, and [`page-prompt.md`](./page-prompt.md).

**So when `buildKind` arrives, nothing here calls a model to route.**
`Kind Decided By App` sends the request straight to the build branch, the
branch's `intent` is the kind the app decided, and the generation node for the
chosen provider sends the `systemPrompt` that came with it — inside
`generationBody`, which the app composed. A caller that sends no `buildKind`
reaches `Flag For Manual Review` and is answered plainly; there is no longer a
classifier behind that door.

That is not a saving, it is the fix for an outage. For a while the workflow
carried neither field: it dropped both in `Normalize Build Request` and
re-classified every build here, on the one node every build passed through. So
when the Anthropic key ran out of credit, every build in the product came back
`The intent classifier could not be reached, so the build was never routed to a
branch` — a routing call that decided nothing the app had not already decided,
failing builds that needed no routing. A step that cannot change the answer
must not be able to fail the request.

```
[ QuickStark.Ai Chat UI ]
          │  POST /webhook/api/v1/build  (new builds only)
          ▼
[ Build Request Webhook ] → [ Normalize Build Request ]
          ▼
[ Kind Decided By App ]  ── buildKind + systemPrompt ──┐   ← no model is called
          │                                            │
    neither field                                      │
          ▼                                            ▼
[ Flag For Manual Review ]                    [ WebApp Build Spec ]
(answered plainly, not guessed at)                     │
          │                                  [ Collect WebApp Result ]
          └───────────────┬───────────────────────────┘
                          ▼
[ Collect Build Outcome ]  (Merge, 2 inputs)
          ▼
[ Assemble Build Result ] → [ Sync Project Row ]  (status: Building)
          ▼
[ Build Chat Payload ] → [ Return Payload to Chat UI ]   ← the chat is answered here
          ▼
[ If A Page Is To Be Built ] → [ Route By Provider ] ─┬→ [ Generate With Claude ] ─┐
                                                     ├→ [ Generate With OpenAI ] ─┤
                                                     └→ [ Generate With Gemini ] ─┘
                                                                                  ↓
                                          [ Collect Generation ] → [ Extract Page ] → [ Save Page ]
                                                                        (→ the app stores it,
                                                                           prices it, and sets
                                                                           preview_url)

  Any of the three generation nodes failing, and Save Page failing, go to
  [ Flag Build Failure ] — the chat was already answered, so a failure here can
  only be written to the project row.
```

> **Deployed defect.** `Generate With Claude` has a *second* success connection
> straight to `Save Page`, alongside the right one into `Collect Generation`.
> That edge hands `Save Page` the raw Anthropic response, which has no `html`
> field, so it posts `html: undefined`, is refused, and takes its error output
> to `Flag Build Failure` — marking the project Failed even when the real path
> through `Extract Page` succeeded. `Generate With OpenAI` and
> `Generate With Gemini` do not have it. The fix is to delete that one
> connection in the editor; nothing else changes.

**The reply comes before the page.** Everything above the response line takes a
few seconds — a classification, nothing more. Generating a page takes a minute
or two, so it runs *after* the webhook has answered, and the app finds out it
finished by watching the project row rather than by holding a request open.

That is not a preference. A serverless function is killed at sixty seconds, and
a page takes longer: execution 221 is the proof — the generation call (on
`Generate Page`, the node the three `Generate With …` nodes replaced) ran for
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
        │  POST N8N_WEBHOOK_URL  { prompt, buildKind, systemPrompt, projectName,
        │                            userId, projectId, requestId }
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

Billing does **not** happen when the webhook answers, and this is worth knowing
before adding a field to make it. When the orchestrator replies, the page has
not been generated yet — there is nothing to price a build from, and pricing it
anyway meant every build, however large, cost the same as a one-word edit.

A full build is charged in `/api/builder/webapp/save`, from the document that
arrives there, counted by the app rather than reported by the workflow. Nothing
this workflow sends decides what anyone is charged. A build that never reaches
save is never billed, which is the right answer for a build nobody got.

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

`artifacts` is descriptive only — the stack, and whatever a branch wants to say
about what it did. It is not read for billing (see above), so a field added
here cannot move anyone's balance in either direction.

`configKeys` is empty for now. It carried the environment a provisioned backend
would need, and there is no provisioning until publishing exists.

**The webhook always answers.** Nothing on the path to the response can throw:
`Sync Project Row` runs with `onError: continueRegularOutput`, and everything
downstream of the response — the three generation nodes and `Save Page` — runs
with `onError: continueErrorOutput` into `Flag Build Failure`. The webhook has
already answered by the time any of those run, so a failure there cannot travel
in the response and is written to the project row instead.

`Sync Project Row` has `alwaysOutputData` on for the same reason, and it is the
less obvious one. A Supabase update that matches no row is not an error — it
succeeds and returns nothing — and a node with no items does not run, so
`Build Chat Payload` and the Respond node never executed and the webhook never
answered. A filter that matches nothing has to be a reply saying so, not
silence.

**Nothing retries.** No node in the workflow sets `retryOnFail`. That was
survivable once the classifier went: the calls that remain all run after the
chat has been answered, so a passing outage costs one build rather than the
whole product, and it is the project row that says so. If a generation node is
ever made to retry, remember that its timeout is ten minutes — three tries is
half an hour of an execution nobody is waiting on.

When a generation call fails, the useful text is `$json.error.description`, not
`$json.error.message`. n8n's `message` is its own wrapper — "Bad request -
please check your parameters" — while `description` is what the vendor actually
said, which in the case that prompted this note was "Your credit balance is too
low to access the Anthropic API". Reading the wrapper sends you looking for a
malformed request that does not exist.

`Flag Build Failure` is not the same thing as `Flag For Manual Review`.
`Flag For Manual Review` is a request that arrived without a `buildKind` and a
`systemPrompt` — answered in full, never billed, because it never reaches the
save route. `Flag Build Failure` is generation or saving having failed after the
chat was answered.

## Before this can run for real

Where this stands: the workflow is **published** and wired end to end. The
Webhook node carries a Header Auth credential, `Sync Project Row` and
`Flag Build Failure` the Supabase one, `Generate With Claude` the Anthropic one,
and the app holds the two environment variables in step 1. Builds reach n8n, route to a branch, sync to
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
   | `Route By Provider` | Switches on the `provider` the app sent. |
   | `Generate With Claude` / `…OpenAI` / `…Gemini` | POST the request the app shaped, each under its own credential. Ten-minute timeout, because nothing is waiting on it. |
   | `Extract Page` | Normalises three answer shapes back to one `{ html, model }`. |
   | `Save Page` | POSTs the document to `/api/builder/webapp/save`. |

   **Attachments.** A build can be given files. Images arrive as signed URLs in
   `attachmentUrls` and become image blocks in the request — URLs rather than
   base64, because pushing megabytes through a webhook to say the same thing is
   the version that falls over. They are signed for an hour, comfortably longer
   than a build. Text files are read on the app's side and arrive already inside
   `attachmentText`. Both are optional; with nothing attached the request is
   exactly what it was.

   **The system prompt no longer lives in this workflow at all.** The app
   composes it per kind and sends it inside `generationBody`, which the
   generation nodes forward without reading. See `src/lib/builder/blueprints/`
   for the source, and [`page-prompt.md`](./page-prompt.md) for the mirrored
   copy kept so it can be reviewed and diffed — a prompt nobody can see change
   is a prompt nobody reviews. If those two disagree, the app is what ran.

   It covers **sign-in and dashboards**: a build asked for accounts produces a
   working demo in the one file — views shown and hidden by script, real
   validation, a protected dashboard, sign out. Two rules make that usable
   rather than a locked door:

   - a seeded demo account, **with its credentials printed on the sign-in
     screen**, because whoever opens the preview will not guess the password
     the model invented; and
   - **no localStorage, sessionStorage or cookies**. The preview frame has an
     opaque origin, where those APIs throw a `SecurityError` on access — a page
     that keeps its session there does not degrade, it crashes blank on load.
     State lives in ordinary variables, so accounts last as long as the tab,
     and the page says so quietly rather than implying otherwise.

   The three `Generate With …` nodes call their APIs with HTTP nodes rather
   than LLM chain nodes on purpose: a generated page is full of `{` and `}`, and
   a chain reads those as prompt template variables. Editing an existing page
   would corrupt it.

   With thinking on, the first content block is the thinking, not the page — so
   `Extract Page` joins the `text` blocks rather than reading `content[0]`. That
   is `Extract Page`'s job, not `Save Page`'s; `Save Page` receives an `html`
   string that has already been pulled out.

   **`Save Page` refuses anything unsigned.** `/api/build` signs `requestId`,
   `projectId` and `userId` — the three it has already checked ownership of —
   and the workflow carries that `signature` through as an opaque field. Since
   the page it stores is later served to its owner, an unsigned caller could put
   their own HTML on someone's preview, which is the one thing here worth
   attacking. If this step starts answering 401, the field is not reaching it:
   check that `Normalize Build Request` sets `signature` and that `Save Page`
   sends it.

   These two run after the response, so a failure cannot travel back in it.
   Both route their error output to `Flag Build Failure`, which marks the
   project row `Failed` — the same row the workspace is polling — so the chat
   says the build did not finish rather than waiting out its eight minutes in
   silence.

   **Truncation is the failure to expect.** A page cut off at the model's token
   ceiling still begins `<!doctype html>` and renders as half a page with no
   error anywhere, so `/api/builder/webapp/save` refuses a document with no
   closing tag (execution 224 is that: three minutes of generation, no closing
   tag, 422). `max_tokens` is 32,000 and the prompt tells the model to finish
   what it starts and to prefer Tailwind over long stylesheets, because output
   length is the budget being spent.

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
     verified to hold `projects` with all six build columns, and the credit
     RPCs the app calls: `charge_credits` for work already delivered (the build
     charge in `/api/builder/webapp/save`, and edits and questions in
     `/api/build`), `spend_credits` for a charge that must be refused when the
     pool cannot cover it (`/api/credits/spend`, which is how publishing is
     paid for), and `ensure_credit_balance` behind both.

     It needs the **service_role** key, not the anon key: the node updates a row
     on the user's behalf with no user session, and `projects` is owner-scoped by
     RLS, so an anon key updates nothing and reports success. It updates the row
     matching the `projectId` the app sent, writing `status, intent,
     preview_url, repo_url, admin_url, last_build_at`.
4. **The generation credentials** — one per provider, because a credential is
   bound to a node in n8n and cannot be an expression.

   | Node | Credential type | State |
   | --- | --- | --- |
   | `Generate With Claude` | `anthropicApi` | Attached (`Anthropic account`). |
   | `Generate With OpenAI` | `openAiApi` | Attached, but it is the shared "n8n free OpenAI API credits" pool, which is **exhausted** — `400 … used all your free n8n AI credits`. Replace with a real key before offering GPT models. |
   | `Generate With Gemini` | `googlePalmApi` | **None attached**, and no Google credential exists on the instance. A build picking a Gemini model fails at this node and is flagged. |

   None of these three nodes knows anything about models. The wire id,
   `max_tokens`, thinking and effort all arrive inside `generationBody`, built
   by `generationRequest()` in `src/lib/builder/model-request.ts` — which is
   therefore where to go to change what a build costs to run, not here.

   The note that used to sit here described an `Intent Classifier Model` node
   running Opus 5 at low effort for routing, and weighed Sonnet or Haiku against
   it. That node was deleted along with the classifier, so the tradeoff it
   described no longer exists: nothing in this workflow picks a model, and no
   model runs before generation.
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
     Node "Generate With Gemini":      Missing required credential: googlePalmApi
   ```

   (The message above is illustrative — the second line named
   `Intent Classifier Model` when it was first recorded, and that node is gone.
   `Generate With Gemini` is the node with no credential today.)

   Supabase is a credential this account can supply, so it is the real gate.
   Until the workflow is published the production webhook answers 404, which the
   app reports as "the workflow is probably not published yet".

   Without it `Sync Project Row` writes nothing, every build stays "Building" in
   the dashboard, and `/api/build` reads back a row the orchestrator never
   touched.

Every external call runs with `onError: continueRegularOutput`, so one unconfigured
integration degrades that branch to `branchStatus: "failed"` instead of killing the
execution — the chat UI still gets a response.

## What decides the kind now

Nothing in this workflow. The app decides it — see `src/lib/builder/intent.ts`
and `classify-kind.ts` — and sends it as `buildKind` with the `systemPrompt`
composed for that kind. `Kind Decided By App` only checks that both arrived.

All four kinds (landing, ecommerce, blog, webapp) run down the same branch,
because what differs between them is the prompt the app composed, not the
plumbing here.

## Adding a build type back

WordPress and E-Commerce were removed to get one branch working properly first.
They are not gone — they are in this workflow's **version history**, which is
where to restore them from rather than rebuilding eight nodes by hand.

Bringing one back is three changes, and all three or none:

1. A **route to it.** There is no classifier to add a category to any more, so
   this means either a new condition on `Kind Decided By App` (which is an If,
   not a Switch — a third destination makes it a Switch) or, better, keeping the
   routing in the app and giving the branch its own `buildKind`.
2. The **branch** itself, ending in a Collect node that sets the same seven
   fields (`intent, previewUrl, repoUrl, adminUrl, configKeys, artifacts,
   branchStatus`).
3. A **Merge input** — raise `Collect Build Outcome`'s input count and connect
   the Collect node to the new one.

Miss the category and the branch is dead code. Miss the Merge input and the
build runs and then vanishes, with the chat waiting out its 60-second timeout.

There is no longer an ordered list of classifier outputs to shift, which was the
fiddliest part of this when the classifier existed. `Kind Decided By App` has
two: true to the build branch, false to `Flag For Manual Review`.

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
row and writes nothing. It no longer bills a model call either: nothing runs a
model before the response, and the probe's request carries no `buildKind`, so it
is answered by `Flag For Manual Review` and never reaches generation.

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
was verified end to end with pinned data (executions 177, 178 and 183). Those
runs predate the classifier's removal, so treat the execution numbers as history
rather than as something to compare against. To repeat the test now, pin
`Build Request Webhook`, the generation node for the provider you are testing,
and `Sync Project Row`, then run from the webhook trigger.

Two halves worth testing separately, because they are separated by the response:

- **Up to the answer** — webhook, normalize, `Kind Decided By App`, spec,
  collect, merge, assemble, sync, payload, respond. Fast, no model call, and the
  half a user actually waits on. Send a request with no `buildKind` to exercise
  `Flag For Manual Review`.
- **After the answer** — `If A Page Is To Be Built` onward. This is where the
  money is spent and where every remaining failure mode lives. Watch for the
  `Generate With Claude` → `Save Page` defect described above: a Claude build
  will show `Save Page` running twice, once refused.

### Node versions

Every node is on the current type version except the seven `Set` nodes, which are
on 3.4 where 3.5 exists. The difference is binary-field handling, which this
graph has none of, and n8n does not upgrade existing nodes in place — so they are
left alone rather than churned for a version number.

---

## Which model runs a build

The composer's model picker used to be a decoration. It offered nine models
across three makers, and every build ran on `claude-opus-5` regardless, because
the picker's state was never sent anywhere — not to `/api/build`, not to this
workflow. The chip could say "Gemini 3 Pro" while Anthropic was billed.

It is real now, and the split of responsibility is worth stating plainly:

**The app decides and shapes.** `/api/build` resolves the picker's id (`"auto"`
included — see `AUTO_MODEL` in `src/app/dashboard/models.ts`), refuses anything
it does not offer, and builds the complete request body for that vendor's API in
`src/lib/builder/model-request.ts`. It sends `provider`, `generationUrl`,
`generationHeaders`, `generationBody` and `responseShape`.

**This workflow sends and reads.** It switches on `provider`, POSTs what it was
given, attaches the credential, and normalises the answer. It contains no
knowledge of what a system prompt is or how any vendor spells one.

The bodies are shaped in the app rather than out of node expressions here for
the reason the system prompt moved: three bodies built on a canvas are three
things that can drift from what the app believes it asked for, with no diff and
no review. `npm run check:models` asserts all three shapes without a key or a
network — including that `max_tokens` never reaches OpenAI (which rejects it)
and that `system` never reaches Google (which would silently drop the blueprint
and return a generic page).

### Credentials

| Provider | Credential | State |
|---|---|---|
| `claude` | `Anthropic account` | Real key. **Out of credit** as of 2026-09-02 — see request id `req_011CefAvYvwh3f9EHXnWWVLj`. |
| `openai` | `n8n free OpenAI API credits` | **Exhausted.** Replace with a real OpenAI key before offering GPT models. |
| `google` | none | **Not created.** Make a Google Gemini (PaLM) API credential from an AI Studio key and attach it to `Generate With Gemini`. |

A build whose provider has no key configured is refused by `/api/build` before
anything is spent, with a sentence naming the maker — not left to fail at the
HTTP node. `providerConfigured()` reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
and `GOOGLE_API_KEY` from the app's environment, so those must be set wherever
the app runs as well as in n8n's credential store.

### Deployment order matters

This workflow's draft expects `generationUrl` and `generationBody` on the
request. An older app does not send them, and the generation node would POST to
an empty URL and fail every build. **Deploy the app first, then publish the
workflow.**
