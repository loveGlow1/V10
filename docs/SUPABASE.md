# Wiring QuickStart.Ai to Supabase

Everything in the app is written against Supabase already. This is what has to
exist on the Supabase side, and in which order, for sign-in to work end to end.

## 1. Environment variables — done

The project's public values are committed in `.env`, so any build picks them up
with no further setup:

```
NEXT_PUBLIC_SUPABASE_URL=https://kobyrxmpphilhistcotg.supabase.co
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

## 2. Redirect URLs

**Authentication → URL Configuration.** Add every origin the app runs on to
**Redirect URLs**, each with the callback path:

```
http://localhost:3000/auth/callback
https://v10-eight-jet.vercel.app/auth/callback
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
credentials, or every phone sign-in fails at the send step.

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

### `project_logs`

The dashboard reads and writes this table. Its columns match the shape the
dashboard components already expected — `project_name`, `repository`, `branch`,
`status`, `tech_stack`, `latest_activity` — so neither side had to be renamed.

It does not exist yet, which is why the dashboard opens empty. The page treats a
failed query as an empty workspace rather than an error, so it stays usable
until the script is run.

`user_id` has no default; the dashboard sets it to the signed-in user on insert,
and the policies refuse anything else.

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

## Known gap: phone sign-in

Phone sign-in sends the code (`signInWithOtp`) but there is no screen to enter
it, so the flow cannot complete even with an SMS provider configured. It needs a
verification step calling `verifyOtp`. Everything else on this page works
without it.
