"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

/* The keys a project's server code needs and its visitors must never see.
 *
 * ── What this panel promises, and what it deliberately does not ───────────
 *
 * It never shows a value. Not masked, not truncated, not once: the value goes
 * from this form to Vercel and is not stored by QuickStark at all, so there is
 * nothing here to show and nothing here to leak. What comes back is the list of
 * NAMES, read from Vercel, which makes it true rather than remembered — a key
 * somebody removed in Vercel's own dashboard is gone from this list too.
 *
 * ── Why it says "next time you publish" ───────────────────────────────────
 *
 * Because that is when it takes effect. An environment variable is read by the
 * build and by the running function, and neither of those re-runs because a key
 * was saved. Somebody who pastes a Stripe key, reloads their site and finds it
 * behaving exactly as before has been told nothing by an interface that said
 * "Saved" and stopped there.
 */

type State = { keys: string[]; configured: boolean };

export default function ServerKeys({ projectId }: { projectId: string | null }) {
  const [state, setState] = useState<State>({ keys: [], configured: true });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/projects/${projectId}/secrets`, { cache: "no-store" });
      const body = await response.json();
      if (Array.isArray(body.keys)) {
        setState({ keys: body.keys as string[], configured: body.configured !== false });
      }
    } catch {
      /* Leaving what is on screen beats emptying it: a failed refresh is not
         evidence that somebody's keys are gone. */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!projectId || adding || !key.trim() || !value.trim()) return;
    setAdding(true);
    setProblem(null);
    setNote(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value }),
      });
      const body = await response.json();

      if (!response.ok) {
        setProblem(body.error ?? "That key couldn't be saved.");
        return;
      }

      setState((current) => ({ ...current, keys: (body.keys as string[]) ?? current.keys }));
      /* Cleared the moment it lands, so a value does not sit in a form field
         on somebody's screen after it has been used. */
      setKey("");
      setValue("");
      setOpen(false);
      setNote(body.note ?? "Saved.");
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(name: string) {
    if (!projectId || removing) return;
    setRemoving(name);
    setProblem(null);
    setNote(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/secrets?key=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok) {
        setProblem(body.error ?? "That key couldn't be removed.");
        return;
      }
      setState((current) => ({ ...current, keys: (body.keys as string[]) ?? current.keys }));
      setNote(`${name} removed. It stops reaching your site at the next publish.`);
    } catch {
      setProblem("That didn't get through. Try again.");
    } finally {
      setRemoving(null);
    }
  }

  /* No Vercel token means there is nowhere to put a key, and an empty panel
     explaining that to a customer is an operator's problem shown to the wrong
     person. */
  if (!state.configured || !projectId) return null;

  return (
    <div className="mt-6 rounded-[18px] border border-line/[0.08] p-3.5 md:rounded-xl">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <KeyRound className="h-3.5 w-3.5" /> Server keys
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Keys your app uses on the server — a Stripe secret key, an API key. They go straight to your
        hosting and are never stored here, so they can be replaced but never read back.
      </p>

      {loading ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </p>
      ) : state.keys.length > 0 ? (
        <div className="mt-3 rounded-lg border border-line/[0.06] bg-sunken/40 px-2">
          {state.keys.map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 border-b border-line/[0.06] py-1.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{name}</span>
              <span className="shrink-0 text-[11px] text-muted">set</span>
              <button
                onClick={() => remove(name)}
                disabled={removing === name}
                aria-label={`Remove ${name}`}
                className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-layer/[0.08] hover:text-rose-300 disabled:opacity-40"
              >
                {removing === name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted">None yet.</p>
      )}

      {open ? (
        <div className="mt-3 space-y-2">
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="STRIPE_SECRET_KEY"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 font-mono text-[12px] text-ink outline-none focus-visible:border-line/25 md:h-9 md:rounded-lg"
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste the value"
            type="password"
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 font-mono text-[12px] text-ink outline-none focus-visible:border-line/25 md:h-9 md:rounded-lg"
          />
          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={adding || !key.trim() || !value.trim()}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-solid text-[13px] font-medium text-onSolid transition-opacity hover:bg-layer/90 disabled:opacity-30 md:h-9 md:rounded-lg"
            >
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {adding ? "Saving…" : "Save key"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setKey("");
                setValue("");
                setProblem(null);
              }}
              className="h-10 shrink-0 rounded-xl border border-line/[0.1] px-3 text-[13px] text-ink transition-colors hover:bg-layer/[0.06] md:h-9 md:rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-line/[0.1] text-[13px] text-ink transition-colors hover:bg-layer/[0.06] md:h-9 md:rounded-lg"
        >
          <Plus className="h-3.5 w-3.5" /> Add a key
        </button>
      )}

      {problem && (
        <p className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-2 text-[12px] leading-relaxed text-rose-300">
          {problem}
        </p>
      )}
      {note && !problem && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}
