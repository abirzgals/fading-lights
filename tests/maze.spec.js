// ============================================================
// MAZE SCENE TEST — verifies Level 2 loads and runs
// Uses ?maze URL param to skip straight to MazeScene
// NOTE: `game` is a const (not window.game) in the page scope.
// ============================================================
const { test, expect } = require('@playwright/test');

// Wait until MazeScene is running and fully created (_grid exists)
async function waitForMaze(page, timeout = 60000) {
    await page.waitForFunction(() => {
        // `game` is a top-level const — accessible in evaluate scope
        if (typeof game === 'undefined') return false;
        const ms = game.scene.getScene('MazeScene');
        return !!(ms && ms.sys && ms.sys.isActive() && ms._grid);
    }, { timeout });
}

test.describe('MazeScene — Level 2', () => {

    test('?maze param boots to MazeScene without JS errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push('[pageerror] ' + err.message));
        page.on('console', msg => {
            if (msg.type() === 'error') {
                const txt = msg.text();
                if (!txt.includes('404') && !txt.includes('favicon')) {
                    errors.push('[console.error] ' + txt);
                }
            }
        });

        await page.goto('/?maze');
        await page.waitForSelector('canvas', { timeout: 15000 });
        await waitForMaze(page);

        const critical = errors.filter(e =>
            !e.includes('ServiceWorker') &&
            !e.includes('AudioContext') &&
            !e.includes('autoplay') &&
            !e.includes('favicon')
        );
        if (critical.length > 0) console.log('Critical errors:', critical);
        expect(critical).toHaveLength(0);
    });

    test('MazeScene renders a canvas with non-zero size', async ({ page }) => {
        await page.goto('/?maze');
        await page.waitForSelector('canvas', { timeout: 15000 });
        const box = await page.locator('canvas').boundingBox();
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
    });

    test('MazeScene: dungeon grid is generated (floor tiles exist)', async ({ page }) => {
        await page.goto('/?maze');
        await page.waitForSelector('canvas', { timeout: 15000 });
        await waitForMaze(page);

        const info = await page.evaluate(() => {
            const ms = game.scene.getScene('MazeScene');
            const grid = ms._grid;
            let floors = 0;
            for (const row of grid) for (const cell of row) if (cell === 1) floors++;
            return { floors, rows: grid.length, cols: grid[0].length };
        });

        console.log('Dungeon info:', JSON.stringify(info));
        expect(info.rows).toBe(68);
        expect(info.cols).toBe(68);
        expect(info.floors).toBeGreaterThan(200);
    });

    test('MazeScene: treasure chest exists in last room', async ({ page }) => {
        await page.goto('/?maze');
        await page.waitForSelector('canvas', { timeout: 15000 });
        await waitForMaze(page);

        const hasTreasure = await page.evaluate(() => {
            const ms = game.scene.getScene('MazeScene');
            return !!(ms && ms.treasure && ms.treasure.active);
        });
        console.log('Treasure chest active:', hasTreasure);
        expect(hasTreasure).toBe(true);
    });

    test('MazeScene: player can move (responds to WASD)', async ({ page }) => {
        await page.goto('/?maze');
        await page.waitForSelector('canvas', { timeout: 15000 });
        await waitForMaze(page);

        const before = await page.evaluate(() => {
            const ms = game.scene.getScene('MazeScene');
            return { x: ms.player.x, y: ms.player.y };
        });

        await page.locator('canvas').click({ position: { x: 10, y: 10 } });
        await page.keyboard.down('D');
        await page.waitForTimeout(800);
        await page.keyboard.up('D');
        await page.waitForTimeout(100);

        const after = await page.evaluate(() => {
            const ms = game.scene.getScene('MazeScene');
            return { x: ms.player.x, y: ms.player.y };
        });

        console.log(`Player moved: (${before.x.toFixed(1)}, ${before.y.toFixed(1)}) → (${after.x.toFixed(1)}, ${after.y.toFixed(1)})`);
        expect(after.x).not.toEqual(before.x);
    });

    test('MazeScene: enemies spawn in rooms', async ({ page }) => {
        await page.goto('/?maze');
        await page.waitForSelector('canvas', { timeout: 15000 });
        await waitForMaze(page);

        const enemyCount = await page.evaluate(() => {
            const ms = game.scene.getScene('MazeScene');
            return ms.mazeEnemies ? ms.mazeEnemies.countActive() : 0;
        });
        console.log('Active enemies:', enemyCount);
        expect(enemyCount).toBeGreaterThan(0);
    });

});
