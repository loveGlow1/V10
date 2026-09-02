"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import TopNav from "../TopNav";
import TopBar from "../TopBar";
import Sidebar from "../Sidebar";
import PhoneField from "../PhoneField";
import BillingModal from "../billing/BillingModal";
import AccountSettingsModal from "../AccountSettingsModal";
import SupportChat from "../SupportChat";
import WorkspaceTabs from "../WorkspaceTabs";
import { AGENTS } from "../../agents";
import { useCredits } from "../../useCredits";
import { useProjects } from "../../ProjectsContext";
import { useWorkspaceTabs } from "../../WorkspaceTabsContext";
import { isBuildKind } from "@/lib/builder/kinds";
import { browserAccessToken } from "@/lib/projects/client";
import { touchProject } from "@/lib/projects/queries";
import { safeHttpUrl } from "@/lib/safe-url";
import ChatPanel from "./ChatPanel";
import PreviewPanel, { type ManageRequest } from "./PreviewPanel";
import { PreviewMark } from "./panelMarks";
import PreviewSheet from "./PreviewSheet";

/* An opened app. The header and drawer are the ones Home carries, so moving
   between the two is a change of the area below the tabs and nothing else.

   From md up the two halves sit side by side. On a phone they share the screen
   and the pair already in the phone header switches between them, which is what
   that control was built for. */
