import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../../content/dawnwell-glade/pack.json', import.meta.url), 'utf8'));
async function enter(page: Page) {
  await page.goto('/play');
  await expect(page.locator('canvas[data-scene-ready="true"]')).toHaveCount(1);
  await expect(page.locator('[data-session-status]')).toHaveText('ready');
  await expect(page.locator('.world-stage .scene-loading')).toHaveCount(0);
}
async function clickWorld(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas'); await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  const width = Number(await canvas.getAttribute('data-world-width')), height = Number(await canvas.getAttribute('data-world-height'));
  // MouseEvent client coordinates can be rounded to CSS pixels by the browser.
  // Compare Phaser's result with the actual event, not the requested CDP float.
  await canvas.evaluate(element => {
    element.addEventListener('mousedown', raw => {
      const event = raw as MouseEvent, bounds = element.getBoundingClientRect();
      element.dataset.expectedPointerX = String((event.clientX - bounds.left) / bounds.width * Number(element.dataset.worldWidth));
      element.dataset.expectedPointerY = String((event.clientY - bounds.top) / bounds.height * Number(element.dataset.worldHeight));
    }, { once: true });
  });
  await page.mouse.click(bounds.x + x / width * bounds.width, bounds.y + y / height * bounds.height);
  return canvas.evaluate(element => ({ x: Number(element.dataset.expectedPointerX), y: Number(element.dataset.expectedPointerY) }));
}
async function playerPosition(page: Page) {
  return page.locator('canvas').evaluate(canvas => ({ x: Number(canvas.dataset.playerX), y: Number(canvas.dataset.playerY) }));
}
async function arrived(page: Page, x: number, y: number) {
  await expect.poll(async () => { const p = await playerPosition(page); return Math.hypot(p.x - x, p.y - y); }).toBeLessThan(1);
  await expect(page.locator('canvas')).toHaveAttribute('data-destination-x', '');
}

test('loads exact scene, local mode, identity/resources, and enemy selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page);
  await expect(page.getByText('Local Development')).toBeVisible();
  await expect(page.getByText('Local Guardian', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Health' })).toHaveAttribute('max', '120');
  await expect(page.getByRole('progressbar', { name: 'Mana' })).toHaveAttribute('max', '60');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-world-width', '1280');
  await expect(canvas).toHaveAttribute('data-world-height', '720');
  await expect(canvas).toHaveAttribute('data-enemy-count', '4');
  await expect(canvas).toHaveAttribute('data-npc-count', '1');
  expect(await playerPosition(page)).toEqual({ x: 160, y: 540 });
  await clickWorld(page, 560, 470);
  await expect(page.locator('[data-game-feedback]')).toContainText('Selected: Thornling · 150 / 150');
  expect(await playerPosition(page)).toEqual({ x: 160, y: 540 });
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/m2-preview.png', fullPage: true });
});

test('actual pointer input moves, clamps, changes facing, and sorts ground depth', async ({ page }) => {
  await enter(page);
  const target = await clickWorld(page, 370, 600); await arrived(page, target.x, target.y);
  await expect(page.locator('canvas')).toHaveAttribute('data-player-facing', 'right');
  expect(Number(await page.locator('canvas').getAttribute('data-player-depth'))).toEqual((await playerPosition(page)).y);
  await clickWorld(page, 12, 710); await arrived(page, 64, 640);
  await expect(page.locator('canvas')).toHaveAttribute('data-player-facing', 'left');
  await expect(page.locator('canvas')).toHaveAttribute('data-player-depth', '640');
});

test('CSS resizing preserves world coordinates and pointer conversion', async ({ page }) => {
  await enter(page);
  const original = (await page.locator('canvas').boundingBox())!;
  await page.setViewportSize({ width: 860, height: 900 });
  await expect.poll(async () => (await page.locator('canvas').boundingBox())!.width).toBeLessThan(original.width);
  const target = await clickWorld(page, 1050, 630);
  await expect.poll(async () => Math.abs(Number(await page.locator('canvas').getAttribute('data-destination-x')) - target.x)).toBeLessThan(0.1);
  await expect.poll(async () => Math.abs(Number(await page.locator('canvas').getAttribute('data-destination-y')) - target.y)).toBeLessThan(0.1);
  await arrived(page, target.x, target.y);
  await page.setViewportSize({ width: 620, height: 800 });
  await expect.poll(async () => (await page.locator('canvas').boundingBox())!.width).toBeLessThan(620);
  const narrowTarget = await clickWorld(page, 640, 630); await arrived(page, narrowTarget.x, narrowTarget.y);
  await expect(page.locator('canvas')).toHaveAttribute('data-world-width', '1280');
  await expect(page.locator('canvas')).toHaveAttribute('width', '1280');
});

test('panel clicks do not move and editable text suppresses gameplay shortcuts', async ({ page }) => {
  await enter(page); const start = await playerPosition(page);
  await page.getByRole('complementary', { name: 'Character HUD' }).click();
  const notes = page.getByRole('textbox', { name: /Local scratchpad/ });
  await notes.fill('Checking'); await notes.press('Space'); await notes.press('1'); await notes.press('2');
  await expect(notes).toHaveValue('Checking 12');
  await page.waitForTimeout(250);
  expect(await playerPosition(page)).toEqual(start);
  await expect(page.locator('canvas')).toHaveAttribute('data-destination-x', '');
  await expect(page.locator('[data-game-feedback]')).toContainText('Click the ground to move.');
  const target = await clickWorld(page, 360, 600); await arrived(page, target.x, target.y);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-game-feedback]')).toContainText('Combat is deferred to M3');
});

