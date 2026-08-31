"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Blocks,
  Check,
  ChevronLeft,
  CreditCard,
  ExternalLink,
  LifeBuoy,
  Link2,
  RotateCw,
  Rocket,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { avatarFor } from "../../projectColours";
import { creditCostOf, formatCredits } from "../../credits";
import { isPublished, useProjects, type Project } from "../../ProjectsContext";
import type { IntegrationCategory } from "../../integrations";
import { requestSupportChat } from "../../supportChat";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PUBLISH_SUBDOMAIN, SITE_URL } from "@/lib/site";
import { safeHttpUrl } from "@/lib/safe-url";
import Integrations from "./Integrations";
import { ManageMark, PreviewMark } from "./panelMarks";
import Popover from "./Popover";

type ManageSection = "settings" | "integrations" | "payments";

/* A request from the other half of the workspace to show a particular drawer.
   The counter is what makes a second, identical request register: pressing the
   composer's GitHub button twice should bring the pane back both times. */
export type ManageRequest = {
  section: ManageSection;
  category: IntegrationCategory;
  n: number;
};

/* The address a published project would answer on. Derived from the name so it
   is the same string the Manage tab shows and the publish panel promises. */
function subdomainFor(project: Project | null) {
  const slug = (project?.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "your-app"}${PUBLISH_SUBDOMAIN}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/[0.06] py-3 last:border-b-0">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[13px] text-ink">{children}</span>
    </div>
  );
}

