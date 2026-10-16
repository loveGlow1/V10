# The database agent

Analyse, wire, create, or change a connected Supabase like a senior database
engineer would: read first, explain plainly, change as little as possible,
never surprise.

Code: `src/lib/builder/backend/agent/`. Endpoint: `/api/projects/[id]/backend/agent`.
UI: the **Database agent** card in the Database panel, plus approval cards in chat.
Asserted offline by `npm run check:db-agent` (the spec's twelve acceptance tests).

## Which databases it works on

| Mode | Agent? | Why |
|---|---|---|
| `own`, linked with **Connect Supabase** | yes | the OAuth grant reaches the Management API |
| `quickstark_managed` | yes | the platform's management token, scoped to that one ref |
| `own`, pasted URL + key (+ connection string) | no | no API to scope, no read-only role, no migration history. The old "Run it" flow stays for these. |
| `shared` | no | other people's projects live in the same database |

## Tool layer — Option B

`tools.ts` wraps the Management API server-side with the stored token. Option A
(Supabase's hosted MCP at `mcp.supabase.com/mcp` with the user's OAuth token)
was **not adopted**: Supabase does not document that the hosted MCP accepts a
third-party OAuth app's access token, and the spike needs a live grant this
environment doesn't have. Option B also keeps every hard rule enforced in our
code rather than delegated. If a spike later shows Option A works, it can sit
behind the same `DbTools` interface.

Endpoints, checked against Supabase's Management API reference on 2026-10-16:

| Tool | Endpoint |
|---|---|
| `introspect`, `query_readonly` | `POST /v1/projects/{ref}/database/query/read-only` (beta; falls back to `/database/query` only for SQL the parser has proven is a single read) |
| `dry_run`, access test | `POST /v1/projects/{ref}/database/query` — one `DO` block that always ends in a raised exception, so nothing commits |
| `apply_migration` | `POST /v1/projects/{ref}/database/migrations` (`Idempotency-Key` = surgery id) |
| `list_migrations` | `GET /v1/projects/{ref}/database/migrations` |
| `get_advisors` | `GET /v1/projects/{ref}/advisors/{security,performance}` (experimental) |
| `generate_types` | `GET /v1/projects/{ref}/types/typescript?included_schemas=` |
| `get_api_keys` | `GET /v1/projects/{ref}/api-keys?reveal=true` |
| `get_auth_config` / `update_auth_config` | `GET` / `PATCH /v1/projects/{ref}/config/auth` |
| `list_storage_buckets` | `GET /v1/projects/{ref}/storage/buckets` |
| `get_logs` | `GET /v1/projects/{ref}/analytics/endpoints/logs` (`logs.all` now answers 410) |
| `create_project` | `POST /v1/projects` |

### Hard rules, and where each is enforced

- **One project.** Every tool checks its `ref` against `project_backends` for
  this app and throws `ScopeError` otherwise — before any request leaves.
  A managed project's `list_projects` returns only itself.
- **Read-only means parsed.** `sql-guard.ts` tokenises (strings, `$tag$`
  bodies, quoted identifiers, nested comments) and accepts exactly one
  `SELECT` / `WITH` / `EXPLAIN` (no `ANALYZE`), rejecting data-modifying CTEs,
  `SELECT INTO`, row locks and side-effect functions. Capped at 50 rows,
  5-second `statement_timeout`, run as `supabase_read_only_user`.
- **Writes need an approval token.** `approval.ts`: HMAC-signed, bound to
  project + ref + action + sha256 of the exact SQL + surgery id, five-minute
  expiry, nonce recorded in `db_agent_approvals` so it works once. Minted and
  spent inside `approveSurgery`, which only the Database-panel endpoint calls
  under the owner's session. The chat path can only *plan*.
- **No secret key.** `get_api_keys` returns the publishable key; the secret
  key is sealed (AES-256-GCM) into `db_agent_secrets` in the same call and
  never returned, logged or shown. `redactSecrets` scrubs JWTs, `sb_secret_`
  and common provider keys from anything logged.
- **Logged.** `db_agent_audit`: who (agent/user), tool, ref, SQL hash, ok, detail.
- **Auth.** Adding this app's redirect URLs is allowed without approval
  (preview glob, platform URL, localhost, custom domains from
  `project_domains`); removing any, or changing providers/settings, needs approval.

## Phases

1. **Analyse** (`scanDatabase`, automatic on Connect Supabase, and on
   *Re-scan*). One catalogue query builds the Database Map — tables, columns,
   keys, FKs, unique/check constraints, indexes, row estimates, RLS, policy
   text, triggers, views, functions (security definer, pinned search_path),
   enums, extensions, `auth.users` *count*, profile candidates, buckets,
   advisors, migrations. Saved to `project_backends.db_map`. The analysis card
   gives the glance, detected domain, relationships (Mermaid `erDiagram`),
   health, and the production signal (HIGH when any table > 1,000 rows,
   > 50 users, or writes since the last scan).
2. **Connect the dots** (`wireApp`). `wiring.ts` matches the app's data model
   to real tables by name, synonym and foreign key: MATCHED / ADAPTABLE /
   MISSING / UNUSED / RISK. Code adapts to the database (mapping lives in
   `lib/db/data.ts`); existing profile-like tables are the profile; joins only
   along real FKs (an FK-less `_id` link is *suggested*, never assumed). Types
   are regenerated; the wiring brief is appended to the next build's prompt.
3. **Decide.** One recommendation with a one-line reason: connect as-is,
   surgery, new project, or side-by-side.
4. **Surgery** (`planChange` → `approveSurgery`): re-scan → write the smallest
   change (renames become add + backfill; policies before RLS; CONCURRENTLY on
   > 100k rows) → dry run (one automatic repair if it fails) → card with risk
   per statement, affected tables and rows, row-count previews for
   UPDATE/DELETE, rollback SQL → Approve (L3 needs the typed phrase, e.g.
   `DROP notes`) → re-scan and abort if the fingerprint changed → snapshot
   affected tables into `qs_backups` for L2/L3 → apply in one transaction →
   verify (advisors diff, types, wiring, access test) → recorded in
   `db_surgeries`.

### Risk levels

L0 read · L1 additive · L2 modifying (approve and read the impact) · L3
destructive (typed confirmation + backup). Supabase's own schemas (`auth`,
`storage`, …), roles, transaction control, server files and `ALTER SYSTEM`
are forbidden at any level. On a production database, UPDATE/DELETE without
WHERE is refused.

