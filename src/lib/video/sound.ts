/* The Sound control's requests — the same words whether the preview's
 * switch sent them or somebody typed them. Fixed phrases, so the chat can
 * tell them apart from an edit and make them free and instant
 * (apply-edit.ts setSound). Pure: read by the browser and the server. */

import type { Cut } from "./plan";

export type Sound = NonNullable<Cut["audio"]>;

export const SOUND_COMMANDS: Record<Sound, string> = {
  voiceover: "Sound: voice-over only.",
  original: "Sound: the clips' original sound only.",
  mix: "Sound: voice-over over the original sound.",
  none: "Sound: off — no sound at all.",
};

export const isSound = (value: unknown): value is Sound => value === "voiceover" || value === "original" || value === "mix" || value === "none";

export const soundCommand = (text: string): Sound | null =>
  (Object.entries(SOUND_COMMANDS).find(([, phrase]) => phrase === text.trim())?.[0] as Sound | undefined) ?? null;
