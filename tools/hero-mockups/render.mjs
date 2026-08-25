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
  { file: '8-trattoria.html', name: 'trattoria', w: 1240, h: 790 },
  { file: '9-product.html', name: 'product', w: 1240, h: 780 },
  { file: '10-pantry.html', name: 'pantry', w: 1240, h: 800 },
  { file: '5-food.html', name: 'food', w: 430, h: 960 },
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
