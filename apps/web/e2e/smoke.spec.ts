import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:4180/?seed=31337';
const state = '(window.deadminton.session && window.deadminton.session.state)';

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

test('title screen renders with bots playing behind the menu', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('.title')).toBeVisible();
  await page.waitForFunction(`${state}.tick > 120`);
  await expect(page.locator('.fps')).toContainText('FPS');
  expect(errors).toEqual([]);
});

test('play vs bot: serve with J and the rally starts; key hints are shown', async ({ page }) => {
  const errors = await open(page);
  await page.click('text=PLAY VS BOT');
  await expect(page.locator('.hud .keys').first()).toBeVisible();
  await page.waitForFunction(`${state}.phase === 'serve'`);
  // Serve as soon as it's our serve; otherwise the bot serves on its own.
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(`${state}.phase === 'rally'`, undefined, { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.overlay h2')).toHaveText('PAUSED');
  expect(errors).toEqual([]);
});

test('watch a full bot match, then its replay plays back identically', async ({ page }) => {
  const errors = await open(page);
  await page.click('[data-set="points"][data-value="7"]');
  await page.click('text=WATCH BOTS');
  await page.click('text=8×');
  await expect(page.locator('.overlay:not([hidden]) h2')).toContainText('WINS', {
    timeout: 150_000,
  });

  await page.click('text=WATCH REPLAY');
  await page.click('text=8×');
  await expect(page.locator('.verified')).toHaveText(/REPLAY VERIFIED/, { timeout: 150_000 });
  expect(errors).toEqual([]);
});
