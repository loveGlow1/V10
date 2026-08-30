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
[ Collect Build Outcome ]  (Merge, append, 4 inputs)
          ▼
[ Assemble Build Result ] → [ Sync Project Row ] (Supabase `projects`)
          ▼
[ Build Chat Payload ] → [ Return Payload to Chat UI ]
```

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

## Before this can run for real

The graph is wired and tested; the outbound integrations are not yet connected.

1. **Placeholder URLs** — four HTTP Request nodes point at your provisioning service.
   Open each and fill in the URL:
   - `Scaffold Next.js App`
   - `Apply Supabase Schema`
   - `Provision WordPress Site`
   - `Register Store Webhooks`
2. **Credentials** — connect these in n8n:
   - `Supabase QuickStark.Ai` on `Sync Project Row` (needs insert rights on `public.projects`;
     the row is written as `user_id, name, prompt, status`)
   - `WordPress` on `Create Starter Page`
   - `Shopify Admin API` on `Seed Shopify Catalog`
3. **OpenAI** — `Intent Classifier Model` is bound to the shared "n8n free OpenAI API credits"
   credential, which is currently **exhausted**. Swap in a real OpenAI credential or the
   classifier returns `400 … used all your free n8n AI credits` and nothing routes.
4. **Publish** — the workflow is deliberately left unpublished. Activating it exposes the
   production webhook publicly, so do that only once 1–3 are done.

Every external call runs with `onError: continueRegularOutput`, so one unconfigured
integration degrades that branch to `branchStatus: "failed"` instead of killing the
execution — the chat UI still gets a response.

## Testing

`Assemble Build Result`, the Merge, and the response path were verified end to end with
pinned data (execution 177). To repeat it, pin `Build Request Webhook`, the four HTTP nodes,
and `Sync Project Row`, then run from the webhook trigger.
