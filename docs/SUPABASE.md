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

This contradicts what `/api/credits/spend` says about itself: that the browser
says what happened and never what it costs. Today it is latent rather than
exploitable for value, because the only client-priced actions are chat (which
tops out at one credit) and publish (which nothing implements yet). It stops
being latent the moment publishing ships at `PUBLISH_COST`, because charging
yourself zero for it would then be worth doing.

Closing it properly means the server calling the function as `service_role`
rather than as the user, which needs three things together:

1. `spend_credits` taking the user id as an argument — under `service_role`
   there is no `auth.uid()` for it to read.
2. A service-role Supabase client for `/api/credits/spend` and `/api/build`,
   which needs `SUPABASE_SERVICE_ROLE_KEY` set in the deployment.
3. `revoke execute on function public.spend_credits(...) from authenticated;`

All three have to land together: revoking first breaks every charge the app
makes, since it currently calls the function under the caller's own session.

### Nothing ever marks a project published

`PUBLISHED_STATUSES` is `["Live", "Published"]`, and no writer produces either.
The column defaults to `Draft`; `/api/build` writes `Building` and `Failed`; the
orchestrator writes `Building`, `Failed` or `Needs Clarification`. The live table
holds only `Draft` and `Failed`.

So `isPublished()` is false for every row, which makes the dashboard's
"Published" filter permanently empty, the Manage pane's Published row always
"Not yet", and `REDEPLOY_COST` unreachable — a publish would always price at
`PUBLISH_COST`. All of that resolves when the publish step exists and writes one
of these two statuses; there is no separate bug to fix.

Worth knowing: `projects.status` has no `CHECK` constraint, so a typo in a status
string is accepted and silently becomes a state nothing recognises.