export default function Workspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  /* Home sends here with ?prompt=… when it opens a brand new app. That is the
     first thing the conversation should say, so it is handed to the chat panel
     to send rather than being dropped on the floor. */
  const search = useSearchParams();
  const initialPrompt = search.get("prompt");
  /* And with ?kind=… when the target chip above the composer said what kind of
     thing it is. Validated rather than trusted: it arrives in an address bar,
     and an unrecognised word means "let the server work it out" rather than
     "build from a blueprint that does not exist". */
  const chosen = search.get("kind");
  const initialKind = isBuildKind(chosen) ? chosen : null;
  /* "?view=preview" is how the apps list says "they wanted to look at it".
     Read once on arrival rather than watched: closing the sheet must not be
     undone by the parameter still sitting in the address bar. */
  const openedOnPreview = search.get("view") === "preview";
  const { projects, loading, error, select } = useProjects();

  /* Opening an app is the signal the dashboard ranks on — see touch_project in
     supabase/schema.sql. It belongs here rather than on the rows that link
     here, because this is where every way in arrives: the apps list, the
     Projects page, the drawer, the tab strip, a fork, a shared link, and the
     redirect that follows starting a build. Touching it in each of those was
     six chances to add a seventh and forget.

     Once per app per visit. It also clears archived_at, so an app that had aged
     out is active again the moment it is opened, however it was reached — which
     is the rule the Projects page states and this is what enforces it. */
  const touched = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || touched.current === projectId) return;
    touched.current = projectId;
    void (async () => {
      const token = await browserAccessToken();
      /* Best effort, and deliberately unreported: this is a ranking hint, and
         nobody opening an app needs to be told its timestamp did not move. */
      if (token) await touchProject(token, projectId).catch(() => {});
    })();
  }, [projectId]);
  /* Opening an app puts it in the strip above, or brings the tab it already has
     forward — never a second one for the same app. */
  const { open: openTab } = useWorkspaceTabs();
  /* The account's own balance, not a constant. Refreshed after a build, which
     is the thing in this screen that spends. */
  const { label: credits, refresh: refreshCredits } = useCredits();
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;

  const [billingOpen, setBillingOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"preview" | "chat">("chat");
  const [manageRequest, setManageRequest] = useState<ManageRequest | null>(null);
  /* Bumped when the chat's result card asks to publish. The preview half owns
     that flow — one place that says what publishing costs and that it is not
     wired yet — so this asks for it rather than building a second one. */
  const [publishRequest, setPublishRequest] = useState(0);
  /* The preview sheet on a phone. Separate from `view`, which still switches
     this pane between the conversation and the Manage panes — the sheet is a
     layer over both rather than a third tab. */
  const [previewSheetOpen, setPreviewSheetOpen] = useState(openedOnPreview);
  /* Whether the preview keeps its column. Desktop only: the pane's close button
     hands the whole width to the conversation, which is what someone writing a
     long prompt wants, and the control on the edge brings it back. Unrelated to
     the sheet above, which is the phone's arrangement. */
  const [previewPaneOpen, setPreviewPaneOpen] = useState(true);
  const requests = useRef(0);

  /* The composer's GitHub button belongs to the chat half but its answer lives
     in the other one, so the request is made here, where both are in view. On a
     phone that also means bringing the preview half onto the screen. */
  function openIntegrations() {
    requests.current += 1;
    setManageRequest({ section: "integrations", category: "Source", n: requests.current });
    setView("preview");
    /* A request for a pane that has been put away has to reopen it, or the
       button answers by doing nothing visible at all. */
    setPreviewPaneOpen(true);
  }

  /* Opening the route is what selects the app, so a link, a reload and a click
     in the list all leave the account on the same project. */
  useEffect(() => {
    if (!project) return;
    select(project.id);
  }, [project, select]);

  /* And the same arrival opens its tab. It waits for the name rather than
     firing on the route, which is what keeps an id that belongs to no project
     of yours — a stale link, someone else's — out of the strip, and what lets a
     rename in the Manage pane reach the tab without a reload. */
  const projectName = project?.name;
  useEffect(() => {
    if (!projectName) return;
    openTab({ id: projectId, name: projectName });
  }, [projectId, projectName, openTab]);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-canvas">
      {/* The same light Home stands on, so moving between the two screens on a
          phone changes what is on the glass rather than the room behind it. */}
      <PhoneField />

      <TopNav
        onUpgradeClick={() => setBillingOpen(true)}
        onAccountSettingsClick={() => setAccountSettingsOpen(true)}
        projectName={project?.name ?? "No project yet"}
        credits={credits}
      />

      {/* Under the header and over the workspace, the way a browser puts its
          tabs between the chrome and the page. */}
      <WorkspaceTabs />

      <TopBar
        onMenuClick={() => setSidebarOpen(true)}
        onUpgradeClick={() => setBillingOpen(true)}
        credits={credits}
        projectName={project?.name ?? "Loading…"}
        onBack={() => router.push("/dashboard")}
      />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onUpgradeClick={() => {
          setSidebarOpen(false);
          setBillingOpen(true);
        }}
        onAccountSettings={() => setAccountSettingsOpen(true)}
        onNewTask={() => {
          setSidebarOpen(false);
          router.push("/dashboard");
        }}
        credits={credits}
      />

      <BillingModal open={billingOpen} onClose={() => setBillingOpen(false)} />
      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onUpgradeClick={() => {
          setAccountSettingsOpen(false);
          setBillingOpen(true);
        }}
        credits={credits}
        agents={AGENTS}
        selectedAgent="Q1"
      />
      <SupportChat />

      {/* Over everything, and only on a phone — the sheet hides itself from md
          up, where the preview already has a column of its own. */}
      <PreviewSheet
        open={previewSheetOpen}
        url={safeHttpUrl(project?.preview_url)}
        title={project?.name ?? "App"}
        onClose={() => setPreviewSheetOpen(false)}
      />

      {loading ? (
        <p className="flex flex-1 items-center justify-center text-sm text-muted">Opening…</p>
      ) : error ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-danger">
          {error}
        </p>
      ) : !project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted">That app is not in your account.</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-full bg-solid px-4 py-2 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90"
          >
            Back to Home
          </button>
        </div>
      ) : (
        <div className="relative z-10 flex min-h-0 flex-1">
          {/* One at a time on a phone, both from md up. Hidden rather than
              unmounted, so switching back does not discard what was typed.

              The conversation's 420 is a column beside the preview; with the
              preview put away it takes the room the preview had rather than
              leaving it blank. */}
          <div
            className={`${view === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 md:flex ${
              previewPaneOpen ? "md:w-[420px] md:flex-none" : "md:flex-1"
            }`}
          >
            <ChatPanel
              project={project}
              onOpenIntegrations={openIntegrations}
              onOpenPreview={() => setPreviewSheetOpen(true)}
              previewOpen={previewSheetOpen}
              initialPrompt={initialPrompt}
              initialKind={initialKind}
              onBuildSettled={refreshCredits}
              onPublish={() => {
                setPublishRequest((n) => n + 1);
                /* On a phone the two halves share the screen, so asking for the
                   preview's flow means bringing that half onto it. */
                setView("preview");
                setPreviewPaneOpen(true);
              }}
            />
          </div>
          {/* Put away from md up only: a phone's `view` already decides which
              half is on screen, and hiding this one there would leave the
              header's preview button with nothing to show. */}
          <div
            className={`${view === "preview" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 ${
              previewPaneOpen ? "md:flex" : "md:hidden"
            }`}
          >
            <PreviewPanel
              project={project}
              onUpgradeClick={() => setBillingOpen(true)}
              request={manageRequest}
              publishRequest={publishRequest}
              onBackToChat={() => setView("chat")}
              onClose={() => setPreviewPaneOpen(false)}
            />
          </div>

          {/* The way back to a pane that has been closed, on the edge it went
              out through. It is the only thing on screen that says the preview
              still exists, so it is a labelled button rather than a bare
              chevron. */}
          {!previewPaneOpen && (
            <button
              onClick={() => setPreviewPaneOpen(true)}
              className="absolute right-3 top-2.5 z-20 hidden h-9 items-center gap-2 rounded-xl border border-line/[0.08] bg-layer/[0.04] px-3 text-[13px] text-soft shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors hover:bg-layer/[0.08] hover:text-ink active:scale-[0.98] md:flex"
            >
              <PreviewMark className="h-4 w-4 shrink-0" />
              Preview
            </button>
          )}
        </div>
      )}
    </div>
  );
}
