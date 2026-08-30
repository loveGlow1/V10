# QuickStark.Ai (V10)

An automated, high-velocity AI SaaS application building platform.

## Core Architecture
- **Framework**: Next.js 15 (App Router)
- **Database & Auth**: Supabase SSR
- **Design System**: Tailwind CSS & Lucide Icons
- **Graphics**: Isolated Live 3D Canvas Element

## Development Setup
1. Install the explicit engine dependencies:
   ```bash
   npm install
   ```
2. Supply your local environment variables in `.env.local`.
3. Spin up the development server locally:
   ```bash
   npm run dev
   ```

## Supabase Environment Configuration (Required for Auth)

Authentication requires both public Supabase variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Where to find these values

In your Supabase project dashboard:

1. Open **Project Settings** → **API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Project API keys** → **anon/public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Local development

Add these values in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### Vercel deployment

For the Vercel project:

1. Go to **Project Settings** → **Environment Variables**
2. Add both variables for **Production**, **Preview**, and **Development**
3. Redeploy after saving variables (required for the deployment to pick them up)

Without these variables, sign-up/sign-in/OAuth/OTP flows will be unavailable.

## Build Orchestration (Required for the chat to build)

The chat does not generate anything on its own: it hands the description to an
n8n workflow that classifies the intent and runs the matching build. That
workflow, its request/response contract and its setup checklist are documented
in [`n8n/README.md`](./n8n/README.md).

Point the app at it with one server-side variable:

```bash
N8N_WEBHOOK_URL=https://<your-instance>.app.n8n.cloud/webhook/api/v1/build
```

It is not `NEXT_PUBLIC_`. Builds go through `POST /api/build`, which reads the
session, checks the project belongs to the caller, prices and charges the build,
and only then calls n8n — an n8n webhook has no idea who is calling it, so those
checks cannot live on the other side.

`N8N_WEBHOOK_TOKEN` is required too, not optional: the workflow writes to the
`projects` table with the service_role key, which bypasses RLS, so an
unauthenticated webhook is a way to overwrite any project row. The Webhook node
requires Header Auth and fails closed until a matching credential is attached.

The token travels in the `X-QuickStark-Token` header, so the n8n credential is
two fields — that name, and the token — with no `Bearer` prefix to get wrong.
See [`n8n/README.md`](./n8n/README.md).

Without `N8N_WEBHOOK_URL` the app runs normally and the chat says building is
not connected rather than pretending to build.

### Deployment health check

The app exposes `GET /api/health` with `supabaseConfigured` and
`builderConfigured` status. `builderConfigured` is `false` exactly when
`N8N_WEBHOOK_URL` is unset — which is the deployment state where the chat
answers "Building is not connected yet", and which is otherwise invisible from
outside because the variable is server-side.
- In non-production, it also returns `missingSupabaseEnvVars` and
  `builderTokenSet`.
- In production, detailed missing-var names are hidden by default; set `SUPABASE_HEALTH_INCLUDE_DETAILS=true` only when you explicitly need detailed diagnostics.

### Checking the wiring

```bash
npm run check:builder
```

Four things have to agree before a chat message becomes an n8n execution: the
URL the app holds, the token it sends, the header name the Webhook node's
credential compares, and the workflow being published. From the browser all four
fail the same way — nothing happens — and from n8n's side a call that never
arrives leaves no trace at all, which is why the canvas can sit on "waiting for
the webhook call" indefinitely while the app looks healthy.

`npm run check:builder` makes the call the app would make and names which of the
four is wrong. It POSTs one real build request with no `projectId` and no
`userId`, so it runs one execution — the classifier bills an Anthropic call —
and `Sync Project Row` matches no row and writes nothing.

### What a build makes

A build generates one complete, self-contained HTML page — markup, styles and
its own interactivity in a single document — saved against the project and
served at `/preview/<projectId>`. That is the artifact for now: a landing page
or a small web app that really exists and can be looked at, not a description of
one. A second message in the same workspace edits that page rather than
replacing it.

Two variables are required for it, beyond the orchestrator's own:

```bash
ANTHROPIC_API_KEY=sk-ant-...          # what the page is generated with
SUPABASE_SERVICE_ROLE_KEY=...          # what stores it; never NEXT_PUBLIC_
```

The generated page is untrusted: it is model output shaped by whatever someone
typed, and it has to run its own scripts to be a working page. It is served
under `Content-Security-Policy: sandbox`, which puts it in an opaque origin —
scripts run, but they cannot reach the session cookie or the API routes on this
domain. Previews are private to their owner; RLS decides that, and making a page
public is what publishing will be for.

**Publishing, custom domains, a provisioned Supabase schema and Stripe are
deliberately not part of a build.** A build saves work into the workspace; going
live is a separate step the owner chooses and spends credits on. None of it is
built yet.

See [`n8n/README.md`](./n8n/README.md).