const { test, expect } = require('@playwright/test');

test('diagnose maze scene startup', async ({ page }) => {
    const allLogs = [];
    const allErrors = [];
    page.on('console', msg => allLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', e => allErrors.push('PAGEERROR: ' + e.message));

    await page.goto('/?maze');
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Wait 12 seconds and report everything
    await page.waitForTimeout(12000);

    const state = await page.evaluate(() => {
        if (typeof game === 'undefined') return { error: 'no game object' };
        const g = game;
        const scenes = g.scene.scenes.map(s => ({
            key: s.sys.settings.key,
            active: s.sys.isActive(),
            status: s.sys.settings.status,
        }));
        const menu = g.scene.getScene('MenuScene');
        const ms = g.scene.getScene('MazeScene');
        return {
            scenes,
            playerTextureExists: g.textures.exists('player'),
            mazeFloorExists: g.textures.exists('maze_floor'),
            mazeStoneExists: g.textures.exists('maze_stone'),
            mazeHasGrid: !!(ms && ms._grid),
            menuTexturesRef: !!(menu && menu.textures),
            gameStateWeapon: typeof gameState !== 'undefined' ? gameState.weapon : 'undef',
            networkColor: typeof network !== 'undefined' ? network.playerColor : 'undef',
        };
    });

    console.log('\n=== SCENE STATE ===\n' + JSON.stringify(state, null, 2));
    console.log('\n=== PAGE ERRORS ===\n' + allErrors.join('\n'));
    console.log('\n=== RELEVANT LOGS ===\n' + allLogs.filter(l =>
        l.includes('MAZE') || l.includes('error') || l.includes('Error') ||
        l.includes('404') || l.includes('warn')).join('\n'));

    // This test always passes — it's just diagnostic
    expect(state).toBeTruthy();
});
