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
    const STUCK_THRESHOLD = 400;  // detect stuck fast (2 ticks)
    const WAYPOINT_REACH = 18;
    const ATTACK_REACH = 40;
    const WOOD_FEED_BATCH = 3;
    const STONE_TARGET = 25;
    const METAL_TARGET = 15;
    let orbitAngle = 0;              // current orbit angle for circling

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

    function simulateKeyPress(key) {
        if (!key) return;
        // JustDown requires _justDown flag + isDown transition
        key.isDown = true;
        key.isUp = false;
        key._justDown = true;
        key._tick = performance.now();
        // Release next frame so JustDown resets
        setTimeout(() => {
            if (!key) return;
            key.isDown = false;
            key.isUp = true;
            key._justDown = false;
        }, 50);
    }

    function simulateAttack(sc) {
        if (!sc || !sc.cursors) return;
        simulateKeyPress(sc.cursors.attack);
    }

    function simulateInteract(sc) {
        if (!sc || !sc.cursors) return;
        simulateKeyPress(sc.cursors.interact);
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
        if (e.key === '`' || e.key === 'i' || e.key === 'I') { e.preventDefault(); toggleAI(); }
    });

    // ---- Helpers ----
    function getScene() { return window._gs; }
    function d(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

    // Patch walk grid to mark stones/metals as blocked (they have physics colliders
    // but the game's _walkGrid doesn't include them)
    let gridPatched = false;
    function patchWalkGrid(sc) {
        if (gridPatched || !sc._walkGrid) return;
        const T = CONFIG.TILE_SIZE;
        const gs = sc._gridSize;
        const grid = sc._walkGrid;
        const markBlocked = (group) => {
            for (const obj of group.children.entries) {
                if (!obj.active) continue;
                const tx = Math.floor(obj.x / T), ty = Math.floor(obj.y / T);
                if (tx >= 0 && tx < gs && ty >= 0 && ty < gs) {
                    grid[ty * gs + tx] = 0;
                }
            }
        };
        if (sc.stones) markBlocked(sc.stones);
        if (sc.metals) markBlocked(sc.metals);
        if (sc.rockWalls) markBlocked(sc.rockWalls);
        if (sc.metalMines) markBlocked(sc.metalMines);
        // Also mark buildings and bonfires
        for (const b of sc.bonfires) {
            const tx = Math.floor(b.x / T), ty = Math.floor(b.y / T);
            if (tx >= 0 && tx < gs && ty >= 0 && ty < gs) grid[ty * gs + tx] = 0;
        }
        gridPatched = true;
    }

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
            return true;
        }
        const wp = currentPath[pathIdx];
        const dx = wp.x - p.x, dy = wp.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < WAYPOINT_REACH) {
            pathIdx++;
            if (pathIdx >= currentPath.length) { return true; }
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
        if (len < 5) { orbitAround(p, tx, ty, 30); return true; }
        setMove(dx / len, dy / len);
        return false;
    }

    // Circle around a point using A* pathfinding — NEVER stop moving
    let orbitPath = null;
    let orbitPathIdx = 0;
    let orbitLastPos = { x: 0, y: 0 };
    let orbitStuckTicks = 0;
    function orbitAround(p, cx, cy, radius) {
        // Detect orbit-level stuck: if barely moved, skip to next angle
        const movedOrbit = Math.hypot(p.x - orbitLastPos.x, p.y - orbitLastPos.y);
        orbitLastPos.x = p.x; orbitLastPos.y = p.y;
        if (movedOrbit < 2) {
            orbitStuckTicks++;
            if (orbitStuckTicks > 2) {
                // Stuck — jump orbit angle and force repath
                orbitAngle += 1.2;  // skip ~70 degrees
                orbitPath = null;
                orbitStuckTicks = 0;
            }
        } else {
            orbitStuckTicks = 0;
        }

        // Need new orbit waypoint?
        if (!orbitPath || orbitPathIdx >= orbitPath.length) {
            orbitAngle += 0.4;
            const sc = getScene();
            if (!sc) return;
            // Try multiple angles to find a pathable orbit point
            for (let tries = 0; tries < 6; tries++) {
                const tx = cx + Math.cos(orbitAngle) * radius;
                const ty = cy + Math.sin(orbitAngle) * radius;
                const path = sc._findPath(p.x, p.y, tx, ty);
                if (path && path.length > 0) {
                    orbitPath = path;
                    orbitPathIdx = 0;
                    break;
                }
                orbitAngle += 0.5;  // try next angle
            }
            if (!orbitPath) return; // all angles blocked, wait for next tick
        }

        // Follow orbit path
        if (orbitPath && orbitPathIdx < orbitPath.length) {
            const wp = orbitPath[orbitPathIdx];
            const dx = wp.x - p.x, dy = wp.y - p.y;
            const len = Math.hypot(dx, dy);
            if (len < WAYPOINT_REACH) {
                orbitPathIdx++;
                if (orbitPathIdx >= orbitPath.length) { orbitPath = null; return; }
                const nwp = orbitPath[orbitPathIdx];
                const ndx = nwp.x - p.x, ndy = nwp.y - p.y;
                const nlen = Math.hypot(ndx, ndy) || 1;
                setMove(ndx / nlen, ndy / nlen);
            } else {
                setMove(dx / len, dy / len);
            }
        }
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

    // ---- Evasion system ----
    // Calculate a dodge vector away from nearby threats (enemies + projectiles)
    function getEvasionVector(sc, px, py) {
        let evX = 0, evY = 0;
        const ENEMY_AVOID_R = 55;  // only dodge very close enemies
        const PROJ_AVOID_R = 90;

        // Avoid nearby enemies (gentle push, not full flee)
        for (const e of sc.enemies.children.entries) {
            if (!e.active) continue;
            const ex = e.x, ey = e.y;
            const ed = d(ex, ey, px, py);
            if (ed < ENEMY_AVOID_R && ed > 1) {
                const strength = (ENEMY_AVOID_R - ed) / ENEMY_AVOID_R * 0.7;
                evX += (px - ex) / ed * strength;
                evY += (py - ey) / ed * strength;
            }
        }

        // Predict projectile trajectories and dodge if they will hit us
        if (sc.projectiles) {
            const PLAYER_R = 14;  // player hitbox radius
            for (const proj of sc.projectiles.children.entries) {
                if (!proj.active || !proj.body) continue;
                const prx = proj.x, pry = proj.y;
                const pvx = proj.body.velocity.x, pvy = proj.body.velocity.y;
                const pSpeed = Math.hypot(pvx, pvy);
                if (pSpeed < 10) continue;

                // Vector from projectile to player
                const tpx = px - prx, tpy = py - pry;
                const dot = tpx * pvx + tpy * pvy;
                if (dot < 0) continue; // moving away

                // Time until closest approach
                const tClosest = dot / (pSpeed * pSpeed);
                // Predicted closest point
                const cpx = prx + pvx * tClosest;
                const cpy = pry + pvy * tClosest;
                // Minimum distance the projectile will pass from us
                const minDist = d(cpx, cpy, px, py);

                // Will it hit us? (within player radius + margin)
                const dodgeMargin = 30;
                if (minDist > PLAYER_R + dodgeMargin) continue;

                // How long until it reaches closest point?
                const timeToImpact = tClosest;
                const distNow = d(prx, pry, px, py);
                if (distNow > PROJ_AVOID_R) continue;

                // Dodge perpendicular to projectile direction
                const pnx = -pvy / pSpeed, pny = pvx / pSpeed;
                // Choose dodge direction: toward bonfire
                const bonfire = sc.bonfires[0];
                const toBfX = bonfire.x - px, toBfY = bonfire.y - py;
                const dotBf = pnx * toBfX + pny * toBfY;
                const sign = dotBf >= 0 ? 1 : -1;
                // Urgency: stronger dodge when impact is imminent
                const urgency = timeToImpact < 0.5 ? 3.0 : timeToImpact < 1.0 ? 2.0 : 1.2;
                evX += pnx * sign * urgency;
                evY += pny * sign * urgency;
            }
        }

        const len = Math.hypot(evX, evY);
        if (len < 0.1) return null;
        return { x: evX / len, y: evY / len, urgency: len };
    }

    // Move toward target but blend in evasion when threats are nearby
    function moveWithEvasion(sc, p, tx, ty) {
        const dx = tx - p.x, dy = ty - p.y;
        const dlen = Math.hypot(dx, dy);
        if (dlen < 5) { orbitAround(p, tx, ty, 25); return true; }

        const evasion = getEvasionVector(sc, p.x, p.y);
        if (evasion && evasion.urgency > 0.5) {
            // Blend: more evasion when threats are closer, but keep moving to target
            const blend = Math.min(evasion.urgency * 0.8, 1.0);
            const mx = dx / dlen + evasion.x * blend;
            const my = dy / dlen + evasion.y * blend;
            const mlen = Math.hypot(mx, my) || 1;
            setMove(mx / mlen, my / mlen);
        } else {
            setMove(dx / dlen, dy / dlen);
        }
        return false;
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
        const safeR = Math.min(lightR * 0.6, 220);  // stay reasonably close to bonfire
        const fuelRatio = bonfire.getData('fuel') / bonfire.getData('maxFuel');
        const res = gameState.resources;
        const distToFire = d(px, py, bx, by);
        const hpRatio = gameState.hp / CONFIG.PLAYER_MAX_HP;

        // EMERGENCY: Outside light — flee immediately
        if (distToFire > lightR - 30) {
            return { type: 'flee', x: bx, y: by };
        }

        // LOW HP: Retreat to bonfire, avoid combat
        if (hpRatio < 0.4 && distToFire > 60) {
            return { type: 'flee', x: bx, y: by };
        }

        // DANGER: Any enemy too close — run to bonfire (preserve HP at all costs)
        let closestEnemyDist = Infinity;
        for (const e of sc.enemies.children.entries) {
            if (!e.active) continue;
            const ed = d(e.x, e.y, px, py);
            if (ed < closestEnemyDist) closestEnemyDist = ed;
            // Strong enemy close — flee immediately
            const eDmg = e.getData('damage') || 5;
            if (ed < 55 && eDmg >= 10) {
                return { type: 'flee', x: bx, y: by };
            }
        }
        // Multiple enemies converging — flee
        let nearEnemyCount = 0;
        for (const e of sc.enemies.children.entries) {
            if (e.active && d(e.x, e.y, px, py) < 80) nearEnemyCount++;
        }
        if (nearEnemyCount >= 2) {
            return { type: 'flee', x: bx, y: by };
        }

        // URGENT: Feed fire when fuel is low
        if (fuelRatio < 0.4 && res.wood >= 1) {
            return { type: 'feed', x: bx, y: by };
        }

        // Kill enemies — prefer weak ones, self-defense against others
        const earlyGame = gameState.fireLevel < 4;
        let bestEnemy = null, bestScore = -Infinity;
        for (const e of sc.enemies.children.entries) {
            if (!e.active) continue;
            const eDist = d(e.x, e.y, px, py);
            const ehp = e.getData('hp') || 20;
            const isRanged = !!e.getData('ranged');
            const selfDefense = eDist < 40;
            const isWeak = ehp <= 20;  // wisps — kill these fast
            // Early game: only fight self-defense or weak enemies nearby
            if (earlyGame && !selfDefense && !(isWeak && eDist < 60)) continue;
            // Late game: fight if HP is good
            if (!earlyGame && !selfDefense && hpRatio < 0.5) continue;
            // Don't chase outside safe zone
            if (d(e.x, e.y, bx, by) > safeR) continue;
            // Don't chase far
            if (eDist > 80 && !selfDefense) continue;
            // Avoid ranged enemies unless self-defense
            if (isRanged && !selfDefense && earlyGame) continue;
            // Score: prefer close, low-HP enemies
            const score = (selfDefense ? 500 : 0) + (isWeak ? 200 : 0) + (150 - eDist) - ehp;
            if (score > bestScore) { bestScore = score; bestEnemy = e; }
        }
        if (bestEnemy) {
            return { type: 'kill', target: bestEnemy, x: bestEnemy.x, y: bestEnemy.y };
        }

        // Feed bonfire — always dump wood immediately (faster fire level ups)
        const shouldFeed = res.wood >= 1;
        if (shouldFeed) {
            return { type: 'feed', x: bx, y: by };
        }

        // Build structures (only after fire is strong enough)
        if (gameState.fireLevel >= 3) {
            const buildOrder = ['TURRET', 'FORGE', 'ARMOR_WORKSHOP', 'OUTPOST', 'WEAPON_SHOP', 'FRIEND_HUT'];
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
        }

        // Collect nearby drops (only if reasonably safe)
        if (hpRatio > 0.35) {
            let bestDrop = null, bestDropDist = 100;
            if (sc.drops) {
                sc.drops.children.each(dd => {
                    if (!dd.active) return;
                    const ddist = d(dd.x, dd.y, px, py);
                    if (ddist < bestDropDist && d(dd.x, dd.y, bx, by) < safeR) {
                        bestDropDist = ddist;
                        bestDrop = dd;
                    }
                });
            }
            if (bestDrop) {
                return { type: 'pickup', target: bestDrop, x: bestDrop.x, y: bestDrop.y };
            }
        }

        // Gather resources (keep going even at moderate HP)
        if (hpRatio > 0.35) {
            const need = getResourceNeed();
            let group = need === 'wood' ? sc.trees : need === 'stone' ? sc.stones : sc.metals;
            let target = findNearest(group, px, py, bx, by, safeR);
            // Also check metal mines when needing metal
            if (need === 'metal' && sc.metalMines) {
                const mineTarget = findNearest(sc.metalMines, px, py, bx, by, safeR);
                if (mineTarget && (!target || d(px, py, mineTarget.x, mineTarget.y) < d(px, py, target.x, target.y))) {
                    target = mineTarget;
                }
            }
            if (target) {
                return { type: need === 'wood' ? 'chop' : 'mine', target, x: target.x, y: target.y };
            }
        }

        // Idle near bonfire (safe spot)
        return { type: 'idle', x: bx, y: by };
    }

    // ---- Main AI tick ----
    function aiTick() {
        const sc = getScene();
        if (!sc || !sc.player || !sc.player.active || gameState.gameOver) {
            stopMove();
            return;
        }

        patchWalkGrid(sc);

        const p = sc.player;
        const weapon = WEAPONS[gameState.weapon];
        const stuck = checkStuck(p, TICK_MS);

        const goal = selectGoal(sc, p);

        const goalChanged = !currentGoal || goal.type !== currentGoal.type ||
            (goal.target !== currentGoal.target && goal.type !== 'idle' && goal.type !== 'feed');
        if (goalChanged || stuck) {
            currentGoal = goal;
            currentPath = null;
            orbitPath = null;
            stuckTimer = 0;
            if (stuck) orbitAngle += 1.5;  // jump to new orbit angle when stuck
        }

        switch (currentGoal.type) {
            case 'flee': {
                // Flee using A* pathfinding to avoid getting stuck on obstacles
                if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                const arrived = followPath(p);
                if (arrived) orbitAround(p, currentGoal.x, currentGoal.y, 30);
                break;
            }

            case 'kill': {
                const enemy = currentGoal.target;
                if (!enemy || !enemy.active) { currentGoal = null; break; }
                const ed = d(p.x, p.y, enemy.x, enemy.y);
                const hitRange = ATTACK_REACH + (enemy.getData('size') || 16);
                if (ed < hitRange) {
                    faceTarget(p, enemy.x, enemy.y);
                    if (p.attackCooldown <= 0) {
                        simulateAttack(sc);
                        // Hit-and-run: back off after attacking
                        const bx = sc.bonfires[0].x, by = sc.bonfires[0].y;
                        const ax = p.x - enemy.x, ay = p.y - enemy.y;
                        const alen = Math.hypot(ax, ay) || 1;
                        // Bias retreat direction toward bonfire
                        const toBfX = bx - p.x, toBfY = by - p.y;
                        const toBfLen = Math.hypot(toBfX, toBfY) || 1;
                        setMove(
                            ax / alen * 0.6 + toBfX / toBfLen * 0.4,
                            ay / alen * 0.6 + toBfY / toBfLen * 0.4
                        );
                    } else {
                        // Kite: keep moving away while cooldown is active
                        const ax = p.x - enemy.x, ay = p.y - enemy.y;
                        const alen = Math.hypot(ax, ay) || 1;
                        setMove(ax / alen, ay / alen);
                    }
                } else {
                    moveToward(p, enemy.x, enemy.y);
                }
                break;
            }

            case 'feed': {
                const bd = d(p.x, p.y, currentGoal.x, currentGoal.y);
                if (bd < CONFIG.INTERACT_RADIUS) {
                    orbitAround(p, currentGoal.x, currentGoal.y, 25);
                    if (gameState.resources.wood > 0) {
                        simulateInteract(sc);
                    } else {
                        currentGoal = null;
                    }
                } else {
                    moveWithEvasion(sc, p, currentGoal.x, currentGoal.y);
                }
                break;
            }

            case 'build': {
                const spot = currentGoal.target;
                if (!spot || spot.built) { currentGoal = null; break; }
                const sd = d(p.x, p.y, spot.x, spot.y);
                if (sd < CONFIG.INTERACT_RADIUS) {
                    orbitAround(p, spot.x, spot.y, 20);
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
                if (!drop || !drop.active) { currentGoal = null; break; }
                moveWithEvasion(sc, p, drop.x, drop.y);
                break;
            }

            case 'chop':
            case 'mine': {
                const target = currentGoal.target;
                if (!target || !target.active) { currentGoal = null; break; }
                const td = d(p.x, p.y, target.x, target.y);
                if (td < weapon.range + 16) {
                    // Circle the target while attacking — never stand still
                    const evasion = getEvasionVector(sc, p.x, p.y);
                    if (evasion && evasion.urgency > 1.2) {
                        setMove(evasion.x, evasion.y);
                    } else {
                        orbitAround(p, target.x, target.y, weapon.range * 0.7);
                    }
                    faceTarget(p, target.x, target.y);
                    if (p.attackCooldown <= 0) simulateAttack(sc);
                } else {
                    moveWithEvasion(sc, p, target.x, target.y);
                }
                break;
            }

            case 'idle': {
                // Always patrol around bonfire — never stand still
                orbitAround(p, currentGoal.x, currentGoal.y, 50);
                break;
            }
        }
    }
})();
