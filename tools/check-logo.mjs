/* The logo on load and refresh: never a white flash.
 *
 * The flat mark paints first; the 3D mark replaces it. Its moving glint light
 * starts its orbit in front of the mark, and at full strength from frame one
 * the hand-over frame came up white before settling to obsidian. Measured in a
 * real browser: the header mark's peak brightness went 25 → 106 → 6 across
 * the hand-over. These guard the two fixes. */
import { readFileSync } from "node:fs";

const scene = readFileSync(new URL("../src/app/Q3DCanvasScene.tsx", import.meta.url), "utf8");
let failed = 0;
const has = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) failed += 1;
};

has(/intensity=\{0\}/.test(scene) && /lightRef\.current\.intensity = GLINT_INTENSITY \* glintRamp\(t\)/.test(scene), "the glint starts dark and is eased in, so the 3D mark arrives dark");
const hold = Number(scene.match(/GLINT_HOLD_SECONDS = ([\d.]+)/)?.[1]);
has(hold >= 1, "the glint holds off for at least a second after the mark appears");
has(/const SETTLE_FRAMES = (\d+)/.test(scene) && Number(scene.match(/const SETTLE_FRAMES = (\d+)/)[1]) >= 3 && /if \(frames\.current < SETTLE_FRAMES\) return;/.test(scene), "the flat mark hands over to a settled 3D frame, not the first one");

console.log(failed ? `\n${failed} failed.` : "\nAll logo checks passed.");
process.exit(failed ? 1 : 0);
