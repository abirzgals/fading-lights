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
        this.allies = this.physics.add.group();
        this.enemyHpGraphics = this.add.graphics().setDepth(50);

        // --- World Generation ---
        this.generateWorld(centerTile);

        // --- Central Bonfire ---
        const cx = centerTile * CONFIG.TILE_SIZE + 16;
        const cy = centerTile * CONFIG.TILE_SIZE + 16;
        this.bonfires = [];
        this.createBonfire(cx, cy, true);

        // --- Build spots (predefined positions around bonfire) ---
        this.buildSpots = [];
        this._createBuildSpots(cx, cy);

        // --- Player (use own tshirt color) ---
        const playerTexKey = getPlayerTextureKey(network.playerColor);
        const playerTex = this.textures.exists(playerTexKey) ? playerTexKey : 'player';
        this.player = this.physics.add.sprite(cx, cy - 50, playerTex);
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

        // --- Multiplayer: remote players ---
        this.remotePlayers = new Map(); // peerId -> { sprite, nameLabel, state, targetX, targetY }
        this._syncTimer = 0;
        this._hostSyncTimer = 0;
        this._proximityIdleTime = 0; // seconds near another player while both idle
        this._healTickTimer = 0;
        this._enemyIdCounter = 0; // unique IDs for enemies (host)
        this._setupNetwork();

        // --- Collisions ---
        this.physics.add.collider(this.player, this.trees);
        this.physics.add.collider(this.player, this.stones);
        this.physics.add.collider(this.player, this.metals);
        this.physics.add.collider(this.player, this.buildingsGroup);

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

        // ESC closes chat
        this.input.keyboard.on('keydown-ESC', () => {
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
            chatBtn.style.cssText = 'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);width:60px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.3);border-radius:6px;color:#FFD080;font-size:11px;z-index:150;';
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
        };

        // --- Build mode ghost ---
        this.buildGhost = this.add.image(0, 0, 'building_outpost').setAlpha(0.4).setDepth(49).setVisible(false);

        // --- Floating text pool ---
        this.floatingTexts = [];

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
        const cx = centerTile, cy = centerTile;
        const clearRadius = 4;
        const treeMinDist = 3;
        const rng = network.seededRandom(network.worldSeed);

        // Poisson-like tree placement
        const placed = [];
        for (let attempt = 0; attempt < 2500; attempt++) {
            const tx = Math.floor(rng() * (worldSize - 4)) + 2;
            const ty = Math.floor(rng() * (worldSize - 4)) + 2;

            // Skip clear zone around center
            const dx = tx - cx, dy = ty - cy;
            if (dx * dx + dy * dy < clearRadius * clearRadius) continue;

            // Min distance check
            let tooClose = false;
            for (const p of placed) {
                const pdx = tx - p.x, pdy = ty - p.y;
                if (pdx * pdx + pdy * pdy < treeMinDist * treeMinDist) { tooClose = true; break; }
            }
            if (tooClose) continue;

            placed.push({ x: tx, y: ty });
            const wx = tx * CONFIG.TILE_SIZE + 16;
            const wy = ty * CONFIG.TILE_SIZE + 16;
            const tree = this.trees.create(wx, wy, 'tree');
            tree.setDepth(3);
            tree.body.setSize(16, 12);
            tree.body.setOffset(8, 36);
            tree.setData('hits', 0);
            tree.setData('type', 'tree');
        }

        // Starter stones near bonfire (visible on first screen)
        const centerWx = cx * CONFIG.TILE_SIZE + 16;
        const centerWy = cy * CONFIG.TILE_SIZE + 16;
        for (let s = 0; s < 4; s++) {
            const angle = rng() * Math.PI * 2;
            const dist = 80 + rng() * 60;
            const sx = centerWx + Math.cos(angle) * dist;
            const sy = centerWy + Math.sin(angle) * dist;
            const stone = this.stones.create(sx, sy, 'stone');
            stone.setDepth(2);
            stone.body.setSize(20, 16);
            stone.body.setOffset(6, 12);
            stone.setData('hits', 0);
            stone.setData('type', 'stone');
        }

        // Stone clusters
        for (let c = 0; c < 18; c++) {
            const scx = Math.floor(rng() * (worldSize - 20)) + 10;
            const scy = Math.floor(rng() * (worldSize - 20)) + 10;
            const sdx = scx - cx, sdy = scy - cy;
            if (sdx * sdx + sdy * sdy < 8 * 8) continue;
            const count = 2 + Math.floor(rng() * 4);
            for (let s = 0; s < count; s++) {
                const sx = (scx + Math.floor(rng() * 4 - 2)) * CONFIG.TILE_SIZE + 16;
                const sy = (scy + Math.floor(rng() * 4 - 2)) * CONFIG.TILE_SIZE + 16;
                const stone = this.stones.create(sx, sy, 'stone');
                stone.setDepth(2);
                stone.body.setSize(20, 16);
                stone.body.setOffset(6, 12);
                stone.setData('hits', 0);
                stone.setData('type', 'stone');
            }
        }

        // Metal ore (outer regions only)
        for (let c = 0; c < 10; c++) {
            const mx = Math.floor(rng() * (worldSize - 20)) + 10;
            const my = Math.floor(rng() * (worldSize - 20)) + 10;
            const mdx = mx - cx, mdy = my - cy;
            if (mdx * mdx + mdy * mdy < 35 * 35) continue; // outer only
            const count = 2 + Math.floor(rng() * 3);
            for (let m = 0; m < count; m++) {
                const px = (mx + Math.floor(rng() * 3 - 1)) * CONFIG.TILE_SIZE + 16;
                const py = (my + Math.floor(rng() * 3 - 1)) * CONFIG.TILE_SIZE + 16;
                const ore = this.metals.create(px, py, 'metal');
                ore.setDepth(2);
                ore.body.setSize(20, 16);
                ore.body.setOffset(6, 12);
                ore.setData('hits', 0);
                ore.setData('type', 'metal');
            }
        }
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

            // Fuel threshold: spot 0 = 1, spot 1 = 3, spot 2 = 7, spot 3 = 15...
            // Each next costs double: need 1, then 2 more, then 4 more, then 8 more...
            const fuelThreshold = Math.pow(2, i + 1) - 1;

            this.buildSpots.push({
                config: spot,
                index: i,
                x: sx, y: sy,
                sprite, label, costText,
                fuelThreshold,
                unlocked: false,
                built: false,
            });
        }
    }

    _updateBuildSpots() {
        for (const spot of this.buildSpots) {
            if (spot.built) continue;
            const wasUnlocked = spot.unlocked;
            spot.unlocked = gameState.fuelAdded >= spot.fuelThreshold;

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
                    this.showFloatingText(spot.x, spot.y - 20, 'Not enough resources!', '#FF4444');
                    return true; // consumed the interact
                }

                // Deduct cost
                for (const [res, amount] of Object.entries(building.cost)) {
                    gameState.resources[res] -= amount;
                }

                // Place building
                const texKey = 'building_' + spot.config.type.toLowerCase();
                const placed = this.buildingsGroup.create(spot.x, spot.y, texKey);
                placed.setDepth(4);
                placed.setData('type', spot.config.type);
                placed.setData('hp', building.hp);
                if (building.attackRange) {
                    placed.setData('attackRange', building.attackRange);
                    placed.setData('attackDamage', building.attackDamage);
                    placed.setData('attackSpeed', building.attackSpeed);
                    placed.setData('lastAttack', 0);
                }
                gameState.buildings.push({ type: spot.config.type, x: spot.x, y: spot.y });

                // Handle building effects
                if (spot.config.type === 'OUTPOST') {
                    this.createBonfire(spot.x, spot.y, false);
                }

                // Hide spot markers
                spot.built = true;
                spot.sprite.destroy();
                spot.label.destroy();
                spot.costText.destroy();

                this.showFloatingText(spot.x, spot.y - 20, `Built ${building.name}!`, '#00FF88');
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
        this.drawEnemyHealth();
        this.updateAllies(dt);
        this.updateTurrets(dt);
        this.updateDropPickup();
        this.updateDarknessDamage(dt);
        this.updateSpawning(dt);
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

        if (!gameState.craftingOpen && !this._chatOpen) {
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
        if (wantAttack && p.attackCooldown <= 0 && !gameState.craftingOpen && !this._chatOpen) {
            if (this._mouseLeftHeld) this.updateFacingToMouse(this.input.activePointer);
            this.playerAttack();
        }

        // Autoattack: if idle and enemy in weapon range, face it and attack
        if (!wantAttack && p.attackCooldown <= 0 && !gameState.craftingOpen && !this._chatOpen) {
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
        if (wantInteract && this._interactCooldown <= 0 && !gameState.craftingOpen && !this._chatOpen) {
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
                    gameState.fuelAdded++;
                    bonfire.setData('fuel', Math.min(maxFuel, fuel + CONFIG.FUEL_PER_WOOD));
                    this.showFloatingText(bonfire.x, bonfire.y - 20, '+FUEL', '#FF8800');
                    audioEngine.playFireFuel();

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
            const stump = this.add.image(ox, oy + 8, 'stump').setDepth(2);
            this.time.delayedCall(30000, () => stump.destroy());
        }
        obj.destroy();

        // Broadcast to peers so they remove the same resource
        if (broadcast && network.peerCount > 0) {
            network.broadcastReliable({
                t: 'rd', resType, x: Math.round(ox), y: Math.round(oy),
            });
        }
    }

    // Handle resource destroyed by peer
    _onResourceDestroyed(resType, x, y) {
        const group = resType === 'tree' ? this.trees :
                      resType === 'stone' ? this.stones : this.metals;
        const dropType = resType === 'tree' ? 'wood' :
                         resType === 'stone' ? 'stone' : 'metal';
        const dropAmount = resType === 'tree' ? CONFIG.WOOD_PER_TREE :
                           resType === 'stone' ? CONFIG.STONE_PER_DEPOSIT : CONFIG.METAL_PER_DEPOSIT;
        // Find closest matching resource
        let closest = null, closestDist = 20;
        for (const obj of group.children.entries) {
            if (!obj.active) continue;
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y);
            if (d < closestDist) { closestDist = d; closest = obj; }
        }
        if (closest) {
            this._destroyResource(closest, dropType, dropAmount, false);
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
        // sqrt curve: early fuel gives noticeable radius boost, diminishing returns at high fuel
        const scaledRatio = Math.sqrt(fuelRatio);
        return Math.max(CONFIG.BONFIRE_MIN_RADIUS, base * scaledRatio * flicker);
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
        ctx.fillStyle = 'rgba(5, 3, 10, 0.97)';
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
        const playerLight = 50;
        const pg = ctx.createRadialGradient(px, py, 0, px, py, playerLight);
        pg.addColorStop(0, 'rgba(0,0,0,0.7)');
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
        goStats.textContent = `Survived ${Math.floor(gameState.time)}s | Killed ${gameState.kills} enemies | Wave ${gameState.waveNumber}`;
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
        // Don't spawn enemies until player has added fuel at least once
        if (gameState.fuelAdded < 1) return;

        this.spawnTimer += dt * 1000;
        this.waveTimer += dt;

        // Wave progression every 30 seconds
        const newWave = Math.floor(this.waveTimer / 30);
        if (newWave > gameState.waveNumber) {
            gameState.waveNumber = newWave;
            this.showFloatingText(this.player.x, this.player.y - 60, `WAVE ${gameState.waveNumber}`, '#FF4444');
            audioEngine.playWave();
        }

        if (this.spawnTimer >= CONFIG.SPAWN_INTERVAL && this.enemies.countActive() < CONFIG.MAX_ENEMIES) {
            this.spawnTimer = 0;

            // Early game: spawn 1 at a time. Ramps up with waves.
            const count = gameState.waveNumber < 2 ? 1 : Math.min(3, Math.floor(gameState.waveNumber / 2));
            for (let i = 0; i < count; i++) {
                this.spawnEnemy();
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
            type = roll < 0.8 - waveBonus ? 'SHADOW_WISP' : 'SHADOW_STALKER';
        } else if (lightLevel <= 2) {
            if (roll < 0.3) type = 'SHADOW_WISP';
            else if (roll < 0.8 - waveBonus) type = 'SHADOW_STALKER';
            else type = 'SHADOW_BEAST';
        } else if (lightLevel <= 3) {
            if (roll < 0.1) type = 'SHADOW_WISP';
            else if (roll < 0.4) type = 'SHADOW_STALKER';
            else if (roll < 0.85 - waveBonus) type = 'SHADOW_BEAST';
            else type = 'SHADOW_LORD';
        } else {
            if (roll < 0.2) type = 'FOG_CRAWLER';
            else if (roll < 0.5) type = 'SHADOW_BEAST';
            else if (roll < 0.8) type = 'SHADOW_LORD';
            else type = 'SHADOW_STALKER';
        }

        const stats = ENEMIES[type];
        const radius = this.getLightRadius(mainBonfire);
        const angle = Math.random() * Math.PI * 2;
        const dist = radius + CONFIG.SPAWN_MARGIN + Math.random() * 100;

        const sx = mainBonfire.x + Math.cos(angle) * dist;
        const sy = mainBonfire.y + Math.sin(angle) * dist;

        const textureKey = {
            SHADOW_WISP: 'enemy_wisp',
            SHADOW_STALKER: 'enemy_stalker',
            SHADOW_BEAST: 'enemy_beast',
            SHADOW_LORD: 'enemy_lord',
            FOG_CRAWLER: 'enemy_crawler',
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
        enemy.setData('attackCooldown', 0);
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

    // Create enemy from host sync data (client-side)
    _createEnemyFromSync(id, type, x, y, hp) {
        const stats = ENEMIES[type];
        if (!stats) return null;
        const textureKey = {
            SHADOW_WISP: 'enemy_wisp', SHADOW_STALKER: 'enemy_stalker',
            SHADOW_BEAST: 'enemy_beast', SHADOW_LORD: 'enemy_lord',
            FOG_CRAWLER: 'enemy_crawler',
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

        const enemyList = [...this.enemies.children.entries];
        for (const enemy of enemyList) {
            if (!enemy.active) continue;

            const targetsFire = enemy.getData('targetsFire');
            let target;

            if (targetsFire) {
                let nearestDist = Infinity;
                for (const b of this.bonfires) {
                    const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, b.x, b.y);
                    if (d < nearestDist) { nearestDist = d; target = b; }
                }
            } else {
                target = this.player;
            }

            if (!target) continue;

            const speed = enemy.getData('speed');
            const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
            enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
            enemy.setFlipX(Math.cos(angle) < 0);

            if (!targetsFire) {
                const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                let cd = enemy.getData('attackCooldown') - dt * 1000;
                enemy.setData('attackCooldown', cd);
                if (dist < enemy.getData('size') + 16 && cd <= 0) {
                    enemy.setData('attackCooldown', 1000);
                    this.damagePlayer(enemy.getData('damage'));
                    this.showFloatingText(this.player.x, this.player.y - 20, `-${enemy.getData('damage')}`, '#FF4444');
                }
            } else {
                for (const b of this.bonfires) {
                    const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, b.x, b.y);
                    if (d < 30) {
                        const fuel = b.getData('fuel');
                        b.setData('fuel', Math.max(0, fuel - 10));
                        this.showFloatingText(b.x, b.y - 20, '-FUEL', '#4444FF');
                        this.damageEnemy(enemy, 9999);
                    }
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

        // Drop gold
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

        enemy.destroy();
    }

    // Client: handle enemy death from host
    _onEnemyDied(enemyId) {
        const enemy = this._findEnemyById(enemyId);
        if (!enemy) return;
        gameState.kills++;
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

    // --------------------------------------------------------
    // Turret Auto-Attack
    // --------------------------------------------------------
    updateTurrets(dt) {
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

    destroyBuilding(building) {
        const type = building.getData('type');
        this.showFloatingText(building.x, building.y - 20, `${BUILDINGS[type].name} destroyed!`, '#FF4444');

        // Remove bonfire if outpost
        if (type === 'OUTPOST') {
            this.bonfires = this.bonfires.filter(b => {
                if (Phaser.Math.Distance.Between(b.x, b.y, building.x, building.y) < 10) {
                    const emitter = b.getData('emitter');
                    if (emitter) emitter.destroy();
                    b.destroy();
                    return false;
                }
                return true;
            });
        }

        gameState.buildings = gameState.buildings.filter(b => !(b.x === building.x && b.y === building.y));
        building.destroy();
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
        const mainFuel = this.bonfires[0] ? this.bonfires[0].getData('fuel') / this.bonfires[0].getData('maxFuel') : 0;
        this.hud.fuel.style.width = `${mainFuel * 100}%`;
        this.hud.wood.textContent = gameState.resources.wood;
        this.hud.stone.textContent = gameState.resources.stone;
        this.hud.metal.textContent = gameState.resources.metal;
        this.hud.gold.textContent = gameState.resources.gold;
        this.hud.weapon.textContent = WEAPONS[gameState.weapon].name;
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

        // Bonfire fuel sync from peers
        network.onFuelAdded = (bonfireIdx, amount) => {
            if (bonfireIdx >= 0 && bonfireIdx < scene.bonfires.length) {
                const bonfire = scene.bonfires[bonfireIdx];
                const fuel = bonfire.getData('fuel');
                const maxFuel = bonfire.getData('maxFuel');
                bonfire.setData('fuel', Math.min(maxFuel, fuel + amount));
                gameState.fuelAdded++;
                scene.showFloatingText(bonfire.x, bonfire.y - 20, '+FUEL', '#FF8800');
            }
        };

        // Bonfire sync from host (periodic fuel levels)
        network.onBonfireSync = (bonfires) => {
            if (network.isHost) return;
            for (let i = 0; i < bonfires.length && i < scene.bonfires.length; i++) {
                scene.bonfires[i].setData('fuel', bonfires[i].fuel);
            }
        };

        // Host: register world state getter for new peers
        network.setWorldStateGetter(() => {
            return {
                seed: network.worldSeed,
                bonfires: scene.bonfires.map(b => ({
                    x: b.x, y: b.y,
                    fuel: b.getData('fuel'),
                    isMain: b.getData('isMain'),
                })),
                gameTime: gameState.time,
                waveNumber: gameState.waveNumber,
                fuelAdded: gameState.fuelAdded,
            };
        });

        // World sync handler (client receives seed, bonfire state, etc.)
        network.onWorldSync = (msg) => {
            if (msg.fuelAdded !== undefined) gameState.fuelAdded = msg.fuelAdded;
            if (msg.waveNumber !== undefined) gameState.waveNumber = msg.waveNumber;
        };

        // Materialize any peers that connected before callbacks were set (race condition fix)
        for (const [peerId, peer] of network.peers) {
            if (!scene.remotePlayers.has(peerId) && peer.name) {
                network.onPeerJoined(peerId, peer.name, peer.color);
            }
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
