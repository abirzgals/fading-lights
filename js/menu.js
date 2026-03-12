// ============================================================
// MENU SCENE — Atmospheric forest clearing with bonfire + name input
// ============================================================

class MenuScene extends Phaser.Scene {
    constructor() { super('MenuScene'); }

    create() {
        generateTextures(this);

        const w = this.scale.width;
        const h = this.scale.height;

        // --- Dark forest background ---
        this.cameras.main.setBackgroundColor('#020105');

        // Start menu music with slow fade-in
        audioEngine.startLoop('menu_music', 3000);

        // Distant fog layer
        this.fogParticles = this.add.particles(w / 2, h / 2, 'glow', {
            x: { min: -w * 0.6, max: w * 0.6 },
            y: { min: -h * 0.4, max: h * 0.4 },
            lifespan: { min: 6000, max: 10000 },
            speed: { min: 3, max: 12 },
            angle: { min: 170, max: 190 },
            scale: { start: 0.8, end: 0.1 },
            alpha: { start: 0.04, end: 0 },
            tint: [0x222244, 0x1a1a33, 0x110022],
            frequency: 200,
            blendMode: 'ADD',
        });

        // Tree silhouettes in background
        const treePositions = [];
        for (let i = 0; i < 18; i++) {
            const tx = Phaser.Math.Between(0, w);
            const ty = Phaser.Math.Between(h * 0.3, h * 0.85);
            const scale = 0.8 + Math.random() * 1.5;
            const tree = this.add.image(tx, ty, 'menu_tree')
                .setScale(scale)
                .setAlpha(0.15 + Math.random() * 0.15)
                .setDepth(1)
                .setTint(0x0a0a12);
            treePositions.push(tree);
        }

        // --- Central bonfire ---
        const bonfireX = w / 2;
        const bonfireY = h * 0.62;
        this.add.image(bonfireX, bonfireY, 'bonfire').setScale(3).setDepth(3).setAlpha(0.8);

        // Fire particles
        this.fireEmitter = this.add.particles(bonfireX, bonfireY - 20, 'particle', {
            speed: { min: 15, max: 50 },
            angle: { min: 250, max: 290 },
            lifespan: { min: 600, max: 1200 },
            scale: { start: 1.2, end: 0.1 },
            alpha: { start: 0.95, end: 0 },
            tint: [0xFF3300, 0xFF5500, 0xFF7700, 0xFFAA00, 0xFFCC44],
            blendMode: 'ADD',
            frequency: 30,
            quantity: 3,
        });
        this.fireEmitter.setDepth(5);

        // Sparks flying up
        this.sparkEmitter = this.add.particles(bonfireX, bonfireY - 10, 'particle', {
            speed: { min: 40, max: 100 },
            angle: { min: 240, max: 300 },
            lifespan: { min: 1500, max: 3000 },
            scale: { start: 0.3, end: 0 },
            alpha: { start: 0.8, end: 0 },
            tint: [0xFF8800, 0xFFAA00, 0xFFDD00],
            blendMode: 'ADD',
            frequency: 150,
            quantity: 1,
        });
        this.sparkEmitter.setDepth(5);

        // Warm ground glow
        const groundGlow = this.add.graphics();
        groundGlow.setDepth(2);
        const glowGradient = groundGlow.createGeometryMask();
        groundGlow.fillStyle(0xFF6600, 0.06);
        groundGlow.fillEllipse(bonfireX, bonfireY + 20, 500, 120);
        groundGlow.fillStyle(0xFF4400, 0.04);
        groundGlow.fillEllipse(bonfireX, bonfireY + 10, 350, 80);

        // --- Light glow overlay (pulsating) ---
        this.glowGraphics = this.add.graphics().setDepth(4);
        this.bonfireX = bonfireX;
        this.bonfireY = bonfireY;

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

        // --- Start button ---
        const btnY = h * 0.78;
        const btnBg = this.add.graphics().setDepth(20);
        btnBg.fillStyle(0xFF6600, 0.15);
        btnBg.fillRoundedRect(w / 2 - 100, btnY - 22, 200, 44, 12);
        btnBg.lineStyle(1, 0xFF6600, 0.3);
        btnBg.strokeRoundedRect(w / 2 - 100, btnY - 22, 200, 44, 12);

        const btnText = this.add.text(w / 2, btnY, 'START GAME', {
            fontFamily: "'Segoe UI', sans-serif",
            fontSize: '16px',
            color: '#FF9944',
            letterSpacing: 4,
        }).setOrigin(0.5).setDepth(21);

        // Make button interactive
        const btnZone = this.add.zone(w / 2, btnY, 200, 44).setInteractive({ useHandCursor: true }).setDepth(22);
        btnZone.on('pointerover', () => {
            btnBg.clear();
            btnBg.fillStyle(0xFF6600, 0.3);
            btnBg.fillRoundedRect(w / 2 - 100, btnY - 22, 200, 44, 12);
            btnBg.lineStyle(1, 0xFF8800, 0.6);
            btnBg.strokeRoundedRect(w / 2 - 100, btnY - 22, 200, 44, 12);
            btnText.setColor('#FFBB66');
        });
        btnZone.on('pointerout', () => {
            btnBg.clear();
            btnBg.fillStyle(0xFF6600, 0.15);
            btnBg.fillRoundedRect(w / 2 - 100, btnY - 22, 200, 44, 12);
            btnBg.lineStyle(1, 0xFF6600, 0.3);
            btnBg.strokeRoundedRect(w / 2 - 100, btnY - 22, 200, 44, 12);
            btnText.setColor('#FF9944');
        });

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

        btnZone.on('pointerdown', () => this._startGame());

        // ENTER starts solo
        this.input.keyboard.on('keydown-ENTER', () => {
            this._startGame();
        });

        // Fade in button
        btnBg.setAlpha(0);
        btnText.setAlpha(0);
        this.tweens.add({ targets: [btnBg, btnText], alpha: 1, duration: 1000, delay: 1500 });

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
        `;

        // Focus input after a short delay (so scene loads first)
        setTimeout(() => {
            const input = document.getElementById('player-name-input');
            if (input) input.focus();

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

            // Auto-uppercase room code input
            const codeInput = document.getElementById('room-code-input');
            if (codeInput) {
                codeInput.addEventListener('input', () => {
                    codeInput.value = codeInput.value.toUpperCase();
                });
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
