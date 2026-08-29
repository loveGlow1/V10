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

  const base =
    "group flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors";
  const on = "bg-white/[0.08] text-white";
  const off = "text-[#8F939A] hover:bg-white/[0.04] hover:text-white";

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
    <div className="relative z-30 flex w-full items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#0c0c0e] px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8F939A] transition-colors hover:bg-white/[0.04] hover:text-white"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
