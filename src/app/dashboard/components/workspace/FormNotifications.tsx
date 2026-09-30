"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";

/* "Email me new messages" — for an app whose form saves into the owner's own
   Supabase. The message stays in their database; this only decides whether
   QuickStark knocks on their inbox when one lands, and which inbox. */

type State = {
  configured: boolean;
  installed: boolean;
  enabled: boolean;
  email: string | null;
  accountEmail: string | null;
  lastSentAt: string | null;
};

export default function FormNotifications({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const url = `/api/projects/${encodeURIComponent(projectId)}/backend/notifications`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as State;
      setState(body);
      setDraft(body.email ?? "");
    } catch {
      /* The panel works without this row. */
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: { enabled?: boolean; email?: string | null }) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "That couldn't be saved.");
        return;
      }
      setState(body as State);
      setDraft((body as State).email ?? "");
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const to = state.email ?? state.accountEmail ?? "your account email";

  return (
    <div className="mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Mail className="h-4 w-4" />
          Email me new messages
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          disabled={busy}
          onClick={() => void save({ enabled: !state.enabled })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            state.enabled ? "bg-accent" : "bg-layer/[0.15]"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              state.enabled ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {state.enabled
          ? `When someone sends your form, we email ${to}. Reply to it to answer them. Every message is also saved in your Supabase.`
          : "Messages are saved in your Supabase. Turn this on to also get an email for each one — nothing to connect."}
      </p>

      {state.enabled && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save({ email: draft.trim() || null });
          }}
          className="mt-2.5 flex gap-2"
        >
          <input
            type="email"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={state.accountEmail ?? "you@example.com"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line/[0.09] bg-transparent px-3 text-[13px] text-ink placeholder:text-muted focus:outline-none md:h-8"
          />
          <button
            type="submit"
            disabled={busy || draft.trim() === (state.email ?? "")}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line/[0.09] px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] disabled:opacity-50 md:h-8"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </form>
      )}

      {state.enabled && !state.configured && (
        <p className="mt-2 text-[12px] leading-relaxed text-amber-400">
          Email sending isn&apos;t switched on for this deployment yet, so messages are saved but not emailed.
        </p>
      )}
      {problem && <p className="mt-2 text-[12px] leading-relaxed text-amber-400">{problem}</p>}
    </div>
  );
}
