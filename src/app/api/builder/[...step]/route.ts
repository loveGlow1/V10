import { NextResponse } from "next/server";

/* A stand-in for the provisioning service the orchestrator's branches call.
 *
 * The four HTTP Request nodes in the n8n workflow — Scaffold Next.js App, Apply
 * Supabase Schema, Provision WordPress Site, Register Store Webhooks — point at
 * a service that does not exist yet. Until it does, every build comes back
 * Failed, and the half of the product that is finished (the chat, the routing,
 * the status sync, the preview panel, the pricing) cannot be seen working at
 * all, because it never gets a successful build to show.
 *
 * This answers those four calls in the shape each branch reads, so the loop can
 * be watched end to end before the expensive half is written. It builds
 * nothing. Every reply says so, in a `stub: true` field and in a preview page
 * that describes itself as a placeholder, so a stubbed build cannot be mistaken
 * for a real one by a person or by anything downstream.
 *
 * It is off unless BUILDER_STUB_ENABLED is "true". That is the whole point of
 * the flag: a fake builder that quietly outlives its purpose is worse than no
 * builder, because the product would look finished. Turning it off is one
 * variable, and then the branches fail honestly again. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* What n8n sends. Only `projectName` and `prompt` are read — the ids are echoed
   so a reply can be matched to its request in the execution log. */
type StubRequest = {
  requestId?: unknown;
  projectName?: unknown;
  prompt?: unknown;
};

/* What the build reports having done, which is what /api/build prices it from:
   0.5 + files x 0.25, clamped to the generate band's 2.5 ceiling. Four files
   lands at 1.5 credits — mid-band, so the charge visibly moves with the work
   rather than pinning at the maximum, which anything from ten files up does.

   Fixed rather than random: a demo build that costs a different amount every
   run is a worse thing to show than one that costs the same. */
const FILES_TOUCHED = 4;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/* The preview the workspace will load in its iframe. Absolute, because
   safeHttpUrl rejects a relative URL — these addresses normally point at
   somewhere else entirely, so a relative one means something went wrong. */
function previewUrl(origin: string, kind: string, body: StubRequest): string {
  const query = new URLSearchParams({
    kind,
    name: text(body.projectName, "Untitled app"),
    prompt: text(body.prompt).slice(0, 400),
  });
  return `${origin}/preview/stub?${query}`;
}

/* One shape per branch, keyed by the path the n8n node calls. Each returns
   exactly the fields that branch's Collect node reads — miss one and the chat
   shows a build with no preview rather than an error, which is the confusing
   kind of wrong.

   None of them may return an `error` key: the Collect nodes read
   `$json.error ? "failed" : "provisioned"`, so an error field here is the
   difference between a green build and a red one. */
const STEPS: Record<string, (origin: string, body: StubRequest) => Record<string, unknown>> = {
  /* → Collect WebApp Result: previewUrl, repoUrl, filesTouched */
  "webapp/scaffold": (origin, body) => ({
    previewUrl: previewUrl(origin, "webapp", body),
    repoUrl: "https://github.com/example/stub-webapp",
    filesTouched: FILES_TOUCHED,
  }),

  /* → Collect WebApp Result: projectUrl, anonKey, schemaApplied, tables.
     The keys are deliberately empty strings rather than invented values: they
     are rendered to the user as the config their app needs, and a plausible
     looking key that is not a key is worse than a blank. */
  "supabase/schema": () => ({
    projectUrl: "",
    anonKey: "",
    schemaApplied: true,
    tables: ["profiles", "products", "orders"],
  }),

  /* → Collect WordPress Result */
  "wordpress/provision": (origin, body) => ({
    siteUrl: previewUrl(origin, "wordpress", body),
    themeRepoUrl: "https://github.com/example/stub-theme",
    adminUrl: "https://example.com/wp-admin",
    restApiUrl: "https://example.com/wp-json/wp/v2",
    graphqlUrl: "https://example.com/graphql",
    pluginsInstalled: ["wp-graphql", "yoast-seo", "wp-super-cache"],
    filesTouched: FILES_TOUCHED,
  }),

  /* → Collect E-Commerce Result */
  "commerce/provision": (origin, body) => ({
    storefrontUrl: previewUrl(origin, "ecommerce", body),
    repoUrl: "https://github.com/example/stub-store",
    adminUrl: "https://example.com/admin",
    supabaseUrl: "",
    supabaseAnonKey: "",
    storeDomain: "example.myshopify.com",
    webhooksRegistered: ["orders/create", "products/update", "inventory_levels/update"],
    filesTouched: FILES_TOUCHED,
  }),
};

export async function POST(request: Request, context: { params: Promise<{ step: string[] }> }) {
  if (process.env.BUILDER_STUB_ENABLED !== "true") {
    /* 404 rather than 403: an endpoint that is switched off should not confirm
       it exists, and a branch calling it gets the same honest failure it got
       before the stub was written. */
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { step } = await context.params;
  const build = STEPS[step.join("/")];

  if (!build) {
    return NextResponse.json(
      { error: `No stub for "${step.join("/")}".`, known: Object.keys(STEPS) },
      { status: 404 },
    );
  }

  let body: StubRequest;
  try {
    body = (await request.json()) as StubRequest;
  } catch {
    body = {};
  }

  return NextResponse.json({
    ...build(new URL(request.url).origin, body),
    /* Not decoration. Anything reading these replies — a person in the
       execution log, a branch that grows a new field later — should be able to
       tell at a glance that nothing was built. */
    stub: true,
    requestId: text(body.requestId),
  });
}
