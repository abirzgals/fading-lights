// ============================================================
// BOT AI — Smart autonomous player for testing & fun
// Uses game's A* pathfinding, smooth movement, clever priorities
// Toggle: press ` (backtick) in-game or call startAI() / stopAI()
// ============================================================

(function() {
    'use strict';

    let aiInterval = null;
    let currentPath = null;   // A* waypoint array
    let pathIdx = 0;          // current waypoint index
    let currentGoal = null;   // { type, target, x, y }
    let stuckTimer = 0;
    let lastPos = { x: 0, y: 0 };
    let goalCooldowns = {};   // prevent re-targeting same goal

    const TICK_MS = 100;
    const STUCK_THRESHOLD = 500; // ms before considering stuck
    const WAYPOINT_REACH = 12;   // px to consider waypoint reached
    const ATTACK_REACH = 40;     // px to start attacking

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

    // Backtick toggle
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
        const path = sc._findPath(sc.player.x, sc.player.y, tx, ty);
        if (path && path.length > 0) {
            currentPath = path;
            pathIdx = 0;
            return true;
        }
        // Fallback: direct move (no obstacles on short range)
        currentPath = [{ x: tx, y: ty }];
        pathIdx = 0;
        return true;
    }

    function followPath(p, speed) {
        if (!currentPath || pathIdx >= currentPath.length) {
            p.setVelocity(0, 0);
            return true; // done
        }
        const wp = currentPath[pathIdx];
        const dx = wp.x - p.x, dy = wp.y - p.y;
        const len = Math.hypot(dx, dy);

        if (len < WAYPOINT_REACH) {
            pathIdx++;
            if (pathIdx >= currentPath.length) {
                p.setVelocity(0, 0);
                return true; // reached destination
            }
            return false; // next waypoint
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

    function attack(sc, p, tx, ty) {
        faceTarget(p, tx, ty);
        p.setVelocity(0, 0);
        if (p.attackCooldown <= 0) sc.playerAttack();
    }

    function interact(sc) {
        sc.playerInteract();
    }

    // ---- Stuck detection ----
    function checkStuck(p, dt) {
        const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
        if (moved < 2) {
            stuckTimer += dt;
        } else {
            stuckTimer = 0;
        }
        lastPos.x = p.x;
        lastPos.y = p.y;
        return stuckTimer > STUCK_THRESHOLD;
    }

    // ---- Goal selection (priority-based) ----
    function selectGoal(sc, p) {
        const px = p.x, py = p.y;
        const bonfire = sc.bonfires[0];
        const bx = bonfire.x, by = bonfire.y;
        const lightR = sc.getLightRadius(bonfire) * 0.85;
        const fuelRatio = bonfire.getData('fuel') / bonfire.getData('maxFuel');
        const weapon = WEAPONS[gameState.weapon];

        // EMERGENCY: Outside light — run home
        if (d(px, py, bx, by) > lightR + 20) {
            return { type: 'flee', x: bx, y: by, priority: 100 };
        }

        // PRIORITY 1: Kill nearby enemies (aggressive — chase within light)
        let bestEnemy = null, bestEnemyDist = 150;
        for (const e of sc.enemies.children.entries) {
            if (!e.active) continue;
            const ed = d(e.x, e.y, px, py);
            if (ed < bestEnemyDist) {
                bestEnemyDist = ed;
                bestEnemy = e;
            }
        }
        if (bestEnemy) {
            return { type: 'kill', target: bestEnemy, x: bestEnemy.x, y: bestEnemy.y, priority: 90 };
        }

        // PRIORITY 2: Feed bonfire when fuel < 60% and have wood
        if (fuelRatio < 0.6 && gameState.resources.wood >= 1) {
            return { type: 'feed', x: bx, y: by, priority: 80 };
        }

        // PRIORITY 3: Build available structures
        for (const spot of sc.buildSpots) {
            if (spot.built || !spot.unlocked) continue;
            const building = BUILDINGS[spot.config.type];
            if (building && canAfford(building.cost)) {
                return { type: 'build', target: spot, x: spot.x, y: spot.y, priority: 70 };
            }
        }

        // PRIORITY 4: Collect nearby drops
        let bestDrop = null, bestDropDist = 200;
        if (sc.drops) {
            sc.drops.children.each(dd => {
                if (!dd.active) return;
                const ddist = d(dd.x, dd.y, px, py);
                // Only pick up drops within light
                if (ddist < bestDropDist && d(dd.x, dd.y, bx, by) < lightR) {
                    bestDropDist = ddist;
                    bestDrop = dd;
                }
            });
        }
        if (bestDrop) {
            return { type: 'pickup', target: bestDrop, x: bestDrop.x, y: bestDrop.y, priority: 60 };
        }

        // PRIORITY 5: Chop trees (prefer closest within light)
        let bestTree = null, bestTreeDist = Infinity;
        for (const t of sc.trees.children.entries) {
            if (!t.active) continue;
            if (d(t.x, t.y, bx, by) > lightR) continue;
            const td = d(t.x, t.y, px, py);
            if (td < bestTreeDist) {
                bestTreeDist = td;
                bestTree = t;
            }
        }
        if (bestTree) {
            return { type: 'chop', target: bestTree, x: bestTree.x, y: bestTree.y, priority: 50 };
        }

        // PRIORITY 6: Mine stone (need for buildings)
        if (gameState.resources.stone < 20) {
            let bestStone = null, bestStoneDist = Infinity;
            for (const s of sc.stones.children.entries) {
                if (!s.active) continue;
                if (d(s.x, s.y, bx, by) > lightR) continue;
                const sd = d(s.x, s.y, px, py);
                if (sd < bestStoneDist) {
                    bestStoneDist = sd;
                    bestStone = s;
                }
            }
            if (bestStone) {
                return { type: 'mine', target: bestStone, x: bestStone.x, y: bestStone.y, priority: 40 };
            }
        }

        // IDLE: Stay near bonfire
        return { type: 'idle', x: bx, y: by, priority: 0 };
    }

    // ---- Main AI tick ----
    function aiTick() {
        const sc = getScene();
        if (!sc || !sc.player || !sc.player.active || gameState.gameOver) return;

        const p = sc.player;
        const speed = CONFIG.PLAYER_SPEED;
        const weapon = WEAPONS[gameState.weapon];
        const stuck = checkStuck(p, TICK_MS);

        // Re-evaluate goal
        const goal = selectGoal(sc, p);

        // If goal changed or we're stuck, repath
        const goalChanged = !currentGoal || goal.type !== currentGoal.type ||
            (goal.target !== currentGoal.target && goal.type !== 'idle');
        if (goalChanged || stuck) {
            currentGoal = goal;
            currentPath = null;
            stuckTimer = 0;
        }

        // Execute current goal
        switch (currentGoal.type) {
            case 'flee': {
                if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                followPath(p, speed * 1.0);
                break;
            }

            case 'kill': {
                const enemy = currentGoal.target;
                if (!enemy || !enemy.active) { currentGoal = null; break; }
                const ed = d(p.x, p.y, enemy.x, enemy.y);
                if (ed < ATTACK_REACH + (enemy.getData('size') || 16)) {
                    attack(sc, p, enemy.x, enemy.y);
                } else {
                    // Direct chase for enemies (they move, A* would be stale)
                    const dx = enemy.x - p.x, dy = enemy.y - p.y;
                    const len = Math.hypot(dx, dy);
                    p.setVelocity((dx/len) * speed, (dy/len) * speed);
                    faceTarget(p, enemy.x, enemy.y);
                }
                break;
            }

            case 'feed': {
                const bd = d(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd < CONFIG.INTERACT_RADIUS) {
                    p.setVelocity(0, 0);
                    interact(sc);
                } else {
                    if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'build': {
                const spot = currentGoal.target;
                if (!spot || spot.built) { currentGoal = null; break; }
                const sd = d(p.x, p.y, spot.x, spot.y);
                if (sd < CONFIG.INTERACT_RADIUS) {
                    p.setVelocity(0, 0);
                    interact(sc);
                } else {
                    if (!currentPath) pathTo(sc, spot.x, spot.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'pickup': {
                const drop = currentGoal.target;
                if (!drop || !drop.active) { currentGoal = null; break; }
                // Walk directly — drops are on open ground
                const dx = drop.x - p.x, dy = drop.y - p.y;
                const len = Math.hypot(dx, dy);
                if (len < CONFIG.PICKUP_RADIUS) {
                    // Auto-pickup handles it
                    currentGoal = null;
                } else {
                    p.setVelocity((dx/len) * speed, (dy/len) * speed);
                    faceTarget(p, drop.x, drop.y);
                }
                break;
            }

            case 'chop': {
                const tree = currentGoal.target;
                if (!tree || !tree.active) { currentGoal = null; break; }
                const td = d(p.x, p.y, tree.x, tree.y);
                if (td < weapon.range + 16) {
                    attack(sc, p, tree.x, tree.y);
                } else {
                    if (!currentPath) pathTo(sc, tree.x, tree.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'mine': {
                const stone = currentGoal.target;
                if (!stone || !stone.active) { currentGoal = null; break; }
                const sd = d(p.x, p.y, stone.x, stone.y);
                if (sd < weapon.range + 16) {
                    attack(sc, p, stone.x, stone.y);
                } else {
                    if (!currentPath) pathTo(sc, stone.x, stone.y);
                    followPath(p, speed);
                }
                break;
            }

            case 'idle': {
                const bd = d(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd > 80) {
                    if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                    followPath(p, speed * 0.5);
                } else {
                    p.setVelocity(0, 0);
                }
                break;
            }
        }
    }
})();
