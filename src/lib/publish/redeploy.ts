/* Whether a change to a project should go online by itself.
 *
 * Until now the answer was always yes, and that was the bug. Every build and
 * every edit uploaded the project to Vercel — a landing page somebody was still
 * deciding the colour of, a half-finished admin screen, a tree that would not
 * compile — and the deployment was on the critical path of the experience: the
 * only way to SEE what had been generated was to wait for a production build of
 * it, and the only account of a failure was that build's log.
 *
 * That is backwards in three separate ways.
 *
 *   It spends a production deployment on every keystroke's worth of work.
 *   Most builds are not the finished thing; a customer builds, looks, changes
 *   their mind and builds again. Deploying all of those is a queue of
 *   deployments nobody asked for, each of which can fail on its own.
 *
 *   It makes a failure look like a broken product. A deployment that does not
 *   compile puts a build log in front of somebody whose project is fine —
 *   fine, and now apparently broken, because the technical failure had taken
 *   the place of the preview.
 *
 *   It publishes work nobody said to publish. A project that has never been
 *   live has never been shown to anybody, and putting it at a public address
 *   because somebody pressed send in a chat is a decision the customer did not
 *   make.
 *
 * So the rule is the one a person would expect: BUILDING IS NOT PUBLISHING.
 * Generating and editing happen in the builder, where the preview renders the
 * project from source and costs nothing (see lib/builder/preview). Deploying
 * happens when somebody asks for it.
 *
 * ── The one case that stays automatic ─────────────────────────────────────
 *
 * A project that is ALREADY LIVE. Somebody who published their site and then
 * asked for a change expects the change to reach the site — leaving the old
 * version serving while the new one sits in the database would be its own kind
 * of lie, and worse than the problem being fixed here, because the customer
 * believes their edit is live and it is not. So an edit to a published project
 * redeploys it, and an edit to an unpublished one does not.
 *
 * That is exactly the third of the three cases the specification allows, and
 * the reason this is a function rather than a boolean: the question "is this
 * project live" has two different answers in this codebase depending on which
 * publishing route put it there, and every caller needs both.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isPublishedProject, type PublishState } from "@/lib/project-status";

/** Why a deployment did or did not happen, for the step list and the thread. */
export type DeployDecision = {
  deploy: boolean;
  /** A sentence, when there is something worth saying. Null when there is not. */
  because: string | null;
};

/**
 * Whether an edit to this project should go online without being asked to.
 *
 * Two ways a project can be live, and they do not overlap:
 *
 *   `published_at` is the single-page publishing route, which serves a snapshot
 *   from this platform. project-status.ts owns that answer and explains at
 *   length why the build status is not it.
 *
 *   A build row carrying `deployment_url` is the Next.js route, which hosts on
 *   Vercel. A project can have this and no `published_at` at all — the deploy
 *   button never touched the publish flow — so reading only the first would
 *   quietly stop redeploying every application on the platform.
 *
 * Reads rather than guesses, and takes the service client because the caller
 * has already settled ownership.
 */
export async function shouldRedeploy(
  service: SupabaseClient,
  projectId: string,
  project: PublishState | null | undefined,
): Promise<DeployDecision> {
  if (isPublishedProject(project)) {
    return { deploy: true, because: "this project is live, so the change goes to the site too" };
  }

  const { data } = await service
    .from("project_builds")
    .select("deployment_url")
    .eq("project_id", projectId)
    .not("deployment_url", "is", null)
    .limit(1)
    .maybeSingle<{ deployment_url: string | null }>();

  if (data?.deployment_url) {
    return { deploy: true, because: "this project is live, so the change goes to the site too" };
  }

  /* Said plainly rather than left silent. Somebody who has been watching every
     build deploy itself needs to be told that this one did not, and told where
     the button is — otherwise the improvement reads as a regression. */
  return {
    deploy: false,
    because: "not published yet — your preview is up to date, and Publish puts it online",
  };
}

/**
 * The same question for a project that is being built for the first time.
 *
 * Always no. A project that has just come into existence cannot be live, so
 * there is nothing to keep current and nothing for a deployment to do except
 * cost a minute and a possible failure. It is a separate function rather than a
 * call to the one above with a null row because it takes no query to answer and
 * a round trip to the database to return a constant is worth not writing.
 */
export function shouldDeployFirstBuild(): DeployDecision {
  return {
    deploy: false,
    because: "built and ready to look at — press Publish when you want it online",
  };
}
