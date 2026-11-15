/* What the video studio charges for work that needs no AI — so nothing it
 * does is free. Every price is checked against the balance BEFORE the work
 * starts (charge_credits always lands, short or not), and charged once, when
 * the work is delivered, by its dedupe key.
 *
 *   stitch     "Edit my clips" laid out on the timeline from the uploads — free
 *   prepare    an upload probed and given its working copy and poster — free
 *   own cut    the export of a video made only of the person's own clips:
 *              half a credit per started minute, and the first
 *              FREE_OWN_EXPORTS such videos of every account cost nothing
 *              (free-exports.ts)
 *   cut        the final MP4 (and its ready-to-post versions) made from the
 *              scenes — on every render, every saved edit, every setting
 *              change, every Sound switch: per started minute of the cut
 *   review     the AI's look over an edit for anything worth suggesting
 *              (it runs a model, so it is charged whether it speaks or not)
 *
 * Generated pieces (clips, voices, lip sync, music, characters) and AI
 * answers keep their own prices (engines.ts, agent.ts).
 *
 * Pure. */

/** Laying uploads out as a timeline: free — editing your own clips by hand costs nothing until Export. */
export const STITCH_COST = 0;
/** Preparing one uploaded clip; one sound file or picture: free. */
export const PREPARE_VIDEO_COST = 0;
export const PREPARE_OTHER_COST = 0;
/** Every account's videos of its own clips exported free, once each, for good. */
export const FREE_OWN_EXPORTS = 3;
/** The export of an own-clips video, per started minute. */
export const OWN_CUT_PER_MINUTE = 0.5;
/** The AI's review of an edit, at the default agent's rate. */
export const REVIEW_COST = 0.5;

const cents = (value: number) => Math.round(value * 100) / 100;

/** The cut of a video this long: one credit per started minute, at least one. Pure. */
export function cutCredits(seconds: number): number {
  return Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
}

/** The export of a video made only of the person's own clips: half a credit per started minute. Pure. */
export function ownCutCredits(seconds: number): number {
  return cents(OWN_CUT_PER_MINUTE * Math.max(1, Math.ceil(Math.max(0, seconds) / 60)));
}

/** Every scene is the person's own upload — nothing generated in the picture. Pure. */
export function ownClipsOnly(plan: { scenes: { source?: unknown }[] }): boolean {
  return plan.scenes.length > 0 && plan.scenes.every((scene) => Boolean(scene.source));
}

/** Preparing an upload of this kind. Pure. */
export const prepareCredits = (kind: string) => (kind === "video" ? PREPARE_VIDEO_COST : PREPARE_OTHER_COST);

/** A review on an agent with this rate: never below the base price. Pure. */
export const reviewCredits = (multiplier: number) => cents(Math.max(REVIEW_COST, REVIEW_COST * Math.max(1, multiplier)));

/** "1 credit", "0.5 credits". Pure. */
export function creditsLabel(value: number): string {
  const v = cents(value);
  return `${Number.isInteger(v) ? v : v.toFixed(v * 10 === Math.round(v * 10) ? 1 : 2)} credit${v === 1 ? "" : "s"}`;
}
