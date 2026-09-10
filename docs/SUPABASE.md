# Wiring QuickStark.Ai to Supabase

Everything in the app is written against Supabase already. This is what has to
exist on the Supabase side, and in which order, for sign-in to work end to end.

## 1. Environment variables — done

The project's public values are committed in `.env`, so any build picks them up
with no further setup:

```
NEXT_PUBLIC_SUPABASE_URL=https://esuatccbicekcohzgcvd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi…   (anon role, valid to 2036)
```

Both are public by design — they are compiled into the browser bundle on every
build, so they are already visible to anyone who loads the site. Row Level
Security on each table is what protects the data, not the secrecy of this key.
Anything set in **Vercel → Project Settings → Environment Variables** overrides
the file, which is the better home for them if you would rather they not sit in
the repository.

The `service_role` key must never go in `.env`: it bypasses RLS and that file is
committed. Keep it in the hosting platform's environment only.

For reference, the values come from **Project Settings → API**:

| Variable | Where it comes from | Exposed to the browser |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon/public | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | **never** |

Both public values must also be set in the deployment environment (on Vercel:
Project Settings → Environment Variables) and the project redeployed. They are
read at build time as well as at runtime, so a redeploy is required — restarting
is not enough.

Until they are set the site renders normally with authentication disabled, and a
banner explains why in development.

## 1a. The hostname Google shows — optional

The sign-in sheet names the host serving the request, which by default is
`esuatccbicekcohzgcvd.supabase.co`. Putting `auth.quickstark.tech` there instead
is the Custom Domains add-on and a change to `NEXT_PUBLIC_SUPABASE_URL`; see
[AUTH-DOMAIN.md](AUTH-DOMAIN.md) for the whole sequence, and
`npm run check:auth-domain` to check it afterwards.

## 2. Redirect URLs

**Authentication → URL Configuration.** Add every origin the app runs on to
**Redirect URLs**, each with the callback path:

```
http://localhost:3000/auth/callback
https://www.quickstark.tech/auth/callback
https://<any-custom-domain>/auth/callback
```

Vercel also gives every deployment its own preview URL. If you want sign-in to
work on previews as well, add the wildcard `https://*.vercel.app/auth/callback`.

Set **Site URL** to the production origin.

This step is the one that is easy to miss and hard to diagnose: an origin that
is not on this list fails *after* the visitor has already approved the provider,
which reads as "sign-in did nothing".

## 3. Providers

**Authentication → Providers.** The landing page offers Google, Facebook, Apple,
GitHub, email and phone. Enable only the ones you intend to ship — a button for
a disabled provider returns an error the visitor cannot act on. Each social
provider needs its client ID and secret from that provider's own console, and
the Supabase callback URL shown on the provider's panel registered there.

Phone additionally needs an SMS provider (Twilio, MessageBird, Vonage) with
credentials, or every phone sign-in fails at the send step. The flow itself is
complete: the number screen sends the code, and the screen after it verifies the
code and signs the visitor in.

## 4. Email confirmation

**Authentication → Providers → Email** controls "Confirm email". It is on by
default, and the app handles both settings:

- **On** — sign-up tells the visitor to check their inbox. The link lands on
  `/auth/callback`, which establishes the session and forwards to the dashboard.
- **Off** — sign-up returns a session immediately and goes straight to the
  dashboard.

## 5. The tables

Run [`supabase/schema.sql`](../supabase/schema.sql) in the SQL editor. It is safe
to run more than once, and it covers both tables the app touches.

### `user_profiles`

The table already exists with the right shape. Two things were missing, and both
fail silently:

- **Policies.** RLS is enabled. With RLS on and no policies, every read returns
  nothing and every write is refused — indistinguishable from an empty table.
  The script adds owner-scoped select/insert/update.
- **Something to fill it.** Nothing in the app writes this table, so it stays at
  zero rows however many people sign up. The script adds a trigger on
  `auth.users` that inserts a profile on sign-up, taking `full_name` from
  sign-up metadata (or `name` / `avatar_url` from an OAuth provider), and
  backfills anyone who registered before the trigger existed.

The dashboard reads `full_name` from this table for the sidebar, falling back to
the session's own metadata and then the email address.

### `projects`

The dashboard reads `id, name, updated_at, status` from `projects`, newest
first. This table does not exist yet, which is why the dashboard lists nothing —
the query fails and the page falls back to an empty list rather than erroring.
The script creates it with the same owner-scoped policies.

`user_id` has no default, so whatever creates a project must set it to
`auth.uid()`.

## 6. Checking it worked

1. `npm run dev`, then sign up with email. With confirmation on you should be
   told to check your inbox, not dropped on the dashboard.
2. Open the emailed link. It should pass through `/auth/callback` and land on
   `/dashboard`.
3. Sign out from the sidebar. You should return to the landing page, and
   visiting `/dashboard` directly should send you back to it.
4. Try a social provider. Approving it should return you to the dashboard
   signed in — if it returns you to the landing page with a message instead,
   the redirect URL from step 2 is missing.

## How the pieces fit

