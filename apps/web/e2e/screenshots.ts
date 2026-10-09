// Captures screenshots of the main screens for design review: `npm run screenshots`.
// Uses the system Chromium when PLAYWRIGHT_CHROMIUM is set (e.g. in Claude Code cloud).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots';
const PORT = 4173;
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
const shot = async (name: string) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`saved ${OUT}/${name}.png`);
};
const waitFor = (fn: string, timeout = 60000) =>
  page.waitForFunction(fn, undefined, { timeout, polling: 50 });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  await shot('01-menu');

  // Watch mode with the AI-intent overlay, captured mid-rally.
  await page.click('text=WATCH BOTS');
  await page.click('text=AI INTENT');
  await waitFor(
    `(() => { const s = window.deadminton.session.state; return s.phase === 'rally' && s.shuttle.mode === 'flight' && s.rally.hits >= 3; })()`,
  );
  await page.waitForTimeout(150);
  await shot('02-watch-bots-intent');

  // Speed the bots up and wait for the match-over screen.
  await page.click('text=8×');
  await waitFor(`!!document.querySelector('.overlay:not([hidden]) h2')`, 120000);
  await shot('03-match-over');

  // Player vs bot: serve with J, then capture a rally.
  await page.click('.overlay >> text=MENU');
  await page.click('text=PLAY VS BOT');
  await page.waitForTimeout(400);
  await shot('04-vs-bot-serve');
  await waitFor(
    `(() => { const s = window.deadminton.session.state; return s.phase === 'rally' && s.shuttle.mode === 'flight' && s.shuttle.y > 2; })()`,
  );
  await shot('05-vs-bot-rally');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await shot('06-pause');
  await page.click('text=RESUME');
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(200);
  await shot('07-tuning-panel');
  await page.keyboard.press('Backquote');

  // Phone landscape with touch controls.
  const phone = await browser.newPage({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await phone.goto(`http://localhost:${PORT}/`);
  await phone.evaluate(() => document.fonts.ready);
  await phone.waitForTimeout(1500);
  await phone.tap('text=PLAY VS BOT');
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${OUT}/08-phone-touch.png` });
  console.log(`saved ${OUT}/08-phone-touch.png`);
} finally {
  await browser.close();
  server.kill();
}
