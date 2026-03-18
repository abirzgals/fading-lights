// ============================================================
// MENU SCENE — Atmospheric forest clearing with bonfire + name input
// ============================================================

class MenuScene extends Phaser.Scene {
    constructor() { super('MenuScene'); }

    preload() {
        this.load.spritesheet('weapons_sheet', 'assets/weapons.png', {
            frameWidth: 32, frameHeight: 32,
        });

        // Character variants — load all from folder structure
        const CHAR_VARIANTS = ['male', 'female'];
        const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
        const FRAME_SIZE = { frameWidth: 48, frameHeight: 48 };
        CHAR_VARIANTS.forEach(variant => {
            const base = 'assets/characters/' + variant;
            directions.forEach(dir => {
                this.load.image(variant + '_' + dir, base + '/rotations/' + dir + '.png');
                this.load.spritesheet(variant + '_walk_' + dir, base + '/walk/' + dir + '.png', FRAME_SIZE);
                this.load.spritesheet(variant + '_melee_' + dir, base + '/melee/' + dir + '.png', FRAME_SIZE);
                this.load.spritesheet(variant + '_ranged_' + dir, base + '/ranged/' + dir + '.png', FRAME_SIZE);
            });
        });
        // Pick random character variant each game start
        window._charVariant = CHAR_VARIANTS[Math.floor(Math.random() * CHAR_VARIANTS.length)];
        // Stalker enemy
        directions.forEach(dir => {
            this.load.image('stalker_' + dir, 'assets/pixelart/shadow-stalker/rotations/' + dir + '.png');
            this.load.spritesheet('stalker_walk_' + dir,
                'assets/pixelart/spritesheets/stalker_walk_' + dir + '.png', FRAME_SIZE);
        });
        this.load.image('dark_tree', 'assets/pixelart/dark-tree.png');
        this.load.image('tree_pine', 'assets/pixelart/tree_pine.png');
        this.load.image('tree_oak', 'assets/pixelart/tree_oak.png');
        this.load.image('tree_dead', 'assets/pixelart/tree_dead.png');
        this.load.image('tree_birch', 'assets/pixelart/tree_birch.png');
        this.load.image('pa_stone', 'assets/pixelart/stone_deposit.png');
        this.load.image('pa_metal', 'assets/pixelart/metal_ore.png');
        this.load.image('pa_rock_wall', 'assets/pixelart/rock_wall.png');
        this.load.image('pa_metal_mine', 'assets/pixelart/metal_mine.png');
        this.load.spritesheet('ground_tileset', 'assets/pixelart/ground-tileset.png', {
            frameWidth: 32, frameHeight: 32,
        });
        this.load.image('menu_bg', 'assets/menu_bg.png');
        // Dungeon assets
        this.load.spritesheet('dungeon_tileset', 'assets/dungeon/dungeon-tileset.png', {
            frameWidth: 32, frameHeight: 32,
        });
        this.load.image('dungeon_pillar', 'assets/dungeon/pillar.png');
        this.load.image('dungeon_chest', 'assets/dungeon/chest.png');
        this.load.image('dungeon_torch', 'assets/dungeon/torch.png');
        this.load.image('dungeon_bones', 'assets/dungeon/bones.png');
        this.load.image('boss_south', 'assets/dungeon/boss/rotations/south.png');
        this.load.image('boss_east', 'assets/dungeon/boss/rotations/east.png');
        this.load.image('boss_north', 'assets/dungeon/boss/rotations/north.png');
        this.load.image('boss_west', 'assets/dungeon/boss/rotations/west.png');
    }

