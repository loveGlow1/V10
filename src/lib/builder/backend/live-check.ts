/* The app, tried against its real database before anybody else tries it.
 *
 * Everything before this checks the plan: the tables provisioning meant to
 * create, the SQL the build wrote, the shape of the code. None of it asks the
 * database the question a customer asks the moment they open the app — "can I
 * read this?" — and the answers have been wrong in ways only that question
 * finds. Aurelia Estates shipped a dashboard reading `favorites` from a
 * database that had no such table, and a sign-in that hung, and both were
 * found by its owner.
 *
 * So, once the files land, every table the code queries is tried as the two
 * people who use an app:
 *
 *   A VISITOR      the anon role. Reading a private table may be refused —
 *                  that is the point of it — but it must not ERROR any other
 *                  way: a policy calling a function that does not exist fails
 *                  every query on the table, signed in or not.
 *   A NEW MEMBER   a user who signed up a moment ago: a row in auth.users, a
 *                  profile written the way the sign-up page writes it, then
 *                  every table read with their identity.
 *
 * And two things are read off the catalogue: that row-level security is on,
 * and that no table holding people's rows (a user_id) lets everybody read it.
 *
 * All of it runs in one function, in one transaction, and the test member is
 * rolled back — nothing is left in anybody's database, not even an auth row.
 * Pure: the running is the save route's, through the runner provisioning uses.
 */

export type LiveProblem =
  | "missing"
  | "rls_off"
  | "public_personal_rows"
  | "visitor_error"
  | "member_error"
  | "signup_failed";

export type LiveFinding = { table: string; problem: LiveProblem; detail?: string };

