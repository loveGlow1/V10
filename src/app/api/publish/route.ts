import { NextResponse } from "next/server";

import { canAfford, creditCostOf, formatCredits, roundCredits } from "@/app/dashboard/credits";
import { envFor, resolveBackend } from "@/lib/builder/backend/connection";
import { blocking, inspectStructure, repairStructure } from "@/lib/builder/next-structure";
import { loadTree } from "@/lib/builder/store-tree";
import { validatePage } from "@/lib/builder/validate";
import { diagnoseFindings } from "@/lib/publish/diagnosis";
import { existingVercelProject, recordDeployment } from "@/lib/publish/deployment-store";
import {
  appDomainFor,
  attachProjectDomain,
  deploymentName,
  deploymentsConfigured,
  publicAddress,
  startDeployment,
  vercelCredentials,
} from "@/lib/publish/vercel-deploy";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { previewUrl, publishedUrl, slugIsUsable } from "@/lib/publish/naming";
import { configureAuth } from "@/lib/builder/backend/managed";
import { reserveSlug } from "@/lib/publish/reserve";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Making a project live.
 *
 * The rule the whole route is built around: a project is marked Published when
 * it IS published, and at no earlier point. Every failure below leaves the
 * project exactly as it was — including a project that was already live, which
 * keeps serving the version it was serving.
 *
 * ── Why this does not create a Vercel deployment ──────────────────────────
 *
 * A project here is one HTML document. Giving each one its own Vercel project
 * and deployment would mean a per-user entry against this account's project
 * limit, thirty to sixty seconds of waiting, and a publish that can fail in the
 * middle for reasons nobody involved can act on.
 *
 * Publishing instead writes an immutable copy of the document and points the
 * project at it. It is one transaction, it takes milliseconds, and it cannot
 * half-succeed — which is not a shortcut but the strongest possible answer to
 * "never falsely mark a project as Published". Vercel is still what serves it:
 * this app runs there, and the published page is served by the route beside
 * this one. Where Vercel's API is genuinely needed — a customer's own domain,
 * and the certificate for it — it is used, in lib/publish/vercel-domains.ts.
 *
 * ── Why the document is copied rather than referenced ─────────────────────
 *
 * Because preview and production have to be separate, and a pointer at "the
 * newest build" is not separate at all — it would put every edit live the
 * instant it applied, and publishing would mean nothing. The copy is what makes
 * editing safe after launch. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A read, a validate and two writes for a page, which waits on nothing.
   Publishing a PROJECT also uploads it to Vercel — started, never waited for,
   so this is still a handful of API calls rather than a build. */
export const maxDuration = 60;

type Body = { projectId?: unknown };

