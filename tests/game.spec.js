const { test, expect } = require('@playwright/test');

test.describe('The Fading Light - Game Tests', () => {

  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('The Fading Light');
  });

  test('game container is present', async ({ page }) => {
    await page.goto('/');
    const container = page.locator('#game-container');
    await expect(container).toBeVisible();
  });

  test('Phaser canvas is created', async ({ page }) => {
    await page.goto('/');
    // Wait for Phaser to initialize and render a canvas
    await page.waitForSelector('canvas', { timeout: 15000 });
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('fullscreen button is visible', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('#fullscreen-btn');
    await expect(btn).toBeVisible();
  });

  test('game-over screen is hidden by default', async ({ page }) => {
    await page.goto('/');
    const gameOver = page.locator('#game-over-screen');
    await expect(gameOver).toBeHidden();
  });

  test('HUD is hidden until game starts', async ({ page }) => {
    await page.goto('/');
    const hud = page.locator('#hud');
    await expect(hud).toBeHidden();
  });

  test('manifeset.json is served correctly', async ({ page }) => {
    const response = await page.request.get('/manifest.json');
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.name || json.short_name).toBeTruthy();
  });

  test('Phaser scripts load without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    // Wait for canvas (game initialized)
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Filter known benign errors (service worker, audio context, etc.)
    const critical = errors.filter(e =>
      !e.includes('ServiceWorker') &&
      !e.includes('AudioContext') &&
      !e.includes('autoplay') &&
      !e.includes('favicon')
    );
    expect(critical).toHaveLength(0);
  });

  test('menu scene renders (canvas has non-zero dimensions)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 15000 });
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

});
