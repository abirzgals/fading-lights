class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    create() {
        // Show HUD, hide menu elements
        document.getElementById('hud').style.display = 'flex';
        document.getElementById('game-over-screen').style.display = 'none';
        this.cameras.main.fadeIn(1500, 0, 0, 0);

        // Ensure menu music is stopped, start in-game music
        audioEngine.stopLoop('menu_music', 500);
        audioEngine.startLoop('music', 3000);
        audioEngine.startLoop('ambient', 4000);

        const worldSize = CONFIG.WORLD_TILES * CONFIG.TILE_SIZE;
        this.physics.world.setBounds(0, 0, worldSize, worldSize);

        // --- Ground (covers full world using tileSprite for performance) ---
        const centerTile = Math.floor(CONFIG.WORLD_TILES / 2);
        const worldPx = CONFIG.WORLD_TILES * CONFIG.TILE_SIZE;
        this.groundTile = this.add.tileSprite(0, 0, worldPx, worldPx, 'ground0')
            .setOrigin(0, 0)
            .setDepth(-1);

        // --- Resource Groups ---
        this.trees = this.physics.add.staticGroup();
        this.stones = this.physics.add.staticGroup();
        this.metals = this.physics.add.staticGroup();
        this.drops = this.physics.add.group();
        this.buildingsGroup = this.physics.add.staticGroup();
        this.enemies = this.physics.add.group();
        this.projectiles = this.physics.add.group();
        this.allies = this.physics.add.group();
        this.enemyHpGraphics = this.add.graphics().setDepth(50);

        // --- World Generation ---
        this.generateWorld(centerTile);

        // --- Central Bonfire ---
        const cx = centerTile * CONFIG.TILE_SIZE + 16;
        const cy = centerTile * CONFIG.TILE_SIZE + 16;
        this.bonfires = [];
        this.createBonfire(cx, cy, true);

        // --- Second camp (unlit bonfire, discoverable) ---
        if (this._secondCampWorldX) {
            this._createSecondCamp(this._secondCampWorldX, this._secondCampWorldY);
        }

        // --- Build spots (predefined positions around bonfire) ---
        this.buildSpots = [];
        this._createBuildSpots(cx, cy);

        // --- Player (use own tshirt color) ---
        const playerTexKey = getPlayerTextureKey(network.playerColor);
        const playerTex = this.textures.exists(playerTexKey) ? playerTexKey : 'player';
        this.player = this.physics.add.sprite(cx, cy - 50, playerTex);

        // --- Wandering Merchant Shop (after player, needs collider) ---
        if (this._shopWorldX) {
            this._createShop(this._shopWorldX, this._shopWorldY);
        }
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(5);
        this.player.body.setSize(16, 14);
        this.player.body.setOffset(8, 30);
        this.player.facing = { x: 0, y: 1 };
        this.player.attackCooldown = 0;
        this.player.darknessTick = 0;
        this.player.invincible = 0;

        // --- Player name label ---
        this.playerNameLabel = this.add.text(cx, cy - 70, network.playerName || 'Wanderer', {
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 2,
        }).setOrigin(0.5).setDepth(100);

        // --- Rain system ---
        this._rainActive = false;
        this._rainTimer = 0;
        this._rainDuration = 0;
        this._nextRainIn = CONFIG.RAIN_MIN_INTERVAL + Math.random() * (CONFIG.RAIN_MAX_INTERVAL - CONFIG.RAIN_MIN_INTERVAL);
        this._rainEmitter = null;
        this._rainOverlay = null;

        // --- Multiplayer: remote players ---
        this.remotePlayers = new Map(); // peerId -> { sprite, nameLabel, state, targetX, targetY }
        this._syncTimer = 0;
        this._hostSyncTimer = 0;
        this._proximityIdleTime = 0; // seconds near another player while both idle
        this._healTickTimer = 0;
        this._enemyIdCounter = 0; // unique IDs for enemies (host)
        this._destroyedResources = []; // track destroyed trees/stones for rejoining players
        this._setupNetwork();

        // --- Collisions ---
        this.physics.add.collider(this.player, this.trees);
        this.physics.add.collider(this.player, this.stones);
        this.physics.add.collider(this.player, this.metals);
        this.physics.add.collider(this.player, this.buildingsGroup);
        // Bonfire collision
        for (const b of this.bonfires) {
            this.physics.add.collider(this.player, b);
        }
        // Group-level enemy colliders (handles all enemies automatically, no per-spawn leak)
        this.physics.add.collider(this.enemies, this.trees);
        this.physics.add.collider(this.enemies, this.stones);

        // --- Camera ---
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setBackgroundColor('#000000');

        // --- Fog of War (off-screen canvas) ---
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = this.scale.width;
        this.fogCanvas.height = this.scale.height;
        this.fogCtx = this.fogCanvas.getContext('2d');
        // Remove any previous texture with this key
        if (this.textures.exists('game_fog')) this.textures.remove('game_fog');
        this.fogTexture = this.textures.createCanvas('game_fog', this.scale.width, this.scale.height);
        this.fogImage = this.add.image(0, 0, 'game_fog').setDepth(50).setScrollFactor(0).setOrigin(0, 0);

        // Handle resize
        this.scale.on('resize', (gameSize) => {
            this.fogCanvas.width = gameSize.width;
            this.fogCanvas.height = gameSize.height;
            if (this.textures.exists('game_fog')) this.textures.remove('game_fog');
            this.fogTexture = this.textures.createCanvas('game_fog', gameSize.width, gameSize.height);
            this.fogImage.setTexture('game_fog');
        });

        // --- Fire particles ---
        // (created per bonfire in createBonfire)

        // --- Ambient particles (floating dust/embers) ---
        this.ambientEmitter = this.add.particles(0, 0, 'particle', {
            x: { min: -400, max: 400 },
            y: { min: -300, max: 300 },
            follow: this.player,
            lifespan: 4000,
            speed: { min: 5, max: 20 },
            scale: { start: 0.15, end: 0 },
            alpha: { start: 0.3, end: 0 },
            tint: [0xFF8800, 0xFF6600, 0xFFAA00],
            frequency: 300,
            blendMode: 'ADD',
        });
        this.ambientEmitter.setDepth(45);

        // --- Input ---
        this.cursors = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            attack: Phaser.Input.Keyboard.KeyCodes.SPACE,
            interact: Phaser.Input.Keyboard.KeyCodes.E,
            craft: Phaser.Input.Keyboard.KeyCodes.TAB,
            build: Phaser.Input.Keyboard.KeyCodes.B,
        });

        this.input.keyboard.on('keydown-TAB', (e) => {
            e.preventDefault();
            this.toggleCrafting();
        });
        this.input.keyboard.on('keydown-B', () => {
            this.toggleBuildMode();
        });
        this.input.keyboard.on('keydown-ONE', () => this.selectBuild('OUTPOST'));
        this.input.keyboard.on('keydown-TWO', () => this.selectBuild('FORGE'));
        this.input.keyboard.on('keydown-THREE', () => this.selectBuild('WEAPON_SHOP'));
        this.input.keyboard.on('keydown-FOUR', () => this.selectBuild('ARMOR_WORKSHOP'));
        this.input.keyboard.on('keydown-FIVE', () => this.selectBuild('FRIEND_HUT'));

        // --- Mouse input (hold to repeat) ---
        this._mouseLeftHeld = false;
        this._mouseRightHeld = false;
        this._interactCooldown = 0;

        this.input.on('pointerdown', (pointer) => {
            if (gameState.gameOver || gameState.craftingOpen) return;
            if (pointer.leftButtonDown()) this._mouseLeftHeld = true;
            if (pointer.rightButtonDown()) this._mouseRightHeld = true;
        });
        this.input.on('pointerup', (pointer) => {
            if (!pointer.leftButtonDown()) this._mouseLeftHeld = false;
            if (!pointer.rightButtonDown()) this._mouseRightHeld = false;
        });
        // Disable context menu on game canvas
        this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Track mouse position for facing
        this.mouseWorldX = 0;
        this.mouseWorldY = 0;
        this.input.on('pointermove', (pointer) => {
            this.mouseWorldX = pointer.worldX;
            this.mouseWorldY = pointer.worldY;
        });
        this.useMouseFacing = false;
        this.input.on('pointerdown', () => { this.useMouseFacing = true; });
        // Switch back to keyboard facing when keys pressed
        for (const key of ['up', 'down', 'left', 'right']) {
            this.cursors[key].on('down', () => { this.useMouseFacing = false; });
        }

        // --- Chat ---
        this._chatOpen = false;
        this._chatBubbles = []; // { text, target, createdAt }
        const chatContainer = document.getElementById('chat-input-container');
        const chatInput = document.getElementById('chat-input');

        this.input.keyboard.on('keydown-ENTER', () => {
            if (gameState.gameOver) return;
            if (this._chatOpen) {
                // Send message
                const text = chatInput.value.trim();
                if (text) {
                    this._showChatBubble(this.player, this.playerNameLabel, text);
                    network.broadcastReliable({ t: 'c', text });
                }
                chatInput.value = '';
                chatContainer.style.display = 'none';
                this._chatOpen = false;
                chatInput.blur();
            } else {
                // Open chat
                this._chatOpen = true;
                chatContainer.style.display = 'block';
                chatInput.focus();
            }
        });

        // ESC closes chat / shop
        this.input.keyboard.on('keydown-ESC', () => {
            if (this._shopOpen) {
                this._closeShop();
                return;
            }
            if (this._chatOpen) {
                chatInput.value = '';
                chatContainer.style.display = 'none';
                this._chatOpen = false;
                chatInput.blur();
            }
        });

        // Prevent game input while chat is open
        chatInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                const text = chatInput.value.trim();
                if (text) {
                    this._showChatBubble(this.player, this.playerNameLabel, text);
                    network.broadcastReliable({ t: 'c', text });
                }
                chatInput.value = '';
                chatContainer.style.display = 'none';
                this._chatOpen = false;
                chatInput.blur();
            }
            if (e.key === 'Escape') {
                chatInput.value = '';
                chatContainer.style.display = 'none';
                this._chatOpen = false;
                chatInput.blur();
            }
        });

        // Mobile chat button
        if (mobileControls.isMobile) {
            const chatBtn = document.createElement('div');
            chatBtn.id = 'touch-chat-btn';
            chatBtn.className = 'touch-zone';
            chatBtn.textContent = 'CHAT';
            chatBtn.style.cssText = 'position:absolute;bottom:12px;right:12px;width:50px;height:30px;display:flex;align-items:center;justify-content:center;background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.3);border-radius:6px;color:#FFD080;font-size:10px;z-index:150;';
            document.getElementById('game-container').appendChild(chatBtn);
            chatBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                if (!this._chatOpen) {
                    this._chatOpen = true;
                    chatContainer.style.display = 'block';
                    chatInput.focus();
                }
            });
        }

        // --- Spawn timer ---
        this.spawnTimer = 0;
        this.waveTimer = 0;

        // --- HUD refs ---
        this.hud = {
            health: document.getElementById('health-fill'),
            fuel: document.getElementById('fuel-fill'),
            wood: document.getElementById('res-wood'),
            stone: document.getElementById('res-stone'),
            metal: document.getElementById('res-metal'),
            gold: document.getElementById('res-gold'),
            hint: document.getElementById('hint-text'),
            weapon: document.getElementById('weapon-display'),
            fireLevelLabel: document.getElementById('fire-level-label'),
            fireLevelFill: document.getElementById('fire-level-fill'),
        };

        // --- Build mode ghost ---
        this.buildGhost = this.add.image(0, 0, 'building_outpost').setAlpha(0.4).setDepth(49).setVisible(false);

        // --- Floating text pool ---
        this.floatingTexts = [];

        // --- Objectives ---
        this._initObjectives();

        // Show and auto-hide hint
        document.getElementById('hint-text').style.display = 'block';
        this.time.delayedCall(8000, () => {
            this.hud.hint.style.opacity = '0';
        });

        this.updateHUD();
    }

    // --------------------------------------------------------
    // World Generation
    // --------------------------------------------------------
    generateWorld(centerTile) {
        const worldSize = CONFIG.WORLD_TILES;
        const T = CONFIG.TILE_SIZE;
        const cx = centerTile, cy = centerTile;
        const rng = network.seededRandom(network.worldSeed);

        // --- Perlin-like noise for natural density variation ---
        // Simple value noise with interpolation
        const noiseGrid = 16; // grid cells
        const noiseVals = [];
        for (let i = 0; i < noiseGrid * noiseGrid; i++) noiseVals.push(rng());
        const getNoise = (tx, ty) => {
            const gx = (tx / worldSize) * (noiseGrid - 1);
            const gy = (ty / worldSize) * (noiseGrid - 1);
            const ix = Math.floor(gx), iy = Math.floor(gy);
            const fx = gx - ix, fy = gy - iy;
            const ix1 = Math.min(ix + 1, noiseGrid - 1);
            const iy1 = Math.min(iy + 1, noiseGrid - 1);
            const a = noiseVals[iy * noiseGrid + ix];
            const b = noiseVals[iy * noiseGrid + ix1];
            const c = noiseVals[iy1 * noiseGrid + ix];
            const d = noiseVals[iy1 * noiseGrid + ix1];
            const top = a + (b - a) * fx;
            const bot = c + (d - c) * fx;
            return top + (bot - top) * fy;
        };

        // --- Generate natural paths (winding roads from center outward) ---
        const pathTiles = new Set(); // "tx,ty" strings for path tiles
        const numPaths = 4 + Math.floor(rng() * 3); // 4-6 main paths
        for (let p = 0; p < numPaths; p++) {
            let angle = (p / numPaths) * Math.PI * 2 + (rng() - 0.5) * 0.6;
            let px = cx, py = cy;
            const pathLen = 30 + Math.floor(rng() * 40);
            for (let step = 0; step < pathLen; step++) {
                // Wander: angle drifts naturally
                angle += (rng() - 0.5) * 0.4;
                px += Math.cos(angle) * 1.2;
                py += Math.sin(angle) * 1.2;
                const tpx = Math.round(px), tpy = Math.round(py);
                if (tpx < 1 || tpx >= worldSize - 1 || tpy < 1 || tpy >= worldSize - 1) break;
                // Path width: 2-3 tiles
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (Math.abs(dx) + Math.abs(dy) <= 1 || rng() < 0.3) {
                            pathTiles.add(`${tpx + dx},${tpy + dy}`);
                        }
                    }
                }
            }
        }

        // --- Generate clearings (open areas) ---
        const clearings = [{ x: cx, y: cy, r: 5 }]; // bonfire clearing
        const numClearings = 6 + Math.floor(rng() * 5);
        for (let c = 0; c < numClearings; c++) {
            const angle = rng() * Math.PI * 2;
            const dist = 10 + rng() * 50;
            const clx = Math.round(cx + Math.cos(angle) * dist);
            const cly = Math.round(cy + Math.sin(angle) * dist);
            const clr = 3 + Math.floor(rng() * 4);
            clearings.push({ x: clx, y: cly, r: clr });
        }

        const isClearing = (tx, ty) => {
            for (const cl of clearings) {
                const dx = tx - cl.x, dy = ty - cl.y;
                if (dx * dx + dy * dy < cl.r * cl.r) return true;
            }
            return false;
        };

        const isPath = (tx, ty) => pathTiles.has(`${tx},${ty}`);

        // --- Place trees using noise-driven density ---
        // Store occupied tile coords for collision grid
        this._occupiedTiles = new Set();

        for (let tx = 2; tx < worldSize - 2; tx++) {
            for (let ty = 2; ty < worldSize - 2; ty++) {
                // Skip clearings and paths
                if (isClearing(tx, ty)) continue;
                if (isPath(tx, ty)) continue;

                const noise = getNoise(tx, ty);
                // Second octave for variety
                const noise2 = getNoise(tx * 2.7 + 50, ty * 2.7 + 50);
                const density = noise * 0.6 + noise2 * 0.4;

                // Dense forest: density > 0.55 = thick woods (must chop through)
                // Medium: 0.35-0.55 = scattered trees
                // Low: < 0.35 = open area, few trees
                let threshold;
                if (density > 0.55) {
                    threshold = 0.25; // ~75% chance of tree in dense areas
                } else if (density > 0.35) {
                    threshold = 0.7;  // ~30% chance in medium areas
                } else {
                    threshold = 0.94; // ~6% chance in open areas
                }

                if (rng() > threshold) continue;

                // Min distance from center bonfire
                const dcx = tx - cx, dcy = ty - cy;
                if (dcx * dcx + dcy * dcy < 5 * 5) continue;

                const wx = tx * T + 16;
                const wy = ty * T + 16;
                const tree = this.trees.create(wx, wy, 'tree');
                tree.setDepth(3);
                tree.body.setSize(16, 26);
                tree.body.setOffset(8, 24);
                tree.setData('hits', 0);
                tree.setData('type', 'tree');
                this._occupiedTiles.add(`${tx},${ty}`);
            }
        }

        // --- Starter stones near bonfire ---
        const centerWx = cx * T + 16;
        const centerWy = cy * T + 16;
        for (let s = 0; s < 5; s++) {
            const angle = rng() * Math.PI * 2;
            const dist = 70 + rng() * 50;
            const sx = centerWx + Math.cos(angle) * dist;
            const sy = centerWy + Math.sin(angle) * dist;
            const stone = this.stones.create(sx, sy, 'stone');
            stone.setDepth(2);
            stone.body.setSize(20, 16);
            stone.body.setOffset(6, 12);
            stone.setData('hits', 0);
            stone.setData('type', 'stone');
        }

        // --- Stone clusters in clearings and along paths ---
        for (let c = 0; c < 22; c++) {
            const scx = Math.floor(rng() * (worldSize - 20)) + 10;
            const scy = Math.floor(rng() * (worldSize - 20)) + 10;
            const sdx = scx - cx, sdy = scy - cy;
            if (sdx * sdx + sdy * sdy < 6 * 6) continue;
            const count = 2 + Math.floor(rng() * 3);
            for (let s = 0; s < count; s++) {
                const stx = scx + Math.floor(rng() * 3 - 1);
                const sty = scy + Math.floor(rng() * 3 - 1);
                if (this._occupiedTiles.has(`${stx},${sty}`)) continue;
                const sx = stx * T + 16;
                const sy = sty * T + 16;
                const stone = this.stones.create(sx, sy, 'stone');
                stone.setDepth(2);
                stone.body.setSize(20, 16);
                stone.body.setOffset(6, 12);
                stone.setData('hits', 0);
                stone.setData('type', 'stone');
            }
        }

        // --- Metal ore (medium-far regions, near clearings) ---
        for (let c = 0; c < 12; c++) {
            const mx = Math.floor(rng() * (worldSize - 20)) + 10;
            const my = Math.floor(rng() * (worldSize - 20)) + 10;
            const mdx = mx - cx, mdy = my - cy;
            if (mdx * mdx + mdy * mdy < 25 * 25) continue;
            const count = 2 + Math.floor(rng() * 3);
            for (let m = 0; m < count; m++) {
                const mtx = mx + Math.floor(rng() * 3 - 1);
                const mty = my + Math.floor(rng() * 3 - 1);
                if (this._occupiedTiles.has(`${mtx},${mty}`)) continue;
                const px = mtx * T + 16;
                const py = mty * T + 16;
                const ore = this.metals.create(px, py, 'metal');
                ore.setDepth(2);
                ore.body.setSize(20, 16);
                ore.body.setOffset(6, 12);
                ore.setData('hits', 0);
                ore.setData('type', 'metal');
            }
        }

        // --- Second camp (unlit) at the edge of level 5 radius ---
        // Place deterministically using seeded RNG so both host + client agree
        const secondCampAngle = rng() * Math.PI * 2;
        const secondCampDist = 34; // tiles from center (~1088px, near lvl5 light edge)
        const sc_tx = Math.round(cx + Math.cos(secondCampAngle) * secondCampDist);
        const sc_ty = Math.round(cy + Math.sin(secondCampAngle) * secondCampDist);
        this._secondCampTile = { tx: sc_tx, ty: sc_ty };
        this._secondCampWorldX = sc_tx * T + 16;
        this._secondCampWorldY = sc_ty * T + 16;

        // Clear trees around second camp (radius 5 tiles)
        for (const tree of [...this.trees.children.entries]) {
            const ttx = Math.floor(tree.x / T);
            const tty = Math.floor(tree.y / T);
            const dx = ttx - sc_tx, dy = tty - sc_ty;
            if (dx * dx + dy * dy < 5 * 5) {
                this._occupiedTiles.delete(`${ttx},${tty}`);
                tree.destroy();
            }
        }
        // Also clear stones in the area
        for (const stone of [...this.stones.children.entries]) {
            const dx = stone.x - this._secondCampWorldX;
            const dy = stone.y - this._secondCampWorldY;
            if (dx * dx + dy * dy < (5 * T) * (5 * T)) {
                stone.destroy();
            }
        }

        // Add some resources around the second camp
        for (let s = 0; s < 4; s++) {
            const a = rng() * Math.PI * 2;
            const d = 60 + rng() * 40;
            const rx = this._secondCampWorldX + Math.cos(a) * d;
            const ry = this._secondCampWorldY + Math.sin(a) * d;
            const stone = this.stones.create(rx, ry, 'stone');
            stone.setDepth(2);
            stone.body.setSize(20, 16);
            stone.body.setOffset(6, 12);
            stone.setData('hits', 0);
            stone.setData('type', 'stone');
        }

        // --- Wandering Merchant Shop ---
        // Place on opposite side of center from second camp, at ~lvl3 light range
        const shopAngle = secondCampAngle + Math.PI + (rng() - 0.5) * 0.6; // roughly opposite
        const shopDist = 22; // tiles from center (~704px, around lvl3 edge)
        const shop_tx = Math.round(cx + Math.cos(shopAngle) * shopDist);
        const shop_ty = Math.round(cy + Math.sin(shopAngle) * shopDist);
        this._shopWorldX = shop_tx * T + 16;
        this._shopWorldY = shop_ty * T + 16;

        // Clear trees around shop (radius 4 tiles)
        for (const tree of [...this.trees.children.entries]) {
            const ttx = Math.floor(tree.x / T);
            const tty = Math.floor(tree.y / T);
            const dx = ttx - shop_tx, dy = tty - shop_ty;
            if (dx * dx + dy * dy < 4 * 4) {
                this._occupiedTiles.delete(`${ttx},${tty}`);
                tree.destroy();
            }
        }

        // Generate shop inventory using seeded RNG (deterministic for all players)
        this._shopInventory = [];
        const shopPool = [...SHOP_WEAPONS];
        for (let i = 0; i < SHOP_ITEM_COUNT && shopPool.length > 0; i++) {
            const idx = Math.floor(rng() * shopPool.length);
            const template = shopPool.splice(idx, 1)[0];
            // Randomize stats ±20%
            const vary = (base) => Math.round(base * (0.8 + rng() * 0.4));
            const weapon = {
                name: template.name,
                damage: vary(template.baseDmg),
                range: vary(template.baseRange),
                speed: vary(template.baseSpeed),
                color: template.color,
                gold: vary(template.baseGold),
                sold: false,
            };
            if (template.chopBonus) weapon.chopBonus = template.chopBonus;
            if (template.shadowBonus) weapon.shadowBonus = template.shadowBonus;
            this._shopInventory.push(weapon);
        }

        // Store for enemy spawning (free spaces)
        this._pathTiles = pathTiles;
        this._clearings = clearings;

        // Build walkability grid for pathfinding (true = walkable)
        this._walkGrid = new Uint8Array(worldSize * worldSize);
        for (let ty = 0; ty < worldSize; ty++) {
            for (let tx = 0; tx < worldSize; tx++) {
                this._walkGrid[ty * worldSize + tx] = this._occupiedTiles.has(`${tx},${ty}`) ? 0 : 1;
            }
        }
        this._gridSize = worldSize;
    }

    // A* pathfinding on tile grid. Returns array of {x, y} world positions, or null if no path.
    _findPath(fromWX, fromWY, toWX, toWY) {
        const T = CONFIG.TILE_SIZE;
        const gs = this._gridSize;
        const grid = this._walkGrid;
        if (!grid) return null;

        const sx = Math.floor(fromWX / T), sy = Math.floor(fromWY / T);
        const ex = Math.floor(toWX / T), ey = Math.floor(toWY / T);

        // Clamp to bounds
        if (sx < 0 || sy < 0 || ex < 0 || ey < 0 || sx >= gs || sy >= gs || ex >= gs || ey >= gs) return null;

        // Quick bail if start or end is blocked
        if (!grid[sy * gs + sx] || !grid[ey * gs + ex]) return null;

        const key = (x, y) => y * gs + x;
        const heuristic = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);

        // Open set as simple sorted array (good enough for game-scale grids)
        const open = [{ x: sx, y: sy, g: 0, f: heuristic(sx, sy) }];
        const cameFrom = new Map();
        const gScore = new Map();
        gScore.set(key(sx, sy), 0);

        const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
        const maxIterations = 5000; // cap to avoid lag
        let iterations = 0;

        while (open.length > 0 && iterations++ < maxIterations) {
            // Pop lowest f
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) bestIdx = i;
            }
            const curr = open.splice(bestIdx, 1)[0];

            if (curr.x === ex && curr.y === ey) {
                // Reconstruct path — return every Nth waypoint for smooth movement
                const path = [];
                let k = key(curr.x, curr.y);
                while (cameFrom.has(k)) {
                    const tx = k % gs, ty = Math.floor(k / gs);
                    path.push({ x: tx * T + T / 2, y: ty * T + T / 2 });
                    k = cameFrom.get(k);
                }
                path.reverse();
                // Simplify: keep every 3rd waypoint for smoother movement
                const simplified = [];
                for (let i = 0; i < path.length; i += 3) {
                    simplified.push(path[i]);
                }
                // Always include final destination
                simplified.push({ x: toWX, y: toWY });
                return simplified;
            }

            for (const [dx, dy] of dirs) {
                const nx = curr.x + dx, ny = curr.y + dy;
                if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
                if (!grid[ny * gs + nx]) continue;

                const moveCost = (dx !== 0 && dy !== 0) ? 1.41 : 1;
                const ng = curr.g + moveCost;
                const nk = key(nx, ny);
                if (gScore.has(nk) && ng >= gScore.get(nk)) continue;

                gScore.set(nk, ng);
                cameFrom.set(nk, key(curr.x, curr.y));
                open.push({ x: nx, y: ny, g: ng, f: ng + heuristic(nx, ny) });
            }
        }

        return null; // no path found
    }

    // --------------------------------------------------------
    // Bonfire
    // --------------------------------------------------------
    createBonfire(x, y, isMain = false) {
        const bonfire = this.physics.add.staticImage(x, y, 'bonfire');
        bonfire.setDepth(4);
        bonfire.setData('fuel', isMain ? CONFIG.BONFIRE_MAX_FUEL : CONFIG.BONFIRE_MAX_FUEL * 0.6);
        bonfire.setData('maxFuel', CONFIG.BONFIRE_MAX_FUEL);
        bonfire.setData('isMain', isMain);
        bonfire.setData('campFuelAdded', isMain ? gameState.fuelAdded : 0);
        bonfire.setData('campFireLevel', isMain ? gameState.fireLevel : 1);

        // Fire particle emitter
        const emitter = this.add.particles(x, y - 8, 'particle', {
            speed: { min: 20, max: 60 },
            angle: { min: 250, max: 290 },
            lifespan: { min: 400, max: 900 },
            scale: { start: 0.6, end: 0.05 },
            alpha: { start: 0.9, end: 0 },
            tint: [0xFF4400, 0xFF6600, 0xFF8800, 0xFFAA00, 0xFFCC00],
            blendMode: 'ADD',
            frequency: 40,
            quantity: 2,
        });
        emitter.setDepth(6);
        bonfire.setData('emitter', emitter);

        this.bonfires.push(bonfire);
        return bonfire;
    }

    // Light up the second camp with a dramatic effect
    _lightSecondCamp(bonfire) {
        bonfire.setData('lit', true);

        // Fade in bonfire sprite
        this.tweens.add({ targets: bonfire, alpha: 1, duration: 1500 });

        // Create fire particle emitter
        const emitter = this.add.particles(bonfire.x, bonfire.y - 8, 'particle', {
            speed: { min: 20, max: 60 },
            angle: { min: 250, max: 290 },
            lifespan: { min: 400, max: 900 },
            scale: { start: 0.6, end: 0.05 },
            alpha: { start: 0.9, end: 0 },
            tint: [0xFF4400, 0xFF6600, 0xFF8800, 0xFFAA00, 0xFFCC00],
            blendMode: 'ADD',
            frequency: 40,
            quantity: 2,
        });
        emitter.setDepth(6);
        bonfire.setData('emitter', emitter);

        // Burst of light particles
        const burstEmitter = this.add.particles(bonfire.x, bonfire.y, 'particle', {
            speed: { min: 60, max: 180 },
            lifespan: 800,
            scale: { start: 0.8, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xFFCC00, 0xFF8800, 0xFFFFAA],
            quantity: 20,
            blendMode: 'ADD',
            emitting: false,
        });
        burstEmitter.setDepth(7);
        burstEmitter.explode(20);
        this.time.delayedCall(1000, () => burstEmitter.destroy());

        // Remove marker and label
        const marker = bonfire.getData('marker');
        const label = bonfire.getData('label');
        if (marker) this.tweens.add({ targets: marker, alpha: 0, duration: 1000, onComplete: () => marker.destroy() });
        if (label) this.tweens.add({ targets: label, alpha: 0, duration: 1000, onComplete: () => label.destroy() });

        this.showFloatingText(bonfire.x, bonfire.y - 50, 'CAMP DISCOVERED!', '#FFCC00');
        this._trackObjective('second_camp_lit', 1);

        // Broadcast second camp lit to peers
        if (network.peerCount > 0) {
            network.broadcastReliable({ t: 'sc', x: bonfire.x, y: bonfire.y });
        }
    }

    // Create second camp — unlit bonfire that glows on first fuel
    _createSecondCamp(x, y) {
        const bonfire = this.physics.add.staticImage(x, y, 'bonfire');
        bonfire.setDepth(4);
        bonfire.setData('fuel', 0);
        bonfire.setData('maxFuel', CONFIG.BONFIRE_MAX_FUEL);
        bonfire.setData('isMain', false);
        bonfire.setData('isSecondCamp', true);
        bonfire.setData('lit', false);
        bonfire.setData('campFuelAdded', 0);
        bonfire.setData('campFireLevel', 1);
        bonfire.setAlpha(0.3); // dim/dark until lit

        // No fire emitter initially — will be created on first light
        bonfire.setData('emitter', null);

        // Visual marker: faint glow circle to hint at the camp
        const marker = this.add.graphics();
        marker.lineStyle(1.5, 0x443366, 0.4);
        marker.strokeCircle(x, y, 30);
        marker.setDepth(3);
        bonfire.setData('marker', marker);

        // "Unlit Camp" label
        const label = this.add.text(x, y - 28, 'Abandoned Camp', {
            fontSize: '9px', fontFamily: 'monospace',
            color: '#886699', stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(50).setAlpha(0.6);
        bonfire.setData('label', label);

        this.bonfires.push(bonfire);
        this._secondCampBonfire = bonfire;
    }

    // Create the wandering merchant shop
    _createShop(x, y) {
        const shop = this.physics.add.staticImage(x, y, 'shop');
        shop.setDepth(4);
        shop.body.setSize(40, 20);
        shop.body.setOffset(4, 24);
        this.shopSprite = shop;

        // Collider so player bumps into it
        this.physics.add.collider(this.player, shop);

        // Label
        this._shopLabel = this.add.text(x, y - 30, 'Merchant', {
            fontSize: '9px', fontFamily: 'monospace',
            color: '#FFD700', stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(50).setAlpha(0.7);

        // Subtle lantern glow particle
        this._shopGlow = this.add.particles(x - 17, y - 16, 'particle', {
            speed: { min: 2, max: 8 },
            angle: { min: 240, max: 300 },
            lifespan: { min: 300, max: 600 },
            scale: { start: 0.25, end: 0 },
            alpha: { start: 0.6, end: 0 },
            tint: [0xFFAA00, 0xFFCC44],
            blendMode: 'ADD',
            frequency: 200,
            quantity: 1,
        });
        this._shopGlow.setDepth(5);

        // Shop state
        this._shopOpen = false;

        // Wire up close button
        document.getElementById('shop-close-btn').onclick = () => this._closeShop();
    }

    _openShop() {
        if (this._shopOpen || gameState.craftingOpen || gameState.gameOver) return;
        this._shopOpen = true;

        const menu = document.getElementById('shop-menu');
        menu.style.display = 'block';
        this._renderShopMenu();
    }

    _closeShop() {
        this._shopOpen = false;
        document.getElementById('shop-menu').style.display = 'none';
    }

    _renderShopMenu() {
        const list = document.getElementById('shop-list');
        list.innerHTML = '';

        const inv = this._shopInventory;
        if (!inv || inv.length === 0) {
            list.innerHTML = '<div style="color:#888;text-align:center;padding:12px;">Sold out!</div>';
            return;
        }

        for (let i = 0; i < inv.length; i++) {
            const w = inv[i];
            if (w.sold) continue;

            const item = document.createElement('div');
            const canBuy = gameState.resources.gold >= w.gold;
            item.className = 'shop-item' + (canBuy ? '' : ' disabled');

            // Stats line
            let statsHtml = `DMG:${w.damage} RNG:${w.range} SPD:${(1000 / w.speed).toFixed(1)}/s`;
            if (w.chopBonus) statsHtml += ` CHOP+${w.chopBonus}`;
            if (w.shadowBonus) statsHtml += ` SHADOW×${w.shadowBonus}`;

            item.innerHTML = `
                <div class="shop-item-header">
                    <span class="shop-item-name" style="color:#${w.color.toString(16).padStart(6, '0')}">${w.name}</span>
                    <span class="shop-item-price">${w.gold} gold</span>
                </div>
                <div class="shop-item-stats">${statsHtml}</div>
            `;

            if (canBuy) {
                item.onclick = () => this._buyWeapon(i);
            }
            list.appendChild(item);
        }
    }

    _buyWeapon(index) {
        const w = this._shopInventory[index];
        if (!w || w.sold || gameState.resources.gold < w.gold) return;

        // Deduct gold
        gameState.resources.gold -= w.gold;
        w.sold = true;

        // Create a dynamic weapon key and register it
        const weaponKey = 'SHOP_' + index + '_' + w.name.replace(/\s+/g, '_').toUpperCase();
        WEAPONS[weaponKey] = {
            name: w.name,
            damage: w.damage,
            range: w.range,
            speed: w.speed,
            tier: 2,
            color: w.color,
        };
        if (w.chopBonus) WEAPONS[weaponKey].chopBonus = w.chopBonus;
        if (w.shadowBonus) WEAPONS[weaponKey].shadowBonus = w.shadowBonus;

        // Equip immediately
        gameState.weapon = weaponKey;
        if (!gameState.unlockedWeapons.includes(weaponKey)) {
            gameState.unlockedWeapons.push(weaponKey);
        }

        this.showFloatingText(this.player.x, this.player.y - 40, `Bought ${w.name}!`, '#FFD700');
        audioEngine.playCraft();

        // Broadcast purchase to peers
        if (network.peerCount > 0) {
            network.broadcastReliable({ t: 'sp', idx: index, peerId: network.peerId });
        }

        this._closeShop();
    }

    // Create build spots for the second camp when it levels up
    _updateSecondCampBuildSpots(bonfire, level) {
        const cx = bonfire.x;
        const cy = bonfire.y;
        const T = CONFIG.TILE_SIZE;

        // Only add spots that match this level and haven't been created yet
        for (const spot of CONFIG.BUILD_SPOTS) {
            if (spot.reqLevel > level) continue;
            // Check if already exists for this camp
            const sx = cx + Math.cos(spot.angle) * spot.dist * T;
            const sy = cy + Math.sin(spot.angle) * spot.dist * T;
            const exists = this.buildSpots.some(
                s => Math.abs(s.x - sx) < 10 && Math.abs(s.y - sy) < 10
            );
            if (exists) continue;

            const sprite = this.add.image(sx, sy, 'build_spot');
            sprite.setDepth(3).setAlpha(0).setScale(0.8);
            const building = BUILDINGS[spot.type];
            const label = this.add.text(sx, sy - 18, spot.label, {
                fontSize: '8px', fontFamily: 'monospace',
                color: '#FFCC00', stroke: '#000000', strokeThickness: 2,
            }).setOrigin(0.5).setDepth(50).setAlpha(0);

            let costStr = '';
            if (building) {
                for (const [res, amt] of Object.entries(building.cost)) {
                    costStr += `${res}:${amt} `;
                }
            }
            const costText = this.add.text(sx, sy + 14, costStr.trim(), {
                fontSize: '7px', fontFamily: 'monospace',
                color: '#AAAAAA', stroke: '#000000', strokeThickness: 2,
            }).setOrigin(0.5).setDepth(50).setAlpha(0);

            const newSpot = {
                x: sx, y: sy,
                sprite, label, costText,
                config: spot,
                reqLevel: spot.reqLevel,
                unlocked: true,
                built: false,
                campBonfire: bonfire,
            };
            this.buildSpots.push(newSpot);

            // Animate in
            sprite.setVisible(true);
            label.setVisible(true);
            costText.setVisible(true);
            this.tweens.add({ targets: sprite, alpha: 0.7, duration: 800 });
            this.tweens.add({ targets: label, alpha: 0.8, duration: 800 });
            this.tweens.add({ targets: costText, alpha: 0.6, duration: 800 });
            this.showFloatingText(sx, sy - 35, 'NEW BUILD SPOT!', '#FF8800');
        }
    }

    // --------------------------------------------------------
    // Build Spots
    // --------------------------------------------------------
    _createBuildSpots(cx, cy) {
        for (let i = 0; i < CONFIG.BUILD_SPOTS.length; i++) {
            const spot = CONFIG.BUILD_SPOTS[i];
            const sx = cx + Math.cos(spot.angle) * spot.dist * CONFIG.TILE_SIZE;
            const sy = cy + Math.sin(spot.angle) * spot.dist * CONFIG.TILE_SIZE;

            // All start fully hidden
            const sprite = this.add.image(sx, sy, 'build_spot');
            sprite.setDepth(2).setAlpha(0).setVisible(false);

            const label = this.add.text(sx, sy - 22, spot.label, {
                fontSize: '9px', fontFamily: 'monospace',
                color: '#FF8800', stroke: '#000', strokeThickness: 2,
            }).setOrigin(0.5).setDepth(100).setAlpha(0).setVisible(false);

            const costText = this.add.text(sx, sy + 22, '', {
                fontSize: '8px', fontFamily: 'monospace',
                color: '#AAAAAA', stroke: '#000', strokeThickness: 1,
            }).setOrigin(0.5).setDepth(100).setAlpha(0).setVisible(false);

            const building = BUILDINGS[spot.type];
            if (building) {
                const parts = [];
                for (const [res, amt] of Object.entries(building.cost)) {
                    parts.push(`${amt} ${res}`);
                }
                costText.setText(parts.join(' '));
            }

            this.buildSpots.push({
                config: spot,
                index: i,
                x: sx, y: sy,
                sprite, label, costText,
                reqLevel: spot.reqLevel || 1,
                unlocked: false,
                built: false,
            });
        }
    }

    _updateBuildSpots() {
        for (const spot of this.buildSpots) {
            if (spot.built) continue;
            const wasUnlocked = spot.unlocked;
            // Use per-camp level if spot belongs to a specific camp
            const campLevel = spot.campBonfire
                ? (spot.campBonfire.getData('campFireLevel') || 1)
                : (this.bonfires[0]?.getData('campFireLevel') || gameState.fireLevel);
            spot.unlocked = campLevel >= spot.reqLevel;

            if (spot.unlocked && !wasUnlocked) {
                // Newly unlocked — animate in
                spot.sprite.setVisible(true);
                spot.label.setVisible(true);
                spot.costText.setVisible(true);
                this.tweens.add({ targets: spot.sprite, alpha: 0.7, duration: 800 });
                this.tweens.add({ targets: spot.label, alpha: 0.8, duration: 800 });
                this.tweens.add({ targets: spot.costText, alpha: 0.6, duration: 800 });
                this.showFloatingText(spot.x, spot.y - 35, 'NEW BUILD SPOT!', '#FF8800');
            } else if (spot.unlocked) {
                // Pulse gently
                spot.sprite.setAlpha(0.5 + Math.sin(this.time.now * 0.003) * 0.2);
            }
        }
    }

    _tryBuildOnSpot() {
        const p = this.player;
        for (const spot of this.buildSpots) {
            if (spot.built || !spot.unlocked) continue;
            const dist = Phaser.Math.Distance.Between(p.x, p.y, spot.x, spot.y);
            if (dist < CONFIG.INTERACT_RADIUS) {
                const building = BUILDINGS[spot.config.type];
                if (!building) continue;

                if (!this.canAfford(building.cost)) {
                    const missing = [];
                    for (const [res, amt] of Object.entries(building.cost)) {
                        const have = gameState.resources[res] || 0;
                        if (have < amt) missing.push(`${res}: ${have}/${amt}`);
                    }
                    this.showFloatingText(spot.x, spot.y - 20, `Need: ${missing.join(', ')}`, '#FF4444');
                    return true; // consumed the interact
                }

                // Deduct cost
                for (const [res, amount] of Object.entries(building.cost)) {
                    gameState.resources[res] -= amount;
                }

                this._placeBuilding(spot.config.type, spot.x, spot.y);

                // Broadcast to peers
                if (network.peerCount > 0) {
                    network.broadcastReliable({ t: 'bl', bType: spot.config.type, x: spot.x, y: spot.y });
                }

                audioEngine.playBuild();
                return true;
            }
        }
        return false;
    }

    // --------------------------------------------------------
    // Main Update Loop
    // --------------------------------------------------------
    update(time, delta) {
        if (gameState.gameOver) return;

        const dt = delta / 1000;
        gameState.time += dt;

        this.updatePlayer(dt, time, delta);
        this.updateProximityHealing(dt);
        this.updateBonfires(dt);
        this.updateEnemies(dt);
        this.updateProjectiles(dt);
        this.drawEnemyHealth();
        this.updateAllies(dt);
        this.updateTurrets(dt);
        this.updateDropPickup();
        this.updateDarknessDamage(dt);
        this.updateSpawning(dt);
        this.updateRain(dt);
        this.updateFogOfWar();
        this.updateBuildGhost();
        this._updateBuildSpots();
        this.updateHUD();
        this._updateChatBubbles();
        this.updateNetwork(dt);
    }

    // --------------------------------------------------------
    // Player
    // --------------------------------------------------------
    updatePlayer(dt, time, delta) {
        const p = this.player;
        let vx = 0, vy = 0;

        if (!gameState.craftingOpen && !this._chatOpen && !this._shopOpen) {
            // Keyboard input
            if (this.cursors.left.isDown)  vx = -1;
            if (this.cursors.right.isDown) vx = 1;
            if (this.cursors.up.isDown)    vy = -1;
            if (this.cursors.down.isDown)  vy = 1;

            // Mobile joystick input (overrides if active)
            if (mobileControls.isMobile) {
                const mv = mobileControls.getMovement();
                if (mv.x !== 0 || mv.y !== 0) {
                    vx = mv.x;
                    vy = mv.y;
                }
            }
        }

        // Normalize diagonal
        if (vx !== 0 && vy !== 0) {
            const len = Math.sqrt(vx * vx + vy * vy);
            if (len > 1) { vx /= len; vy /= len; }
        }

        p.setVelocity(vx * CONFIG.PLAYER_SPEED, vy * CONFIG.PLAYER_SPEED);

        // Footstep loop: play when moving, stop when idle
        if (vx !== 0 || vy !== 0) {
            if (!this._footstepsPlaying) {
                audioEngine.startFootsteps();
                this._footstepsPlaying = true;
            }
        } else {
            if (this._footstepsPlaying) {
                audioEngine.stopFootsteps();
                this._footstepsPlaying = false;
            }
        }

        // Update facing: keyboard overrides mouse when moving
        if (vx !== 0 || vy !== 0) {
            if (!this.useMouseFacing) {
                p.facing = { x: vx > 0 ? 1 : vx < 0 ? -1 : 0, y: vy > 0 ? 1 : vy < 0 ? -1 : 0 };
            }
        }
        // Mouse facing: always update when mouse mode is active
        if (this.useMouseFacing) {
            this.updateFacingToMouse(this.input.activePointer);
        }

        // Flip sprite based on facing
        if (p.facing.x !== 0) p.setFlipX(p.facing.x < 0);

        // Attack cooldown
        if (p.attackCooldown > 0) p.attackCooldown -= delta;
        if (p.invincible > 0) {
            p.invincible -= delta;
            p.setAlpha(Math.sin(time * 0.02) > 0 ? 1 : 0.3);
        } else {
            p.setAlpha(1);
        }

        // Attack (keyboard, mobile, mouse hold, or autoattack)
        const kbAttack = Phaser.Input.Keyboard.JustDown(this.cursors.attack);
        const mobileAttack = mobileControls.consumeAttack();
        const wantAttack = kbAttack || mobileAttack || this._mouseLeftHeld;
        if (wantAttack && p.attackCooldown <= 0 && !gameState.craftingOpen && !this._chatOpen && !this._shopOpen) {
            if (this._mouseLeftHeld) this.updateFacingToMouse(this.input.activePointer);
            // Mobile/keyboard: auto-face nearest choppable resource if in range
            if (!this._mouseLeftHeld) {
                const weapon = WEAPONS[gameState.weapon];
                let nearRes = null, nearDist = weapon.range + 20;
                for (const group of [this.trees, this.stones, this.metals]) {
                    for (const obj of group.children.entries) {
                        if (!obj.active) continue;
                        const d = Phaser.Math.Distance.Between(p.x, p.y, obj.x, obj.y);
                        if (d < nearDist) { nearDist = d; nearRes = obj; }
                    }
                }
                if (nearRes) {
                    const a = Phaser.Math.Angle.Between(p.x, p.y, nearRes.x, nearRes.y);
                    p.facing = { x: Math.cos(a), y: Math.sin(a) };
                    if (p.facing.x !== 0) p.setFlipX(p.facing.x < 0);
                }
            }
            this.playerAttack();
        }

        // Autoattack: if idle and enemy in weapon range, face it and attack
        if (!wantAttack && p.attackCooldown <= 0 && !gameState.craftingOpen && !this._chatOpen && !this._shopOpen) {
            const weapon = WEAPONS[gameState.weapon];
            const autoRange = weapon.range + 20;
            let nearest = null, nearDist = Infinity;
            for (const enemy of this.enemies.children.entries) {
                if (!enemy.active) continue;
                const d = Phaser.Math.Distance.Between(p.x, p.y, enemy.x, enemy.y);
                if (d < autoRange + enemy.getData('size') && d < nearDist) {
                    nearDist = d;
                    nearest = enemy;
                }
            }
            if (nearest) {
                const angle = Phaser.Math.Angle.Between(p.x, p.y, nearest.x, nearest.y);
                p.facing = { x: Math.cos(angle), y: Math.sin(angle) };
                if (p.facing.x !== 0) p.setFlipX(p.facing.x < 0);
                this.playerAttack();
            }
        }

        // Interact (keyboard, mobile, or mouse hold)
        if (this._interactCooldown > 0) this._interactCooldown -= delta;
        const kbInteract = Phaser.Input.Keyboard.JustDown(this.cursors.interact);
        const mobileInteract = mobileControls.consumeInteract();
        const wantInteract = kbInteract || mobileInteract || this._mouseRightHeld;
        if (wantInteract && this._interactCooldown <= 0 && !gameState.craftingOpen && !this._chatOpen && !this._shopOpen) {
            if (this._mouseRightHeld) this.updateFacingToMouse(this.input.activePointer);
            this.playerInteract();
            this._interactCooldown = 500;
        }
    }

    updateFacingToMouse(pointer) {
        const p = this.player;
        const mx = pointer.worldX;
        const my = pointer.worldY;
        const angle = Phaser.Math.Angle.Between(p.x, p.y, mx, my);
        // Convert angle to 8-direction facing
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        p.facing = {
            x: Math.abs(cos) > 0.3 ? (cos > 0 ? 1 : -1) : 0,
            y: Math.abs(sin) > 0.3 ? (sin > 0 ? 1 : -1) : 0,
        };
        if (p.facing.x === 0 && p.facing.y === 0) p.facing.y = 1;
    }

    playerAttack() {
        const p = this.player;
        const weapon = WEAPONS[gameState.weapon];
        p.attackCooldown = weapon.speed;
        audioEngine.playAttack();

        // Attack position
        const ax = p.x + p.facing.x * weapon.range;
        const ay = p.y + p.facing.y * weapon.range;

        // Slash visual
        const slash = this.add.image(ax, ay, 'slash').setDepth(10).setAlpha(0.8);
        slash.setBlendMode('ADD');
        slash.setRotation(Math.atan2(p.facing.y, p.facing.x));
        this.tweens.add({
            targets: slash,
            alpha: 0,
            scale: 1.5,
            duration: 200,
            onComplete: () => slash.destroy()
        });

        // Check hits on resources (copy array to avoid mutation during iteration)
        const hitResources = (group, maxHits, dropType, dropAmount) => {
            const targets = [...group.children.entries];
            for (const obj of targets) {
                if (!obj.active) continue;
                const dist = Phaser.Math.Distance.Between(ax, ay, obj.x, obj.y);
                if (dist < weapon.range + 16) {
                    let hits = obj.getData('hits') + 1 + (weapon.chopBonus || 0);
                    obj.setData('hits', hits);
                    this.showFloatingText(obj.x, obj.y - 20, `${hits}/${maxHits}`, '#FFaa00');
                    audioEngine.playChop();
                    if (hits >= maxHits) {
                        this._destroyResource(obj, dropType, dropAmount, true);
                    }
                }
            }
        };

        hitResources(this.trees, CONFIG.TREE_HITS, 'wood', CONFIG.WOOD_PER_TREE);
        hitResources(this.stones, CONFIG.STONE_HITS, 'stone', CONFIG.STONE_PER_DEPOSIT);
        hitResources(this.metals, CONFIG.METAL_HITS, 'metal', CONFIG.METAL_PER_DEPOSIT);

        // Check hits on enemies (copy array to avoid mutation during iteration)
        const enemyTargets = [...this.enemies.children.entries];
        for (const enemy of enemyTargets) {
            if (!enemy.active) continue;
            const dist = Phaser.Math.Distance.Between(ax, ay, enemy.x, enemy.y);
            if (dist < weapon.range + enemy.getData('size')) {
                let dmg = weapon.damage;
                if (weapon.shadowBonus) dmg = Math.floor(dmg * weapon.shadowBonus);
                this.damageEnemy(enemy, dmg);
                audioEngine.playHit();
            }
        }

        // Screen shake for heavy weapons
        if (weapon.tier >= 2) {
            this.cameras.main.shake(80, 0.003);
        }

        // Broadcast attack to peers
        network.broadcastAttack({
            ax: Math.round(ax),
            ay: Math.round(ay),
            fx: p.facing.x,
            fy: p.facing.y,
        });
    }

    playerInteract() {
        const p = this.player;

        // Check shop interaction
        if (this.shopSprite) {
            const shopDist = Phaser.Math.Distance.Between(p.x, p.y, this.shopSprite.x, this.shopSprite.y);
            if (shopDist < CONFIG.INTERACT_RADIUS + 10) {
                this._openShop();
                return;
            }
        }

        // Check build spots first
        if (this._tryBuildOnSpot()) return;

        // Check bonfires to add fuel
        for (const bonfire of this.bonfires) {
            const dist = Phaser.Math.Distance.Between(p.x, p.y, bonfire.x, bonfire.y);
            if (dist < CONFIG.INTERACT_RADIUS && gameState.resources.wood > 0) {
                const fuel = bonfire.getData('fuel');
                const maxFuel = bonfire.getData('maxFuel');
                if (fuel < maxFuel) {
                    gameState.resources.wood--;
                    bonfire.setData('fuel', Math.min(maxFuel, fuel + CONFIG.FUEL_PER_WOOD));
                    this.showFloatingText(bonfire.x, bonfire.y - 20, '+FUEL', '#FF8800');
                    audioEngine.playFireFuel();

                    // Light up second camp on first fuel
                    if (bonfire.getData('isSecondCamp') && !bonfire.getData('lit')) {
                        this._lightSecondCamp(bonfire);
                    }

                    // Track per-camp fuel added and level
                    const campFuelAdded = (bonfire.getData('campFuelAdded') || 0) + 1;
                    bonfire.setData('campFuelAdded', campFuelAdded);
                    this._trackObjective('fuel_added', 1);

                    // Also update global fuelAdded for main camp (backwards compat)
                    if (bonfire.getData('isMain')) {
                        gameState.fuelAdded = campFuelAdded;
                    }

                    // Check fire level up for this camp
                    const levels = CONFIG.FIRE_LEVELS;
                    const oldLevel = bonfire.getData('campFireLevel') || 1;
                    let newLevel = 1;
                    for (let lv = levels.length - 1; lv >= 0; lv--) {
                        if (campFuelAdded >= levels[lv]) {
                            newLevel = lv + 1;
                            break;
                        }
                    }
                    bonfire.setData('campFireLevel', newLevel);

                    if (newLevel > oldLevel) {
                        this.showFloatingText(bonfire.x, bonfire.y - 50,
                            `CAMP LEVEL ${newLevel}!`, '#CC66FF');
                        audioEngine.playWave();
                        this._trackObjective('fire_level', Math.max(newLevel, this._objCounters?.fire_level || 0));
                        // Create build spots for second camp on level up
                        if (bonfire.getData('isSecondCamp')) {
                            this._updateSecondCampBuildSpots(bonfire, newLevel);
                        }
                    }

                    // Update active camp for dashboard
                    this._activeCamp = bonfire;
                    // Keep gameState.fireLevel as the max of all camps
                    gameState.fireLevel = Math.max(
                        this.bonfires[0]?.getData('campFireLevel') || 1,
                        this._secondCampBonfire?.getData('campFireLevel') || 1
                    );

                    // Sync fuel addition to peers
                    const bIdx = this.bonfires.indexOf(bonfire);
                    if (network.peerCount > 0) {
                        network.broadcastReliable({ t: 'f', bonfireIdx: bIdx, amount: CONFIG.FUEL_PER_WOOD });
                    }

                    // Upgrading fire angers the darkness — spawn a small burst
                    const burst = CONFIG.FUEL_SPAWN_BURST + Math.floor(gameState.waveNumber / 3);
                    const maxSpawn = CONFIG.MAX_ENEMIES - this.enemies.countActive();
                    const toSpawn = Math.min(burst, maxSpawn);
                    for (let i = 0; i < toSpawn; i++) {
                        this.time.delayedCall(i * 600, () => this.spawnEnemy());
                    }
                    if (toSpawn > 0) {
                        this.showFloatingText(bonfire.x, bonfire.y - 40, 'THE DARKNESS STIRS...', '#FF2222');
                    }

                    // Update build spots visibility
                    this._updateBuildSpots();
                    return;
                }
            }
        }

        // Build mode placement
        if (gameState.buildMode && gameState.buildType) {
            this.placeBuilding();
        }
    }

    _destroyResource(obj, dropType, dropAmount, broadcast) {
        const ox = obj.x, oy = obj.y;
        const resType = obj.getData('type');
        // Drop resources
        for (let i = 0; i < dropAmount; i++) {
            const drop = this.drops.create(
                ox + Phaser.Math.Between(-12, 12),
                oy + Phaser.Math.Between(-12, 12),
                dropType + '_drop'
            );
            drop.setDepth(3);
            drop.setData('resourceType', dropType);
            drop.body.setAllowGravity(false);
        }
        if (resType === 'tree') {
            this._trackObjective('trees_chopped', 1);
            const stump = this.add.image(ox, oy + 8, 'stump').setDepth(2);
            this.time.delayedCall(30000, () => stump.destroy());
            // Update walkability grid — chopped tree opens path
            const ttx = Math.floor(ox / CONFIG.TILE_SIZE);
            const tty = Math.floor(oy / CONFIG.TILE_SIZE);
            if (this._walkGrid && this._occupiedTiles) {
                this._occupiedTiles.delete(`${ttx},${tty}`);
                this._walkGrid[tty * this._gridSize + ttx] = 1;
            }
        }
        if (resType === 'stone') this._trackObjective('stones_mined', 1);
        obj.destroy();

        // Track destroyed resources so rejoining players get the right map state
        this._destroyedResources.push({ resType, x: Math.round(ox), y: Math.round(oy) });

        // Broadcast to peers so they remove the same resource
        if (broadcast && network.peerCount > 0) {
            network.broadcastReliable({
                t: 'rd', resType, x: Math.round(ox), y: Math.round(oy),
            });
        }
    }

    // Handle resource destroyed by peer — remove resource but don't create drops
    // (drops belong to the player who chopped; avoids random position desync)
    _onResourceDestroyed(resType, x, y) {
        const group = resType === 'tree' ? this.trees :
                      resType === 'stone' ? this.stones : this.metals;
        // Find closest matching resource
        let closest = null, closestDist = 20;
        for (const obj of group.children.entries) {
            if (!obj.active) continue;
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y);
            if (d < closestDist) { closestDist = d; closest = obj; }
        }
        if (closest) {
            const ox = closest.x, oy = closest.y;
            // Track destroyed resource for rejoin sync
            this._destroyedResources.push({ resType, x: Math.round(ox), y: Math.round(oy) });
            // Visual stump for trees
            if (resType === 'tree') {
                const stump = this.add.image(ox, oy + 8, 'stump').setDepth(2);
                this.time.delayedCall(30000, () => stump.destroy());
            }
            // Update walkability grid
            const ttx = Math.floor(ox / CONFIG.TILE_SIZE);
            const tty = Math.floor(oy / CONFIG.TILE_SIZE);
            if (this._walkGrid && this._occupiedTiles) {
                this._occupiedTiles.delete(`${ttx},${tty}`);
                this._walkGrid[tty * this._gridSize + ttx] = 1;
            }
            closest.destroy();
        }
    }

    // --------------------------------------------------------
    // Proximity Healing — idle near another player for 3s to heal
    // --------------------------------------------------------
    updateProximityHealing(dt) {
        if (this.remotePlayers.size === 0 || gameState.hp >= CONFIG.PLAYER_MAX_HP) {
            this._proximityIdleTime = 0;
            return;
        }

        const p = this.player;
        const isIdle = Math.abs(p.body.velocity.x) < 5 && Math.abs(p.body.velocity.y) < 5;
        if (!isIdle) { this._proximityIdleTime = 0; return; }

        // Check if any remote player is nearby (within 80px)
        let nearbyPlayer = null;
        for (const [, remote] of this.remotePlayers) {
            const d = Phaser.Math.Distance.Between(p.x, p.y, remote.sprite.x, remote.sprite.y);
            if (d < 80) { nearbyPlayer = remote; break; }
        }

        if (!nearbyPlayer) { this._proximityIdleTime = 0; return; }

        this._proximityIdleTime += dt;
        if (this._proximityIdleTime < 3) return;

        // Heal every 0.8 seconds
        this._healTickTimer += dt;
        if (this._healTickTimer >= 0.8) {
            this._healTickTimer = 0;
            const healAmount = 3;
            gameState.hp = Math.min(CONFIG.PLAYER_MAX_HP, gameState.hp + healAmount);
            // Green + floating text at player position
            this.showFloatingText(p.x, p.y - 30, '+' + healAmount, '#00FF66');
            // Also show a + near the other player
            this.showFloatingText(nearbyPlayer.sprite.x, nearbyPlayer.sprite.y - 30, '+', '#00FF66');
        }
    }

    // --------------------------------------------------------
    // Bonfires
    // --------------------------------------------------------
    updateBonfires(dt) {
        for (const bonfire of this.bonfires) {
            let fuel = bonfire.getData('fuel');
            fuel -= CONFIG.BONFIRE_BURN_RATE * dt;
            if (fuel < 0) fuel = 0;
            bonfire.setData('fuel', fuel);

            // Update particle emission rate based on fuel
            const emitter = bonfire.getData('emitter');
            const fuelRatio = fuel / bonfire.getData('maxFuel');
            if (emitter) {
                emitter.frequency = fuelRatio > 0.1 ? 40 - fuelRatio * 20 : 200;
                emitter.setQuantity(fuelRatio > 0.3 ? 2 : 1);
            }

        }

        // Update fire crackle based on distance to nearest bonfire
        let nearestFireDist = Infinity;
        for (const bonfire of this.bonfires) {
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, bonfire.x, bonfire.y);
            if (d < nearestFireDist) nearestFireDist = d;
        }
        audioEngine.updateFireProximity(nearestFireDist);
    }

    getLightRadius(bonfire) {
        const fuelRatio = bonfire.getData('fuel') / bonfire.getData('maxFuel');
        const base = bonfire.getData('isMain') ? CONFIG.BONFIRE_BASE_RADIUS : (BUILDINGS.OUTPOST.lightRadius || 180);
        const flicker = 1.0 + Math.sin(this.time.now * 0.008) * 0.03 + Math.sin(this.time.now * 0.013) * 0.02;
        // Fire level multiplier: each level significantly increases radius
        const campLevel = bonfire.getData('campFireLevel') || 1;
        const isUpgradeable = bonfire.getData('isMain') || bonfire.getData('isSecondCamp');
        const levelMult = isUpgradeable ? (1.0 + (campLevel - 1) * 0.5) : 1.0;
        const scaledRatio = Math.sqrt(fuelRatio);
        return Math.max(CONFIG.BONFIRE_MIN_RADIUS, base * scaledRatio * flicker * levelMult);
    }

    // --------------------------------------------------------
    // Fog of War
    // --------------------------------------------------------
    // Convert world coords to screen coords for fog canvas
    worldToScreen(worldX, worldY) {
        const cam = this.cameras.main;
        return {
            x: (worldX - cam.scrollX) * cam.zoom,
            y: (worldY - cam.scrollY) * cam.zoom,
        };
    }

    updateFogOfWar() {
        const ctx = this.fogCtx;
        const w = this.fogCanvas.width;
        const h = this.fogCanvas.height;

        // Sync fog canvas size with actual game canvas
        const gameW = this.scale.width;
        const gameH = this.scale.height;
        if (this.fogCanvas.width !== gameW || this.fogCanvas.height !== gameH) {
            this.fogCanvas.width = gameW;
            this.fogCanvas.height = gameH;
        }

        // Fill with darkness
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(2, 1, 5, 0.97)';
        ctx.fillRect(0, 0, gameW, gameH);

        // Punch light holes
        ctx.globalCompositeOperation = 'destination-out';

        for (const bonfire of this.bonfires) {
            const radius = this.getLightRadius(bonfire);
            const { x: bx, y: by } = this.worldToScreen(bonfire.x, bonfire.y);

            const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
            gradient.addColorStop(0, 'rgba(0,0,0,1)');
            gradient.addColorStop(0.5, 'rgba(0,0,0,0.8)');
            gradient.addColorStop(0.75, 'rgba(0,0,0,0.3)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(bx, by, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Player has a small personal light
        const { x: px, y: py } = this.worldToScreen(this.player.x, this.player.y);
        const playerLight = 60;
        const pg = ctx.createRadialGradient(px, py, 0, px, py, playerLight);
        pg.addColorStop(0, 'rgba(0,0,0,0.85)');
        pg.addColorStop(0.5, 'rgba(0,0,0,0.4)');
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, playerLight, 0, Math.PI * 2);
        ctx.fill();

        // Remote players also have small personal light
        for (const [, remote] of this.remotePlayers) {
            const { x: rpx, y: rpy } = this.worldToScreen(remote.sprite.x, remote.sprite.y);
            const rpg = ctx.createRadialGradient(rpx, rpy, 0, rpx, rpy, 40);
            rpg.addColorStop(0, 'rgba(0,0,0,0.5)');
            rpg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rpg;
            ctx.beginPath();
            ctx.arc(rpx, rpy, 40, 0, Math.PI * 2);
            ctx.fill();
        }

        // Add warm color tint to lit areas
        ctx.globalCompositeOperation = 'source-atop';
        for (const bonfire of this.bonfires) {
            const radius = this.getLightRadius(bonfire);
            const { x: bx, y: by } = this.worldToScreen(bonfire.x, bonfire.y);
            const tg = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
            tg.addColorStop(0, 'rgba(255, 120, 40, 0.12)');
            tg.addColorStop(0.5, 'rgba(255, 80, 20, 0.06)');
            tg.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = tg;
            ctx.beginPath();
            ctx.arc(bx, by, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Copy to Phaser texture
        const fogW = this.fogTexture.width;
        const fogH = this.fogTexture.height;
        this.fogTexture.context.clearRect(0, 0, fogW, fogH);
        this.fogTexture.context.drawImage(this.fogCanvas, 0, 0);
        this.fogTexture.refresh();
    }

    // --------------------------------------------------------
    // Darkness damage
    // --------------------------------------------------------
    updateDarknessDamage(dt) {
        const p = this.player;
        let inLight = false;
        for (const bonfire of this.bonfires) {
            const dist = Phaser.Math.Distance.Between(p.x, p.y, bonfire.x, bonfire.y);
            const radius = this.getLightRadius(bonfire);
            if (dist < radius * 0.85) {
                inLight = true;
                break;
            }
        }

        if (!inLight) {
            p.darknessTick += dt * 1000;
            if (p.darknessTick >= CONFIG.DARKNESS_DAMAGE_DELAY) {
                p.darknessTick = 0;
                this.damagePlayer(CONFIG.DARKNESS_DAMAGE);
                this.showFloatingText(p.x, p.y - 30, 'DARKNESS!', '#8844CC');
            }
        } else {
            p.darknessTick = 0;
        }
    }

    damagePlayer(amount) {
        if (this.player.invincible > 0) return;
        const reduced = Math.max(1, Math.floor(amount * (1 - gameState.armor)));
        gameState.hp -= reduced;
        this.player.invincible = 500;
        this.cameras.main.flash(100, 80, 0, 0);
        audioEngine.playPlayerHurt();

        if (gameState.hp <= 0) {
            gameState.hp = 0;
            this.doGameOver();
        }
    }

    doGameOver() {
        gameState.gameOver = true;
        this.player.setVelocity(0, 0);
        const goScreen = document.getElementById('game-over-screen');
        const goStats = document.getElementById('game-over-stats');
        const objDone = this._objectives ? this._objectives.filter(o => o.completed).length : 0;
        const objTotal = this._objectives ? this._objectives.length : 0;
        goStats.textContent = `Survived ${Math.floor(gameState.time)}s | Killed ${gameState.kills} enemies | Wave ${gameState.waveNumber} | Objectives ${objDone}/${objTotal}`;
        goScreen.style.display = 'flex';
        audioEngine.playGameOver();
        audioEngine.stopLoop('music', 1000);
        audioEngine.stopLoop('fire_crackle', 500);
        audioEngine.stopLoop('ambient', 1000);
        audioEngine.stopFootsteps();
    }

    // --------------------------------------------------------
    // Enemy System
    // --------------------------------------------------------
    updateSpawning(dt) {
        // Only host spawns enemies
        if (!network.isHost) return;
        // Don't spawn enemies until any camp has been fueled at least once
        const anyFueled = this.bonfires.some(b => (b.getData('campFuelAdded') || 0) >= 1);
        if (!anyFueled) return;

        this.spawnTimer += dt * 1000;
        this.waveTimer += dt;

        // Wave progression every 30 seconds
        const newWave = Math.floor(this.waveTimer / 30);
        if (newWave > gameState.waveNumber) {
            gameState.waveNumber = newWave;
            this.showFloatingText(this.player.x, this.player.y - 60, `WAVE ${gameState.waveNumber}`, '#FF4444');
            audioEngine.playWave();
            this._trackObjective('waves_survived', 1);
        }

        // Base spawns: normal enemies from the darkness
        const maxLevel = gameState.fireLevel;
        if (this.spawnTimer >= CONFIG.SPAWN_INTERVAL && this.enemies.countActive() < CONFIG.MAX_ENEMIES) {
            this.spawnTimer = 0;
            const count = gameState.waveNumber < 3 ? 1 : Math.min(2, Math.floor(gameState.waveNumber / 3));
            for (let i = 0; i < count; i++) {
                this.spawnEnemy();
            }
        }

        // Raid spawns: tower-defense waves from level 2+ of ANY camp
        if (maxLevel >= 2) {
            this.raidSpawnTimer = (this.raidSpawnTimer || 0) + dt * 1000;
            // Faster raids at higher levels, more aggressive scaling
            const raidInterval = CONFIG.RAID_SPAWN_INTERVAL / (1 + (maxLevel - 2) * 0.4);
            if (this.raidSpawnTimer >= raidInterval && this.enemies.countActive() < CONFIG.MAX_ENEMIES + 8) {
                this.raidSpawnTimer = 0;
                // More raiders at higher levels (2-4)
                const raidCount = Math.min(4, 1 + Math.floor((maxLevel - 1)));
                // Target a random fueled camp
                const fueledCamps = this.bonfires.filter(b =>
                    (b.getData('campFuelAdded') || 0) >= 1 && b.getData('fuel') > 0
                );
                const targetCamp = fueledCamps.length > 0
                    ? fueledCamps[Math.floor(Math.random() * fueledCamps.length)]
                    : this.bonfires[0];

                for (let i = 0; i < raidCount; i++) {
                    this.spawnRaider(targetCamp);
                }
            }
        }
    }

    spawnEnemy() {
        const mainBonfire = this.bonfires[0];
        const fuelRatio = mainBonfire.getData('fuel') / mainBonfire.getData('maxFuel');
        const lightLevel = Math.max(1, Math.ceil(fuelRatio * 4));

        // Pick enemy type based on light level + wave
        let type;
        const roll = Math.random();
        const waveBonus = Math.min(gameState.waveNumber * 0.05, 0.4);

        if (lightLevel <= 1) {
            type = roll < 0.85 - waveBonus ? 'SHADOW_WISP' : 'SHADOW_STALKER';
        } else if (lightLevel <= 2) {
            if (roll < 0.45) type = 'SHADOW_WISP';
            else if (roll < 0.88 - waveBonus) type = 'SHADOW_STALKER';
            else type = 'SHADOW_BEAST';
        } else if (lightLevel <= 3) {
            if (roll < 0.2) type = 'SHADOW_WISP';
            else if (roll < 0.45) type = 'SHADOW_STALKER';
            else if (roll < 0.6) type = 'SHADOW_ARCHER';
            else if (roll < 0.72) type = 'VOID_MAGE';
            else if (roll < 0.92 - waveBonus) type = 'SHADOW_BEAST';
            else type = 'SHADOW_LORD';
        } else {
            if (roll < 0.1) type = 'FOG_CRAWLER';
            else if (roll < 0.25) type = 'SHADOW_WISP';
            else if (roll < 0.45) type = 'SHADOW_STALKER';
            else if (roll < 0.58) type = 'SHADOW_ARCHER';
            else if (roll < 0.7) type = 'VOID_MAGE';
            else if (roll < 0.9 - waveBonus) type = 'SHADOW_BEAST';
            else type = 'SHADOW_LORD';
        }

        const stats = ENEMIES[type];
        const radius = this.getLightRadius(mainBonfire);

        // Spawn in free space (try multiple positions, avoid trees)
        let sx, sy;
        for (let attempt = 0; attempt < 10; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = radius + CONFIG.SPAWN_MARGIN + Math.random() * 100;
            sx = mainBonfire.x + Math.cos(angle) * dist;
            sy = mainBonfire.y + Math.sin(angle) * dist;
            // Check tile isn't occupied by a tree
            const ttx = Math.floor(sx / CONFIG.TILE_SIZE);
            const tty = Math.floor(sy / CONFIG.TILE_SIZE);
            if (!this._occupiedTiles || !this._occupiedTiles.has(`${ttx},${tty}`)) break;
        }

        const textureKey = {
            SHADOW_WISP: 'enemy_wisp',
            SHADOW_STALKER: 'enemy_stalker',
            SHADOW_BEAST: 'enemy_beast',
            SHADOW_LORD: 'enemy_lord',
            FOG_CRAWLER: 'enemy_crawler',
            SHADOW_ARCHER: 'enemy_archer',
            VOID_MAGE: 'enemy_mage',
        }[type];

        const enemyId = this._enemyIdCounter++;
        const enemy = this.enemies.create(sx, sy, textureKey);
        enemy.setDepth(5);
        enemy.setData('enemyId', enemyId);
        enemy.setData('type', type);
        enemy.setData('hp', stats.hp + gameState.waveNumber * 2);
        enemy.setData('maxHp', stats.hp + gameState.waveNumber * 2);
        enemy.setData('damage', stats.damage);
        enemy.setData('speed', stats.speed);
        enemy.setData('size', stats.size);
        enemy.setData('xp', stats.xp);
        enemy.setData('targetsFire', stats.targetsFire || false);
        enemy.setData('ranged', stats.ranged || false);
        enemy.setData('attackCooldown', 0);
        enemy.setData('aggro', false);
        enemy.setData('wanderAngle', Math.random() * Math.PI * 2);
        enemy.setData('wanderTimer', 0);
        enemy.body.setAllowGravity(false);

        // Subtle entrance: fade in
        enemy.setAlpha(0);
        this.tweens.add({ targets: enemy, alpha: 0.85, duration: 600 });

        // Roar on spawn (30% chance, not every enemy)
        if (Math.random() < 0.3) audioEngine.playEnemyRoar();

        // Broadcast spawn to clients
        if (network.isHost && network.peerCount > 0) {
            network.broadcastReliable({
                t: 'es', id: enemyId, type, x: Math.round(sx), y: Math.round(sy),
                hp: enemy.getData('hp'),
            });
        }

        return enemy;
    }

    // Spawn a raider — spawns far in the dark, marches toward camp
    spawnRaider(targetCamp) {
        const target = targetCamp || this.bonfires[0];
        const lightRadius = this.getLightRadius(target);

        // Pick raider type based on fire level
        let type;
        const roll = Math.random();
        if (gameState.fireLevel <= 2) {
            type = roll < 0.6 ? 'SHADOW_WISP' : 'SHADOW_STALKER';
        } else if (gameState.fireLevel <= 3) {
            if (roll < 0.2) type = 'SHADOW_WISP';
            else if (roll < 0.45) type = 'SHADOW_STALKER';
            else if (roll < 0.65) type = 'SHADOW_ARCHER';
            else if (roll < 0.8) type = 'VOID_MAGE';
            else type = 'SHADOW_BEAST';
        } else {
            if (roll < 0.1) type = 'SHADOW_WISP';
            else if (roll < 0.3) type = 'SHADOW_STALKER';
            else if (roll < 0.45) type = 'SHADOW_ARCHER';
            else if (roll < 0.6) type = 'VOID_MAGE';
            else if (roll < 0.85) type = 'SHADOW_BEAST';
            else type = 'SHADOW_LORD';
        }

        const stats = ENEMIES[type];

        // Spawn far outside light — try positions that have a valid path to camp
        let sx, sy, path = null;
        for (let attempt = 0; attempt < 15; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = lightRadius + 60 + Math.random() * 120;
            sx = target.x + Math.cos(angle) * dist;
            sy = target.y + Math.sin(angle) * dist;
            const ttx = Math.floor(sx / CONFIG.TILE_SIZE);
            const tty = Math.floor(sy / CONFIG.TILE_SIZE);
            if (this._occupiedTiles && this._occupiedTiles.has(`${ttx},${tty}`)) continue;

            // Verify path exists to camp
            path = this._findPath(sx, sy, target.x, target.y);
            if (path && path.length > 0) break;
            path = null;
        }
        // No valid path found — skip this raider
        if (!path) return null;

        const textureKey = {
            SHADOW_WISP: 'enemy_wisp', SHADOW_STALKER: 'enemy_stalker',
            SHADOW_BEAST: 'enemy_beast', SHADOW_LORD: 'enemy_lord',
            FOG_CRAWLER: 'enemy_crawler',
            SHADOW_ARCHER: 'enemy_archer', VOID_MAGE: 'enemy_mage',
        }[type];

        const enemyId = this._enemyIdCounter++;
        const enemy = this.enemies.create(sx, sy, textureKey);
        enemy.setDepth(5);
        enemy.setData('enemyId', enemyId);
        enemy.setData('type', type);
        enemy.setData('hp', stats.hp + gameState.waveNumber * 2);
        enemy.setData('maxHp', stats.hp + gameState.waveNumber * 2);
        enemy.setData('damage', stats.damage);
        enemy.setData('speed', stats.speed * 1.1); // raiders are slightly faster
        enemy.setData('size', stats.size);
        enemy.setData('xp', stats.xp);
        enemy.setData('targetsFire', false);
        enemy.setData('ranged', stats.ranged || false);
        enemy.setData('attackCooldown', 0);
        enemy.setData('aggro', false);
        // Raider-specific data
        enemy.setData('isRaider', true);
        enemy.setData('raidMode', 'march'); // 'march' = heading to camp, 'chase' = chasing player
        enemy.setData('raidTargetX', target.x);
        enemy.setData('raidTargetY', target.y);
        // Pathfinding waypoints
        enemy.setData('raidPath', path);
        enemy.setData('raidPathIdx', 0);
        enemy.body.setAllowGravity(false);

        enemy.setAlpha(0);
        this.tweens.add({ targets: enemy, alpha: 0.85, duration: 600 });

        // Broadcast spawn to clients
        if (network.isHost && network.peerCount > 0) {
            network.broadcastReliable({
                t: 'es', id: enemyId, type, x: Math.round(sx), y: Math.round(sy),
                hp: enemy.getData('hp'), raider: true,
                rtx: Math.round(mainBonfire.x), rty: Math.round(mainBonfire.y),
            });
        }

        return enemy;
    }

    // --------------------------------------------------------
    // Rain System
    // --------------------------------------------------------
    updateRain(dt) {
        if (gameState.fireLevel < CONFIG.RAIN_START_LEVEL) return;

        if (this._rainActive) {
            this._rainTimer += dt;

            // Host: drain fuel and check level
            if (network.isHost) {
                for (const bonfire of this.bonfires) {
                    if (!bonfire.getData('lit') && bonfire.getData('isSecondCamp')) continue;
                    const fuel = bonfire.getData('fuel');
                    if (fuel > 0) {
                        bonfire.setData('fuel', Math.max(0, fuel - CONFIG.RAIN_FUEL_DRAIN * dt));
                    }
                }

                // Check fire level downgrade based on current main bonfire fuel
                const mainFuel = this.bonfires[0] ? this.bonfires[0].getData('fuel') : 0;
                if (mainFuel <= 0 && gameState.fireLevel > 1) {
                    gameState.fireLevel = Math.max(1, gameState.fireLevel - 1);
                    this.showFloatingText(this.player.x, this.player.y - 50,
                        `FIRE WEAKENING! Lv.${gameState.fireLevel}`, '#FF4444');
                }
            }

            // All clients: update rain visuals
            if (this._rainEmitter) {
                const cam = this.cameras.main;
                this._rainEmitter.setPosition(cam.scrollX + cam.width / 2, cam.scrollY - 20);
            }
            if (this._rainOverlay) {
                const cam = this.cameras.main;
                this._rainOverlay.setPosition(cam.scrollX, cam.scrollY);
            }

            // Host decides when rain ends
            if (network.isHost && this._rainTimer >= this._rainDuration) {
                this._stopRain();
            }
        } else if (network.isHost) {
            // Only host decides when rain starts
            this._nextRainIn -= dt;
            if (this._nextRainIn <= 0) {
                this._startRain();
            }
        }
    }

    _startRain() {
        this._rainActive = true;
        this._rainTimer = 0;
        this._rainDuration = CONFIG.RAIN_DURATION_MIN +
            Math.random() * (CONFIG.RAIN_DURATION_MAX - CONFIG.RAIN_DURATION_MIN);

        // Rain particle emitter — covers screen area
        const cam = this.cameras.main;
        this._rainEmitter = this.add.particles(cam.scrollX + cam.width / 2, cam.scrollY - 20, 'particle', {
            angle: { min: 85, max: 95 },
            speed: { min: 300, max: 500 },
            lifespan: { min: 600, max: 1000 },
            scale: { start: 0.15, end: 0.05 },
            alpha: { start: 0.5, end: 0.1 },
            tint: [0x6688CC, 0x5577AA, 0x4466BB, 0x88AADD],
            blendMode: 'ADD',
            frequency: 3,
            quantity: 4,
            emitZone: {
                type: 'random',
                source: new Phaser.Geom.Rectangle(-cam.width / 2 - 50, 0, cam.width + 100, 10),
            },
        });
        this._rainEmitter.setDepth(95).setScrollFactor(0);

        // Dark overlay for atmosphere
        this._rainOverlay = this.add.graphics();
        this._rainOverlay.fillStyle(0x112233, 0.15);
        this._rainOverlay.fillRect(0, 0, cam.width, cam.height);
        this._rainOverlay.setDepth(94).setScrollFactor(0);
        this._rainOverlay.setAlpha(0);
        this.tweens.add({ targets: this._rainOverlay, alpha: 1, duration: 3000 });

        // Start rain audio
        audioEngine.startLoop('rain', 2000);

        // Notification
        this.showFloatingText(this.player.x, this.player.y - 60, 'RAIN INCOMING!', '#6688CC');

        // Broadcast to peers
        if (network.peerCount > 0) {
            network.broadcastReliable({ t: 'rn', active: true, dur: Math.round(this._rainDuration) });
        }
    }

    _stopRain() {
        this._rainActive = false;
        this._nextRainIn = CONFIG.RAIN_MIN_INTERVAL +
            Math.random() * (CONFIG.RAIN_MAX_INTERVAL - CONFIG.RAIN_MIN_INTERVAL);

        // Fade out and destroy rain
        if (this._rainEmitter) {
            this._rainEmitter.stop();
            this.time.delayedCall(1200, () => {
                if (this._rainEmitter) { this._rainEmitter.destroy(); this._rainEmitter = null; }
            });
        }
        if (this._rainOverlay) {
            this.tweens.add({
                targets: this._rainOverlay, alpha: 0, duration: 3000,
                onComplete: () => { if (this._rainOverlay) { this._rainOverlay.destroy(); this._rainOverlay = null; } },
            });
        }

        audioEngine.stopLoop('rain', 2000);

        this.showFloatingText(this.player.x, this.player.y - 60, 'Rain stopped', '#88AACC');

        if (network.peerCount > 0) {
            network.broadcastReliable({ t: 'rn', active: false });
        }
    }

    // Create enemy from host sync data (client-side)
    _createEnemyFromSync(id, type, x, y, hp) {
        const stats = ENEMIES[type];
        if (!stats) return null;
        const textureKey = {
            SHADOW_WISP: 'enemy_wisp', SHADOW_STALKER: 'enemy_stalker',
            SHADOW_BEAST: 'enemy_beast', SHADOW_LORD: 'enemy_lord',
            FOG_CRAWLER: 'enemy_crawler',
            SHADOW_ARCHER: 'enemy_archer', VOID_MAGE: 'enemy_mage',
        }[type];
        const enemy = this.enemies.create(x, y, textureKey);
        enemy.setDepth(5);
        enemy.setData('enemyId', id);
        enemy.setData('type', type);
        enemy.setData('hp', hp);
        enemy.setData('maxHp', hp);
        enemy.setData('damage', stats.damage);
        enemy.setData('speed', stats.speed);
        enemy.setData('size', stats.size);
        enemy.setData('xp', stats.xp);
        enemy.setData('targetsFire', stats.targetsFire || false);
        enemy.setData('attackCooldown', 0);
        enemy.body.setAllowGravity(false);
        enemy.setAlpha(0);
        this.tweens.add({ targets: enemy, alpha: 0.85, duration: 600 });
        return enemy;
    }

    _findEnemyById(id) {
        for (const e of this.enemies.children.entries) {
            if (e.active && e.getData('enemyId') === id) return e;
        }
        return null;
    }

    updateEnemies(dt) {
        // Clients: only check for enemy attacks on local player (positions come from host)
        if (!network.isHost) {
            for (const enemy of this.enemies.children.entries) {
                if (!enemy.active) continue;
                const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                let cd = enemy.getData('attackCooldown') - dt * 1000;
                enemy.setData('attackCooldown', cd);
                if (dist < enemy.getData('size') + 16 && cd <= 0) {
                    enemy.setData('attackCooldown', 1000);
                    this.damagePlayer(enemy.getData('damage'));
                    this.showFloatingText(this.player.x, this.player.y - 20, `-${enemy.getData('damage')}`, '#FF4444');
                }
            }
            return;
        }

        const SIGHT_RANGE = 250; // pixels — enemies must see player to chase
        const AGGRO_RANGE = 180; // once hit or very close, always aggro
        const WANDER_SPEED = 0.35; // fraction of normal speed when wandering

        const enemyList = [...this.enemies.children.entries];
        for (const enemy of enemyList) {
            if (!enemy.active) continue;

            const targetsFire = enemy.getData('targetsFire');
            const speed = enemy.getData('speed');
            let cd = enemy.getData('attackCooldown') - dt * 1000;
            enemy.setData('attackCooldown', cd);

            if (targetsFire) {
                // Fire-targeting enemies always beeline to nearest bonfire
                let target = null, nearestDist = Infinity;
                for (const b of this.bonfires) {
                    const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, b.x, b.y);
                    if (d < nearestDist) { nearestDist = d; target = b; }
                }
                if (target) {
                    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
                    enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
                    enemy.setFlipX(Math.cos(angle) < 0);
                    if (nearestDist < 30) {
                        const fuel = target.getData('fuel');
                        target.setData('fuel', Math.max(0, fuel - 10));
                        this.showFloatingText(target.x, target.y - 20, '-FUEL', '#4444FF');
                        this.damageEnemy(enemy, 9999);
                    }
                }
            } else if (enemy.getData('ranged')) {
                // RANGED AI: archers and mages — keep distance, shoot projectiles
                const stats = ENEMIES[enemy.getData('type')];
                const atkRange = stats.attackRange || 200;
                const distToPlayer = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                const isRaider = enemy.getData('isRaider');

                // Ranged raiders: march to camp edge then patrol and shoot
                if (isRaider) {
                    const tx = enemy.getData('raidTargetX');
                    const ty = enemy.getData('raidTargetY');
                    const distToTarget = Phaser.Math.Distance.Between(enemy.x, enemy.y, tx, ty);

                    if (distToTarget > atkRange * 0.9) {
                        // Follow pathfinding waypoints toward camp
                        const path = enemy.getData('raidPath');
                        let pathIdx = enemy.getData('raidPathIdx') || 0;
                        if (path && pathIdx < path.length) {
                            const wp = path[pathIdx];
                            if (Phaser.Math.Distance.Between(enemy.x, enemy.y, wp.x, wp.y) < 20) {
                                enemy.setData('raidPathIdx', ++pathIdx);
                            }
                        }
                        const wp = (path && pathIdx < path.length) ? path[pathIdx] : { x: tx, y: ty };
                        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, wp.x, wp.y);
                        enemy.setVelocity(Math.cos(angle) * speed * 0.7, Math.sin(angle) * speed * 0.7);
                        enemy.setFlipX(Math.cos(angle) < 0);
                    } else {
                        // In range — strafe around target
                        let orbitAngle = enemy.getData('orbitAngle') || Phaser.Math.Angle.Between(tx, ty, enemy.x, enemy.y);
                        orbitAngle += dt * 0.4;
                        enemy.setData('orbitAngle', orbitAngle);
                        const ox = tx + Math.cos(orbitAngle) * atkRange * 0.85;
                        const oy = ty + Math.sin(orbitAngle) * atkRange * 0.85;
                        const moveAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, ox, oy);
                        enemy.setVelocity(Math.cos(moveAngle) * speed * 0.5, Math.sin(moveAngle) * speed * 0.5);
                        enemy.setFlipX(tx < enemy.x);
                    }

                    // Shoot at player if in range, otherwise shoot at bonfire
                    if (cd <= 0) {
                        if (distToPlayer < atkRange) {
                            this._fireProjectile(enemy, this.player.x, this.player.y, stats);
                            enemy.setData('attackCooldown', stats.attackCooldown);
                        } else if (distToTarget < atkRange * 1.2) {
                            this._fireProjectile(enemy, tx, ty, stats);
                            enemy.setData('attackCooldown', stats.attackCooldown);
                        }
                    }
                } else {
                    // Non-raider ranged: patrol light edge, shoot player when visible
                    const mainBonfire = this.bonfires[0];
                    const lightRadius = this.getLightRadius(mainBonfire);
                    const distToFire = Phaser.Math.Distance.Between(enemy.x, enemy.y, mainBonfire.x, mainBonfire.y);
                    const idealDist = lightRadius + 20; // just outside light

                    if (distToPlayer < atkRange) {
                        // Player in range — stop and shoot
                        const fleeDist = atkRange * 0.5;
                        if (distToPlayer < fleeDist) {
                            // Too close — back away
                            const awayAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
                            enemy.setVelocity(Math.cos(awayAngle) * speed, Math.sin(awayAngle) * speed);
                            enemy.setFlipX(this.player.x < enemy.x);
                        } else {
                            // Good range — strafe
                            let orbitAngle = enemy.getData('orbitAngle') || Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
                            orbitAngle += dt * 0.5;
                            enemy.setData('orbitAngle', orbitAngle);
                            const ox = this.player.x + Math.cos(orbitAngle) * atkRange * 0.75;
                            const oy = this.player.y + Math.sin(orbitAngle) * atkRange * 0.75;
                            const moveAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, ox, oy);
                            enemy.setVelocity(Math.cos(moveAngle) * speed * 0.5, Math.sin(moveAngle) * speed * 0.5);
                            enemy.setFlipX(this.player.x < enemy.x);
                        }

                        // Fire projectile
                        if (cd <= 0) {
                            this._fireProjectile(enemy, this.player.x, this.player.y, stats);
                            enemy.setData('attackCooldown', stats.attackCooldown);
                        }
                    } else {
                        // Patrol the light edge
                        let orbitAngle = enemy.getData('orbitAngle') || Phaser.Math.Angle.Between(mainBonfire.x, mainBonfire.y, enemy.x, enemy.y);
                        orbitAngle += dt * 0.3;
                        enemy.setData('orbitAngle', orbitAngle);
                        const patrolX = mainBonfire.x + Math.cos(orbitAngle) * idealDist;
                        const patrolY = mainBonfire.y + Math.sin(orbitAngle) * idealDist;
                        const moveAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, patrolX, patrolY);
                        enemy.setVelocity(Math.cos(moveAngle) * speed * 0.6, Math.sin(moveAngle) * speed * 0.6);
                        enemy.setFlipX(Math.cos(moveAngle) < 0);
                    }
                }
            } else if (enemy.getData('isRaider')) {
                // RAIDER AI: march to camp, but chase player if spotted
                const distToPlayer = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                let raidMode = enemy.getData('raidMode'); // 'march' or 'chase'

                // Spot player → switch to chase
                if (raidMode === 'march' && distToPlayer < CONFIG.RAID_SIGHT_RANGE) {
                    raidMode = 'chase';
                    enemy.setData('raidMode', 'chase');
                    enemy.setData('aggro', true);
                }
                // Lost player → return to march
                if (raidMode === 'chase' && distToPlayer > CONFIG.RAID_LEASH_RANGE) {
                    raidMode = 'march';
                    enemy.setData('raidMode', 'march');
                    enemy.setData('aggro', false);
                }

                if (raidMode === 'chase') {
                    // Chase player
                    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                    enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
                    enemy.setFlipX(Math.cos(angle) < 0);

                    if (distToPlayer < enemy.getData('size') + 16 && cd <= 0) {
                        enemy.setData('attackCooldown', 1000);
                        this.damagePlayer(enemy.getData('damage'));
                        this.showFloatingText(this.player.x, this.player.y - 20, `-${enemy.getData('damage')}`, '#FF4444');
                    }
                } else {
                    // March to camp following pathfinding waypoints
                    const path = enemy.getData('raidPath');
                    let pathIdx = enemy.getData('raidPathIdx') || 0;

                    if (path && pathIdx < path.length) {
                        const wp = path[pathIdx];
                        const distToWP = Phaser.Math.Distance.Between(enemy.x, enemy.y, wp.x, wp.y);
                        if (distToWP < 20) {
                            pathIdx++;
                            enemy.setData('raidPathIdx', pathIdx);
                        }
                        if (pathIdx < path.length) {
                            const nextWP = path[pathIdx];
                            const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, nextWP.x, nextWP.y);
                            enemy.setVelocity(Math.cos(angle) * speed * 0.7, Math.sin(angle) * speed * 0.7);
                            enemy.setFlipX(Math.cos(angle) < 0);
                        }
                    } else {
                        // Reached end of path — head to camp directly
                        const tx = enemy.getData('raidTargetX');
                        const ty = enemy.getData('raidTargetY');
                        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, tx, ty);
                        enemy.setVelocity(Math.cos(angle) * speed * 0.7, Math.sin(angle) * speed * 0.7);
                        enemy.setFlipX(Math.cos(angle) < 0);
                    }

                    // Attack bonfire when close to target
                    const tx = enemy.getData('raidTargetX');
                    const ty = enemy.getData('raidTargetY');
                    const distToTarget = Phaser.Math.Distance.Between(enemy.x, enemy.y, tx, ty);
                    if (distToTarget < CONFIG.RAID_ATTACK_RANGE) {
                        let nearestBonfire = null, nearestDist = 60;
                        for (const b of this.bonfires) {
                            const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, b.x, b.y);
                            if (d < nearestDist) { nearestDist = d; nearestBonfire = b; }
                        }
                        if (nearestBonfire && cd <= 0) {
                            enemy.setData('attackCooldown', 1500);
                            const fuel = nearestBonfire.getData('fuel');
                            nearestBonfire.setData('fuel', Math.max(0, fuel - 3));
                            this.showFloatingText(nearestBonfire.x, nearestBonfire.y - 20, '-FUEL', '#8844FF');
                        }
                    }
                }
            } else {
                // Normal AI: sight-based aggro toward player
                const distToPlayer = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                let aggro = enemy.getData('aggro');

                // Gain aggro: player in sight range or very close
                if (!aggro && (distToPlayer < SIGHT_RANGE || distToPlayer < AGGRO_RANGE)) {
                    aggro = true;
                    enemy.setData('aggro', true);
                }
                // Lose aggro if player gets very far
                if (aggro && distToPlayer > SIGHT_RANGE * 2.5) {
                    aggro = false;
                    enemy.setData('aggro', false);
                }

                if (aggro) {
                    // Chase player
                    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                    enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
                    enemy.setFlipX(Math.cos(angle) < 0);

                    // Attack when close
                    if (distToPlayer < enemy.getData('size') + 16 && cd <= 0) {
                        enemy.setData('attackCooldown', 1000);
                        this.damagePlayer(enemy.getData('damage'));
                        this.showFloatingText(this.player.x, this.player.y - 20, `-${enemy.getData('damage')}`, '#FF4444');
                    }
                } else {
                    // Wander: slow random movement
                    let wt = enemy.getData('wanderTimer') - dt;
                    if (wt <= 0) {
                        wt = 2 + Math.random() * 3;
                        enemy.setData('wanderAngle', Math.random() * Math.PI * 2);
                    }
                    enemy.setData('wanderTimer', wt);
                    const wa = enemy.getData('wanderAngle');
                    enemy.setVelocity(Math.cos(wa) * speed * WANDER_SPEED, Math.sin(wa) * speed * WANDER_SPEED);
                    enemy.setFlipX(Math.cos(wa) < 0);
                }
            }

            // Attack buildings
            const buildings = [...this.buildingsGroup.children.entries];
            for (const building of buildings) {
                if (!building.active) continue;
                const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, building.x, building.y);
                if (d < 30) {
                    let bhp = building.getData('hp') - enemy.getData('damage') * dt;
                    building.setData('hp', bhp);
                    if (bhp <= 0) {
                        this.destroyBuilding(building);
                    }
                }
            }
        }
    }

    drawEnemyHealth() {
        const g = this.enemyHpGraphics;
        g.clear();
        for (const enemy of this.enemies.children.entries) {
            if (!enemy.active) continue;
            const hp = enemy.getData('hp');
            const maxHp = enemy.getData('maxHp');
            if (hp >= maxHp) continue; // full health = no indicator
            const ratio = Math.max(0, hp / maxHp);
            const size = enemy.getData('size') || 14;
            const radius = size * 0.6 + 4;
            const x = enemy.x;
            const y = enemy.y - size - 6;
            // Background circle (dark)
            g.lineStyle(2.5, 0x000000, 0.5);
            g.beginPath();
            g.arc(x, y, radius, 0, Math.PI * 2);
            g.strokePath();
            // Health arc (pac-man style: colored arc proportional to remaining HP)
            const color = ratio > 0.5 ? 0x44FF44 : ratio > 0.25 ? 0xFFAA00 : 0xFF3333;
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + ratio * Math.PI * 2;
            g.lineStyle(2.5, color, 0.85);
            g.beginPath();
            g.arc(x, y, radius, startAngle, endAngle);
            g.strokePath();
        }
    }

    damageEnemy(enemy, amount) {
        const enemyId = enemy.getData('enemyId');

        // Client: send damage to host, show visual feedback only
        if (!network.isHost) {
            network.sendEnemyDamage(enemyId, amount);
            this.showFloatingText(enemy.x, enemy.y - 20, `-${amount}`, '#FFAA00');
            enemy.setTint(0xFFFFFF);
            this.time.delayedCall(80, () => { if (enemy.active) enemy.clearTint(); });
            return;
        }

        // Host: apply damage authoritatively
        let hp = enemy.getData('hp') - amount;
        enemy.setData('hp', hp);
        enemy.setData('aggro', true); // always aggro when hit
        if (enemy.getData('isRaider')) enemy.setData('raidMode', 'chase'); // raiders chase when hit
        this.showFloatingText(enemy.x, enemy.y - 20, `-${amount}`, '#FFAA00');

        // Flash white
        enemy.setTint(0xFFFFFF);
        this.time.delayedCall(80, () => {
            if (enemy.active) enemy.clearTint();
        });

        // Knockback
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        enemy.setVelocity(Math.cos(angle) * 200, Math.sin(angle) * 200);

        if (hp <= 0) {
            this._killEnemy(enemy);
        }
    }

    _killEnemy(enemy) {
        const enemyId = enemy.getData('enemyId');
        gameState.kills++;
        audioEngine.playEnemyDeath();

        // Track objectives
        this._trackObjective('enemies_killed', 1);
        const enemyType = enemy.getData('type');
        if (enemy.getData('isRaider')) this._trackObjective('raiders_killed', 1);
        if (enemyType === 'SHADOW_ARCHER') this._trackObjective('archers_killed', 1);
        if (enemyType === 'VOID_MAGE') this._trackObjective('mages_killed', 1);

        // Drop gold
        const goldAmount = ENEMIES[enemyType] ? ENEMIES[enemyType].gold || 1 : 1;
        for (let i = 0; i < goldAmount; i++) {
            const drop = this.drops.create(
                enemy.x + Phaser.Math.Between(-14, 14),
                enemy.y + Phaser.Math.Between(-14, 14),
                'gold_drop'
            );
            drop.setDepth(3);
            drop.setData('resourceType', 'gold');
            drop.body.setAllowGravity(false);
        }

        // Death particles
        const emitter = this.add.particles(enemy.x, enemy.y, 'particle', {
            speed: { min: 30, max: 80 },
            lifespan: 500,
            scale: { start: 0.4, end: 0 },
            alpha: { start: 0.7, end: 0 },
            tint: [0x220033, 0x440066, 0x110022],
            quantity: 8,
            blendMode: 'ADD',
            emitting: false,
        });
        emitter.explode(8);
        this.time.delayedCall(600, () => emitter.destroy());

        // Broadcast death to clients
        if (network.isHost) {
            network.broadcastEnemyDeath(enemyId);
        }

        // Clean up prev state cache to prevent memory leak
        if (this._prevEnemyState) delete this._prevEnemyState[enemyId];

        enemy.destroy();
    }

    // Client: handle enemy death from host
    _onEnemyDied(enemyId) {
        const enemy = this._findEnemyById(enemyId);
        if (!enemy) return;
        gameState.kills++;
        this._trackObjective('enemies_killed', 1);
        const eType = enemy.getData('type');
        if (enemy.getData('isRaider')) this._trackObjective('raiders_killed', 1);
        if (eType === 'SHADOW_ARCHER') this._trackObjective('archers_killed', 1);
        if (eType === 'VOID_MAGE') this._trackObjective('mages_killed', 1);
        audioEngine.playEnemyDeath();

        // Death particles
        const emitter = this.add.particles(enemy.x, enemy.y, 'particle', {
            speed: { min: 30, max: 80 },
            lifespan: 500,
            scale: { start: 0.4, end: 0 },
            alpha: { start: 0.7, end: 0 },
            tint: [0x220033, 0x440066, 0x110022],
            quantity: 8,
            blendMode: 'ADD',
            emitting: false,
        });
        emitter.explode(8);
        this.time.delayedCall(600, () => emitter.destroy());

        // Drop gold locally for client
        const enemyType = enemy.getData('type');
        const goldAmount = ENEMIES[enemyType] ? ENEMIES[enemyType].gold || 1 : 1;
        for (let i = 0; i < goldAmount; i++) {
            const drop = this.drops.create(
                enemy.x + Phaser.Math.Between(-14, 14),
                enemy.y + Phaser.Math.Between(-14, 14),
                'gold_drop'
            );
            drop.setDepth(3);
            drop.setData('resourceType', 'gold');
            drop.body.setAllowGravity(false);
        }

        enemy.destroy();
    }

    // --------------------------------------------------------
    // NPC Allies
    // --------------------------------------------------------
    updateAllies(dt) {
        this.allies.children.entries.forEach(ally => {
            if (!ally.active) return;

            // Find nearest enemy
            let nearestEnemy = null;
            let nearestDist = 200; // patrol radius
            this.enemies.children.entries.forEach(e => {
                if (!e.active) return;
                const d = Phaser.Math.Distance.Between(ally.x, ally.y, e.x, e.y);
                if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
            });

            if (nearestEnemy) {
                const angle = Phaser.Math.Angle.Between(ally.x, ally.y, nearestEnemy.x, nearestEnemy.y);
                ally.setVelocity(Math.cos(angle) * 100, Math.sin(angle) * 100);
                ally.setFlipX(Math.cos(angle) < 0);

                // Attack
                let cd = ally.getData('attackCooldown') - dt * 1000;
                ally.setData('attackCooldown', cd);
                if (nearestDist < 30 && cd <= 0) {
                    ally.setData('attackCooldown', 800);
                    this.damageEnemy(nearestEnemy, 12);
                }
            } else {
                // Patrol near home bonfire
                const home = ally.getData('home');
                const distHome = Phaser.Math.Distance.Between(ally.x, ally.y, home.x, home.y);
                if (distHome > 120) {
                    const angle = Phaser.Math.Angle.Between(ally.x, ally.y, home.x, home.y);
                    ally.setVelocity(Math.cos(angle) * 50, Math.sin(angle) * 50);
                } else {
                    // Wander
                    if (Math.random() < 0.02) {
                        const wa = Math.random() * Math.PI * 2;
                        ally.setVelocity(Math.cos(wa) * 30, Math.sin(wa) * 30);
                    }
                }
            }
        });
    }

    // Place a building at a build spot (shared by local build + network sync)
    _placeBuilding(type, x, y) {
        const building = BUILDINGS[type];
        if (!building) return;

        const texKey = 'building_' + type.toLowerCase();
        const placed = this.buildingsGroup.create(x, y, texKey);
        placed.setDepth(4);
        placed.setData('type', type);
        placed.setData('hp', building.hp);
        if (building.attackRange) {
            placed.setData('attackRange', building.attackRange);
            placed.setData('attackDamage', building.attackDamage);
            placed.setData('attackSpeed', building.attackSpeed);
            placed.setData('lastAttack', 0);
        }
        gameState.buildings.push({ type, x, y });
        this._trackObjective('buildings_built', 1);

        // Handle building effects
        if (type === 'OUTPOST') {
            this.createBonfire(x, y, false);
        }

        // Mark matching build spot as built
        for (const spot of this.buildSpots) {
            if (!spot.built && Math.abs(spot.x - x) < 5 && Math.abs(spot.y - y) < 5) {
                spot.built = true;
                spot.sprite.destroy();
                spot.label.destroy();
                spot.costText.destroy();
                break;
            }
        }

        this.showFloatingText(x, y - 20, `Built ${building.name}!`, '#00FF88');
    }

    // --------------------------------------------------------
    // Turret Auto-Attack
    // --------------------------------------------------------
    updateTurrets(dt) {
        if (!network.isHost) return; // turret damage is host-authoritative
        const buildings = this.buildingsGroup.children.entries;
        for (const b of buildings) {
            if (!b.active) continue;
            const range = b.getData('attackRange');
            if (!range) continue; // not a turret

            let cd = (b.getData('lastAttack') || 0) - dt * 1000;
            b.setData('lastAttack', cd);
            if (cd > 0) continue;

            // Find nearest enemy in range
            let nearest = null;
            let nearestDist = range;
            for (const e of this.enemies.children.entries) {
                if (!e.active) continue;
                const d = Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y);
                if (d < nearestDist) { nearestDist = d; nearest = e; }
            }

            if (nearest) {
                b.setData('lastAttack', b.getData('attackSpeed') || 1200);
                const dmg = b.getData('attackDamage') || 8;
                this.damageEnemy(nearest, dmg);

                // Visual: projectile line flash
                const line = this.add.graphics();
                line.lineStyle(2, 0xFF4400, 0.8);
                line.beginPath();
                line.moveTo(b.x, b.y - 8);
                line.lineTo(nearest.x, nearest.y);
                line.strokePath();
                line.setDepth(10);
                this.tweens.add({ targets: line, alpha: 0, duration: 150, onComplete: () => line.destroy() });
            }
        }
    }

    // --------------------------------------------------------
    // Enemy Projectiles
    // --------------------------------------------------------
    _fireProjectile(enemy, targetX, targetY, stats, fromNetwork = false) {
        const projType = stats.projectileType || 'arrow';
        const texKey = projType === 'magic' ? 'proj_magic' : 'proj_arrow';
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, targetX, targetY);
        const spd = stats.projectileSpeed || 200;

        // Broadcast to clients so they see projectiles
        if (!fromNetwork && network.isHost && network.peerCount > 0) {
            network.broadcastReliable({
                t: 'ep', x: Math.round(enemy.x), y: Math.round(enemy.y),
                tx: Math.round(targetX), ty: Math.round(targetY),
                spd, dmg: stats.damage, pt: projType,
            });
        }

        const proj = this.projectiles.create(enemy.x, enemy.y, texKey);
        proj.setDepth(8);
        proj.body.setAllowGravity(false);
        proj.setVelocity(Math.cos(angle) * spd, Math.sin(angle) * spd);
        proj.setRotation(angle);
        proj.setData('damage', stats.damage);
        proj.setData('projType', projType);
        proj.setData('lifetime', 0);

        // Attach trailing particle emitter
        const tintColor = projType === 'magic' ? [0xAA44FF, 0x8800FF, 0xDD88FF] : [0xFFCC88, 0xAA8855, 0xFF8844];
        const emitter = this.add.particles(0, 0, 'particle', {
            follow: proj,
            speed: { min: 5, max: 20 },
            lifespan: projType === 'magic' ? 400 : 200,
            scale: { start: projType === 'magic' ? 0.5 : 0.3, end: 0 },
            alpha: { start: 0.8, end: 0 },
            tint: tintColor,
            quantity: projType === 'magic' ? 2 : 1,
            blendMode: 'ADD',
            frequency: 30,
        });
        emitter.setDepth(7);
        proj.setData('emitter', emitter);

        // Magic orb: add pulsing glow + sound
        if (projType === 'magic') {
            this.tweens.add({
                targets: proj,
                scaleX: 1.3, scaleY: 1.3,
                duration: 200,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
            audioEngine.startMagicProj();
        }
    }

    updateProjectiles(dt) {
        const maxLifetime = 3000; // ms — auto-destroy after 3s
        for (const proj of [...this.projectiles.children.entries]) {
            if (!proj.active) continue;

            let life = proj.getData('lifetime') + dt * 1000;
            proj.setData('lifetime', life);

            // Auto-destroy if too old
            if (life > maxLifetime) {
                this._destroyProjectile(proj);
                continue;
            }

            // Hit player
            const distToPlayer = Phaser.Math.Distance.Between(proj.x, proj.y, this.player.x, this.player.y);
            if (distToPlayer < 18) {
                const dmg = proj.getData('damage');
                this.damagePlayer(dmg);
                this.showFloatingText(this.player.x, this.player.y - 20, `-${dmg}`, '#FF4444');

                // Impact effect
                this._projectileImpact(proj);
                this._destroyProjectile(proj);
                continue;
            }

            // Hit buildings
            for (const building of this.buildingsGroup.children.entries) {
                if (!building.active) continue;
                const d = Phaser.Math.Distance.Between(proj.x, proj.y, building.x, building.y);
                if (d < 20) {
                    const dmg = proj.getData('damage');
                    let bhp = building.getData('hp') - dmg;
                    building.setData('hp', bhp);
                    if (bhp <= 0) this.destroyBuilding(building);
                    this._projectileImpact(proj);
                    this._destroyProjectile(proj);
                    break;
                }
            }
        }
    }

    _projectileImpact(proj) {
        const isMagic = proj.getData('projType') === 'magic';
        const tints = isMagic ? [0xAA44FF, 0xDD88FF, 0xFFCCFF] : [0xFFCC88, 0xFF8844, 0xFFFFFF];
        const emitter = this.add.particles(proj.x, proj.y, 'particle', {
            speed: { min: 40, max: isMagic ? 120 : 80 },
            lifespan: isMagic ? 350 : 200,
            scale: { start: isMagic ? 0.6 : 0.4, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: tints,
            quantity: isMagic ? 10 : 6,
            blendMode: 'ADD',
            emitting: false,
        });
        emitter.setDepth(9);
        emitter.explode(isMagic ? 10 : 6);
        this.time.delayedCall(500, () => emitter.destroy());
    }

    _destroyProjectile(proj) {
        if (proj.getData('projType') === 'magic') {
            audioEngine.stopMagicProj();
        }
        const emitter = proj.getData('emitter');
        if (emitter) {
            emitter.stop();
            this.time.delayedCall(500, () => emitter.destroy());
        }
        proj.destroy();
    }

    // --------------------------------------------------------
    // Drop Pickup
    // --------------------------------------------------------
    updateDropPickup() {
        const dropList = [...this.drops.children.entries];
        for (const drop of dropList) {
            if (!drop.active) continue;
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.x, drop.y);
            if (dist < CONFIG.PICKUP_RADIUS) {
                const type = drop.getData('resourceType');
                gameState.resources[type]++;
                this._trackObjective(type + '_collected', 1);
                this.showFloatingText(drop.x, drop.y - 10, `+1 ${type}`, '#88FF88');
                audioEngine.playPickup();
                // Broadcast pickup to peers so they remove the drop
                if (network.peerCount > 0) {
                    network.broadcastReliable({ t: 'dp', x: Math.round(drop.x), y: Math.round(drop.y), res: type });
                }
                drop.destroy();
            }
        }
    }

    // --------------------------------------------------------
    // Building System
    // --------------------------------------------------------
    toggleBuildMode() {
        gameState.buildMode = !gameState.buildMode;
        gameState.buildType = null;
        this.buildGhost.setVisible(false);
        if (gameState.buildMode) {
            this.showFloatingText(this.player.x, this.player.y - 40, 'BUILD MODE (1-5)', '#00AAFF');
        }
    }

    selectBuild(type) {
        if (!gameState.buildMode) return;
        const building = BUILDINGS[type];
        if (!this.canAfford(building.cost)) {
            this.showFloatingText(this.player.x, this.player.y - 40, 'Not enough resources!', '#FF4444');
            return;
        }
        gameState.buildType = type;
        const texKey = 'building_' + type.toLowerCase();
        this.buildGhost.setTexture(texKey);
        this.buildGhost.setVisible(true);
    }

    updateBuildGhost() {
        if (gameState.buildMode && gameState.buildType) {
            this.buildGhost.setPosition(
                Math.round(this.player.x / 32) * 32 + 16 + this.player.facing.x * 64,
                Math.round(this.player.y / 32) * 32 + 16 + this.player.facing.y * 64
            );
            this.buildGhost.setVisible(true);
        } else {
            this.buildGhost.setVisible(false);
        }
    }

    placeBuilding() {
        const type = gameState.buildType;
        const building = BUILDINGS[type];

        if (!this.canAfford(building.cost)) {
            this.showFloatingText(this.player.x, this.player.y - 40, 'Not enough resources!', '#FF4444');
            return;
        }

        // Check if in light
        const bx = this.buildGhost.x;
        const by = this.buildGhost.y;
        let inLight = false;
        for (const bonfire of this.bonfires) {
            if (Phaser.Math.Distance.Between(bx, by, bonfire.x, bonfire.y) < this.getLightRadius(bonfire) * 0.9) {
                inLight = true;
                break;
            }
        }
        if (!inLight) {
            this.showFloatingText(this.player.x, this.player.y - 40, 'Must build in light!', '#FF4444');
            return;
        }

        // Deduct cost
        for (const [res, amount] of Object.entries(building.cost)) {
            gameState.resources[res] -= amount;
        }

        const texKey = 'building_' + type.toLowerCase();
        const placed = this.buildingsGroup.create(bx, by, texKey);
        placed.setDepth(4);
        placed.setData('type', type);
        placed.setData('hp', building.hp);

        gameState.buildings.push({ type, x: bx, y: by });
        this._trackObjective('buildings_built', 1);

        // Handle building effects
        if (type === 'OUTPOST') {
            this.createBonfire(bx, by, false);
        }
        if (building.unlocks) {
            building.unlocks.forEach(w => {
                if (!gameState.unlockedWeapons.includes(w)) {
                    gameState.unlockedWeapons.push(w);
                    this.showFloatingText(this.player.x, this.player.y - 60, `Unlocked: ${WEAPONS[w].name}!`, '#FFDD00');
                }
            });
        }
        if (building.armorBonus) {
            gameState.armor = Math.min(0.6, gameState.armor + building.armorBonus);
            this.showFloatingText(this.player.x, this.player.y - 60, `Armor +${Math.floor(building.armorBonus * 100)}%!`, '#7777FF');
        }
        if (building.spawnsAlly) {
            this.spawnAlly(bx, by, placed);
        }

        this.showFloatingText(bx, by - 20, `Built ${building.name}!`, '#00FF88');
        audioEngine.playBuild();
        gameState.buildMode = false;
        gameState.buildType = null;
        this.buildGhost.setVisible(false);
    }

    spawnAlly(x, y, homeBuilding) {
        const ally = this.allies.create(x + 20, y, 'ally');
        ally.setDepth(5);
        ally.body.setAllowGravity(false);
        ally.setData('attackCooldown', 0);
        ally.setData('home', { x, y });
    }

    destroyBuilding(building, broadcast = true) {
        const type = building.getData('type');
        const bx = building.x, by = building.y;
        this.showFloatingText(bx, by - 20, `${BUILDINGS[type].name} destroyed!`, '#FF4444');

        // Remove bonfire if outpost
        if (type === 'OUTPOST') {
            this.bonfires = this.bonfires.filter(b => {
                if (Phaser.Math.Distance.Between(b.x, b.y, bx, by) < 10) {
                    const emitter = b.getData('emitter');
                    if (emitter) emitter.destroy();
                    b.destroy();
                    return false;
                }
                return true;
            });
        }

        gameState.buildings = gameState.buildings.filter(b => !(b.x === bx && b.y === by));
        building.destroy();

        // Broadcast to peers
        if (broadcast && network.peerCount > 0) {
            network.broadcastReliable({ t: 'bd', x: Math.round(bx), y: Math.round(by) });
        }
    }

    canAfford(cost) {
        for (const [res, amount] of Object.entries(cost)) {
            if ((gameState.resources[res] || 0) < amount) return false;
        }
        return true;
    }

    // --------------------------------------------------------
    // Crafting
    // --------------------------------------------------------
    toggleCrafting() {
        gameState.craftingOpen = !gameState.craftingOpen;
        const menu = document.getElementById('crafting-menu');
        menu.style.display = gameState.craftingOpen ? 'block' : 'none';
        if (gameState.craftingOpen) this.renderCraftingMenu();
    }

    renderCraftingMenu() {
        const list = document.getElementById('craft-list');
        list.innerHTML = '';

        // Weapons
        const wcat = document.createElement('div');
        wcat.className = 'craft-category';
        wcat.textContent = 'Weapons';
        list.appendChild(wcat);

        for (const [key, weapon] of Object.entries(WEAPONS)) {
            if (key === 'WOODEN_CLUB') continue; // starting weapon
            if (!gameState.unlockedWeapons.includes(key)) continue;

            const item = document.createElement('div');
            const isEquipped = gameState.weapon === key;
            const costStr = weapon.cost ? Object.entries(weapon.cost).map(([r, a]) => `${a} ${r}`).join(', ') : '';
            const affordable = weapon.cost ? this.canAfford(weapon.cost) : true;

            item.className = 'craft-item' + ((!affordable && !isEquipped) ? ' disabled' : '');
            item.innerHTML = `
                <span class="craft-name">${weapon.name} ${isEquipped ? '(equipped)' : ''}</span>
                <span class="craft-cost">${isEquipped ? '' : costStr}</span>
            `;

            if (!isEquipped && affordable) {
                item.onclick = () => {
                    if (weapon.cost) {
                        for (const [r, a] of Object.entries(weapon.cost)) gameState.resources[r] -= a;
                    }
                    gameState.weapon = key;
                    this.showFloatingText(this.player.x, this.player.y - 40, `Equipped ${weapon.name}!`, '#FFDD00');
                    audioEngine.playCraft();
                    this.renderCraftingMenu();
                };
            }
            list.appendChild(item);
        }

        // Buildings
        const bcat = document.createElement('div');
        bcat.className = 'craft-category';
        bcat.textContent = 'Buildings (press B, then 1-5)';
        list.appendChild(bcat);

        for (const [key, building] of Object.entries(BUILDINGS)) {
            const item = document.createElement('div');
            const costStr = Object.entries(building.cost).map(([r, a]) => `${a} ${r}`).join(', ');
            const affordable = this.canAfford(building.cost);

            item.className = 'craft-item' + (!affordable ? ' disabled' : '');
            item.innerHTML = `
                <span class="craft-name">${building.name} <span style="color:#666;font-size:11px">${building.desc}</span></span>
                <span class="craft-cost">${costStr}</span>
            `;
            list.appendChild(item);
        }
    }

    // --------------------------------------------------------
    // HUD
    // --------------------------------------------------------
    updateHUD() {
        this.hud.health.style.width = `${(gameState.hp / CONFIG.PLAYER_MAX_HP) * 100}%`;

        // Show active (last-fed) camp's fuel in dashboard
        const activeCamp = this._activeCamp || this.bonfires[0];
        const campFuel = activeCamp ? activeCamp.getData('fuel') / activeCamp.getData('maxFuel') : 0;
        this.hud.fuel.style.width = `${campFuel * 100}%`;

        this.hud.wood.textContent = gameState.resources.wood;
        this.hud.stone.textContent = gameState.resources.stone;
        this.hud.metal.textContent = gameState.resources.metal;
        this.hud.gold.textContent = gameState.resources.gold;
        this.hud.weapon.textContent = WEAPONS[gameState.weapon].name;

        // Shop proximity hint
        if (this.shopSprite && !this._shopOpen) {
            const shopDist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.shopSprite.x, this.shopSprite.y);
            if (shopDist < CONFIG.INTERACT_RADIUS + 30) {
                this.hud.hint.textContent = 'Press E to browse the merchant\'s wares';
                this.hud.hint.style.display = 'block';
                this.hud.hint.style.opacity = '1';
            }
        }

        // Show active camp's fire level progress
        const levels = CONFIG.FIRE_LEVELS;
        const campFuelAdded = activeCamp ? (activeCamp.getData('campFuelAdded') || 0) : gameState.fuelAdded;
        const lv = activeCamp ? (activeCamp.getData('campFireLevel') || 1) : gameState.fireLevel;
        const campName = activeCamp === this.bonfires[0] ? 'Main' :
                         activeCamp?.getData('isSecondCamp') ? 'Camp 2' : 'Outpost';
        this.hud.fireLevelLabel.textContent = `${campName} Lv.${lv}`;
        if (lv < levels.length) {
            const prevThresh = levels[lv - 1] || 0;
            const nextThresh = levels[lv];
            const progress = (campFuelAdded - prevThresh) / (nextThresh - prevThresh);
            this.hud.fireLevelFill.style.width = `${Math.min(100, progress * 100)}%`;
        } else {
            this.hud.fireLevelFill.style.width = '100%';
            this.hud.fireLevelLabel.textContent = `${campName} Lv.${lv} MAX`;
        }
    }

    // --------------------------------------------------------
    // Multiplayer
    // --------------------------------------------------------
    _setupNetwork() {
        const scene = this;

        // Connect to signaling server
        network.connect(network.playerName, network.playerColor, network.roomId).then(connected => {
            if (connected) {
                this.showFloatingText(this.player.x, this.player.y - 60,
                    network.isHost ? 'HOSTING GAME' : 'CONNECTED', '#44FF44');
            }
        });

        // Peer joined: create remote player sprite
        network.onPeerJoined = (peerId, name, color) => {
            if (scene.remotePlayers.has(peerId)) return;

            const cx = scene.bonfires[0].x;
            const cy = scene.bonfires[0].y;

            // Use colored player texture
            const texKey = getPlayerTextureKey(color);
            const tex = scene.textures.exists(texKey) ? texKey : 'player';

            const sprite = scene.add.sprite(cx, cy - 30, tex);
            sprite.setDepth(5);

            const nameLabel = scene.add.text(cx, cy - 55, name || 'Player', {
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#AAFFAA',
                stroke: '#000000',
                strokeThickness: 2,
            }).setOrigin(0.5).setDepth(100);

            scene.remotePlayers.set(peerId, {
                sprite,
                nameLabel,
                state: null,
                targetX: cx,
                targetY: cy - 30,
                color,
                name,
            });

            scene.showFloatingText(cx, cy - 80, `${name} joined!`, '#44FF44');
        };

        // Peer left: remove sprite
        network.onPeerLeft = (peerId) => {
            const remote = scene.remotePlayers.get(peerId);
            if (remote) {
                scene.showFloatingText(remote.sprite.x, remote.sprite.y - 30,
                    `${remote.name} left`, '#FF4444');
                remote.sprite.destroy();
                remote.nameLabel.destroy();
                scene.remotePlayers.delete(peerId);
            }
        };

        // Peer state update (position, facing)
        network.onPeerState = (peerId, state) => {
            const remote = scene.remotePlayers.get(peerId);
            if (remote) {
                remote.targetX = state.x;
                remote.targetY = state.y;
                remote.state = state;
                // Flip sprite based on facing
                if (state.fx !== undefined) {
                    remote.sprite.setFlipX(state.fx < 0);
                }
            }
        };

        // Peer attack visual
        network.onPeerAttack = (peerId, data) => {
            const remote = scene.remotePlayers.get(peerId);
            if (!remote) return;

            // Show slash visual at attack position
            const slash = scene.add.image(data.ax, data.ay, 'slash').setDepth(10).setAlpha(0.8);
            slash.setBlendMode('ADD');
            slash.setRotation(Math.atan2(data.fy, data.fx));
            scene.tweens.add({
                targets: slash,
                alpha: 0,
                scale: 1.5,
                duration: 200,
                onComplete: () => slash.destroy()
            });
        };

        // Chat message from peer
        network.onChat = (peerId, text) => {
            const remote = scene.remotePlayers.get(peerId);
            if (remote) {
                scene._showChatBubble(remote.sprite, remote.nameLabel, text);
            }
        };

        // Enemy sync from host (positions update)
        network.onEnemySync = (enemies) => {
            if (network.isHost) return;
            const isKeyframe = enemies.length > 0 && enemies[0].type !== undefined;
            for (const eData of enemies) {
                const enemy = scene._findEnemyById(eData.id);
                if (enemy) {
                    // Update position smoothly
                    enemy.setData('targetX', eData.x);
                    enemy.setData('targetY', eData.y);
                    if (eData.hp !== undefined) enemy.setData('hp', eData.hp);
                    if (eData.fx !== undefined) enemy.setFlipX(eData.fx < 0);
                } else if (eData.type) {
                    // Enemy doesn't exist yet — create it (only from keyframes/spawns)
                    scene._createEnemyFromSync(eData.id, eData.type, eData.x, eData.y, eData.hp);
                }
            }
            // On keyframes, remove enemies that host no longer has
            if (isKeyframe) {
                const hostIds = new Set(enemies.map(e => e.id));
                for (const e of [...scene.enemies.children.entries]) {
                    if (e.active && !hostIds.has(e.getData('enemyId'))) {
                        e.destroy();
                    }
                }
            }
        };

        // Enemy spawn from host (individual spawn events)
        network.onEnemySpawn = (msg) => {
            if (network.isHost) return;
            if (!scene._findEnemyById(msg.id)) {
                scene._createEnemyFromSync(msg.id, msg.type, msg.x, msg.y, msg.hp);
            }
        };

        // Resource destroyed by peer
        network.onResourceEvent = (msg) => {
            if (msg.t === 'rd' && msg.resType) {
                scene._onResourceDestroyed(msg.resType, msg.x, msg.y);
            }
        };

        // Drop picked up by peer — remove nearest matching drop
        network.onDropPickup = (x, y, resType) => {
            let closest = null, closestDist = 30;
            for (const drop of scene.drops.children.entries) {
                if (!drop.active) continue;
                if (drop.getData('resourceType') !== resType) continue;
                const d = Phaser.Math.Distance.Between(x, y, drop.x, drop.y);
                if (d < closestDist) { closestDist = d; closest = drop; }
            }
            if (closest) closest.destroy();
        };

        // Enemy death from host
        network.onEnemyDied = (enemyId) => {
            scene._onEnemyDied(enemyId);
        };

        // Host: handle enemy damage from client
        network.onEnemyDamage = (enemyId, damage, fromPeerId) => {
            const enemy = scene._findEnemyById(enemyId);
            if (enemy) {
                let hp = enemy.getData('hp') - damage;
                enemy.setData('hp', hp);
                scene.showFloatingText(enemy.x, enemy.y - 20, `-${damage}`, '#FFAA00');
                enemy.setTint(0xFFFFFF);
                scene.time.delayedCall(80, () => { if (enemy.active) enemy.clearTint(); });
                if (hp <= 0) {
                    scene._killEnemy(enemy);
                }
            }
        };

        // Building placed by peer
        network.onBuildingPlaced = (type, x, y) => {
            scene._placeBuilding(type, x, y);
        };

        // Enemy projectile from host
        network.onEnemyProjectile = (msg) => {
            if (network.isHost) return;
            // Create a fake enemy object at the spawn position for _fireProjectile
            const fakeEnemy = { x: msg.x, y: msg.y };
            const fakeStats = { projectileSpeed: msg.spd, damage: msg.dmg, projectileType: msg.pt };
            scene._fireProjectile(fakeEnemy, msg.tx, msg.ty, fakeStats, true);
        };

        // Building destroyed by peer
        network.onBuildingDestroyed = (x, y) => {
            for (const b of [...scene.buildingsGroup.children.entries]) {
                if (!b.active) continue;
                if (Math.abs(b.x - x) < 5 && Math.abs(b.y - y) < 5) {
                    scene.destroyBuilding(b, false); // false = don't re-broadcast
                    break;
                }
            }
        };

        // Rain sync from peer
        network.onRainSync = (active, dur) => {
            if (active && !scene._rainActive) {
                scene._rainDuration = dur || 30;
                scene._startRain();
            } else if (!active && scene._rainActive) {
                scene._stopRain();
            }
        };

        // Second camp lit by peer
        network.onSecondCampLit = (x, y) => {
            if (scene._secondCampBonfire && !scene._secondCampBonfire.getData('lit')) {
                scene._lightSecondCamp(scene._secondCampBonfire);
            }
        };

        // Bonfire fuel sync from peers
        network.onFuelAdded = (bonfireIdx, amount) => {
            if (bonfireIdx >= 0 && bonfireIdx < scene.bonfires.length) {
                const bonfire = scene.bonfires[bonfireIdx];
                const fuel = bonfire.getData('fuel');
                const maxFuel = bonfire.getData('maxFuel');
                bonfire.setData('fuel', Math.min(maxFuel, fuel + amount));

                // Update per-camp tracking
                const campFuelAdded = (bonfire.getData('campFuelAdded') || 0) + 1;
                bonfire.setData('campFuelAdded', campFuelAdded);
                if (bonfire.getData('isMain')) gameState.fuelAdded = campFuelAdded;

                // Check camp level up
                const levels = CONFIG.FIRE_LEVELS;
                let newLevel = 1;
                for (let lv = levels.length - 1; lv >= 0; lv--) {
                    if (campFuelAdded >= levels[lv]) { newLevel = lv + 1; break; }
                }
                const oldLevel = bonfire.getData('campFireLevel') || 1;
                bonfire.setData('campFireLevel', newLevel);
                if (newLevel > oldLevel && bonfire.getData('isSecondCamp')) {
                    scene._updateSecondCampBuildSpots(bonfire, newLevel);
                }

                // Update global fire level
                gameState.fireLevel = Math.max(
                    scene.bonfires[0]?.getData('campFireLevel') || 1,
                    scene._secondCampBonfire?.getData('campFireLevel') || 1
                );

                if (bonfire.getData('isSecondCamp') && !bonfire.getData('lit')) {
                    scene._lightSecondCamp(bonfire);
                }
                scene._activeCamp = bonfire;
                scene.showFloatingText(bonfire.x, bonfire.y - 20, '+FUEL', '#FF8800');
            }
        };

        // Bonfire sync from host (periodic fuel levels)
        network.onBonfireSync = (bonfires) => {
            if (network.isHost) return;
            for (let i = 0; i < bonfires.length && i < scene.bonfires.length; i++) {
                const b = scene.bonfires[i];
                const data = bonfires[i];
                b.setData('fuel', data.fuel);
                if (data.campFuelAdded !== undefined) b.setData('campFuelAdded', data.campFuelAdded);
                if (data.campFireLevel !== undefined) {
                    const oldLvl = b.getData('campFireLevel') || 1;
                    b.setData('campFireLevel', data.campFireLevel);
                    if (data.campFireLevel > oldLvl && b.getData('isSecondCamp')) {
                        scene._updateSecondCampBuildSpots(b, data.campFireLevel);
                    }
                }
                if (data.lit && b.getData('isSecondCamp') && !b.getData('lit')) {
                    scene._lightSecondCamp(b);
                }
            }
            // Update global fire level
            gameState.fireLevel = Math.max(
                scene.bonfires[0]?.getData('campFireLevel') || 1,
                scene._secondCampBonfire?.getData('campFireLevel') || 1
            );
        };

        // Shop purchase from peer — mark item as sold
        network.onShopPurchase = (idx, fromPeerId) => {
            if (scene._shopInventory && scene._shopInventory[idx]) {
                scene._shopInventory[idx].sold = true;
                const peerData = network.peers.get(fromPeerId);
                const peerName = peerData ? peerData.name : 'A player';
                scene.showFloatingText(scene.shopSprite?.x || scene.player.x,
                    (scene.shopSprite?.y || scene.player.y) - 30,
                    `${peerName} bought ${scene._shopInventory[idx].name}`, '#FFD700');
                // Re-render if shop is open
                if (scene._shopOpen) scene._renderShopMenu();
            }
        };

        // Host: register world state getter for new peers
        network.setWorldStateGetter(() => {
            // Collect drops on ground for sync
            const dropsData = [];
            if (scene.drops && scene.drops.children) {
                scene.drops.children.each(d => {
                    if (d.active) {
                        dropsData.push({
                            x: Math.round(d.x), y: Math.round(d.y),
                            res: d.getData('resourceType'),
                        });
                    }
                });
            }
            return {
                seed: network.worldSeed,
                bonfires: scene.bonfires.map(b => ({
                    x: b.x, y: b.y,
                    fuel: b.getData('fuel'),
                    isMain: b.getData('isMain'),
                    campFuelAdded: b.getData('campFuelAdded') || 0,
                    campFireLevel: b.getData('campFireLevel') || 1,
                    lit: b.getData('lit') !== false,
                })),
                gameTime: gameState.time,
                waveNumber: gameState.waveNumber,
                fuelAdded: gameState.fuelAdded,
                fireLevel: gameState.fireLevel,
                buildings: gameState.buildings.map(b => ({ type: b.type, x: b.x, y: b.y })),
                raining: scene._rainActive,
                rainDur: scene._rainActive ? Math.round(scene._rainDuration - scene._rainTimer) : 0,
                shopSold: scene._shopInventory ? scene._shopInventory.map(w => w.sold) : [],
                drops: dropsData,
                destroyed: scene._destroyedResources || [],
            };
        });

        // World sync handler (client receives seed, bonfire state, etc.)
        network.onWorldSync = (msg) => {
            if (msg.fuelAdded !== undefined) gameState.fuelAdded = msg.fuelAdded;
            if (msg.waveNumber !== undefined) gameState.waveNumber = msg.waveNumber;
            if (msg.fireLevel !== undefined) gameState.fireLevel = msg.fireLevel;
            if (msg.gameTime !== undefined) gameState.time = msg.gameTime;
            // Sync rain state from host
            if (msg.raining && !scene._rainActive) {
                scene._rainDuration = msg.rainDur || 30;
                scene._startRain();
            }
            // Sync buildings from host
            if (msg.buildings && msg.buildings.length) {
                for (const b of msg.buildings) {
                    const exists = gameState.buildings.some(
                        existing => Math.abs(existing.x - b.x) < 5 && Math.abs(existing.y - b.y) < 5
                    );
                    if (!exists) {
                        scene._placeBuilding(b.type, b.x, b.y);
                    }
                }
            }
            // Sync shop sold state from host
            if (msg.shopSold && scene._shopInventory) {
                for (let i = 0; i < msg.shopSold.length && i < scene._shopInventory.length; i++) {
                    scene._shopInventory[i].sold = msg.shopSold[i];
                }
            }
            // Sync drops on ground from host
            if (msg.drops && msg.drops.length) {
                for (const d of msg.drops) {
                    const texKey = d.res + '_drop';
                    if (scene.textures.exists(texKey)) {
                        const drop = scene.drops.create(d.x, d.y, texKey);
                        drop.setDepth(3);
                        drop.setData('resourceType', d.res);
                        drop.body.setAllowGravity(false);
                    }
                }
            }
            // Remove resources that were destroyed before we joined
            if (msg.destroyed && msg.destroyed.length) {
                for (const d of msg.destroyed) {
                    scene._onResourceDestroyed(d.resType, d.x, d.y);
                }
            }
        };

        // Materialize any peers that connected before callbacks were set (race condition fix)
        for (const [peerId, peer] of network.peers) {
            if (!scene.remotePlayers.has(peerId) && peer.name) {
                network.onPeerJoined(peerId, peer.name, peer.color);
            }
        }

        // Replay buffered world sync that arrived before GameScene was ready
        if (network._pendingWorldSync) {
            const msg = network._pendingWorldSync;
            const fromId = network._pendingWorldSyncFrom;
            // Re-apply host peer info
            if (msg.hostName && fromId) {
                const hostPeer = network.peers.get(fromId);
                if (hostPeer && !scene.remotePlayers.has(fromId)) {
                    network.onPeerJoined(fromId, msg.hostName, msg.hostColor || hostPeer.color);
                }
            }
            network.onWorldSync(msg);
            network._pendingWorldSync = null;
        }

        // Show player count in HUD
        this._playerCountText = this.add.text(10, 70, '', {
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#44FF44',
            stroke: '#000000',
            strokeThickness: 2,
        }).setDepth(100).setScrollFactor(0);
    }

    updateNetwork(dt) {
        // Broadcast own state at SYNC_RATE
        this._syncTimer += dt * 1000;
        if (this._syncTimer >= network.SYNC_RATE) {
            this._syncTimer = 0;
            network.broadcastState({
                x: Math.round(this.player.x),
                y: Math.round(this.player.y),
                fx: this.player.facing.x,
                fy: this.player.facing.y,
                hp: gameState.hp,
            });
        }

        // Host: broadcast enemy positions + bonfire state
        if (network.isHost && network.peerCount > 0) {
            this._hostSyncTimer += dt * 1000;
            if (this._hostSyncTimer >= network.HOST_SYNC_RATE) {
                this._hostSyncTimer = 0;
                this._enemySyncCounter = (this._enemySyncCounter || 0) + 1;
                const isKeyframe = this._enemySyncCounter % 5 === 0;

                const enemies = [];
                for (const e of this.enemies.children.entries) {
                    if (!e.active) continue;
                    const id = e.getData('enemyId');
                    const x = Math.round(e.x);
                    const y = Math.round(e.y);
                    const hp = e.getData('hp');
                    const prev = this._prevEnemyState?.[id];

                    if (isKeyframe) {
                        // Keyframe: full state
                        enemies.push({ id, type: e.getData('type'), x, y, hp, fx: e.flipX ? -1 : 1 });
                    } else if (!prev || Math.abs(prev.x - x) > 2 || Math.abs(prev.y - y) > 2 || prev.hp !== hp) {
                        // Delta: only changed enemies
                        enemies.push({ id, x, y, hp, fx: e.flipX ? -1 : 1 });
                    }

                    if (!this._prevEnemyState) this._prevEnemyState = {};
                    this._prevEnemyState[id] = { x, y, hp };
                }

                if (enemies.length > 0 || isKeyframe) {
                    network.broadcastEnemies(enemies);
                }

                // Broadcast bonfire fuel levels every 2 seconds
                if (this._enemySyncCounter % 10 === 0) {
                    network.broadcastBonfires(this.bonfires.map(b => ({
                        fuel: Math.round(b.getData('fuel') * 10) / 10,
                        campFuelAdded: b.getData('campFuelAdded') || 0,
                        campFireLevel: b.getData('campFireLevel') || 1,
                        lit: b.getData('lit') !== false,
                    })));
                }
            }
        }

        // Client: interpolate enemy positions from host data
        if (!network.isHost) {
            for (const e of this.enemies.children.entries) {
                if (!e.active) continue;
                const tx = e.getData('targetX');
                const ty = e.getData('targetY');
                if (tx !== undefined) {
                    e.x += (tx - e.x) * 0.2;
                    e.y += (ty - e.y) * 0.2;
                }
            }
        }

        // Interpolate remote players toward their target positions
        for (const [peerId, remote] of this.remotePlayers) {
            const lerp = 0.2;
            remote.sprite.x += (remote.targetX - remote.sprite.x) * lerp;
            remote.sprite.y += (remote.targetY - remote.sprite.y) * lerp;
            remote.nameLabel.setPosition(remote.sprite.x, remote.sprite.y - 30);

            // Remove stale peers (no update in 5s)
            const peer = network.peers.get(peerId);
            if (peer && Date.now() - peer.lastUpdate > 5000 && peer.lastUpdate > 0) {
                network._removePeer(peerId);
            }
        }

        // Update own name label position
        if (this.playerNameLabel) {
            this.playerNameLabel.setPosition(this.player.x, this.player.y - 30);
        }

        // Update player count display
        const count = network.peerCount;
        if (this._playerCountText) {
            this._playerCountText.setText(count > 0 ? `Players: ${count + 1}` : '');
        }
    }

    // --------------------------------------------------------
    // Chat Bubbles
    // --------------------------------------------------------
    _showChatBubble(sprite, nameLabel, text) {
        // Remove existing bubble for this sprite
        this._chatBubbles = this._chatBubbles.filter(b => {
            if (b.sprite === sprite) {
                b.bg.destroy();
                b.label.destroy();
                return false;
            }
            return true;
        });

        // Wrap text at ~20 chars
        const lines = [];
        const words = text.split(' ');
        let line = '';
        for (const word of words) {
            if ((line + ' ' + word).trim().length > 22) {
                if (line) lines.push(line);
                line = word;
            } else {
                line = (line + ' ' + word).trim();
            }
        }
        if (line) lines.push(line);
        const wrapped = lines.join('\n');

        const label = this.add.text(sprite.x, sprite.y - 50, wrapped, {
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#FFFFFF',
            backgroundColor: 'rgba(0,0,0,0.7)',
            padding: { x: 8, y: 5 },
            align: 'center',
            wordWrap: { width: 180 },
        }).setOrigin(0.5, 1).setDepth(110);

        // Background bubble shape
        const bg = this.add.graphics();
        bg.setDepth(109);

        this._chatBubbles.push({
            sprite,
            label,
            bg,
            createdAt: Date.now(),
        });
    }

    _updateChatBubbles() {
        const now = Date.now();
        this._chatBubbles = this._chatBubbles.filter(b => {
            const age = now - b.createdAt;
            if (age > 10000) {
                b.label.destroy();
                b.bg.destroy();
                return false;
            }

            // Position above sprite
            const x = b.sprite.x;
            const y = b.sprite.y - 48;
            b.label.setPosition(x, y);

            // Draw bubble background
            b.bg.clear();
            const bounds = b.label.getBounds();
            const pad = 3;
            b.bg.fillStyle(0x000000, 0.65);
            b.bg.fillRoundedRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2, 6);

            // Fade out in last 2 seconds
            if (age > 8000) {
                const alpha = 1 - (age - 8000) / 2000;
                b.label.setAlpha(alpha);
                b.bg.setAlpha(alpha);
            }

            return true;
        });
    }

    // --------------------------------------------------------
    // Objectives System
    // --------------------------------------------------------
    _initObjectives() {
        // Pick random objectives from the pool
        const pool = [...OBJECTIVES];
        const count = Math.min(OBJECTIVES_PER_SESSION, pool.length);
        this._objectives = [];

        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            const template = pool.splice(idx, 1)[0];
            // Pick a random difficulty tier for the target
            const targets = template.target;
            const tier = Math.floor(Math.random() * targets.length);
            const target = targets[tier];
            const desc = template.desc.replace('{n}', target);
            this._objectives.push({
                type: template.type,
                desc,
                target,
                current: 0,
                completed: false,
                reward: template.reward,
            });
        }

        // Initialize tracking counters
        this._objCounters = {
            wood_collected: 0,
            stone_collected: 0,
            metal_collected: 0,
            gold_collected: 0,
            enemies_killed: 0,
            raiders_killed: 0,
            archers_killed: 0,
            mages_killed: 0,
            waves_survived: 0,
            fire_level: gameState.fireLevel,
            fuel_added: 0,
            buildings_built: 0,
            second_camp_lit: 0,
            trees_chopped: 0,
            stones_mined: 0,
        };

        // Build the UI
        const panel = document.getElementById('objectives-panel');
        panel.style.display = 'flex';
        const list = document.getElementById('objectives-list');
        list.innerHTML = '';

        for (let i = 0; i < this._objectives.length; i++) {
            const obj = this._objectives[i];
            const item = document.createElement('div');
            item.className = 'objective-item';
            item.id = `obj-${i}`;
            item.innerHTML = `
                <div class="objective-desc">${obj.desc}</div>
                <div class="objective-progress-bg"><div class="objective-progress-fill" id="obj-fill-${i}" style="width:0%"></div></div>
                <div class="objective-counter" id="obj-counter-${i}">0 / ${obj.target}</div>
            `;
            list.appendChild(item);
        }
    }

    _trackObjective(type, value) {
        if (!this._objectives) return;
        // Update counter
        if (type in this._objCounters) {
            if (type === 'fire_level' || type === 'second_camp_lit') {
                this._objCounters[type] = value; // absolute value
            } else {
                this._objCounters[type] += value; // incremental
            }
        }

        // Check each objective
        for (let i = 0; i < this._objectives.length; i++) {
            const obj = this._objectives[i];
            if (obj.completed) continue;
            if (obj.type !== type) continue;

            obj.current = Math.min(this._objCounters[type], obj.target);

            // Update UI
            const pct = Math.min(100, (obj.current / obj.target) * 100);
            const fill = document.getElementById(`obj-fill-${i}`);
            const counter = document.getElementById(`obj-counter-${i}`);
            const item = document.getElementById(`obj-${i}`);
            if (fill) fill.style.width = `${pct}%`;
            if (counter) counter.textContent = `${obj.current} / ${obj.target}`;

            // Complete!
            if (obj.current >= obj.target && !obj.completed) {
                obj.completed = true;
                if (item) item.classList.add('completed');

                // Grant reward
                for (const [res, amount] of Object.entries(obj.reward)) {
                    gameState.resources[res] = (gameState.resources[res] || 0) + amount;
                }

                // Visual feedback
                this.showFloatingText(this.player.x, this.player.y - 50,
                    'OBJECTIVE COMPLETE!', '#FFD700');
                this.showFloatingText(this.player.x, this.player.y - 70,
                    Object.entries(obj.reward).map(([r, a]) => `+${a} ${r}`).join('  '), '#88FF88');
                audioEngine.playOneShot('pickup', 1.2);

                // Check if all objectives are done
                if (this._objectives.every(o => o.completed)) {
                    this.time.delayedCall(1500, () => {
                        this.showFloatingText(this.player.x, this.player.y - 60,
                            'ALL OBJECTIVES COMPLETE!', '#FFD700');
                    });
                }
            }
        }
    }

    // --------------------------------------------------------
    // Floating Text
    // --------------------------------------------------------
    showFloatingText(x, y, text, color = '#FFFFFF') {
        const t = this.add.text(x, y, text, {
            fontSize: '13px',
            fontFamily: 'monospace',
            color: color,
            stroke: '#000000',
            strokeThickness: 3,
        }).setDepth(100).setOrigin(0.5);

        this.tweens.add({
            targets: t,
            y: y - 30,
            alpha: 0,
            duration: 800,
            ease: 'Power2',
            onComplete: () => t.destroy()
        });
    }
}
