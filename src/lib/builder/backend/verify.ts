/* Whether a backend actually works, asked from the server.
 *
 * Linking one used to check SHAPE and nothing else: that the URL parsed and was
 * https, and that the key was an anon key rather than a service key. Both are
 * worth checking and neither is evidence that the thing exists. So a project
 * was marked connected on the strength of two regexes, and the first real test
 * was a migration inside a sixty-second build, minutes later and somewhere
 * else, where failing looks like a build problem rather than a typo.
 *
 * The browser did make a pre-flight request, and it is not the same thing. It
 * runs on the customer's network, so a corporate proxy, an ad blocker or a
 * captive portal fails it while the Supabase is perfectly reachable from where
 * it matters — and because that is a real and common false negative, the panel
 * lets the person save anyway. A check that can be overridden is a courtesy,
 * not a gate.
 *
 * This is the gate. It runs where the builds run, it asks the questions whose
 * answers actually decide whether a generated app will work, and what it finds
 * is written to project_backends.verified_at.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not write anything. A verification that created a table to prove it
 * could create tables would leave debris in somebody's database on every
 * attempt, including the failed ones, and "we made a table called
 * quickstark_probe in your production schema" is not a thing to do to somebody
 * who was checking a typo.
 */

/* Long enough for a cold Supabase project to wake up, short enough that the
   person is not left looking at a spinner wondering whether it hung. A paused
   free-tier project is the commonest slow case and it is worth waiting for,
   because the answer "it is paused" is useful and "it timed out" is not. */
const TIMEOUT_MS = 12_000;

export type Verification =
  | {
      ok: true;
      /* What this key can actually do, which is not the same as what it is
         called. Both are reported because they fail differently: a key that
         cannot read is a misconfigured project, and a key that can read
         everything is a service key in the wrong field. */
      reachable: true;
      /** PostgREST answered its own root, so the URL is a Supabase and the key is known to it. */
      authorised: true;
      /** Which schemas that key can see, where PostgREST says so. */
      schemas: string[];
    }
  | {
      ok: false;
      reachable: boolean;
      authorised: boolean;
      /** Written for the person who typed the values in, not for a log. */
      problem: string;
    };

async function ask(url: string, headers: Record<string, string>): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reaches a Supabase and reports what it found.
 *
 * Never throws. Every outcome here is something to tell somebody rather than an
 * exception to handle: a paused project, a typo'd ref, a key from a different
 * project, a network that would not answer.
 */
export async function verifyBackend(
  url: string,
  anonKey: string,
): Promise<Verification> {
  const base = url.replace(/\/+$/, "");

  /* PostgREST answers its own root with the project's OpenAPI description when
     the key is good, and 401 when it is not. One request settles reachable AND
     authorised, which is why this is the endpoint rather than a table read —
     a table read would also need a table to exist and would report a perfectly
     good connection as broken because the schema is empty. */
  const response = await ask(`${base}/rest/v1/`, {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: "application/json",
  });

  if (!response) {
    return {
      ok: false,
      reachable: false,
      authorised: false,
      problem:
        "That Supabase did not answer. It may be paused — a free project sleeps after a week — " +
        "or the project URL may have a typo in it. Open it in the Supabase dashboard and try again.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reachable: true,
      authorised: false,
      problem:
        "That Supabase answered but refused the key. The URL and the key have to come from the " +
        "SAME project — copying them from two browser tabs is how they end up mismatched.",
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      reachable: true,
      authorised: false,
      problem:
        "There is a server at that address but it is not a Supabase REST endpoint. " +
        "The URL should be the Project URL from Settings → API, with nothing after it.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reachable: true,
      authorised: false,
      problem: `That Supabase answered ${response.status}. It may still be starting up — try again in a moment.`,
    };
  }

  /* Which schemas the key is allowed to see. PostgREST advertises this in a
     header; where it does not, the absence is not a failure — older versions
     and self-hosted instances vary, and a connection that works is not going to
     be refused over a missing header. */
  const exposed = response.headers.get("content-profile") ?? response.headers.get("profile");
  const schemas = exposed
    ? exposed.split(",").map((name) => name.trim()).filter(Boolean)
    : ["public"];

  return { ok: true, reachable: true, authorised: true, schemas };
}

/**
 * Whether the schema a generated app will be pointed at is one that Supabase
 * will actually serve.
 *
 * The PGRST106 problem, asked BEFORE a build instead of discovered after one.
 * PostgREST serves only the schemas on its exposed list — `public,
 * graphql_public` by default — so an app pointed at anything else gets "The
 * schema must be one of the following" on every query, with the tables sitting
 * there perfectly well made.
 *
 * This is why a project on its OWN Supabase uses `public`: it is the one schema
 * that is exposed everywhere without anybody configuring anything.
 */
export function schemaIsServable(schema: string, exposed: readonly string[]): boolean {
  return exposed.includes(schema);
}

/** What to tell somebody whose schema will not be served, and what to do. */
export function schemaProblem(schema: string, exposed: readonly string[]): string {
  return (
    `This project's tables would live in the \`${schema}\` schema, and that Supabase only serves ` +
    `${exposed.map((name) => `\`${name}\``).join(", ")}. Every query from the built app would be refused. ` +
    `Add \`${schema}\` under Settings → API → Exposed schemas, or let the project use \`public\`.`
  );
}
