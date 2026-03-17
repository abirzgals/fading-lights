// ============================================================
// SHARED UTILITIES — Reusable across all game scenes
// ============================================================

// --------------------------------------------------------
// Floating damage/heal text
// --------------------------------------------------------
function showFloatingText(scene, x, y, msg, color) {
    const t = scene.add.text(x, y, msg, {
        fontSize: '9px', fill: color, fontFamily: 'monospace',
        stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(5100);
    scene.tweens.add({
        targets: t, y: y - 22, alpha: 0, duration: 650,
        onComplete: () => t.destroy(),
    });
}

// --------------------------------------------------------
// Player direction & animation update
// --------------------------------------------------------
function updatePlayerDirection(scene, player) {
    const cp = scene._charPrefix;
    if (!cp || !scene.textures.exists(cp + '_south')) {
        if (player.facing.x !== 0) player.setFlipX(player.facing.x < 0);
        return;
    }
    const dir = facingToDirection(player.facing.x, player.facing.y);
    const curKey = player.anims.currentAnim?.key || '';
    // Don't interrupt attack animations
    if ((curKey.startsWith('player_melee_') || curKey.startsWith('player_ranged_')) && player.anims.isPlaying) {
        player._lastDir = dir;
        player.setFlipX(false);
        return;
    }
    const isMoving = player.body && (player.body.velocity.x !== 0 || player.body.velocity.y !== 0);
    const walkKey = 'player_walk_' + dir;
    if (isMoving && scene.anims.exists(walkKey)) {
        if (curKey !== walkKey) player.play(walkKey);
    } else {
        if (player.anims.isPlaying) player.anims.stop();
        if (dir !== player._lastDir) player.setTexture(cp + '_' + dir);
    }
    player._lastDir = dir;
    player.setFlipX(false);
}

// --------------------------------------------------------
// Play attack animation on player
// --------------------------------------------------------
function playAttackAnimation(scene, player, weapon) {
    const cp = scene._charPrefix;
    if (!cp || !scene.textures.exists(cp + '_south')) return;
    const dir = facingToDirection(player.facing.x, player.facing.y);
    const attackType = weapon.attackType || 'swing';
    const atkAnimKey = attackType === 'shoot'
        ? 'player_ranged_' + dir
        : 'player_melee_' + dir;
    if (scene.anims.exists(atkAnimKey)) {
        player.play(atkAnimKey);
        player.once('animationcomplete', () => {
            player.setTexture(cp + '_' + dir);
            player._lastDir = dir;
        });
    }
}

// --------------------------------------------------------
// Shadow casting system
// --------------------------------------------------------
function drawDirectionalShadow(g, baseX, baseY, objW, objH, lightX, lightY, lightRadius) {
    const dx = baseX - lightX, dy = baseY - lightY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2 || dist > lightRadius) return;

    const angle = Math.atan2(dy, dx);
    const shadowLen = Math.min(objH * 1.2, objH * 400 / dist);
    const cx = baseX + Math.cos(angle) * shadowLen * 0.5;
    const cy = baseY + Math.sin(angle) * shadowLen * 0.5;
    const edgeFade = 1 - (dist / lightRadius);
    const alpha = Math.max(0.04, 0.3 * edgeFade);

    const halfW = objW * 0.3;
    const halfH = shadowLen * 0.5;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const pts = [];
    for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2;
        const ex = Math.cos(t) * halfW, ey = Math.sin(t) * halfH;
        pts.push(cx + ex * -sin + ey * cos, cy + ex * cos + ey * sin);
    }
    g.fillStyle(0x000000, alpha);
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fillPath();
}

