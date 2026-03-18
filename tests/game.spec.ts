import { test, expect } from '@playwright/test';

test('Intro → Menu renders with title and start button', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click intro splash to skip to menu
  const introOverlay = page.locator('#intro-overlay');
  if (await introOverlay.isVisible().catch(() => false)) {
    await introOverlay.click();
    await page.waitForTimeout(2000); // wait for video skip / transition
    // Skip video if playing
    const skip = page.locator('text=Skip');
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: 'test-results/menu.png' });

  // Menu should be visible
  const title = page.locator('text=THE FADING LIGHT');
  await expect(title).toBeVisible({ timeout: 10000 });
  const startBtn = page.locator('#start-btn');
  await expect(startBtn).toBeVisible();

  const critical = errors.filter(e =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('GL Driver') && !e.includes('Audio')
  );
  expect(critical).toHaveLength(0);
});

test('Intro → Menu → Game transition works', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Skip intro
  await page.locator('#intro-overlay').click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('text=Skip').click().catch(() => {});
  await page.waitForTimeout(2000);

  // Wait for menu
  await page.waitForSelector('#start-btn', { timeout: 10000 });
  await page.locator('#player-name').fill('TestPlayer');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'test-results/game-v2.png' });

  const gameLog = logs.find(l => l.includes('[GameScene] initialized'));
  expect(gameLog).toBeTruthy();
});

test('Full gameplay: move, attack trees, kill enemies', async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      console.log('ERR:', msg.text());
    }
  });

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Skip intro → menu → start
  await page.locator('#intro-overlay').click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('text=Skip').click().catch(() => {});
  await page.waitForTimeout(2000);
  await page.waitForSelector('#start-btn', { timeout: 10000 });
  await page.locator('#start-btn').click();
  await page.waitForTimeout(5000);

  // Move right and down
  await page.keyboard.down('d');
  await page.waitForTimeout(800);
  await page.keyboard.up('d');
  await page.keyboard.down('s');
  await page.waitForTimeout(800);
  await page.keyboard.up('s');

  // Attack
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: 'test-results/gameplay.png' });
});
