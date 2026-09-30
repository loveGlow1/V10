/* A little backend for a single page.
 *
 * "Connect a database to my landing page" used to be refused outright: a page
 * has no server, so capability-upgrade.ts said it needed rebuilding as a full
 * project. That is right for accounts, payments and uploads, and wrong for the
 * thing almost everybody on a landing page actually means — keep what people
 * type into the form. A waitlist, a contact form, an RSVP, a newsletter box.
 *
 * None of that needs a server. The page talks to the person's own Supabase
 * straight from the browser with the public key, into one table whose only
 * policy lets a visitor ADD a row. Nobody can read the rows back through that
 * key — not the next visitor, not a script scraping it — and the owner reads
 * them in their Supabase dashboard, where they already are.
 *
 * Two answers, and both are quick:
 *
 *   - no Supabase linked yet → one sentence and a button that opens the
 *     linking panel. Nothing is edited and nothing is charged.
 *   - linked → the table is made (scan, create, check, like every build) and
 *     the page editor is told exactly how to reach it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { raiseArchitecture, type ArchitectureManifest, type Layer } from "@/lib/builder/architecture";
import { resolveBackend } from "@/lib/builder/backend/connection";
import { describeProvision, provisionChecked } from "@/lib/builder/backend/provision";
import { spokenFor } from "@/lib/builder/edit-plan";
import type { DataModel } from "@/lib/builder/schema";
import { CONNECT_DATABASE_LABEL, connectDatabaseHref, isConnectDatabaseHref } from "./connect-link";

export const PAGE_TABLE = "submissions";

/* What a page can hold without a server. Kept narrow on purpose: every word
   here is a way of saying "keep what somebody typed". */
const PAGE_DATA =
  /\b(databases?|supabase|db|backend|sav(?:e|es|ing)|stor(?:e|es|ing)|collect\w*|captur\w*|submissions?|responses?|entries|leads?|wait ?lists?|wait-lists?|newsletters?|subscrib\w*|sign[ -]?ups?|signups?|contact forms?|forms?|rsvps?|bookings?|enquir\w+|inquir\w+|feedback|messages?)\b/i;

/* What a page genuinely cannot do, whatever is patched into it. Any of these
   and the existing answer stands: rebuild it as a project. */
const NEEDS_A_SERVER =
  /\b(log[ -]?ins?|sign[ -]?ins?|log[ -]?out|passwords?|accounts?|members?(?:hip)? area|my profile|user profiles?|admin|payments?|checkout|stripe|paystack|charge|uploads?|upload files?|send (?:an? )?e-?mails?|email (?:me|them)|notify me)\b/i;

/**
 * Whether this message, on a single page, is asking to keep form input.
 *
 * Reads the words rather than the layers alone because the layers are too
 * coarse here: "sign up" reaches authentication in edit-plan.ts, and on a
 * landing page "a sign-up form for the waitlist" is a row, not an account.
 */
export function isPageDataAsk(message: string, touches: readonly Layer[]): boolean {
  const asked = spokenFor(message ?? "");
  if (NEEDS_A_SERVER.test(asked)) return false;

  const deep = touches.filter((layer) => layer !== "frontend");
  /* "Make the form blue" names a form and reaches nothing. Only a message that
     reaches past the markup — or names the database outright — is asking for
     somewhere to put things. */
  const namesDatabase = /\b(databases?|supabase|db)\b/i.test(asked);
  if (deep.length === 0 && !namesDatabase) return false;

  return PAGE_DATA.test(asked);
}

