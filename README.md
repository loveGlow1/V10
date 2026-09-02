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

### Checking the blueprints

```bash
npm run check:blueprint
```

Two things it will not let slip. That a brief still routes to the kind a
careful reader would build from it — measured on a labelled corpus, offline,
with no model call, with a set per rung of the routing ladder — and that every
blueprint still meets its own contract: no emptied field, every conditional
requirement stating both its condition and its requirement, and a composed
prompt that still carries the brief, the depth floors and the exclusions.
Blueprints are prose, and prose has no type checker: an exclusion can be
deleted and nothing anywhere would fail.

### The asset pipeline

The architectural rule: **the model that writes the code does not decide what
visual assets a project needs, does not make them, does not store them and does
not optimise them.** It is handed a manifest and uses what is in it. A model
deciding its own imagery one section at a time is how a project ends up with a
luxury photograph, a cartoon and a 3D render in it, each individually
defensible.

```
brief → classify → blueprint → visual planner → asset planner
                                       ↓
                    user upload · generated · sourced
                                       ↓
                    asset library → storage → optimiser
                                       ↓
                        manifest → code generator
```

`src/lib/builder/assets/` holds it:

| | |
| --- | --- |
| `asset-types.ts` | The types, states, quality tiers, and the table that decides whether a thing is a **photograph or drawn**. A chart, icon, logo or avatar is drawn in code — that's a property of the type, not advice in a prompt |
| `asset-planner.ts` | **One visual direction per project**, read from the brief, inherited by every request. Structured specs, never a raw prompt |
| `asset-generator.ts` | `generate` / `edit` / `upscale` / `getStatus` behind one interface, with ordered fallback |
| `asset-library.ts` | Reuse by fingerprint of the *spec*, so a rebuild never pays twice for the same picture |
| `asset-storage.ts` | Supabase Storage + `project_assets`, so an asset outlives the response that made it |
| `asset-optimizer.ts` | One place that decides delivery widths, formats and `srcset` |
| `asset-resolver.ts` | The priority ladder — **user upload → existing project asset → made now → placeholder last** — producing the manifest |

Quality defaults to `premium`. `npm run check:assets` covers the whole path
offline: no key, no network, no cost.

#### Image sources are plug-ins, never dependencies

The builder must produce a complete project with every API key missing, every
external provider disabled or down, and every rate limit reached. So the sources
sit behind one `AssetProvider` interface and the chain is configuration:

```
project assets → curated library → Unsplash → Pexels → AI generation → panel
```

| Provider | Cost | Default |
| --- | --- | --- |
| **Project assets** — uploads, then anything this project already made | free | always on, nothing to configure |
| **QuickStark curated library** — our own catalogue, the source that needs no third party | free | on when `CURATED_ASSETS_BASE_URL` points at the bucket |
| **Unsplash / Pexels** | low | off unless a key is set |
| **AI generation** | high | off unless explicitly enabled |

Every provider reports one of `available`, `disabled`, `misconfigured`,
`rate_limited` or `temporarily_unavailable`. A missing key is `misconfigured` —
an ordinary, silent state, not an error. The resolver skips it and carries on.
A provider that throws mid-build is skipped for that slot. **Nothing is ever
shown to the person building the site, and nothing asks them to configure an
API.**

`ASSET_PROVIDER_ORDER` reorders or narrows the chain without touching code, and
a per-build cost ceiling keeps the expensive source out of a build that can't
afford it. Keys stay server-side: the generated project receives an asset URL
and nothing else. `GET /api/health` reports `imagesConfigured`, plus per-provider
states outside production.

### Photographs

Generated pages used to draw everything — a product, a person, a plate of food,
all as inline SVG — because the rule said no external images, and every
stock-photo URL a model invents is broken. Nothing was ever broken, and
everything looked like clip art. A model cannot solve this by writing base64: a
JPEG is compressed binary, and base64 from a model is corrupt bytes and a
broken image.

So the page declares the picture and something else fills it:

```html
<img data-shot="folded ochre wax print fabric, raking light, neutral seamless"
     data-ratio="4/5" data-weight="thumb" alt="Ochre Adire wax print, six yards">
```

`src/lib/builder/images.ts` reads every slot after generation and embeds real
photographs as base64, spending a page budget in weight order — heroes first,
grid thumbnails last — so a long catalogue degrades to placeholders rather than
to a page nobody waits for. `UNSPLASH_ACCESS_KEY` or `PEXELS_API_KEY` turns it
on; with neither, every slot keeps a neutral toned placeholder and the page is
stored exactly as it would have been.

Charts, diagrams, maps, logos and icons stay drawn, deliberately — a photograph
of a chart is unreadable — and `npm run audit:page` fails a page that draws a
photograph as SVG, which is the defect that made pages look generated.

`npm run check:images` exercises the whole path against a stub provider: no key,
no network, no cost.

### Judging what came back

```bash
npm run audit:page -- path/to/page.html landing
```

