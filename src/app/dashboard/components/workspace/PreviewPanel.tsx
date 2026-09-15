"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Blocks,
  Check,
  ChevronLeft,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  Loader2,
  Link2,
  RotateCw,
  Rocket,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { isProjectSummary } from "@/lib/builder/project-summary";
import { avatarFor } from "../../projectColours";
import { creditCostOf, formatCredits } from "../../credits";
import { isPublished, useProjects, type Project } from "../../ProjectsContext";
import type { IntegrationCategory } from "../../integrations";
import { requestSupportChat } from "../../supportChat";
import { useMediaQuery } from "@/hooks/use-media-query";
import { SITE_URL } from "@/lib/site";
import { publishedLabel, publishedUrl, previewUrl as projectPreviewUrl } from "@/lib/publish/naming";
import type { Diagnosis } from "@/lib/publish/diagnosis";
import PublishPanel from "./PublishPanel";
import { safeHttpUrl } from "@/lib/safe-url";
import Integrations from "./Integrations";
import BackendPanel from "./BackendPanel";
import { ManageMark, PreviewMark, SupportMark } from "./panelMarks";
import Popover from "./Popover";

type ManageSection = "settings" | "database" | "integrations" | "payments";

/* A request from the other half of the workspace to show a particular drawer.
   The counter is what makes a second, identical request register: pressing the
   composer's GitHub button twice should bring the pane back both times. */
