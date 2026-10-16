/* Running SQL without keeping it: the dry run and the RLS auto-test.
 *
 * Both are one DO block that ends by raising an exception, so Postgres rolls
 * back everything it did — tables created, rows written, roles switched — and
 * the only thing that comes back is the exception's message. A dry run that
 * reaches the end says DRY_RUN_OK; one that fails says why, from the statement
 * that failed. The auto-test switches to the API's own roles inside the block
 * and reports what each could see, as JSON in the message.
 *
 * One statement rather than BEGIN … ROLLBACK because the Management API may
 * hand the connection back to a pool: an explicit BEGIN that fails half-way
 * leaves a transaction open on somebody else's next query. A DO block cannot.
 *
 * Pure. Asserted by tools/check-db-agent.mjs.
 */

import { qualified } from "./db-map";

export const DRY_RUN_OK = "QS_DRY_RUN_OK";
const TEST_MARK = "QS_RLS_TEST:";

/** A dollar-quote tag that does not occur in the text. */
function tagFor(text: string, seed: number): string {
  let n = seed;
  while (text.includes(`$qs${n}$`)) n += 1;
  return `$qs${n}$`;
}

/** Each statement EXECUTEd in order, then rolled back. CONCURRENTLY is dropped: it cannot run in a block, and the plain index proves the same thing. */
export function dryRunSql(statements: string[]): string {
  const body = statements
    .map((s, i) => {
      const sql = s.replace(/;\s*$/, "").replace(/^(\s*create\s+(?:unique\s+)?index)\s+concurrently\s+/i, "$1 ");
      const tag = tagFor(sql, i);
      return `  execute ${tag}${sql}${tag};`;
    })
    .join("\n");
  const outer = tagFor(body, 9000).replace("$qs", "$qsdry");
  return `do ${outer}\nbegin\n${body}\n  raise exception '${DRY_RUN_OK}';\nend\n${outer};`;
}

export type DryRun = { ok: true } | { ok: false; error: string };

/** What a dry run's answer means. The API reports the exception as a refusal with its message. */
export function readDryRun(result: { ok: true } | { ok: false; reason: string }): DryRun {
  if (result.ok) return { ok: false, error: "the dry run did not reach its end marker" };
  if (result.reason.includes(DRY_RUN_OK)) return { ok: true };
  return { ok: false, error: result.reason.replace(/^Supabase answered \d+: /, "") };
}

export type RlsTestTable = { schema: string; name: string; ownerColumn: string | null; rls: boolean };

/**
 * What a visitor and a signed-in stranger can see, per table, rolled back.
 *
 * As anon: the row count visible, or the error. As an authenticated user with
 * a fresh random id (owns nothing): the same. A table with an owner column
 * should show that stranger zero rows; a table the app reads should not error.
 */
export function rlsTestSql(tables: RlsTestTable[]): string {
  const probes = tables
    .slice(0, 40)
    .map((t) => {
      const name = qualified(t.schema, t.name);
      const key = `${t.schema}.${t.name}`.replace(/'/g, "''");
      return `
  begin
    execute 'select count(*) from ${name.replace(/'/g, "''")}' into n;
    result := result || jsonb_build_object('${key}', coalesce(result->'${key}', '{}'::jsonb) || jsonb_build_object(who, n));
  exception when others then
    result := result || jsonb_build_object('${key}', coalesce(result->'${key}', '{}'::jsonb) || jsonb_build_object(who, sqlerrm));
  end;`;
    })
    .join("");
  return `do $qsrls$
declare
  result jsonb := '{}'::jsonb;
  n bigint;
  who text;
begin
  who := 'anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;${probes}
  reset role;
  who := 'stranger';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;${probes}
  reset role;
  raise exception '${TEST_MARK}%', result::text;
end
$qsrls$;`;
}

export type RlsFinding = { table: string; ok: boolean; message: string };

/** Each table's verdict, from the test's answer. */
export function readRlsTest(
  result: { ok: true } | { ok: false; reason: string },
  tables: RlsTestTable[],
  options: { publicRead?: Set<string> } = {},
): { ran: boolean; findings: RlsFinding[] } {
  if (result.ok) return { ran: false, findings: [] };
  const at = result.reason.indexOf(TEST_MARK);
  if (at === -1) return { ran: false, findings: [{ table: "*", ok: false, message: `The access test could not run: ${result.reason}` }] };
  let parsed: Record<string, { anon?: number | string; stranger?: number | string }>;
  try {
    const text = result.reason.slice(at + TEST_MARK.length);
    parsed = JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
  } catch {
    return { ran: false, findings: [] };
  }
  const findings: RlsFinding[] = [];
  for (const t of tables) {
    const key = `${t.schema}.${t.name}`;
    const seen = parsed[key] ?? {};
    const anon = seen.anon;
    const stranger = seen.stranger;
    if (typeof stranger === "string" && /permission denied/i.test(stranger)) {
      findings.push({ table: key, ok: false, message: `Signed-in users can't read ${t.name} at all (${stranger}). The app's pages on it will be empty.` });
    } else if (t.ownerColumn && typeof stranger === "number" && stranger > 0) {
      findings.push({ table: key, ok: false, message: `A signed-in user who owns nothing can read ${stranger} rows of ${t.name} — people can see each other's ${t.name}.` });
    } else if (typeof anon === "number" && anon > 0 && !options.publicRead?.has(key)) {
      findings.push({ table: key, ok: false, message: `Visitors who aren't signed in can read ${anon} rows of ${t.name}.` });
    } else {
      findings.push({ table: key, ok: true, message: `${t.name}: visitors ${typeof anon === "number" ? `see ${anon}` : "are blocked"}, other users ${typeof stranger === "number" ? `see ${stranger}` : "are blocked"}.` });
    }
  }
  return { ran: true, findings };
}
