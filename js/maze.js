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

        // Floor tiles
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                if (grid[gy][gx] === 1) {
                    this.add.image(gx * TILE + 16, gy * TILE + 16, 'maze_floor').setDepth(0);
                }
            }
        }

        // Walls — only tiles adjacent to a floor tile (performance)
        this.walls = this.physics.add.staticGroup();
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                if (grid[gy][gx] === 0 && this._bordersFloor(grid, gx, gy, GRID_W, GRID_H)) {
                    const w = this.walls.create(gx * TILE + 16, gy * TILE + 16, 'maze_stone');
                    w.setDepth(2).refreshBody();
                }
            }
        }

        // --- Player ---
        const sr  = rooms[0];
        const spx = (sr.x + Math.floor(sr.w / 2)) * TILE + 16;
        const spy = (sr.y + Math.floor(sr.h / 2)) * TILE + 16;
        const texKey = (typeof getPlayerTextureKey !== 'undefined')
            ? getPlayerTextureKey(network.playerColor) : 'player';
        this.player = this.physics.add.sprite(
            spx, spy, this.textures.exists(texKey) ? texKey : 'player');
        this.player.setDepth(5).setCollideWorldBounds(true);
        this.player.body.setSize(14, 12).setOffset(9, 32);
        this.player.facing = { x: 0, y: 1 };
        this.player.attackCooldown = 0;
        this.physics.add.collider(this.player, this.walls);

        // --- Enemies ---
        this.mazeEnemies = this.physics.add.group();
        this._spawnEnemies(rooms, TILE);
        this.physics.add.collider(this.mazeEnemies, this.walls);

        // HP graphics (redrawn each frame)
        this._hpGfx = this.add.graphics().setDepth(60);

        // --- Treasure (last room centre) ---
        const er       = rooms[rooms.length - 1];
        const tresX    = (er.x + Math.floor(er.w / 2)) * TILE + 16;
        const tresY    = (er.y + Math.floor(er.h / 2)) * TILE + 16;
        this.treasure  = this.add.sprite(tresX, tresY, 'treasure_chest').setDepth(3).setScale(1.15);
        this.tweens.add({
            targets: this.treasure,
            scaleX: 1.3, scaleY: 1.3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        const tGlow = this.add.image(tresX, tresY, 'glow')
            .setDepth(2.8).setScale(2.8).setAlpha(0.55).setTint(0xFFAA00).setBlendMode('ADD');
        this.tweens.add({ targets: tGlow, scale: 3.3, alpha: 0.28, duration: 850, yoyo: true, repeat: -1 });

        this._treasureHint = this.add.text(tresX, tresY - 28, '[E] Open the Chest', {
            fontSize: '9px', fill: '#FFD700', fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(10).setAlpha(0);

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

        // --- Input ---
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd    = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
        this.input.keyboard.on('keydown-E', () => this._interact());
        this.input.keyboard.on('keydown-F', () => this._interact());
        this.input.on('pointerdown', (ptr) => {
            if (ptr.leftButtonDown())  this._attack();
            if (ptr.rightButtonDown()) this._interact();
        });
        this._attackKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this._interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

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
                    hp = 40; dmg = 12; spd = 60; size = 14; texKey = 'enemy_stalker';
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
        this._lightW   = worldW;
        this._lightH   = worldH;
        this._lightGfx = this.make.graphics({ add: false });
        this._lightRT  = this.add.renderTexture(0, 0, worldW, worldH)
            .setDepth(80).setScrollFactor(1).setOrigin(0, 0);
    }

    _updateTorchLight() {
        const p = this.player, rt = this._lightRT, g = this._lightGfx, r = this._torchRadius;
        rt.clear();
        g.clear(); g.fillStyle(0x000000, 0.95); g.fillRect(0, 0, this._lightW, this._lightH);
        rt.draw(g, 0, 0);
        g.clear(); g.fillStyle(0xFFFFFF, 1); g.fillCircle(p.x, p.y, r);
        rt.erase(g, 0, 0);
        g.clear();
        g.fillStyle(0xFF7700, 0.12); g.fillCircle(p.x, p.y, r * 0.65);
        g.fillStyle(0xFFAA00, 0.07); g.fillCircle(p.x, p.y, r * 0.38);
        rt.draw(g, 0, 0);
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
        if (vx !== 0 || vy !== 0)
            p.facing = { x: Math.sign(vx), y: Math.sign(vy) };

        // Attack cooldown
        if (p.attackCooldown > 0) p.attackCooldown -= delta;

        // Keyboard attack (SPACE) + interact (E)
        if (Phaser.Input.Keyboard.JustDown(this._attackKey))   this._attack();
        if (Phaser.Input.Keyboard.JustDown(this._interactKey)) this._interact();

        // Mouse facing + held-LMB auto-attack
        const ptr = this.input.activePointer;
        if (ptr.isDown && ptr.leftButtonDown() && p.attackCooldown <= 0) this._attack();
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

        // --- Visuals ---
        this._updateTorchLight();
        this._updateWeaponPos();
        this._drawEnemyHpBars();

        // --- Treasure hint ---
        const distT = Phaser.Math.Distance.Between(p.x, p.y, this.treasure.x, this.treasure.y);
        this._treasureHint.setAlpha(distT < 58 ? 1 : 0);

        // --- HUD ---
        gameState.hp = Math.max(0, gameState.hp);
        this._hudHp.setText(`♥ HP: ${Math.ceil(gameState.hp)} / ${CONFIG.PLAYER_MAX_HP}`);

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

                // Melee attack
                if (dist < 16 && ecd <= 0) {
                    e.setData('atkCd', 1100);
                    const armor = gameState.armor || 0;
                    const dmg   = Math.max(1, Math.floor(e.getData('dmg') * (1 - armor)));
                    gameState.hp -= dmg;
                    this.cameras.main.flash(120, 80, 0, 0);
                    this._floatText(p.x, p.y - 20, `-${dmg}`, '#FF4444');
                }
            } else {
                // Wander inside room
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
        this._floatText(e.x, e.y - 16, `-${amount}`, '#FF6644');
        this.tweens.add({ targets: e, alpha: 0.15, duration: 60, yoyo: true,
            onComplete: () => { if (e.active) e.setAlpha(0.92); } });

        if (hp <= 0) {
            this._killCount++;
            const gold = 1 + Math.floor(Math.random() * 3);
            gameState.resources.gold = (gameState.resources.gold || 0) + gold;
            this._floatText(e.x, e.y - 30, `+${gold} gold`, '#FFD700');
            e.destroy();
        }
    }

    _floatText(x, y, msg, color) {
        const t = this.add.text(x, y, msg, {
            fontSize: '9px', fill: color, fontFamily: 'monospace',
            stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(55);
        this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 650,
            onComplete: () => t.destroy() });
    }

    // ----------------------------------------------------------
    // INTERACT  (treasure)
    // ----------------------------------------------------------
    _interact() {
        if (this._done) return;
        const d = Phaser.Math.Distance.Between(
            this.player.x, this.player.y, this.treasure.x, this.treasure.y);
        if (d < 58) this._collectTreasure();
    }

    // ----------------------------------------------------------
    // PLAYER DEATH
    // ----------------------------------------------------------
    _playerDied() {
        if (this._done) return;
        this._done = true;
        this.player.setVelocity(0, 0);
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
                audioEngine.stopLoop?.('music', 500);
                audioEngine.stopLoop?.('ambient', 500);
            }
        });
    }
}
