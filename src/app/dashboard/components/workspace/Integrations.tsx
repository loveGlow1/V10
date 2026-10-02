"use client";

import React, { useState } from "react";
import { Plus, Search } from "lucide-react";

import { BrandMark, tintFor } from "../brandMarks";
import ConnectGitHub from "./ConnectGitHub";
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  type IntegrationCategory,
} from "../../integrations";

/* The services an app can be wired to. Searchable and filtered by drawer,
   because the list only grows from here.

   GitHub is real: its row opens Connect GitHub (ConnectGitHub.tsx) beneath it.
   The rest do not pretend to connect anything yet — Add says so and stays out
   of the way. */
export default function Integrations({
  initialCategory = "All",
  projectId = null,
  githubReturned = null,
  onUpgrade,
}: {
  initialCategory?: IntegrationCategory;
  /** The app these integrations are for. Without one, GitHub has nothing to push. */
  projectId?: string | null;
  /** The ?github= value a GitHub sign-in came back with; opens the GitHub row. */
  githubReturned?: string | null;
  onUpgrade?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IntegrationCategory>(initialCategory);
  const [pending, setPending] = useState<string | null>(null);
  const [githubOpen, setGithubOpen] = useState(Boolean(githubReturned));

  const needle = query.trim().toLowerCase();
  const shown = INTEGRATIONS.filter((integration) => {
    if (category !== "All" && integration.category !== category) return false;
    if (!needle) return true;
    return (
      integration.name.toLowerCase().includes(needle) ||
      integration.blurb.toLowerCase().includes(needle) ||
      integration.category.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="w-full max-w-[560px] px-4 py-4 lg:pl-5">
      <h2 className="text-[17px] font-semibold text-ink">Integrations</h2>
      <p className="mt-1 text-[13px] text-muted">
        Connect popular services to unlock more features for your app.
      </p>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search integrations"
          className="h-10 w-full rounded-xl border border-line/[0.09] bg-layer/[0.03] pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus-visible:border-line/25"
        />
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {INTEGRATION_CATEGORIES.map((name) => {
          const active = category === name;
          return (
            <button
              key={name}
              onClick={() => setCategory(name)}
              aria-pressed={active}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-layer/[0.08] text-ink"
                  : "text-muted hover:bg-layer/[0.04] hover:text-ink"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      <div className="mt-3 space-y-2">
        {shown.map((integration) => {
          const tint = tintFor(integration.brand);
          const isGitHub = integration.id === "github" && Boolean(projectId);
          return (
            <div key={integration.id} className="rounded-xl border border-line/[0.07] bg-layer/[0.02] p-3">
              <div className="flex items-center gap-3">
                {/* The service's own mark on a tile of its own colour, so the list
                    is scannable by logo before a word of it is read. A brand that
                    publishes a monochrome mark gets a neutral tile and follows the
                    theme instead — white on the dark ground, black on the light
                    one, which is what those brands ask for. */}
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    tint === "ink" ? "bg-layer/[0.07] text-ink" : ""
                  }`}
                  style={
                    tint === "ink" ? undefined : { backgroundColor: `${tint}1f`, color: tint }
                  }
                >
                  <BrandMark brand={integration.brand} className="h-[18px] w-[18px]" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{integration.name}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                    {integration.blurb}
                  </p>
                </div>

                {isGitHub ? (
                  <button
                    onClick={() => setGithubOpen((open) => !open)}
                    aria-expanded={githubOpen}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line/[0.09] px-2.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
                  >
                    {githubOpen ? "Close" : "Manage"}
                  </button>
                ) : pending === integration.id ? (
                  <button
                    onClick={() => setPending(null)}
                    className="shrink-0 text-right text-[12px] leading-tight text-muted hover:text-ink"
                  >
                    Connects once
                    <br />
                    building is live
                  </button>
                ) : (
                  <button
                    onClick={() => setPending(integration.id)}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line/[0.09] px-2.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                )}
              </div>
              {isGitHub && githubOpen && projectId && (
                <div className="mt-3 border-t border-line/[0.06] pt-3">
                  <ConnectGitHub projectId={projectId} returned={githubReturned} onUpgrade={onUpgrade} />
                </div>
              )}
            </div>
          );
        })}

        {shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            Nothing matches “{query.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}
