# Wiring QuickStart.Ai to Supabase

Everything in the app is written against Supabase already. This is what has to
exist on the Supabase side, and in which order, for sign-in to work end to end.

## 1. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the two public values from
**Project Settings → API**:

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
https://<your-vercel-domain>/auth/callback
https://<your-custom-domain>/auth/callback
```

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

## 5. The `projects` table

The dashboard reads `id, name, updated_at, status` from `projects`, newest
first. Run this in the SQL editor:

```sql
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  status      text not null default 'Draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Each policy is scoped to the owner: without these, RLS is on and every query
-- returns an empty list, which looks exactly like "no projects yet".
create policy "Owners read their projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Owners create their projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Owners update their projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Owners delete their projects"
  on public.projects for delete
  using (auth.uid() = user_id);

create index if not exists projects_user_id_updated_at_idx
  on public.projects (user_id, updated_at desc);
```

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

## Known gap: phone sign-in

Phone sign-in sends the code (`signInWithOtp`) but there is no screen to enter
it, so the flow cannot complete even with an SMS provider configured. It needs a
verification step calling `verifyOtp`. Everything else on this page works
without it.
