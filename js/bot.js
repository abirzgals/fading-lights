// ============================================================
// BOT AI — Smart autonomous player
// Simulates keyboard input for smooth natural movement
// Toggle: backtick key or startAI() / stopAI()
// ============================================================

(function() {
    'use strict';

    let aiInterval = null;
    let currentPath = null;
    let pathIdx = 0;
    let currentGoal = null;
    let stuckTimer = 0;
    let lastPos = { x: 0, y: 0 };
    let moveDir = { x: 0, y: 0 };  // current movement direction (-1/0/1)

    const TICK_MS = 200;             // decision tick (not movement tick)
    const STUCK_THRESHOLD = 1000;
    const WAYPOINT_REACH = 18;
    const ATTACK_REACH = 40;
    const WOOD_FEED_BATCH = 5;
    const STONE_TARGET = 25;
    const METAL_TARGET = 15;

    // ---- Keyboard simulation ----
    // Override cursor keys to let the game's update() move the player naturally
    function setMove(dx, dy) {
        const sc = getScene();
        if (!sc || !sc.cursors) return;
        const c = sc.cursors;
        // Simulate key states — Phaser reads isDown each frame
        c.left.isDown = dx < -0.3;
        c.right.isDown = dx > 0.3;
        c.up.isDown = dy < -0.3;
        c.down.isDown = dy > 0.3;
        moveDir.x = dx;
        moveDir.y = dy;
    }

    function stopMove() {
        setMove(0, 0);
    }

    function simulateAttack(sc) {
        if (!sc || !sc.cursors) return;
        // Trigger attack via the keyboard key
        sc.cursors.attack.isDown = true;
        // Release next frame
        setTimeout(() => { if (sc.cursors) sc.cursors.attack.isDown = false; }, 50);
    }

    function simulateInteract(sc) {
        if (!sc || !sc.cursors) return;
        sc.cursors.interact.isDown = true;
        setTimeout(() => { if (sc.cursors) sc.cursors.interact.isDown = false; }, 50);
    }

    // ---- Public API ----
    window.startAI = function() {
        if (aiInterval) return 'already running';
        aiInterval = setInterval(aiTick, TICK_MS);
        console.log('%c[BOT] AI started', 'color: #44FF44');
        return 'AI started';
    };

    window.stopAI = function() {
        if (aiInterval) { clearInterval(aiInterval); aiInterval = null; }
        currentPath = null;
        currentGoal = null;
        stopMove();
        console.log('%c[BOT] AI stopped', 'color: #FF4444');
        return 'AI stopped';
    };

    window.toggleAI = function() { return aiInterval ? stopAI() : startAI(); };

    document.addEventListener('keydown', (e) => {
        if (e.key === '`') { e.preventDefault(); toggleAI(); }
    });

    // ---- Helpers ----
    function getScene() { return window._gs; }
    function d(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

    function canAfford(cost) {
        for (const [res, amt] of Object.entries(cost)) {
            if ((gameState.resources[res] || 0) < amt) return false;
        }
        return true;
    }

    function pathTo(sc, tx, ty) {
        const px = sc.player.x, py = sc.player.y;
        let path = sc._findPath(px, py, tx, ty);
        if (!path) {
            const T = CONFIG.TILE_SIZE;
            const angle = Math.atan2(py - ty, px - tx);
            const offsets = [
                { x: Math.cos(angle) * T, y: Math.sin(angle) * T },
                { x: T, y: 0 }, { x: -T, y: 0 }, { x: 0, y: T }, { x: 0, y: -T },
                { x: T, y: T }, { x: -T, y: T }, { x: T, y: -T }, { x: -T, y: -T },
            ];
            for (const off of offsets) {
                path = sc._findPath(px, py, tx + off.x, ty + off.y);
                if (path) break;
            }
        }
        if (path && path.length > 0) {
            currentPath = path;
            pathIdx = 0;
            return true;
        }
        currentPath = [{ x: tx, y: ty }];
        pathIdx = 0;
        return true;
    }

    // Follow path by setting movement direction (not velocity)
    function followPath(p) {
        if (!currentPath || pathIdx >= currentPath.length) {
            stopMove();
            return true;
        }
        const wp = currentPath[pathIdx];
        const dx = wp.x - p.x, dy = wp.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < WAYPOINT_REACH) {
            pathIdx++;
            if (pathIdx >= currentPath.length) { stopMove(); return true; }
            // Immediately steer toward next waypoint
            const nwp = currentPath[pathIdx];
            const ndx = nwp.x - p.x, ndy = nwp.y - p.y;
            const nlen = Math.hypot(ndx, ndy);
            if (nlen > 1) setMove(ndx / nlen, ndy / nlen);
            return false;
        }
        setMove(dx / len, dy / len);
        return false;
    }

    // Move directly toward a point (for short distances / moving targets)
    function moveToward(p, tx, ty) {
        const dx = tx - p.x, dy = ty - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 5) { stopMove(); return true; }
        setMove(dx / len, dy / len);
        return false;
    }

    function faceTarget(p, tx, ty) {
        const a = Math.atan2(ty - p.y, tx - p.x);
        p.facing = { x: Math.cos(a), y: Math.sin(a) };
        if (p.facing.x !== 0) p.setFlipX(p.facing.x < 0);
    }

    function checkStuck(p, dt) {
        const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
        stuckTimer = moved < 3 ? stuckTimer + dt : 0;
        lastPos.x = p.x;
        lastPos.y = p.y;
        return stuckTimer > STUCK_THRESHOLD;
    }

    function findNearest(group, px, py, bx, by, lightR) {
        let best = null, bestDist = Infinity;
        for (const obj of group.children.entries) {
            if (!obj.active) continue;
            if (d(obj.x, obj.y, bx, by) > lightR) continue;
            const dd = d(obj.x, obj.y, px, py);
            if (dd < bestDist) { bestDist = dd; best = obj; }
        }
        return best;
    }

    function getResourceNeed() {
        const res = gameState.resources;
        if (res.wood < WOOD_FEED_BATCH) return 'wood';
        const sc = getScene();
        if (sc) {
            for (const spot of sc.buildSpots) {
                if (spot.built || !spot.unlocked) continue;
                const building = BUILDINGS[spot.config.type];
                if (!building) continue;
                for (const [r, amt] of Object.entries(building.cost)) {
                    if ((res[r] || 0) < amt) {
                        if (r === 'stone') return 'stone';
                        if (r === 'metal') return 'metal';
                    }
                }
            }
        }
        return 'wood';
    }

    // ---- Goal selection ----
    function selectGoal(sc, p) {
        const px = p.x, py = p.y;
        const bonfire = sc.bonfires[0];
        const bx = bonfire.x, by = bonfire.y;
        const lightR = sc.getLightRadius(bonfire) * 0.85;
        const fuelRatio = bonfire.getData('fuel') / bonfire.getData('maxFuel');
        const res = gameState.resources;

        // EMERGENCY: Outside light
        if (d(px, py, bx, by) > lightR + 20) {
            return { type: 'flee', x: bx, y: by };
        }

        // Kill nearby enemies
        let bestEnemy = null, bestEnemyDist = 150;
        for (const e of sc.enemies.children.entries) {
            if (!e.active) continue;
            const ed = d(e.x, e.y, px, py);
            if (ed < bestEnemyDist) { bestEnemyDist = ed; bestEnemy = e; }
        }
        if (bestEnemy) {
            return { type: 'kill', target: bestEnemy, x: bestEnemy.x, y: bestEnemy.y };
        }

        // Feed bonfire when we have a batch or emergency
        const shouldFeed = res.wood >= WOOD_FEED_BATCH ||
                           (fuelRatio < 0.5 && res.wood >= 1);
        if (shouldFeed) {
            return { type: 'feed', x: bx, y: by };
        }

        // Build available structures
        const buildOrder = ['FORGE', 'TURRET', 'ARMOR_WORKSHOP', 'OUTPOST', 'WEAPON_SHOP', 'FRIEND_HUT'];
        for (const bType of buildOrder) {
            for (const spot of sc.buildSpots) {
                if (spot.built || !spot.unlocked) continue;
                if (spot.config.type !== bType) continue;
                const building = BUILDINGS[bType];
                if (building && canAfford(building.cost)) {
                    return { type: 'build', target: spot, x: spot.x, y: spot.y };
                }
            }
        }

        // Collect nearby drops
        let bestDrop = null, bestDropDist = 120;
        if (sc.drops) {
            sc.drops.children.each(dd => {
                if (!dd.active) return;
                const ddist = d(dd.x, dd.y, px, py);
                if (ddist < bestDropDist && d(dd.x, dd.y, bx, by) < lightR) {
                    bestDropDist = ddist;
                    bestDrop = dd;
                }
            });
        }
        if (bestDrop) {
            return { type: 'pickup', target: bestDrop, x: bestDrop.x, y: bestDrop.y };
        }

        // Gather resources
        const need = getResourceNeed();
        const group = need === 'wood' ? sc.trees : need === 'stone' ? sc.stones : sc.metals;
        const target = findNearest(group, px, py, bx, by, lightR);
        if (target) {
            return { type: need === 'wood' ? 'chop' : 'mine', target, x: target.x, y: target.y };
        }

        return { type: 'idle', x: bx, y: by };
    }

    // ---- Main AI tick ----
    function aiTick() {
        const sc = getScene();
        if (!sc || !sc.player || !sc.player.active || gameState.gameOver) {
            stopMove();
            return;
        }

        const p = sc.player;
        const weapon = WEAPONS[gameState.weapon];
        const stuck = checkStuck(p, TICK_MS);

        const goal = selectGoal(sc, p);

        const goalChanged = !currentGoal || goal.type !== currentGoal.type ||
            (goal.target !== currentGoal.target && goal.type !== 'idle' && goal.type !== 'feed');
        if (goalChanged || stuck) {
            currentGoal = goal;
            currentPath = null;
            stuckTimer = 0;
        }

        switch (currentGoal.type) {
            case 'flee': {
                if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                followPath(p);
                break;
            }

            case 'kill': {
                const enemy = currentGoal.target;
                if (!enemy || !enemy.active) { currentGoal = null; stopMove(); break; }
                const ed = d(p.x, p.y, enemy.x, enemy.y);
                if (ed < ATTACK_REACH + (enemy.getData('size') || 16)) {
                    stopMove();
                    faceTarget(p, enemy.x, enemy.y);
                    if (p.attackCooldown <= 0) simulateAttack(sc);
                } else {
                    moveToward(p, enemy.x, enemy.y);
                }
                break;
            }

            case 'feed': {
                const bd = d(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd < CONFIG.INTERACT_RADIUS) {
                    stopMove();
                    if (gameState.resources.wood > 0) {
                        simulateInteract(sc);
                    } else {
                        currentGoal = null;
                    }
                } else {
                    if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                    followPath(p);
                }
                break;
            }

            case 'build': {
                const spot = currentGoal.target;
                if (!spot || spot.built) { currentGoal = null; stopMove(); break; }
                const sd = d(p.x, p.y, spot.x, spot.y);
                if (sd < CONFIG.INTERACT_RADIUS) {
                    stopMove();
                    simulateInteract(sc);
                    currentGoal = null;
                } else {
                    if (!currentPath) pathTo(sc, spot.x, spot.y);
                    followPath(p);
                }
                break;
            }

            case 'pickup': {
                const drop = currentGoal.target;
                if (!drop || !drop.active) { currentGoal = null; stopMove(); break; }
                moveToward(p, drop.x, drop.y);
                break;
            }

            case 'chop':
            case 'mine': {
                const target = currentGoal.target;
                if (!target || !target.active) { currentGoal = null; stopMove(); break; }
                const td = d(p.x, p.y, target.x, target.y);
                if (td < weapon.range + 16) {
                    stopMove();
                    faceTarget(p, target.x, target.y);
                    if (p.attackCooldown <= 0) simulateAttack(sc);
                } else {
                    if (!currentPath) pathTo(sc, target.x, target.y);
                    followPath(p);
                }
                break;
            }

            case 'idle': {
                const bd = d(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd > 80) {
                    if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                    followPath(p);
                } else {
                    stopMove();
                }
                break;
            }
        }
    }
})();
