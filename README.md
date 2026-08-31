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
served at `/preview/<projectId>`. A landing page or a small web app that really
exists. A second message in the same workspace passes the current page back to
the model, so a follow-up edits it rather than replacing it.

A message is classified before anything runs — edit, new build, question or
revert. Only a new build goes to the orchestrator. An **edit** is a
search/replace patch applied in the app in seconds, leaving everything the
request did not name byte-identical; a **question** is answered without
touching the page; a **revert** puts the previous version back on top as a new
one. A build that would replace an existing page stops and asks first.

**A new build is answered before the page is built.** Generating takes a minute or
two; a serverless function is killed at sixty. So the orchestrator replies as
soon as the prompt is classified, generates afterwards under its own Anthropic
credential, and posts the finished page to `/api/builder/webapp/save`. The
workspace polls the project row and shows the preview when it lands. Nothing
holds an HTTP request open waiting for a model.

One variable is required for it, beyond the orchestrator's own:

```bash
SUPABASE_SERVICE_ROLE_KEY=...   # what a finished page is stored under
```

Never `NEXT_PUBLIC_`. The save endpoint is called by n8n with no user session
behind it, so the write has no `auth.uid()` for RLS to answer for. Nothing else
uses this key. The app needs no Anthropic key — generation happens in n8n.

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