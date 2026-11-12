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

/** At most this many characters in one video, and in one scene — a scene's
    limit is the nine reference pictures, at least one each. */
export const MAX_CAST = 12;
export const MAX_SCENE_CAST = 9;
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

/**
 * Which reference pictures go with a scene, and whose each one is. Every
 * character gets their FRONT picture first — so up to nine people are each
 * recognisable — then the remaining slots go round the cast, one extra
 * angle each in turn. `reserve` keeps slots free (for a continuing scene's
 * last frame) without ever taking a character's only picture. The pictures
 * stay grouped by character, so the prompt can say which are whose. Pure.
 */
export type ReferencePlan = { images: string[]; slots: { id: string; from: number; to: number }[] };
export function planReferences(cast: PlanCharacter[], pictures: Record<string, string[]>, options: { reserve?: number } = {}): ReferencePlan {
  const withPictures = cast.filter((c) => (pictures[c.id] ?? []).length);
  const room = Math.max(withPictures.length ? Math.min(withPictures.length, MAX_REFERENCES) : 0, MAX_REFERENCES - (options.reserve ?? 0));
  const counts = new Map<string, number>();
  let used = 0;
  /* Fronts first, in scene order. */
  for (const c of withPictures) {
    if (used >= room) break;
    counts.set(c.id, 1);
    used += 1;
  }
  /* Then one more angle each, round and round. */
  let added = true;
  while (used < room && added) {
    added = false;
    for (const c of withPictures) {
      const have = counts.get(c.id);
      if (have === undefined || used >= room) continue;
      if (have < (pictures[c.id] ?? []).length) {
        counts.set(c.id, have + 1);
        used += 1;
        added = true;
      }
    }
  }
  const images: string[] = [];
  const slots: ReferencePlan["slots"] = [];
  for (const c of withPictures) {
    const n = counts.get(c.id);
    if (!n) continue;
    slots.push({ id: c.id, from: images.length + 1, to: images.length + n });
    images.push(...(pictures[c.id] ?? []).slice(0, n));
  }
  return { images, slots };
}

/** The words that lock a scene's cast: every description verbatim, tied to its pictures. Pure. */
export function castLock(cast: PlanCharacter[], plan?: ReferencePlan): string {
  if (!cast.length) return "";
  const pictured = (c: PlanCharacter) => plan?.slots.find((slot) => slot.id === c.id);
  const range = (slot: { from: number; to: number }) => (slot.from === slot.to ? `Reference image ${slot.from}` : `Reference images ${slot.from}–${slot.to}`);
  if (cast.length === 1) {
    const slot = pictured(cast[0]);
    return `Character: ${cast[0].name}, ${cast[0].descriptor}. Keep the face, hair and outfit exactly as in ${slot ? range(slot).toLowerCase() : "the reference images"}.`;
  }
  const who = cast
    .map((c) => {
      const slot = pictured(c);
      return slot ? `${range(slot)} ${slot.from === slot.to ? "shows" : "show"} ${c.name}: ${c.descriptor}.` : `${c.name} (no picture — follow these words exactly): ${c.descriptor}.`;
    })
    .join(" ");
  return `${cast.length} people in this scene, each exactly as shown. ${who} Every person keeps their own face, hair, skin tone, build and outfit; never swap, merge, duplicate or blend them, and nobody else is a lookalike of them.`;
}

/** A scene's prompt with its cast locked in. Pure. */
export function castPrompt(prompt: string, cast: PlanCharacter[], plan?: ReferencePlan): string {
  const lock = castLock(cast, plan);
  return lock ? `${prompt.trim()} ${lock}` : prompt;
}

/** The pictures sent with a scene (planReferences, without the mapping). Pure. */
export function castReferences(cast: PlanCharacter[], pictures: Record<string, string[]>): string[] {
  return planReferences(cast, pictures).images;
}

/* ── The script decides who is on screen ──────────────────────────────── */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The ways a script writes a character: full name, first name; capitalised (a name, not a word). */
function nameForms(c: PlanCharacter): string[] {
  const full = c.name.trim();
  const first = full.split(/\s+/)[0];
  return [...new Set([full, first].filter((n) => n.length >= 2))];
}

/** Characters a scene's script names — in its picture, its action, or as a speaker — in order of first mention. Pure. */
export function mentionedCast(scene: Pick<Scene, "visual" | "motionPrompt" | "shot" | "voiceover" | "onScreenText">, cast: PlanCharacter[]): string[] {
  const text = `${scene.shot} ${scene.visual} ${scene.motionPrompt} ${speakers(scene.voiceover).join(" ")}`;
  const found: { id: string; at: number }[] = [];
  for (const c of cast) {
    let at = -1;
    for (const form of nameForms(c)) {
      /* Capitalised as a name ("Ama", "AMA"), on word edges. */
      const match = new RegExp(`(^|[^\\p{L}])(${escape(form)}|${escape(form.toUpperCase())})(?=$|[^\\p{L}])`, "u").exec(text);
      if (match && (at < 0 || match.index < at)) at = match.index;
    }
    if (at >= 0) found.push({ id: c.id, at });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

/** The speakers of a line written as dialogue: "AMA: hi. KOFI: hello" → ["AMA", "KOFI"]. Pure. */
export function speakers(voiceover: string): string[] {
  return [...voiceover.matchAll(/(?:^|[.!?…"”]\s+|\n\s*)([A-Z][A-Za-z .'-]{0,24}):\s/g)].map((m) => m[1].trim());
}

/**
 * A line with more than one speaker, as one part per speaker: "AMA: Hi.
 * KOFI: Hello." → ["AMA: Hi.", "KOFI: Hello."]. One part when one speaks. Pure.
 */
export function splitDialogue(voiceover: string): string[] {
  const marks = [...voiceover.matchAll(/(?:^|(?<=[.!?…"”])\s+|\n\s*)([A-Z][A-Za-z .'-]{0,24}):\s/g)];
  if (marks.length < 2) return [voiceover];
  const parts: string[] = [];
  marks.forEach((m, i) => {
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const end = i + 1 < marks.length ? marks[i + 1].index : voiceover.length;
    const part = voiceover.slice(start, end).trim();
    if (part) parts.push(part);
  });
  return parts.length ? parts : [voiceover];
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