export default function PreviewPanel({
  project,
  onUpgradeClick,
  request,
  onBackToChat,
  onClose,
}: {
  project: Project | null;
  onUpgradeClick: () => void;
  request: ManageRequest | null;
  /* Puts this half away and gives the whole workspace to the conversation.
     Desktop only — a phone shows one at a time already. */
  onClose?: () => void;
  /* The way out of this pane on a phone. The bar above no longer carries the
     preview/chat pair — an open app names itself there instead — so without
     this, arriving here from the composer's GitHub button would be a one-way
     trip. Unused from md up, where both halves are on screen at once. */
  onBackToChat: () => void;
}) {
  const router = useRouter();
  const { rename, remove } = useProjects();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [view, setView] = useState<"preview" | "manage">("preview");
  const [section, setSection] = useState<ManageSection>("settings");
  const [integrationsCategory, setIntegrationsCategory] = useState<IntegrationCategory>("All");
  const [shared, setShared] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [draft, setDraft] = useState(project?.name ?? "");
  const [confirming, setConfirming] = useState(false);
  /* Bumped by the reload button and used as the frame's key, which is what
     remounts it. Reaching into the frame to call location.reload() is not
     available here: it is another origin, and deliberately sandboxed. */
  const [reloads, setReloads] = useState(0);
  const publishRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(project?.name ?? ""), [project?.name]);

  /* These come from the build orchestrator by way of the projects row, so they
     are checked before they reach an href or an iframe src — see
     src/lib/safe-url.ts. Null means "do not render a link", never "render a
     broken one". */
  const previewUrl = safeHttpUrl(project?.preview_url);
  const repoUrl = safeHttpUrl(project?.repo_url);

  /* The page is fetched here and handed to the frame as srcdoc, rather than
     pointed at with src.
     A build's page is private: /preview/<id> reads it under the caller's own
     session so RLS answers for it. But the frame is sandboxed without
     allow-same-origin — it has to be, because the page runs scripts a prompt
     asked for — and a frame in an opaque origin is a fragile place to depend on
     a cookie reaching. Fetching from the panel is an ordinary same-origin
     request that certainly carries the session, and srcdoc keeps the result
     opaque exactly as before.

     By path rather than by the stored address: preview_url is absolute and
     points at the canonical site, which is not necessarily the host this is
     being browsed on — a preview deployment would fetch cross-origin and get
     nothing. The link below still uses the stored address, because opening it
     in a tab is a real navigation and should land on the real site. */
  const previewPath = project?.id ? `/preview/${project.id}` : null;
  const [pageHtml, setPageHtml] = useState<string | null>(null);
  const [pageFailed, setPageFailed] = useState(false);

  useEffect(() => {
    if (!previewUrl || !previewPath) {
      setPageHtml(null);
      setPageFailed(false);
      return;
    }

    let cancelled = false;
    setPageHtml(null);
    setPageFailed(false);

    void fetch(previewPath, { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        if (cancelled) return;
        setPageHtml(html);
        setPageFailed(html === null);
      })
      .catch(() => {
        if (!cancelled) setPageFailed(true);
      });

    return () => {
      cancelled = true;
    };
    /* `reloads` is a dependency on purpose: the refresh button rebuilds the
       page rather than only remounting a frame around the same copy. */
  }, [previewUrl, previewPath, reloads]);

  useEffect(() => {
    if (!request) return;
    setView("manage");
    setSection(request.section);
    setIntegrationsCategory(request.category);
  }, [request]);

  useEffect(() => {
    if (!publishOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (publishRef.current && !publishRef.current.contains(event.target as Node)) {
        setPublishOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [publishOpen]);

  /* A phone puts Manage over the whole screen, so the page behind it must not
     scroll with it — the same lock the drawer takes. */
  useEffect(() => {
    if (isDesktop || view !== "manage") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isDesktop, view]);

  async function share() {
    if (!project) return;
    const url = `${SITE_URL}/dashboard/project/${project.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // Clipboard permission can be refused; leave the label alone rather than
      // claiming a copy that did not happen.
    }
  }

  /* The view switch, as a track with a chip riding in it rather than two pills
     in a row. The track is sunk into the header and the chosen half is lifted
     out of it — a hairline of light along its top, a soft shadow beneath — so
     which view you are in is legible from the shape alone, before the labels
     are read. The unchosen half carries no fill at all; two filled halves is
     the arrangement that makes a segmented control read as two buttons.

     28px inside a 36px track, which is what puts the switch on the same line as
     every control across the header: one height, one baseline, one row. */
  const segment = (active: boolean) =>
    `relative flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-all lg:px-3 ${
      active
        ? "bg-layer/[0.12] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)]"
        : "text-muted hover:text-ink"
    }`;

  /* Every control to the right of the switch is cut from this: 36 tall, a
     hairline rim, a translucent fill that firms up under the cursor. The ones
     that are only an icon are square, so the row reads as a set of equal tiles
     rather than as pills of assorted widths.

     Widths are why the labels come and go with the viewport. This pane is
     whatever is left after the conversation's fixed 420, so at 1024 it is about
     600px and at 768 about 350 — the labels appear as that room arrives, and
     below it every control keeps its icon, its title and its aria-label. */
  const action =
    "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line/[0.08] bg-layer/[0.04] px-2.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.08] hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

  /* A rule between groups of controls: what the app is, what you do to it, and
     the way out of the pane. Without them the eight controls read as one queue
     and the eye has to count. */
  const divider = <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line/[0.09]" />;

  /* Glass over the blue, the material every control in the phone header is made
     of: a translucent fill, a hairline rim, one pixel of light along the top. */
  const glass =
    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-line/[0.14] bg-layer/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors active:scale-[0.98]";

  const sections: { id: ManageSection; label: string; icon: typeof Blocks }[] = [
    { id: "settings", label: "App settings", icon: SlidersHorizontal },
    { id: "integrations", label: "Integrations", icon: Blocks },
    { id: "payments", label: "Payments", icon: CreditCard },
  ];

  const publishBody = (
    <>
      <p className="hidden text-[13px] font-medium text-ink md:block">Publish this app</p>
      <p className="break-all rounded-lg border border-line/[0.06] bg-layer/[0.03] px-2.5 py-2 text-[12px] text-soft md:mt-1.5">
        {subdomainFor(project)}
      </p>
      {/* Honest rather than convincing: there is no build to put on that address
          yet, so the button says why instead of failing. */}
      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
        Goes live once your first build finishes.
      </p>
      {/* The price belongs next to the button, not only on the pricing page: a
          first publish is the largest single charge on the platform, and it is
          the one action nobody should discover the cost of after taking it.

          Which of the two prices applies is read from the project itself, so a
          live app quotes the redeploy price rather than the provisioning one. */}
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {project && isPublished(project)
          ? `Redeploying costs ${formatCredits(creditCostOf("publish", { alreadyPublished: true }))} credit.`
          : `Going live costs ${formatCredits(creditCostOf("publish"))} credits, then ${formatCredits(
              creditCostOf("publish", { alreadyPublished: true }),
            )} per deploy after that.`}
      </p>
      <button
        disabled
        className="mt-3 h-10 w-full rounded-xl bg-layer/[0.08] text-[13px] font-medium text-muted md:h-8 md:rounded-lg"
      >
        Publish app
      </button>
    </>
  );

  /* Once a build has somewhere to look, this is where it is looked at. The
     frame is sandboxed: what it loads is generated from someone's prompt, and
     it is served from another origin, so it gets scripts and forms and nothing
     else — no same-origin access to the dashboard around it.

     Until then the panel says there is nothing rather than showing an empty
     frame that reads as a build that rendered blank. */
  const preview = (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {previewUrl ? (
        <div className="flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl border border-line/[0.07] bg-layer/[0.02]">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line/[0.06] px-2.5">
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
              {previewUrl}
            </span>
            {/* A phone's header has no room for these two, so they ride on the
                frame's own chrome instead — where the address they act on is.
                From md up the header above carries them and this pair stands
                down rather than saying the same thing twice. */}
            <button
              onClick={() => setReloads((count) => count + 1)}
              aria-label="Reload the preview"
              className="shrink-0 rounded-md p-1 text-ink transition-colors hover:bg-layer/[0.06] md:hidden"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md px-1.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-layer/[0.06] md:hidden"
            >
              Open
            </a>
          </div>
          {pageHtml !== null ? (
            <iframe
              key={`${previewUrl}#${reloads}`}
              srcDoc={pageHtml}
              title={`${project?.name ?? "App"} preview`}
              /* No allow-same-origin, deliberately: this document was written by
                 a model from someone's prompt, and it runs its own scripts. An
                 opaque origin is what keeps it away from the session cookie and
                 the API routes on this domain. */
              sandbox="allow-scripts allow-forms allow-popups"
              className="min-h-0 flex-1 border-0 bg-white"
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-white px-6 text-center">
              <p className="text-[13px] leading-relaxed text-slate-500">
                {pageFailed
                  ? "This page could not be loaded. Try refreshing."
                  : "Loading the page…"}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-line/[0.07] bg-layer/[0.02] px-6 text-center">
          <span className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${avatarFor(project?.id)}`} />
          <p className="mt-4 text-[15px] text-ink">
            {project?.status === "Building" ? "Building…" : "Nothing to preview yet"}
          </p>
          <p className="mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
            {project?.status === "Building"
              ? "Your app renders here as soon as this build returns a preview."
              : "Your app renders here the moment the first build finishes."}
          </p>
        </div>
      )}
    </div>
  );

  /* One body, drawn beside the preview on a pointer and over the screen on a
     phone. Writing it twice is how the two would drift. */
  const manage = (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* A rail from lg up, where this pane is wide enough to give 190px to
          navigation. Below that it is a scrolling row of pills: the chat half
          takes 420px of the screen, so at md the pane itself is barely wider
          than the rail would be. */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/[0.06] p-2 [scrollbar-width:none] lg:w-[190px] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r [&::-webkit-scrollbar]:hidden">
        <p className="hidden px-2.5 py-2 text-[13px] text-muted lg:block">Manage your app</p>
        {sections.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              aria-current={active ? "page" : undefined}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors ${
                active
                  ? "bg-layer/[0.08] text-ink"
                  : "text-muted hover:bg-layer/[0.04] hover:text-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]">
        {section === "settings" && (
          <div className="w-full max-w-[520px] px-4 py-4 lg:pl-5">
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!project || !draft.trim() || draft.trim() === project.name) return;
                await rename(project.id, draft.trim());
              }}
            >
              <label className="block text-[13px] text-muted" htmlFor="workspace-name">
                Name
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="workspace-name"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 text-sm text-ink outline-none focus-visible:border-line/25 md:h-9 md:rounded-lg"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || draft.trim() === project?.name}
                  className="h-10 shrink-0 rounded-xl bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-opacity hover:bg-layer/90 disabled:opacity-30 md:h-9 md:rounded-lg"
                >
                  Save
                </button>
              </div>
            </form>

            <div className="mt-5">
              <Row label="Status">{project ? project.status : "—"}</Row>
              <Row label="Address">
                <span className="break-all text-soft">{subdomainFor(project)}</span>
              </Row>
              <Row label="Published">{project && isPublished(project) ? "Yes" : "Not yet"}</Row>
              <Row label="Build type">{project?.intent ?? "—"}</Row>
              <Row label="Preview">
                {previewUrl ? (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-accent hover:underline"
                  >
                    {previewUrl}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Code">
                {repoUrl ? (
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-accent hover:underline"
                  >
                    {repoUrl}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Last updated">
                {project ? new Date(project.updated_at).toLocaleString() : "—"}
              </Row>
            </div>

            <div className="mt-6 rounded-[18px] border border-danger/25 p-3.5 md:rounded-xl">
              <p className="text-[13px] font-medium text-ink">Delete this app</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Removes the project and everything in it. This cannot be undone.
              </p>
              {confirming ? (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={async () => {
                      if (!project) return;
                      if (await remove(project.id)) {
                        router.push("/dashboard");
                      }
                    }}
                    className="h-10 flex-1 rounded-xl bg-danger px-3 text-[13px] font-medium text-white transition-colors hover:bg-danger md:h-8 md:rounded-lg"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="h-10 flex-1 rounded-xl border border-line/[0.09] px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] md:h-8 md:rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="mt-3 h-10 rounded-xl border border-danger/40 px-3.5 text-[13px] text-danger transition-colors hover:bg-danger/10 md:h-8 md:rounded-lg"
                >
                  Delete app
                </button>
              )}
            </div>
          </div>
        )}

        {section === "integrations" && (
          // Keyed on the category so arriving from Payments opens on that drawer
          // rather than on whatever was last chosen.
          <Integrations key={integrationsCategory} initialCategory={integrationsCategory} />
        )}

        {section === "payments" && (
          <div className="w-full max-w-[520px] px-4 py-4 lg:pl-5">
            <h2 className="text-[17px] font-semibold text-ink">Payments</h2>
            <p className="mt-1 text-[13px] text-muted">
              What you pay to build here, and what your app charges for.
            </p>

            <div className="mt-4 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
              <p className="text-[14px] font-medium text-ink">Your plan and credits</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Billing for building on QuickStark.Ai — the plan, the credit balance and top-ups.
              </p>
              <button
                onClick={onUpgradeClick}
                className="mt-3 h-10 rounded-xl bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 md:h-8 md:rounded-lg"
              >
                Manage plan
              </button>
            </div>

            <div className="mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
              <p className="text-[14px] font-medium text-ink">Charging in this app</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                To take card payments from the people who use your app, add a payments provider.
              </p>
              <button
                onClick={() => {
                  setIntegrationsCategory("Payments");
                  setSection("integrations");
                }}
                className="mt-3 h-10 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink md:h-8 md:rounded-lg"
              >
                Browse payment integrations
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* The phone.

     The pair in the header up top already switches chat and app, so this header
     does not carry a second one — two segmented controls stacked, one of them
     also labelled Preview, is a desktop layout shrunk rather than a phone
     screen. It names the app and offers the three things you do to it, in the
     glass the phone header is already made of.

     Manage is a screen of its own for the same reason: at 414px a navigation
     column beside a preview is neither of them. */
  if (!isDesktop) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-[53px] shrink-0 items-center gap-2 px-3">
          <button onClick={onBackToChat} aria-label="Back to the conversation" className={glass}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {project?.name ?? "Loading…"}
          </p>

          <button onClick={share} aria-label="Copy link" className={glass}>
            {shared ? <Check className="h-4 w-4 text-accent" /> : <Link2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setView("manage")}
            aria-label="Manage your app"
            className={glass}
          >
            <ManageMark className="h-4 w-4" />
          </button>
          <div className="relative" ref={publishRef}>
            <button
              onClick={() => setPublishOpen(true)}
              aria-expanded={publishOpen}
              className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-[#FFE998] to-[#FFE07A] px-3 text-[12px] font-semibold text-[#3a2e00] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_18px_rgba(255,224,122,0.14)] transition-all active:scale-[0.98]"
            >
              <Rocket className="h-3.5 w-3.5" />
              Publish
            </button>
            <Popover
              open={publishOpen}
              onClose={() => setPublishOpen(false)}
              title="Publish this app"
            >
              {publishBody}
            </Popover>
          </div>
        </header>

        {preview}

        {view === "manage" &&
          createPortal(
            <div className="fixed inset-0 z-[70] flex flex-col bg-canvas">
              <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line/[0.06] px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                <h2 className="text-base font-semibold tracking-tight text-ink">
                  Manage your app
                </h2>
                <button
                  onClick={() => setView("preview")}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-line/[0.06] bg-layer/[0.04] text-ink/70 transition-all hover:bg-layer/[0.08] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              {manage}
            </div>,
            document.body,
          )}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* One row, one height. The switch, the four things you do to an app, the
          publish button and the way out of the pane all stand 36px tall on the
          same centre line, in the order they are reached for: what you are
          looking at, help with it, the app itself, sharing it, shipping it, and
          then closing the pane. */}
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-line/[0.06] px-3">
        <div
          role="group"
          aria-label="Workspace view"
          className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-line/[0.07] bg-sunken/70 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]"
        >
          <button
            onClick={() => setView("preview")}
            aria-pressed={view === "preview"}
            title="Preview"
            className={segment(view === "preview")}
          >
            <PreviewMark className="h-[15px] w-[15px] shrink-0" />
            <span className="hidden lg:inline">Preview</span>
          </button>
          <button
            onClick={() => setView("manage")}
            aria-pressed={view === "manage"}
            title="Manage"
            className={segment(view === "manage")}
          >
            <ManageMark className="h-[15px] w-[15px] shrink-0" />
            <span className="hidden lg:inline">Manage</span>
          </button>
        </div>

        <div className="relative flex min-w-0 shrink-0 items-center gap-1.5" ref={publishRef}>
          {/* Quinn, the assistant already floating in the corner of this screen.
              The button asks it to open rather than starting a second thread:
              there is one conversation with support, wherever it is opened
              from. Hidden below lg, where the corner launcher is the only one
              the row has room for. */}
          <button
            onClick={requestSupportChat}
            title="Need help?"
            className={`hidden ${action} lg:flex`}
          >
            <LifeBuoy className="h-4 w-4 shrink-0" />
            <span className="hidden 2xl:inline">Need help?</span>
          </button>

          {divider}

          {/* The app on its own, outside this pane. An anchor when there is
              somewhere to go and a dead button when there is not — an anchor
              with no href is not a control, it is text that takes focus. */}
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              title="Open in a new tab"
              aria-label="Open the app in a new tab"
              className={`${action} w-9 px-0`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button
              disabled
              title="Nothing to open yet"
              aria-label="Open the app in a new tab"
              className={`${action} w-9 px-0`}
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}

          {/* A build writes to the same address, so the frame has to be told to
              look again. Disabled until there is something to look at, so it
              cannot promise a refresh of nothing. */}
          <button
            onClick={() => setReloads((count) => count + 1)}
            disabled={!previewUrl}
            title="Reload the preview"
            aria-label="Reload the preview"
            className={`${action} w-9 px-0`}
          >
            <RotateCw className="h-4 w-4" />
          </button>

          {divider}

          <button
            onClick={share}
            title="Copy a link to this app"
            className={action}
          >
            {shared ? (
              <Check className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <Link2 className="h-4 w-4 shrink-0" />
            )}
            <span className="hidden xl:inline">{shared ? "Link copied" : "Share"}</span>
          </button>

          <button
            onClick={() => setPublishOpen((open) => !open)}
            aria-expanded={publishOpen}
            title="Publish this app"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-solid px-3 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 active:scale-[0.98]"
          >
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">Publish</span>
          </button>

          {/* The way out of this half. The conversation takes the whole
              workspace and a button on the edge brings the pane back — see
              Workspace. Only where there is a second half to fall back on. */}
          {onClose && (
            <>
              {divider}
              <button
                onClick={onClose}
                title="Close the preview"
                aria-label="Close the preview"
                className={`${action} w-9 px-0`}
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}

          <Popover open={publishOpen} onClose={() => setPublishOpen(false)} title="Publish this app">
            {publishBody}
          </Popover>
        </div>
      </header>

      {view === "preview" ? preview : manage}
    </section>
  );
}