function fail(message: string, status: number, stage: string) {
  return NextResponse.json({ error: message, stage, published: false }, { status });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Publishing is unavailable — this workspace has no Supabase configured.", 503, "config");

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Sign in to publish.", 401, "auth");

  const body = (await request.json().catch(() => ({}))) as Body;
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (!projectId) return fail("No project was named.", 400, "request");

  /* ── Validate the project ────────────────────────────────────────────────
     Read under the caller's session, so RLS answers "is this yours" and a
     project id belonging to somebody else simply is not found. */
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, slug, status, deleted_at, published_version_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return fail("That project could not be found.", 404, "validate");
  if (project.deleted_at) return fail("That project has been deleted.", 410, "validate");

  const { data: build } = await supabase
    .from("project_builds")
    .select("id, html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!build?.html) {
    return fail("There's nothing to publish yet — build the page first.", 422, "validate");
  }

  /* ── Which of the two things is being published ─────────────────────────
   *
   * A project with stored files is a Next.js application and publishing it
   * means DEPLOYING it: there is no single document to snapshot, and the one
   * sitting in `build.html` for such a build is the summary this platform
   * writes for it. Publishing that would have put a receipt — "a web app built
   * as a Next.js project, 19 files" — at the customer's public address and
   * called it their site. That is what "the publish button does not work"
   * was.
   *
   * A build with no files is the single-page stack, and everything below it is
   * the snapshot that has always been right for it. The two pipelines stay
   * separate all the way to the end, which is the point. */
  const tree = await loadTree(supabase, build.id as string);
  const isProject = tree.length > 0;

  /* The same check an edit has to pass before it is stored, applied again here
     against nothing. A page can only reach this table by passing it, so this is
     belt and braces — but it is the last gate before something becomes public,
     and a structurally broken page going live is worse than one stored.
     
     Asked of a PAGE only. A project's stored document is a summary rather than
     the thing being published, so this would be checking the receipt. */
  if (!isProject) {
    const verdict = validatePage("", build.html as string);
    if (!verdict.ok) {
      return fail(`That page isn't ready to publish — ${verdict.problem}.`, 422, "validate");
    }
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return fail("Publishing is unavailable — this workspace has no service key set.", 503, "config");
  }

  /* ── The price ───────────────────────────────────────────────────────────
   *
   * Two flat prices, and which one applies is read from the project rather than
   * from anything the caller sent: a project that is already live pays the
   * redeploy price. See creditCostOf — no model runs during a publish, so
   * nothing about the page can move it off its advertised price.
   *
   * Checked BEFORE anything is published, which is the whole reason this is
   * here rather than only after. A publish is the largest single charge on the
   * platform, and somebody who cannot afford it should be told while nothing
   * has happened — not shown a live URL and a negative balance. */
  const alreadyPublished = Boolean(project.published_version_id);
  const cost = roundCredits(creditCostOf("publish", { alreadyPublished }));

  const balance = await currentBalance(service, user.id);
  if (balance && !canAfford(balance, cost)) {
    return fail(
      `Publishing costs ${formatCredits(cost)} credits and there aren't enough on the account. Top up and it will go straight out.`,
      402,
      "credits",
    );
  }

  /* ── The address ─────────────────────────────────────────────────────────
     Usually already there: it is reserved on the first build, so both the
     preview and the published site are named the same thing and publishing
     moves no URL. Only a project built before that behaviour existed reaches
     the reservation here. */
  const reserved = await reserveSlug(service, { id: projectId, name: project.name as string, slug: project.slug as string | null }, user.id);

  if ("problem" in reserved) {
    return fail(
      reserved.problem === "unusable-name"
        ? "That project's name can't be turned into a web address. Rename it and try again."
        : reserved.problem === "all-taken"
          ? "Every address close to that name is taken. Rename the project and try again."
          : "The web address couldn't be reserved. Try again in a moment.",
      reserved.problem === "database" ? 502 : 422,
      "address",
    );
  }

  const slug = reserved.slug;

  /* ── The address a recovery email should point at, now that it is final ──
   *
   * configureAuth set site_url when the database was provisioned, from
   * whatever slug the project had then. Publishing is when that address stops
   * being provisional: reserveSlug above may have qualified or changed it, and
   * from here on this is the site whose users will be resetting passwords.
   *
   * A wildcard cannot do this job. The redirect allow-list is wildcarded and
   * covers every address already — site_url is a single value, the default
   * landing place when a link carries no redirectTo of its own, and password
   * recovery is exactly that case. Wrong here means a reset link to somebody
   * else's address, or to localhost.
   *
   * Managed only, and quietly: a project on somebody's own Supabase is theirs
   * to configure, and a publish must never fail because an auth setting did
   * not take. */
  {
    const backend = await resolveBackend(service, projectId);
    if (backend?.mode === "quickstark_managed" && backend.managedRef) {
      const auth = await configureAuth(backend.managedRef, publishedUrl(slug));
      if (!auth.ok) {
        // eslint-disable-next-line no-console
        console.error(
          `publish: ${projectId} went live and its auth site_url did not follow: ${auth.reason}`,
        );
      }
    }
  }

  /* ── Putting a PROJECT online ────────────────────────────────────────────
   *
   * Everything above applies to both stacks — ownership, price, balance, the
   * address. This is the half that only a Next.js project has, and it happens
   * BEFORE the snapshot and before the project is marked live, so the rule the
   * top of this file is built around still holds: a project is marked
   * Published when it IS published, and a deployment that could not be started
   * leaves it exactly as it was.
   *
   * Nothing is charged here either. The balance was checked above and the
   * charge is taken after the pointer flips, which is the same order the page
   * path uses and for the same reason. */
  let liveUrl: string | null = null;
  /* Kept apart on purpose. `publishedAddress` is ours and is what the customer
     is shown; `hostedUrl` is Vercel's and is what this platform falls back to
     when the wildcard is not configured. Collapsing the two is what put a
     hosting provider's URL in front of a customer. */
  let publishedAddress: string | null = null;
  let hostedUrl: string | null = null;
  let deployment: { id: string; vercelProject: string; url: string; inspect: string | null } | null = null;

  if (isProject) {
    if (!deploymentsConfigured()) {
      return fail(
        "Publishing applications is not switched on for this installation of QuickStark yet — it has no Vercel API token.",
        503,
        "config",
      );
    }

    /* The same structural gate the deploy route applies, for the same reason:
       every rule in it is one `next build` enforces, so anything blocking here
       is a deployment that WILL fail. Repaired first, because the defect with
       exactly one correct fix should not cost somebody a publish. */
    const { tree: sound } = repairStructure(tree);
    const stopping = blocking(inspectStructure(sound));
    if (stopping.length > 0) {
      const diagnosis = diagnoseFindings(stopping);
      return NextResponse.json(
        {
          error: diagnosis?.summary ?? "This project needs attention before it can go live.",
          diagnosis,
          stage: "validate",
          published: false,
        },
        { status: 422 },
      );
    }

    const backend = await resolveBackend(service, projectId);
    const env = backend ? envFor(backend) : null;
    const vercelProject =
      (await existingVercelProject(service, projectId)) ??
      deploymentName(project.name as string, projectId);

    const started = await startDeployment(sound, {
      name: vercelProject,
      supabaseUrl: env?.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: env?.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseSchema: env?.NEXT_PUBLIC_SUPABASE_SCHEMA,
    });

    if (!started.ok) {
      return fail(
        `That couldn't be put online just now — ${started.reason}. Nothing has changed.`,
        502,
        "deploy",
      );
    }

    deployment = {
      id: started.deploymentId,
      vercelProject,
      url: started.url,
      inspect: started.inspect,
    };
    /* Derived rather than taken, so a per-deployment host — which is behind
       Deployment Protection and renders unstyled — can never be handed over as
       somebody's live address. See publicAddress. */
    hostedUrl = publicAddress(started.url, vercelProject);

    /* ── The address the customer is actually given ──────────────────────
     *
     * `<slug>.quickstark.tech`. Until now this route handed back whatever
     * publicAddress derived, which is a vercel.app hostname — so the link on
     * the Publish button was our hosting provider's, and when the derived name
     * was not the one Vercel had actually assigned, that link opened Vercel's
     * own "deployment not found" page instead of the customer's site. A
     * publish is the one moment this product is judged on, and it was pointing
     * outside the product.
     *
     * Bound HERE rather than only in settle.ts, and that is the whole of the
     * change. Binding is what makes the address exist, settling is what
     * confirms it answers, and the two were the same step — so the address was
     * knowable only after a cron had run, which is minutes after the person
     * pressed the button and left. A project domain follows the project's
     * newest production deployment on its own, so binding it before the build
     * finishes is correct: it starts answering the moment there is something
     * behind it, with nothing to re-run.
     *
     * Best effort, exactly as it is in settle.ts. `*.quickstark.tech` has to be
     * a verified wildcard on the Vercel account with its DNS pointed at Vercel,
     * and where it is not, this is refused and the vercel.app address is what
     * the customer gets. A plainer address is a far smaller failure than a
     * publish that did not happen, so nothing below is allowed to fail one. */
    const wanted = appDomainFor(slug);
    const creds = vercelCredentials();

    if (wanted && creds) {
      try {
        const bound = await attachProjectDomain(vercelProject, wanted, creds);
        if (bound.ok) publishedAddress = `https://${wanted}`;
        else {
          // eslint-disable-next-line no-console
          console.warn(`publish: ${wanted} could not be bound: ${bound.reason}`);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("publish: binding the address failed:", error);
      }
    }

    liveUrl = publishedAddress ?? hostedUrl;
  }

  /* ── The snapshot ────────────────────────────────────────────────────────
     Written before the project is marked published, so the pointer can never
     name a row that does not exist. */
  const { data: previous } = await service
    .from("project_publications")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = ((previous?.version as number | undefined) ?? 0) + 1;

  const { data: publication, error: snapshotError } = await service
    .from("project_publications")
    .insert({
      project_id: projectId,
      user_id: user.id,
      build_id: build.id,
      html: build.html,
      version,
    })
    .select("id, version, published_at")
    .single();

  if (snapshotError || !publication) {
    /* Nothing has changed. A project that was live is still live on its old
       version, and one that was not is still not published. */
    // eslint-disable-next-line no-console
    console.error("publish: the snapshot could not be written:", snapshotError);
    return fail("That couldn't be published just now. Nothing has changed — try again.", 502, "snapshot");
  }

  /* The deployment, against the publication it belongs to. After the snapshot
     because a deployment record names a build and a project that exist, and
     best effort because the site is already going up either way — a record
     that fails to write costs the workspace its address, not the customer
     their site. */
  if (deployment) {
    try {
      await recordDeployment(service, {
        projectId,
        userId: user.id,
        buildId: build.id as string,
        deploymentId: deployment.id,
        vercelProject: deployment.vercelProject,
        url: deployment.url,
        inspectUrl: deployment.inspect,
      });
      await service
        .from("project_builds")
        .update({ deployment_url: liveUrl, deployment_error: null })
        .eq("id", build.id);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("publish: the deployment could not be recorded:", error);
    }
  }

  /* ── Live ────────────────────────────────────────────────────────────────
     The last write, and the only one that makes anything public.

     `published_url` and `deployment_status` are written here and `preview_url`
     is not, which is the rule rather than an omission. The preview address is
     where this project is EDITED — private, owner-only, and still the right
     answer after a publish — and the published address is where the world sees
     it. Writing the second over the first is what made "Preview" and "Publish"
     open the same thing, and it is why a deployment URL must never be allowed
     near that column.

     A deployment is `building` at this point and not a moment sooner: the
     upload has been accepted and nothing has compiled. settle.ts moves it to
     `deployed` or `failed` once Vercel has an answer. A page publish has no
     build at all, so it is `deployed` the moment it is written. */
  const { error: liveError } = await service
    .from("projects")
    .update({
      published_version_id: publication.id,
      published_at: publication.published_at,
      status: "Published",
      published_url: liveUrl ?? publishedUrl(slug),
      deployment_status: deployment ? "building" : "deployed",
    })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (liveError) {
    /* The snapshot exists and nothing points at it, which is harmless — it is
       a version in the history that was never served. The project is untouched,
       so this is reported as the failure it is rather than as a publish. */
    // eslint-disable-next-line no-console
    console.error("publish: the project could not be marked live:", liveError);
    return fail("That couldn't be made live just now. Nothing has changed — try again.", 502, "live");
  }

  /* ── Charged, after it is live ───────────────────────────────────────────
   *
   * This order round on purpose. The page is public the moment the pointer
   * flips, and a charge taken before that could be taken for a publish that
   * then failed — money for nothing, which is the worse of the two ways to be
   * wrong. The balance was checked above, so the only path that reaches here
   * unpaid is the credit ledger itself failing, and that is logged rather than
   * used to take a live site back down.
   *
   * The dedupe key is the publication, not the request: two tabs pressing
   * Publish produce two publications and two charges, which is correct, while a
   * retried request that reuses a publication is charged once. */
  const charge = await chargeCredits(service, {
    userId: user.id,
    action: "publish",
    cost,
    description: alreadyPublished
      ? `Redeploy: ${project.name} (v${publication.version})`
      : `Publish: ${project.name}`,
    projectId,
    dedupeKey: `publish:${publication.id}`,
  });

  if (!charge) {
    // eslint-disable-next-line no-console
    console.error(`publish: ${projectId} v${publication.version} went live but could not be charged`);
  }

  const charged = charge?.charged ?? 0;

  return NextResponse.json({
    published: true,
    /* THE CUSTOMER-FACING PRODUCT URL, and the only thing in this reply that
       is allowed to be one. `<slug>.quickstark.tech` where the wildcard is
       configured; the platform's own path address for a page; and Vercel's
       hostname only where neither of ours exists, because an address somebody
       can open beats a prettier one that does not resolve. */
    url: liveUrl ?? publishedUrl(slug),
    /* Where this project is EDITED, which is not where it is published and
       never was. This field carried `publishedUrl(slug)` — the public address
       under the name `previewUrl` — so anything reading it for a preview link
       sent the owner to their own live site and the two became the same button.
       It is the preview route now, which is what its name says. */
    previewUrl: previewUrl({ id: projectId, slug }),
    /* Where Vercel is hosting it, for support and for nothing else. Never
       shown as the address of somebody's site: see the note above liveUrl. */
    hostedUrl,
    kind: isProject ? "project" : "page",
    building: Boolean(deployment),
    slug,
    version: publication.version,
    publishedAt: publication.published_at,
    /* True when this replaced a version that was already live, which is what
       decides whether the reply says "published" or "updated". */
    replaced: alreadyPublished,
    charged,
  });
}

/**
 * Changes the address a published project answers on.
 *
 * Separate from publishing on purpose. An address is derived once from the
 * project's name and then kept, because a published URL is something people
 * have linked to — but "derived once" is only defensible if it can also be
 * chosen. A name that is reserved, or simply wrong six months later, would
 * otherwise be permanent.
 *
 * Changing it BREAKS THE OLD ADDRESS. Nothing redirects: the old slug becomes
 * free for anyone else the moment it is released, so a redirect would be a
 * promise this cannot keep. The caller is told, and it is their decision.
 */
export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Publishing is unavailable.", 503, "config");

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Sign in first.", 401, "auth");

  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown; slug?: unknown };
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const wanted = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!projectId) return fail("No project was named.", 400, "request");

  if (!wanted) return fail("Enter the address you want.", 400, "address");
  if (!slugIsUsable(wanted)) {
    /* One sentence covering every way a label can be wrong, because the rules
       are not worth teaching: what somebody needs is the shape that works. */
    return fail(
      "That address can't be used. Letters, numbers and hyphens, at least three characters, and not a word we keep for the platform itself — like www, api or quickstark.",
      422,
      "address",
    );
  }

  const service = createSupabaseServiceClient();
  if (!service) return fail("Publishing is unavailable.", 503, "config");

  /* The unique index settles it, as it does on the first publish. Checking
     first and then writing would be two answers to one question with a gap
     between them. */
  const { error } = await service
    .from("projects")
    .update({ slug: wanted })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (error) {
    if (error.code === "23505") {
      return fail("That address is already taken. Try another.", 409, "address");
    }
    return fail("That address couldn't be saved. Try again.", 502, "address");
  }

  return NextResponse.json({ slug: wanted, url: publishedUrl(wanted) });
}

