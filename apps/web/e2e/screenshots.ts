// Captures screenshots of the main screens for design review: `npm run screenshots`.
// Uses the system Chromium when PLAYWRIGHT_CHROMIUM is set (e.g. in Claude Code cloud).
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
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
const shot = async (p: Page, name: string) => {
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`saved ${OUT}/${name}.png`);
};
const state = '(window.deadminton.session && window.deadminton.session.state)';
const waitFor = (p: Page, fn: string, timeout = 90000) =>
  p.waitForFunction(fn, undefined, { timeout, polling: 30 });

try {
  // A fixed seed keeps the review screenshots comparable between builds.
  await page.goto(`http://localhost:${PORT}/?seed=2026`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(4000);
  await shot(page, '01-menu');

  // Bot vs bot with Chaos weapons in the Hall.
  await page.click('[data-set="scheme"][data-value="chaos"]');
  await page.click('text=WATCH BOTS');
  await waitFor(
    page,
    `${state}.phase === 'rally' && ${state}.shuttle.weapon !== null && ${state}.shuttle.mode === 'flight'`,
  );
  await shot(page, '02-loaded-shuttle');

  await waitFor(page, `${state}.phase === 'revenge' && ${state}.revenge.charging`);
  await shot(page, '03-revenge-aiming');
  await waitFor(page, `${state}.projectiles.length > 0`);
  await page.waitForTimeout(250);
  await shot(page, '04-revenge-rocket');
  await waitFor(page, `${state}.terrain.some((t) => t < -0.15) && ${state}.phase === 'serve'`);
  await shot(page, '05-craters');

  await page.click('text=4×');
  await waitFor(page, `!!document.querySelector('.overlay:not([hidden]) h2')`, 240000);
  await shot(page, '06-match-over');

  // Player vs bot on the Rooftop, Standard weapons.
  await page.click('.overlay >> text=MENU');
  await page.click('[data-set="scheme"][data-value="standard"]');
  await page.click('[data-set="arena"][data-value="rooftop"]');
  await page.click('text=PLAY VS BOT');
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  await shot(page, '07-vs-bot-hud');

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
  await shot(phone, '08-phone-touch');
} finally {
  await browser.close();
  server.kill();
}
