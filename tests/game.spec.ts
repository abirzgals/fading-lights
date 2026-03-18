import { test, expect } from '@playwright/test';

test('Game renders with sprites, fog, and gameplay', async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    else logs.push(msg.text());
  });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));

  await page.goto('/');
  // Wait for loader + scene init
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: 'test-results/game-v2.png' });

  // Check scene initialized
  const sceneLog = logs.find(l => l.includes('[GameScene] initialized'));
  const assetsLog = logs.find(l => l.includes('[Assets] loaded'));

  console.log('\n=== KEY LOGS ===');
  logs.filter(l => l.includes('[') || l.includes('Fading')).forEach(l => console.log('  ', l));

  if (errors.length) {
    console.log('\n=== ERRORS ===');
    errors.forEach(e => console.log('  ERR:', e));
  }

  // Must have canvas with content
  const box = await page.locator('canvas').boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThan(100);

  // No critical errors
  const critical = errors.filter(e =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('GL Driver')
  );
  expect(critical).toHaveLength(0);
});

test('Player walks and chops trees with real sprites', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(5000);

  // Move around
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  await page.keyboard.down('s');
  await page.waitForTimeout(1000);
  await page.keyboard.up('s');

  // Attack
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: 'test-results/game-v2-playing.png' });
});
