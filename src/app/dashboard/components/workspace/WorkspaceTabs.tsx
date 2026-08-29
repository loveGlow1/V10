"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, X } from "lucide-react";

import { avatarFor } from "../../projectColours";
import { closeTab, useOpenTabs } from "./openTabs";

/* The strip under the header: Home on the left, then one tab per app that has
   been opened this sitting, then the button that starts another. Home is a tab
   like the rest, so getting back to the list of created apps is the same gesture
   as moving between them.

   It renders nothing when no app is open, which is what keeps a new account's
   Home exactly as it was. */
export default function WorkspaceTabs({ activeId }: { activeId?: string }) {
  const router = useRouter();
  const tabs = useOpenTabs();

  if (tabs.length === 0) return null;

  /* Two materials, one component. A phone gets the glass the header beside it is
     made of: a translucent fill, a hairline rim and one pixel of light along the
     top edge, so the row reads as controls over the blue rather than as chrome
     bolted above the app.

     A pointer gets what a browser gives it. The tab you are on is the only one
     with a surface — a soft fill, a hairline rim, one pixel of light along its
     top edge and a shadow half a pixel deep under it — so the row is read in a
     glance rather than compared. Every other tab is just its label on the strip
     itself, lit only under the cursor. That contrast is the whole control: raise
     the resting tabs too and the selected one stops being obvious. */
  const base =
    "group flex h-[34px] shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] transition-all duration-150 focus-within:outline-none md:h-[30px] md:gap-2 md:rounded-[9px] md:px-2.5";
  const on =
    "border-line/[0.14] bg-layer/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] md:border-line/[0.12] md:bg-layer/[0.06] md:font-medium md:text-ink md:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.5)]";
  const off =
    "border-line/[0.07] bg-layer/[0.02] text-muted hover:text-ink md:border-transparent md:bg-transparent md:text-muted md:shadow-none md:hover:bg-layer/[0.035] md:hover:text-ink";

  function close(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id);
    closeTab(id);
    if (id !== activeId) return;
    // Closing what you are looking at has to land somewhere: the neighbour the
    // tab leaves behind, or Home when it was the last one.
    const next = tabs[index + 1] ?? tabs[index - 1];
    router.push(next ? `/dashboard/project/${next.id}` : "/dashboard");
  }

  return (
    <div className="relative z-30 flex w-full items-center gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] md:gap-[3px] md:border-b md:border-line/[0.06] md:bg-bar md:px-3.5 md:py-1.5 [&::-webkit-scrollbar]:hidden">
      <button
        onClick={() => router.push("/dashboard")}
        aria-current={activeId ? undefined : "page"}
        className={`${base} ${activeId ? off : on} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line/25`}
      >
        {/* The apps you have made, not a house: the grid is what Home actually
            opens onto, and it is the one tab that never carries a project's
            colour to say whose it is. */}
        <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
        Home
      </button>

      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div key={tab.id} className={`${base} ${active ? on : off} pr-1`}>
            <button
              onClick={() => router.push(`/dashboard/project/${tab.id}`)}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line/25 md:gap-2.5"
            >
              {/* A favicon's job at a favicon's size: the app's own colour, round
                  on a pointer the way a site's mark is, and dimmed on the tabs
                  you are not on so the row has one bright point rather than a
                  line of them. */}
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-[4px] bg-gradient-to-br transition-opacity md:h-1.5 md:w-1.5 md:rounded-full ${avatarFor(
                  tab.id,
                )} ${active ? "" : "md:opacity-60 md:group-hover:opacity-100"}`}
              />
              <span className="max-w-[160px] truncate md:max-w-[180px]">{tab.name}</span>
            </button>
            {/* Shown on the tab you are on and on the one under the cursor, as a
                browser shows it: a close button on every resting tab is a row of
                crosses asking to be misread. */}
            <button
              onClick={() => close(tab.id)}
              aria-label={`Close ${tab.name}`}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted transition-all hover:bg-layer/[0.1] hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line/25 md:focus-visible:opacity-100 ${
                active ? "md:opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
              }`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <button
        onClick={() => router.push("/dashboard")}
        aria-label="New app"
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-line/[0.07] bg-layer/[0.02] text-muted transition-all hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line/25 md:h-[30px] md:w-[30px] md:rounded-[9px] md:border-transparent md:bg-transparent md:hover:bg-layer/[0.035] md:hover:text-ink"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
