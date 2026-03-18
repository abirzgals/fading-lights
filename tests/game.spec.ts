import { test, expect } from '@playwright/test';

test('Menu scene renders with title and start button', async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    else logs.push(msg.text());
  });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Menu should be visible
  await page.screenshot({ path: 'test-results/menu.png' });

  // Title text should exist
  const title = page.locator('text=THE FADING LIGHT');
  await expect(title).toBeVisible({ timeout: 5000 });

  // Start button should exist
  const startBtn = page.locator('#start-btn');
  await expect(startBtn).toBeVisible();

  // No critical errors
  const critical = errors.filter(e =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('GL Driver') && !e.includes('AudioContext')
  );
  expect(critical).toHaveLength(0);
});

test('Menu → Game transition works', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Type name
  const nameInput = page.locator('#player-name');
  await nameInput.fill('TestPlayer');

  // Click start
  const startBtn = page.locator('#start-btn');
  await startBtn.click();

  // Wait for game scene to load
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'test-results/game-v2.png' });

  // Game scene should have initialized
  const gameLog = logs.find(l => l.includes('[GameScene] initialized'));
  expect(gameLog).toBeTruthy();

  console.log('\n=== LOGS ===');
  logs.filter(l => l.includes('[')).forEach(l => console.log('  ', l));
});

test('Full gameplay: move, attack trees, kill enemies', async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      console.log('ERR:', msg.text());
    }
  });

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Start game
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
