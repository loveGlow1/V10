"use client";

import React, { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Plus, Search } from "lucide-react";

import { BrandMark, tintFor } from "../brandMarks";
import ConnectGitHub from "./ConnectGitHub";
import { askChat } from "./visual-ask";
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  type IntegrationCategory,
} from "../../integrations";

/* The services an app can be wired to. Searchable and filtered by drawer,
   because the list only grows from here.

   Every row connects:
     GitHub      opens Connect GitHub (ConnectGitHub.tsx) beneath it.
     no key      (storage, email login, Google sign-in) Add sends the row's
                 request to this app's chat, which builds it on the app's own
                 Supabase — connecting one first if the app has none.
     keys        (Stripe, the AI models, Resend, Twilio) Add opens a form for
                 the person's own keys; they go to the app's server
                 environment through /api/projects/[id]/secrets — the same
                 route as Server keys, never stored or shown here — and then
                 the request goes to the chat. A service whose keys are
                 already set says Connected, and can be added to the app. */
export default function Integrations({
  initialCategory = "All",
  projectId = null,
  githubReturned = null,
  onUpgrade,
  onAdded,
}: {
  initialCategory?: IntegrationCategory;
  /** The app these integrations are for. Without one, GitHub has nothing to push. */
  projectId?: string | null;
  /** The ?github= value a GitHub sign-in came back with; opens the GitHub row. */
  githubReturned?: string | null;
  onUpgrade?: () => void;
  /** After Add sends its request: on a phone, show the chat it went to. */
  onAdded?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IntegrationCategory>(initialCategory);
  const [added, setAdded] = useState<string | null>(null);
  /* Key names already set on this app's server environment (never values). */
  const [setKeys, setSetKeys] = useState<string[]>([]);
  const [form, setForm] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void fetch(`/api/projects/${projectId}/secrets`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { keys?: unknown }) => live && Array.isArray(body.keys) && setSetKeys(body.keys as string[]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId]);

  const build = (integration: (typeof INTEGRATIONS)[number]) => {
    if (!projectId || !integration.request) return;
    askChat({ projectId, texts: [integration.request] });
    setAdded(integration.id);
    setForm(null);
    onAdded?.();
  };

  /* Each key in turn to the app's server environment, then the build. */
  const saveKeys = async (integration: (typeof INTEGRATIONS)[number]) => {
    if (!projectId || !integration.keys || saving) return;
    const missing = integration.keys.find((k) => !values[k.name]?.trim());
    if (missing) return setProblem(`Paste your ${missing.label} first.`);
    setSaving(true);
    setProblem(null);
    try {
      for (const k of integration.keys) {
        const response = await fetch(`/api/projects/${projectId}/secrets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k.name, value: values[k.name].trim() }),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string; keys?: string[] };
        if (!response.ok) throw new Error(body.error ?? `Your ${k.label} couldn't be saved.`);
        if (Array.isArray(body.keys)) setSetKeys(body.keys);
      }
      /* Cleared once used, so a key does not sit in a field on screen. */
      setValues({});
      build(integration);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
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
                ) : !projectId || !integration.request ? (
                  <span className="shrink-0 rounded-full bg-layer/[0.05] px-2.5 py-1 text-[12px] text-muted">Open an app first</span>
                ) : added === integration.id ? (
                  <span className="flex h-8 shrink-0 items-center gap-1 px-1 text-[12.5px] text-muted">
                    <Check className="h-3.5 w-3.5 text-accent" />
                    Adding — see chat
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setProblem(null);
                      if (!integration.keys || integration.keys.every((k) => setKeys.includes(k.name))) build(integration);
                      else setForm((open) => (open === integration.id ? null : integration.id));
                    }}
                    aria-expanded={form === integration.id}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line/[0.09] px-2.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink"
                  >
                    {integration.keys?.every((k) => setKeys.includes(k.name)) ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-accent" />
                        Add to app
                      </>
                    ) : form === integration.id ? (
                      "Close"
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </>
                    )}
                  </button>
                )}
              </div>
              {added === integration.id && integration.after && (
                <p className="mt-2 border-t border-line/[0.06] pt-2 text-[12px] leading-relaxed text-muted">{integration.after}</p>
              )}
              {form === integration.id && integration.keys && (
                <div className="mt-3 space-y-2 border-t border-line/[0.06] pt-3">
                  {integration.where && <p className="text-[12px] text-muted">Find it at {integration.where}.</p>}
                  {integration.keys.map((k) => (
                    <label key={k.name} className="block">
                      <span className="mb-1 flex items-center gap-1.5 text-[12px] text-soft">
                        <KeyRound className="h-3 w-3" />
                        {k.label}
                        {setKeys.includes(k.name) && <span className="text-muted">· already set</span>}
                      </span>
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={values[k.name] ?? ""}
                        onChange={(event) => setValues((current) => ({ ...current, [k.name]: event.target.value }))}
                        placeholder={k.placeholder}
                        className="h-9 w-full rounded-lg border border-line/[0.09] bg-layer/[0.03] px-2.5 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-line/25"
                      />
                    </label>
                  ))}
                  {problem && <p className="text-[12px] text-danger">{problem}</p>}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-[11.5px] leading-snug text-muted">Saved to your app&apos;s server only — never shown again, never in the browser.</p>
                    <button
                      onClick={() => void saveKeys(integration)}
                      disabled={saving}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-solid px-3 text-[13px] font-medium text-onSolid disabled:opacity-60"
                    >
                      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Connect
                    </button>
                  </div>
                </div>
              )}
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