test('movement does not rerender the React HUD every frame', async ({ page }) => {
  await enter(page); const root = page.locator('[data-hud-renders]');
  const renders = await root.getAttribute('data-hud-renders');
  const target = await clickWorld(page, 370, 600); await arrived(page, target.x, target.y);
  expect(await root.getAttribute('data-hud-renders')).toEqual(renders);
});

test('navigation repeatedly destroys old scenes and returns with one working instance', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page);
  for (let i = 0; i < 3; i++) {
    const oldCanvas = (await page.locator('canvas').elementHandle())!;
    await page.getByRole('link', { name: /Return to entrance/ }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.waitForTimeout(150);
    const oldFrames = await oldCanvas.getAttribute('data-frames');
    await page.waitForTimeout(200);
    expect(await oldCanvas.getAttribute('data-frames')).toEqual(oldFrames);
    await page.getByRole('link', { name: /Enter the glade/ }).click();
    await expect(page.locator('canvas[data-scene-ready="true"]')).toHaveCount(1);
    expect(await playerPosition(page)).toEqual({ x: 160, y: 540 });
    const target = await clickWorld(page, 340, 600); await arrived(page, target.x, target.y);
    await oldCanvas.dispose();
  }
  expect(errors).toEqual([]);
});

test('a second compatible fixture drives placement and movement data without scene edits', async ({ page }) => {
  const fixture = structuredClone(source);
  fixture.maps[0].playerSpawn = { x: 200, y: 600 };
  fixture.maps[0].enemies[0].position = { x: 650, y: 500 };
  fixture.classes[0].movementSpeed = 120;
  await page.route('**/api/content', route => route.fulfill({ json: fixture }));
  await enter(page);
  expect(await playerPosition(page)).toEqual({ x: 200, y: 600 });
  await expect(page.getByText(/120 units\/s/)).toBeVisible();
  await clickWorld(page, 650, 480);
  await expect(page.locator('[data-game-feedback]')).toContainText('Selected: Thornling');
});

test('invalid content shows a clear error without mounting Phaser', async ({ page }) => {
  const invalid = structuredClone(source); invalid.classes[0].skillIds.push('missing_skill');
  await page.route('**/api/content', route => route.fulfill({ json: invalid }));
  await page.goto('/play');
  await expect(page.locator('.notice[role="alert"]')).toContainText('Missing skills ID "missing_skill"');
  await expect(page.locator('canvas')).toHaveCount(0);
});
