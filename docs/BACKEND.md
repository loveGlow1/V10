# Giving a generated project a database

**Not every project gets one.** That sentence is the architecture, and until
recently the code could not say it: "no database" was represented by the
ABSENCE of a row in `project_backends`, which is indistinguishable from a row
that failed to write — so a brochure site and a bookkeeping failure produced
the same answer, and that answer was "put it on the shared instance".

There are four modes, in `src/lib/builder/backend/modes.ts`:

| Mode | What it is | Fit for real customer data |
|---|---|---|
| `none` | no database. Nothing is provisioned and nothing is charged | — |
| `quickstark_managed` | a Supabase project of its own, made for this app | yes |
| `shared` | a schema on QuickStark's instance | **no** — a preview |
| `own` | the owner's Supabase | yes |

**The manifest decides IF there is a database; the mode decides only WHOSE it
is.** `architecture.manifest.database` comes out of understanding the product,
and a project with no data layer never reaches the provisioning stage at all —
no connection opened, no schema named, no migration written.

## The three layers

A **custom domain**, a **Vercel deployment** and a **database** are three
different things, and this repository had them fused. Every domain was added to
the platform's own Vercel project and a domain was refused unless the project
had a published snapshot — which only the single-page flow ever writes. So a
generated Next.js app, deployed to a Vercel project of its own, could not be
given a custom domain at all. Not "it was fiddly": there was no path.

| Layer | Where it lives | Stored as |
|---|---|---|
| Domain | Vercel, on the project that serves it | `project_domains.domain`, `.target`, `.vercel_project` |
| Hosting | a Vercel project, one per generated app | `project_deployments.vercel_project`, `.deployment_id` |
| Data | one of the four modes above | `project_backends.mode`, `.managed_ref` |

The Vercel project and the deployment are **recorded, not derived**. A name
derived from the project title is re-derivable only while the title and the
shape stay the same, and a project that changes either strands its own domain
on a Vercel project nobody is looking at.

The code is in `src/lib/builder/backend/` and `src/lib/publish/`. Asserted by
`npm run check:backend-modes`.

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
| `SUPABASE_MANAGEMENT_TOKEN` | **`quickstark_managed`.** Creating a Supabase project per app | Supabase dashboard → Account → Access Tokens — **secret, and it can DELETE projects** |
| `SUPABASE_ORG_ID` | which organisation the managed projects go in, and therefore which account pays | Supabase → Organization settings → General |
| `SUPABASE_MANAGED_REGION` | optional. Defaults to `eu-west-2` | a Supabase region slug |

Without the management token and the organisation, `configured()` is false,
`modeFor()` falls back to the shared preview instance, and the panel marks the
managed option unavailable **with the reason** rather than offering a button
that always fails. That fallback is a degradation and is described as one; it
is not passed off as the same thing.

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

### Decided — the schema exposure problem

**This was the one thing that was not a checkbox, and the shared backend does
not work without an answer to it.** Option 3 below is the one that was taken.

Each project on the shared instance gets its own Postgres schema,
`app_<projectid>` — see `schemaNameFor()` in `src/lib/builder/schema.ts`. The
generated app then connects with the schema pinned:

```ts
createClient(url, anonKey, { db: { schema } })
```

PostgREST will only serve a schema that is in its **exposed schemas** list
(Supabase → Project Settings → API → *Exposed schemas*, default `public,
graphql_public`). A schema that is not on that list answers every query with
`PGRST106: The schema must be one of the following` — so the tables exist, the
migration applied, and the app still reads nothing.

The list cannot be written in advance, because the schema name contains the
project's id and a new one appears on every build. Three ways out were open:

1. **Put every project in `public` on the shared instance, prefixed per
   project.** Loses the separation, but needs no per-build configuration.
2. **Maintain the exposed list by hand**, adding each new schema as it is
   created. Only workable at small numbers.
3. **Make the shared backend preview-only and give anything real a Supabase
   project of its own.** ✅

**Option 3, and `quickstark_managed` is it.** A project of its own has nothing
to share a schema namespace with, so its tables go in `public` — the one schema
exposed everywhere without anybody configuring anything. PGRST106 cannot happen
there.

It fixes three things at once, which is why it is the answer rather than a
tidier version of the same problem:

- `auth.users` is one table per Supabase **project**. A project of its own has
  an identity pool of its own.
- `public` is served by PostgREST everywhere, so the app can read its tables.
- The data is in a project that can be handed over, exported or left.

It costs a real amount of money per project, which is why it is **gated on
configuration rather than automatic** — see the management token above.

#### Two consequences of a project per app, stated rather than discovered

A Supabase project of its own is a Supabase project in every respect, including
the parts nobody asked for:

- **The sign-in sheet names that project.** Google's consent screen says "to
  continue to `<ref>.supabase.co`" — the app's own ref now, not QuickStark's.
  Fixing it is Supabase's Custom Domains add-on at roughly $10/month **per
  project**, which is per generated app. See `docs/AUTH-DOMAIN.md`, which solves
  the same problem for the platform's own.
- **A free project sleeps after a week of no traffic.** A managed database
  behind a site nobody has visited will be paused when somebody finally does,
  and `verifyBackend()` names that as the likeliest cause rather than reporting
  a timeout.

Neither is a reason not to do it. Both are reasons to say so before somebody
publishes a shop.

The PGRST106 question is also now asked **before** a build rather than
discovered after one: `schemaIsServable()` in `verify.ts` reads PostgREST's
`content-profile` header when a Supabase is linked and refuses the link with
the fix written out.

### Verification, server-side

Linking used to check **shape** and nothing else — that the URL parsed and was
https, and that the key was an anon key rather than a service key. Both are
worth checking and neither is evidence the thing exists. So a project was
marked connected on the strength of two regexes and the first real test was a
migration inside a sixty-second build, minutes later and somewhere else, where
failing looks like a build problem rather than a typo.

`verifyBackend()` runs on the server, where the builds run, and what it finds
goes to `project_backends.verified_at`. It never writes anything: a check that
created a table to prove it could create tables would leave debris in somebody
else's database on every attempt, including the failed ones.

The browser's pre-flight is still there and is **not** the same thing — it runs
on the customer's network, so a proxy or a blocker fails it while the Supabase
is perfectly reachable from where it matters. That one can be overridden. This
one cannot.

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

That is fine for a preview and wrong for a business with real customers. There
are two exits and both are offered in the panel: a Supabase project of its own
(`quickstark_managed`), or the owner's (`own`). `isProductionGrade()` is the
question the interface asks before somebody publishes a shop onto the shared
instance, and it is what stopped the preview looking exactly like the others.