/** The one table a single page gets. */
export function pageDataModel(schema: string): DataModel {
  return {
    schema,
    buckets: [],
    tables: [
      {
        name: PAGE_TABLE,
        what: "What visitors sent through this page's forms. Visitors can add a row and can never read one back; the owner reads them in the Supabase dashboard.",
        columns: [
          { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          /* Which form on the page, so one table serves a waitlist and a
             contact form side by side. */
          { name: "form", type: "text", default: "'contact'", check: "char_length(form) between 1 and 60" },
          { name: "email", type: "text", nullable: true, check: "email is null or char_length(email) <= 320" },
          { name: "name", type: "text", nullable: true, check: "name is null or char_length(name) <= 200" },
          {
            name: "message",
            type: "text",
            nullable: true,
            check: "message is null or char_length(message) <= 5000",
          },
          /* Anything else the form asks for — a phone number, a date, a choice. */
          {
            name: "data",
            type: "jsonb",
            default: "'{}'::jsonb",
            check: "pg_column_size(data) <= 16000",
          },
        ],
        indexes: [{ on: ["form", "created_at"] }],
        policies: [
          {
            name: "submissions_insert_visitor",
            for: "insert",
            to: ["anon", "authenticated"],
            check: "true",
            why: "Anybody on the page can send the form. The size limits on each column are what stop one visitor filling the table; there is deliberately no read policy, so nothing sent can be read back through the public key.",
          },
        ],
      },
    ],
  };
}

export { CONNECT_DATABASE_LABEL, connectDatabaseHref, isConnectDatabaseHref };

/** What the page editor is told, once the table exists. */
export function pageDataBrief(input: { url: string; anonKey: string; schema: string }): string {
  return [
    "THIS PAGE NOW HAS A DATABASE — the owner's own Supabase, already connected and ready.",
    "Wire the form(s) the request is about to it. Do not invent any other backend, endpoint or service.",
    "",
    "How, exactly:",
    '- Load the client once, before </body>: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
    `- Create it once: const db = window.supabase.createClient(${JSON.stringify(input.url)}, ${JSON.stringify(input.anonKey)}${
      input.schema === "public" ? "" : `, { db: { schema: ${JSON.stringify(input.schema)} } }`
    });`,
    `- On submit: preventDefault, then await db.from(${JSON.stringify(PAGE_TABLE)}).insert({ form, email, name, message, data }).`,
    "  form: a short name for which form this is (\"waitlist\", \"contact\", \"rsvp\"). email, name, message: strings or null.",
    "  data: an object holding every other field the form asks for. Only these five keys exist.",
    "- Never chain .select() after the insert, and never read the table: visitors may add rows but not read them, so a read fails by design.",
    "- While sending, disable the button and show that it is sending. On success, replace the form with a short thank-you. On error, keep what they typed and show a one-line message to try again.",
    "- Use required and type=\"email\" on inputs so bad input is caught before it is sent.",
    "- The key in that call is the PUBLIC key and belongs in the page. Do not put any other key anywhere.",
  ].join("\n");
}

export type PageData =
  | { kind: "needs-link"; said: string; links: { label: string; href: string }[] }
  | { kind: "failed"; said: string }
  | { kind: "ready"; brief: string; said: string; note: string };

/**
 * Makes a single page able to keep what its forms collect.
 *
 * Never throws. Nothing is written anywhere until a linked Supabase is found,
 * and then only this project's one table — scanned first, like every build, so
 * a `submissions` table of theirs is never touched.
 */
export async function preparePageData(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    current: ArchitectureManifest | null;
    projectName: string;
    stack: string | null;
  },
): Promise<PageData> {
  const backend = await resolveBackend(service, input.projectId);

  if (!backend || backend.mode !== "own" || !backend.url || !backend.anonKey) {
    return {
      kind: "needs-link",
      said:
        "Happy to — this page can save what people send straight into your own Supabase. " +
        "Connect your database first (it takes a few seconds), then send your message again and I'll wire it up.",
      links: [{ label: CONNECT_DATABASE_LABEL, href: connectDatabaseHref(input.projectId) }],
    };
  }

  const synced = await provisionChecked({
    service,
    connection: backend,
    model: pageDataModel(backend.schema),
    projectId: input.projectId,
    userId: input.userId,
    projectName: input.projectName,
  });

  if (!synced.outcome.applied) {
    return {
      kind: "failed",
      said:
        `I couldn't set up the table in your Supabase, so I've left the page as it is. ${describeProvision(synced.outcome)}`.trim(),
    };
  }

  /* Recorded so the next edit is planned against a page that has a database,
     and the Database panel shows it. */
  if (input.current) {
    const { manifest, added } = raiseArchitecture(input.current, ["database"]);
    if (added.length > 0) {
      const { error } = await service.from("project_architecture").upsert(
        {
          project_id: input.projectId,
          user_id: input.userId,
          kind: manifest.type,
          manifest,
          stack: input.stack,
        },
        { onConflict: "project_id" },
      );
      if (error) {
        // eslint-disable-next-line no-console
        console.error("page-data: the architecture was not recorded:", error.message);
      }
    }
  }

  const schema = synced.connection.schema;
  const where = schema === "public" ? PAGE_TABLE : `${schema}.${PAGE_TABLE}`;
  return {
    kind: "ready",
    brief: pageDataBrief({ url: backend.url, anonKey: backend.anonKey, schema }),
    said: `Connected to your Supabase — what people send will land in the \`${where}\` table (Table Editor in your Supabase dashboard).`,
    note: [describeProvision(synced.outcome), synced.check?.summary].filter(Boolean).join(" · "),
  };
}
