import type { SupabaseClient } from "@supabase/supabase-js";

import { addressFor, slugAttempt } from "@/lib/publish/naming";

/* Giving a project the name it will answer on.
 *
 * Reserved when a project is first BUILT rather than when it is published, and
 * that timing is the point. The name is what both of its addresses are made
 * from:
 *
 *   /quickstark-app/preview   what the owner works on
 *   /quickstark-app           what the public gets, once published
 *
 * A preview addressed by project id was 36 characters of hex that told nobody
 * anything and could not be read down a phone. Sharing the name means the
 * address a person learns while building is the address their site keeps, with
 * one word appended or removed — so publishing does not move it.
 *
 * Reserved once and then kept. Renaming a project must not move a URL people
 * have already linked to, which is why this only ever fills an empty slug.
 *
 * Needs the SERVICE client. `slug` was removed from what `authenticated` may
 * update — see supabase/schema.sql — because a browser able to write it could
 * take any address it liked and publish for nothing. */

export type Reserved =
  | { slug: string }
  /* Every reason this can fail is one a person can act on, so it is a value
     rather than an exception: the caller decides whether an address matters
     enough to stop for. On a build it does not — the page is worth having
     without one. */
  | { problem: "unusable-name" | "all-taken" | "database" };

/* How many numbered variants to try before giving up. "shop", "shop-2",
   "shop-3" … — enough that a common name still resolves, few enough that a
   pathological case cannot spin. */
const ATTEMPTS = 25;

export async function reserveSlug(
  service: SupabaseClient,
  project: { id: string; name: string; slug?: string | null },
  userId: string,
): Promise<Reserved> {
  if (project.slug) return { slug: project.slug };

  const base = addressFor(project.name, project.id);
  if (!base) return { problem: "unusable-name" };

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const candidate = slugAttempt(base, attempt);

    const { error } = await service
      .from("projects")
      .update({ slug: candidate })
      .eq("id", project.id)
      .eq("user_id", userId)
      /* Only if it is still empty. Two builds of the same project can run close
         together, and without this the second would overwrite the first's
         address with an identical-looking but differently-numbered one. */
      .is("slug", null);

    if (!error) {
      /* The update may have matched nothing — another request won the race and
         filled it first. Whatever is there now is the answer, not this. */
      const { data } = await service
        .from("projects")
        .select("slug")
        .eq("id", project.id)
        .maybeSingle();

      const settled = (data?.slug as string | null) ?? null;
      if (settled) return { slug: settled };
      continue;
    }

    /* 23505 is unique_violation: somebody else has this name, try the next.
       Anything else is a real failure and must not be retried into a loop. */
    if (error.code !== "23505") return { problem: "database" };
  }

  return { problem: "all-taken" };
}
