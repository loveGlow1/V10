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
[ Intent Classifier ]  (Text Classifier, temperature 0, 3 categories + "other")
          │
  ┌───────┴───────────────┬───────────────────────┬──────────────────────┐
  ▼                       ▼                       ▼                      ▼
WebApp / Landing    WordPress / Blog         E-Commerce          Manual Review
• Build Spec        • Build Spec             • Build Spec        (fallback — nothing
• Scaffold Next.js  • Provision WP Site      • Seed Shopify        is dropped silently)
• Apply Supabase    • Create Starter Page      Catalog
  Schema                                     • Register Store
                                               Webhooks
  └───────┬───────────────┴───────────────────────┴──────────────────────┘
          ▼
[ Collect Build Outcome ]  (Merge, append, 5 inputs)
          │  the classifier's own error output is the fifth:
          │  [ Intent Classifier ] --error--> [ Flag Classifier Failure ]
          ▼
[ Assemble Build Result ] → [ Sync Project Row ] (Supabase `projects`)
          ▼
[ Build Chat Payload ] → [ Return Payload to Chat UI ]
```

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
  "intent": "webapp | wordpress | ecommerce | unclassified",
  "status": "Building | Failed | Needs Clarification",
  "links":      { "preview": "…", "repo": "…", "admin": "…" },
  "configKeys": { "NEXT_PUBLIC_SUPABASE_URL": "…", "…": "…" },
  "artifacts":  { "stack": "…", "…": "…" },
  "message": "Your webapp build is underway — the preview link updates as it finishes."
}
```

Every branch normalizes to the same seven fields before the Merge
(`intent, previewUrl, repoUrl, adminUrl, configKeys, artifacts, branchStatus`),
so the chat UI has one response shape to render regardless of which branch ran.

`status` is derived in `Assemble Build Result` and written straight to
`projects.status`, which the dashboard already reads.

`artifacts.filesTouched` is what `/api/build` prices the build from, so each
branch reports it from its provisioning response (`filesTouched`, or `files`).
A branch that reports neither prices at the action's floor.

**The webhook always answers.** Every outbound call runs with
`onError: continueRegularOutput`, and `Intent Classifier` — the one node every
build passes through, and the only one that depends on an outside model — runs
with `onError: continueErrorOutput` into `Flag Classifier Failure`. Without that
error output a classifier failure ends the execution silently: the webhook never
responds, and the app waits out its 60-second timeout before telling the user
the build "may still finish", which is not true. Now it comes back as
`status: "Failed"` with the reason in `artifacts`, and `/api/build` does not
bill a build that never ran.

`Flag Classifier Failure` is not the same thing as `Flag For Manual Review`:
that one is a prompt nobody could classify, which is a real answer and is
charged for. This one is the classifier being unreachable.

## Before this can run for real

The graph is wired and tested; the outbound integrations are not yet connected.
Steps 1–4 need secrets, and step 5 is refused by n8n until step 3 is done.

1. **Header Auth on the webhook (do this first).** The Webhook node requires
   Header Auth, and the `Header Auth account` credential is now attached to it —
   its header name is `Authorization`, which is the header `src/lib/n8n.ts`
   sends. What is left is to make the two sides agree: set that credential's
   **value** to `Bearer <your-token>` and set `N8N_WEBHOOK_TOKEN=<your-token>`
   in the app. If the credential currently holds a value for something else,
   make a new Header Auth credential instead and attach that one — every call
   from the app will 403 until the header value matches.

   This is not optional hardening. `Sync Project Row` writes with the
   service_role key, which bypasses RLS, and the row it writes to comes from the
   request body. An open webhook here is a way for anyone who learns the URL to
   overwrite any project row in the database. `/api/build` checks ownership, but
   nothing forces a caller to go through `/api/build`.

2. **Placeholder URLs** — four HTTP Request nodes point at your provisioning service.
   Open each and fill in the URL:
   - `Scaffold Next.js App`
   - `Apply Supabase Schema`
   - `Provision WordPress Site`
   - `Register Store Webhooks`
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
   - `WordPress` on `Create Starter Page`
   - `Shopify Admin API` on `Seed Shopify Catalog`
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
5. **Publish** — this is not a matter of choosing to wait. n8n refuses to publish
   the workflow at all while step 3 is outstanding, and names the three nodes:

   ```
   Cannot publish workflow: 3 nodes have configuration issues:
     Node "Create Starter Page":   Missing required credential: wordpressApi
     Node "Seed Shopify Catalog":  Missing required credential: shopifyAccessTokenApi
     Node "Sync Project Row":      Missing required credential: supabaseApi
   ```

   None of those three credentials exist in the n8n account yet, so creating them
   is the gate on everything downstream. Until the workflow is published the
   production webhook answers 404, which the app reports as "the workflow is
   probably not published yet".

   `supabaseApi` is the one that matters even if WordPress and Shopify never
   get used: without it `Sync Project Row` writes nothing, every build stays
   "Building" in the dashboard, and `/api/build` reads back a row the
   orchestrator never touched.

Every external call runs with `onError: continueRegularOutput`, so one unconfigured
integration degrades that branch to `branchStatus: "failed"` instead of killing the
execution — the chat UI still gets a response.

## Database

The build columns live on `public.projects` and are created by
[`supabase/schema.sql`](../supabase/schema.sql), which is safe to re-run:

| Column | Written by | Holds |
| --- | --- | --- |
| `status` | app, then workflow | `Building` / `Failed` / `Needs Clarification` |
| `prompt` | app | what was asked for |
| `intent` | workflow | `webapp` / `wordpress` / `ecommerce` / `unclassified` |
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
the OpenAI credential is exhausted; with a working credential, leave it unpinned
so the routing itself is exercised.
