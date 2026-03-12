// ============================================================
// BOT AI — Smart autonomous player for testing & fun
// Uses game's A* pathfinding, smooth movement, clever priorities
// Toggle: press ` (backtick) in-game or call startAI() / stopAI()
// ============================================================

(function() {
    'use strict';

    let aiInterval = null;
    let currentPath = null;
    let pathIdx = 0;
    let currentGoal = null;
    let stuckTimer = 0;
    let lastPos = { x: 0, y: 0 };
    let feedCount = 0;          // track feeds this trip to bonfire

    const TICK_MS = 100;
    const STUCK_THRESHOLD = 800;
    const WAYPOINT_REACH = 14;
    const ATTACK_REACH = 40;

    // Resource thresholds for smart management
    const WOOD_FEED_THRESHOLD = 5;   // feed when we have this much wood
    const WOOD_RESERVE = 3;          // always keep some wood in reserve
    const STONE_TARGET = 25;         // mine stone until we have this much
    const METAL_TARGET = 15;         // mine metal until we have this much

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
        const sc = getScene();
        if (sc && sc.player) sc.player.setVelocity(0, 0);
        console.log('%c[BOT] AI stopped', 'color: #FF4444');
        return 'AI stopped';
    };

    window.toggleAI = function() {
        return aiInterval ? stopAI() : startAI();
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === '`') { e.preventDefault(); toggleAI(); }
    });

    // ---- Helpers ----
    function getScene() { return window._gs; }
    function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

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

    function followPath(p, speed) {
        if (!currentPath || pathIdx >= currentPath.length) {
            p.setVelocity(0, 0);
            return true;
        }
        const wp = currentPath[pathIdx];
        const dx = wp.x - p.x, dy = wp.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < WAYPOINT_REACH) {
            pathIdx++;
            if (pathIdx >= currentPath.length) { p.setVelocity(0, 0); return true; }
            return false;
        }
        p.setVelocity((dx / len) * speed, (dy / len) * speed);
        const a = Math.atan2(dy, dx);
        p.facing = { x: Math.cos(a), y: Math.sin(a) };
        if (p.facing.x !== 0) p.setFlipX(p.facing.x < 0);
        return false;
    }

    function faceTarget(p, tx, ty) {
        const a = Math.atan2(ty - p.y, tx - p.x);
        p.facing = { x: Math.cos(a), y: Math.sin(a) };
        if (p.facing.x !== 0) p.setFlipX(p.facing.x < 0);
    }

    function doAttack(sc, p, tx, ty) {
        faceTarget(p, tx, ty);
        p.setVelocity(0, 0);
        if (p.attackCooldown <= 0) sc.playerAttack();
    }

    function checkStuck(p, dt) {
        const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
        stuckTimer = moved < 2 ? stuckTimer + dt : 0;
        lastPos.x = p.x;
        lastPos.y = p.y;
        return stuckTimer > STUCK_THRESHOLD;
    }

    // ---- What resource do we need most? ----
    function getResourceNeed() {
        const res = gameState.resources;
        const bonfire = getScene().bonfires[0];
        const fuelRatio = bonfire.getData('fuel') / bonfire.getData('maxFuel');

        // Always need wood for fuel
        if (res.wood < WOOD_FEED_THRESHOLD && fuelRatio < 0.8) return 'wood';
        // Need stone for buildings
        if (res.stone < STONE_TARGET) return 'stone';
        // Need metal for advanced buildings/weapons
        if (res.metal < METAL_TARGET) return 'metal';
        // Default: keep chopping wood (fuel is always needed)
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

        // EMERGENCY: Outside light — run home
        if (dist(px, py, bx, by) > lightR + 20) {
            return { type: 'flee', x: bx, y: by };
        }

        // PRIORITY 1: Kill nearby enemies aggressively
        let bestEnemy = null, bestEnemyDist = 150;
        for (const e of sc.enemies.children.entries) {
            if (!e.active) continue;
            const ed = dist(e.x, e.y, px, py);
            if (ed < bestEnemyDist) { bestEnemyDist = ed; bestEnemy = e; }
        }
        if (bestEnemy) {
            return { type: 'kill', target: bestEnemy, x: bestEnemy.x, y: bestEnemy.y };
        }

        // PRIORITY 2: Feed bonfire — AGGRESSIVE fuel management
        // Feed if: fuel < 80% and we have wood to spare, or fuel < 40% (emergency)
        const shouldFeed = (fuelRatio < 0.4 && res.wood >= 1) ||
                           (fuelRatio < 0.8 && res.wood > WOOD_RESERVE);
        if (shouldFeed) {
            return { type: 'feed', x: bx, y: by };
        }

        // PRIORITY 3: Build available structures (in strategic order)
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

        // PRIORITY 4: Collect nearby drops (within 120px)
        let bestDrop = null, bestDropDist = 120;
        if (sc.drops) {
            sc.drops.children.each(dd => {
                if (!dd.active) return;
                const ddist = dist(dd.x, dd.y, px, py);
                if (ddist < bestDropDist && dist(dd.x, dd.y, bx, by) < lightR) {
                    bestDropDist = ddist;
                    bestDrop = dd;
                }
            });
        }
        if (bestDrop) {
            return { type: 'pickup', target: bestDrop, x: bestDrop.x, y: bestDrop.y };
        }

        // PRIORITY 5: Gather resources based on what we need
        const need = getResourceNeed();
        if (need === 'wood') {
            const tree = findNearest(sc.trees, px, py, bx, by, lightR);
            if (tree) return { type: 'chop', target: tree, x: tree.x, y: tree.y };
        } else if (need === 'stone') {
            const stone = findNearest(sc.stones, px, py, bx, by, lightR);
            if (stone) return { type: 'mine', target: stone, x: stone.x, y: stone.y };
        } else if (need === 'metal') {
            const metal = findNearest(sc.metals, px, py, bx, by, lightR);
            if (metal) return { type: 'mine', target: metal, x: metal.x, y: metal.y };
        }

        // Fallback: chop wood if nothing else
        const tree = findNearest(sc.trees, px, py, bx, by, lightR);
        if (tree) return { type: 'chop', target: tree, x: tree.x, y: tree.y };

        return { type: 'idle', x: bx, y: by };
    }

    function findNearest(group, px, py, bx, by, lightR) {
        let best = null, bestDist = Infinity;
        for (const obj of group.children.entries) {
            if (!obj.active) continue;
            if (dist(obj.x, obj.y, bx, by) > lightR) continue;
            const d = dist(obj.x, obj.y, px, py);
            if (d < bestDist) { bestDist = d; best = obj; }
        }
        return best;
    }

    // ---- Main AI tick ----
    function aiTick() {
        const sc = getScene();
        if (!sc || !sc.player || !sc.player.active || gameState.gameOver) return;

        const p = sc.player;
        const speed = CONFIG.PLAYER_SPEED;
        const weapon = WEAPONS[gameState.weapon];
        const stuck = checkStuck(p, TICK_MS);

        const goal = selectGoal(sc, p);

        const goalChanged = !currentGoal || goal.type !== currentGoal.type ||
            (goal.target !== currentGoal.target && goal.type !== 'idle' && goal.type !== 'feed');
        if (goalChanged || stuck) {
            currentGoal = goal;
            currentPath = null;
            stuckTimer = 0;
            feedCount = 0;
        }

        switch (currentGoal.type) {
            case 'flee': {
                if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                followPath(p, speed);
                break;
            }

            case 'kill': {
                const enemy = currentGoal.target;
                if (!enemy || !enemy.active) { currentGoal = null; break; }
                const ed = dist(p.x, p.y, enemy.x, enemy.y);
                if (ed < ATTACK_REACH + (enemy.getData('size') || 16)) {
                    doAttack(sc, p, enemy.x, enemy.y);
                } else {
                    const dx = enemy.x - p.x, dy = enemy.y - p.y;
                    const len = Math.hypot(dx, dy);
                    p.setVelocity((dx / len) * speed, (dy / len) * speed);
                    faceTarget(p, enemy.x, enemy.y);
                }
                break;
            }

            case 'feed': {
                const bd = dist(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd < CONFIG.INTERACT_RADIUS) {
                    p.setVelocity(0, 0);
                    // Feed repeatedly while at bonfire and have wood to spare
                    if (gameState.resources.wood > WOOD_RESERVE) {
                        sc.playerInteract();
                        feedCount++;
                    } else {
                        currentGoal = null; // done feeding, go gather more
                    }
                } else {
                    if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'build': {
                const spot = currentGoal.target;
                if (!spot || spot.built) { currentGoal = null; break; }
                const sd = dist(p.x, p.y, spot.x, spot.y);
                if (sd < CONFIG.INTERACT_RADIUS) {
                    p.setVelocity(0, 0);
                    sc.playerInteract();
                    currentGoal = null; // built, re-evaluate
                } else {
                    if (!currentPath) pathTo(sc, spot.x, spot.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'pickup': {
                const drop = currentGoal.target;
                if (!drop || !drop.active) { currentGoal = null; break; }
                const dx = drop.x - p.x, dy = drop.y - p.y;
                const len = Math.hypot(dx, dy);
                if (len < CONFIG.PICKUP_RADIUS) {
                    currentGoal = null;
                } else {
                    p.setVelocity((dx / len) * speed, (dy / len) * speed);
                    faceTarget(p, drop.x, drop.y);
                }
                break;
            }

            case 'chop':
            case 'mine': {
                const target = currentGoal.target;
                if (!target || !target.active) { currentGoal = null; break; }
                const td = dist(p.x, p.y, target.x, target.y);
                if (td < weapon.range + 16) {
                    doAttack(sc, p, target.x, target.y);
                } else {
                    if (!currentPath) pathTo(sc, target.x, target.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'idle': {
                const bd = dist(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd > 80) {
                    if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                    followPath(p, speed * 0.6);
                } else {
                    p.setVelocity(0, 0);
                }
                break;
            }
        }
    }
})();
