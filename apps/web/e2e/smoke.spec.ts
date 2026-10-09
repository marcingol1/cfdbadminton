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

test('tutorial: the checklist advances as you move and jump', async ({ page }) => {
  const errors = await open(page);
  await page.click('text=TUTORIAL');
  await expect(page.locator('.tutorial')).toContainText('1/9 · MOVE');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyA');
  await expect(page.locator('.tutorial')).toContainText('2/9 · JUMP', { timeout: 5_000 });
  await page.keyboard.press('Space');
  await expect(page.locator('.tutorial')).toContainText('3/9', { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('settings: a remapped key shows in the hints and is saved', async ({ page }) => {
  const errors = await open(page);
  await page.click('text=SETTINGS');
  await page.click('[data-sopt=tab][data-value=controls]');
  await page.click('[data-sopt=bind][data-value=hit]');
  await page.keyboard.press('KeyL');
  await expect(page.locator('[data-sopt=bind][data-value=hit]')).toHaveText('L');
  await page.click('[data-sopt=tab][data-value=access]');
  await page.click('text=COLORBLIND-SAFE');
  await page.click('text=BACK');
  await page.click('text=PLAY VS BOT');
  await expect(page.locator('.hud .keys').first()).toContainText('LSWING');
  expect(await page.evaluate(() => document.documentElement.classList.contains('cb'))).toBe(true);
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('deadminton.settings')!));
  expect(saved.keys.solo.hit).toEqual(['KeyL']);
  expect(saved.colors).toBe('colorblind');
  expect(errors).toEqual([]);
});

test('challenges: the list shows every challenge and starts its fixed setup', async ({ page }) => {
  const errors = await open(page);
  await page.click('text=CHALLENGES');
  await expect(page.locator('.challenge')).toHaveCount(9);
  await page.click('text=PURE BADMINTON');
  await expect(page.locator('.hud .side.p2 .name')).toHaveText('MEDIUM PURIST');
  expect(await page.evaluate(`${state}.config.scheme`)).toBe('purist');
  expect(await page.evaluate(`${state}.config.pointsToWin`)).toBe(7);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('touch controls show in a match, hide over menus, and HIT serves', async ({ page }) => {
    const errors = await open(page);
    await page.tap('text=PLAY VS BOT');
    await expect(page.locator('.touch')).toBeVisible();
    // On a wide phone the buttons sit beside the 16:9 game, not over the court.
    const hit = await page.locator('.touch-hit').boundingBox();
    const stage = await page.locator('#stage').boundingBox();
    expect(hit!.x + hit!.width).toBeGreaterThan(stage!.x + stage!.width);
    await page.waitForFunction(`${state}.phase === 'serve'`);
    if (await page.evaluate(`${state}.server === 0`)) {
      await page.tap('.touch-hit');
      await page.waitForFunction(`${state}.phase === 'rally'`, undefined, { timeout: 5_000 });
    }
    await page.tap('.pause-btn');
    await expect(page.locator('.touch')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
