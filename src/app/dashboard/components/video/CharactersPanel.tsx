"use client";

/* Characters — people who look the same in every scene.
 *
 * Make one once: describe them (or start from a photo of yourself, or of
 * someone whose likeness you have the right to use), and three reference
 * pictures are made — front, three-quarter, full body. Add them to a video,
 * and every generated scene that shows them is filmed from those same
 * pictures with the same words. They are yours across all your videos. */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2, UserRound, X } from "lucide-react";

import { MAX_CAST, type PlanCharacter } from "@/lib/video/cast";
import { VOICES } from "@/lib/video/voices";

import type { PanelAsset } from "./MediaPanel";

type Character = { id: string; name: string; descriptor: string; voiceId: string | null; source: string; status: string; error: string | null; pictures: string[] };

const field = "w-full rounded-lg border border-line/[0.1] bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none focus:border-line/[0.25]";

export default function CharactersPanel({
  videoId,
  cast,
  photos,
  onCast,
}: {
  videoId: string;
  /** The characters in this video now. */
  cast: PlanCharacter[];
  /** Pictures uploaded to this video — a character can start from one. */
  photos: PanelAsset[];
  /** The video's new cast, as the plan holds it. */
  onCast: (cast: PlanCharacter[]) => void;
}) {
  const [all, setAll] = useState<Character[] | null>(null);
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", descriptor: "", voiceId: "", photo: "", consent: false });

  const load = useCallback(async () => {
    const response = await fetch("/api/video/characters", { cache: "no-store" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { characters?: Character[] } | null;
    setAll(body?.characters ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const inVideo = new Set(cast.map((c) => c.id));

  async function setCast(ids: string[]) {
    setBusy("cast");
    setError(null);
    const response = await fetch(`/api/video/${videoId}/cast`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterIds: ids }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { characters?: PlanCharacter[]; error?: string } | null;
    setBusy(null);
    if (!response?.ok || !body?.characters) setError(body?.error ?? "The cast could not be changed.");
    else onCast(body.characters);
  }

  async function create() {
    setMaking(true);
    setError(null);
    const response = await fetch("/api/video/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        descriptor: form.descriptor,
        voiceId: form.voiceId || undefined,
        ...(form.photo ? { photo: { videoId, assetId: form.photo }, consent: form.consent } : {}),
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setMaking(false);
    if (!response?.ok || !body?.id) {
      setError(body?.error ?? "The character could not be made.");
      await load();
      return;
    }
    setForm({ name: "", descriptor: "", voiceId: "", photo: "", consent: false });
    setOpen(false);
    await load();
    if (cast.length < MAX_CAST) await setCast([...cast.map((c) => c.id), body.id]);
  }

  async function patch(id: string, change: Record<string, unknown>) {
    await fetch(`/api/video/characters/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }).catch(() => null);
    await load();
  }

  async function remove(id: string) {
    setBusy(id);
    if (inVideo.has(id)) await setCast(cast.filter((c) => c.id !== id).map((c) => c.id));
    await fetch(`/api/video/characters/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    await load();
  }

  const stills = photos.filter((p) => p.status !== "failed" && p.kind !== "video" && p.kind !== "audio" && p.kind !== "render");

  return (
    <section className="rounded-[16px] border border-line/[0.08] bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium text-ink"><UserRound className="h-4 w-4" /> Characters</h2>
          <p className="text-[12px] text-muted">The same face, hair and clothes in every scene. Made once, reused in all your videos.</p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.1] px-3 text-[12.5px] text-ink hover:bg-layer/[0.08]">
          {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {open ? "Cancel" : "New character"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger/[0.08] px-3 py-1.5 text-[12.5px] text-danger">{error}</p>}

      {open && (
        <div className="mt-3 space-y-2 rounded-[12px] border border-line/[0.1] p-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.slice(0, 60) })} placeholder="Name — e.g. Ama" className={field} />
          <textarea
            rows={3}
            value={form.descriptor}
            onChange={(e) => setForm({ ...form, descriptor: e.target.value.slice(0, 600) })}
            placeholder="How they look, exactly: age, skin, face, hair, what they wear — e.g. late twenties, dark brown skin, short natural coily black hair, round gold earrings, mustard-yellow linen shirt"
            className={`${field} resize-y`}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={form.voiceId} onChange={(e) => setForm({ ...form, voiceId: e.target.value })} className={field}>
              <option value="">Their voice — choose later</option>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label} · {v.language}</option>
              ))}
            </select>
            <select value={form.photo} onChange={(e) => setForm({ ...form, photo: e.target.value, consent: false })} className={field}>
              <option value="">Make their look from the description</option>
              {stills.map((p) => (
                <option key={p.id} value={p.id}>Start from my photo: {p.name || "picture"}</option>
              ))}
            </select>
          </div>
          {form.photo && (
            <label className="flex items-start gap-2 text-[12px] text-soft">
              <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5" />
              This is me, or I have the right to use this person&apos;s likeness.
            </label>
          )}
          <button
            onClick={() => void create()}
            disabled={making || !form.name.trim() || form.descriptor.trim().length < 12 || (Boolean(form.photo) && !form.consent)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-full bg-solid text-[13px] font-medium text-onSolid disabled:opacity-50"
          >
            {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
            {making ? "Making their reference pictures — about half a minute…" : "Make character · about 1 credit"}
          </button>
        </div>
      )}

      {all === null ? (
        <div className="mt-3 flex justify-center py-3 text-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : all.length === 0 && !open ? (
        <p className="mt-3 text-[12.5px] text-muted">No characters yet. Make one so the same person appears in every scene.</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {all.map((c) => {
            const chosen = inVideo.has(c.id);
            return (
              <li key={c.id} className={`rounded-[12px] border p-2.5 ${chosen ? "border-accent/50 bg-accent/[0.05]" : "border-line/[0.1]"}`}>
                <div className="flex gap-1.5">
                  {c.pictures.slice(0, 3).map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt="" className="h-16 w-12 rounded-[6px] object-cover" />
                  ))}
                  {!c.pictures.length && (
                    <span className="flex h-16 w-12 items-center justify-center rounded-[6px] bg-layer/[0.08] text-muted">
                      {c.status === "making" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 pl-1">
                    <p className="truncate text-[13px] font-medium text-ink">{c.name}</p>
                    <p className="line-clamp-2 text-[11px] leading-snug text-muted" title={c.descriptor}>{c.descriptor}</p>
                    {c.status === "failed" && <p className="text-[11px] text-danger">{c.error ?? "Could not be made"}</p>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => void setCast(chosen ? cast.filter((x) => x.id !== c.id).map((x) => x.id) : [...cast.map((x) => x.id), c.id])}
                    disabled={busy !== null || c.status !== "ready" || (!chosen && cast.length >= MAX_CAST)}
                    className={`flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] disabled:opacity-40 ${chosen ? "border-accent/50 text-accent" : "border-line/[0.1] text-ink hover:bg-layer/[0.08]"}`}
                  >
                    {chosen ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {chosen ? "In this video" : "Add to video"}
                  </button>
                  <select value={c.voiceId ?? ""} onChange={(e) => void patch(c.id, { voiceId: e.target.value || null })} className="h-7 min-w-0 flex-1 rounded-full border border-line/[0.1] bg-panel px-2 text-[11.5px] text-ink" aria-label={`${c.name}'s voice`}>
                    <option value="">Voice: the video&apos;s</option>
                    {VOICES.map((v) => (
                      <option key={v.id} value={v.id}>{v.label} · {v.language}</option>
                    ))}
                  </select>
                  <button onClick={() => void remove(c.id)} disabled={busy !== null} aria-label={`Delete ${c.name}`} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-danger disabled:opacity-40">
                    {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
