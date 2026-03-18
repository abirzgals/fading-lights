// ============================================================
// SHARED UTILITIES — Reusable across all game scenes
// ============================================================

// --------------------------------------------------------
// FPS counter — small overlay in top-right corner
// --------------------------------------------------------
(function initFpsCounter() {
    const el = document.createElement('div');
    el.id = 'fps-counter';
    el.style.cssText = 'position:fixed;top:4px;right:8px;color:#8f8;font:bold 11px monospace;z-index:99999;pointer-events:none;opacity:0.7;text-shadow:0 0 2px #000';
    document.body.appendChild(el);
    let frames = 0, lastTime = performance.now();
    const tick = () => {
        frames++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            el.textContent = frames + ' fps';
            frames = 0;
            lastTime = now;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
})();

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
// Unified Shadow System — texture-based silhouette + ellipse shadows
// Called from ANY scene with just data, zero scene-specific logic here.
// --------------------------------------------------------

/**
 * updateAllShadows(scene, opts) — single entry point for all shadow rendering.
 *
 * @param {Phaser.Scene} scene
 * @param {Object} opts
 * @param {Array<{x,y,radius}>} opts.lights       — active light sources in world coords
 * @param {Array<Phaser.GameObjects.Sprite>} [opts.sprites]  — individual sprites (player, boss)
 * @param {Array<Phaser.GameObjects.Group>}  [opts.groups]   — sprite groups (enemies, allies)
 * @param {Phaser.GameObjects.Graphics}      [opts.graphics] — for ellipse shadows (trees etc)
 * @param {Array<{x,y,w,h}>}                [opts.statics]  — static objects for ellipse shadows
 */
function updateAllShadows(scene, opts) {
    const lights = opts.lights || [];
    if (lights.length === 0) return;

    const cam = scene.cameras.main;
    const m = 100;
    const cl = cam.scrollX - m, cr = cam.scrollX + cam.width + m;
    const ct = cam.scrollY - m, cb = cam.scrollY + cam.height + m;

    // Find nearest light to a position
    const findLight = (ox, oy) => {
        let best = null, bestD = Infinity;
        for (const l of lights) {
            const d = Math.sqrt((ox - l.x) ** 2 + (oy - l.y) ** 2);
            if (d < l.radius && d < bestD) { best = l; bestD = d; }
        }
        return best ? { lx: best.x, ly: best.y, dist: bestD, radius: best.radius } : null;
    };

    // --- Texture-based shadows for sprites ---
    // cleanup=true: destroy shadow sprites when off-screen (for large groups like trees)
    const updateSprite = (sprite, cleanup) => {
        if (!sprite || !sprite.active) {
            if (sprite && sprite._shadow) {
                sprite._shadow.destroy(); sprite._shadow = null;
            }
            return;
        }
        if (sprite.x < cl || sprite.x > cr || sprite.y < ct || sprite.y > cb) {
            if (sprite._shadow) {
                if (cleanup) { sprite._shadow.destroy(); sprite._shadow = null; }
                else sprite._shadow.setVisible(false);
            }
            return;
        }

        const light = findLight(sprite.x, sprite.y);
        if (!light) {
            if (sprite._shadow) sprite._shadow.setVisible(false);
            return;
        }

        // Lazy-create shadow sprite on first use
        if (!sprite._shadow) {
            const sh = scene.add.sprite(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name);
            sh.setTint(0x000000);
            sh.setOrigin(0.5, 1); // anchor at bottom center (feet)
            sh.setDepth(0.5);
            sprite._shadow = sh;
        }

        const shadow = sprite._shadow;
        // Sync texture & frame
        const fName = sprite.frame ? sprite.frame.name : undefined;
        if (shadow.texture.key !== sprite.texture.key || shadow.frame.name !== fName) {
            shadow.setTexture(sprite.texture.key, fName);
        }
        shadow.setFlipX(sprite.flipX);
        shadow.setFlipY(false);

        const dist = light.dist;
        if (dist < 3) { shadow.setVisible(false); return; }
        shadow.setVisible(true);

        // Shadow stretches AWAY from light source
        const dx = sprite.x - light.lx, dy = sprite.y - light.ly;
        const angle = Math.atan2(dy, dx);
        // Shadow length: closer to light = longer shadow
        const shadowLen = Math.min(1.2, 400 / (dist + 50));

        // Ground contact point — use physics body bottom if available
        let feetY;
        if (sprite.body) {
            // Body bottom edge = actual ground contact
            feetY = sprite.body.y + sprite.body.height;
        } else {
            const sprH = sprite.displayHeight || sprite.height || 48;
            feetY = sprite.y + sprH * 0.35;
        }

        // Shadow origin at ground contact, stretching away from light
        shadow.setPosition(sprite.x, feetY);
        shadow.setRotation(angle + Math.PI * 0.5); // point away from light
        shadow.setScale((sprite.scaleX || 1), shadowLen * 0.45);

        // Alpha fades at light edge
        const edgeFade = 1 - (dist / light.radius);
        shadow.setAlpha(Math.max(0.05, 0.35 * edgeFade));
        shadow.setDepth(sprite.depth - 0.1);
    };

    // Update individual sprites (every frame, no cleanup)
    if (opts.sprites) {
        for (const s of opts.sprites) updateSprite(s, false);
    }

    // Update groups — every frame (enemies, allies)
    if (opts.groups) {
        for (const group of opts.groups) {
            for (const s of group.children.entries) updateSprite(s, false);
        }
    }

    // Throttled groups — trees etc (cleanup off-screen shadow sprites to save memory)
    if (opts.throttledGroups) {
        for (const group of opts.throttledGroups) {
            for (const s of group.children.entries) updateSprite(s, true);
        }
    }
}

// --------------------------------------------------------
// Fog of War — WebGL PostFX Shader Pipeline
// --------------------------------------------------------
const FOG_FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform sampler2D uNormalSampler;
varying vec2 outTexCoord;

uniform vec2 uResolution;
uniform float uLightCount;
uniform float uLightX[8];
uniform float uLightY[8];
uniform float uLightRadius[8];
uniform float uLightIntensity[8];
uniform float uLightSoftness[8];
uniform float uTintR[8];
uniform float uTintG[8];
uniform float uTintB[8];
uniform float uTintA[8];
uniform float uNormalStrength;

void main() {
    vec4 sceneColor = texture2D(uMainSampler, outTexCoord);
    vec2 fragPixel = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uResolution;
    int lightCount = int(uLightCount);

    // Normal map: only sample if enabled (uNormalStrength > 0)
    vec3 surfNormal = vec3(0.0, 0.0, 1.0);
    float hasNormal = 0.0;
    if (uNormalStrength > 0.0) {
        vec4 ns = texture2D(uNormalSampler, vec2(outTexCoord.x, 1.0 - outTexCoord.y));
        surfNormal = normalize(ns.rgb * 2.0 - 1.0);
        surfNormal.xy = -surfNormal.xy;
        hasNormal = step(0.01, abs(surfNormal.x) + abs(surfNormal.y));
    }

    float darkness = 1.0;
    vec3 warmTint = vec3(0.0);

    for (int i = 0; i < 8; i++) {
        if (i >= lightCount) break;

        vec2 lightPos = vec2(uLightX[i], uLightY[i]);
        vec2 toLight = lightPos - fragPixel;
        float dist = length(toLight);
        float radius = uLightRadius[i];
        if (dist >= radius) continue;

        float t = dist / radius;
        float intensity = uLightIntensity[i];
        float softness = uLightSoftness[i];

        float falloff;
        if (t <= softness) {
            falloff = mix(intensity, intensity * 0.8, t / max(softness, 0.01));
        } else if (t <= 0.75) {
            falloff = mix(intensity * 0.8, 0.3, (t - softness) / max(0.75 - softness, 0.01));
        } else {
            falloff = mix(0.3, 0.0, (t - 0.75) / 0.25);
        }

        // Normal map directional lighting (skipped when uNormalStrength = 0)
        if (hasNormal > 0.0) {
            vec3 lightDir = normalize(vec3(toLight, radius * 0.4));
            float nDotL = max(dot(surfNormal, lightDir), 0.0);
            falloff *= mix(1.0, nDotL * 1.5, uNormalStrength);
        }

        darkness *= (1.0 - falloff);
        float tintFalloff = smoothstep(1.0, 0.0, t);
        warmTint += vec3(uTintR[i], uTintG[i], uTintB[i]) * uTintA[i] * tintFalloff;
    }

    darkness = clamp(darkness, 0.0, 1.0);
    vec3 darkColor = vec3(2.0/255.0, 1.0/255.0, 5.0/255.0);
    vec3 foggedColor = mix(sceneColor.rgb, darkColor, darkness);
    float foggedLum = dot(foggedColor, vec3(0.299, 0.587, 0.114));
    vec3 finalColor = foggedColor + warmTint * foggedLum * 2.0;
    gl_FragColor = vec4(finalColor, sceneColor.a);
}
`;

class FogOfWarPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
        super({ game, name: 'FogOfWarPipeline', fragShader: FOG_FRAG_SHADER });
        this._normalGlTex = null;
    }

    // Bind the normal buffer GL texture for use in the shader
    setNormalBuffer(glTexture) {
        this._normalGlTex = glTexture;
    }

    // Override onDraw to bind the normal buffer as texture unit 1
    onDraw(renderTarget) {
        if (this._normalRT) {
            try {
                const gl = this.renderer.gl;
                // Re-extract GL texture each frame (RT may be recreated on resize)
                const src = this._normalRT.texture.source[0];
                const glTex = src.glTexture?.webGLTexture || src.glTexture;
                if (glTex) {
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, glTex);
                    this.set1i('uNormalSampler', 1);
                }
            } catch (e) { /* skip this frame */ }
        }
        this.bindAndDraw(renderTarget);
    }

    setLights(lights, resolution, normalStrength) {
        const MAX = 8;
        const count = Math.min(lights.length, MAX);
        this.set1f('uLightCount', count);
        this.set2f('uResolution', resolution.x, resolution.y);
        this.set1f('uNormalStrength', normalStrength || 0);

        const lx = new Float32Array(MAX);
        const ly = new Float32Array(MAX);
        const lr = new Float32Array(MAX);
        const li = new Float32Array(MAX);
        const ls = new Float32Array(MAX);
        const tr = new Float32Array(MAX);
        const tg = new Float32Array(MAX);
        const tb = new Float32Array(MAX);
        const ta = new Float32Array(MAX);

        for (let i = 0; i < count; i++) {
            const l = lights[i];
            lx[i] = l.sx;
            ly[i] = l.sy;
            lr[i] = l.radius;
            li[i] = l.intensity;
            ls[i] = l.softness;
            tr[i] = l.tintR;
            tg[i] = l.tintG;
            tb[i] = l.tintB;
            ta[i] = l.tintA;
        }

        this.set1fv('uLightX', lx);
        this.set1fv('uLightY', ly);
        this.set1fv('uLightRadius', lr);
        this.set1fv('uLightIntensity', li);
        this.set1fv('uLightSoftness', ls);
        this.set1fv('uTintR', tr);
        this.set1fv('uTintG', tg);
        this.set1fv('uTintB', tb);
        this.set1fv('uTintA', ta);
    }
}

// Setup fog pipeline on a scene (shared by both GameScene and MazeScene)
function setupFogPipeline(scene) {
    try {
        if (scene.renderer.type !== Phaser.WEBGL) return null;
        // Register the pipeline class (idempotent — safe to call multiple times)
        if (!scene.renderer.pipelines.getPostPipeline('FogOfWarPipeline')) {
            scene.renderer.pipelines.addPostPipeline('FogOfWarPipeline', FogOfWarPipeline);
        }
        scene.cameras.main.setPostPipeline(FogOfWarPipeline);
        const pipelines = scene.cameras.main.getPostPipeline(FogOfWarPipeline);
        // getPostPipeline may return array or single instance
        const pipeline = Array.isArray(pipelines) ? pipelines[0] : pipelines;
        if (pipeline) {
            console.log('[Fog] WebGL shader pipeline active');
            return pipeline;
        }
    } catch (e) {
        console.warn('[Fog] WebGL pipeline failed, using no fog:', e.message);
    }
    return null;
}

// Collect lights and push to pipeline (shared helper)
function updateFogLights(pipeline, scene, lights, normalStrength) {
    if (!pipeline) return;
    try {
        // Disable normal maps on mobile (no normal buffer = no sampling)
        const isMobile = typeof mobileControls !== 'undefined' && mobileControls.isMobile;
        const ns = isMobile ? 0 : (normalStrength || 0);
        pipeline.setLights(lights, { x: scene.scale.width, y: scene.scale.height }, ns);
    } catch (e) {
        // Silently ignore shader errors
    }
}

// --------------------------------------------------------
// Normal buffer — per-pixel normal maps for directional lighting
// --------------------------------------------------------

// Create a normal buffer RenderTexture for a scene
function createNormalBuffer(scene) {
    const w = scene.scale.width;
    const h = scene.scale.height;
    const rt = scene.make.renderTexture({ x: 0, y: 0, width: w, height: h, add: false });
    rt.fill(0x8080FF);
    rt._scale = 1;
    return rt;
}

// Update the normal buffer with visible objects' normal maps
// Only draws normals for objects within a light radius (dark areas = wasted draw calls)
function updateNormalBuffer(normalRT, scene, objects, lights) {
    if (!normalRT) return;
    // Skip on mobile — too expensive
    if (typeof mobileControls !== 'undefined' && mobileControls.isMobile) return;
    if (!lights || lights.length === 0) return;

    const cam = scene.cameras.main;
    const m = 50;
    const cl = cam.scrollX - m, cr = cam.scrollX + cam.width + m;
    const ct = cam.scrollY - m, cb = cam.scrollY + cam.height + m;

    // Clear to default flat normal
    normalRT.fill(0x8080FF);

    let drawn = 0;
    for (const obj of objects) {
        if (!obj.active) continue;
        if (obj.x < cl || obj.x > cr || obj.y < ct || obj.y > cb) continue;

        // Only draw normals for objects within a light radius
        let inLight = false;
        for (const l of lights) {
            const dx = obj.x - l.x, dy = obj.y - l.y;
            if (dx * dx + dy * dy < l.radius * l.radius) { inLight = true; break; }
        }
        if (!inLight) continue;

        const normalKey = obj.texture.key + '_n';
        if (!scene.textures.exists(normalKey)) continue;

        const s = normalRT._scale || 1;
        const tl = obj.getTopLeft();
        const sx = (tl.x - cam.scrollX) * cam.zoom * s;
        const sy = (tl.y - cam.scrollY) * cam.zoom * s;
        normalRT.drawFrame(normalKey, undefined, sx, sy);
        if (++drawn >= 20) break; // cap draw calls per frame
    }
}

// Bind the normal buffer to the fog pipeline — called once at setup,
// then the pipeline re-binds every frame in onDraw
function bindNormalBuffer(pipeline, normalRT) {
    if (!pipeline || !normalRT) return;
    // Defer binding until the RT is actually rendered (GL texture created)
    // Store the RT reference — the pipeline will extract the GL texture on first draw
    pipeline._normalRT = normalRT;
    console.log('[NormalBuffer] deferred bind registered');
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

// --------------------------------------------------------
// Find nearest player (local + all remotes) from a position
// Returns { x, y, dist, isLocal, peerId } or null
// --------------------------------------------------------
function findNearestPlayer(scene, fromX, fromY) {
    let best = null;
    let bestDist = Infinity;

    // Local player
    if (scene.player && scene.player.active) {
        const d = Phaser.Math.Distance.Between(fromX, fromY, scene.player.x, scene.player.y);
        if (d < bestDist) { bestDist = d; best = { x: scene.player.x, y: scene.player.y, dist: d, isLocal: true, peerId: null }; }
    }

    // Remote players
    if (scene.remotePlayers) {
        for (const [peerId, remote] of scene.remotePlayers) {
            if (!remote.sprite || !remote.sprite.active) continue;
            const rx = remote.targetX || remote.sprite.x;
            const ry = remote.targetY || remote.sprite.y;
            const d = Phaser.Math.Distance.Between(fromX, fromY, rx, ry);
            if (d < bestDist) { bestDist = d; best = { x: rx, y: ry, dist: d, isLocal: false, peerId }; }
        }
    }

    return best;
}

// Damage the nearest player (local or send to remote via network)
function damageNearestPlayer(scene, enemy, damage) {
    const nearest = findNearestPlayer(scene, enemy.x, enemy.y);
    if (!nearest) return;
    if (nearest.isLocal) {
        // Local player
        if (scene.damagePlayer) {
            scene.damagePlayer(damage);
        } else {
            damagePlayerShared(scene, damage);
        }
        if (scene.showFloatingText) scene.showFloatingText(scene.player.x, scene.player.y - 20, `-${damage}`, '#FF4444');
        else showFloatingText(scene, scene.player.x, scene.player.y - 20, `-${damage}`, '#FF4444');
    } else if (typeof network !== 'undefined') {
        network.broadcastReliable({ t: 'rd', dmg: damage, pid: nearest.peerId });
    }
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