    create() {
        generateTextures(this);

        // Create animations for selected character variant
        // Register with 'player_' prefix so game code works unchanged
        const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
        const cv = window._charVariant || 'male';
        console.log('[Character] Using variant:', cv);
        directions.forEach(dir => {
            // Map variant textures to player_ keys so game.js works transparently
            const walkKey = cv + '_walk_' + dir;
            if (this.textures.exists(walkKey)) {
                this.anims.create({
                    key: 'player_walk_' + dir,
                    frames: this.anims.generateFrameNumbers(walkKey, { start: 0, end: 5 }),
                    frameRate: 10, repeat: -1,
                });
            }
            const meleeKey = cv + '_melee_' + dir;
            if (this.textures.exists(meleeKey)) {
                this.anims.create({
                    key: 'player_melee_' + dir,
                    frames: this.anims.generateFrameNumbers(meleeKey, { start: 0, end: 2 }),
                    frameRate: 12, repeat: 0,
                });
            }
            const rangedKey = cv + '_ranged_' + dir;
            if (this.textures.exists(rangedKey)) {
                this.anims.create({
                    key: 'player_ranged_' + dir,
                    frames: this.anims.generateFrameNumbers(rangedKey, { start: 0, end: 6 }),
                    frameRate: 14, repeat: 0,
                });
            }
            // Stalker (unchanged)
            if (this.textures.exists('stalker_walk_' + dir)) {
                this.anims.create({
                    key: 'stalker_walk_' + dir,
                    frames: this.anims.generateFrameNumbers('stalker_walk_' + dir, { start: 0, end: 5 }),
                    frameRate: 10, repeat: -1,
                });
            }
        });

        const w = this.scale.width;
        const h = this.scale.height;

        // --- Pixel art forest background ---
        this.cameras.main.setBackgroundColor('#020105');

        // Start menu music with slow fade-in
        audioEngine.startLoop('menu_music', 3000);

        // Background image scaled to fill screen
        if (this.textures.exists('menu_bg')) {
            const bg = this.add.image(w / 2, h / 2, 'menu_bg').setDepth(0);
            const scaleX = w / bg.width;
            const scaleY = h / bg.height;
            const scale = Math.max(scaleX, scaleY);
            bg.setScale(scale);
        }

        // Fire particle emitter — positioned on the campfire in the background image
        // BG image campfire is at ~50% x, ~78% y in the 320x180 source
        const fireX = w * 0.50;
        const fireY = h * 0.78;

        // Main fire — large, matches the painted fire size
        this.fireEmitter = this.add.particles(fireX, fireY, 'particle', {
            speed: { min: 15, max: 50 },
            angle: { min: 250, max: 290 },
            lifespan: { min: 600, max: 1200 },
            scale: { start: 2.5, end: 0.2 },
            alpha: { start: 0.85, end: 0 },
            tint: [0xFF3300, 0xFF5500, 0xFF7700, 0xFFAA00, 0xFFCC44],
            blendMode: 'ADD',
            frequency: 30,
            quantity: 3,
            x: { min: -8, max: 8 },
        }).setDepth(5);

        // Sparks flying up from campfire
        this.sparkEmitter = this.add.particles(fireX, fireY - 10, 'particle', {
            speed: { min: 40, max: 100 },
            angle: { min: 245, max: 295 },
            lifespan: { min: 1500, max: 3000 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.8, end: 0 },
            tint: [0xFF8800, 0xFFAA00, 0xFFDD00],
            blendMode: 'ADD',
            frequency: 100,
            quantity: 1,
        }).setDepth(5);

        // Fireflies / floating embers across the scene
        this.add.particles(w / 2, h * 0.5, 'particle', {
            x: { min: -w * 0.45, max: w * 0.45 },
            y: { min: -h * 0.3, max: h * 0.3 },
            speed: { min: 2, max: 8 },
            angle: { min: 0, max: 360 },
            lifespan: { min: 3000, max: 6000 },
            scale: { start: 0.2, end: 0.05 },
            alpha: { start: 0.6, end: 0 },
            tint: [0xFFDD44, 0xAAFF44, 0xFFAA00],
            blendMode: 'ADD',
            frequency: 300,
            quantity: 1,
        }).setDepth(3);

        // Warm campfire glow — on the ground around fire
        const groundGlow = this.add.graphics().setDepth(2);
        groundGlow.fillStyle(0xFF6600, 0.06);
        groundGlow.fillEllipse(fireX, fireY + 20, 350, 80);
        groundGlow.fillStyle(0xFF4400, 0.04);
        groundGlow.fillEllipse(fireX, fireY + 10, 220, 50);

        // --- Pulsating firelight glow ---
        const fireLightGlow = this.add.image(fireX, fireY - 20, 'glow')
            .setDepth(4).setScale(8).setAlpha(0.12).setTint(0xFF6600).setBlendMode('ADD');
        this.tweens.add({
            targets: fireLightGlow, scale: 10, alpha: 0.06,
            duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });

        // Drifting fog/mist across the scene
        this.add.particles(w, h * 0.5, 'glow', {
            x: { min: 0, max: 0 },
            y: { min: -h * 0.3, max: h * 0.3 },
            speedX: { min: -20, max: -8 },
            speedY: { min: -3, max: 3 },
            lifespan: { min: 8000, max: 14000 },
            scale: { start: 1.5, end: 0.3 },
            alpha: { start: 0.04, end: 0 },
            tint: [0x222244, 0x1a1a33],
            blendMode: 'ADD',
            frequency: 600,
            quantity: 1,
        }).setDepth(6);

        this.glowGraphics = this.add.graphics().setDepth(4);
        this.bonfireX = fireX;
        this.bonfireY = fireY;

        // --- Fog of war darkness ---
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = w;
        this.fogCanvas.height = h;
        this.fogCtx = this.fogCanvas.getContext('2d');
        if (this.textures.exists('menu_fog')) this.textures.remove('menu_fog');
        this.fogTexture = this.textures.createCanvas('menu_fog', w, h);
        this.fogImage = this.add.image(0, 0, 'menu_fog').setDepth(10).setScrollFactor(0).setOrigin(0, 0);

        // --- Title text ---
        const titleStyle = {
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: Math.min(64, w * 0.06) + 'px',
            color: '#FF8800',
            stroke: '#000000',
            strokeThickness: 4,
            shadow: { color: '#FF4400', blur: 20, fill: true },
        };
        this.add.text(w / 2, h * 0.15, 'THE FADING LIGHT', titleStyle)
            .setOrigin(0.5)
            .setDepth(20)
            .setAlpha(0);

        // Subtitle
        const subStyle = {
            fontFamily: "'Georgia', serif",
            fontSize: Math.min(18, w * 0.018) + 'px',
            color: '#887766',
            fontStyle: 'italic',
        };
        this.add.text(w / 2, h * 0.22, 'Survive the eternal darkness', subStyle)
            .setOrigin(0.5)
            .setDepth(20)
            .setAlpha(0);

        // Version label (bottom-right)
        this.add.text(w - 10, h - 10, `v${GAME_VERSION}`, {
            fontFamily: 'monospace', fontSize: '12px', color: '#555555',
        }).setOrigin(1, 1).setDepth(20);

        // Fade in title
        const title = this.children.list[this.children.list.length - 3];
        const subtitle = this.children.list[this.children.list.length - 2];
        this.tweens.add({ targets: title, alpha: 1, duration: 2000, delay: 500 });
        this.tweens.add({ targets: subtitle, alpha: 0.7, duration: 2000, delay: 1000 });

        // --- Name input (HTML overlay) ---
        this._createNameInput(w, h);

        this._launching = false;

        // --- Resize handler: save name then restart to reflow positioned elements ---
        this.scale.on('resize', () => {
            if (!this.sys.isActive() || this._launching) return;
            const nameEl = document.getElementById('player-name-input');
            if (nameEl && nameEl.value.trim()) network.saveName(nameEl.value.trim());
            this.scene.restart();
        }, this);

        // Start button is now HTML-based (in name-input overlay) for cross-platform compatibility

        // Wakeup progress callback — shows timer when server is sleeping
        this._setupWakeProgress = () => {
            network.onWakeProgress = (elapsed, max, attempt) => {
                const statusEl = document.getElementById('room-status');
                if (!statusEl) return;
                if (elapsed === -1) {
                    // Connected!
                    statusEl.textContent = 'Server ready!';
                    statusEl.style.color = '#44FF44';
                    return;
                }
                const remaining = Math.max(0, max - elapsed);
                statusEl.innerHTML = `Waking up server... <strong>${remaining}s</strong> (attempt ${attempt})`;
                statusEl.style.color = '#FFAA44';
            };
        };

        this._launchGame = () => {
            this._launching = true;
            // Remove input overlay
            const overlay = document.getElementById('name-input-overlay');
            if (overlay) overlay.style.display = 'none';

            this.cameras.main.fadeOut(1200, 0, 0, 0);
            audioEngine.stopLoop('menu_music', 1200);
            this.time.delayedCall(1200, () => {
                gameState = createGameState();
                this.scene.start('GameScene');
            });
        };

        this._getName = () => {
            const nameInput = document.getElementById('player-name-input');
            const name = (nameInput ? nameInput.value.trim() : '') || 'Wanderer';
            network.saveName(name);
            network.playerColor = network.getRandomColor();
            return name;
        };

        // START GAME — join default MAIN room (full retry for server wakeup)
        this._startGame = async () => {
            if (this._launching) return; // prevent double-click
            this._launching = true;
            const name = this._getName();
            const statusEl = document.getElementById('room-status');
            if (statusEl) statusEl.textContent = 'Connecting...';
            this._setupWakeProgress();

            // Try to join the default MAIN room (full retry with wakeup countdown)
            const joined = await network.joinRoom(name, network.playerColor, 'MAIN');

            if (joined) {
                if (statusEl) {
                    statusEl.textContent = 'Connected! Joining game...';
                    statusEl.style.color = '#44FF44';
                }
                setTimeout(() => this._launchGame(), 800);
                return;
            }

            // Could not join — try hosting the MAIN room
            network.disconnect();
            const hostOk = await network._createRoomWithCode(name, network.playerColor, 'MAIN');

            if (statusEl) {
                if (hostOk) {
                    statusEl.textContent = 'Hosting — waiting for players...';
                    statusEl.style.color = '#44FF44';
                } else {
                    statusEl.textContent = 'Playing solo';
                }
            }
            // If server unavailable — force solo host so enemy AI runs
            if (!hostOk) {
                network.isHost = true;
                if (!network.worldSeed) network.worldSeed = network.generateSeed();
            }
            setTimeout(() => this._launchGame(), hostOk ? 2000 : 400);
        };

        // CREATE ROOM — host a multiplayer game
        this._createRoom = async () => {
            const name = this._getName();
            const statusEl = document.getElementById('room-status');
            if (statusEl) statusEl.textContent = 'Creating room...';
            this._setupWakeProgress();

            const ok = await network.createRoom(name, network.playerColor);
            if (ok) {
                if (statusEl) {
                    statusEl.innerHTML = `Room code: <strong>${network.roomCode}</strong> — share this!`;
                    statusEl.style.color = '#44FF44';
                }
                // Show room code prominently
                const codeEl = document.getElementById('room-code-display');
                if (codeEl) {
                    codeEl.textContent = network.roomCode;
                    codeEl.style.display = 'block';
                }
                // Auto-start after a moment (host can play while waiting)
                setTimeout(() => this._launchGame(), 2000);
            } else {
                if (statusEl) {
                    statusEl.textContent = 'Failed to connect. Starting solo...';
                    statusEl.style.color = '#FF4444';
                }
                network.isHost = true;
                network.worldSeed = network.generateSeed();
                setTimeout(() => this._launchGame(), 1500);
            }
        };

        // JOIN ROOM — connect to existing room
        this._joinRoom = async () => {
            const name = this._getName();
            const codeInput = document.getElementById('room-code-input');
            const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
            if (!code || code.length < 4) {
                const statusEl = document.getElementById('room-status');
                if (statusEl) {
                    statusEl.textContent = 'Enter a 4-character room code';
                    statusEl.style.color = '#FF4444';
                }
                return;
            }

            const statusEl = document.getElementById('room-status');
            if (statusEl) statusEl.textContent = 'Joining room ' + code + '...';
            this._setupWakeProgress();

            const ok = await network.joinRoom(name, network.playerColor, code);
            if (ok) {
                if (statusEl) {
                    statusEl.textContent = 'Connected! Starting...';
                    statusEl.style.color = '#44FF44';
                }
                setTimeout(() => this._launchGame(), 1000);
            } else {
                if (statusEl) {
                    statusEl.textContent = 'Room not found. Starting solo...';
                    statusEl.style.color = '#FF4444';
                }
                setTimeout(() => this._launchGame(), 1500);
            }
        };

        // ENTER starts solo
        this.input.keyboard.on('keydown-ENTER', () => {
            this._startGame();
        });

        // Controls hint at bottom
        this.add.text(w / 2, h * 0.92, 'WASD move  |  SPACE / LMB attack  |  E / RMB interact  |  TAB craft  |  B build', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#444444',
        }).setOrigin(0.5).setDepth(20);

