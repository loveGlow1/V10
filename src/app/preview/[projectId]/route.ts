import { appPreviewDocument, canRenderApp } from "@/lib/builder/preview/app-preview";
import { buildModeOf } from "@/lib/builder/build-mode";
import { existingVercelProject } from "@/lib/publish/deployment-store";
import { canBeFramed } from "@/lib/publish/framable";
import { appDomainFor, previewAliasFor, publicAddress } from "@/lib/publish/vercel-deploy";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { isProjectSummary } from "@/lib/builder/project-summary";
import { currentTree, loadTree } from "@/lib/builder/store-tree";
import { isSinglePage, type FileTree } from "@/lib/builder/tree";
import { toStandalone } from "@/lib/standalone-page";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Serves the page a build produced.
 *
 * This is what `projects.preview_url` points at, what the workspace's iframe
 * loads, and where "Open preview" goes. It returns the newest build's document
 * verbatim — it is the built page, not a page about the built page.
 *
 * ── Why this is a route handler and not a React page ──────────────────────
 *
 * The stored HTML is model output shaped by a user's prompt: untrusted, and it
 * has to run its own scripts to be a working page at all. Serving it from this
 * origin without care would mean any generated <script> could reach
 * /api/build, /api/credits and the Supabase session cookie as the signed-in
 * user, on their own domain. That is the whole risk, and it is not theoretical:
 * "put a script in the page that fetches my data" is a prompt anyone can write.
 *
 * `Content-Security-Policy: sandbox allow-scripts allow-forms` is the answer.
 * It applies the iframe sandbox rules to a top-level document, which puts the
 * response in an opaque origin: scripts still run, so the page works, but it has
 * no access to cookies, storage, or same-origin requests against quickstark.tech.
 * A React page could not do this — the header has to be on the response that
 * carries the HTML, and rendering it through dangerouslySetInnerHTML would put
 * it inside this origin's document rather than beside it.
 *
 * The workspace's iframe also sandboxes it, which covers the framed case. This
 * covers the case the iframe cannot: opening the preview in a tab of its own.
 *
 * ── Who can see it ────────────────────────────────────────────────────────
 *
 * The owner, and nobody else. The read runs under the caller's session, so RLS
 * on project_builds answers the question and a link forwarded to someone else
 * shows them nothing. Making a page public is what publishing will be for.
 *
 * ── ?download=1 ───────────────────────────────────────────────────────────
 *
 * The same document, handed over as a file instead of rendered. It is the same
 * read and the same RLS, which is the reason it lives here rather than in a
 * route of its own: two places that serve someone's private page are two places
 * to get the ownership check wrong.
 *
 * A download is served with `Content-Security-Policy: sandbox` and no
 * allowances at all — stricter than the rendered case, which needs scripts to
 * be a working page. Nothing should execute on the way to disk, and if a
 * browser ever ignored the disposition and rendered it anyway, it renders
 * inert. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The preview itself is a read. The download compiles a stylesheet on the way
   out — well under a second for a page of this size, but real work rather than
   a lookup, so it is not left on the default. */
export const maxDuration = 30;

function notFound(message: string) {
  /* Deliberately the same answer for "no such project", "not yours" and "never
     built": all three are things the caller has no business distinguishing. */
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No preview</title></head><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#020617;color:#94a3b8;font:15px/1.6 system-ui,sans-serif"><p style="max-width:34ch;text-align:center;padding:24px">${message}</p></body></html>`,
    {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "no-store",
      },
    },
  );
}

/* The project's name as a file name: lowercase, words joined by hyphens, and
   nothing that could carry meaning into a header. Built from the stored name
   rather than taken from a query parameter — a caller-supplied filename is a
   header injection waiting to happen, and this one is only ever read out of a
   row the caller already owns. */
