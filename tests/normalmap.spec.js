const { test, expect } = require('@playwright/test');

test('Mobile emulation: fog renders correctly', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const errors = [];
  const logs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    else logs.push(msg.text());
  });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));

  await page.goto('http://localhost:8080');

  // Wait for canvas
  await page.waitForSelector('canvas', { timeout: 15000 });
  // IS_DEV=true on localhost, so game auto-starts after menu preload
  // Wait generously for world gen
  await page.waitForTimeout(40000);

  await page.screenshot({ path: 'test-results/mobile-fog.png' });

  // Check state
  const state = await page.evaluate(() => {
    const r = {};
    r.isMobile = typeof mobileControls !== 'undefined' ? mobileControls.isMobile : 'undef';
    r.IS_DEV = typeof IS_DEV !== 'undefined' ? IS_DEV : 'undef';
    r.rendererType = typeof game !== 'undefined' ? game.renderer.type : 'undef';
    r.phaserWEBGL = typeof Phaser !== 'undefined' ? Phaser.WEBGL : 'undef';
    r.isWebGL = r.rendererType === r.phaserWEBGL;
    // Check if fog pipeline exists on active scene
    try {
      const scene = game.scene.getScenes(true)[0];
      r.activeScene = scene.constructor.name;
      r.hasFogPipeline = !!scene._fogPipeline;
    } catch(e) { r.sceneError = e.message; }
    return r;
  });
  console.log('\n=== STATE ===', JSON.stringify(state, null, 2));

  // Sample pixels
  const colors = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'no-canvas';
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'no-gl (Canvas2D renderer?)';
    const w = canvas.width, h = canvas.height;
    const read = (x, y) => {
      const px = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2], px[3]];
    };
    return {
      topLeft: read(5, h - 5),
      topRight: read(w - 5, h - 5),
      bottomLeft: read(5, 5),
      bottomRight: read(w - 5, 5),
      center: read(Math.floor(w/2), Math.floor(h/2)),
      quarterLeft: read(Math.floor(w/4), Math.floor(h/2)),
    };
  });

  console.log('\n=== PIXELS ===');
  if (typeof colors === 'object' && colors !== null && !Array.isArray(colors)) {
    for (const [name, c] of Object.entries(colors)) {
      if (Array.isArray(c)) {
        const b = c[0]+c[1]+c[2];
        console.log(`  ${name}: rgba(${c.join(',')}) ${b < 10 ? 'BLACK' : b > 100 ? 'BRIGHT' : 'GRAY'}`);
      }
    }
  } else {
    console.log(' ', colors);
  }

  console.log('\n=== KEY LOGS ===');
  logs.filter(l => l.includes('Fog') || l.includes('Normal') || l.includes('Char') || l.includes('Canvas') || l.includes('WebGL'))
    .forEach(l => console.log('  ', l));

  console.log('\n=== ERRORS ===');
  errors.filter(e => !e.includes('favicon') && !e.includes('404'))
    .forEach(e => console.log('  ', e));

  await context.close();
});
