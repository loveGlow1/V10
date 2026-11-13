# Vercel environment variables

Every variable the code reads, grouped by feature. Set them on the
platform's Vercel project for **Production, Preview and Development**, then
**redeploy**: Vercel only hands new variables to a fresh build.

The owner's **Keys** page (`/api/keys`) shows, by name only, which of these
are set. Audited against the live database on 2026-11-12.

Legend: **Required**: the site or the builder does not work without it.
**Feature**: the feature it names is off until it is set. **Optional**: has
a sensible default.

---

## 1. Core: required for the site to run

| Variable | Status | Value / where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | `https://esuatccbicekcohzgcvd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Supabase → Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required, **secret** | same page → `service_role` |
| `ANTHROPIC_API_KEY` | Required | console.anthropic.com → API keys |
| `NEXT_PUBLIC_SITE_URL` | Strongly advised | `https://www.quickstark.tech` (links in emails, OAuth returns) |
| `CRON_SECRET` | **Required for the app test** | any long random string (scheduled sweeps, and starting each web app's browser test) |
| `OWNER_EMAILS` | Strongly advised | your email(s), comma-separated: who sees the Keys page and owner tools (falls back to `ALERT_EMAIL`) |

## 2. Building websites and web apps

| Variable | Status | Value / where |
|---|---|---|
| `N8N_WEBHOOK_URL` | **Required for building pages and apps** | the build orchestrator's webhook URL in n8n |
| `N8N_WEBHOOK_TOKEN` | **Required** with the URL | the shared secret the n8n workflows check |
| `BUILDER_PAUSED` | Optional | `true` refuses builds with a clear message (incident switch) |
| `BUILDER_PAUSED_MESSAGE` | Optional | the message shown while paused |
| `E2B_API_KEY` | Feature | e2b.dev: the code editor's terminal |
| `E2B_TEMPLATE` | Optional | your E2B template id |
| `TERMINAL_SECRET` | Optional | signs terminal bridges (defaults to the E2B key) |
| `NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID` | Feature | StackBlitz WebContainer client id, for the in-browser terminal |
| `BROWSERLESS_TOKEN` | **Required for the app test** | browserless.io: screenshots, and the sign-in / dashboard / save test every web app must pass before it is Built |
| `BROWSERLESS_URL` | **Required for the app test** | e.g. `https://production-sfo.browserless.io` (the test calls its `/function` API). Without it, apps are Built untested and the thread says so |
| `OPENAI_API_KEY` | Feature | GPT-5, GPT-5 mini and nano in the model picker, on at the next deploy (also OpenAI images). Put the same key on n8n's **OpenAI account** credential for full builds. `AI_OPENAI=off` keeps them off |
| `GEMINI_API_KEY` *or* `GOOGLE_API_KEY` | Feature | Gemini 3 Pro and 2.5 Flash in the picker, on at the next deploy (also Gemini images). Put the same key on n8n's **Google Gemini account** credential for full builds. `AI_GOOGLE=off` keeps them off |

## 3. Databases for generated apps (login, data, the database agent)

How a generated app gets a database (`docs/BACKEND.md`):

- A **web app with login** needs a database of its own, because user
  accounts cannot be shared between apps.
  - It gets a **managed** one when the three managed variables below are
    set.
  - It gets the person's **own** Supabase when they use *Connect Supabase*.
  - Otherwise it falls back to the **shared preview** database. Its
    sign-ups then land in the platform's own user list.
- A site with only a form or a few tables uses the shared preview database.

**Live status on 2026-11-12:**

| Mode | What we found |
|---|---|
| Connect Supabase | Works. 10 projects, last schema applied 2026-10-31, 3 databases scanned by the database agent. |
| Shared preview | Broken since September: the last schema applied was 2026-09-12. See `SUPABASE_DB_URL` below. |
| Managed databases | Never switched on (0 projects). |

| Variable | Status | Value / where |
|---|---|---|
| `SUPABASE_DB_URL` | **Required to create tables on the shared preview database — currently wrong** | Supabase → **Connect** → **Session pooler**, port **5432**. Format: `postgresql://postgres.esuatccbicekcohzgcvd:<DB-PASSWORD>@aws-<N>-<region>.pooler.supabase.com:5432/postgres`. The two recorded failures were the **direct** host `db.esuatccbicekcohzgcvd.supabase.co` (Vercel cannot reach it) and the pooler with username `postgres` instead of **`postgres.esuatccbicekcohzgcvd`**. Use the *database* password (reset it in Project Settings → Database if lost) and percent-encode `@ : / ? # % & +` in it. |
| `SUPABASE_OAUTH_CLIENT_ID` | **Required for Connect Supabase + the database agent** | Supabase → Organization → OAuth Apps (already working; keep it) |
| `SUPABASE_OAUTH_CLIENT_SECRET` | **Required** with the id | same OAuth app |
| `SUPABASE_OAUTH_REDIRECT_URL` | Optional | `https://www.quickstark.tech/api/integrations/supabase/callback` if your site URL differs |
| `SUPABASE_MANAGEMENT_TOKEN` | Feature: managed databases, **secret** | Supabase → Account → Access Tokens (it can create and delete projects) |
| `SUPABASE_ORG_ID` | Feature: managed databases | Supabase → Organization settings → General (the org that is billed) |
| `MANAGED_DATABASES_ENABLED` | Feature: managed databases | `true`. Off on purpose until set: each app's database is a monthly Supabase bill |
| `SUPABASE_MANAGED_REGION` | Optional | a Supabase region slug, default `eu-west-2` |
| `DB_AGENT_APPROVAL_SECRET` | Optional, **secret** | a long random string that signs the agent's one-time write approvals (defaults to the OAuth secret or the service key) |
| `DB_AUTOPILOT` | Optional | `off` stops the database agent's autopilot everywhere |

## 4. Publishing apps to the web

| Variable | Status | Value / where |
|---|---|---|
| `VERCEL_API_TOKEN` | **Required to publish apps** | vercel.com/account/tokens |
| `VERCEL_TEAM_ID` | Required if your Vercel projects are under a team | Vercel → Team Settings → General |
| `VERCEL_PROJECT_ID` | Feature: custom domains on the platform project | Vercel → this project → Settings |
| `QUICKSTARK_APP_DOMAIN` | Optional | `quickstark.tech`: gives apps `<name>.quickstark.tech` (needs `*.quickstark.tech` verified in Vercel) |
| `QUICKSTARK_PREVIEW_DOMAIN` | Optional | the base for preview addresses |
| `DEPLOY_ALLOWLIST` | Optional | comma-separated emails allowed to deploy; unset means everyone |

## 5. Video studio

| Variable | Status | Value / where |
|---|---|---|
| `RUNWARE_API_KEY` | **Feature (main video engine)** | my.runware.ai → API Keys. Clips, characters, lip sync, music, voices |
| `FAL_KEY` | Feature | fal.ai: lip sync, avatars and music when Runware is not set |
| `MINIMAX_API_KEY` | Feature | MiniMax direct: clips and voices |
| `HF_API_KEY_ID`, `HF_API_KEY_SECRET` | Feature | Higgsfield: Seedance and Kling clips |
| `N8N_VIDEO_WEBHOOK_URL` | Optional | worked out from `N8N_WEBHOOK_URL` when not set |
| `VIDEO_QUALITY` | Optional | `credit` (default), `best` or `economy` |
| `VIDEO_PRODUCTION_ENGINE` | Optional | `runware` or `fal`, to pin the lip sync, avatar and music engine |
| `N8N_CREDIT_PAUSE_HOURS` | Optional | default 24 |
| `RUNWARE_VIDEO_MODEL`, `RUNWARE_IMAGE_MODEL`, `RUNWARE_SPEECH_MODEL`, `MINIMAX_SPEECH_MODEL` | Optional | model overrides |

**Also in Supabase:** Storage → Settings → **upload size limit at least 400 MB**,
or large clips are refused.

## 6. Images and fliers

| Variable | Status | Value / where |
|---|---|---|
| `IDEOGRAM_API_KEY` | Feature | ideogram.ai → API |
| `UNSPLASH_ACCESS_KEY` | Feature | unsplash.com/developers |
| `PEXELS_API_KEY` | Feature | pexels.com/api |
| `AI_IMAGE_ENDPOINT`, `AI_IMAGE_API_KEY` | Feature | your own image service |
| `AI_IMAGE_ENABLED` | Optional | `false` turns the custom service off |
| `OPENAI_IMAGE_MODEL`, `GEMINI_FLASH_IMAGE_MODEL`, `GEMINI_PRO_IMAGE_MODEL`, `N8N_OPENAI_IMAGE_MODEL` | Optional | model overrides |
| `N8N_FLIER_WEBHOOK_URL` | Optional | worked out from `N8N_WEBHOOK_URL` |
| `FLIER_ART` | Optional | `stock` keeps fliers on Unsplash only |
| `FLIER_ENGINE` | Optional | `nano-banana` puts Nano Banana Pro first |
| `FLYERS_API_ENABLED` | Optional | `1` opens the standalone `/api/flyers` |
| `ASSET_PROVIDER_ORDER`, `CURATED_ASSETS_BASE_URL`, `CURATED_LIBRARY_ENABLED` | Optional | image-library ordering and the curated library |

## 7. Email

| Variable | Status | Value / where |
|---|---|---|
| `RESEND_API_KEY` | Feature | resend.com → API Keys (verify your domain there) |
| `ALERT_EMAIL` | Optional | where operational alerts go |
| `RECEIPT_FROM`, `ALERT_FROM`, `FORM_NOTIFY_FROM` | Optional | senders; default to addresses on your site's domain |
| `FORMS_SENDER_SALT` | Optional, **secret** | a random string for form rate limiting (defaults to the service key) |

## 8. Payments

| Variable | Status | Value / where |
|---|---|---|
| `STRIPE_SECRET_KEY` | Feature | dashboard.stripe.com → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Feature | a Stripe webhook to `/api/payments/stripe/webhook`, then its signing secret |
| `BTCPAY_URL`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID` | Feature | your BTCPay server |
| `BTCPAY_WEBHOOK_SECRET` *or* `CRYPTO_PAYMENTS_WEBHOOK_SECRET` | Optional | the BTCPay webhook secret |
| `CRYPTO_RATES_URL`, `COINGECKO_API_KEY` | Optional | exchange-rate source; a CoinGecko demo key avoids rate limits |

## 9. Sign-in and integrations

| Variable | Status | Value / where |
|---|---|---|
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Feature | github.com/settings/developers → OAuth Apps; callback `<site>/api/integrations/github/callback` |
| `GITHUB_OAUTH_REDIRECT_URL` | Optional | only if the callback differs |
| `MCP_OAUTH_SECRET` | Optional, **secret** | seals MCP sign-in tokens (defaults to the service key) |
| `MCP_OAUTH_REDIRECT_URL` | Optional | only if the callback differs |
| `MCP_WAIT_SECONDS` | Optional | how long an MCP tool call waits on a build |
| `WHATSAPP_BOT_SECRET` | Feature | the secret your WhatsApp bot sends |
| `WHATSAPP_BOT_NUMBER` | Optional | the bot's number, shown to people |

## 10. Diagnostics (leave unset normally)

`SUPABASE_HEALTH_INCLUDE_DETAILS`, `NEXT_PUBLIC_SHOW_SUPABASE_CONFIG_WARNING`.

## Not for you to set

- `NODE_ENV` and `VERCEL_ENV` are set by Vercel.
- `NEXT_PUBLIC_SUPABASE_SCHEMA` is written into each generated app.
- `TERMINAL_DEV_BRIDGE_URL`, `TERMINAL_DEV_BRIDGE_KEY` and `QS_SESSION` are
  for local development only.

---

## Outside Vercel

1. **Supabase Auth → URL Configuration:** add
   `https://www.quickstark.tech/auth/callback` (and
   `https://*.vercel.app/auth/callback` for previews). See `docs/SUPABASE.md`.
