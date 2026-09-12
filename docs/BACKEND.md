# Giving a generated project a database

A generated project's data lives on **QuickStark's own Supabase** by default, in
a schema named for the project. That is the shared backend, and it is what a
project gets by saying nothing. An owner can then point the project at **their
own Supabase** instead — same files, same schema, different database.

The code for both is in `src/lib/builder/backend/`. This file is the
configuration the platform needs for either to work, and what is still missing.

---

## 1. Vercel environment variables

Everything here is **server-only**. Nothing in this section may ever be prefixed
`NEXT_PUBLIC_`, and none of it is written into a generated project.

| Variable | Needed for | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the shared backend's address, and the platform's own | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the key compiled into generated apps on the shared backend | same page → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | reading and writing `project_backends` at all | same page → `service_role` — **secret** |
| `SUPABASE_DB_URL` | **creating the tables.** Without it, every build reports its schema as pending | Supabase → Project Settings → Database → Connection string → **Session pooler** (see below) |

### It has to be the POOLER, not the direct connection

This line used to say "Connection string → URI", which is the **direct**
connection — `db.<ref>.supabase.co:5432`. That host resolves to an IPv6 address
only, and a Vercel serverless function has no IPv6 egress, so `pg` cannot reach
it from production at all. The symptom is not an error anybody sees: the build
carries on by design, the files are still written, and every project just
quietly reports its schema as pending. Which is exactly what a deployment with
the variable correctly set looks like.

Take the **Session pooler** string instead — `aws-0-<region>.pooler.supabase.com`,
port `5432`, with the username in the `postgres.<ref>` form. Session mode rather
than transaction mode (port `6543`) because this connection runs DDL inside one
transaction, and session mode is the one that behaves like an ordinary client.

If the tables are still not created after switching, the reason is now recorded
against the build rather than only spoken once in the chat — see
`project_builds.database_error`.

`SUPABASE_DB_URL` is the one that is probably missing, and it is the one that
makes the difference between a store that works and a store whose products table
does not exist. It is a direct Postgres connection with row-level security
irrelevant and every table in reach — the strongest credential in the system.
`supabase-js` speaks PostgREST, which can select and insert but cannot say
`create schema`, so DDL needs a real connection and this is it.

Set all four for **Production, Preview and Development**, then redeploy —
Vercel only picks up new variables on a fresh build.

### Not needed for this

`NEXT_PUBLIC_SUPABASE_SCHEMA` is written into each generated project's own
`.env.local`, not into the platform's. `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`
and `VERCEL_TEAM_ID` belong to publishing and custom domains
(`src/lib/publish/vercel-domains.ts`), not to backends.

---

## 2. Supabase, on the platform's own project

### Already done — verified 2026-09-09

- `public.project_backends` exists, with `project_id, user_id, kind, url,
  anon_key, db_url, schema_name, applied_at, created_at, updated_at`.
- `db_url` is **write-only at the column level**, which is the point of it.
  `authenticated` holds `INSERT` and `UPDATE` on `db_url` and **no `SELECT`** —
  so an owner can set and replace their connection string and nobody, including
  them, can read it back. Confirmed against
  `information_schema.column_privileges`.

Nothing to do here. Both halves of the table are already live.

### Still to decide — the schema exposure problem

**This is the one thing that is not a checkbox, and the shared backend does not
work without an answer to it.**

Each project gets its own Postgres schema, `app_<projectid>` — see
`schemaNameFor()` in `src/lib/builder/schema.ts`. The generated app then
connects with the schema pinned:

```ts
createClient(url, anonKey, { db: { schema } })
```

PostgREST will only serve a schema that is in its **exposed schemas** list
(Supabase → Project Settings → API → *Exposed schemas*, default `public,
graphql_public`). A schema that is not on that list answers every query with
`PGRST106: The schema must be one of the following` — so the tables exist, the
migration applied, and the app still reads nothing.

The list cannot be written in advance, because the schema name contains the
project's id and a new one appears on every build. Three ways out:

1. **Put every project in `public` on the shared instance, prefixed per
   project.** Loses the clean separation, but needs no per-build configuration.
2. **Give the shared instance a wildcard-ish list you maintain**, adding each
   new schema as it is created. Only workable at small numbers.
3. **Make the shared backend preview-only and route anything real to "own".**
   The generated app then talks to the owner's instance, where the schema is
   `public` and already exposed — which is why `connection.ts` uses `public` for
   own-instance projects and a named schema only for shared ones.

Nothing in the code does any of this yet. Until one is chosen, the shared
backend will create tables that generated apps cannot read.

No `app_*` schema exists on the live instance today, so nothing is broken in
production — the path simply has not run.

---

## 3. What an owner does, once the platform is configured

Nothing on Vercel. Linking is per project, through the app:

1. Open the project → the backend panel.
2. Paste the Supabase **URL** and **anon key** from their own project.
3. Optionally paste their **connection string** as well.

With the connection string, the next build applies the migration to their
instance for them. Without it, the link still works — the app is built against
their database — and creating the tables is theirs to do.

The anon key is checked for actually being an anon key before anything is
stored, and that check is not decoration. Both Supabase keys are JWTs and sit
next to each other in the dashboard, so pasting the wrong one is the likely
accident — and a `service_role` key in that field is compiled into a statically
exported bundle and served to every visitor, each of whom then holds full read
and write over every table with RLS bypassed. `route.ts` reads the role out of
the token and refuses it, because there is no later point at which anybody would
notice.

---

## 4. The ceiling on the shared backend, said plainly

`auth.users` is one table per Supabase project, not one per schema. Every app on
the shared instance therefore draws its accounts from the same pool. They cannot
read each other's rows — a policy in `app_a` never matches a row in `app_b`, and
the role that makes somebody an admin lives in the app's own `profiles` table
rather than on the auth user — but the identities are not separate.

That is fine for a preview and wrong for a business with real customers. It is
the reason "link your own" exists, and it should be described to owners as the
exit rather than as an upgrade tier.