function fileNameFor(name: string | null | undefined): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "page"}.html`;
}

/* What the pane shows when a project cannot be rendered.
 *
 * Deliberately almost nothing: one sentence, no branding, no file listing, no
 * routes. Everything that used to be here is the summary, and the summary is
 * not a preview — it is a receipt, and it lives in the QuickStark interface
 * and at `?diagnostics=1`.
 *
 * Served with a bare `sandbox` and no allowances: there is nothing in it to
 * run. */
/* A project that has to run somewhere, said plainly.
 *
 * A server-mode project cannot be rendered here and that is not a failure: the
 * in-browser runtime compiles components and runs them, and a route handler, a
 * server action or a server component reading a secret has no meaning in a
 * browser at all. Faking one would be the mock-up this whole route exists to
 * stop showing.
 *
 * So the pane says what kind of project this is and where its running copy is.
 * With a live address it never gets this far — see below, which sends the pane
 * at the real thing. */
/* Where this project is actually running, or null.
 *
 * Service-keyed because it reads project_deployments, which has no policy for
 * a browser session and should not: a deployment row names another account's
 * hosting project. The projectId reaching here has already been through RLS on
 * project_builds above, so this is not widening what the caller can see.
 *
 * Best effort. A preview that cannot look up an address falls through to the
 * sentence below, which is the honest answer anyway. */
async function liveAddress(projectId: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  if (!service) return null;

  try {
    const { data } = await service
      .from("project_builds")
      .select("deployment_url")
      .eq("project_id", projectId)
      .not("deployment_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ deployment_url: string | null }>();

    const vercelProject = await existingVercelProject(service, projectId);
    const vercel = publicAddress(data?.deployment_url ?? null, vercelProject);

    /* The address label this project was issued, which is what its published
       domain is built from — `luxury-bakery`, not the Vercel project name
       `luxury-bakery-038f1129`. Read here so the pane looks for the same
       hostname the publish route binds; deriving it from the Vercel name
       instead meant looking up a domain nothing had ever attached, so the
       check always failed and the pane fell through to vercel.app. */
    const { data: named } = await service
      .from("projects")
      .select("slug")
      .eq("id", projectId)
      .maybeSingle<{ slug: string | null }>();
    const slug = named?.slug ?? null;

    /* ── This platform's own address first ─────────────────────────────
     *
     * `<slug>.preview.quickstark.tech` rather than `<project>.vercel.app`,
     * for the rule this product is held to everywhere else: before a publish
     * a customer sees a QuickStark link, and somebody else's hosting domain
     * is not something to hand them in the pane they preview in. The cron
     * assigns this alias on every deployment that reaches READY.
     *
     * ASKED, not assumed. The alias needs `*.preview.quickstark.tech` to be a
     * verified domain on the Vercel account with DNS pointing at it, and
     * where that is not true aliasDeployment is refused and logs a warning
     * nobody reads. Redirecting the pane at a host that does not resolve
     * would turn a working preview into a blank rectangle — which is the
     * exact failure this route keeps being rewritten to avoid. So it is
     * fetched once, and the vercel.app address is what happens when it does
     * not answer. */
    /* ── In order of what somebody would rather be looking at ─────────
     *
     * The PUBLISHED address first — `<slug>.quickstark.tech`, bound to the
     * Vercel project when the deployment went live (see settle.ts). It is the
     * address the customer gives people, and a preview pane pointed at it is
     * showing the same site their visitors see, on the same origin: the
     * session cookie, the auth redirect and the server action all behave
     * exactly as they will in production, which is the whole reason a
     * server-mode preview is a frame around the real thing rather than a
     * rendering of it.
     *
     * Then the preview alias, then the vercel.app address.
     *
     * ASKED AT EVERY STEP, never assumed. Both of ours need a wildcard that
     * is verified on the Vercel account with DNS pointing at it, and where
     * that is not true the bind is refused and logs a warning nobody reads.
     * Redirecting the pane at a host that does not resolve would turn a
     * working preview into a blank rectangle — the exact failure this route
     * keeps being rewritten to avoid. So each is fetched once, and the
     * vercel.app address is what happens when neither answers. */
    for (const host of [
      slug ? appDomainFor(slug) : null,
      vercelProject ? previewAliasFor(vercelProject) : null,
    ]) {
      if (!host) continue;
      const address = `https://${host}`;
      const reachable = await canBeFramed(address, SITE_URL);
      if (reachable.ok) return address;
    }

    return vercel;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("preview: the live address could not be read:", error);
    return null;
  }
}

function needsServer(reason: string | null): string {
  const why = reason
    ? `<p style="max-width:44ch;margin:8px 0 0;font-size:13px;opacity:.75">${escapeHtml(reason)}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title></head><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#f8fafc;color:#475569;font:14px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"><div style="max-width:44ch;text-align:center;padding:24px"><p style="margin:0">This app runs on a server, so there is nothing to show until it is published. Publish it and this pane will show the running site.</p>${why}</div></body></html>`;
}

