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
        window._currentScene = 'MazeScene';

        // Level sync handler for maze
        if (typeof network !== 'undefined') {
            network.onLevelChange = (sceneName) => {
                if (sceneName === 'GameScene' && window._currentScene !== 'GameScene') {
                    if (typeof audioEngine !== 'undefined') audioEngine.stopLoop?.('music_lvl2', 400);
                    this.scene.start('GameScene');
                }
            };
            // Boss death sync
            network.onFullSync = (msg) => {
                if (msg.bossDefeated && this._bossAlive && this._boss) {
                    this._bossAlive = false;
                    if (this._boss.active) this._boss.destroy();
                    if (this._bossAura) { this._bossAura.destroy(); this._bossAura = null; }
                    this.treasure.setAlpha(1);
                    if (this._chestGlow) { this._chestGlow.setTint(0xFFAA00); this._chestGlow.setAlpha(0.55); }
                    this._treasureHint.setText('[E] Open the Chest');
                    this._treasureHint.setFill('#FFD700');
                }
                if (msg.treasureCollected && !this._done) {
                    this._collectTreasure();
                }
            };
        }

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
            // Simple tile rendering: floor tile for walkable, wall tile for walls
            // Wang transitions only on border tiles for clean edges aligned with colliders
            const WANG_TO_FRAME = [6,7,10,9,2,11,4,15,5,14,1,8,3,0,13,12];
            const FLOOR_FRAME = 6;  // all-lower = pure floor
            const WALL_FRAME = 12;  // all-upper = pure wall
            const isWall = (gx, gy) => gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H || grid[gy][gx] === 0;

            const rt = this.add.renderTexture(0, 0, worldW, worldH).setOrigin(0, 0).setDepth(0);
            for (let gy = 0; gy < GRID_H; gy++) {
                for (let gx = 0; gx < GRID_W; gx++) {
                    if (grid[gy][gx] === 0 && !this._bordersFloor(grid, gx, gy, GRID_W, GRID_H)) continue;

                    if (grid[gy][gx] === 1) {
                        // Floor tile — check if near a wall for transition
                        const touchesWall = isWall(gx-1,gy) || isWall(gx+1,gy) || isWall(gx,gy-1) || isWall(gx,gy+1);
                        if (touchesWall) {
                            // Use Wang transition: sample neighboring tiles as corners
                            const nw = isWall(gx-1, gy-1) || isWall(gx-1, gy) || isWall(gx, gy-1) ? 1 : 0;
                            const ne = isWall(gx+1, gy-1) || isWall(gx+1, gy) || isWall(gx, gy-1) ? 1 : 0;
                            const sw = isWall(gx-1, gy+1) || isWall(gx-1, gy) || isWall(gx, gy+1) ? 1 : 0;
                            const se = isWall(gx+1, gy+1) || isWall(gx+1, gy) || isWall(gx, gy+1) ? 1 : 0;
                            const wangIdx = nw * 8 + ne * 4 + sw * 2 + se;
                            if (wangIdx === 15) {
                                rt.drawFrame('dungeon_tileset', FLOOR_FRAME, gx * TILE, gy * TILE);
                            } else {
                                rt.drawFrame('dungeon_tileset', WANG_TO_FRAME[wangIdx], gx * TILE, gy * TILE);
                            }
                        } else {
                            rt.drawFrame('dungeon_tileset', FLOOR_FRAME, gx * TILE, gy * TILE);
                        }
                    } else {
                        // Wall tile (only visible ones near floor)
                        rt.drawFrame('dungeon_tileset', WALL_FRAME, gx * TILE, gy * TILE);
                    }
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
                    w.setDepth(2);
                    if (hasDungeonTileset) {
                        // Expand wall body to cover transition tiles — prevents player overlapping walls
                        w.body.setSize(TILE + 8, TILE + 8);
                        w.body.setOffset(-4, -4);
                        w.setAlpha(0);
                    }
                    w.refreshBody();
                }
            }
        }

        // --- Build walk grid for A* pathfinding ---
        this._walkGrid = new Uint8Array(GRID_W * GRID_H);
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                this._walkGrid[gy * GRID_W + gx] = grid[gy][gx]; // 1=floor, 0=wall
            }
        }
        this._gridW = GRID_W;
        this._gridH = GRID_H;
        this._TILE = TILE;

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

        // --- Collectible torches (increase light radius significantly) ---
        this._torchPickups = [];
        this._torchCount = 0;
        // Use torch_item texture (not dungeon_torch which is wall-mounted)
        const pickupTex = this.textures.exists('torch_item') ? 'torch_item' : 'dungeon_torch';
        for (let i = 1; i < rooms.length - 1; i++) { // skip boss room only
            if (Math.random() < 0.6) { // ~60% of rooms have a torch
                const rm = rooms[i];
                // Place in center area of room (avoid walls)
                const tx = (rm.x + 2 + Math.floor(Math.random() * Math.max(1, rm.w - 4))) * TILE + 16;
                const ty = (rm.y + 2 + Math.floor(Math.random() * Math.max(1, rm.h - 4))) * TILE + 16;
                const pickup = this.add.image(tx, ty, pickupTex).setDepth(3).setScale(1.2);
                // Bright pulsing glow — clearly different from wall torches
                const glow = this.add.image(tx, ty, 'glow')
                    .setDepth(2).setScale(2.5).setAlpha(0.4).setTint(0xFFDD00).setBlendMode('ADD');
                this.tweens.add({ targets: glow, scale: 3, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
                // Bobbing animation to show it's collectible
                this.tweens.add({ targets: pickup, y: ty - 4, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
                const hint = this.add.text(tx, ty - 22, '[ PICK UP ]', {
                    fontSize: '7px', fill: '#FFDD00', fontFamily: 'monospace',
                    stroke: '#000', strokeThickness: 2,
                }).setOrigin(0.5).setDepth(3).setAlpha(0);
                this._torchPickups.push({ sprite: pickup, glow, hint, x: tx, y: ty, collected: false });
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
            if (typeof network !== 'undefined' && network.peerCount > 0) {
                network.broadcastReliable({ t: 'lv', scene: 'GameScene' });
            }
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

        // --- Heart pickups on ground ---
        this.children.each(child => {
            if (!child.active || !child._isHeart) return;
            const d = Phaser.Math.Distance.Between(p.x, p.y, child.x, child.y);
            if (d < 40) {
                gameState.hp = Math.min(CONFIG.PLAYER_MAX_HP, gameState.hp + 20);
                showFloatingText(this, child.x, child.y - 20, '+20 HP', '#FF4488');
                updateHealthBar();
                child.destroy();
            }
        });

        // --- Torch pickups (auto-collect when near) ---
        for (const tp of this._torchPickups) {
            if (tp.collected) continue;
            const d = Phaser.Math.Distance.Between(p.x, p.y, tp.x, tp.y);
            // Show hint when close
            if (tp.hint) tp.hint.setAlpha(d < 60 ? 0.9 : 0);
            if (d < 40) {
                tp.collected = true;
                tp.sprite.destroy();
                tp.glow.destroy();
                if (tp.hint) tp.hint.destroy();
                this._torchCount++;
                this._torchRadius += 40;
                showFloatingText(this, p.x, p.y - 30,
                    `TORCH #${this._torchCount}  Light +40`, '#FFDD00');
                this.cameras.main.flash(250, 100, 70, 0);
                // Pickup burst
                this.add.particles(tp.x, tp.y, 'particle', {
                    speed: { min: 20, max: 60 }, lifespan: 500,
                    scale: { start: 0.5, end: 0 }, alpha: { start: 1, end: 0 },
                    tint: [0xFFDD00, 0xFFAA00], blendMode: 'ADD',
                    quantity: 10, emitting: false,
                }).explode(10);
            }
        }

        // --- Visuals ---
        this._updateTorchLight();
        this._updateWeaponPos();
        this._drawEnemyHpBars();

        // --- Debug overlay (shared with overworld) ---
        drawEnemyDebug(this, this._debugGfx, this.mazeEnemies.children.entries, {
            walkGrid: this._walkGrid,
            gridSize: this._gridW,
        });

        // --- Boss aura follows boss ---
        if (this._boss && this._boss.active && this._bossAura) {
            this._bossAura.setPosition(this._boss.x, this._boss.y);
        }

        // --- Boss AI (Groq-driven decisions) ---
        if (this._boss && this._boss.active && !this._bossCharging) {
            this._bossAITimer = (this._bossAITimer || 0) + dt * 1000;
            let scd = this._boss.getData('spellCd') - dt * 1000;
            this._boss.setData('spellCd', scd);

            // Query Groq every 5 seconds for strategic decisions
            if (this._bossAITimer >= 5000 && typeof bossAI !== 'undefined') {
                this._bossAITimer = 0;
                bossAI.query(this._boss, this).then(plan => {
                    if (!plan || !this._boss?.active) return;
                    this._executeBossPlan(plan.steps);
                });
            }

            // Fallback: if no Groq plan active, use simple AI
            if (!this._bossCurrentStep && scd <= 0) {
                const bDist = Phaser.Math.Distance.Between(this._boss.x, this._boss.y, p.x, p.y);
                if (bDist < 200) {
                    this._bossSpellCount = (this._bossSpellCount || 0) + 1;
                    if (this._bossSpellCount % 4 === 0) {
                        this._boss.setData('spellCd', 8000);
                        this._bossUltimate();
                    } else {
                        this._boss.setData('spellCd', 2500);
                        this._bossSpellAttack();
                    }
                }
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
    // A* pathfinding for maze enemies
    _mazePathTo(enemy, tx, ty, speed) {
        let path = enemy.getData('_aiPath');
        let pathIdx = enemy.getData('_aiPathIdx') || 0;
        let repathTimer = (enemy.getData('_aiRepathTimer') || 0) - 0.2;

        if (!path || pathIdx >= path.length || repathTimer <= 0) {
            path = findPathAStar(this._walkGrid, this._gridW, this._TILE, enemy.x, enemy.y, tx, ty);
            if (path && path.length > 0) {
                enemy.setData('_aiPath', path);
                enemy.setData('_aiPathIdx', 0);
                pathIdx = 0;
            } else {
                // Fallback: direct
                const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, tx, ty);
                enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
                return;
            }
            repathTimer = 0.8 + Math.random() * 0.4;
        }
        enemy.setData('_aiRepathTimer', repathTimer);

        if (path && pathIdx < path.length) {
            const wp = path[pathIdx];
            const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, wp.x, wp.y);
            if (dist < 16) {
                pathIdx++;
                enemy.setData('_aiPathIdx', pathIdx);
            }
            if (pathIdx < path.length) {
                const wp2 = path[pathIdx];
                const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, wp2.x, wp2.y);
                enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
            }
        }
    }

    _updateEnemies(dt) {
        const p   = this.player;
        const sig = this._torchRadius * 1.2; // sight slightly beyond torch

        for (const e of this.mazeEnemies.children.entries) {
            if (!e.active) continue;
            // Skip boss during charging
            if (e === this._boss && this._bossCharging) continue;

            let ecd = e.getData('atkCd') - dt * 1000;
            e.setData('atkCd', ecd);

            const dist = Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y);
            const spd = e.getData('spd');

            if (dist < sig) {
                e.setData('wanderTimer', 0);
                e.setFlipX(p.x < e.x);

                if (dist < CONFIG.ENEMY_MELEE_RANGE) {
                    // In melee range — stop and attack
                    e.setVelocity(0, 0);
                    e.setData('aiState', 'ATK PLAYER');
                    if (ecd <= 0) {
                        e.setData('atkCd', 1100);
                        const dmg = damagePlayerShared(this, e.getData('dmg'));
                        this.cameras.main.flash(120, 80, 0, 0);
                        showFloatingText(this, p.x, p.y - 20, `-${dmg}`, '#FF4444');
                    }
                } else {
                    // Chase with A* pathfinding
                    e.setData('aiState', 'CHASE');
                    this._mazePathTo(e, p.x, p.y, spd);
                }
            } else {
                // Wander
                e.setData('aiState', 'WANDER');
                e.setData('_aiPath', null);
                let wt = (e.getData('wanderTimer') || 0) - dt;
                if (wt <= 0) {
                    e.setData('wanderAngle', Math.random() * Math.PI * 2);
                    wt = 1.5 + Math.random() * 2;
                }
                e.setData('wanderTimer', wt);
                const wa = e.getData('wanderAngle');
                e.setVelocity(Math.cos(wa) * spd * 0.35, Math.sin(wa) * spd * 0.35);
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

            // Big enemies (beast-size or larger) drop hearts
            const size = e.getData('size') || 0;
            if (size >= 20 && this.textures.exists('heart_drop')) {
                const heart = this.add.image(e.x, e.y, 'heart_drop').setDepth(3);
                heart._isHeart = true;
                // Pulsing glow
                this.tweens.add({ targets: heart, scaleX: 1.3, scaleY: 1.3, duration: 500, yoyo: true, repeat: 5 });
                // Auto-pickup after 0.5s delay
                this.time.delayedCall(500, () => {
                    if (!heart.active) return;
                    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, heart.x, heart.y);
                    if (d < 80) {
                        gameState.hp = Math.min(CONFIG.PLAYER_MAX_HP, gameState.hp + 20);
                        showFloatingText(this, heart.x, heart.y - 20, '+20 HP', '#FF4488');
                        updateHealthBar();
                        heart.destroy();
                    } else {
                        // Leave on ground for pickup later
                        this.time.delayedCall(10000, () => { if (heart.active) heart.destroy(); });
                    }
                });
            }

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

        // Broadcast boss death to all peers
        if (typeof network !== 'undefined' && network.peerCount > 0) {
            network.broadcastReliable({ t: 'fs', bossDefeated: true });
        }

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

    _executeBossPlan(steps) {
        if (!steps || !steps.length || !this._boss?.active) return;
        const boss = this._boss;
        const T = this._TILE;
        let delay = 0;

        for (const step of steps.slice(0, 4)) {
            this.time.delayedCall(delay, () => {
                if (!boss.active || this._bossCharging) return;
                const action = step.action;

                if (action === 'MOVE_TO' || action === 'AMBUSH' || action === 'FLEE') {
                    const tx = (step.tx || 0) * T + T / 2;
                    const ty = (step.ty || 0) * T + T / 2;
                    this._mazePathTo(boss, tx, ty, boss.getData('spd'));
                    boss.setData('aiState', action);
                    if (action === 'AMBUSH') {
                        boss.setAlpha(0.4); // semi-invisible
                        this.time.delayedCall(3000, () => { if (boss.active) boss.setAlpha(1); });
                    }
                } else if (action === 'ATTACK_PLAYER') {
                    boss.setData('aiState', 'ATK PLAYER');
                    if (boss.getData('spellCd') <= 0) {
                        boss.setData('spellCd', 2500);
                        this._bossSpellAttack();
                    }
                } else if (action === 'ULTIMATE') {
                    boss.setData('aiState', 'ULTIMATE');
                    if (boss.getData('spellCd') <= 0) {
                        boss.setData('spellCd', 8000);
                        this._bossUltimate();
                    }
                } else if (action === 'SUMMON_MINIONS') {
                    boss.setData('aiState', 'SUMMON');
                    const count = Math.min(step.count || 2, 4);
                    this._bossSummonMinions(count);
                } else if (action === 'GUARD_TREASURE') {
                    boss.setData('aiState', 'GUARD');
                    this._mazePathTo(boss, this.treasure.x, this.treasure.y - 40, boss.getData('spd'));
                } else if (action === 'TAUNT' && step.message) {
                    boss.setData('aiState', 'TAUNT');
                    showFloatingText(this, boss.x, boss.y - 50, step.message, '#CC44FF');
                } else if (action === 'WAIT') {
                    boss.setData('aiState', 'WAIT');
                    boss.setVelocity(0, 0);
                }
            });
            delay += 1500; // space out actions
        }
    }

    _bossSummonMinions(count) {
        const boss = this._boss;
        if (!boss || !boss.active) return;

        // Costs HP
        const hpCost = count * 10;
        let hp = boss.getData('hp');
        if (hp <= hpCost + 10) return; // don't suicide
        boss.setData('hp', hp - hpCost);
        showFloatingText(this, boss.x, boss.y - 40, `SUMMONING ${count} SHADOWS`, '#AA00FF');

        // Summoning visual
        this.cameras.main.shake(200, 0.01);
        const summonPulse = this.add.image(boss.x, boss.y, 'glow')
            .setDepth(8).setScale(3).setAlpha(0.4).setTint(0x8800FF).setBlendMode('ADD');
        this.tweens.add({ targets: summonPulse, scale: 6, alpha: 0, duration: 800, onComplete: () => summonPulse.destroy() });

        // Spawn minions around boss
        const TILE = this._TILE;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const sx = boss.x + Math.cos(angle) * 50;
            const sy = boss.y + Math.sin(angle) * 50;
            const texKey = this.textures.exists('stalker_south') ? 'stalker_south' : 'enemy_stalker';
            const e = this.mazeEnemies.create(sx, sy, texKey);
            e.setDepth(4).setAlpha(0);
            e.setData('hp', 30); e.setData('maxHp', 30);
            e.setData('dmg', 8); e.setData('spd', 70);
            e.setData('size', 14); e.setData('atkCd', 0);
            e.setData('type', 'SUMMONED');
            e.setData('aiState', 'CHASE');
            e.setData('wanderAngle', 0); e.setData('wanderTimer', 0);
            e.body.setSize(20, 20);
            // Fade in
            this.tweens.add({ targets: e, alpha: 0.92, duration: 500, delay: i * 200 });
            // Spawn particles
            this.add.particles(sx, sy, 'particle', {
                speed: { min: 20, max: 50 }, lifespan: 400,
                scale: { start: 0.5, end: 0 }, tint: [0x8800FF, 0xAA44FF],
                blendMode: 'ADD', quantity: 8, emitting: false,
            }).explode(8);
        }
    }

    _bossUltimate() {
        const boss = this._boss;
        if (!boss || !boss.active) return;
        this._bossCharging = true;
        boss.setVelocity(0, 0); // stop moving during charge

        // Warning text
        const warn = this.add.text(boss.x, boss.y - 60, '⚡ CHARGING ⚡', {
            fontSize: '12px', fill: '#FF2222', fontFamily: 'monospace',
            stroke: '#000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(100);
        this.tweens.add({ targets: warn, alpha: 0.3, duration: 300, yoyo: true, repeat: 8 });

        // Phase 1: Red particles fly INTO the boss for 3 seconds
        const chargeEmitter = this.add.particles(boss.x, boss.y, 'particle', {
            speed: { min: 80, max: 160 },
            lifespan: { min: 600, max: 1000 },
            scale: { start: 0, end: 1.0 },
            alpha: { start: 0, end: 0.9 },
            tint: [0xFF0000, 0xFF2200, 0xCC0000, 0xFF4400],
            blendMode: 'ADD',
            frequency: 25,
            quantity: 3,
            // Particles move INWARD — use moveToX/Y
            moveToX: boss.x,
            moveToY: boss.y,
            emitZone: {
                source: new Phaser.Geom.Circle(0, 0, 120),
                type: 'random',
            },
        }).setDepth(8);

        // Growing dark aura during charge
        const chargeAura = this.add.image(boss.x, boss.y, 'glow')
            .setDepth(7).setScale(2).setAlpha(0.2).setTint(0xFF0000).setBlendMode('ADD');
        this.tweens.add({
            targets: chargeAura, scale: 8, alpha: 0.5,
            duration: 3000, ease: 'Quad.easeIn',
        });

        // Boss pulses red during charge
        this.tweens.add({
            targets: boss, alpha: 0.3, duration: 200,
            yoyo: true, repeat: 14,
        });

        // Screen shake during charge
        this.cameras.main.shake(3000, 0.005);

        // Phase 2: After 3 seconds — EXPLODE
        this.time.delayedCall(3000, () => {
            if (!boss.active) { this._bossCharging = false; return; }
            this._bossCharging = false;
            warn.destroy();
            chargeEmitter.destroy();
            chargeAura.destroy();

            // Nova explosion — damage everything within radius
            const novaRadius = 130;
            const p = this.player;
            const dist = Phaser.Math.Distance.Between(boss.x, boss.y, p.x, p.y);

            // Massive screen flash
            this.cameras.main.flash(400, 200, 30, 30);
            this.cameras.main.shake(300, 0.03);

            // Visual: expanding ring of destruction
            for (let ring = 0; ring < 3; ring++) {
                const delay = ring * 100;
                this.time.delayedCall(delay, () => {
                    const circle = this.add.graphics().setDepth(10);
                    const r0 = 10 + ring * 20;
                    circle.lineStyle(4, 0xFF0000, 0.8);
                    circle.strokeCircle(boss.x, boss.y, r0);
                    this.tweens.add({
                        targets: circle, alpha: 0, duration: 500,
                        onUpdate: () => {
                            circle.clear();
                            const expand = r0 + (novaRadius - r0) * (1 - circle.alpha);
                            circle.lineStyle(3 - ring, 0xFF2200, circle.alpha);
                            circle.strokeCircle(boss.x, boss.y, expand);
                        },
                        onComplete: () => circle.destroy(),
                    });
                });
            }

            // Explosion particles outward
            this.add.particles(boss.x, boss.y, 'particle', {
                speed: { min: 80, max: 200 },
                angle: { min: 0, max: 360 },
                lifespan: { min: 400, max: 800 },
                scale: { start: 1.5, end: 0 },
                alpha: { start: 1, end: 0 },
                tint: [0xFF0000, 0xFF4400, 0xFF2200, 0xCC0000],
                blendMode: 'ADD',
                quantity: 40,
                emitting: false,
            }).explode(40);

            // Damage player if in range
            if (dist < novaRadius) {
                const dmg = damagePlayerShared(this, 40);
                showFloatingText(this, p.x, p.y - 20, `-${dmg}`, '#FF0000');
            }
        });
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
    _playOutroVideo() {
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        const video = document.createElement('video');
        video.src = isMobile ? 'assets/outro_mobile.mp4' : 'assets/outro.mp4';
        video.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            object-fit: contain; z-index: 9999; background: #000;
        `;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('data-outro', '1');
        document.body.appendChild(video);

        const finish = () => {
            document.querySelectorAll('[data-outro]').forEach(el => {
                el.style.pointerEvents = 'none';
            });
            setTimeout(() => {
                document.querySelectorAll('[data-outro]').forEach(el => el.remove());
                // Show final game over screen
                const gs = document.getElementById('game-over-screen');
                gs.querySelector('h1').textContent = '✨  VICTORY  ✨';
                gs.querySelector('h1').style.color = '#FFD700';
                document.getElementById('game-over-stats').textContent =
                    `The Ancient Artifact is yours.\n` +
                    `${this._killCount} creatures slain · Survived ${Math.floor(gameState.time)}s`;
                gs.style.display = 'flex';
            }, 500);
        };

        video.addEventListener('ended', finish);
        video.addEventListener('error', finish);
        video.addEventListener('click', finish);

        video.muted = false;
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(finish);
        });
    }

    _collectTreasure() {
        if (this._done) return;
        this._done = true;
        this.player.setVelocity(0, 0);
        if (typeof mobileControls !== 'undefined') mobileControls.hide();

        // Broadcast treasure collection to all peers
        if (typeof network !== 'undefined' && network.peerCount > 0) {
            network.broadcastReliable({ t: 'fs', treasureCollected: true });
        }
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
            if (typeof audioEngine !== 'undefined') {
                audioEngine.stopLoop?.('music_lvl2', 500);
                audioEngine.stopLoop?.('music', 500);
                audioEngine.stopLoop?.('ambient', 500);
            }

            // Show OK button overlay, then play outro video
            const overlay = document.createElement('div');
            overlay.setAttribute('data-outro', '1');
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                z-index: 9999; background: rgba(0,0,0,0.9);
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                font-family: monospace; color: #FFD700; text-align: center;
            `;
            overlay.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 20px; letter-spacing: 4px;
                            text-shadow: 0 0 20px rgba(255,200,0,0.5);">
                    ✨ VICTORY ✨
                </div>
                <div style="color: #FFEEAA; font-size: 13px; margin-bottom: 8px;">
                    The Ancient Artifact is yours.
                </div>
                <div style="color: #CC88FF; font-size: 11px; margin-bottom: 24px;">
                    ${this._killCount} creatures slain · Survived ${Math.floor(gameState.time)}s
                </div>
                <button style="padding: 12px 40px; background: rgba(255,200,0,0.2);
                    border: 1px solid rgba(255,200,0,0.5); border-radius: 8px;
                    color: #FFD700; font-family: monospace; font-size: 16px;
                    letter-spacing: 3px; cursor: pointer;">OK</button>
            `;
            document.body.appendChild(overlay);

            const okBtn = overlay.querySelector('button');
            const playOutro = () => {
                overlay.remove();
                this._playOutroVideo();
            };
            okBtn.addEventListener('click', playOutro);
            okBtn.addEventListener('touchend', (e) => { e.preventDefault(); playOutro(); });
        });
    }
}
