"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Home, Plus, X } from "lucide-react";

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

  /* Two materials, one component. A pointer gets browser tabs — flat, square
     shouldered, the shape a row of documents has everywhere else. A phone gets
     the glass the header beside it is made of: a translucent fill, a hairline
     rim and one pixel of light along the top edge, so the row reads as controls
     over the blue rather than as chrome bolted above the app. */
  const base =
    "group flex h-[34px] shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors md:h-8 md:rounded-lg md:border-transparent md:px-2.5";
  const on =
    "border-white/[0.14] bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] md:border-transparent md:shadow-none";
  const off =
    "border-white/[0.07] bg-white/[0.02] text-[#8F939A] hover:text-white md:border-transparent md:bg-transparent md:hover:bg-white/[0.04]";

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
    <div className="relative z-30 flex w-full items-center gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] md:gap-1 md:border-b md:border-white/[0.06] md:bg-[#0c0c0e] md:px-2 md:py-1.5 [&::-webkit-scrollbar]:hidden">
      <button
        onClick={() => router.push("/dashboard")}
        aria-current={activeId ? undefined : "page"}
        className={`${base} ${activeId ? off : on}`}
      >
        <Home className="h-3.5 w-3.5 shrink-0" />
        Home
      </button>

      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div key={tab.id} className={`${base} ${active ? on : off} pr-1`}>
            <button
              onClick={() => router.push(`/dashboard/project/${tab.id}`)}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 items-center gap-2"
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-[4px] bg-gradient-to-br ${avatarFor(tab.id)}`}
              />
              <span className="max-w-[160px] truncate">{tab.name}</span>
            </button>
            <button
              onClick={() => close(tab.id)}
              aria-label={`Close ${tab.name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#8F939A] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <button
        onClick={() => router.push("/dashboard")}
        aria-label="New app"
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-[#8F939A] transition-colors hover:text-white md:h-8 md:w-8 md:rounded-lg md:border-transparent md:bg-transparent md:hover:bg-white/[0.04]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
