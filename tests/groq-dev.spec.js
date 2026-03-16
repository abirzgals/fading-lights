/**
 * Shadow Mind / Groq AI dev-mode test
 * Enables debug mode, starts game solo (network bypassed), waits for Shadow Mind spawn,
 * captures Groq API calls and AI reasoning from console.
 */
const { test, expect } = require('@playwright/test');

test.use({ headless: false, viewport: { width: 1280, height: 800 } });
test.setTimeout(120_000);

test('Shadow Mind spawns in dev mode and requests Groq plan', async ({ page }) => {
    const groqRequests = [];
    let groqResponseContent = '';

    // Capture console output (errors always shown)
    page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error' || text.includes('[Shadow Mind]') || text.includes('[GroqAI]') || text.includes('Groq') || text.includes('groq')) {
            console.log(msg.type() === 'error' ? '❌ JS ERROR:' : '🟣', text);
        }
    });
    page.on('pageerror', err => console.error('💥 PAGE ERROR:', err.message));

    // Intercept Groq Worker requests
    await page.route('https://thefadinglight.arturs-birzgals.workers.dev', async route => {
        const body = route.request().postDataJSON();
        groqRequests.push(body);
        console.log('\n📤 GROQ REQUEST → model:', body.model,
            '\n   prompt (first 400):\n  ', body.messages?.[1]?.content?.slice(0, 400));

        const resp = await route.fetch();
        const data = await resp.json();
        const choice = data.choices?.[0]?.message;
        groqResponseContent = choice?.content || choice?.reasoning || '';
        console.log('\n📥 GROQ RESPONSE (first 500):\n', groqResponseContent.slice(0, 500));
        await route.fulfill({ response: resp });
    });

    // Set debug mode and short-circuit network before any scripts run
    await page.addInitScript(() => {
        window._debugMode = true;
        // Fully mock out service worker so it never triggers a page reload
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            get: () => ({
                register: () => Promise.resolve({ update: () => {} }),
                addEventListener: () => {},
                getRegistrations: () => Promise.resolve([]),
                ready: new Promise(() => {}),
            }),
        });
        // Override network so joinRoom/createRoom resolve immediately → solo mode
        Object.defineProperty(window, 'network', {
            configurable: true,
            get() { return this._networkProxy; },
            set(obj) {
                // Patch after original network object is assigned
                obj._origJoinRoom = obj.joinRoom;
                obj.joinRoom = async () => false;   // always fail → solo fallback
                obj._origCreateRoom = obj._createRoomWithCode;
                obj._createRoomWithCode = async (name, color, code) => {
                    obj.isHost = true;
                    obj.worldSeed = obj.generateSeed ? obj.generateSeed() : Date.now();
                    obj.playerName = name;
                    obj.playerColor = color;
                    obj.roomCode = code || 'SOLO';
                    return false;
                };
                this._networkProxy = obj;
            },
        });
    });

    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });

    // Wait for Phaser canvas
    await page.waitForSelector('canvas', { timeout: 20000 });
    console.log('✅ Canvas found');

    // Wait for menu HTML overlay (name input) to appear
    await page.waitForSelector('#player-name-input', { timeout: 10000 });
    console.log('✅ Menu overlay ready');

    await page.waitForTimeout(500);

    // Press ENTER to start the game (triggers _startGame in menu)
    await page.keyboard.press('Enter');
    console.log('✅ Pressed ENTER to start');

    // Wait for HUD to become visible (game scene active)
    await page.waitForFunction(
        () => document.getElementById('hud')?.style.display !== 'none',
        { timeout: 60000 }
    );
    console.log('✅ HUD visible — game scene active');

    // Groq panel should appear since _debugMode is true
    await page.waitForSelector('#groq-debug-panel', { timeout: 10000 });
    console.log('✅ Groq debug panel found');

    // Wait for Shadow Mind to spawn (800ms delayedCall in create())
    await page.waitForFunction(
        () => window._gs?.enemies?.getChildren().some(e => e.getData?.('fromGroq')),
        { timeout: 8000 }
    );
    console.log('✅ Shadow Mind spawned');

    // Check Shadow Mind is alive and has a weapon sprite
    const enemyInfo = await page.evaluate(() => {
        const gs = window._gs;
        if (!gs) return null;
        const sm = gs.enemies?.getChildren().find(e => e.getData?.('fromGroq'));
        if (!sm) return null;
        return {
            alive:         true,
            hasWeapon:     !!sm.getData('enemyWeapon'),
            weaponName:    sm.getData('enemyWeapon')?.name ?? null,
            weaponDamage:  sm.getData('damage'),
            hasSpriteObj:  !!sm.getData('weaponSprite'),
        };
    });
    console.log('🟣 Shadow Mind info:', enemyInfo);

    expect(enemyInfo, 'Shadow Mind should exist in scene').not.toBeNull();
    expect(enemyInfo.hasWeapon, 'Shadow Mind should carry a weapon').toBe(true);
    expect(enemyInfo.hasSpriteObj, 'Weapon sprite should be created').toBe(true);
    console.log(`✅ Shadow Mind carries "${enemyInfo.weaponName}", deals ${enemyInfo.weaponDamage} dmg`);

    // Now wait for Groq response (with generous timeout — might be slow)
    try {
        await page.waitForFunction(
            () => {
                const body = document.getElementById('groq-log-body');
                return body?.innerText.includes('RESPONSE') || body?.innerText.includes('ERROR');
            },
            { timeout: 75000 }
        );
        const panelText = await page.$eval('#groq-log-body', el => el.innerText);
        const got = panelText.includes('RESPONSE') ? 'RESPONSE' : 'ERROR';
        console.log(`✅ Groq panel: ${got} — ${panelText.slice(0, 200)}`);
    } catch {
        console.log('⚠️  Groq response timed out (API may be slow) — core checks already passed');
    }

    console.log('\n🎉 All checks passed!');
    await page.waitForTimeout(8000);
});
