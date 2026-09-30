"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, ShieldCheck } from "lucide-react";

/* Connect Supabase — one button instead of three pasted values.
 *
 * Signed out of Supabase: a button that sends them to Supabase to sign in and
 * allow QuickStark. Signed in: their projects to pick from, or a new free one
 * made for them. Picking one is the whole of it — the server reads the key,
 * checks the database answers, sets up sign-in redirects, and reads the
 * database to say what the next build will do. Nothing is copied or pasted.
 */

type SupabaseProject = { ref: string; name: string; organizationId: string; region: string; status: string };
type Organization = { id: string; slug: string; name: string };
type Region = { id: string; label: string };

type Status = {
  configured: boolean;
  connected: boolean;
  projects?: SupabaseProject[];
  organizations?: Organization[];
  regions?: Region[];
  error?: string;
};

const RETURNED: Record<string, string> = {
  cancelled: "Supabase sign-in was cancelled. Nothing was changed.",
  expired: "That sign-in took too long or came from somewhere else. Try Connect Supabase again.",
  failed: "Supabase didn't complete the sign-in. Try again in a moment.",
  unavailable: "Connect Supabase isn't set up on this deployment yet.",
};

export default function ConnectSupabase({
  projectId,
  currentRef,
  returned,
  onConnected,
  onCancel,
}: {
  projectId: string;
  /** The Supabase project this app is linked to now, if any. */
  currentRef: string | null;
  /** The ?supabase= value the sign-in came back with. */
  returned: string | null;
  onConnected: (result: { preview: string | null; authNote: string | null; name: string }) => void;
  onCancel?: () => void;
}) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/backend/supabase`;
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(currentRef);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(returned && RETURNED[returned] ? RETURNED[returned] : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [org, setOrg] = useState("");
  const [region, setRegion] = useState("eu-central-1");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(base, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Status;
      if (!alive.current) return;
      setStatus(body);
      if (body.organizations?.length) setOrg((current) => current || body.organizations![0].slug);
      if (body.error) setProblem(body.error);
    } catch {
      if (alive.current) setProblem("Couldn't reach QuickStark. Try again.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Link a project, asking again while Supabase is still building it. */
  async function link(ref: string, waitedMs = 0): Promise<void> {
    setBusy(ref);
    setProblem(null);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const body = await response.json().catch(() => ({}));
      if (!alive.current) return;

      if (response.status === 202 && body.pending) {
        if (waitedMs > 240_000) {
          setProblem("Supabase is taking longer than usual to set this project up. Try connecting it again in a few minutes.");
          setBusy(null);
          return;
        }
        setNote(body.message ?? "Supabase is still setting this database up…");
        setTimeout(() => void link(ref, waitedMs + 5000), 5000);
        return;
      }

      if (!response.ok) {
        if (body.reconnect) await load();
        setProblem(body.error ?? "That couldn't be connected.");
        setBusy(null);
        return;
      }

      setBusy(null);
      setNote(null);
      onConnected({ preview: body.preview ?? null, authNote: body.authNote ?? null, name: body.name ?? ref });
    } catch {
      if (alive.current) {
        setProblem("That didn't get through. Try again.");
        setBusy(null);
      }
    }
  }

  async function create() {
    if (!org || busy) return;
    setBusy("new");
    setProblem(null);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ create: { organizationId: org, region } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!alive.current) return;
      if (!response.ok && response.status !== 202) {
        setProblem(body.error ?? "Supabase couldn't create a project.");
        setBusy(null);
        return;
      }
      setCreating(false);
      setPicked(body.ref);
      setNote("Creating your Supabase project. This usually takes a minute or two…");
      await link(body.ref);
    } catch {
      if (alive.current) {
        setProblem("That didn't get through. Try again.");
        setBusy(null);
      }
    }
  }

  async function switchAccount() {
    await fetch(base, { method: "DELETE" }).catch(() => {});
    window.location.href = `/api/integrations/supabase/authorize?projectId=${encodeURIComponent(projectId)}`;
  }

  const card = "mt-3 rounded-[18px] border border-line/[0.07] bg-layer/[0.02] p-3.5 md:rounded-xl";
  const button =
    "flex h-10 items-center gap-1.5 rounded-xl border border-line/[0.09] px-3.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05] hover:text-ink disabled:text-muted md:h-8 md:rounded-lg";
  const primary =
    "flex h-10 items-center gap-1.5 rounded-xl bg-solid px-3.5 text-[13px] font-medium text-onSolid transition-opacity hover:bg-layer/90 disabled:opacity-30 md:h-8 md:rounded-lg";

  if (loading && !status) {
    return (
      <div className={card}>
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking your Supabase connection…
        </p>
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className={card}>
        <p className="text-[13px] font-medium text-ink">Connect your Supabase</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Sign in to Supabase and pick a project — or let us create a free one. We read its keys, set up
          sign-in for your app, and create and check this app&apos;s tables on the next build. Nothing to copy
          or paste, and your data stays in your account.
        </p>
        {note && <p className="mt-2 text-[12px] leading-relaxed text-amber-400">{note}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/integrations/supabase/authorize?projectId=${encodeURIComponent(projectId)}`}
            className={primary}
          >
            Connect Supabase
          </a>
          {onCancel && (
            <button onClick={onCancel} className={button}>
              Cancel
            </button>
          )}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            We never touch tables that aren&apos;t this app&apos;s. If your database already has tables with the same
            names, the app gets a schema of its own instead.
          </span>
        </p>
      </div>
    );
  }

  const projects = status.projects ?? [];

  return (
    <div className={card}>
      <p className="text-[13px] font-medium text-ink">Choose a Supabase project</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        This app&apos;s data will live there. You can use one you already have — nothing of yours is changed.
      </p>

      {projects.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {projects.map((project) => {
            const paused = project.status === "INACTIVE" || project.status === "PAUSED";
            const selected = picked === project.ref;
            return (
              <button
                key={project.ref}
                onClick={() => setPicked(project.ref)}
                disabled={busy !== null}
                className={`rounded-xl border p-3 text-left transition-colors md:rounded-lg ${
                  selected ? "border-line/25 bg-layer/[0.06]" : "border-line/[0.09] hover:bg-layer/[0.05]"
                }`}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  {project.name || project.ref}
                  {project.ref === currentRef && <span className="text-[11px] font-normal text-emerald-400">Current</span>}
                  {selected && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                  {busy === project.ref && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {project.region}
                  {paused ? " · paused — restore it in Supabase first" : project.status !== "ACTIVE_HEALTHY" ? " · starting up" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {projects.length === 0 && !creating && (
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          You don&apos;t have any Supabase projects yet. Create a free one below.
        </p>
      )}

      {creating || projects.length === 0 ? (
        <div className="mt-3 rounded-xl border border-line/[0.09] p-3 md:rounded-lg">
          <p className="text-[12px] font-medium text-ink">New free Supabase project</p>
          {(status.organizations?.length ?? 0) > 1 && (
            <>
              <label className="mt-2 block text-[12px] text-muted" htmlFor="sb-org">
                Organisation
              </label>
              <select
                id="sb-org"
                value={org}
                onChange={(event) => setOrg(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-line/[0.1] bg-layer/[0.04] px-2 text-[13px] text-ink"
              >
                {status.organizations!.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="mt-2 block text-[12px] text-muted" htmlFor="sb-region">
            Region — pick the one closest to your customers
          </label>
          <select
            id="sb-region"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-line/[0.1] bg-layer/[0.04] px-2 text-[13px] text-ink"
          >
            {(status.regions ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={create} disabled={busy !== null || !org} className={primary}>
              {busy === "new" && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy === "new" ? "Creating…" : "Create and connect"}
            </button>
            {projects.length > 0 && (
              <button onClick={() => setCreating(false)} disabled={busy !== null} className={button}>
                Back
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => picked && void link(picked)} disabled={!picked || busy !== null} className={primary}>
            {busy !== null && busy !== "new" && <Loader2 className="h-3 w-3 animate-spin" />}
            {busy !== null && busy !== "new" ? "Connecting…" : "Connect this project"}
          </button>
          <button onClick={() => setCreating(true)} disabled={busy !== null} className={button}>
            <Plus className="h-3.5 w-3.5" />
            New project
          </button>
          {onCancel && (
            <button onClick={onCancel} disabled={busy !== null} className={button}>
              Cancel
            </button>
          )}
        </div>
      )}

      {note && <p className="mt-3 text-[12px] leading-relaxed text-muted">{note}</p>}
      {problem && <p className="mt-3 text-[12px] leading-relaxed text-amber-400">{problem}</p>}

      <button
        onClick={switchAccount}
        disabled={busy !== null}
        className="mt-3 text-[11.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Use a different Supabase account
      </button>
    </div>
  );
}
