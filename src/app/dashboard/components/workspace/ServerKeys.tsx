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
    <section className="mt-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-soft" />
            <h3 className="text-[16px] font-semibold text-ink">Server keys</h3>
            <span className="rounded-md bg-layer/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-soft">{state.keys.length}</span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Keys your app uses on the server — a Stripe secret key, an API key. They go straight to your hosting
            and are never stored here, so they can be replaced but never read back.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </p>
      ) : state.keys.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-line/[0.09] bg-layer/[0.02]">
          {state.keys.map((name) => (
            <div key={name} className="flex items-center gap-3 border-b border-line/[0.07] px-4 py-3 last:border-b-0">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{name}</span>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> set
              </span>
              <button
                onClick={() => remove(name)}
                disabled={removing === name}
                aria-label={`Remove ${name}`}
                className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-layer/[0.08] hover:text-rose-300 disabled:opacity-40"
              >
                {removing === name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      ) : !open ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-line/[0.14] px-6 py-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400">
            <KeyRound className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-4 text-[14px] font-semibold text-ink">No keys yet</p>
          <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-muted">
            Add one when your app needs a secret, like a Stripe or email key.
          </p>
          <button
            onClick={() => setOpen(true)}
            className="mt-5 flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.12] px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-layer/[0.05]"
          >
            <Plus className="h-3.5 w-3.5" /> Add a key
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-line/[0.09] bg-layer/[0.02] p-4">
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="STRIPE_SECRET_KEY"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-11 w-full rounded-xl border border-line/[0.12] bg-layer/[0.03] px-3.5 font-mono text-[12.5px] text-ink outline-none transition-colors focus-visible:border-accent/60"
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste the value"
            type="password"
            spellCheck={false}
            className="h-11 w-full rounded-xl border border-line/[0.12] bg-layer/[0.03] px-3.5 font-mono text-[12.5px] text-ink outline-none transition-colors focus-visible:border-accent/60"
          />
          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={adding || !key.trim() || !value.trim()}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[13.5px] font-semibold text-[#04110b] transition-opacity hover:opacity-90 disabled:opacity-40"
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
              className="h-11 shrink-0 rounded-xl border border-line/[0.12] px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-layer/[0.05]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : state.keys.length > 0 ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.12] px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-layer/[0.05]"
        >
          <Plus className="h-3.5 w-3.5" /> Add a key
        </button>
      ) : null}

      {problem && (
        <p className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-2 text-[12px] leading-relaxed text-rose-300">
          {problem}
        </p>
      )}
      {note && !problem && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
    </section>
  );
}
