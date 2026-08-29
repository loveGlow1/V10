"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import TopNav from "../TopNav";
import TopBar from "../TopBar";
import Sidebar from "../Sidebar";
import BillingModal from "../billing/BillingModal";
import AccountSettingsModal from "../AccountSettingsModal";
import SupportChat from "../SupportChat";
import { AGENTS } from "../../agents";
import { formatCredits, signupBalance, totalCredits } from "../../credits";
import { useProjects } from "../../ProjectsContext";
import ChatPanel from "./ChatPanel";
import PreviewPanel from "./PreviewPanel";
import WorkspaceTabs from "./WorkspaceTabs";
import { openTab } from "./openTabs";

/* Same figure Home shows, read from the credit economy rather than repeated. */
const CREDITS = formatCredits(totalCredits(signupBalance()));

/* An opened app. The header and drawer are the ones Home carries, so moving
   between the two is a change of the area below the tabs and nothing else.

   From md up the two halves sit side by side. On a phone they share the screen
   and the pair already in the phone header switches between them, which is what
   that control was built for. */
export default function Workspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { projects, loading, error, select } = useProjects();
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;

  const [billingOpen, setBillingOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"preview" | "chat">("chat");

  /* Opening the route is what opens the tab, so a link, a reload and a click in
     the list all leave the strip in the same state. A rename flows through here
     too, which keeps the tab's label honest. */
  useEffect(() => {
    if (!project) return;
    openTab({ id: project.id, name: project.name });
    select(project.id);
  }, [project, select]);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0d0d0f]">
      <TopNav
        onUpgradeClick={() => setBillingOpen(true)}
        onAccountSettingsClick={() => setAccountSettingsOpen(true)}
        projectName={project?.name ?? "No project yet"}
        credits={CREDITS}
      />

      <TopBar
        onMenuClick={() => setSidebarOpen(true)}
        onUpgradeClick={() => setBillingOpen(true)}
        view={view}
        onViewChange={setView}
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
        credits={CREDITS}
      />

      <BillingModal open={billingOpen} onClose={() => setBillingOpen(false)} />
      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onUpgradeClick={() => {
          setAccountSettingsOpen(false);
          setBillingOpen(true);
        }}
        credits={CREDITS}
        agents={AGENTS}
        selectedAgent="Q1"
      />
      <SupportChat />

      <WorkspaceTabs activeId={projectId} />

      {loading ? (
        <p className="flex flex-1 items-center justify-center text-sm text-[#8F939A]">Opening…</p>
      ) : error ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#FF6B6B]">
          {error}
        </p>
      ) : !project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-[#8F939A]">That app is not in your account.</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[#0d0d0f] transition-colors hover:bg-white/90"
          >
            Back to Home
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* One at a time on a phone, both from md up. Hidden rather than
              unmounted, so switching back does not discard what was typed. */}
          <div
            className={`${view === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 md:flex md:w-[420px] md:flex-none`}
          >
            <ChatPanel project={project} />
          </div>
          <div className={`${view === "preview" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 md:flex`}>
            <PreviewPanel project={project} />
          </div>
        </div>
      )}
    </div>
  );
}
