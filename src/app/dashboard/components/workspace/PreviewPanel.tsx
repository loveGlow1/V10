"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Blocks,
  Check,
  CreditCard,
  Link2,
  Monitor,
  Rocket,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { avatarFor } from "../../projectColours";
import { isPublished, useProjects, type Project } from "../../ProjectsContext";
import type { IntegrationCategory } from "../../integrations";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PUBLISH_SUBDOMAIN, SITE_URL } from "@/lib/site";
import Integrations from "./Integrations";
import Popover from "./Popover";
import { closeTab } from "./openTabs";

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
}: {
  project: Project | null;
  onUpgradeClick: () => void;
  request: ManageRequest | null;
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
  const publishRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(project?.name ?? ""), [project?.name]);

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

  const segment = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
      active ? "bg-layer/[0.08] text-ink" : "text-muted hover:text-ink"
    }`;

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
      <button
        disabled
        className="mt-3 h-10 w-full rounded-xl bg-layer/[0.08] text-[13px] font-medium text-muted md:h-8 md:rounded-lg"
      >
        Publish app
      </button>
    </>
  );

  const preview = (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-line/[0.07] bg-layer/[0.02] px-6 text-center">
        <span className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${avatarFor(project?.id)}`} />
        <p className="mt-4 text-[15px] text-ink">Nothing to preview yet</p>
        <p className="mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
          Your app renders here the moment the first build finishes.
        </p>
      </div>
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
                        closeTab(project.id);
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
          <span
            className={`h-6 w-6 shrink-0 rounded-lg bg-gradient-to-br ${avatarFor(project?.id)}`}
          />
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
            <SlidersHorizontal className="h-4 w-4" />
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
      <header className="flex h-[53px] shrink-0 items-center justify-between gap-2 border-b border-line/[0.06] px-3">
        <div
          role="group"
          aria-label="Workspace view"
          className="flex items-center gap-0.5 rounded-full border border-line/[0.07] bg-layer/[0.02] p-0.5"
        >
          <button
            onClick={() => setView("preview")}
            aria-pressed={view === "preview"}
            className={segment(view === "preview")}
          >
            <Monitor className="h-3.5 w-3.5" />
            Preview
          </button>
          <button
            onClick={() => setView("manage")}
            aria-pressed={view === "manage"}
            className={segment(view === "manage")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Manage
          </button>
        </div>

        <div className="relative flex shrink-0 items-center gap-2" ref={publishRef}>
          <button
            onClick={share}
            className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.09] px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
          >
            {shared ? (
              <Check className="h-3.5 w-3.5 text-accent" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            {shared ? "Link copied" : "Share"}
          </button>

          <button
            onClick={() => setPublishOpen((open) => !open)}
            aria-expanded={publishOpen}
            className="flex h-8 items-center gap-1.5 rounded-full bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90"
          >
            <Rocket className="h-3.5 w-3.5" />
            Publish
          </button>

          <Popover open={publishOpen} onClose={() => setPublishOpen(false)} title="Publish this app">
            {publishBody}
          </Popover>
        </div>
      </header>

      {view === "preview" ? preview : manage}
    </section>
  );
}