/**
 * Puts an earlier published version back.
 *
 * The history has always been there. Every publish writes an immutable
 * `project_publications` row with a version number, and `published_version_id`
 * is a pointer at one of them — so "go back to last Tuesday's" has been one
 * UPDATE away since publishing was written, and there was no way to ask for it.
 * Somebody who published a bad edit could unpublish, or publish again over the
 * top; neither of those is what they wanted.
 *
 * It is a pointer move and nothing else: the snapshot is not copied, nothing
 * is regenerated, and no model runs. So it is FREE, and that is a decision
 * rather than an oversight — a rollback is the customer correcting something
 * we served them, and charging for it would be charging for our own mistake.
 *
 * The newer versions stay. Rolling back is "serve this one", not "destroy the
 * ones after it", and rolling forward again is the same call with a different
 * number.
 */
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Publishing is unavailable.", 503, "config");

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Sign in first.", 401, "auth");

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: unknown;
    version?: unknown;
  };
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (!projectId) return fail("No project was named.", 400, "request");

  const service = createSupabaseServiceClient();
  if (!service) return fail("Publishing is unavailable.", 503, "config");

  /* Read under the caller's own session, so RLS answers whether this project is
     theirs before the service key is used to move anything. */
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, published_version_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return fail("That project could not be found.", 404, "validate");
  if (!project.published_version_id) {
    return fail("That project isn't published, so there's nothing to roll back to.", 409, "validate");
  }

  /* Which version. Named explicitly, or the one before whatever is live —
     "put it back" is the request people actually have, and making them look up
     a number first is asking them to do the system's job. */
  const wanted = typeof body.version === "number" ? body.version : null;

  const { data: versions } = await service
    .from("project_publications")
    .select("id, version, published_at")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(50);

  const history = (versions ?? []) as { id: string; version: number; published_at: string }[];
  const liveAt = history.findIndex((entry) => entry.id === project.published_version_id);

  const target =
    wanted !== null
      ? history.find((entry) => entry.version === wanted)
      : history[liveAt >= 0 ? liveAt + 1 : 1];

  if (!target) {
    return fail(
      wanted !== null
        ? `There's no version ${wanted} of this project.`
        : "This is the first version that was published, so there's nothing behind it.",
      404,
      "validate",
    );
  }

  if (target.id === project.published_version_id) {
    return fail("That version is already the one being served.", 409, "validate");
  }

  const { error } = await service
    .from("projects")
    .update({ published_version_id: target.id, published_at: target.published_at })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (error) {
    /* Nothing moved. The version that was live is still live, which is the
       safe half of failing here. */
    // eslint-disable-next-line no-console
    console.error("publish: the rollback could not be applied:", error);
    return fail("That couldn't be rolled back just now. Nothing has changed — try again.", 502, "live");
  }

  return NextResponse.json({
    published: true,
    rolledBack: true,
    version: target.version,
    publishedAt: target.published_at,
    /* What they can go back to from here, so the interface does not have to
       ask a second time to draw the control. */
    versions: history.map((entry) => ({ version: entry.version, publishedAt: entry.published_at })),
  });
}

/** Takes a project off the web, leaving its history intact. */
export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fail("Publishing is unavailable.", 503, "config");

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Sign in first.", 401, "auth");

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return fail("No project was named.", 400, "request");

  const service = createSupabaseServiceClient();
  if (!service) return fail("Publishing is unavailable.", 503, "config");

  /* The publications stay. Unpublishing is "stop serving this", not "destroy
     what was served" — and re-publishing should be able to say which version
     is going back up. */
  const { error } = await service
    .from("projects")
    .update({ published_version_id: null, published_at: null, status: "Built" })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (error) return fail("That couldn't be taken down just now. Try again.", 502, "live");

  return NextResponse.json({ published: false });
}