        // Pulsate timer
        this.pulseTime = 0;
    }

    _createNameInput(w, h) {
        // Create or reuse the HTML overlay for name input
        let overlay = document.getElementById('name-input-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'name-input-overlay';
            document.getElementById('game-container').appendChild(overlay);
        }
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <label for="player-name-input" style="
                color: #887766;
                font-family: Georgia, serif;
                font-size: 14px;
                margin-bottom: 6px;
                letter-spacing: 1px;
            ">Your Name</label>
            <input type="text" id="player-name-input"
                maxlength="16"
                placeholder="Enter your name..."
                value="${network.loadName()}"
                autocomplete="off"
                spellcheck="false"
            />
            <div id="multiplayer-section">
                <div id="mp-buttons">
                    <button id="btn-create-room" class="mp-btn">CREATE ROOM</button>
                    <span class="mp-or">or</span>
                    <div id="join-row">
                        <input type="text" id="room-code-input"
                            maxlength="4"
                            placeholder="CODE"
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <button id="btn-join-room" class="mp-btn mp-btn-join">JOIN</button>
                    </div>
                </div>
                <div id="room-status"></div>
                <div id="room-code-display" style="display:none"></div>
            </div>
            <button id="html-start-btn" style="
                margin-top: 16px; padding: 12px 40px;
                background: rgba(255, 102, 0, 0.2); border: 1px solid rgba(255, 102, 0, 0.4);
                border-radius: 8px; color: #FF9944; font-family: monospace; font-size: 16px;
                letter-spacing: 3px; cursor: pointer; -webkit-tap-highlight-color: transparent;
            ">START GAME</button>
            <label id="dev-mode-label" style="
                display: flex; align-items: center; gap: 6px;
                color: #555; font-family: monospace; font-size: 11px;
                margin-top: 12px; cursor: pointer; user-select: none;
            ">
                <input type="checkbox" id="dev-mode-checkbox" style="cursor:pointer"
                    ${window._debugMode ? 'checked' : ''} />
                Dev Mode (show enemy paths)
            </label>
        `;

        // Focus input after a short delay — skip on mobile to avoid keyboard popup
        setTimeout(() => {
            const input = document.getElementById('player-name-input');
            const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            if (input && !isMobile) input.focus();

            // Wire up HTML start button
            const htmlStartBtn = document.getElementById('html-start-btn');
            if (htmlStartBtn) {
                htmlStartBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this._startGame) this._startGame();
                });
                htmlStartBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this._startGame) this._startGame();
                });
            }

            // Wire up multiplayer buttons (must wait for DOM)
            const createBtn = document.getElementById('btn-create-room');
            const joinBtn = document.getElementById('btn-join-room');
            if (createBtn) createBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._createRoom) this._createRoom();
            });
            if (joinBtn) joinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._joinRoom) this._joinRoom();
            });

            // Dev mode checkbox
            const devCheck = document.getElementById('dev-mode-checkbox');
            if (devCheck) {
                devCheck.addEventListener('change', () => { window._debugMode = devCheck.checked; });
            }

            // Auto-uppercase room code input
            const codeInput = document.getElementById('room-code-input');
            if (codeInput) {
                codeInput.addEventListener('input', () => {
                    codeInput.value = codeInput.value.toUpperCase();
                });
            }

            // Dev mode: auto-start game immediately (skip menu)
            if (IS_DEV) {
                window._debugMode = true;
                window._charVariant = window._charVariant || 'male';
                network.playerName = network.playerName || 'Dev';
                network.playerColor = network.playerColor || network.getRandomColor();
                // Hide menu HTML overlay
                const overlay = document.getElementById('name-input-overlay');
                if (overlay) overlay.style.display = 'none';
                gameState = createGameState();
                this.scene.start('GameScene');
                return;
            }
        }, 500);
    }

    update(time, delta) {
        this.pulseTime += delta;

        // Update fog of war
        const ctx = this.fogCtx;
        const w = this.fogCanvas.width;
        const h = this.fogCanvas.height;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(2, 1, 5, 0.97)';
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'destination-out';

        // Bonfire light with pulsation
        const pulse = 1.0 + Math.sin(this.pulseTime * 0.003) * 0.04 + Math.sin(this.pulseTime * 0.007) * 0.03;
        const radius = 260 * pulse;
        const bx = this.bonfireX;
        const by = this.bonfireY;

        const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(0.4, 'rgba(0,0,0,0.9)');
        gradient.addColorStop(0.7, 'rgba(0,0,0,0.4)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();

        // Warm tint
        ctx.globalCompositeOperation = 'source-atop';
        const tg = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        tg.addColorStop(0, 'rgba(255, 100, 30, 0.15)');
        tg.addColorStop(0.5, 'rgba(255, 60, 10, 0.06)');
        tg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();

        // Copy to Phaser texture
        this.fogTexture.context.clearRect(0, 0, w, h);
        this.fogTexture.context.drawImage(this.fogCanvas, 0, 0);
        this.fogTexture.refresh();
    }
}
