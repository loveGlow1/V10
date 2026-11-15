/* The Director's quick suggestions: shown only when something in the video
 * calls for one, read from its own plan and what was made — never a fixed
 * list. A video with nothing worth suggesting shows none.
 *
 * At most three, the most useful first:
 *   a scene whose new take failed      Re-film scene 3 (not when the engine is
 *                                      out of credit — asking would not help)
 *   longer than the length it is for   Trim to 30s
 *   nothing is said                    Add a voice-over
 *   no music                           Add music
 *   no closing words                   Add an end card
 *   spoken, with captions off          Turn on captions
 *
 * Pure: the studio page shows them and tools/check-video.mjs checks them. */

import type { ProductionPlan } from "./plan";

export type Suggestion = { id: string; label: string; note: string };

type Made = { scene: number | null; engine: string; status: string; error?: string | null };

/** The suggestions for a video now, most useful first, at most `max`. Pure. */
export function suggestionsFor(plan: ProductionPlan | null | undefined, renders: Made[] = [], max = 3): Suggestion[] {
  if (!plan?.scenes?.length) return [];
  const out: Suggestion[] = [];
  const seconds = plan.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
  const cut = plan.cut ?? {};

  /* A scene whose take failed — unless every failure is the engine's account
     being empty, which a change of words cannot fix. */
  const failed = [...new Set(renders.filter((r) => r.status === "failed" && (r.engine === "video" || r.engine === "avatar") && r.scene !== null).map((r) => r.scene as number))];
  const outOfCredit = renders.some((r) => r.status === "failed" && /payment required|402|insufficient|out of credit|quota|balance/i.test(r.error ?? ""));
  const made = new Set(renders.filter((r) => r.status === "done" && (r.engine === "video" || r.engine === "avatar")).map((r) => r.scene));
  const toRefilm = failed.filter((n) => !made.has(n) && plan.scenes.some((s) => s.n === n && !s.source)).sort((a, b) => a - b);
  if (toRefilm.length && !outOfCredit) {
    const n = toRefilm[0];
    const index = plan.scenes.findIndex((s) => s.n === n) + 1;
    out.push({
      id: "refilm",
      label: toRefilm.length > 1 ? `Re-film ${toRefilm.length} failed scenes` : `Re-film scene ${index}`,
      note:
        toRefilm.length > 1
          ? `Re-film the scenes that failed (${toRefilm.map((x) => plan.scenes.findIndex((s) => s.n === x) + 1).join(", ")}) with a fresh take each — same characters, same story, a simpler camera move if needed. Keep every other scene exactly as it is.`
          : `Re-film scene ${index} with a fresh take — same characters and the same moment, a simpler camera move if needed. Keep every other scene exactly as it is.`,
    });
  }

  /* Longer than the length it was planned for, by a clear margin. */
  const target = Number(plan.target) || 0;
  if (target > 0 && seconds > target * 1.25 && seconds - target >= 5) {
    out.push({
      id: "trim",
      label: `Trim to ${target}s`,
      note: `Bring it down to about ${target} seconds — shorten or drop the weakest scenes, keep the hook and the ending. Don't re-film anything.`,
    });
  }

  /* Nothing said anywhere, in a cut that would carry a voice. */
  const spoken = plan.scenes.some((s) => s.voiceover?.trim() || s.voiceAsset);
  if (!spoken && cut.audio !== "original" && cut.audio !== "none") {
    out.push({
      id: "voice",
      label: "Add a voice-over",
      note: "Add a voice-over: a spoken line for every scene that fits its length, one voice throughout, telling the story. Don't re-film anything.",
    });
  }

  /* No music at all. */
  const music = cut.music?.source === "upload" || (cut.music?.source !== "none" && Boolean(plan.music?.trim()) && !/^(none|no music)$/i.test(plan.music.trim()));
  if (!music) {
    out.push({ id: "music", label: "Add music", note: "Add background music that fits the mood and the pace of the video, quieter under any voice." });
  }

  /* No closing words: no end card, and nothing on screen in the last scene. */
  const last = plan.scenes[plan.scenes.length - 1];
  if (!cut.endCard?.trim() && !last?.onScreenText?.trim() && plan.scenes.length > 1) {
    out.push({ id: "end", label: "Add an end card", note: "Add an end card on the last scene: the name and one short call to action. Don't re-film anything." });
  }

  /* Spoken, but captions are off — most people watch without sound. */
  if (spoken && cut.captions === false) {
    out.push({ id: "captions", label: "Turn on captions", note: "Turn captions on for the spoken lines." });
  }

  return out.slice(0, Math.max(0, max));
}