export type ManageRequest = {
  section: ManageSection;
  category: IntegrationCategory;
  n: number;
};

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
  publishRequest,
  onBackToChat,
  onClose,
}: {
  project: Project | null;
  onUpgradeClick: () => void;
  request: ManageRequest | null;
  /* A counter, bumped when something outside asks for the publish flow — the
     chat's result card. A counter rather than a boolean for the same reason
     ManageRequest carries one: asking twice has to register twice. */
  publishRequest?: number;
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
  /* Running the app, for a build that is a project rather than a page.
   *
   * A project build's preview is a written summary of its files — honest, and
   * not an app. The files were always there; nothing in the system could
   * compile them. This asks the server to take the newest build's stored tree
   * and have Vercel build and host it, which costs no credits and regenerates
   * nothing: it is the same source, run.
   *
   * The failure is shown rather than swallowed. The commonest one by far is
   * this deployment having no VERCEL_API_TOKEN, and that sentence in front of
   * the person who can add it is worth more than a disabled button. */
  const [deployed, setDeployed] = useState<string | null>(null);
  /* Whether the site at that address is still this project.
   *
   * False means the newest build has not been deployed — which is now the
   * ordinary state of an edited project, because building is not publishing.
   * The frame must show the newest SOURCE in that case, not the older site.
   * See the note on `current` in /api/projects/[id]/deploy. */
  const [liveIsCurrent, setLiveIsCurrent] = useState(true);
  /* Whether the live site can be displayed in this pane at all.
   *
   * Up and framable are different questions. A deployment behind Vercel's
   * Deployment Protection opens perfectly in a tab — the team's cookie goes
   * with it — and answers 401 in a cross-site frame, where it does not. The
   * browser's only feedback is a blank rectangle. Asked of the server, which
   * can go and look. See lib/publish/framable.ts. */
  const [liveViewable, setLiveViewable] = useState(true);
  const [liveBlockedReason, setLiveBlockedReason] = useState<string | null>(null);
  /* The address exists and the site behind it does not, yet.
   *
   * Vercel answers as soon as it has ACCEPTED the upload; installing and
   * compiling a Next.js project takes another one to three minutes. The pane
   * used to swap to that address the instant the response came back, so
   * pressing Deploy replaced a working preview of the landing page with a
   * blank white rectangle for the length of the build — the app was fine, it
   * simply was not there yet.
   *
   * So the two things are separated. The ADDRESS is shown the moment there is
   * one, because it is real and people want to copy it. The PANE keeps showing
   * what it was showing until the site is actually up. */
  const [building, setBuilding] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  /* The same failure, read rather than printed.
   *
   * `deployError` is the build log — evidence, and correct to keep. This is
   * what it MEANS: a sentence about what happened, a sentence about what
   * happens next, and whether QuickStark can simply fix it. The log goes behind
   * a disclosure, which is where a log belongs. See lib/publish/diagnosis.ts. */
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  /* Whether the technical panel is open. Closed by default and per failure: a
     log that unfurls itself has taken the place of the summary again. */
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    const id = project?.id;
    if (!id) return;

    let current = true;
    /* Reset per project: the previous one's answer is not this one's. */
    setDeployed(null);
    setLiveIsCurrent(true);
    setLiveViewable(true);
    setLiveBlockedReason(null);
    setBuilding(false);
    setDeployError(null);
    setDiagnosis(null);
    setShowLog(false);

    fetch(`/api/projects/${id}/deploy`)
      .then((response) => (response.ok ? response.json() : { available: false }))
      .then((body: {
        available?: boolean;
        ready?: boolean;
        url?: string | null;
        /* Whether that address is serving the newest build. */
        current?: boolean;
        /* True while the newest deployment is still compiling. The address is
           real; the site behind it is not up yet. */
        building?: boolean;
        /* Whether it can be shown in this pane, and why not when it cannot. */
        viewable?: boolean;
        viewableReason?: string | null;
        /* Why the last attempt produced no address. Distinct from `reason`,
           which is about this DEPLOYMENT's configuration rather than about
           this project's last build. */
        failure?: string | null;
        /* The readable form of `failure`, built on the server so the workspace
           and the chat say the same thing about the same failure. */
        diagnosis?: Diagnosis | null;
        reason?: string | null;
      }) => {
        if (!current) return;
        /* Straight into the pane. This runs when the workspace opens, so a
           project that was deployed an hour ago is showing its app before
           anybody presses anything. */
        if (body.url) setDeployed(body.url);
        setLiveIsCurrent(body.current !== false);
        setBuilding(body.building === true);
        setLiveViewable(body.viewable !== false);
        setLiveBlockedReason(body.viewableReason ?? null);
        /* Carried before anything is pressed. If hosting is not configured, the
           account that can configure it should be able to read that from the
           button rather than from a failed attempt. */
        if (body.available === true && body.ready === false && body.reason) {
          setDeployError(body.reason);
          setDiagnosis(body.diagnosis ?? null);
        } else if (body.failure) {
          /* The last attempt's own diagnosis, from the build row. Read on load
             so somebody returning to a project that did not host still finds
             out why — it used to exist only in the tab where it happened and
             then be gone. */
          setDeployError(body.failure);
          setDiagnosis(body.diagnosis ?? null);
        }
      })
      .catch(() => {
        /* The workspace works without this answer: it only decides what is
           said about a live address, and there is not one. */
      });

    return () => {
      current = false;
    };
  }, [project?.id]);

  const [draft, setDraft] = useState(project?.name ?? "");
  const [confirming, setConfirming] = useState(false);
  /* Bumped by the reload button and used as the frame's key, which is what
     remounts it. Reaching into the frame to call location.reload() is not
     available here: it is another origin, and deliberately sandboxed. */
  const [reloads, setReloads] = useState(0);

  useEffect(() => setDraft(project?.name ?? ""), [project?.name]);

  /* These come from the build orchestrator by way of the projects row, so they
     are checked before they reach an href or an iframe src — see
     src/lib/safe-url.ts. Null means "do not render a link", never "render a
     broken one". */
  /* Derived from the project, not read from preview_url.
   *
   * The stored column is written when a build finishes, so it lags: a project
   * that had an address reserved after its last build still held the old long
   * form, and the panel showed it. Deriving means the address shown is always
   * the address the project has now — and it upgrades from /preview/<id> to
   * /<slug>/preview the moment a slug exists, with no rebuild and no backfill.
   *
   * safeHttpUrl still guards the result: it is built from SITE_URL, but a
   * misconfigured environment should not put a broken href on the page. */
  /* ── The live address, and when a customer is allowed to see it ─────────
   *
   * Only after an actual publish. A deployment can exist without one — the
   * workspace's own "run this project" control creates one, and so did every
   * build back when a build deployed itself — and showing that address before
   * anybody pressed Publish offers a public URL for something the customer has
   * not agreed to make public. It also makes Publish look like it did nothing,
   * because the address was already there.
   *
   * So before publishing, the only address on offer is the QuickStark preview,
   * which is private to its owner and is what a preview should be. The Vercel
   * domain appears when the project is published and not one moment sooner.
   *
   * `deployed` is kept as it was because the FRAME still uses it: a published
   * project shows its real compiled site, and the checks around it — current,
   * viewable — are about that. This is the narrower question of what address is
   * put in front of a person. */
  const publishedLive = project && isPublished(project) ? deployed : null;

  const previewUrl = safeHttpUrl(project ? projectPreviewUrl(project) : null);
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

  /* When the page behind that path last changed. Watched rather than the path
     itself, which is the same string for every build this project ever has. */
  const lastBuiltAt = project?.last_build_at ?? null;
  const [pageHtml, setPageHtml] = useState<string | null>(null);
  const [pageFailed, setPageFailed] = useState(false);
  /* Whether what came back is a receipt rather than a page.
   *
   * A Next.js project stores its .tsx in project_files and a SUMMARY of itself
   * in the html column. This pane fetched that column and framed whatever it
   * got — so a customer who asked for a real-estate platform was shown a
   * document headed "A web app built as a Next.js project — 19 files", listing
   * routes and file counts, with their actual application nowhere on screen.
   * That is a receipt for the work, not the work, and it is not what a preview
   * pane is for.
   *
   * WHAT CHANGED UNDER THIS. The reason the receipt existed — that nothing here
   * runs `next build`, so a tree of source cannot be shown to anybody — is no
   * longer true. /preview/[projectId] compiles the tree in the browser and
   * serves the running application instead (see lib/builder/preview), so for
   * almost every project this flag is now false and the frame holds the real
   * thing.
   *
   * It is kept because the fallback is kept: a tree this renderer cannot route
   * still falls through to the summary on the server, and framing a receipt
   * would be as wrong then as it was before. So this stays as the guard for
   * that case — rarer now, and no longer the ordinary path. See
   * isProjectSummary. */
  const [isReceipt, setIsReceipt] = useState(false);

  useEffect(() => {
    if (!previewUrl || !previewPath) {
      setPageHtml(null);
      setPageFailed(false);
      setIsReceipt(false);
      return;
    }

    let cancelled = false;
    setPageHtml(null);
    setPageFailed(false);
    setIsReceipt(false);

    void fetch(previewPath, { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        if (cancelled) return;
        setPageHtml(html);
        setPageFailed(html === null);
        setIsReceipt(isProjectSummary(html));
      })
      .catch(() => {
        if (!cancelled) setPageFailed(true);
      });

    return () => {
      cancelled = true;
    };
    /* `reloads` is a dependency on purpose: the refresh button rebuilds the
       page rather than only remounting a frame around the same copy.

       `lastBuiltAt` is here for the reason that matters more. A rebuild of the
       same project produces the SAME preview_url and the same path — the id
       never changes — so neither of those moves when a new page lands, and this
       frame went on showing the previous version until somebody reloaded the
       browser. The build stamp is the only thing in the row that says "this is
       a different page now", which makes it the only honest dependency for
       "fetch it again". */
  }, [previewUrl, previewPath, reloads, lastBuiltAt]);

  useEffect(() => {
    if (!publishRequest) return;
    /* The preview half, with the publish panel open — the same one the header
       button opens, rather than a second flow that would have to say the same
       things about cost and readiness. */
    setView("preview");
    setPublishOpen(true);
  }, [publishRequest]);

  useEffect(() => {
    if (!request) return;
    setView("manage");
    setSection(request.section);
    setIntegrationsCategory(request.category);
  }, [request]);

  /* The outside-press handler that used to live here is gone, and its absence
     is the fix rather than a simplification.
   *
     It was written when the publish card was an absolutely-positioned child of
     publishRef, so "not inside publishRef" meant "outside the menu". The card
     is portalled into the body now — see AnchoredPanel — which makes every
     press inside it, the Publish button included, read as outside. The panel
     unmounted on mousedown, mouseup landed on nothing, and no click was ever
     born: the button was dead, silently, with no error to report because
     nothing had run. Popover passes onClose down to AnchoredPanel, whose own
     handler excludes both the card and the control it hangs off. */

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
    "flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-line/[0.08] bg-layer/[0.04] px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.08] hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

  /* A rule between groups of controls: what the app is, what you do to it, and
     the way out of the pane. Without them the eight controls read as one queue
     and the eye has to count. */
  const divider = <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line/[0.09]" />;

  /* The material of the four controls in the phone Manage screen's header.
     Squarer and quieter than `glass` above: that one sits over the workspace's
     blue and has to hold its own against it, while these sit on a flat panel
     over the whole screen. 32px, which is what lets four of them and a title
     share a 390px line; disabled reads as dimmed rather than as missing, the
     way the desktop row's dead controls do. */
  const manageAction =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/[0.06] bg-layer/[0.04] text-ink/70 transition-all hover:bg-layer/[0.08] hover:text-ink disabled:pointer-events-none disabled:opacity-40";

  /* Glass over the blue, the material every control in the phone header is made
     of: a translucent fill, a hairline rim, one pixel of light along the top. */
  const glass =
    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-line/[0.14] bg-layer/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors active:scale-[0.98]";

  const sections: { id: ManageSection; label: string; icon: typeof Blocks }[] = [
    { id: "settings", label: "App settings", icon: SlidersHorizontal },
    /* Between the app's own settings and the services it can be wired to,
       which is where it belongs: the database is not an integration to go
       shopping for, it is the one every generated app already has. */
    { id: "database", label: "Database", icon: Database },
    { id: "integrations", label: "Integrations", icon: Blocks },
    { id: "payments", label: "Payments", icon: CreditCard },
  ];

  /* The publish flow, which is a real one now: it calls /api/publish, reports
     what came back, and only says an app is live when the server said so. See
     PublishPanel — the button used to be disabled with a note promising it
     would work once a build finished. */
  /* ── Whether this app is live, and where ───────────────────────────────
   *
   * Both headers below showed the same "Publish" button whether a project had
   * been live for a month or had never been deployed, and the address was two
   * clicks away inside a popover. So the one thing somebody wants after
   * publishing — to look at the thing they published — was the one thing the
   * button did not offer.
   *
   * Read from the project row rather than from publish state held in the panel:
   * the panel is unmounted until its popover opens, so a header that waited for
   * it would show "Publish" on a live app until somebody clicked to find out.
   *
   * isPublished rather than the status, deliberately. Every build overwrites
   * status, so a published app that has since been edited reads as unpublished
   * while its site is still up — see lib/project-status.ts. */
  const liveSlug = project && isPublished(project) ? project.slug : null;

  const publishBody = (
    <PublishPanel
      projectId={project?.id ?? null}
      hasBuild={Boolean(project?.last_build_at)}
      slug={project?.slug ?? null}
      publishedAt={project?.published_at ?? null}
      priceNote={
        project && isPublished(project)
          ? `Redeploying costs ${formatCredits(creditCostOf("publish", { alreadyPublished: true }))} credit.`
          : `Going live costs ${formatCredits(creditCostOf("publish"))} credits, then ${formatCredits(
              creditCostOf("publish", { alreadyPublished: true }),
            )} per deploy after that.`
      }
    />
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
          {/* Nothing is written across the top of the frame. What used to sit
              here was a private preview URL — nothing to click, nothing to do
              with it, and on every screenshot and screen-share of somebody's
              own build; the project's name in its place said no more, in a
              panel that is already inside that project. The browser shows an
              address when the preview is opened in a tab, which is where an
              address belongs.

              So the strip exists only for the two controls a phone has no
              header room for. From md up the header above carries both and the
              whole strip stands down rather than reserving nine pixels of
              border for nothing. */}
          <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-line/[0.06] px-2.5 md:hidden">
            <button
              onClick={() => setReloads((count) => count + 1)}
              aria-label="Reload the preview"
              className="shrink-0 rounded-md p-1 text-ink transition-colors hover:bg-layer/[0.06]"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md px-1.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-layer/[0.06]"
            >
              Open
            </a>
          </div>
          {/* ── Why it is not hosted, where somebody will read it ───────────
           *
           * This diagnosis existed and lived in a `title` attribute on the Run
           * app button — which is to say it was a tooltip on a control that
           * says "Couldn't host", requiring somebody to hover a button they
           * have already been told did not work, on a device that may not have
           * a pointer at all. The comment beside that tooltip says a failure
           * living only in a tooltip is a failure most people never read. It
           * was right, and it was describing itself.
           *
           * What it is hiding is worth reading: Deployment Protection with the
           * setting to turn off, a type error with the file and line, or the
           * tail of the build log. Shown, not hovered.
           *
           * Above the pane rather than instead of it: the summary underneath is
           * still the honest account of what was built, and replacing it with
           * an error would take away the one thing that did work. */}
          {deployError && !deployed ? (
            <div className="shrink-0 border-b border-line/[0.06] bg-layer/[0.03] px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">
                {diagnosis?.headline ?? "Deployment needs attention"}
              </p>
              {/* ── What happened, not what was printed ───────────────────
               *
               * This used to be the build log, verbatim, in the pane: thirty
               * lines beginning "Running build in Washington, D.C." and ending
               * in a type error, shown to somebody who typed a sentence about
               * a bakery. They cannot act on it and cannot tell whether their
               * project is broken or this platform is.
               *
               * So it is the diagnosis now, and the log is behind the
               * disclosure below — kept in full, filed where a log belongs.
               * When the server could not make sense of the failure it says
               * so rather than guessing, and the raw text is still one click
               * away. See lib/publish/diagnosis.ts. */}
              <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">
                {diagnosis?.summary ?? deployError.replace(/\n\nFull build log: https?:\/\/\S+/, "")}
              </p>
              {diagnosis?.next ? (
                <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">{diagnosis.next}</p>
              ) : null}
              {/* The file it is about, when the build named one. Worth its own
                  line: it is the one piece of the log a person can match
                  against something they asked for. */}
              {diagnosis?.file ? (
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted/80">{diagnosis.file}</p>
              ) : null}

              {/* ── The project is still here ─────────────────────────────
               *
               * Said explicitly, because the failure is the loudest thing on
               * the screen and somebody reading it has every reason to assume
               * their work is gone. It is not: the pane below this is
               * rendering their project from its own source, and has been the
               * whole time. A deployment is a copy of the project going to a
               * public address, and a copy that did not arrive leaves the
               * original exactly where it was. */}
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Your project is unaffected — what you see below is still it.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Offered only where pressing it would do something. A button
                    that says it can fix this and then cannot is worse than no
                    button, so the server decides — see Diagnosis.automatic. */}
                {/* Offered only where pressing it would do something, and it
                    opens PUBLISH rather than deploying by itself: the repair
                    happens on the way out of a publish, so retrying one is how
                    this class of failure is actually fixed. A second deploying
                    control here would be a public address without a publish. */}
                {diagnosis?.automatic ? (
                  <button
                    type="button"
                    onClick={() => setPublishOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line/[0.10] bg-layer/[0.06] px-2 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-layer/[0.10]"
                  >
                    Fix and publish again
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowLog((open) => !open)}
                  className="rounded-md px-1.5 py-1 text-[12px] font-medium text-muted underline underline-offset-2 transition-colors hover:bg-layer/[0.06] hover:text-ink"
                  aria-expanded={showLog}
                >
                  {showLog ? "Hide technical details" : "View technical details"}
                </button>
                {/* Vercel's own page for the deployment, when the reason
                    carried one. A tail is not always where the cause is, and
                    this is the whole log. */}
                {(() => {
                  const log = deployError.match(/https?:\/\/vercel\.com\/\S+/)?.[0];
                  return log ? (
                    <a
                      href={log}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted underline underline-offset-2 transition-colors hover:bg-layer/[0.06] hover:text-ink"
                    >
                      Full build log
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : null;
                })()}
              </div>

              {showLog ? (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-line/[0.08] bg-layer/[0.05] p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted">
                  {diagnosis?.detail ?? deployError}
                </pre>
              ) : null}
            </div>
          ) : null}

          {/* ── The live site is behind this preview ──────────────────────
           *
           * Shown when the project is deployed and the newest build is not the
           * one that was deployed, which is the ordinary state of an edited
           * project now that an edit no longer publishes itself.
           *
           * The frame below is showing the NEWEST source, which is the true
           * state of the project and the right thing to show. But the customer
           * also has a site up at an address they have given people, and that
           * site is now older than what they are looking at. Leaving that
           * unsaid would be its own quiet lie — they would reasonably assume
           * the thing on screen is what visitors get. So both facts are on
           * screen: this is your project, that is your site, and Publish is
           * what closes the gap. */}
          {/* ── The live site is up, and cannot be shown here ─────────────
           *
           * The one that reads as a broken product when it is not. The address
           * opens cleanly in a tab and refuses to be framed, so the pane used
           * to hold a blank white rectangle with nothing anywhere saying why —
           * and the customer's reasonable conclusion was that the app this
           * platform built them is broken. It is not: it is running, and the
           * browser is declining to display somebody else's page inside ours.
           *
           * The frame below now shows the project rendered from its own source
           * instead, so there is something real to look at either way. This
           * says what happened and gives them the link, because opening it in
           * a tab is the one thing that definitely works. */}
          {publishedLive && !building && !liveViewable ? (
            <div className="shrink-0 border-b border-line/[0.06] bg-layer/[0.03] px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">Your site is live, but cannot be shown here</p>
              <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">
                {liveBlockedReason ??
                  "The site refuses to be displayed inside another page, which is a setting on the host rather than a problem with your project."}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                It opens normally in its own tab, and the preview below is your project rendered
                from its own files.
              </p>
              <a
                href={publishedLive}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-ink underline underline-offset-2 transition-colors hover:bg-layer/[0.06]"
              >
                Open it in a tab
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          ) : null}

          {publishedLive && !building && !liveIsCurrent ? (
            <div className="shrink-0 border-b border-line/[0.06] bg-layer/[0.03] px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">Your live site is behind this preview</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                You are looking at the newest version of your project. The site at the address
                below is still serving the last version you published.
              </p>
              <a
                href={publishedLive}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-ink underline underline-offset-2 transition-colors hover:bg-layer/[0.06]"
              >
                {publishedLive.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          ) : null}

          {/* The address, while the site behind it is still being built.
           *
           * This is the half that was missing. Deploy handed back a real
           * address and the only thing the panel did with it was point the
           * frame at a site that did not exist yet — so the one moment
           * somebody wants to copy their link is the moment the pane went
           * blank and gave them nothing to copy.
           *
           * The domain, not the deployment. Vercel gives a build two hosts:
           * the per-build one carrying a hash, which its team settings put
           * behind a login, and the project's own alias, which is public. The
           * second is what arrives here — see stableHost — and it is the one
           * worth putting in front of somebody. */}
          {deployed && building ? (
            <div className="shrink-0 border-b border-line/[0.06] bg-layer/[0.03] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                Building your app
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                It will answer at the address below in a minute or two. Until then this pane keeps
                showing what you already had.
              </p>
              <a
                href={deployed}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 break-all text-[12px] font-medium text-emerald-300 underline underline-offset-2"
              >
                {deployed.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          ) : null}

          {/* The running app wins over the receipt.
           *
           * A project build's stored page is a written summary of its files —
           * honest, and not the app. Once the project has been built and hosted
           * there is a real address, and showing the summary beside it would be
           * describing something the visitor could simply be looking at.
           *
           * `src` rather than `srcDoc`: this is a real site on its own origin,
           * which is a stronger boundary than the opaque one srcDoc gets, and
           * the app needs its own origin anyway to hold a Supabase session. */}
          {publishedLive && !building && liveIsCurrent && liveViewable ? (
            <iframe
              key={`${publishedLive}#${reloads}`}
              src={publishedLive}
              title={`${project?.name ?? "App"} — live`}
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
              className="min-h-0 flex-1 border-0 bg-white"
            />
          ) : isReceipt ? (
            /* The summary came back, which now means the renderer could not
               route this tree — a scaffold that stopped halfway, or a shape it
               does not know. Framing the receipt would be showing somebody an
               inventory of their application instead of their application, so
               this goes here instead.
               
               WHAT THIS MUST NOT SAY is that the project has to be put online
               to be looked at. That was true when deployment was the only
               renderer and it is not true now: the ordinary path renders the
               application in this frame without deploying anything. Saying it
               here would send somebody to Vercel for something the builder can
               already do, and would be the exact confusion — deployment as the
               price of seeing your own work — that the preview renderer exists
               to end. So it says what actually happened, and offers the two
               things that are genuinely useful: the file-by-file account, and
               putting it online if that is what they wanted anyway. */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-white px-6 text-center">
              <p className="text-[15px] font-semibold text-slate-900">
                {project?.name ?? "Your app"} is built
              </p>
              <p className="max-w-[340px] text-[13px] leading-relaxed text-slate-500">
                This one could not be rendered in the preview, so here is everything that was
                made instead. Your files are all there, and the project can still be put online.
              </p>
              {previewPath ? (
                <a
                  href={`${previewPath}${previewPath.includes("?") ? "&" : "?"}diagnostics=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-slate-900 underline underline-offset-2"
                >
                  See what was built
                </a>
              ) : null}
              {/* Publish, rather than a deploy of its own. Putting a project
                  online is one act with one control; a second one here would
                  be a way to get a public address without publishing. */}
              <button
                onClick={() => setPublishOpen(true)}
                className="mt-1 flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white transition-opacity"
              >
                Publish it
              </button>
            </div>
          ) : pageHtml !== null ? (
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
                {/* The real one, or nothing. This used to derive an address
                    from the project's name and show it whether or not anything
                    was live — so a project that had never been published
                    displayed a confident URL that resolved to nothing, and
                    renaming it appeared to move a site that did not exist. */}
                {project?.slug ? (
                  <a
                    href={publishedUrl(project.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-accent hover:underline"
                  >
                    {publishedLabel(project.slug)}
                  </a>
                ) : (
                  <span className="text-soft">Gets one when you publish</span>
                )}
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

        {section === "database" && <BackendPanel projectId={project?.id ?? null} />}

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
          <div className="relative">
            {/* Live: the pill IS the published site.
             *
             * The phone is where this matters most. On a laptop the address is
             * a click away in the panel and there is a browser around it; on a
             * phone the workspace is the whole screen, and "it published" and
             * "here it is" were the same two-step nobody completed. So the left
             * half is a real anchor carrying the address — one tap and you are
             * looking at the thing you published.
             *
             * Split rather than replaced, because publishing again and
             * connecting a domain still have to be reachable here: the right
             * half keeps the panel. The halves are about 62px and 36px at
             * 390px, both comfortably past the 24px a finger needs, and the
             * pair is no wider than the Publish button it stands in for — so
             * the project name beside it keeps the room it had.
             *
             * One shell rather than two pills: they are one object about one
             * thing, and the rounded ends belong to the pair. */}
            {liveSlug ? (
              <div className="flex h-[30px] shrink-0 items-stretch overflow-hidden rounded-full border border-line/[0.14] bg-layer/[0.10]">
                <a
                  href={publishedUrl(liveSlug)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open the published site, ${publishedLabel(liveSlug)}`}
                  className="flex items-center gap-1.5 pl-3 pr-2 text-[12px] font-semibold text-ink transition-opacity active:opacity-70"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4ADE80]" />
                  {/* The word, not the address.
                   *
                   * The address was tried here first and it does not fit: at
                   * 390px a legible slug leaves the project name as "Pe…", and
                   * a slug cut to fit — "peckham-sou…" — is worse than not
                   * showing one, because a truncated address tells you nothing
                   * and still costs the room. The word says the state, the
                   * arrow says it leaves, and the tap does the rest. The full
                   * address is in the panel and in the label below, where
                   * there is room for it to be read. */}
                  <span>Live</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                </a>

                <span aria-hidden className="my-1 w-px shrink-0 bg-line/[0.16]" />

                <button
                  onClick={() => setPublishOpen(true)}
                  aria-expanded={publishOpen}
                  aria-label="Publish again, or connect a domain"
                  className="flex items-center px-2.5 text-soft transition-opacity active:opacity-70"
                >
                  <Rocket className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setPublishOpen(true)}
                aria-expanded={publishOpen}
                className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-[#FFE998] to-[#FFE07A] px-3 text-[12px] font-semibold text-[#3a2e00] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_18px_rgba(255,224,122,0.14)] transition-all active:scale-[0.98]"
              >
                <Rocket className="h-3.5 w-3.5" />
                Publish
              </button>
            )}
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
              {/* The same four things a desktop keeps beside this pane.
               *
               * On a pointer the pane's header stays put while Manage is open,
               * so opening it in one column and copying its link in the next is
               * one screen. A phone draws Manage over everything, which took
               * that header away with it — so Manage there was the four sections
               * and nothing else, and the actions were somewhere behind it: the
               * link on the header underneath, opening the app in the preview
               * sheet, and Download nowhere on a phone at all.
               *
               * They are here now, in the order the desktop row has them. The
               * two that need something built are dead controls rather than
               * links to a 404 when there is nothing, exactly as they are on the
               * desktop. Publish stays out: it is a flow with its own panel and
               * its own state, and a second copy of that Popover in here would
               * be a second thing to keep in step — it is one tap away, on the
               * header this screen closes back onto. */}
              <header className="flex shrink-0 items-center gap-1.5 border-b border-line/[0.06] px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-ink">
                  Manage your app
                </h2>

                {previewUrl ? (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the app in a new tab"
                    className={manageAction}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : (
                  <button disabled aria-label="Nothing to open yet" className={manageAction}>
                    <ExternalLink className="h-4 w-4" />
                  </button>
                )}

                <button onClick={share} aria-label="Copy a link to this app" className={manageAction}>
                  {shared ? <Check className="h-4 w-4 text-accent" /> : <Link2 className="h-4 w-4" />}
                </button>

                {previewUrl ? (
                  <a
                    href={`/preview/${project?.id}?download=1`}
                    download
                    aria-label="Download this page"
                    className={manageAction}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                ) : (
                  <button disabled aria-label="Nothing to download yet" className={manageAction}>
                    <Download className="h-4 w-4" />
                  </button>
                )}

                <button
                  onClick={() => setView("preview")}
                  aria-label="Close"
                  className={manageAction}
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

        {/* gap-2 rather than gap-1.5, and px-3 rather than px-2.5 inside each
            control above. Six pixels between four labelled pills reads as one
            crowded block — the eye cannot find the edges, so the row looks
            cramped however well each button is drawn. Eight, with a little more
            room inside, is what separates them into a set of tiles. */}
        <div className="relative flex min-w-0 shrink-0 items-center gap-2">
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
            <SupportMark className="h-4 w-4 shrink-0" />
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

          {/* ── "Open app", and nothing that deploys ─────────────────────────
              This was a Run app button that created a Vercel deployment of its
              own. It is gone, because deploying is what Publish does and
              nothing else should: a second control that put a project online
              meant a public address could exist for a project nobody had
              agreed to publish, and it made Publish look like it did nothing
              because the address was already there.

              What is left is the link, and only once there is genuinely
              something to open — a project that has been published. Before
              that the pane itself is the preview, which is the whole point of
              rendering it in the builder. */}
          {publishedLive ? (
            <a
              href={publishedLive}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${publishedLive}`}
              className={action}
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline">Open app</span>
            </a>
          ) : null}

          {/* Download's permanent home, beside Publish. The copy in the chat
              card is the shortcut and it expires; this one does not, which is
              why it sits with the other thing you do to a finished app rather
              than somewhere of its own.

              An anchor, not a button: the route answers with a
              Content-Disposition, so the browser saves the file and this page
              stays where it is. A project with nothing built has nothing to
              take, so it is a dead control rather than a link to a 404. */}
          {previewUrl ? (
            <a
              href={`/preview/${project?.id}?download=1`}
              download
              title="Download this page"
              aria-label="Download this page"
              className={action}
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline">Download</span>
            </a>
          ) : (
            <button
              disabled
              title="Nothing to download yet"
              aria-label="Download this page"
              className={action}
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline">Download</span>
            </button>
          )}

          <button
            onClick={() => setPublishOpen((open) => !open)}
            aria-expanded={publishOpen}
            title="Publish this app"
            /* The same rhythm as the controls beside it — gap-2, px-3, h-9 —
               so the row is one set of tiles with the primary filled, rather
               than three of one size and a fourth of another. */
            className="flex h-9 shrink-0 items-center gap-2 rounded-xl bg-solid px-3 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 active:scale-[0.98]"
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
