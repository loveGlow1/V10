/* What the video studio charges for work that needs no AI — so nothing it
 * does is free. Every price is checked against the balance BEFORE the work
 * starts (charge_credits always lands, short or not), and charged once, when
 * the work is delivered, by its dedupe key.
 *
 *   stitch     "Edit my clips" laid out on the timeline from the uploads
 *   prepare    an upload probed and given its working copy and poster
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

/** Laying uploads out as a timeline. */
export const STITCH_COST = 1;
/** Preparing one uploaded clip; one sound file or picture. */
export const PREPARE_VIDEO_COST = 0.5;
export const PREPARE_OTHER_COST = 0.1;
/** The AI's review of an edit, at the default agent's rate. */
export const REVIEW_COST = 0.5;

const cents = (value: number) => Math.round(value * 100) / 100;

/** The cut of a video this long: one credit per started minute, at least one. Pure. */
export function cutCredits(seconds: number): number {
  return Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
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