// --------------------------------------------------------
// Fog of War system
// --------------------------------------------------------
function initFogOfWar(scene, textureKey, depth) {
    const fog = {
        canvas: document.createElement('canvas'),
        timer: 0,
    };
    fog.canvas.width = scene.scale.width;
    fog.canvas.height = scene.scale.height;
    fog.ctx = fog.canvas.getContext('2d');
    if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
    fog.texture = scene.textures.createCanvas(textureKey, scene.scale.width, scene.scale.height);
    fog.image = scene.add.image(0, 0, textureKey).setDepth(depth).setScrollFactor(0).setOrigin(0, 0);
    fog.key = textureKey;

    scene.scale.on('resize', (gameSize) => {
        fog.canvas.width = gameSize.width;
        fog.canvas.height = gameSize.height;
        if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
        fog.texture = scene.textures.createCanvas(textureKey, gameSize.width, gameSize.height);
        fog.image.setTexture(textureKey);
    });

    return fog;
}

function updateFogWithLights(fog, scene, lights, time) {
    // Throttle to ~20fps
    fog.timer += scene.game.loop.delta;
    if (fog.timer < 50) return;
    fog.timer = 0;

    const ctx = fog.ctx;
    const gameW = scene.scale.width, gameH = scene.scale.height;
    if (fog.canvas.width !== gameW || fog.canvas.height !== gameH) {
        fog.canvas.width = gameW;
        fog.canvas.height = gameH;
    }

    const cam = scene.cameras.main;
    const toScreen = (wx, wy) => ({
        x: (wx - cam.scrollX) * cam.zoom,
        y: (wy - cam.scrollY) * cam.zoom,
    });

    // Fill with darkness
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(2, 1, 5, 0.97)';
    ctx.fillRect(0, 0, gameW, gameH);

    // Punch light holes
    ctx.globalCompositeOperation = 'destination-out';
    for (const light of lights) {
        const { x: sx, y: sy } = toScreen(light.x, light.y);
        const flicker = 1.0 + Math.sin(time * 0.008) * 0.03 + Math.sin(time * 0.013) * 0.02;
        const r = light.radius * flicker;
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(light.softness || 0.5, `rgba(0,0,0,${light.intensity || 0.8})`);
        grad.addColorStop(0.75, 'rgba(0,0,0,0.3)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Warm color tint
    ctx.globalCompositeOperation = 'source-atop';
    for (const light of lights) {
        if (!light.tint) continue;
        const { x: sx, y: sy } = toScreen(light.x, light.y);
        const flicker = 1.0 + Math.sin(time * 0.008) * 0.03;
        const r = light.radius * flicker;
        const tg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        tg.addColorStop(0, light.tint);
        tg.addColorStop(0.5, light.tintMid || 'rgba(255, 80, 20, 0.06)');
        tg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Copy to Phaser texture
    fog.texture.context.clearRect(0, 0, gameW, gameH);
    fog.texture.context.drawImage(fog.canvas, 0, 0);
    fog.texture.refresh();
}

// --------------------------------------------------------
// Debug overlay — enemy paths, AI states, velocity, grid
// --------------------------------------------------------
function drawEnemyDebug(scene, debugGfx, enemies, options) {
    if (!window._debugMode) {
        debugGfx.clear();
        return;
    }
    debugGfx.clear();

    // Walk grid overlay (if available)
    if (options.walkGrid && options.gridSize) {
        const cam = scene.cameras.main;
        const T = CONFIG.TILE_SIZE;
        const sx = Math.max(0, Math.floor((cam.scrollX - 32) / T));
        const sy = Math.max(0, Math.floor((cam.scrollY - 32) / T));
        const ex = Math.min(options.gridSize - 1, Math.ceil((cam.scrollX + cam.width + 32) / T));
        const ey = Math.min(options.gridSize - 1, Math.ceil((cam.scrollY + cam.height + 32) / T));
        debugGfx.fillStyle(0xFF0000, 0.15);
        for (let ty = sy; ty <= ey; ty++) {
            for (let tx = sx; tx <= ex; tx++) {
                if (options.walkGrid[ty * options.gridSize + tx] === 0) {
                    debugGfx.fillRect(tx * T, ty * T, T, T);
                }
            }
        }
    }

    // Enemy debug info
    for (const enemy of enemies) {
        if (!enemy.active) continue;

        // A* path (green)
        const path = enemy.getData('_aiPath');
        const pathIdx = enemy.getData('_aiPathIdx') || 0;
        if (path && pathIdx < path.length) {
            debugGfx.lineStyle(2, 0x00FF00, 0.7);
            debugGfx.beginPath();
            debugGfx.moveTo(enemy.x, enemy.y);
            for (let i = pathIdx; i < path.length; i++) debugGfx.lineTo(path[i].x, path[i].y);
            debugGfx.strokePath();
            debugGfx.fillStyle(0x00FF00, 0.8);
            for (let i = pathIdx; i < path.length; i++) debugGfx.fillCircle(path[i].x, path[i].y, 3);
        }

        // March path (orange)
        const marchPath = enemy.getData('marchPath');
        const marchIdx = enemy.getData('marchPathIdx') || 0;
        if (marchPath && marchIdx < marchPath.length) {
            debugGfx.lineStyle(2, 0xFF8800, 0.6);
            debugGfx.beginPath();
            debugGfx.moveTo(enemy.x, enemy.y);
            for (let i = marchIdx; i < marchPath.length; i++) debugGfx.lineTo(marchPath[i].x, marchPath[i].y);
            debugGfx.strokePath();
        }

        // Raid path (yellow)
        const raidPath = enemy.getData('raidPath');
        const raidIdx = enemy.getData('raidPathIdx') || 0;
        if (raidPath && raidIdx < raidPath.length) {
            debugGfx.lineStyle(2, 0xFFFF00, 0.5);
            debugGfx.beginPath();
            debugGfx.moveTo(enemy.x, enemy.y);
            for (let i = raidIdx; i < raidPath.length; i++) debugGfx.lineTo(raidPath[i].x, raidPath[i].y);
            debugGfx.strokePath();
        }

        // AI state label
        const aiState = enemy.getData('aiState') || '';
        if (aiState && !enemy._debugLabel) {
            enemy._debugLabel = scene.add.text(0, 0, '', {
                fontSize: '7px', fontFamily: 'monospace', color: '#FFFF00',
                stroke: '#000', strokeThickness: 1,
            }).setOrigin(0.5).setDepth(5100);
        }
        if (enemy._debugLabel) {
            const type = enemy.getData('type') || '?';
            enemy._debugLabel.setText(`${type}\n${aiState}`);
            enemy._debugLabel.setPosition(enemy.x, enemy.y - 24);
            enemy._debugLabel.setVisible(true);
        }

        // Velocity direction (cyan)
        const vx = enemy.body ? enemy.body.velocity.x : 0;
        const vy = enemy.body ? enemy.body.velocity.y : 0;
        if (Math.abs(vx) > 1 || Math.abs(vy) > 1) {
            const len = Math.hypot(vx, vy);
            debugGfx.lineStyle(1, 0x00FFFF, 0.6);
            debugGfx.beginPath();
            debugGfx.moveTo(enemy.x, enemy.y);
            debugGfx.lineTo(enemy.x + (vx / len) * 30, enemy.y + (vy / len) * 30);
            debugGfx.strokePath();
        }
    }
}

// Clean up debug labels when debug mode turns off
function cleanupDebugLabels(enemies) {
    for (const enemy of enemies) {
        if (!enemy.active) continue;
        if (enemy._debugLabel) {
            enemy._debugLabel.setVisible(false);
        }
    }
}

// --------------------------------------------------------
// Health bar update (HTML HUD)
// --------------------------------------------------------
function updateHealthBar() {
    const el = document.getElementById('health-fill');
    if (el) el.style.width = `${(gameState.hp / CONFIG.PLAYER_MAX_HP) * 100}%`;
}

// --------------------------------------------------------
// Damage player (shared across scenes)
// --------------------------------------------------------
function damagePlayerShared(scene, amount) {
    const armor = gameState.armor || 0;
    const reduced = Math.max(1, Math.floor(amount * (1 - armor)));
    gameState.hp -= reduced;
    updateHealthBar();
    if (gameState.hp <= 0) gameState.hp = 0;
    return reduced;
}

// --------------------------------------------------------
// HUD visibility helpers for scene transitions
// --------------------------------------------------------
function showFullHUD() {
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'flex';
    const hudRight = document.querySelector('.hud-right');
    if (hudRight) hudRight.style.display = '';
    const fuelBar = document.getElementById('fuel-fill');
    if (fuelBar) fuelBar.parentElement.parentElement.style.display = '';
    const levelBar = document.getElementById('fire-level-fill');
    if (levelBar) levelBar.parentElement.parentElement.style.display = '';
}

// --------------------------------------------------------
// A* Pathfinding (shared across scenes)
// walkGrid: Uint8Array where 1=walkable, 0=blocked
// gridSize: width/height of the grid
// Returns array of {x, y} world positions, or null
// --------------------------------------------------------
function findPathAStar(walkGrid, gridSize, tileSize, fromWX, fromWY, toWX, toWY) {
    const T = tileSize;
    const gs = gridSize;
    const sx = Math.floor(fromWX / T), sy = Math.floor(fromWY / T);
    let ex = Math.floor(toWX / T), ey = Math.floor(toWY / T);

    if (sx < 0 || sy < 0 || ex < 0 || ey < 0 || sx >= gs || sy >= gs || ex >= gs || ey >= gs) return null;
    if (!walkGrid[sy * gs + sx]) return null;

    if (!walkGrid[ey * gs + ex]) {
        let snapped = false;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
            const nx = ex + dx, ny = ey + dy;
            if (nx >= 0 && ny >= 0 && nx < gs && ny < gs && walkGrid[ny * gs + nx]) {
                ex = nx; ey = ny; snapped = true; break;
            }
        }
        if (!snapped) return null;
    }

    const key = (x, y) => y * gs + x;
    const heuristic = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);
    const open = [{ x: sx, y: sy, g: 0, f: heuristic(sx, sy) }];
    const cameFrom = new Map();
    const gScore = new Map();
    gScore.set(key(sx, sy), 0);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    let iterations = 0;

    while (open.length > 0 && iterations++ < 10000) {
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].f < open[bestIdx].f) bestIdx = i;
        }
        const curr = open.splice(bestIdx, 1)[0];
        if (curr.x === ex && curr.y === ey) {
            const path = [];
            let k = key(curr.x, curr.y);
            while (cameFrom.has(k)) {
                const tx = k % gs, ty = Math.floor(k / gs);
                path.push({ x: tx * T + T / 2, y: ty * T + T / 2 });
                k = cameFrom.get(k);
            }
            path.reverse();
            const simplified = [];
            for (let i = 0; i < path.length; i += 2) simplified.push(path[i]);
            simplified.push({ x: toWX, y: toWY });
            return simplified;
        }
        for (const [dx, dy] of dirs) {
            const nx = curr.x + dx, ny = curr.y + dy;
            if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
            if (!walkGrid[ny * gs + nx]) continue;
            if (dx !== 0 && dy !== 0) {
                if (!walkGrid[curr.y * gs + nx] || !walkGrid[ny * gs + curr.x]) continue;
            }
            const moveCost = (dx !== 0 && dy !== 0) ? 1.41 : 1;
            const ng = curr.g + moveCost;
            const nk = key(nx, ny);
            if (gScore.has(nk) && ng >= gScore.get(nk)) continue;
            gScore.set(nk, ng);
            cameFrom.set(nk, key(curr.x, curr.y));
            open.push({ x: nx, y: ny, g: ng, f: ng + heuristic(nx, ny) });
        }
    }
    return null;
}

function showMazeHUD() {
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'flex';
    // Hide fire/resources — not relevant in maze
    const hudRight = document.querySelector('.hud-right');
    if (hudRight) hudRight.style.display = 'none';
    const fuelBar = document.getElementById('fuel-fill');
    if (fuelBar) fuelBar.parentElement.parentElement.style.display = 'none';
    const levelBar = document.getElementById('fire-level-fill');
    if (levelBar) levelBar.parentElement.parentElement.style.display = 'none';
}
