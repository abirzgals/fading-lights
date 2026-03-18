const { test, expect } = require('@playwright/test');

test('Game starts without shader/normal buffer errors', async ({ page }) => {
  const errors = [];
  const logs = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
    else logs.push(text);
  });
  page.on('pageerror', err => errors.push('PAGE_ERROR: ' + err.message));

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 15000 });

  // Click splash to dismiss intro
  await page.click('canvas').catch(() => {});
  await page.waitForTimeout(2000);

  // Skip video if any by clicking
  await page.click('body').catch(() => {});
  await page.waitForTimeout(3000);

  // We should be at menu now. Click START GAME
  const startBtn = page.locator('button:text("START GAME")');
  await startBtn.waitFor({ timeout: 10000 }).catch(() => {});
  if (await startBtn.isVisible()) {
    await startBtn.click();
    console.log('>>> Clicked START GAME');
  }

  // Wait for game scene to load
  await page.waitForTimeout(10000);

  // Collect results
  console.log('\n=== ALL CONSOLE ERRORS ===');
  errors.forEach(e => console.log('  ERROR:', e));
  console.log('\n=== FOG/NORMAL LOGS ===');
  logs.filter(l => l.includes('Fog') || l.includes('Normal') || l.includes('normal') || l.includes('shader'))
    .forEach(l => console.log('  LOG:', l));

  await page.screenshot({ path: 'test-results/normalmap-test.png' });

  // Check for critical errors (not audio/favicon)
  const critical = errors.filter(e =>
    !e.includes('ServiceWorker') && !e.includes('AudioContext') &&
    !e.includes('autoplay') && !e.includes('favicon') && !e.includes('404')
  );
  console.log('\n=== CRITICAL ERRORS ===');
  critical.forEach(e => console.log('  CRITICAL:', e));

  expect(critical).toHaveLength(0);
});
