/**
 * Screenshots the seven application mockups in this folder into /public/hero-apps.
 * Run from the repo root with a Playwright-capable Chromium available:
 *   node tools/hero-mockups/render.mjs
 * The hero composites the PNGs it writes; re-run it after editing any mockup.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../public/hero-apps');
fs.mkdirSync(out, { recursive: true });

const shots = [
  { file: '1-banking.html', name: 'banking', w: 390, h: 844 },
  { file: '2-store.html', name: 'store', w: 1240, h: 790 },
  { file: '3-crm.html', name: 'crm', w: 1320, h: 730 },
  { file: '4-analytics.html', name: 'analytics', w: 1320, h: 840 },
  { file: '5-food.html', name: 'food', w: 430, h: 960 },
  { file: '6-projects.html', name: 'projects', w: 1320, h: 760 },
  { file: '7-studio.html', name: 'studio', w: 1240, h: 720 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-proxy-server', '--font-render-hinting=none'],
});

for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(here, s.file), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.locator('.app').screenshot({ path: path.join(out, `${s.name}.png`) });
  console.log('rendered', s.name, `${s.w}x${s.h}@2x`);
  await page.close();
}
await browser.close();