| File | Role |
| --- | --- |
| `src/lib/supabase.ts` | Browser client, session in cookies so the server can read it |
| `src/lib/supabase-server.ts` | Server client for Server Components and Route Handlers |
| `src/middleware.ts` | Refreshes the access token and writes the new cookies |
| `src/app/auth/callback/route.ts` | Exchanges the OAuth/confirmation code for a session |
| `src/app/dashboard/layout.tsx` | Redirects anyone without a session to `/` |

## 7. Two things an audit of the live project turned up

Both were found by checking the running database against what the code assumes,
rather than by reading the code alone.

### `spend_credits` takes the price from whoever calls it

`spend_credits` is `SECURITY DEFINER` and `authenticated` holds `EXECUTE` on it,
so any signed-in user can call `/rest/v1/rpc/spend_credits` straight from the
browser and name their own `p_cost`. The function checks only that the cost is
non-negative and that the balance covers it. Supabase's own linter flags this as
`authenticated_security_definer_function_executable`.

`grant_credits` is *not* exposed — `authenticated` has no `EXECUTE` on it — so
nobody can credit themselves. The exposure is the price of a charge, not the
creation of one.

#### How bad it actually is, having checked

This section used to say publishing was paid for through `/api/credits/spend`,
and therefore that somebody could charge themselves zero for a fifty-credit
publish. **That was wrong, and it is worth being precise about why, because the
wrong version reads like an emergency and this one does not.**

Nothing is paid for through `/api/credits/spend`. Every priced action charges
itself, on the server, through `charge_credits` — which `authenticated` has no
`EXECUTE` on and no browser can reach:

| Action | Where it is charged |
| --- | --- |
| Publish and redeploy | `/api/publish` — prices with `creditCostOf`, charges with `chargeCredits` |
| Build, edit, question | `/api/build` and `/api/builder/webapp/save`, the same way |

`/api/credits/spend` has **no caller at all**. Not one `.ts` or `.tsx` file in
`src/` fetches it; the only mentions are three comments referring to it. The
route is vestigial.

So what a signed-in user can actually do by calling `/rest/v1/rpc/spend_credits`
is deduct credits **from their own balance** and write a row in **their own**
ledger with an action and description of their choosing. They cannot credit
themselves, cannot reach another account, and cannot obtain free work. It is an
accounting-integrity flaw — someone can pollute or drain their own ledger — not
a way to take value.

Two checks against the live database, on 2026-09-09:

- **The ledger is clean.** 191 rows, no zero-cost row of any kind. Publishes sit
  at −50 and −1, chats at real fractional prices. Nothing looks hand-made.
- **The function is not called.** 24 hours of request logs show zero hits on
  `/rest/v1/rpc/spend_credits`, against 38 on `charge_credits` and 77 on
  `ensure_credit_balance`.

#### Closing it anyway

Worth doing — a browser-reachable write into the credit ledger has no reason to
exist — but at the pace of housekeeping, not an incident.

1. **`spend_credits_for(p_user_id, …)` — done, applied 2026-09-09.** Told whose
   account to charge, executable by `service_role` alone. `spend_credits` is now
   a wrapper over it so the two cannot drift, and keeps the grant it already
   had, since `create or replace function` preserves privileges.
2. **Deploy.** `/api/credits/spend` charges through `spend_credits_for` with the
   service key, having settled who the caller is under their own session first.
   Until step 1 has run it falls back to the wrapper and logs an error naming
   the migration, so the order of 1 and 2 cannot break charging.
3. **Run `supabase/close-spend-credits.sql`.** One `revoke`, plus a query that
   proves it. Running it before step 2 breaks every charge the app makes.

The fallback in step 2 needs no cleanup: after step 3 `authenticated` no longer
holds `EXECUTE` on the wrapper, so that path fails on its own.

**The better fix is to delete the route.** A public endpoint with no caller is a
surface with no purpose, and deleting it closes this more decisively than a
revoke does. The only reason to check first is that it is a public URL, so a
stale cached client could still be calling it — read the deployment's own logs
before removing it.

`SUPABASE_SERVICE_ROLE_KEY` must be set in the deployment for any of this —
without it the route stays on the fallback and says so in the log.

### Publication does not live in `projects.status`

It used to be planned that way, and this section used to say so. Doing it would
have been a bug, and it is worth writing down why so nobody puts it back.

`status` is the BUILD lifecycle: `Draft`, `Building`, `Built`, `Failed`. It is
written by `/api/build` in nine places and by the n8n orchestrator in two more —
and the orchestrator is not this codebase, so those writes cannot simply be
removed. A project published on Monday and edited on Tuesday would therefore
have `status` back at `Built` while its published snapshot was still being
served: the site live, the row denying it. Everything reading status would then
quote the first-publish price to somebody already live — 50 credits instead of
1 — show "Published: Not yet" beside a working URL, and drop the project out of
the Published filter.

So the authority is **`projects.published_version_id`** (and `published_at`),
written only by `/api/publish` and touched by nothing else. `isPublishedProject`
in `src/lib/project-status.ts` reads those, falling back to the status only for
rows selected without them. A publish still sets `status = 'Published'` because
it is a useful label on a fresh row — but nothing decides on it, and any code
that starts to is reintroducing this.

`PUBLISHED_STATUSES` and `isPublishedStatus` remain for that label and for rows
written before publishing existed.

Worth knowing: `projects.status` has no `CHECK` constraint, so a typo in a status
string is accepted and silently becomes a state nothing recognises.