export type LiveCheck = {
  /** Tables tried. */
  checked: string[];
  findings: LiveFinding[];
  /** Whether a test sign-up was attempted and went through. null when there is no profiles table, or auth.users could not be written. */
  signup: boolean | null;
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * The SQL that runs the check. One statement's result: a single row whose
 * `result` is the JSON readLiveCheck reads.
 */
export function liveCheckSql(schema: string, tables: readonly string[]): string {
  const safe = [...new Set(tables)].filter((name) => IDENT.test(name));
  const target = IDENT.test(schema) ? schema : "public";
  const list = safe.length ? `array[${safe.map((name) => `'${name}'`).join(", ")}]::text[]` : "array[]::text[]";

  return `create or replace function pg_temp.quickstark_live_check(target text, wanted text[])
returns jsonb
language plpgsql
as $check$
declare
  t text;
  n bigint;
  found jsonb := '[]'::jsonb;
  member uuid := gen_random_uuid();
  claims text := json_build_object('sub', member, 'role', 'authenticated')::text;
  signed_up boolean := null;
  stage text;
begin
  foreach t in array wanted loop
    if to_regclass(format('%I.%I', target, t)) is null then
      found := found || jsonb_build_object('table', t, 'problem', 'missing');
      continue;
    end if;

    if not (select relrowsecurity from pg_class where oid = to_regclass(format('%I.%I', target, t))) then
      found := found || jsonb_build_object('table', t, 'problem', 'rls_off');
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = target and table_name = t and column_name = 'user_id'
    ) and exists (
      select 1 from pg_policies
      where schemaname = target and tablename = t
        and cmd in ('SELECT', 'ALL') and permissive = 'PERMISSIVE'
        and roles && array['anon', 'public']::name[]
        and coalesce(trim(qual), 'true') in ('true', '(true)')
    ) then
      found := found || jsonb_build_object('table', t, 'problem', 'public_personal_rows');
    end if;

    begin
      execute 'set local role anon';
      execute format('select count(*) from %I.%I', target, t) into n;
      execute 'reset role';
    exception
      when insufficient_privilege then execute 'reset role';
      when others then
        execute 'reset role';
        found := found || jsonb_build_object('table', t, 'problem', 'visitor_error', 'detail', sqlerrm);
    end;

    begin
      perform set_config('request.jwt.claims', claims, true);
      perform set_config('request.jwt.claim.sub', member::text, true);
      execute 'set local role authenticated';
      execute format('select count(*) from %I.%I', target, t) into n;
      execute 'reset role';
    exception when others then
      execute 'reset role';
      found := found || jsonb_build_object('table', t, 'problem', 'member_error', 'detail', sqlerrm);
    end;
  end loop;

  if to_regclass(format('%I.profiles', target)) is not null then
    begin
      stage := 'auth';
      insert into auth.users (id, email, aud, role)
      values (member, 'quickstark-check-' || member || '@example.invalid', 'authenticated', 'authenticated');
      stage := 'profile';
      perform set_config('request.jwt.claims', claims, true);
      perform set_config('request.jwt.claim.sub', member::text, true);
      execute 'set local role authenticated';
      begin
        execute format('insert into %I.profiles (id, email) values ($1, $2)', target)
          using member, 'quickstark-check-' || member || '@example.invalid';
      exception when unique_violation then
        null; -- a trigger on auth.users wrote it already, which is also a working sign-up
      end;
      execute format('select count(*) from %I.profiles where id = $1', target) using member into n;
      execute 'reset role';
      signed_up := n = 1;
      if not signed_up then
        found := found || jsonb_build_object('table', 'profiles', 'problem', 'signup_failed', 'detail', 'a new member cannot read their own profile');
      end if;
      raise exception using errcode = 'P0001', message = 'quickstark_rollback';
    exception when others then
      execute 'reset role';
      if sqlerrm <> 'quickstark_rollback' and stage = 'profile' then
        signed_up := false;
        found := found || jsonb_build_object('table', 'profiles', 'problem', 'signup_failed', 'detail', sqlerrm);
      end if;
    end;
  end if;

  return jsonb_build_object('checked', to_jsonb(wanted), 'findings', found, 'signup', signed_up);
end;
$check$;
select pg_temp.quickstark_live_check('${target}', ${list}) as result;`;
}

/** The check's answer, or null when the database answered in some other shape. */
export function readLiveCheck(rows: unknown[]): LiveCheck | null {
  const last = rows[rows.length - 1] as { result?: unknown } | undefined;
  let value = last?.result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as { checked?: unknown; findings?: unknown; signup?: unknown };
  if (!Array.isArray(raw.checked) || !Array.isArray(raw.findings)) return null;
  return {
    checked: raw.checked.filter((name): name is string => typeof name === "string"),
    findings: raw.findings
      .filter((entry): entry is LiveFinding => Boolean(entry) && typeof entry === "object" && typeof (entry as LiveFinding).table === "string")
      .map((entry) => ({ table: entry.table, problem: entry.problem, ...(entry.detail ? { detail: String(entry.detail) } : {}) })),
    signup: typeof raw.signup === "boolean" ? raw.signup : null,
  };
}

const SAYS: Record<LiveProblem, (finding: LiveFinding) => string> = {
  missing: (f) => `\`${f.table}\` does not exist — the pages that read it will show an error`,
  rls_off: (f) => `\`${f.table}\` has row-level security switched off, so anyone with the public key can read and change every row`,
  public_personal_rows: (f) => `\`${f.table}\` holds people's own rows but lets anybody read all of them`,
  visitor_error: (f) => `reading \`${f.table}\` fails for every visitor${f.detail ? ` (${f.detail})` : ""}`,
  member_error: (f) => `a signed-in member cannot read \`${f.table}\`${f.detail ? ` (${f.detail})` : ""}`,
  signup_failed: (f) => `signing up does not work: ${f.detail ?? "the profile could not be written"}`,
};

/** What the owner is told, in a sentence or a short list. */
export function describeLiveCheck(check: LiveCheck): { ok: boolean; text: string } {
  const tried = check.checked.length;
  const signup = check.signup === true ? " Signing up and reading your own profile work." : "";
  if (check.findings.length === 0) {
    return {
      ok: true,
      text: `Checked against your live database: all ${tried} table${tried === 1 ? "" : "s"} this app reads exist, have row-level security, and answer a visitor and a newly signed-up member correctly.${signup}`,
    };
  }
  const lines = check.findings.slice(0, 8).map((finding) => `- ${SAYS[finding.problem]?.(finding) ?? `${finding.table}: ${finding.problem}`}`);
  const more = check.findings.length > 8 ? `\n- …and ${check.findings.length - 8} more` : "";
  return {
    ok: false,
    text: `I tried this app against your live database as a visitor and as a new member, and found ${check.findings.length === 1 ? "a problem" : `${check.findings.length} problems`} before anyone else does:\n${lines.join("\n")}${more}\n\nReply "fix the database" and I'll write the SQL for it and show it to you before running anything.`,
  };
}
