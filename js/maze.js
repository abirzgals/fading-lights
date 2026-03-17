// ================================================================
// MAZE SCENE — Level 2: The Lair Below
// Room-and-corridor dungeon with enemies.
// ================================================================

class MazeScene extends Phaser.Scene {
    constructor() { super('MazeScene'); }

    // ----------------------------------------------------------
    // CREATE
    // ----------------------------------------------------------
    create() {
        this._done = false;
        // Start level 2 music
        if (typeof audioEngine !== 'undefined') {
            audioEngine.stopLoop?.('music', 400);
            audioEngine.startLoop?.('music_lvl2', 1500);
        }

        const TILE   = 32;
        const GRID_W = 68, GRID_H = 68;
        const worldW = GRID_W * TILE;
        const worldH = GRID_H * TILE;

        this.TILE = TILE;
        this.physics.world.setBounds(0, 0, worldW, worldH);

        // Generate dungeon
        const { grid, rooms } = this._generateDungeon(GRID_W, GRID_H);
        this._grid = grid;

        // Background void
        this.add.rectangle(worldW / 2, worldH / 2, worldW, worldH, 0x05050A).setDepth(-1);

        // Use pixel art dungeon tileset if available
        const hasDungeonTileset = this.textures.exists('dungeon_tileset');

        if (hasDungeonTileset) {
            // Wang tiling: wall=upper(1), floor=lower(0)
            const WANG_TO_FRAME = [6,7,10,9,2,11,4,15,5,14,1,8,3,0,13,12];
            const isWall = (gx, gy) => gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H || grid[gy][gx] === 0;

            // Bake all tiles into a RenderTexture
            const rt = this.add.renderTexture(0, 0, worldW, worldH).setOrigin(0, 0).setDepth(0);
            for (let gy = 0; gy < GRID_H; gy++) {
                for (let gx = 0; gx < GRID_W; gx++) {
                    // Only render tiles near floor (walls + floor + 1-tile border)
                    if (grid[gy][gx] === 0 && !this._bordersFloor(grid, gx, gy, GRID_W, GRID_H)) continue;
                    const nw = isWall(gx, gy) ? 1 : 0;
                    const ne = isWall(gx + 1, gy) ? 1 : 0;
                    const sw = isWall(gx, gy + 1) ? 1 : 0;
                    const se = isWall(gx + 1, gy + 1) ? 1 : 0;
                    const wangIdx = nw * 8 + ne * 4 + sw * 2 + se;
                    rt.drawFrame('dungeon_tileset', WANG_TO_FRAME[wangIdx], gx * TILE, gy * TILE);
                }
            }
        } else {
            // Fallback: procedural tiles
            for (let gy = 0; gy < GRID_H; gy++) {
                for (let gx = 0; gx < GRID_W; gx++) {
                    if (grid[gy][gx] === 1) {
                        this.add.image(gx * TILE + 16, gy * TILE + 16, 'maze_floor').setDepth(0);
                    }
                }
            }
        }

        // Walls (physics bodies) — only tiles adjacent to a floor tile
        this.walls = this.physics.add.staticGroup();
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                if (grid[gy][gx] === 0 && this._bordersFloor(grid, gx, gy, GRID_W, GRID_H)) {
                    // Use dungeon tileset wall or fallback procedural
                    const wallTex = hasDungeonTileset ? 'dungeon_tileset' : 'maze_stone';
                    const w = hasDungeonTileset
                        ? this.walls.create(gx * TILE + 16, gy * TILE + 16, wallTex, 12)
                        : this.walls.create(gx * TILE + 16, gy * TILE + 16, wallTex);
                    w.setDepth(2).refreshBody();
                    // Make wall invisible if using RenderTexture (already rendered)
                    if (hasDungeonTileset) w.setAlpha(0);
                }
            }
        }

        // --- Dungeon decorations (bones, torches scattered in rooms) ---
        this._wallTorches = []; // stored as light sources
        if (hasDungeonTileset) {
            const hasBones = this.textures.exists('dungeon_bones');
            const hasTorch = this.textures.exists('dungeon_torch');
            for (let i = 1; i < rooms.length; i++) { // skip first room (spawn)
                const rm = rooms[i];
                // Scatter bones in ~30% of rooms
                if (hasBones && Math.random() < 0.3) {
                    const bx = (rm.x + 1 + Math.floor(Math.random() * (rm.w - 2))) * TILE + 16;
                    const by = (rm.y + 1 + Math.floor(Math.random() * (rm.h - 2))) * TILE + 16;
                    this.add.image(bx, by, 'dungeon_bones').setDepth(1).setAlpha(0.7);
                }
                // Place torches near room walls (~40% of rooms)
                if (hasTorch && Math.random() < 0.4) {
                    const tx = rm.x * TILE + 16;
                    const ty = rm.y * TILE + 16;
                    this.add.image(tx, ty, 'dungeon_torch').setDepth(3);
                    this._wallTorches.push({ x: tx, y: ty });
                    // Fire particle emitter on torch
                    this.add.particles(tx, ty - 6, 'particle', {
                        speed: { min: 8, max: 25 },
                        angle: { min: 255, max: 285 },
                        lifespan: { min: 300, max: 600 },
                        scale: { start: 0.4, end: 0.05 },
                        alpha: { start: 0.8, end: 0 },
                        tint: [0xFF4400, 0xFF6600, 0xFFAA00],
                        blendMode: 'ADD',
                        frequency: 80,
                        quantity: 1,
                    }).setDepth(4);
                }
            }
        }

        // --- Player ---
        const sr  = rooms[0];
        const spx = (sr.x + Math.floor(sr.w / 2)) * TILE + 16;
        const spy = (sr.y + Math.floor(sr.h / 2)) * TILE + 16;
        this._charPrefix = window._charVariant || 'male';
        const hasPA = this.textures.exists(this._charPrefix + '_south');
        const texKey = hasPA ? (this._charPrefix + '_south')
            : ((typeof getPlayerTextureKey !== 'undefined')
                ? getPlayerTextureKey(network.playerColor) : 'player');
        this.player = this.physics.add.sprite(
            spx, spy, this.textures.exists(texKey) ? texKey : 'player');
        this.player.setDepth(5).setCollideWorldBounds(true);
        if (hasPA) {
            this.player.body.setSize(14, 12).setOffset(17, 32);
        } else {
            this.player.body.setSize(14, 12).setOffset(9, 32);
        }
        this.player.facing = { x: 0, y: 1 };
        this.player._lastDir = 'south';
        this._hasPixelArtPlayer = hasPA;
        this.player.attackCooldown = 0;
        this.physics.add.collider(this.player, this.walls);

        // --- Enemies ---
        this.mazeEnemies = this.physics.add.group();
        this._spawnEnemies(rooms, TILE);
        this.physics.add.collider(this.mazeEnemies, this.walls);

        // HP graphics (redrawn each frame)
        this._hpGfx = this.add.graphics().setDepth(60);
        // Shadow graphics — player is the light source in the maze
        this._shadowGfx = this.add.graphics().setDepth(1);
        this._shadowTimer = 0;
        // Debug overlay graphics
        this._debugGfx = this.add.graphics().setDepth(4999);

        // --- Boss room (last room) + Treasure ---
        const er       = rooms[rooms.length - 1];
        const tresX    = (er.x + Math.floor(er.w / 2)) * TILE + 16;
        const tresY    = (er.y + Math.floor(er.h / 2)) * TILE + 16;
        const chestTex = this.textures.exists('dungeon_chest') ? 'dungeon_chest' : 'treasure_chest';
        this.treasure  = this.add.sprite(tresX, tresY, chestTex).setDepth(3).setScale(1.15);
        this.treasure.setAlpha(0.4); // locked until boss is dead

        // Boss — Darkness Lord
        this._bossAlive = true;
        const bossTex = this.textures.exists('boss_south') ? 'boss_south' : 'enemy_lord';
        const bossX = tresX, bossY = tresY - 60;
        this._boss = this.mazeEnemies.create(bossX, bossY, bossTex);
        this._boss.setDepth(5);
        this._boss.setData('hp', 300);
        this._boss.setData('maxHp', 300);
        this._boss.setData('dmg', 30);
        this._boss.setData('spd', 45);
        this._boss.setData('size', 40);
        this._boss.setData('atkCd', 0);
        this._boss.setData('type', 'BOSS');
        this._boss.setData('aiState', 'IDLE');
        this._boss.setData('spellCd', 0);
        this._boss.setData('wanderAngle', 0);
        this._boss.setData('wanderTimer', 0);
        this._boss.body.setSize(50, 50);

        // Boss dark aura
        this._bossAura = this.add.image(bossX, bossY, 'glow')
            .setDepth(4).setScale(4).setAlpha(0.3).setTint(0x6600AA).setBlendMode('ADD');
        this.tweens.add({ targets: this._bossAura, scale: 5, alpha: 0.15, duration: 1200, yoyo: true, repeat: -1 });

        // Chest locked hint
        this._treasureHint = this.add.text(tresX, tresY - 28, 'Defeat the Darkness Lord', {
            fontSize: '9px', fill: '#FF4444', fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(10).setAlpha(0);

        // Chest glow (dim while locked)
        this._chestGlow = this.add.image(tresX, tresY, 'glow')
            .setDepth(2.8).setScale(2).setAlpha(0.15).setTint(0x6600AA).setBlendMode('ADD');
        this.tweens.add({ targets: this._chestGlow, scale: 2.5, alpha: 0.08, duration: 850, yoyo: true, repeat: -1 });

        // --- Torch light ---
        this._torchRadius = 145;
        this._initTorchLight(worldW, worldH);

        // --- Weapon sprite ---
        this._weaponSprite = null;
        this._updateWeaponSprite();

        // --- Camera ---
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setBounds(0, 0, worldW, worldH);
        this.cameras.main.fadeIn(1600, 0, 0, 0);
        if (typeof mobileControls !== 'undefined') mobileControls.show();

        // --- Input ---
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd    = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
        this.input.keyboard.on('keydown-E', () => this._interact());
        this.input.keyboard.on('keydown-F', () => this._interact());
        // Dev: press 1 to return to level 1
        this.input.keyboard.on('keydown-ONE', () => {
            if (!window._debugMode) return;
            if (typeof audioEngine !== 'undefined') audioEngine.stopLoop?.('music_lvl2', 400);
            this.scene.start('GameScene');
        });
        this.input.on('pointerdown', (ptr) => {
            if (ptr.rightButtonDown()) this._interact();
            // leftButtonDown() is false on touch — handled via ptr.isDown in update loop
        });
        this._attackKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this._interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

        // Show HTML HUD (health bar only, hide fire/resources)
        showMazeHUD();

        // --- HUD (scroll-fixed) ---
        this._hudHp = this.add.text(8, 8, '', {
            fontSize: '10px', fill: '#FF4444', fontFamily: 'monospace',
            stroke: '#000', strokeThickness: 3,
        }).setDepth(100).setScrollFactor(0);

        this._hudCompass = this.add.text(8, 22, '', {
            fontSize: '9px', fill: '#FFEE88', fontFamily: 'monospace',
            stroke: '#000', strokeThickness: 3,
        }).setDepth(100).setScrollFactor(0);

        this._hudKills = this.add.text(8, 36, 'Enemies: 0', {
            fontSize: '9px', fill: '#CC88FF', fontFamily: 'monospace',
            stroke: '#000', strokeThickness: 3,
        }).setDepth(100).setScrollFactor(0);

        this._killCount = 0;
    }

    // ----------------------------------------------------------
    // DUNGEON GENERATION — rooms + L-shaped corridors
    // Sorts rooms top-left → bottom-right and connects each to
    // the next, guaranteeing a path to the treasure room.
    // ----------------------------------------------------------
    _generateDungeon(gridW, gridH) {
        const grid = Array.from({ length: gridH }, () => new Array(gridW).fill(0));
        const rooms = [];

        const MIN_ROOM = 5, MAX_ROOM = 14;
        const NUM_ROOMS = 16, PAD = 2;

        for (let attempt = 0; attempt < 400 && rooms.length < NUM_ROOMS; attempt++) {
            const w = MIN_ROOM + Math.floor(Math.random() * (MAX_ROOM - MIN_ROOM + 1));
            const h = MIN_ROOM + Math.floor(Math.random() * (MAX_ROOM - MIN_ROOM + 1));
            const x = 1 + PAD + Math.floor(Math.random() * (gridW - w - PAD * 2 - 2));
            const y = 1 + PAD + Math.floor(Math.random() * (gridH - h - PAD * 2 - 2));

            if (rooms.some(r =>
                x < r.x + r.w + PAD && x + w + PAD > r.x &&
                y < r.y + r.h + PAD && y + h + PAD > r.y)) continue;

            rooms.push({ x, y, w, h });
            for (let ry = y; ry < y + h; ry++)
                for (let rx = x; rx < x + w; rx++)
                    grid[ry][rx] = 1;
        }

        // Sort by diagonal distance from top-left → natural dungeon path
        rooms.sort((a, b) => (a.x + a.y) - (b.x + b.y));

        // Connect each room to the next (guaranteed path)
        for (let i = 1; i < rooms.length; i++)
            this._connectRooms(grid, rooms[i - 1], rooms[i], gridW, gridH);

        // A few extra cross-connections for loops
        const extras = Math.min(4, rooms.length - 2);
        for (let i = 0; i < extras; i++) {
            const a = rooms[1 + Math.floor(Math.random() * (rooms.length - 2))];
            const b = rooms[1 + Math.floor(Math.random() * (rooms.length - 2))];
            if (a !== b) this._connectRooms(grid, a, b, gridW, gridH);
        }

        return { grid, rooms };
    }

    _connectRooms(grid, ra, rb, gridW, gridH) {
        const ax = Math.floor(ra.x + ra.w / 2), ay = Math.floor(ra.y + ra.h / 2);
        const bx = Math.floor(rb.x + rb.w / 2), by = Math.floor(rb.y + rb.h / 2);
        // Corridor half-width: 1 (narrow) or 2 (wide hall, 30% chance)
        const hw = Math.random() < 0.3 ? 2 : 1;
        if (Math.random() < 0.5) {
            this._hLine(grid, Math.min(ax, bx), Math.max(ax, bx), ay, hw, gridW, gridH);
            this._vLine(grid, Math.min(ay, by), Math.max(ay, by), bx, hw, gridW, gridH);
        } else {
            this._vLine(grid, Math.min(ay, by), Math.max(ay, by), ax, hw, gridW, gridH);
            this._hLine(grid, Math.min(ax, bx), Math.max(ax, bx), by, hw, gridW, gridH);
        }
    }

    _hLine(grid, x1, x2, y, hw, gridW, gridH) {
        for (let x = x1; x <= x2; x++)
            for (let dy = -hw; dy <= hw; dy++) {
                const ny = y + dy;
                if (ny >= 1 && ny < gridH - 1 && x >= 1 && x < gridW - 1) grid[ny][x] = 1;
            }
    }

    _vLine(grid, y1, y2, x, hw, gridW, gridH) {
        for (let y = y1; y <= y2; y++)
            for (let dx = -hw; dx <= hw; dx++) {
                const nx = x + dx;
                if (nx >= 1 && nx < gridW - 1 && y >= 1 && y < gridH - 1) grid[y][nx] = 1;
            }
    }

    _bordersFloor(grid, gx, gy, gridW, gridH) {
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]]) {
            const nx = gx + dx, ny = gy + dy;
            if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH && grid[ny][nx] === 1) return true;
        }
        return false;
    }

    // ----------------------------------------------------------
    // ENEMY SPAWNING
    // ----------------------------------------------------------
    _spawnEnemies(rooms, TILE) {
        for (let i = 1; i < rooms.length - 1; i++) {
            const room   = rooms[i];
            const area   = room.w * room.h;
            const count  = Phaser.Math.Clamp(Math.floor(area / 25), 1, 5);
            const depth  = i / rooms.length; // 0..1 → harder deeper

            for (let j = 0; j < count; j++) {
                const ex = (room.x + 1 + Math.floor(Math.random() * (room.w - 2))) * TILE + 16;
                const ey = (room.y + 1 + Math.floor(Math.random() * (room.h - 2))) * TILE + 16;

                // Type scales with depth
                let hp, dmg, spd, size, texKey;
                if (depth < 0.35) {
                    hp = 18; dmg = 5;  spd = 75; size = 10; texKey = 'enemy_wisp';
                } else if (depth < 0.65) {
                    hp = 40; dmg = 12; spd = 60; size = 14;
                    texKey = this.textures.exists('stalker_south') ? 'stalker_south' : 'enemy_stalker';
                } else {
                    hp = 75; dmg = 22; spd = 48; size = 20; texKey = 'enemy_beast';
                }

                const tex = this.textures.exists(texKey) ? texKey : 'enemy_wisp';
                const e   = this.mazeEnemies.create(ex, ey, tex);
                e.setDepth(4).setAlpha(0.92);
                e.body.setAllowGravity(false).setSize(size * 1.6, size * 1.6);
                e.setData({ hp, maxHp: hp, dmg, spd, size, atkCd: 0,
                    wanderAngle: Math.random() * Math.PI * 2, wanderTimer: 0 });
            }
        }
    }

    // ----------------------------------------------------------
    // WEAPON SPRITE
    // ----------------------------------------------------------
    _updateWeaponSprite() {
        if (this._weaponSprite) { this._weaponSprite.destroy(); this._weaponSprite = null; }
        const weapon = WEAPONS[gameState.weapon];
        if (!weapon || !this.textures.exists('weapons_sheet')) return;
        this._weaponSprite = this.add.sprite(0, 0, 'weapons_sheet', weapon.spriteFrame || 0)
            .setDepth(5.1).setScale(0.65).setOrigin(0.2, 0.8);
    }

    _updateWeaponPos() {
        const ws = this._weaponSprite;
        if (!ws) return;
        const p = this.player;
        const facingAngle = Math.atan2(p.facing.y, p.facing.x);
        const BASE_ROT    = Math.PI / 4;
        const atkCd       = p.attackCooldown;
        const weapon      = WEAPONS[gameState.weapon];
        const maxCd       = weapon ? weapon.speed : 500;
        const phase       = atkCd > 0 ? (1 - atkCd / maxCd) : 0;

        let wx, wy, rot;
        if (atkCd > 0) {
            const sp  = phase < 0.4 ? phase / 0.4 : 1 - (phase - 0.4) / 0.6;
            const arc = (weapon?.arcDeg ?? 120) * Math.PI / 180;
            const ang = (sp - 0.5) * arc;
            const d   = 8 + 14 * Math.sin(sp * Math.PI);
            wx = p.x + Math.cos(facingAngle + ang * 0.5) * d;
            wy = p.y + Math.sin(facingAngle + ang * 0.5) * d;
            rot = facingAngle + BASE_ROT + ang;
        } else {
            const side = facingAngle - 0.6;
            wx = p.x + Math.cos(side) * 8;
            wy = p.y + Math.sin(side) * 8;
            rot = facingAngle + BASE_ROT;
        }
        ws.setPosition(wx, wy).setRotation(rot);
        ws.setDepth(p.facing.y >= 0 ? p.depth + 0.1 : p.depth - 0.1);
    }

    // ----------------------------------------------------------
    // TORCH LIGHT
    // ----------------------------------------------------------
    _initTorchLight(worldW, worldH) {
        this._lightW = worldW;
        this._lightH = worldH;
        // Canvas-based fog of war (same approach as overworld)
        this._fogCanvas = document.createElement('canvas');
        this._fogCanvas.width = this.scale.width;
        this._fogCanvas.height = this.scale.height;
        this._fogCtx = this._fogCanvas.getContext('2d');
        if (this.textures.exists('maze_fog')) this.textures.remove('maze_fog');
        this._fogTexture = this.textures.createCanvas('maze_fog', this.scale.width, this.scale.height);
        this._fogImage = this.add.image(0, 0, 'maze_fog').setDepth(80).setScrollFactor(0).setOrigin(0, 0);
        this._fogTimer = 0;

        this.scale.on('resize', (gameSize) => {
            this._fogCanvas.width = gameSize.width;
            this._fogCanvas.height = gameSize.height;
            if (this.textures.exists('maze_fog')) this.textures.remove('maze_fog');
            this._fogTexture = this.textures.createCanvas('maze_fog', gameSize.width, gameSize.height);
            this._fogImage.setTexture('maze_fog');
        });
    }

    _worldToScreen(wx, wy) {
        const cam = this.cameras.main;
        return { x: (wx - cam.scrollX) * cam.zoom, y: (wy - cam.scrollY) * cam.zoom };
    }

    _updateTorchLight() {
        // Throttle to ~20fps
        this._fogTimer += this.game.loop.delta;
        if (this._fogTimer < 50) return;
        this._fogTimer = 0;

        const ctx = this._fogCtx;
        const gameW = this.scale.width;
        const gameH = this.scale.height;
        if (this._fogCanvas.width !== gameW || this._fogCanvas.height !== gameH) {
            this._fogCanvas.width = gameW;
            this._fogCanvas.height = gameH;
        }

        const p = this.player;
        const r = this._torchRadius;
        const { x: px, y: py } = this._worldToScreen(p.x, p.y);

        // Fill with darkness
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(2, 1, 5, 0.97)';
        ctx.fillRect(0, 0, gameW, gameH);

        // Punch light hole with gradient (player is torch)
        ctx.globalCompositeOperation = 'destination-out';
        const flicker = 1.0 + Math.sin(this.time.now * 0.008) * 0.03 + Math.sin(this.time.now * 0.013) * 0.02;
        const fr = r * flicker;
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, fr);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(0.4, 'rgba(0,0,0,0.9)');
        gradient.addColorStop(0.7, 'rgba(0,0,0,0.4)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, fr, 0, Math.PI * 2);
        ctx.fill();

        // Wall torches — smaller light sources
        for (const torch of this._wallTorches) {
            const { x: tlx, y: tly } = this._worldToScreen(torch.x, torch.y);
            // Skip off-screen torches
            if (tlx < -100 || tlx > gameW + 100 || tly < -100 || tly > gameH + 100) continue;
            const tFlicker = 1.0 + Math.sin(this.time.now * 0.012 + torch.x) * 0.06;
            const tr = 65 * tFlicker;
            const tGrad = ctx.createRadialGradient(tlx, tly, 0, tlx, tly, tr);
            tGrad.addColorStop(0, 'rgba(0,0,0,0.9)');
            tGrad.addColorStop(0.5, 'rgba(0,0,0,0.4)');
            tGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = tGrad;
            ctx.beginPath();
            ctx.arc(tlx, tly, tr, 0, Math.PI * 2);
            ctx.fill();
        }

        // Warm color tint in lit area
        ctx.globalCompositeOperation = 'source-atop';
        const tg = ctx.createRadialGradient(px, py, 0, px, py, fr);
        tg.addColorStop(0, 'rgba(255, 140, 50, 0.15)');
        tg.addColorStop(0.5, 'rgba(255, 100, 30, 0.08)');
        tg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(px, py, fr, 0, Math.PI * 2);
        ctx.fill();

        // Warm tint for wall torches
        for (const torch of this._wallTorches) {
            const { x: tlx, y: tly } = this._worldToScreen(torch.x, torch.y);
            if (tlx < -100 || tlx > gameW + 100 || tly < -100 || tly > gameH + 100) continue;
            const tr = 65;
            const ttg = ctx.createRadialGradient(tlx, tly, 0, tlx, tly, tr);
            ttg.addColorStop(0, 'rgba(255, 120, 40, 0.18)');
            ttg.addColorStop(0.5, 'rgba(255, 80, 20, 0.08)');
            ttg.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = ttg;
            ctx.beginPath();
            ctx.arc(tlx, tly, tr, 0, Math.PI * 2);
            ctx.fill();
        }

        // Copy to Phaser texture
        this._fogTexture.context.clearRect(0, 0, gameW, gameH);
        this._fogTexture.context.drawImage(this._fogCanvas, 0, 0);
        this._fogTexture.refresh();
    }

    // ----------------------------------------------------------
    // UPDATE
    // ----------------------------------------------------------
    update(time, delta) {
        if (this._done) return;
        const dt = delta / 1000;
        const p  = this.player;

        // --- Movement ---
        const speed = CONFIG.PLAYER_SPEED;
        let vx = 0, vy = 0;
        if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -speed;
        else if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  speed;
        if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -speed;
        else if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  speed;
        if (vx && vy) { vx *= 0.707; vy *= 0.707; }

        // Mobile joystick
        if (typeof mobileControls !== 'undefined' && mobileControls.getMovement) {
            const mv = mobileControls.getMovement();
            if (mv && (mv.x || mv.y)) { vx = mv.x * speed; vy = mv.y * speed; }
        }

        p.setVelocity(vx, vy);
        // Don't interrupt attack animations
        const curKey = p.anims.currentAnim?.key || '';
        const isAttacking = curKey.startsWith('player_melee_') || curKey.startsWith('player_ranged_');
        if (isAttacking && p.anims.isPlaying) {
            // Let attack finish
        } else if (vx !== 0 || vy !== 0) {
            p.facing = { x: Math.sign(vx), y: Math.sign(vy) };
            if (this._hasPixelArtPlayer) {
                const dir = facingToDirection(p.facing.x, p.facing.y);
                const animKey = 'player_walk_' + dir;
                if (this.anims.exists(animKey)) {
                    if (curKey !== animKey) p.play(animKey);
                } else if (dir !== p._lastDir) {
                    p.setTexture(this._charPrefix + '_' + dir);
                }
                p._lastDir = dir;
                p.setFlipX(false);
            }
        } else if (this._hasPixelArtPlayer) {
            if (p.anims.isPlaying) p.anims.stop();
            p.setTexture(this._charPrefix + '_' + (p._lastDir || 'south'));
        }

        // Attack cooldown
        if (p.attackCooldown > 0) p.attackCooldown -= delta;

        // Keyboard attack (SPACE) + interact (E)
        if (Phaser.Input.Keyboard.JustDown(this._attackKey))   this._attack();
        if (Phaser.Input.Keyboard.JustDown(this._interactKey)) this._interact();

        // Mobile ATK / USE buttons
        if (typeof mobileControls !== 'undefined') {
            if (mobileControls.attackHeld  && p.attackCooldown <= 0) this._attack();
            if (mobileControls.interactHeld) this._interact();
        }

        // Auto-attack: face and attack nearest enemy in weapon range
        if (p.attackCooldown <= 0) {
            const weapon = WEAPONS[gameState.weapon] || { range: 52 };
            let nearest = null, nearestDist = Infinity;
            for (const e of this.mazeEnemies.children.entries) {
                if (!e.active) continue;
                const d = Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y);
                if (d < weapon.range + e.getData('size') && d < nearestDist) {
                    nearest = e; nearestDist = d;
                }
            }
            if (nearest) {
                const dx = nearest.x - p.x, dy = nearest.y - p.y;
                p.facing = {
                    x: Math.abs(dx) > Math.abs(dy) * 0.5 ? Math.sign(dx) : 0,
                    y: Math.abs(dy) > Math.abs(dx) * 0.5 ? Math.sign(dy) : 0,
                };
                if (this._hasPixelArtPlayer) {
                    const dir = facingToDirection(p.facing.x, p.facing.y);
                    if (dir !== p._lastDir) { p.setTexture(this._charPrefix + '_' + dir); p._lastDir = dir; p.setFlipX(false); }
                }
                this._attack();
            }
        }

        // Mouse / touch tap attack (ptr.isDown covers both mouse LMB and touch)
        const ptr = this.input.activePointer;
        if (ptr.isDown && !ptr.rightButtonDown() && p.attackCooldown <= 0) this._attack();
        if (ptr.isDown) {
            const wx = ptr.worldX, wy = ptr.worldY;
            const dx = wx - p.x, dy = wy - p.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4)
                p.facing = {
                    x: Math.abs(dx) > 0.3 * Math.sqrt(dx*dx+dy*dy) ? Math.sign(dx) : 0,
                    y: Math.abs(dy) > 0.3 * Math.sqrt(dx*dx+dy*dy) ? Math.sign(dy) : 0,
                };
        }

        // --- Enemy AI ---
        this._updateEnemies(dt);

        // --- Shadows (player is light source) ---
        this._shadowTimer += delta;
        if (this._shadowTimer > 66) { this._shadowTimer = 0; this._updateMazeShadows(); }

        // --- Visuals ---
        this._updateTorchLight();
        this._updateWeaponPos();
        this._drawEnemyHpBars();

        // --- Debug overlay (shared with overworld) ---
        drawEnemyDebug(this, this._debugGfx, this.mazeEnemies.children.entries, {});

        // --- Boss aura follows boss ---
        if (this._boss && this._boss.active && this._bossAura) {
            this._bossAura.setPosition(this._boss.x, this._boss.y);
        }

        // --- Boss spell attacks ---
        if (this._boss && this._boss.active) {
            let scd = this._boss.getData('spellCd') - dt * 1000;
            this._boss.setData('spellCd', scd);
            const bDist = Phaser.Math.Distance.Between(this._boss.x, this._boss.y, p.x, p.y);
            if (bDist < 200 && scd <= 0) {
                this._boss.setData('spellCd', 2500);
                this._bossSpellAttack();
            }
        }

        // --- Treasure hint ---
        const distT = Phaser.Math.Distance.Between(p.x, p.y, this.treasure.x, this.treasure.y);
        if (this._bossAlive) {
            this._treasureHint.setAlpha(distT < 80 ? 1 : 0);
        } else {
            this._treasureHint.setAlpha(distT < 58 ? 1 : 0);
        }

        // --- HUD ---
        gameState.hp = Math.max(0, gameState.hp);
        this._hudHp.setText(`♥ HP: ${Math.ceil(gameState.hp)} / ${CONFIG.PLAYER_MAX_HP}`);
        updateHealthBar();

        const ang  = Phaser.Math.Angle.Between(p.x, p.y, this.treasure.x, this.treasure.y);
        const arrs = ['→','↘','↓','↙','←','↖','↑','↗'];
        const aidx = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 8) % 8;
        this._hudCompass.setText(`Treasure: ${arrs[aidx]}  ${Math.round(distT / 32)}t`);
        this._hudKills.setText(`Slain: ${this._killCount}`);

        // Player death
        if (gameState.hp <= 0) this._playerDied();
    }

    // ----------------------------------------------------------
    // ENEMY AI
    // ----------------------------------------------------------
    _updateEnemies(dt) {
        const p   = this.player;
        const sig = this._torchRadius * 1.05; // sight = torch radius

        for (const e of this.mazeEnemies.children.entries) {
            if (!e.active) continue;

            let ecd = e.getData('atkCd') - dt * 1000;
            e.setData('atkCd', ecd);

            const dist = Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y);

            if (dist < sig) {
                // Chase player
                e.setData('wanderTimer', 0);
                const angle = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
                const spd   = e.getData('spd');
                e.setVelocity(Math.cos(angle) * spd, Math.sin(angle) * spd);
                e.setFlipX(p.x < e.x);
                e.setData('aiState', dist < 16 ? 'ATK PLAYER' : 'CHASE');

                // Melee attack
                if (dist < CONFIG.ENEMY_MELEE_RANGE && ecd <= 0) {
                    e.setData('atkCd', 1100);
                    const dmg = damagePlayerShared(this, e.getData('dmg'));
                    this.cameras.main.flash(120, 80, 0, 0);
                    showFloatingText(this, p.x, p.y - 20, `-${dmg}`, '#FF4444');
                }
            } else {
                // Wander inside room
                e.setData('aiState', 'WANDER');
                let wt = (e.getData('wanderTimer') || 0) - dt;
                if (wt <= 0) {
                    e.setData('wanderAngle', Math.random() * Math.PI * 2);
                    wt = 1.5 + Math.random() * 2;
                }
                e.setData('wanderTimer', wt);
                const wa  = e.getData('wanderAngle');
                const spd = e.getData('spd') * 0.35;
                e.setVelocity(Math.cos(wa) * spd, Math.sin(wa) * spd);
            }
        }
    }

    _updateMazeShadows() {
        const g = this._shadowGfx;
        if (!g) return;
        g.clear();
        const p = this.player;
        const lightX = p.x, lightY = p.y;
        const TORCH_R = 145; // matches torch light radius

        const cam = this.cameras.main;
        const m = 80;
        const cl = cam.scrollX - m, cr = cam.scrollX + cam.width + m;
        const ct = cam.scrollY - m, cb = cam.scrollY + cam.height + m;

        const drawShadow = (baseX, baseY, objW, objH) => {
            if (baseX < cl || baseX > cr || baseY < ct || baseY > cb) return;
            const dx = baseX - lightX, dy = baseY - lightY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 4 || dist > TORCH_R) return;
            const angle = Math.atan2(dy, dx);
            const shadowLen = Math.min(objH * 1.0, objH * 300 / dist);
            const cx = baseX + Math.cos(angle) * shadowLen * 0.5;
            const cy = baseY + Math.sin(angle) * shadowLen * 0.5;
            const alpha = Math.max(0.04, 0.35 * (1 - dist / TORCH_R));
            const halfW = objW * 0.3, halfH = shadowLen * 0.5;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const pts = [];
            for (let i = 0; i < 12; i++) {
                const t = (i / 12) * Math.PI * 2;
                const ex = Math.cos(t) * halfW, ey = Math.sin(t) * halfH;
                pts.push(cx + ex * -sin + ey * cos, cy + ex * cos + ey * sin);
            }
            g.fillStyle(0x000000, alpha);
            g.beginPath();
            g.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
            g.closePath();
            g.fillPath();
        };

        // Enemies cast shadows from the player's torch light
        for (const e of this.mazeEnemies.children.entries) {
            if (!e.active) continue;
            const sz = e.getData('size') || 14;
            drawShadow(e.x, e.y + sz * 0.3, sz * 1.2, sz * 1.5);
        }
    }

    _drawEnemyHpBars() {
        const g = this._hpGfx;
        g.clear();
        const p   = this.player;
        const vis = this._torchRadius * 1.1;

        for (const e of this.mazeEnemies.children.entries) {
            if (!e.active) continue;
            if (Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y) > vis) continue;
            const hp = e.getData('hp'), mhp = e.getData('maxHp');
            const bw = 22, bh = 3;
            const bx = e.x - bw / 2, by = e.y - e.getData('size') - 8;
            g.fillStyle(0x330000, 1); g.fillRect(bx, by, bw, bh);
            g.fillStyle(0xCC2222, 1); g.fillRect(bx, by, bw * (hp / mhp), bh);
        }
    }

    // ----------------------------------------------------------
    // ATTACK
    // ----------------------------------------------------------
    _attack() {
        const p = this.player;
        if (p.attackCooldown > 0) return;

        const weapon = WEAPONS[gameState.weapon] || { damage: 18, range: 52, speed: 500, arcDeg: 120 };
        p.attackCooldown = weapon.speed;

        // Play attack animation
        if (this._hasPixelArtPlayer) {
            const dir = facingToDirection(p.facing.x, p.facing.y);
            const atkType = weapon.attackType || 'swing';
            const atkKey = atkType === 'shoot' ? 'player_ranged_' + dir : 'player_melee_' + dir;
            if (this.anims.exists(atkKey)) {
                p.play(atkKey);
                p.once('animationcomplete', () => {
                    p.setTexture(this._charPrefix + '_' + dir);
                    p._lastDir = dir;
                });
            }
        }

        const facingAngle = Math.atan2(p.facing.y, p.facing.x);
        const arcRad      = (weapon.arcDeg ?? 120) * Math.PI / 180;
        const ax = p.x + p.facing.x * weapon.range;
        const ay = p.y + p.facing.y * weapon.range;

        // Slash visual
        const sl = this.add.image(ax, ay, 'slash')
            .setDepth(4910).setAlpha(0.85).setScale(weapon.range / 50).setBlendMode('ADD')
            .setRotation(facingAngle);
        this.tweens.add({ targets: sl, alpha: 0, scale: weapon.range / 30, duration: 200,
            onComplete: () => sl.destroy() });

        // Arc hit check
        const inArc = (tx, ty) => {
            if (arcRad >= Math.PI * 2 - 0.01) return true;
            return Math.abs(Phaser.Math.Angle.Wrap(
                Math.atan2(ty - p.y, tx - p.x) - facingAngle)) <= arcRad / 2;
        };

        for (const e of [...this.mazeEnemies.children.entries]) {
            if (!e.active) continue;
            if (Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) < weapon.range + e.getData('size')
                && inArc(e.x, e.y)) {
                let dmg = weapon.damage;
                if (weapon.shadowBonus) dmg = Math.floor(dmg * weapon.shadowBonus);
                this._damageEnemy(e, dmg);
            }
        }

        if (typeof audioEngine !== 'undefined') audioEngine.playAttack?.();
    }

    _damageEnemy(e, amount) {
        let hp = e.getData('hp') - amount;
        e.setData('hp', hp);
        showFloatingText(this, e.x, e.y - 16, `-${amount}`, '#FF6644');
        this.tweens.add({ targets: e, alpha: 0.15, duration: 60, yoyo: true,
            onComplete: () => { if (e.active) e.setAlpha(0.92); } });

        if (hp <= 0) {
            this._killCount++;
            const gold = 1 + Math.floor(Math.random() * 3);
            gameState.resources.gold = (gameState.resources.gold || 0) + gold;
            showFloatingText(this, e.x, e.y - 30, `+${gold} gold`, '#FFD700');

            // Boss death — unlock treasure
            if (e === this._boss) {
                this._onBossDeath(e);
            }
            e.destroy();
        }
    }

    _onBossDeath(boss) {
        this._bossAlive = false;
        if (this._bossAura) { this._bossAura.destroy(); this._bossAura = null; }

        // Dramatic death effect
        this.cameras.main.flash(600, 100, 0, 200);
        this.cameras.main.shake(400, 0.02);
        showFloatingText(this, boss.x, boss.y - 50, 'THE DARKNESS LORD IS SLAIN!', '#CC44FF');

        // Death explosion particles
        this.add.particles(boss.x, boss.y, 'particle', {
            speed: { min: 40, max: 120 },
            angle: { min: 0, max: 360 },
            lifespan: { min: 600, max: 1200 },
            scale: { start: 1.0, end: 0 },
            alpha: { start: 0.9, end: 0 },
            tint: [0x8800FF, 0xAA44FF, 0x6600CC, 0xFF00FF],
            blendMode: 'ADD',
            quantity: 30,
            emitting: false,
        }).explode(30);

        // Unlock treasure — make it bright and golden
        this.treasure.setAlpha(1);
        this.tweens.add({ targets: this.treasure, scaleX: 1.3, scaleY: 1.3, duration: 900, yoyo: true, repeat: -1 });
        if (this._chestGlow) {
            this._chestGlow.setTint(0xFFAA00);
            this._chestGlow.setAlpha(0.55);
            this._chestGlow.setScale(2.8);
        }
        this._treasureHint.setText('[E] Open the Chest');
        this._treasureHint.setFill('#FFD700');
    }

    _bossSpellAttack() {
        const boss = this._boss;
        if (!boss || !boss.active) return;
        const p = this.player;
        const angle = Phaser.Math.Angle.Between(boss.x, boss.y, p.x, p.y);

        // Dark orb barrage — 3 slow orbs with trailing sparks
        const spread = 0.35;
        for (let i = -1; i <= 1; i++) {
            const a = angle + i * spread;
            const orb = this.add.image(boss.x, boss.y, 'proj_magic').setDepth(10).setScale(2).setBlendMode('ADD').setTint(0xAA44FF);
            // Outer glow ring around orb
            const orbGlow = this.add.image(boss.x, boss.y, 'glow')
                .setDepth(9).setScale(1.8).setAlpha(0.4).setTint(0x8800FF).setBlendMode('ADD');
            // Trailing spark particles
            const trail = this.add.particles(boss.x, boss.y, 'particle', {
                speed: { min: 10, max: 30 },
                lifespan: { min: 200, max: 500 },
                scale: { start: 0.5, end: 0 },
                alpha: { start: 0.8, end: 0 },
                tint: [0xAA44FF, 0xDD88FF, 0x6600CC, 0xFF66FF],
                blendMode: 'ADD',
                frequency: 30,
                quantity: 2,
            }).setDepth(9);

            const tx = boss.x + Math.cos(a) * 220;
            const ty = boss.y + Math.sin(a) * 220;
            let hit = false;
            this.tweens.add({
                targets: orb, x: tx, y: ty, alpha: 0.5, duration: 1200, // slow travel
                onUpdate: () => {
                    if (hit) return;
                    orbGlow.setPosition(orb.x, orb.y);
                    trail.setPosition(orb.x, orb.y);
                    const d = Phaser.Math.Distance.Between(orb.x, orb.y, p.x, p.y);
                    if (d < 18) {
                        hit = true;
                        const dmg = damagePlayerShared(this, 15);
                        showFloatingText(this, p.x, p.y - 20, `-${dmg}`, '#BB44FF');
                        this.cameras.main.flash(120, 80, 0, 100);
                        // Hit explosion
                        this.add.particles(orb.x, orb.y, 'particle', {
                            speed: { min: 30, max: 80 }, lifespan: 400,
                            scale: { start: 0.6, end: 0 }, alpha: { start: 1, end: 0 },
                            tint: [0xFF44FF, 0xAA00FF], blendMode: 'ADD',
                            quantity: 12, emitting: false,
                        }).explode(12);
                        orb.destroy(); orbGlow.destroy(); trail.destroy();
                    }
                },
                onComplete: () => {
                    if (hit) return;
                    // Impact on ground
                    const imp = this.add.image(orb.x, orb.y, 'glow')
                        .setDepth(10).setScale(2).setAlpha(0.7).setTint(0xAA44FF).setBlendMode('ADD');
                    this.tweens.add({ targets: imp, scale: 4, alpha: 0, duration: 400, onComplete: () => imp.destroy() });
                    orb.destroy(); orbGlow.destroy(); trail.destroy();
                },
            });
        }

        // Boss cast visual — dark energy pulse
        const castPulse = this.add.image(boss.x, boss.y, 'glow')
            .setDepth(8).setScale(2).setAlpha(0.5).setTint(0x6600AA).setBlendMode('ADD');
        this.tweens.add({ targets: castPulse, scale: 5, alpha: 0, duration: 500, onComplete: () => castPulse.destroy() });
        this.tweens.add({ targets: boss, alpha: 0.4, duration: 100, yoyo: true, repeat: 2 });
    }

    // _floatText removed — use shared showFloatingText(scene, x, y, msg, color)

    // ----------------------------------------------------------
    // INTERACT  (treasure)
    // ----------------------------------------------------------
    _interact() {
        if (this._done) return;
        const d = Phaser.Math.Distance.Between(
            this.player.x, this.player.y, this.treasure.x, this.treasure.y);
        if (d < 58) {
            if (this._bossAlive) {
                showFloatingText(this, this.treasure.x, this.treasure.y - 40, 'Defeat the Darkness Lord first!', '#FF4444');
            } else {
                this._collectTreasure();
            }
        }
    }

    // ----------------------------------------------------------
    // PLAYER DEATH
    // ----------------------------------------------------------
    _playerDied() {
        if (this._done) return;
        this._done = true;
        this.player.setVelocity(0, 0);
        if (typeof mobileControls !== 'undefined') mobileControls.hide();
        this.cameras.main.flash(400, 80, 0, 0);
        this.time.delayedCall(600, () => {
            const goScreen = document.getElementById('game-over-screen');
            goScreen.querySelector('h1').textContent = 'FALLEN IN THE DEPTHS';
            goScreen.querySelector('h1').style.color = '#FF4444';
            document.getElementById('game-over-stats').textContent =
                `You slew ${this._killCount} creatures before the darkness claimed you.`;
            goScreen.style.display = 'flex';
        });
    }

    // ----------------------------------------------------------
    // TREASURE
    // ----------------------------------------------------------
    _collectTreasure() {
        this._done = true;
        this.player.setVelocity(0, 0);
        if (typeof mobileControls !== 'undefined') mobileControls.hide();
        this.treasure.destroy();
        this._treasureHint.destroy();

        this.cameras.main.flash(1400, 255, 210, 60);
        this.cameras.main.shake(700, 0.012);

        const cx = this.cameras.main.width  / 2;
        const cy = this.cameras.main.height / 2;

        const lines = [
            { y: cy - 70, text: '✨  THE ARTIFACT IS YOURS  ✨',      color: '#FFD700', size: '20px' },
            { y: cy - 30, text: 'Deep beneath the ruined lair,',       color: '#FFEEAA', size: '12px' },
            { y: cy - 12, text: 'you have claimed what the darkness',   color: '#FFEEAA', size: '12px' },
            { y: cy +  6, text: 'sought to bury forever.',             color: '#FFEEAA', size: '12px' },
            { y: cy + 32, text: `${this._killCount} creatures slain · The light endures.`, color: '#CC88FF', size: '10px' },
            { y: cy + 56, text: 'G A M E   C O M P L E T E',         color: '#88CCFF', size: '14px' },
        ];

        const texts = lines.map(l => this.add.text(cx, l.y, l.text, {
            fontSize: l.size, fill: l.color, fontFamily: 'monospace',
            stroke: '#000000', strokeThickness: 4, align: 'center',
        }).setOrigin(0.5).setDepth(200).setScrollFactor(0).setAlpha(0));

        this.tweens.add({ targets: texts, alpha: 1, duration: 1000, ease: 'Power2' });

        this.time.delayedCall(3800, () => {
            gameState.gameOver = true;
            const gs = document.getElementById('game-over-screen');
            gs.querySelector('h1').textContent = '✨  VICTORY  ✨';
            gs.querySelector('h1').style.color = '#FFD700';
            document.getElementById('game-over-stats').textContent =
                `The Ancient Artifact is yours.\n` +
                `${this._killCount} creatures slain · Survived ${Math.floor(gameState.time)}s`;
            gs.style.display = 'flex';
            if (typeof audioEngine !== 'undefined') {
                audioEngine.stopLoop?.('music_lvl2', 500);
                audioEngine.stopLoop?.('music', 500);
                audioEngine.stopLoop?.('ambient', 500);
            }
        });
    }
}