### Untrusted content

Everything read from the database is data. `untrusted.ts` masks emails,
phones, hashes, tokens and keys; never samples `auth`, secrets or payment
tables, and samples at most five rows only when a column's meaning is unclear;
flags instruction-like text in rows, comments, defaults and policies; and
fences anything passed to a model in `<untrusted_database_content>`.

## Chat commands

"Analyze my database" · "Connect the app to my existing tables" · "Add a phone
number to customers" · "Why can't users see their bookings?" · "Make orders
only visible to the person who placed them" · "Start fresh in a new project" ·
"Undo the last database change". Plain reads run read-only and masked; every
other change comes back as a surgery card with Approve.

## Not done yet, said plainly

- **Branches.** Paid-plan branching (apply to a branch first) is not used; L2/L3
  always take a snapshot instead. Backups are kept 7 days and are not removed
  automatically — removing one is itself an (L1) surgery.
- **Auto-test** is at the database level: as `anon` and as a signed-in stranger,
  per table, inside a rolled-back block. It does not yet load the app's pages
  or submit its forms in a browser.
- **Copying reference data** to a new project is not implemented; the old
  database is left untouched and the next build creates the schema in the new one.
- **Mobile-scheme redirect URLs** are not added (the app has no scheme recorded).
- The read-only and migration endpoints are beta/experimental on Supabase's side;
  their failure is reported as "unavailable", never as a broken database.

## Configuration

Approval tokens are signed with `DB_AGENT_APPROVAL_SECRET`, falling back to
`SUPABASE_OAUTH_CLIENT_SECRET`, then `SUPABASE_SERVICE_ROLE_KEY`. Apply
`supabase/migrations/20261016120000_database_agent.sql` (also appended to
`supabase/schema.sql`).