2. **GitHub → Settings → Secrets → Actions:** `SUPABASE_DB_URL` (the same
   pooler string) for the **Database migrations** workflow.
   - That workflow has failed on every run so far (#620, #622, #624), within
     3 seconds and before any step ran.
   - Check the `production` environment's protection rules and that the
     secret exists. Until it works, migrations have to be applied by hand.

## The web app guarantee

A web app with sign-in and a database is not marked **Built**, and not charged, until it passes a test in a real browser (`src/lib/builder/verify-run.ts`): a confirmed test member signs in, the dashboard opens without a database error, and a record they save is found in the database. A failure is repaired automatically (up to two rounds, one file each) and tested again; if it still fails the project is **Needs fixing**, the owner is told which step failed, and nothing is charged. A web app whose database is not ready stops before the test, uncharged, with the reason. Each run is recorded in `build_verifications`. Needs `BROWSERLESS_URL`, `BROWSERLESS_TOKEN` and `CRON_SECRET`.

## ChatGPT and Gemini, handled like Claude

Every request a person can pick a model for goes through one adapter (`src/lib/ai/llm.ts`): workspace edits, answers and clarifications, the video Creative Director, the video editor and its suggestions. Whichever maker answers, the request is shaped the same way: system prompt, the earlier turns, pictures and PDFs, the length limit, the text streamed as it is written. The answer is also read the same way: finished, out of room, refused, or out of time. Errors read the same too (key refused, rate limited, request refused, unknown model, unreachable).

To switch them on:
1. Set `OPENAI_API_KEY` and/or `GEMINI_API_KEY` on Vercel and redeploy (Vercel asks for one when a variable is added). Nothing else is needed in the app: the models switch on, join the first page of the workspace's model picker and the video studio's agent list, and are open to every plan, charged at their own rates. Auto stays Claude, and a Claude pick only ever steps down to a cheaper Claude. Rates, from published prices against Sonnet 5:

   | Model | Credits per use |
   |---|---|
   | GPT-5 | 1× |
   | GPT-5 mini | 0.25× |
   | GPT-5 nano | 0.25× |
   | Gemini 3 Pro | 1.5× |
   | Gemini 2.5 Flash | 0.5× |

2. In n8n, attach the same keys to the **Generate With OpenAI** and **Generate With Gemini** nodes (credentials "OpenAI account" and "Google Gemini account"). Full builds go through those nodes.
3. Run `node tools/check-providers.mjs --live` with the keys set. It confirms each model id exists on your account and that each model answers.
4. If a provider has renamed a model, set `MODEL_ID_<ID>`, for example `MODEL_ID_GEMINI_3_PRO=gemini-3-pro-preview`, without a release.

What stays Claude-only: Auto (Sonnet 5), the background helpers that classify a request and draft schemas, and Claude's web-fetch tool and reasoning summary during edits.