`check:blueprint` asks whether the prompt still says the right things.
`audit:page` asks the question after it — whether what came back obeyed them:
the document is finished, no placeholder copy, no `href="#"`, every anchor
resolves to an id that exists, content is in the markup rather than built from
a JS array, no storage APIs, no invented image URLs, and the per-kind floors
(nine sections and five FAQ entries for a landing page, eight products and a
subtotal for a store, seven articles and one of 800+ words for a blog, four
views and the four states for an app). For a web app it also reports which
architecture the build decided it needed, which is how you check the
conditional rules did their job: a calculator should come back "none — a plain
tool".

Whether the copy is any good is still a judgement someone makes by looking.
These are the rules a person stops checking after the third build.

### What a build makes

A build generates one complete, self-contained HTML page — markup, styles and
its own interactivity in a single document — saved against the project and
served at `/preview/<projectId>`. A second message in the same workspace passes
the current page back to the model, so a follow-up edits it rather than
replacing it.

**Four kinds, four blueprints.** A brief is classified — landing page,
storefront, blog, web app — and built from the blueprint for that kind:

| Kind | What it is | What it must not have |
| --- | --- | --- |
| `landing` | One page, one audience, one action. Nine or more full sections of real copy, five or more FAQ entries, real proof. | No cart, no checkout, no sign-in wall, no blog index, no admin dashboard |
| `ecommerce` | A catalogue of at least eight products, a cart, and a checkout whose totals add up. | No sign-in wall, no admin dashboard, no inventory back office |
| `blog` | A publication: a lead story, seven or more articles, categories that filter, and one full article of eight hundred words. WordPress briefs are built here. | No pricing table, no pricing tiers, no cart, no marketing hero |
| `webapp` | The product that was asked for: a shell that fits it, four or more real workflows, and loading, empty, success and error states. | No marketing hero, no storefront, no fake dashboard widgets |

**Two markets, read from the brief.** The United States and Nigeria each get a
locale block written for them, and `src/lib/builder/market.ts` decides which
travels with a build:

| | United States | Nigeria |
| --- | --- | --- |
| Money | `$1,299`, card first, Stripe | `₦1,250,000`, **bank transfer first**, then card, USSD, pay-on-delivery; Paystack or Flutterwave |
| Address | street, city, two-letter state, ZIP | building, street, area, city and state — no postcode |
| Phone | `(415) 555-0142`, reserved range | `0803 123 4567`; no reserved range exists, so keep invented numbers illustrative |
| Dates | March 4, 2026 | 4 March 2026 |
| Spelling | American | British |
| Tax / registration | sales tax, Inc./LLC, EIN | VAT at 7.5%, Ltd, RC number |
| Delivery | national, business days | within-city by dispatch rider, 2–4 working days to other states |

Detection reads places, currencies and the services a business actually uses,
because nobody writes "in Nigeria" when they write "checkout with Paystack".
Whichever it picks is only a default: both blocks open by handing precedence
back to the brief, so "for my bakery in Leeds" comes back British, in pounds,
without either market having to enumerate the world. A brief naming nowhere
gets `DEFAULT_MARKET` — one constant, one line to change.

The two blocks are written separately rather than parameterised on purpose. A
US page with ₦ in front of the numbers reads as a translation; what makes a
Nigerian storefront read as Nigerian is transfer above card and delivery quoted
by state.

Every blueprint fills in the same nine-field contract — identity,
requirements, optional features, depth floors, interactions, **conditional
requirements**, exclusions, quality rules, completion rules — and the prompt is
assembled additively:

```
BASE RULES + BLUEPRINT + USER BRIEF + PROJECT CONTEXT = systemPrompt
```

The exclusions are what keeps the kinds apart. Every kind used to be built from
one prompt describing "a page", so a landing page could arrive with a product
grid and a blog with a pricing table — the same demo each time, different words
in it. Each blueprint now says what its kind is *not*.

The conditional requirements are what keeps a kind from being one shape. "Web
app" means a CRM and it means a unit converter, so authentication, roles, a data
model, an API surface and a back end are each conditional on the product
actually needing them — and a lightweight utility is explicitly told to have
none of them and to build the tool properly instead. Forcing a calculator into a
CRM's architecture produces exactly the fake dashboard this replaced.

Routing is a ladder: the target chip on Home decides outright; otherwise a brief
that names its kind gets it, unless it demands another kind's machinery ("a
landing page with a cart and checkout" is a store); otherwise the signals are
weighed; and only what none of that settles reaches a model — about one brief in
ten. It lives in `src/lib/builder/kinds.ts`.

The app composes the prompt and sends it with the build request; the
orchestrator uses what it is given (`n8n/page-prompt.md`). A prompt is a commit
here, not an edit in a browser.

A build asked for accounts produces a working sign-in and a dashboard behind
it — validation, protected views, sign out, and a seeded demo account whose
credentials are printed on the sign-in screen so the preview can actually be
opened. It is a demo, not security: there is no backend, state lives in memory,
and accounts last as long as the tab. The page says so.

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