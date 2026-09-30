/* Adding a capability to a project that already exists.
 *
 * Capability was decided once, at build time, and could not change afterwards.
 * planEdit could work out perfectly well that "add customer accounts" reaches
 * the authentication, backend and database layers — it has done that since it
 * was written — and then nothing acted on it: the edit changed some markup, the
 * manifest still said `authentication: false`, no schema was ever created, and
 * every later edit was planned against a record that was now wrong.
 *
 * So the only route to a capability the first build missed was a new build,
 * which discards the page. That is the real reason this system leans toward
 * giving every project everything up front — guessing low was unrecoverable —
 * and it is why making this additive matters more than it looks. Fix the
 * ratchet and the pressure to over-provision goes with it.
 *
 * ── What this deliberately will not do ────────────────────────────────────
 *
 * It never removes a layer. A later message that does not mention the database
 * is not a request to delete it; somebody's tables, rows and auth users are not
 * something a regex over one sentence gets to decide about.
 *
 * And it refuses rather than pretending when the upgrade is not an edit at all.
 * A single-page project has no server, no environment and no build step, so
 * "add accounts" to one cannot be done by patching it — the honest answer is
 * that it needs rebuilding as a project, said before anything is spent, rather
 * than a sign-in form that looks right and cannot work.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ArchitectureManifest,
  type Layer,
  describeUpgrade,
  raiseArchitecture,
} from "@/lib/builder/architecture";
import { resolveBackend } from "@/lib/builder/backend/connection";
import { describeProvision, provisionChecked } from "@/lib/builder/backend/provision";
import { dataModelFor, schemaNameFor } from "@/lib/builder/schema";

export type Upgrade =
  /* Nothing to do — the commonest answer by far. Most edits are about markup
     and reach no layer the project does not already have. */
  | { kind: "none" }
  /* The layers changed and the infrastructure was brought up to meet them. */
  | {
      kind: "raised";
      manifest: ArchitectureManifest;
      added: Layer[];
      said: string;
      /* Whether the migration actually applied. Separate from `added` because
         they genuinely differ: the manifest says what this project now IS, and
         this says whether its tables are there yet. A build that reported the
         first as the second would be stating an intention as a fact. */
      provisioned: boolean;
      provisionNote: string;
      /** A database is now needed and none is linked — offer the button that links one. */
      needsLink: boolean;
    }
  /* The upgrade cannot be an edit. See the header — a page has nowhere to put
     a session. */
  | { kind: "needs-rebuild"; added: Layer[]; said: string };

/**
 * Brings a project's infrastructure up to what an edit needs.
 *
 * Called before the model writes anything, so the change is made against a
 * database that exists rather than against one the prompt hopes for — the same
 * ordering the build path uses, and for the same reason.
 *
 * Never throws. Every failure inside provisioning is already survivable there
 * and stays survivable here: a project whose schema is pending is still worth
 * editing, and the reason travels back in `provisionNote` rather than stopping
 * the edit somebody asked for.
 */
export async function upgradeCapabilities(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    /** What the project is today. Null for anything built before the manifest existed. */
    current: ArchitectureManifest | null;
    /** Which layers this edit reaches — planEdit's `touches`. */
    touches: readonly Layer[];
    /** "standalone-html" or "nextjs", as project_architecture recorded it. */
    stack: string | null;
    /** Only used to name a schema of its own readably, if one is needed. */
    projectName?: string;
  },
): Promise<Upgrade> {
  if (!input.current) return { kind: "none" };

  const { manifest, added } = raiseArchitecture(input.current, input.touches);
  if (added.length === 0) return { kind: "none" };

  /* A page cannot hold a session, a row or a second route, whatever is patched
     into it. Said before anything is spent. */
  const needsServer = added.some((layer) => layer !== "frontend");
  if (needsServer && input.stack === "standalone-html") {
    return {
      kind: "needs-rebuild",
      added,
      said:
        `That means ${describeUpgrade(added)}, and this project is a single page — there is no server behind it, ` +
        `so a sign-in or a saved record cannot actually work here however it is written. ` +
        `Ask me to rebuild it as a full project and it will have all of that properly. ` +
        `The page you have now stays until you do.`,
    };
  }

  /* Recorded before the schema is applied, deliberately. If provisioning fails
     the project has still CHANGED — the next edit must be planned against a
     project that has authentication, whether or not its tables landed yet —
     and a manifest written only on success would leave the two disagreeing. */
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
    console.error("upgrade: the architecture was not recorded:", error.message);
  }

  /* The tables, if this upgrade needs any. dataModelFor answers with none for a
     manifest with no database, so the call is safe either way and the branch is
     about not opening a connection for nothing. */
  let provisioned = false;
  let provisionNote = "";
  let needsLink = false;

  if (manifest.database) {
    const backend = await resolveBackend(service, input.projectId);
    if (backend) {
      const model = dataModelFor(manifest, backend.schema ?? schemaNameFor(input.projectId));
      if (model.tables.length > 0) {
        /* Scan, create, check — the same as a build, so an upgrade on somebody's
           own Supabase never lands on a table of theirs either. */
        const synced = await provisionChecked({
          service,
          connection: backend,
          model,
          projectId: input.projectId,
          userId: input.userId,
          projectName: input.projectName ?? "",
        });
        provisioned = synced.outcome.applied === true;
        provisionNote = [describeProvision(synced.outcome), synced.check?.summary].filter(Boolean).join(" · ");
      }
    } else {
      provisionNote = "no database is connected to this project yet, so its tables are pending — connect yours and they'll be created on the next change";
      needsLink = true;
    }
  }

  return {
    kind: "raised",
    manifest,
    added,
    provisioned,
    provisionNote,
    needsLink,
    said: provisioned
      ? `That means ${describeUpgrade(added)} — ${provisionNote}.`
      : `That means ${describeUpgrade(added)}${provisionNote ? ` — ${provisionNote}` : ""}.`,
  };
}
