// ============================================================
// BOT AI — Decision Tree autonomous player
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
    let moveDir = { x: 0, y: 0 };

    const TICK_MS = 200;
    const STUCK_THRESHOLD = 400;
    const WAYPOINT_REACH = 18;
    const ATTACK_REACH = 40;
    let orbitAngle = 0;

    // Decision tree evaluation trace (for debug HUD)
    let treeTrace = [];       // [{name, depth, status: 'active'|'checked'|'skipped'}]
    let activeNodeName = '';  // label of the currently active leaf

    // ---- Keyboard simulation ----
    function setMove(dx, dy) {
        const sc = getScene();
        if (!sc || !sc.cursors) return;
        const c = sc.cursors;
        c.left.isDown = dx < -0.3;
        c.right.isDown = dx > 0.3;
        c.up.isDown = dy < -0.3;
        c.down.isDown = dy > 0.3;
        moveDir.x = dx;
        moveDir.y = dy;
    }

    function stopMove() { setMove(0, 0); }

    function simulateKeyPress(key) {
        if (!key) return;
        key.isDown = true;
        key.isUp = false;
        key._justDown = true;
        key._tick = performance.now();
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
        removeDebugHUD();
        console.log('%c[BOT] AI stopped', 'color: #FF4444');
        return 'AI stopped';
    };

    window.toggleAI = function() { return aiInterval ? stopAI() : startAI(); };

    // Expose debug data for game.js overlay
    window._botDebug = {
        get paths() {
            return { currentPath, pathIdx, moveToPath, moveToPathIdx, orbitPath, orbitPathIdx, currentGoal };
        },
        get tree() { return treeTrace; },
        get activeNode() { return activeNodeName; },
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === 'i' || e.key === 'I') { e.preventDefault(); toggleAI(); }
    });

    // ---- Helpers ----
    function getScene() { return window._gs; }
    function d(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

    // Mark active destructibles as blocked in the walk grid.
    // The game's _walkGrid handles trees/forests and calls _setGridWalkable when
    // resources are destroyed. We layer stones/metals/buildings on top.
    // We save the original value before overwriting so we can restore correctly.
    let _botPatched = new Map();  // idx -> originalValue
    function patchWalkGrid(sc) {
        if (!sc._walkGrid) return;
        const T = CONFIG.TILE_SIZE;
        const gs = sc._gridSize;
        const grid = sc._walkGrid;

        // Restore tiles to their original values (before we touched them)
        for (const [idx, origVal] of _botPatched) {
            grid[idx] = origVal;
        }
        _botPatched = new Map();

        const mark = (obj) => {
            if (!obj.active) return;
            const tx = Math.floor(obj.x / T), ty = Math.floor(obj.y / T);
            if (tx >= 0 && tx < gs && ty >= 0 && ty < gs) {
                const idx = ty * gs + tx;
                if (grid[idx] === 0) return; // already blocked, don't overwrite
                if (!_botPatched.has(idx)) {
                    _botPatched.set(idx, grid[idx]); // save original value (1)
                }
                grid[idx] = 0;
            }
        };

        const markGroup = (group) => {
            for (const obj of group.children.entries) mark(obj);
        };

        if (sc.stones) markGroup(sc.stones);
        if (sc.metals) markGroup(sc.metals);
        if (sc.rockWalls) markGroup(sc.rockWalls);
        if (sc.metalMines) markGroup(sc.metalMines);
        for (const b of sc.bonfires) mark(b);
        if (sc.buildSpots) {
            for (const spot of sc.buildSpots) {
                if (spot.built && spot.building) mark(spot.building);
            }
        }
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

    let followPathLastPos = { x: 0, y: 0 };
    let followPathStuckTicks = 0;
    function followPath(p) {
        if (!currentPath || pathIdx >= currentPath.length) return true;
        const wp = currentPath[pathIdx];
        const dx = wp.x - p.x, dy = wp.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < WAYPOINT_REACH) {
            pathIdx++;
            followPathStuckTicks = 0;
            if (pathIdx >= currentPath.length) return true;
            const nwp = currentPath[pathIdx];
            const ndx = nwp.x - p.x, ndy = nwp.y - p.y;
            const nlen = Math.hypot(ndx, ndy);
            if (nlen > 1) setMove(ndx / nlen, ndy / nlen);
            return false;
        }

        // Detect stuck — if not making progress, repath via A*
        const movedDist = Math.hypot(p.x - followPathLastPos.x, p.y - followPathLastPos.y);
        followPathLastPos.x = p.x; followPathLastPos.y = p.y;
        if (movedDist < 2) {
            followPathStuckTicks++;
            if (followPathStuckTicks > 3) {
                // Repath to final destination
                followPathStuckTicks = 0;
                const dest = currentPath[currentPath.length - 1];
                const sc = getScene();
                if (sc) {
                    const newPath = sc._findPath(p.x, p.y, dest.x, dest.y);
                    if (newPath && newPath.length > 0) {
                        currentPath = newPath;
                        pathIdx = 0;
                    }
                }
            }
        } else {
            followPathStuckTicks = 0;
        }

        setMove(dx / len, dy / len);
        return false;
    }

    let moveToPath = null;
    let moveToPathIdx = 0;
    let moveToTarget = null;
    let moveToStuckTicks = 0;
    let moveToLastPos = { x: 0, y: 0 };
    function moveToward(p, tx, ty) {
        const dx = tx - p.x, dy = ty - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 5) { orbitAround(p, tx, ty, 30); return true; }

        // Detect stuck in moveToward specifically — force repath
        const movedDist = Math.hypot(p.x - moveToLastPos.x, p.y - moveToLastPos.y);
        moveToLastPos.x = p.x; moveToLastPos.y = p.y;
        if (movedDist < 2) {
            moveToStuckTicks++;
            if (moveToStuckTicks > 3) {
                moveToPath = null; // force repath
                moveToStuckTicks = 0;
            }
        } else {
            moveToStuckTicks = 0;
        }

        if (!moveToPath || !moveToTarget ||
            Math.abs(tx - moveToTarget.x) > 40 || Math.abs(ty - moveToTarget.y) > 40) {
            const sc = getScene();
            if (sc) {
                const path = sc._findPath(p.x, p.y, tx, ty);
                if (path && path.length > 0) {
                    moveToPath = path;
                    moveToPathIdx = 0;
                    moveToTarget = { x: tx, y: ty };
                } else {
                    setMove(dx / len, dy / len);
                    return false;
                }
            }
        }
        if (moveToPath && moveToPathIdx < moveToPath.length) {
            const wp = moveToPath[moveToPathIdx];
            const wdx = wp.x - p.x, wdy = wp.y - p.y;
            const wlen = Math.hypot(wdx, wdy);
            if (wlen < WAYPOINT_REACH) {
                moveToPathIdx++;
                if (moveToPathIdx >= moveToPath.length) { moveToPath = null; return true; }
                const nwp = moveToPath[moveToPathIdx];
                const ndx = nwp.x - p.x, ndy = nwp.y - p.y;
                const nlen = Math.hypot(ndx, ndy) || 1;
                setMove(ndx / nlen, ndy / nlen);
            } else {
                setMove(wdx / wlen, wdy / wlen);
            }
        } else {
            setMove(dx / len, dy / len);
        }
        return false;
    }

    let orbitPath = null;
    let orbitPathIdx = 0;
    let orbitLastPos = { x: 0, y: 0 };
    let orbitStuckTicks = 0;
    function orbitAround(p, cx, cy, radius) {
        const movedOrbit = Math.hypot(p.x - orbitLastPos.x, p.y - orbitLastPos.y);
        orbitLastPos.x = p.x; orbitLastPos.y = p.y;
        if (movedOrbit < 2) {
            orbitStuckTicks++;
            if (orbitStuckTicks > 2) {
                orbitAngle += 1.2;
                orbitPath = null;
                orbitStuckTicks = 0;
            }
        } else {
            orbitStuckTicks = 0;
        }
        if (!orbitPath || orbitPathIdx >= orbitPath.length) {
            orbitAngle += 0.4;
            const sc = getScene();
            if (!sc) return;
            for (let tries = 0; tries < 6; tries++) {
                const tx = cx + Math.cos(orbitAngle) * radius;
                const ty = cy + Math.sin(orbitAngle) * radius;
                const path = sc._findPath(p.x, p.y, tx, ty);
                if (path && path.length > 0) {
                    orbitPath = path;
                    orbitPathIdx = 0;
                    break;
                }
                orbitAngle += 0.5;
            }
            if (!orbitPath) return;
        }
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

    function findNearest(group, px, py, bx, by, maxR) {
        let best = null, bestDist = Infinity;
        for (const obj of group.children.entries) {
            if (!obj.active) continue;
            if (d(obj.x, obj.y, bx, by) > maxR) continue;
            const dd = d(obj.x, obj.y, px, py);
            if (dd < bestDist) { bestDist = dd; best = obj; }
        }
        return best;
    }

    // Find nearest destructible resource between player and target (to clear a path)
    function findBlockingResource(sc, px, py, tx, ty) {
        const dx = tx - px, dy = ty - py;
        const len = Math.hypot(dx, dy);
        if (len < 10) return null;
        const nx = dx / len, ny = dy / len;

        let best = null, bestDist = Infinity;
        const checkGroups = [sc.trees, sc.stones, sc.metals];
        if (sc.metalMines) checkGroups.push(sc.metalMines);

        for (const group of checkGroups) {
            for (const obj of group.children.entries) {
                if (!obj.active) continue;
                const od = d(obj.x, obj.y, px, py);
                if (od > 80 || od < 10) continue; // within reach, not behind us
                // Check if object is roughly in the direction of the target
                const toObjX = obj.x - px, toObjY = obj.y - py;
                const dot = (toObjX * nx + toObjY * ny) / od;
                if (dot < 0.4) continue; // not in our way
                if (od < bestDist) { bestDist = od; best = obj; }
            }
        }
        return best;
    }

    // ---- Evasion system ----
    function getEvasionVector(sc, px, py) {
        let evX = 0, evY = 0;
        const ENEMY_AVOID_R = 55;
        const PROJ_AVOID_R = 90;

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

        if (sc.projectiles) {
            const PLAYER_R = 14;
            for (const proj of sc.projectiles.children.entries) {
                if (!proj.active || !proj.body) continue;
                const prx = proj.x, pry = proj.y;
                const pvx = proj.body.velocity.x, pvy = proj.body.velocity.y;
                const pSpeed = Math.hypot(pvx, pvy);
                if (pSpeed < 10) continue;
                const tpx = px - prx, tpy = py - pry;
                const dot = tpx * pvx + tpy * pvy;
                if (dot < 0) continue;
                const tClosest = dot / (pSpeed * pSpeed);
                const cpx = prx + pvx * tClosest;
                const cpy = pry + pvy * tClosest;
                const minDist = d(cpx, cpy, px, py);
                if (minDist > PLAYER_R + 30) continue;
                const distNow = d(prx, pry, px, py);
                if (distNow > PROJ_AVOID_R) continue;
                const pnx = -pvy / pSpeed, pny = pvx / pSpeed;
                const bonfire = sc.bonfires[0];
                const toBfX = bonfire.x - px, toBfY = bonfire.y - py;
                const dotBf = pnx * toBfX + pny * toBfY;
                const sign = dotBf >= 0 ? 1 : -1;
                const urgency = tClosest < 0.5 ? 3.0 : tClosest < 1.0 ? 2.0 : 1.2;
                evX += pnx * sign * urgency;
                evY += pny * sign * urgency;
            }
        }

        const len = Math.hypot(evX, evY);
        if (len < 0.1) return null;
        return { x: evX / len, y: evY / len, urgency: len };
    }

    function moveWithEvasion(sc, p, tx, ty) {
        const dx = tx - p.x, dy = ty - p.y;
        const dlen = Math.hypot(dx, dy);
        if (dlen < 5) { orbitAround(p, tx, ty, 25); return true; }
        const evasion = getEvasionVector(sc, p.x, p.y);
        if (evasion && evasion.urgency > 1.2) {
            setMove(evasion.x, evasion.y);
        } else {
            moveToward(p, tx, ty);
            if (evasion && evasion.urgency > 0.5) {
                const blend = Math.min(evasion.urgency * 0.4, 0.6);
                const mx = moveDir.x + evasion.x * blend;
                const my = moveDir.y + evasion.y * blend;
                const mlen = Math.hypot(mx, my) || 1;
                setMove(mx / mlen, my / mlen);
            }
        }
        return false;
    }

    // ============================================================
    // DECISION TREE — Data-driven priority selector
    // Each node: { name, check(ctx), children[] | goal(ctx) }
    // Evaluated top-to-bottom; first passing leaf wins.
    // ============================================================

    // Context object built once per tick — lazy-caches expensive lookups
    function buildContext(sc, p) {
        const bonfire = sc.bonfires[0];
        const bx = bonfire.x, by = bonfire.y;
        const lightR = sc.getLightRadius(bonfire) * 0.85;
        const px = p.x, py = p.y;
        const ctx = {
            sc, p, bonfire, bx, by, lightR,
            px, py,
            safeR: lightR * 0.85,
            fuelRatio: bonfire.getData('fuel') / bonfire.getData('maxFuel'),
            res: gameState.resources,
            distToFire: d(px, py, bx, by),
            hpRatio: gameState.hp / CONFIG.PLAYER_MAX_HP,
            earlyGame: gameState.fireLevel < 4,
            fireLevel: gameState.fireLevel,
            mainLevel: bonfire.getData('campFireLevel') || 1,
            secondCamp: sc._secondCampBonfire || null,
            lairBonfire: sc._lairBonfire || null,
            monsterLair: sc._monsterLair || null,
            // Lazy-cached values
            _evasion: undefined,
            _nearEnemies: undefined,
            _bestEnemy: undefined,
            _bestDrop: undefined,
            _buildTarget: undefined,
            _resourceTarget: undefined,
        };

        // Lazy getters
        Object.defineProperty(ctx, 'evasion', { get() {
            if (this._evasion === undefined) this._evasion = getEvasionVector(sc, px, py);
            return this._evasion;
        }});

        Object.defineProperty(ctx, 'nearEnemies', { get() {
            if (this._nearEnemies === undefined) {
                let closest = Infinity, count = 0, strongClose = false;
                for (const e of sc.enemies.children.entries) {
                    if (!e.active) continue;
                    const ed = d(e.x, e.y, px, py);
                    if (ed < closest) closest = ed;
                    if (ed < 80) count++;
                    if (ed < 55 && (e.getData('damage') || 5) >= 10) strongClose = true;
                }
                this._nearEnemies = { closest, count, strongClose };
            }
            return this._nearEnemies;
        }});

        Object.defineProperty(ctx, 'bestEnemy', { get() {
            if (this._bestEnemy === undefined) {
                let best = null, bestScore = -Infinity;
                const huntR = ctx.lightR * 0.8; // hunt within light radius
                for (const e of sc.enemies.children.entries) {
                    if (!e.active) continue;
                    const eDist = d(e.x, e.y, px, py);
                    const ehp = e.getData('hp') || 20;
                    const selfDefense = eDist < 50;
                    // Skip if too far or enemy is outside light
                    if (eDist > huntR) continue;
                    if (d(e.x, e.y, bx, by) > ctx.lightR) continue;
                    // Low HP — only fight in self-defense
                    if (ctx.hpRatio < 0.4 && !selfDefense) continue;
                    const score = (selfDefense ? 500 : 0) + (300 - eDist) - ehp * 0.5;
                    if (score > bestScore) { bestScore = score; best = e; }
                }
                this._bestEnemy = best;
            }
            return this._bestEnemy;
        }});

        Object.defineProperty(ctx, 'bestDrop', { get() {
            if (this._bestDrop === undefined) {
                let best = null, bestDist = 200;
                if (sc.drops) {
                    sc.drops.children.each(dd => {
                        if (!dd.active) return;
                        const ddist = d(dd.x, dd.y, px, py);
                        if (ddist < bestDist && d(dd.x, dd.y, bx, by) < ctx.safeR) {
                            bestDist = ddist;
                            best = dd;
                        }
                    });
                }
                this._bestDrop = best;
            }
            return this._bestDrop;
        }});

        Object.defineProperty(ctx, 'buildTarget', { get() {
            if (this._buildTarget === undefined) {
                let target = null;
                const buildOrder = ['TURRET', 'FORGE', 'ARMOR_WORKSHOP', 'OUTPOST', 'WEAPON_SHOP', 'FRIEND_HUT'];
                for (const bType of buildOrder) {
                    for (const spot of sc.buildSpots) {
                        if (spot.built || !spot.unlocked) continue;
                        if (spot.config.type !== bType) continue;
                        const building = BUILDINGS[bType];
                        if (building && canAfford(building.cost)) {
                            target = spot;
                            break;
                        }
                    }
                    if (target) break;
                }
                this._buildTarget = target;
            }
            return this._buildTarget;
        }});

        Object.defineProperty(ctx, 'resourceTarget', { get() {
            if (this._resourceTarget === undefined) {
                const rn = getResourceNeed(ctx);
                const need = rn.need;
                let group = need === 'wood' ? sc.trees : need === 'stone' ? sc.stones : sc.metals;
                let target = findNearest(group, px, py, bx, by, ctx.safeR);
                if (need === 'metal' && sc.metalMines) {
                    const mine = findNearest(sc.metalMines, px, py, bx, by, ctx.safeR);
                    if (mine && (!target || d(px, py, mine.x, mine.y) < d(px, py, target.x, target.y))) {
                        target = mine;
                    }
                }
                this._resourceTarget = { need, target, reason: rn.reason, forGoal: rn.forGoal };
            }
            return this._resourceTarget;
        }});

        return ctx;
    }

    // ---- Strategic Goal Planner ----
    // Determines the current strategic phase and what sub-goal to work toward
    function getStrategicPhase(ctx) {
        const sc2 = ctx.secondCamp;
        const sc2Level = sc2 ? (sc2.getData('campFireLevel') || 1) : 0;
        const lair = ctx.monsterLair;

        // Phase 4: Lair destroyed — victory idle
        if (!lair || !lair.getData('active')) {
            if (ctx.mainLevel >= 6) return 'VICTORY';
        }
        // Phase 3: Both camps maxed → attack lair
        if (ctx.mainLevel >= 6 && sc2 && sc2.active && sc2Level >= 6 && lair && lair.getData('active')) {
            return 'ATTACK_LAIR';
        }
        // Phase 2: Main camp maxed → develop second camp
        if (ctx.mainLevel >= 6 && sc2 && sc2.active) {
            return 'MAX_SECOND_CAMP';
        }
        // Phase 1: Develop main base
        return 'DEVELOP_BASE';
    }

    // Returns { need: 'wood'|'stone'|'metal', reason: 'description', forGoal: 'parent goal' }
    function getResourceNeed(ctx) {
        const res = ctx ? ctx.res : gameState.resources;
        const sc = ctx ? ctx.sc : getScene();
        const phase = ctx ? getStrategicPhase(ctx) : 'DEVELOP_BASE';

        // Fire needs fuel (wood) — check if current active bonfire needs it
        if (phase === 'DEVELOP_BASE' && ctx && ctx.mainLevel < 6) {
            // Need wood to level up the main bonfire
            const levels = CONFIG.FIRE_LEVELS;
            const curFuel = ctx.bonfire.getData('campFuelAdded') || 0;
            const nextLevel = levels[ctx.mainLevel] || levels[levels.length - 1];
            const fuelNeeded = nextLevel - curFuel;
            const woodForFuel = Math.ceil(fuelNeeded / CONFIG.FUEL_PER_WOOD);
            if (res.wood < Math.min(woodForFuel, 5)) {
                return { need: 'wood', reason: `Wood for fire Lv.${ctx.mainLevel + 1}`, forGoal: 'Level Up Fire' };
            }
        }

        // Check what's needed for the next buildable structure
        if (sc) {
            const buildOrder = ['TURRET', 'FORGE', 'ARMOR_WORKSHOP', 'OUTPOST', 'WEAPON_SHOP', 'FRIEND_HUT'];
            for (const bType of buildOrder) {
                for (const spot of sc.buildSpots) {
                    if (spot.built || !spot.unlocked) continue;
                    if (spot.config.type !== bType) continue;
                    const building = BUILDINGS[bType];
                    if (!building) continue;
                    // Find first missing resource for this building
                    for (const [r, amt] of Object.entries(building.cost)) {
                        if ((res[r] || 0) < amt) {
                            return { need: r, reason: `${r} for ${building.name}`, forGoal: `Build ${building.name}` };
                        }
                    }
                }
            }
        }

        // Second camp phase: need wood for fuel
        if (phase === 'MAX_SECOND_CAMP') {
            return { need: 'wood', reason: 'Wood for 2nd camp fuel', forGoal: 'Max Second Camp' };
        }

        // Default: gather wood (for fire fuel)
        return { need: 'wood', reason: 'Wood for fire fuel', forGoal: 'Feed Fire' };
    }

    // ---- The Decision Tree ----
    // Goal-oriented: everything cascades from "Destroy Lair" root goal
    // SURVIVAL and COMBAT are reactive interrupts; PROGRESS is the main driver
    const DECISION_TREE = {
        name: '\u2694 DESTROY LAIR',
        check: () => true,
        children: [
            // === SURVIVAL (reactive — highest priority interrupt) ===
            {
                name: '\u26a0 SURVIVE',
                check: () => true,
                children: [
                    {
                        name: 'Outside Light',
                        check: (ctx) => ctx.distToFire > ctx.lightR - 30,
                        goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by }),
                    },
                    {
                        name: 'Low HP Retreat',
                        check: (ctx) => ctx.hpRatio < 0.4 && ctx.distToFire > 60,
                        goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by }),
                    },
                    {
                        name: 'Dodge Projectile',
                        check: (ctx) => ctx.evasion && ctx.evasion.urgency > 1.0,
                        goal: (ctx) => ({ type: 'dodge', evasion: ctx.evasion }),
                    },
                    {
                        name: 'Strong Enemy Close',
                        check: (ctx) => ctx.nearEnemies.strongClose,
                        goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by }),
                    },
                    {
                        name: 'Surrounded',
                        check: (ctx) => ctx.nearEnemies.count >= 2,
                        goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by }),
                    },
                ],
            },
            // === FIRE EMERGENCY (reactive) ===
            {
                name: '\ud83d\udd25 FIRE DYING',
                check: (ctx) => ctx.fuelRatio < 0.35,
                children: [
                    {
                        name: 'Feed Fire (critical)',
                        check: (ctx) => ctx.res.wood >= 1,
                        goal: (ctx) => ({ type: 'feed', x: ctx.bx, y: ctx.by }),
                    },
                    {
                        name: 'Chop for Fire (urgent)',
                        check: (ctx) => {
                            if (ctx.hpRatio < 0.35) return false;
                            const rt = ctx.resourceTarget;
                            return rt.target !== null;
                        },
                        goal: (ctx) => {
                            const t = ctx.resourceTarget.target;
                            return { type: 'chop', target: t, x: t.x, y: t.y };
                        },
                    },
                ],
            },
            // === COMBAT (reactive — kill enemies in light radius) ===
            {
                name: '\u2694 COMBAT',
                check: (ctx) => ctx.bestEnemy !== null,
                children: [
                    {
                        name: 'Kill Enemy',
                        check: () => true,
                        goal: (ctx) => {
                            const e = ctx.bestEnemy;
                            return { type: 'kill', target: e, x: e.x, y: e.y };
                        },
                    },
                ],
            },
            // === COLLECT NEARBY DROPS (opportunistic) ===
            {
                name: 'Collect Drops',
                check: (ctx) => ctx.hpRatio > 0.35 && ctx.bestDrop !== null,
                goal: (ctx) => {
                    const dr = ctx.bestDrop;
                    return { type: 'pickup', target: dr, x: dr.x, y: dr.y };
                },
            },
            // === PROGRESS — goal-oriented main driver ===
            {
                name: '\u2b50 PROGRESS',
                check: () => true,
                children: [
                    // --- Phase 1: Develop Main Base ---
                    {
                        name: 'Develop Base',
                        check: (ctx) => getStrategicPhase(ctx) === 'DEVELOP_BASE',
                        children: [
                            {
                                name: 'Level Up Fire',
                                check: (ctx) => ctx.mainLevel < 6,
                                children: [
                                    {
                                        name: 'Feed Fire',
                                        check: (ctx) => ctx.res.wood >= 1,
                                        goal: (ctx) => ({ type: 'feed', x: ctx.bx, y: ctx.by }),
                                    },
                                    {
                                        name: 'Chop Wood for Fire',
                                        check: (ctx) => {
                                            const rt = ctx.resourceTarget;
                                            return rt.target !== null;
                                        },
                                        goal: (ctx) => {
                                            // Force wood gathering for fire
                                            const sc = ctx.sc;
                                            const t = findNearest(sc.trees, ctx.px, ctx.py, ctx.bx, ctx.by, ctx.safeR);
                                            if (t) return { type: 'chop', target: t, x: t.x, y: t.y };
                                            const rt = ctx.resourceTarget;
                                            return { type: 'chop', target: rt.target, x: rt.target.x, y: rt.target.y };
                                        },
                                    },
                                ],
                            },
                            {
                                name: 'Build Defenses',
                                check: (ctx) => ctx.fireLevel >= 2,
                                children: [
                                    {
                                        name: 'Build Structure',
                                        check: (ctx) => ctx.buildTarget !== null,
                                        goal: (ctx) => {
                                            const s = ctx.buildTarget;
                                            return { type: 'build', target: s, x: s.x, y: s.y };
                                        },
                                    },
                                    {
                                        name: 'Gather for Building',
                                        check: (ctx) => {
                                            const rn = getResourceNeed(ctx);
                                            if (!rn.forGoal || !rn.forGoal.startsWith('Build')) return false;
                                            const rt = ctx.resourceTarget;
                                            return rt.target !== null;
                                        },
                                        goal: (ctx) => {
                                            const rt = ctx.resourceTarget;
                                            return { type: rt.need === 'wood' ? 'chop' : 'mine', target: rt.target, x: rt.target.x, y: rt.target.y };
                                        },
                                    },
                                ],
                            },
                            {
                                name: 'Stockpile Resources',
                                check: (ctx) => ctx.hpRatio > 0.35 && ctx.resourceTarget.target !== null,
                                goal: (ctx) => {
                                    const rt = ctx.resourceTarget;
                                    return { type: rt.need === 'wood' ? 'chop' : 'mine', target: rt.target, x: rt.target.x, y: rt.target.y };
                                },
                            },
                        ],
                    },
                    // --- Phase 2: Max Second Camp ---
                    {
                        name: 'Max Second Camp',
                        check: (ctx) => getStrategicPhase(ctx) === 'MAX_SECOND_CAMP',
                        children: [
                            {
                                name: 'Travel to Camp',
                                check: (ctx) => {
                                    const sc2 = ctx.secondCamp;
                                    return sc2 && sc2.active;
                                },
                                children: [
                                    {
                                        name: 'Feed Second Camp',
                                        check: (ctx) => {
                                            const sc2 = ctx.secondCamp;
                                            const cd = d(ctx.px, ctx.py, sc2.x, sc2.y);
                                            return cd < CONFIG.INTERACT_RADIUS + 20 && ctx.res.wood >= 1;
                                        },
                                        goal: (ctx) => {
                                            const sc2 = ctx.secondCamp;
                                            return { type: 'seek_camp', target: sc2, x: sc2.x, y: sc2.y };
                                        },
                                    },
                                    {
                                        name: 'Gather Wood for Camp',
                                        check: (ctx) => ctx.res.wood < 3 && ctx.hpRatio > 0.35,
                                        goal: (ctx) => {
                                            const sc = ctx.sc;
                                            const t = findNearest(sc.trees, ctx.px, ctx.py, ctx.bx, ctx.by, ctx.safeR);
                                            if (t) return { type: 'chop', target: t, x: t.x, y: t.y };
                                            const rt = ctx.resourceTarget;
                                            if (rt.target) return { type: 'chop', target: rt.target, x: rt.target.x, y: rt.target.y };
                                            return { type: 'idle', x: ctx.bx, y: ctx.by };
                                        },
                                    },
                                    {
                                        name: 'Walk to Second Camp',
                                        check: (ctx) => ctx.res.wood >= 3,
                                        goal: (ctx) => {
                                            const sc2 = ctx.secondCamp;
                                            return { type: 'seek_camp', target: sc2, x: sc2.x, y: sc2.y };
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    // --- Phase 3: Attack Lair ---
                    {
                        name: 'Attack Lair',
                        check: (ctx) => getStrategicPhase(ctx) === 'ATTACK_LAIR',
                        goal: (ctx) => {
                            const lair = ctx.monsterLair;
                            return { type: 'attack_lair', target: lair, x: lair.x, y: lair.y };
                        },
                    },
                    // --- Victory ---
                    {
                        name: '\ud83c\udfc6 Victory!',
                        check: (ctx) => getStrategicPhase(ctx) === 'VICTORY',
                        goal: (ctx) => ({ type: 'idle', x: ctx.bx, y: ctx.by }),
                    },
                ],
            },
            // === IDLE (absolute fallback) ===
            {
                name: 'Patrol',
                check: () => true,
                goal: (ctx) => ({ type: 'idle', x: ctx.bx, y: ctx.by }),
            },
        ],
    };

    // ---- Tree evaluator ----
    // Returns goal object with _treePath, builds treeTrace for debug HUD
    function evaluateTree(node, ctx, depth, trace) {
        const passed = node.check(ctx);
        if (!passed) {
            trace.push({ name: node.name, depth, status: 'failed' });
            return null;
        }

        // Leaf node — return goal
        if (node.goal) {
            const g = node.goal(ctx);
            g._treePath = node.name;
            trace.push({ name: node.name, depth, status: 'active' });
            return g;
        }

        // Branch node — try children in priority order
        if (node.children) {
            trace.push({ name: node.name, depth, status: 'checking' });
            for (const child of node.children) {
                const result = evaluateTree(child, ctx, depth + 1, trace);
                if (result) {
                    // Mark this branch as active in trace
                    const branchIdx = trace.length - 1;
                    for (let i = branchIdx; i >= 0; i--) {
                        if (trace[i].depth === depth && trace[i].name === node.name) {
                            trace[i].status = 'active';
                            break;
                        }
                    }
                    result._treePath = node.name + ' > ' + result._treePath;
                    return result;
                }
            }
            // All children failed — mark branch as failed
            const branchIdx = trace.findIndex(t => t.depth === depth && t.name === node.name);
            if (branchIdx >= 0) trace[branchIdx].status = 'failed';
        }
        return null;
    }

    let _lastStrategicPhase = '';
    let _lastResourceNeed = null;

    function selectGoal(sc, p) {
        const ctx = buildContext(sc, p);
        _lastStrategicPhase = getStrategicPhase(ctx);
        _lastResourceNeed = getResourceNeed(ctx);
        const trace = [];
        const goal = evaluateTree(DECISION_TREE, ctx, 0, trace);
        treeTrace = trace;
        activeNodeName = goal ? goal._treePath : 'NONE';
        return goal || { type: 'idle', x: ctx.bx, y: ctx.by, _treePath: 'FALLBACK' };
    }

    // ============================================================
    // DEBUG HUD — HTML overlay showing decision tree state
    // ============================================================

    let debugHudEl = null;

    function renderDebugHUD() {
        if (!window._debugMode) {
            if (debugHudEl) { debugHudEl.style.display = 'none'; }
            return;
        }

        if (!debugHudEl) {
            debugHudEl = document.createElement('div');
            debugHudEl.id = 'bot-tree-debug';
            debugHudEl.style.cssText = `
                position: absolute; top: 8px; left: 8px; z-index: 10000;
                background: rgba(0,0,0,0.85); color: #ccc;
                font-family: monospace; font-size: 11px; line-height: 1.5;
                padding: 8px 12px; border-radius: 6px;
                pointer-events: none; max-width: 320px;
                border: 1px solid rgba(100,255,100,0.2);
            `;
            // Append to game-container so it works in fullscreen mode
            const container = document.getElementById('game-container') || document.body;
            container.appendChild(debugHudEl);
        }

        debugHudEl.style.display = 'block';

        // Build tree display
        const phaseLabels = {
            'DEVELOP_BASE': '\ud83c\udfd7 Develop Base',
            'MAX_SECOND_CAMP': '\u26fa Max Second Camp',
            'ATTACK_LAIR': '\u2694 Attack Lair',
            'VICTORY': '\ud83c\udfc6 Victory!',
        };
        let html = '<div style="color:#44ff44;font-weight:bold;margin-bottom:4px">BOT AI</div>';
        html += `<div style="color:#ffcc00;margin-bottom:2px">Phase: ${phaseLabels[_lastStrategicPhase] || _lastStrategicPhase}</div>`;
        if (_lastResourceNeed) {
            html += `<div style="color:#88aaff;margin-bottom:4px">Need: ${_lastResourceNeed.reason}</div>`;
        }

        const statusColors = {
            active: '#44ff44',
            checking: '#888',
            failed: '#666',
        };
        const statusIcons = {
            active: '\u25b6',  // ▶
            checking: '\u25cb', // ○
            failed: '\u00d7',   // ×
        };

        for (const entry of treeTrace) {
            const indent = '\u00a0\u00a0'.repeat(entry.depth);
            const color = statusColors[entry.status] || '#666';
            const icon = statusIcons[entry.status] || '\u00b7';
            const bold = entry.status === 'active' ? 'font-weight:bold;' : '';
            html += `<div style="color:${color};${bold}">${indent}${icon} ${entry.name}</div>`;
        }

        // Show current goal type
        if (currentGoal) {
            html += `<div style="color:#ffaa00;margin-top:4px;border-top:1px solid #333;padding-top:4px">`;
            html += `Goal: ${currentGoal.type}`;
            if (currentGoal.target && currentGoal.target.getData) {
                const name = currentGoal.target.getData('name') || currentGoal.target.getData('type') || '';
                if (name) html += ` (${name})`;
            }
            html += `</div>`;
        }

        debugHudEl.innerHTML = html;
    }

    function removeDebugHUD() {
        if (debugHudEl) {
            debugHudEl.remove();
            debugHudEl = null;
        }
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
            moveToPath = null;
            stuckTimer = 0;
            if (stuck) {
                orbitAngle += 1.5;
                // If stuck while moving to a target, try clearing the path
                if (goal.x !== undefined && goal.y !== undefined) {
                    const blocker = findBlockingResource(sc, p.x, p.y, goal.x, goal.y);
                    if (blocker) {
                        currentGoal = { type: 'clear_path', target: blocker, x: blocker.x, y: blocker.y, _treePath: 'Clear Path' };
                    }
                }
            }
        }

        switch (currentGoal.type) {
            case 'flee': {
                if (!currentPath) pathTo(sc, currentGoal.x, currentGoal.y);
                const arrived = followPath(p);
                if (arrived) orbitAround(p, currentGoal.x, currentGoal.y, 30);
                break;
            }

            case 'dodge': {
                const ev = currentGoal.evasion;
                if (ev) {
                    setMove(ev.x, ev.y);
                } else {
                    // Evasion expired, will re-evaluate next tick
                    stopMove();
                }
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
                        const bx = sc.bonfires[0].x, by = sc.bonfires[0].y;
                        const ax = p.x - enemy.x, ay = p.y - enemy.y;
                        const alen = Math.hypot(ax, ay) || 1;
                        const toBfX = bx - p.x, toBfY = by - p.y;
                        const toBfLen = Math.hypot(toBfX, toBfY) || 1;
                        setMove(
                            ax / alen * 0.6 + toBfX / toBfLen * 0.4,
                            ay / alen * 0.6 + toBfY / toBfLen * 0.4
                        );
                    } else {
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

            case 'clear_path':
            case 'chop':
            case 'mine': {
                const target = currentGoal.target;
                if (!target || !target.active) { currentGoal = null; break; }
                const td = d(p.x, p.y, target.x, target.y);
                if (td < weapon.range + 16) {
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

            case 'seek_camp': {
                const camp = currentGoal.target;
                if (!camp || !camp.active) { currentGoal = null; break; }
                const cd = d(p.x, p.y, camp.x, camp.y);
                if (cd < CONFIG.INTERACT_RADIUS) {
                    // At the camp — feed it if we have wood
                    if (gameState.resources.wood >= 1) {
                        simulateInteract(sc);
                    }
                    orbitAround(p, camp.x, camp.y, 30);
                } else {
                    if (!currentPath) pathTo(sc, camp.x, camp.y);
                    followPath(p);
                }
                break;
            }

            case 'attack_lair': {
                const lair = currentGoal.target;
                if (!lair || !lair.getData('active')) { currentGoal = null; break; }
                const ld = d(p.x, p.y, lair.x, lair.y);
                if (ld < weapon.range + 32) {
                    faceTarget(p, lair.x, lair.y);
                    orbitAround(p, lair.x, lair.y, weapon.range * 0.7);
                    if (p.attackCooldown <= 0) simulateAttack(sc);
                } else {
                    if (!currentPath) pathTo(sc, lair.x, lair.y);
                    followPath(p);
                }
                break;
            }

            case 'idle': {
                orbitAround(p, currentGoal.x, currentGoal.y, 50);
                break;
            }
        }

        // Update debug HUD
        renderDebugHUD();
    }
})();
