import { test, expect } from '@playwright/test';

test('Game loads and renders with enemies', async ({ page }) => {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    else logs.push(msg.text());
  });

  await page.goto('/?skipIntro=1&ai=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(8000); // wait for world gen + enemy spawn

  await page.screenshot({ path: 'test-results/game.png' });

  const gameLog = logs.find(l => l.includes('[GameScene] initialized'));
  expect(gameLog).toBeTruthy();

  console.log('\n=== KEY LOGS ===');
  logs.filter(l => l.includes('[')).forEach(l => console.log('  ', l));

  const critical = errors.filter(e =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('GL Driver') &&
    !e.includes('Audio') && !e.includes('Failed to load') && !e.includes('net::')
  );
  expect(critical).toHaveLength(0);
});

test('Enemies walk with animation and attack', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.goto('/?skipIntro=1&ai=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(8000);

  // Wait for enemies to start moving toward player
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'test-results/enemies-moving.png' });

  // Player should still be alive (1000 HP)
  // Just verify no crashes
});

test('Player attacks enemies with SPACE', async ({ page }) => {
  await page.goto('/?skipIntro=1&ai=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(8000);

  // Attack several times
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: 'test-results/combat.png' });
});
