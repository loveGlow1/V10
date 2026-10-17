"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AtSign, Check, Info, Loader2, Mail, Pencil, Send } from "lucide-react";

/* "Email me new messages" — whether QuickStark emails the owner when one of
   their forms is sent, and to which address. The message itself is saved
   either way: in the QuickStark inbox, or in their own Supabase.

   Where the emails go is said in a sentence with an "Update email" button
   beside it rather than left in an always-open box, and a test email proves
   an address works before a real message depends on it. */

type State = {
  configured: boolean;
  /** Messages go to the QuickStark inbox rather than the owner's Supabase. */
  inbox?: boolean;
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
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
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
    setNotice(null);
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
      const next = body as State;
      setState(next);
      setDraft(next.email ?? "");
      if (patch.email !== undefined) {
        setEditing(false);
        setNotice(`Saved — new messages now go to ${next.email ?? next.accountEmail ?? "your account email"}.`);
      }
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setProblem(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setProblem(body.error ?? "The test email couldn't be sent.");
      else setNotice(`Test email sent to ${body.to} — check your inbox (and spam folder).`);
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setTesting(false);
    }
  }

  if (!state) return null;

  const to = state.email ?? state.accountEmail ?? "your account email";
  const usingAccount = !state.email;

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
          ? `Reply to an email to answer the person who sent it. Every message is also saved in ${state.inbox ? "your inbox below" : "your Supabase"}.`
          : `Messages are saved in ${state.inbox ? "your inbox below" : "your Supabase"}. Turn this on to also get an email for each one — nothing to connect.`}
      </p>

      {state.enabled && !editing && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line/[0.07] bg-layer/[0.03]">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <AtSign className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
                Emails go to
                {usingAccount && state.accountEmail && (
                  <span className="rounded-full bg-layer/[0.08] px-1.5 py-px text-[10.5px]">Account email</span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[13.5px] font-medium text-ink" title={to}>
                {to}
              </p>
            </div>
          </div>
          <div className="flex border-t border-line/[0.07]">
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setNotice(null);
                setProblem(null);
                setDraft(state.email ?? "");
              }}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-layer/[0.05]"
            >
              <Pencil className="h-3.5 w-3.5" />
              Update email
            </button>
            {state.configured && (
              <button
                type="button"
                onClick={() => void sendTest()}
                disabled={testing}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 border-l border-line/[0.07] text-[12.5px] font-medium text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink disabled:opacity-50"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send test email
              </button>
            )}
          </div>
        </div>
      )}

      {state.enabled && editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save({ email: draft.trim() || null });
          }}
          className="mt-3 rounded-xl border border-line/[0.07] bg-layer/[0.03] p-3.5"
        >
          <label htmlFor={`notify-email-${projectId}`} className="text-[12px] font-medium text-ink">
            Send form emails to
          </label>
          <input
            id={`notify-email-${projectId}`}
            type="email"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={state.accountEmail ?? "you@example.com"}
            className="mt-1.5 h-9 w-full rounded-lg border border-line/[0.09] bg-transparent px-3 text-[13px] text-ink placeholder:text-muted focus:outline-none md:h-8"
          />
          {state.accountEmail && (
            <p className="mt-1.5 text-[11.5px] text-muted">Leave it empty to use your account email, {state.accountEmail}.</p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="submit"
              disabled={busy || draft.trim() === (state.email ?? "")}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-opacity disabled:opacity-40 md:h-8"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Save email
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(state.email ?? "");
                setProblem(null);
              }}
              className="h-9 rounded-lg border border-line/[0.09] px-3 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] md:h-8"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {notice && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-accent/10 px-3 py-2 text-[12px] leading-relaxed text-accent">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}

      {state.enabled && !state.configured && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Email sending isn&apos;t set up yet. Messages are still saved{state.inbox ? " in your inbox" : ""}.</span>
        </p>
      )}
      {problem && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{problem}</span>
        </p>
      )}
    </div>
  );
}
