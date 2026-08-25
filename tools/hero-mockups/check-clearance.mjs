/**
 * Measures the hero's floating application surfaces against the clear zone in the middle
 * of the hero — the mark, the headline and the auth stack. Nothing may enter that zone.
 * Surfaces may overlap each other: that is the depth cue, not a defect. What is reported
 * alongside is how much of each one is actually on screen, so none of them quietly ends
 * up cropped away to nothing.
 *
 *   npm run start &            # or `npm run dev`
 *   node tools/hero-mockups/check-clearance.mjs [http://localhost:3000]
 *
 * Exits non-zero and prints what collided, so the arrangement can be re-tuned rather than
 * eyeballed.
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:3000';
const MARGIN = 24; // px of breathing room required around the centre column
const sizes = [
  [768, 800], [1024, 700], [1024, 900], [1280, 800], [1440, 900],
  [1440, 1080], [1600, 900], [1920, 1080], [2560, 1440],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-proxy-server'],
});
let failures = 0;

for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const report = await page.evaluate((margin) => {
    /* Each surface drifts along the ring, so measuring a live frame only samples wherever
       the animation happens to be. Every surface is pinned at the far end of its drift
       *toward* the middle first — the worst case for the clear zone. */
    const layer = document.querySelector('.hero-apps');
    if (layer) {
      const lb = layer.getBoundingClientRect();
      const cx = lb.left + lb.width / 2;
      const cy = lb.top + lb.height / 2;
      document.querySelectorAll('.hero-app').forEach((el) => {
        const cs = getComputedStyle(el);
        const dx = Math.abs(parseFloat(cs.getPropertyValue('--drift-x')) || 0);
        const dy = Math.abs(parseFloat(cs.getPropertyValue('--drift-y')) || 0);
        const b = el.getBoundingClientRect();
        const towardX = cx - (b.left + b.width / 2) >= 0 ? 1 : -1;
        const towardY = cy - (b.top + b.height / 2) >= 0 ? 1 : -1;
        el.style.animation = 'none';
        el.style.transform = `translate3d(${dx * towardX}px, ${dy * towardY}px, 0)`;
      });
    }
    const rect = (el) => el.getBoundingClientRect();
    const grow = (r, m) => ({ left: r.left - m, right: r.right + m, top: r.top - m, bottom: r.bottom + m });
    const hits = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

    /* The headline's block spans the whole column, so measuring its element would protect
       empty air either side of centred text. Its rendered line boxes are what a surface
       can actually collide with. The mark and the auth stack are measured as elements —
       those are the two the arrangement must never crowd. */
    const protectedZones = [];
    const mark = document.querySelector('.q-logo-block');
    const auth = document.querySelector('#signup');
    if (mark) protectedZones.push(['mark', rect(mark)]);
    if (auth) protectedZones.push(['auth', rect(auth)]);
    const h1 = document.querySelector('.hero-lede h1');
    if (h1) {
      const range = document.createRange();
      range.selectNodeContents(h1);
      [...range.getClientRects()].filter((r) => r.width > 4).forEach((r) => protectedZones.push(['headline', r]));
    }

    const surfaces = [...document.querySelectorAll('.hero-app')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ name: decodeURIComponent(el.querySelector('img')?.currentSrc || '').split('hero-apps/').pop().split('.')[0], r: rect(el.querySelector('img')) }));

    const clashes = [];
    for (const s of surfaces) {
      for (const [name, zone] of protectedZones) {
        if (hits(s.r, grow(zone, margin))) clashes.push(`${s.name} × ${name}`);
      }
    }
    const visible = surfaces.map((s) => {
      const w = Math.max(0, Math.min(s.r.right, innerWidth) - Math.max(s.r.left, 0));
      const h = Math.max(0, Math.min(s.r.bottom, innerHeight) - Math.max(s.r.top, 0));
      return { name: s.name, pct: Math.round((100 * w * h) / (s.r.width * s.r.height)) };
    });
    return { drawn: surfaces.length, clashes, faint: visible.filter((v) => v.pct < 25) };
  }, MARGIN);

  const ok = report.clashes.length === 0 && report.faint.length === 0;
  if (!ok) failures++;
  const why = [
    ...new Set(report.clashes),
    ...report.faint.map((f) => `${f.name} only ${f.pct}% on screen`),
  ].join(', ');
  console.log(`${ok ? 'PASS' : 'FAIL'} ${w}x${h} · ${report.drawn} surfaces${ok ? '' : ' · ' + why}`);
  await page.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
