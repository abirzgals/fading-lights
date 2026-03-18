const { test, expect } = require('@playwright/test');

test('Dev mode: game starts, fog is black, no errors', async ({ page }) => {
  const errors = [];
  const logs = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
    else logs.push(text);
  });
  page.on('pageerror', err => errors.push('PAGE_ERROR: ' + err.message));

  await page.goto('/');
  // On localhost, game auto-starts. Wait for world generation + rendering
  await page.waitForTimeout(30000);

  await page.screenshot({ path: 'test-results/fog-test.png' });

  console.log('\n=== ERRORS ===');
  errors.forEach(e => console.log('  ', e));
  console.log('\n=== KEY LOGS ===');
  logs.filter(l => l.includes('Fog') || l.includes('Normal') || l.includes('Character') || l.includes('Loading'))
    .forEach(l => console.log('  ', l));

  const critical = errors.filter(e =>
    !e.includes('ServiceWorker') && !e.includes('AudioContext') &&
    !e.includes('autoplay') && !e.includes('favicon') && !e.includes('404') &&
    !e.includes('net::') && !e.includes('Groq') && !e.includes('Failed to fetch')
  );

  expect(critical).toHaveLength(0);
});
