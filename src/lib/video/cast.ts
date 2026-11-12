/* The cast — who is in a video, and how every scene keeps them the same.
 *
 *   PlanCharacter   a character as the plan holds it: their id, name and
 *                   description, copied in when they are added, so the words
 *                   every scene is given never change under a finished plan
 *   castPrompt      a scene's prompt with each character's description
 *                   repeated WORD FOR WORD, in the order of their pictures
 *   castReferences  the pictures sent with the scene: each character's own,
 *                   front view first, at most nine in all
 *   castVoice       the voice a scene's line is read in: the scene's own
 *                   choice, else the speaking character's, else the video's
 *
 * Pure: the editor, the planner and the render all use it. */

import type { ProductionPlan, Scene } from "./plan";

export type PlanCharacter = { id: string; name: string; descriptor: string; voiceId?: string };

/** At most this many characters in one video, and in one scene. */
export const MAX_CAST = 4;
export const MAX_SCENE_CAST = 3;
/** Reference-to-video takes nine pictures. */
export const MAX_REFERENCES = 9;

const UUID = /^[0-9a-f-]{36}$/i;

/** A cast list as written by a person, the planner or a model. Pure. */
export function normalizeCast(raw: unknown): PlanCharacter[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanCharacter[] = [];
  for (const entry of raw.slice(0, MAX_CAST * 2)) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.toLowerCase() : "";
    if (!UUID.test(id) || out.some((c) => c.id === id)) continue;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) : "";
    const descriptor = typeof r.descriptor === "string" ? r.descriptor.trim().slice(0, 600) : "";
    if (!name || !descriptor) continue;
    out.push({ id, name, descriptor, ...(typeof r.voiceId === "string" && r.voiceId ? { voiceId: r.voiceId.slice(0, 80) } : {}) });
    if (out.length >= MAX_CAST) break;
  }
  return out;
}

/** A scene's cast: ids the plan knows, in order, at most three. Pure. */
export function normalizeSceneCast(raw: unknown, cast: PlanCharacter[]): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(cast.map((c) => c.id));
  const ids = raw.map((v) => (typeof v === "string" ? v.toLowerCase() : "")).filter((v) => known.has(v));
  return [...new Set(ids)].slice(0, MAX_SCENE_CAST);
}

/** The characters in one scene, in its order. Pure. */
export const sceneCast = (scene: Pick<Scene, "characters">, plan: Pick<ProductionPlan, "characters">): PlanCharacter[] =>
  (scene.characters ?? []).map((id) => plan.characters?.find((c) => c.id === id)).filter((c): c is PlanCharacter => Boolean(c));

/** The words that lock a scene's cast: every description verbatim, in picture order. Pure. */
export function castLock(cast: PlanCharacter[]): string {
  if (!cast.length) return "";
  if (cast.length === 1) {
    return `Character: ${cast[0].name}, ${cast[0].descriptor}. Keep the face, hair and outfit exactly as in the reference images.`;
  }
  const who = cast.map((c, i) => `${i === 0 ? "First" : i === 1 ? "Second" : "Third"} character (${i === 0 ? "the first" : i === 1 ? "the next" : "the last"} reference images): ${c.name}, ${c.descriptor}.`).join(" ");
  return `${who} Keep each person's face, hair and outfit exactly as in their own reference images; never swap or blend them.`;
}

/** A scene's prompt with its cast locked in. Pure. */
export function castPrompt(prompt: string, cast: PlanCharacter[]): string {
  const lock = castLock(cast);
  return lock ? `${prompt.trim()} ${lock}` : prompt;
}

/**
 * The pictures sent with a scene: each character's, front first, shared out
 * so every character gets a fair number and the whole stays within nine. Pure.
 */
export function castReferences(cast: PlanCharacter[], pictures: Record<string, string[]>): string[] {
  const lists = cast.map((c) => pictures[c.id] ?? []).filter((list) => list.length);
  if (!lists.length) return [];
  const each = Math.max(1, Math.floor(MAX_REFERENCES / lists.length));
  return lists.flatMap((list) => list.slice(0, each)).slice(0, MAX_REFERENCES);
}

/** Who speaks a line: "AMA: hello" names them; otherwise the scene's first character. Pure. */
export function speakerOf(scene: Pick<Scene, "voiceover" | "characters">, plan: Pick<ProductionPlan, "characters">): PlanCharacter | null {
  const named = scene.voiceover.match(/^([A-Z][A-Za-z .'-]{0,24}):\s*/)?.[1]?.trim().toLowerCase();
  if (named) {
    const byName = plan.characters?.find((c) => c.name.toLowerCase() === named || c.name.toLowerCase().split(" ")[0] === named);
    if (byName) return byName;
  }
  return sceneCast(scene, plan)[0] ?? null;
}

/** The voice a scene's line is read in. Pure. */
export function castVoice(scene: Pick<Scene, "voiceover" | "characters" | "voiceId">, plan: Pick<ProductionPlan, "characters" | "cut">, fallback: string): string {
  return scene.voiceId ?? speakerOf(scene, plan)?.voiceId ?? plan.cut?.voiceId ?? fallback;
}

/** The CHARACTERS block the planner and the editor read. Pure. */
export function castManifest(cast: PlanCharacter[]): string {
  if (!cast.length) return "CHARACTERS: none. Do not invent recurring people the person has not set up; describe any person in the scene's own prompt.";
  return [
    "CHARACTERS (locked — every scene that shows one of them lists its id in \"characters\"; their look is supplied to the engine from reference pictures and these exact words, so never re-describe or change their face, hair or clothes in a prompt):",
    ...cast.map((c) => `- ${c.name} [id ${c.id}]: ${c.descriptor}`),
  ].join("\n");
}
