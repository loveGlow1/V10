"use client";

import React, { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Plus, X } from "lucide-react";

import { avatarFor } from "../projectColours";
import { useWorkspaceTabs } from "../WorkspaceTabsContext";

/* The row of open workspaces, drawn the way a browser draws tabs: Home on the
   left, the apps being worked on beside it, the open one lifted onto the
   canvas below so the tab and the screen under it read as one surface.

   What it is for is switching. Everything else about an app — renaming it,
   publishing it, deleting it — belongs to the workspace itself; this row only
   says which one you are in and lets you be in another.

   A tab per app, never a tab per conversation: see WorkspaceTabsContext. The
   list it draws is kept honest by ProjectsProvider, which prunes and relabels
   as the projects behind it change — this row only draws what it is given. */
export default function WorkspaceTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const { tabs, busyIds, close } = useWorkspaceTabs();

  /* Which workspace is on screen is read from the address rather than passed
     down, so a link, a back button and a click in this row all agree. */
  const match = /^\/dashboard\/project\/([^/]+)/.exec(pathname ?? "");
  const activeId = match ? decodeURIComponent(match[1]) : null;

  /* Keep the open tab in view when the row has scrolled — arriving at a
     workspace from a link should not leave its tab off the left edge. */
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  function closeTab(id: string) {
    close(id);
    if (id !== activeId) return;
    /* Closing the workspace you are in has to land somewhere: the next tab
       along, or Home when that was the last one. */
    const remaining = tabs.filter((tab) => tab.id !== id);
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = remaining[Math.min(index, remaining.length - 1)];
    router.push(next ? `/dashboard/project/${next.id}` : "/dashboard");
  }

  /* Both tabs are cut from the same shape so the row has one silhouette: square
     shoulders at the bottom, where the tab meets the canvas, and rounded ones
     at the top. The open one wears the canvas colour and covers the strip's
     bottom hairline, which is what fuses it to the screen below. */
  const shape =
    "group relative -mb-px flex h-[34px] shrink-0 items-center gap-2 rounded-t-[10px] border px-2.5 text-[13px] transition-colors";
  const resting = "border-transparent text-muted hover:bg-layer/[0.05] hover:text-ink";
  const open =
    "border-line/[0.08] border-b-canvas bg-canvas text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]";

  const home = activeId === null;

  return (
    // From md up. A phone has one screen at a time and a header that already
    // names the app it is on; a scrolling row of tabs above it would spend the
    // height that the conversation needs.
    <nav
      aria-label="Open workspaces"
      className="relative z-30 hidden w-full shrink-0 items-end gap-1 overflow-x-auto border-b border-line/[0.06] bg-bar px-2 pt-1.5 md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* Home is a tab rather than a button beside them: it is the screen you
          switch back to, so it behaves like the others and sits in their row. */}
      <div ref={home ? activeRef : undefined} className={`${shape} ${home ? open : resting}`}>
        {home && <span aria-hidden className="absolute inset-x-2 top-0 h-px rounded-full bg-accent/60" />}
        <button
          onClick={() => router.push("/dashboard")}
          aria-current={home ? "page" : undefined}
          className="flex items-center gap-2 whitespace-nowrap"
        >
          <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
          Home
        </button>
      </div>

      {tabs.map((tab) => {
        const current = tab.id === activeId;
        const busy = busyIds.includes(tab.id);
        return (
          <div
            key={tab.id}
            ref={current ? activeRef : undefined}
            className={`${shape} ${current ? open : resting}`}
          >
            {current && (
              <span aria-hidden className="absolute inset-x-2 top-0 h-px rounded-full bg-accent/60" />
            )}

            <button
              onClick={() => router.push(`/dashboard/project/${tab.id}`)}
              aria-current={current ? "page" : undefined}
              title={tab.name}
              className="flex min-w-0 items-center gap-2"
            >
              {/* The app's own colour, the same one its card and its avatar
                  carry, so a tab is recognised before it is read. */}
              <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                <span
                  className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${avatarFor(tab.id)}`}
                />
                {/* A build running in that workspace, as a ring around the dot
                    rather than over it: a filled pulse would paint out the one
                    colour that says which app the tab belongs to. It breathes
                    in place rather than expanding — a halo that grows reaches
                    into the label beside it every second and a half. */}
                {busy && (
                  <span
                    aria-hidden
                    className="absolute -inset-[3px] animate-pulse rounded-full border border-accent/70"
                  />
                )}
              </span>
              <span className="max-w-[168px] truncate">{tab.name}</span>
              {busy && <span className="sr-only">Building</span>}
            </button>

            {/* Closing a tab puts the app away, it does not delete it — the app
                is still on Home. Held at a constant width so names do not shift
                when the cursor arrives. */}
            <button
              onClick={() => closeTab(tab.id)}
              aria-label={`Close ${tab.name}`}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted transition-all hover:bg-layer/[0.10] hover:text-ink ${
                current ? "opacity-70" : "opacity-0 group-hover:opacity-70 focus-visible:opacity-100"
              }`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {/* A tab is added by starting something new, which happens on Home — so
          this is the way to that composer rather than an empty tab of its own.
          An app already open comes back to its existing tab instead. */}
      <button
        onClick={() => router.push("/dashboard")}
        aria-label="Start a new app"
        title="Start a new app"
        className="mb-1 ml-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-layer/[0.06] hover:text-ink"
      >
        <Plus className="h-4 w-4" />
      </button>
    </nav>
  );
}