/* The running copy, FRAMED rather than redirected to.
 *
 * This returned `Response.redirect(live, 302)`, which took the browser off
 * quickstark.tech and left it on the hosting provider's domain. Everything
 * about that was wrong for a preview: the address bar stopped saying
 * QuickStark, the back button went somewhere else, the workspace's own frame
 * navigated out from under itself, and what somebody copied out of the bar to
 * send a colleague was a deployment URL rather than their project. It is also
 * exactly how "preview" and "publish" came to be the same thing — both ended
 * at the same host, so there was no visible difference between the private
 * thing and the public one.
 *
 * So the preview stays at /preview/<id> and the running app is shown INSIDE it.
 * Same pixels, same server, same behaviour — and the URL never leaves this
 * platform.
 *
 * `sandbox` on the frame keeps allow-same-origin, which reads as the opposite
 * of every other sandbox in this codebase and is right here for a reason the
 * others do not share: this frame holds a SEPARATE ORIGIN already — somebody
 * else's deployment on its own hostname — so same-origin means "as itself",
 * not "as quickstark.tech". Withholding it would break the running app's own
 * session, which is the one thing a server-mode preview exists to show. It
 * cannot reach this page: a cross-origin frame has no more access to its
 * parent for carrying that flag. */
function runningCopy(address: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title><style>html,body{margin:0;height:100%;background:#f8fafc}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe src="${escapeHtml(address)}" sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads" referrerpolicy="no-referrer"></iframe></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cannotRender(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title></head><body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#f8fafc;color:#475569;font:14px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"><p style="max-width:40ch;text-align:center;padding:24px">This project could not be rendered in the preview. Its files are all there — open the build details to see everything that was made.</p></body></html>`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const params = new URL(request.url).searchParams;
  const asDownload = params.get("download") === "1";
  /* A project built as a file tree has more than one thing to serve. `?files=1`
     lists what it contains and `?file=app/page.tsx` returns one of them, so the
     workspace can show a project as a project. Neither is reachable on a
     single-page build, which has one file and it is the page. */
  const wantsListing = params.get("files") === "1";
  const wantsFile = params.get("file");
  /* The written summary of a project build, which used to BE this route's
     answer for a tree and is now what sits behind it. See the note above
     `renderable` below: the preview shows the product, and the receipt is
     diagnostics somebody asks for. */
  const wantsDiagnostics = params.get("diagnostics") === "1";
  /* ?chrome=0 drops the page-switcher bar.
   *
   * The workspace pane asks for it. That pane is meant to show the customer
   * their application, and a row of route chips above it is ours, not theirs —
   * it is not in the project, it is not on the deployed site, and in a narrow
   * pane it reads as the first line of their own header. Opened full screen the
   * bar stays, because there it is the only way to reach a route in a project
   * whose own navigation does not exist yet. */
  const wantsChrome = params.get("chrome") !== "0";

  const supabase = await createSupabaseServerClient();
  if (!supabase) return notFound("Previews are unavailable — Supabase is not configured.");

  /* Under the caller's own session on purpose. RLS is what makes this private,
     rather than a check written here that could be forgotten. */
  const { data: build } = await supabase
    .from("project_builds")
    .select("id, html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!build?.html) {
    return notFound("There is nothing to preview here yet. Send a message to build this app.");
  }

  /* The project's files, when it has any. Read under the caller's session like
     everything else here, so RLS decides rather than a check written here. */
  if (wantsListing || wantsFile !== null) {
    const tree = await loadTree(supabase, build.id as string);

    if (tree.length === 0) {
      return Response.json(
        { error: "This project was built as a single page — it has no file tree." },
        { status: 404 },
      );
    }

    if (wantsListing) {
      return Response.json({
        files: tree.map((file) => ({ path: file.path, lines: file.content.split("\n").length })),
      });
    }

    const file = tree.find((entry) => entry.path === wantsFile);
    if (!file) {
      return Response.json({ error: `This project has no ${wantsFile}.` }, { status: 404 });
    }

    /* text/plain whatever the extension is, deliberately. These are for
       reading, and a .html served as html from this origin would run — see
       the sandbox note on the preview response below, which is the whole
       reason this route is careful. */
    return new Response(file.content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${file.path.split("/").pop()}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (asDownload) {
    /* Read for the file name only, and after the build: a project with no build
       never reaches here, so this is not a round trip anyone pays for on the
       path that matters. RLS answers it too, so a name cannot leak from a
       project the caller does not own. */
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .maybeSingle();

    /* Compiled on the way out, and this is what makes a download worth having.
       The page styles itself with the Tailwind play CDN, which is fine at a URL
       and useless in a file: opened from disk — Quick Look on a phone, an email
       attachment, a tab with no connection — that script is a request nobody
       makes. Not one utility class resolves, nothing errors, and what renders
       is the raw document: default serif, blue underlined links, an inline icon
       a screen tall because `h-5 w-5` meant nothing. It looks broken. It is
       unstyled, which looks the same and is worse, because whoever opened it
       cannot tell which.

       toStandalone runs Tailwind over this page's own markup and puts the
       result in the file, so what leaves here has no external reference of any
       kind. See src/lib/standalone-page.ts. */
    let file = build.html as string;
    try {
      file = (await toStandalone(file)).html;
    } catch (error) {
      /* The page is still worth having. Compiling is what makes it look right
         offline, not what makes it a page, so a compiler failure downgrades the
         download rather than denying it. */
      // eslint-disable-next-line no-console
      console.error("preview: the page could not be made standalone:", error);
    }

    return new Response(file, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileNameFor(project?.name)}"`,
        /* No allowances. See the note above — a file on its way to disk has
           nothing to run. */
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  }

  /* ── The product, rather than an account of it ──────────────────────────
   *
   * A build whose stored document is a project summary is a tree build: there
   * was no HTML to store, because the HTML is what `next build` produces and
   * nothing here runs `next build`. That was true of the renderer and is no
   * longer true of this route — lib/builder/preview compiles the tree in the
   * browser and runs it, so what the pane shows is the application.
   *
   * The summary is still stored and still reachable at `?diagnostics=1`. It was
   * always a good receipt and was never a product, and the difference between
   * those two is the whole of this change: a customer opening their project
   * sees what they asked for, and the file listing is something they go and
   * look at rather than something they are handed instead.
   *
   * The fallback chain matters as much as the feature. A tree that cannot be
   * routed — a scaffold that failed halfway, a shape this renderer does not
   * know — says so in one line and points at the receipt, rather than being
   * handed the receipt as though it were the product. See cannotRender. */
  /* ── Asked of the BUILD, not of the document it stored ──────────────────
   *
   * This asked `isProjectSummary(build.html)`, and the marker that answers it
   * was written into the receipt on 15 September. Every project built before
   * that — thirteen of the fourteen in production, including every one the
   * customer had complained about — has a receipt with no marker in it, so this
   * read false, the branch was skipped entirely, and the route fell through to
   * `return new Response(build.html)`: the receipt, framed in the pane where
   * the application should be. The renderer below was written, shipped, tested
   * and never reached by a single existing project.
   *
   * The marker was the wrong question. Whether a build is a project is a fact
   * about the BUILD — it has source files — and that fact is the same for a
   * project stored last week as for one stored ten minutes ago. It cannot be
   * backdated into documents that are already written, and it does not need to
   * be: the files are right there.
   *
   * The marker stays as the second half of the test, for the one case files
   * cannot answer: a project whose files are missing. Its html is a receipt,
   * and a receipt must not be framed as a preview then either — that falls to
   * cannotRender below, which says so in a line. */
  /* ── Read for the PROJECT, not for the row ───────────────────────────
   *
   * This read `loadTree(build.id)`, which is the right question about a build
   * and the wrong one about a project. A build row can exist without its
   * files — an older save path, an orchestrator step that wrote the summary
   * and stopped — and when the newest one is like that, an empty tree here
   * meant the renderer had nothing to route and the pane fell through to the
   * receipt: "Routes 9, Database created, Files", framed where somebody's
   * application should be.
   *
   * Three projects in production are in that state, and two of them have a
   * complete tree on the build immediately before. currentTree looks back for
   * it and only reports sourceMissing when there is genuinely no source
   * anywhere — see newestStoredTree in lib/builder/store-tree.ts. */
  const current = wantsDiagnostics
    ? { tree: [] as FileTree, sourceMissing: false }
    : await currentTree(supabase, projectId);

  /* ── A TREE OF ONE PAGE IS NOT A PROJECT ─────────────────────────────
   *
   * currentTree hands a single-page build back as a one-file tree under
   * index.html, so that the download and the file listing do not each have to
   * ask which of the two kinds of build they are holding. That is right for
   * reading and wrong HERE, because this is the line that decides whether the
   * renderer runs at all.
   *
   * Left in, it broke every single-page build on the platform in one commit:
   * the tree was no longer empty, so `isProject` read true, so the branch
   * below took over, so canRenderApp looked for app/**​/page.tsx in a tree
   * whose only file is index.html, found none, and served the "could not be
   * rendered" page. A blank rectangle where somebody's site had been, for the
   * commonest kind of build this platform makes.
   *
   * The distinction the route actually needs is "does this project have SOURCE
   * FILES", and a page reconstituted from the html column is not that. So the
   * page-derived tree is dropped and the document below serves it, which is
   * exactly what happened before currentTree was wired in here. */
  const tree = isSinglePage(current.tree) ? [] : current.tree;
  const isProject = tree.length > 0 || isProjectSummary(build.html as string);

  if (!wantsDiagnostics && isProject) {
    /* ── A project with a server is shown, not simulated ──────────────────
     *
     * The renderer below compiles this tree and runs it in the browser, which
     * is exactly right for a static project and meaningless for a server one:
     * a route handler does not exist in a browser, a server action has nothing
     * to call, and a server component reading a secret would either fail or —
     * far worse — be given a plausible-looking nothing. Rendering a mock-up of
     * an app is the thing this route was rewritten to stop doing.
     *
     * So a server project is sent at its running copy when it has one. The
     * address is derived rather than read off the row, for the same reason the
     * workspace derives it: a per-deployment host sits behind Deployment
     * Protection and renders as a blank rectangle. See publicAddress.
     *
     * And when it has no running copy, the pane says so in a sentence rather
     * than showing a rendering that would be a lie. */
    const build_mode = buildModeOf(tree);
    if (build_mode.mode === "server") {
      const live = await liveAddress(projectId);
      if (live) {
        return new Response(runningCopy(live), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            /* No sandbox header here, and that is deliberate: this document is
               ours, it is four lines long, and the untrusted half is inside the
               frame it writes — which carries its own sandbox attribute. A
               `Content-Security-Policy: sandbox` on the outer document would
               put the frame in an opaque origin too, and take the running
               app's own cookies and storage away from it. */
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
          },
        });
      }

      return new Response(needsServer(build_mode.because[0] ?? null), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "sandbox",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }

    try {
      if (canRenderApp(tree)) {
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", projectId)
          .maybeSingle();

        /* The project's own `process.env`, for the browser renderer.
         *
         * A backend project's lib/supabase.ts reads these three (scaffold.ts
         * writes it), and `next build` inlines them. The preview compiles the
         * tree in a browser instead, where nothing inlines and `process` does
         * not exist — so until this was passed, every screen importing the
         * Supabase client threw `process is not defined` and the pane showed a
         * screen that could not be rendered.
         *
         * NEXT_PUBLIC_ only, deliberately. These are compiled into any real
         * build of the generated project and served to every visitor, so a
         * sandboxed document that also has them knows nothing new. The
         * service-role key must never appear here: this runs source a
         * customer's prompt produced.
         *
         * Each is included only when set, so an unconfigured deployment sends
         * an empty object and the generated client says it is unconfigured on
         * first use instead of throwing on import. */
        const previewEnv: Record<string, string> = {};
        for (const name of [
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "NEXT_PUBLIC_SUPABASE_SCHEMA",
        ] as const) {
          const value = process.env[name];
          if (value) previewEnv[name] = value;
        }

        const document = appPreviewDocument({
          tree,
          projectName: project?.name as string | null,
          env: previewEnv,
          chrome: wantsChrome,
        });
        if (document) {
          return new Response(document, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              /* The same sandbox the stored page gets, for the same reason: this
                 document runs source a customer's prompt produced. It needs
                 scripts to be an application at all, and it must not have this
                 origin's cookies while it does. */
              "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "no-store",
            },
          });
        }
      }
    } catch (error) {
      /* Reported, then handled below. A failure to render must never be a
         failure to show anything — but what it falls back to is NOT the
         summary. See below. */
      // eslint-disable-next-line no-console
      console.error("preview: the project could not be rendered:", error);
    }

    /* ── The summary is never the preview ────────────────────────────────
     *
     * Reaching here means the tree could not be routed — a scaffold that
     * stopped halfway, or a shape this renderer does not know. Until now that
     * fell through to the stored document, which for a project IS the summary:
     * "a web app built as a Next.js project — 19 files", a list of routes and
     * a file count, framed in the pane where the customer's application should
     * be.
     *
     * That is a receipt, and a receipt is not a preview. It belongs in the
     * QuickStark interface as a sentence about what was built, not in the frame
     * that is supposed to be showing the product. So this pane says what
     * happened in one line and points at the receipt for anybody who wants it,
     * and the summary itself stays exactly where it has always been — at
     * `?diagnostics=1`, for whoever asks. */
    return new Response(
      cannotRender(),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "sandbox",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return new Response(build.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* The line that makes serving this safe — see the note above. Scripts and
         forms are allowed because a page needs them; same-origin is not, which
         is what denies the session cookie and this origin's API routes.
         allow-popups so an <a target="_blank"> in a landing page still works. */
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
      /* Belt and braces for the framed case, and it costs nothing. */
      "X-Content-Type-Options": "nosniff",
      /* A build replaces the page at the same address, so a cached copy is a
         preview that silently shows the previous build. */
      "Cache-Control": "no-store",
    },
  });
}
