import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { FogOfWarPostProcessor, FogLight } from '../engine/FogOfWarPostProcessor';
import { EntityFactory } from '../entities/EntityFactory';
import { AssetLoader } from '../engine/AssetLoader';
import { Level1Script, LevelData } from '../world/LevelScript';
import { CONFIG, ENEMIES, BUILDINGS } from '../config';
import { EnemyType, BuildingType } from '../types';
import { audioEngine } from '../engine/AudioEngine';

// Components for queries
import { HealthComponent } from '../components/HealthComponent';
import { AIBrainComponent } from '../components/AIBrainComponent';
import { MeleeAttackComponent } from '../components/MeleeAttackComponent';
import { RangedAttackComponent } from '../components/RangedAttackComponent';
import { ResourceComponent } from '../components/ResourceComponent';
import { AnimatedSpriteComponent } from '../components/AnimatedSpriteComponent';
import { BotAI, BotGameState } from '../ai/BotAI';
import { EnemyBrainSystem } from '../ai/EnemyBrainSystem';
import { setGridSystem } from '../components/GridOccupancyComponent';
import { BuildingComponent } from '../components/BuildingComponent';
import { LightSourceComponent } from '../components/LightSourceComponent';
import { ShadowCasterComponent } from '../components/ShadowCasterComponent';

const T = CONFIG.TILE_SIZE;

/**
 * Main game scene — thin orchestrator.
 * Level layout comes from LevelScript.
 * Entity logic lives in components.
 */
export class GameScene extends ex.Scene {
  private fog!: FogOfWarPostProcessor;
  private level!: LevelData;
  private botAI: BotAI | null = null;
  private botEnabled = true;
  private enemyBrains!: EnemyBrainSystem;

  // Game state
  private hp: number = 1000;
  private resources = { wood: 5, stone: 0, metal: 0, gold: 0 };
  private bonfireFuel = 80;
  private campFuelAdded = 0;   // cumulative fuel (never decreases — drives level progression)
  private campLevel = 0;       // current bonfire level (0-5)
  private kills = 0;
  private spawnTimer = 0;
  private waveTimer = 0;
  private waveNumber = 0;
  private totalSpawned = 0;
  private readonly MAX_ALIVE = 10;
  private feedCooldown = 0;
  private drops: GameEntity[] = [];
  private armorBonus = 0;      // damage reduction from Armor Workshop

  // Build spots
  private buildSpots: Array<{
    type: BuildingType;
    unlockLevel: number;
    wx: number; wy: number;
    state: 'locked' | 'unlocked' | 'built';
    ghost?: GameEntity;
    building?: GameEntity;
  }> = [];
  private buildings: GameEntity[] = [];
  private debugMode = false;
  private debugActors: ex.Actor[] = [];
  private debugCheckbox: HTMLInputElement | null = null;

  onInitialize(engine: ex.Engine): void {
    console.log('[GameScene] initializing...');

    this.fog = new FogOfWarPostProcessor();
    engine.graphicsContext.addPostProcessor(this.fog);

    // Generate level from script
    this.level = Level1Script.generate(this);
    setGridSystem(this.level.grid);

    this.camera.strategy.lockToActor(this.level.player);
    this.camera.zoom = 2;
    this.createHUD();

    audioEngine.startMusic();
    audioEngine.startFireCrackle();

    // Initialize build spots around main bonfire
    this.initBuildSpots();

    // Spawn starter ranged enemies for testing
    const bf = this.level.bonfires[0];
    if (bf) {
      for (const type of ['SHADOW_ARCHER', 'VOID_MAGE'] as EnemyType[]) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 180 + Math.random() * 80;
        const pos = this.level.grid.findWalkableNear(
          bf.pos.x + Math.cos(angle) * dist,
          bf.pos.y + Math.sin(angle) * dist
        );
        const enemy = EntityFactory.createEnemy(this, pos.x, pos.y, type);
        this.level.enemies.push(enemy);
      }
    }

    // Enemy AI system
    this.enemyBrains = new EnemyBrainSystem(this.level.grid);

    // Bot AI — toggle with backtick key
    this.botAI = new BotAI({
      player: this.level.player,
      grid: this.level.grid,
      getEntities: () => this.level.entities,
      getEnemies: () => this.level.enemies,
      getBonfires: () => this.level.bonfires,
    });
    engine.input.keyboard.on('press', (evt: ex.KeyEvent) => {
      if (evt.key === ex.Keys.Backquote) {
        this.botEnabled = !this.botEnabled;
        if (!this.botEnabled) this.botAI?.removeDebugHUD();
        console.log(`[Bot] ${this.botEnabled ? 'ENABLED' : 'DISABLED'}`);
      }
    });

    // Debug checkbox
    this.createDebugCheckbox();

    console.log(`[GameScene] initialized — ${this.level.entities.length} entities, ${this.level.enemies.length} enemies`);
  }

  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.pushEntitiesOutOfBlocked();
    this.handlePlayerInput(engine, dt);
    this.runEnemyAI(dt);
    this.runSpawning(dt);
    this.runDropPickup();
    this.runBonfire(dt);
    this.runBuildSpots();
    this.updateFog();
    this.depthSort();
    this.updateEnemyHPBars();
    if (this.debugMode) this.renderDebugOverlay();
    this.updateHUD();
  }

  // ======== PUSH OUT OF BLOCKED — prevent entities stuck in colliders ========

  private pushEntitiesOutOfBlocked(): void {
    const grid = this.level.grid;

    // Player
    const p = this.level.player;
    const pFix = grid.pushOutOfBlocked(p.pos.x, p.pos.y);
    if (pFix) { p.pos = ex.vec(pFix.x, pFix.y); p.vel = ex.vec(0, 0); }

    // Enemies
    for (const e of this.level.enemies) {
      if (e.isKilled() || e.isDying) continue;
      const eFix = grid.pushOutOfBlocked(e.pos.x, e.pos.y);
      if (eFix) { e.pos = ex.vec(eFix.x, eFix.y); e.vel = ex.vec(0, 0); }
    }
  }

  // ======== PLAYER INPUT ========

  private handlePlayerInput(engine: ex.Engine, dt: number): void {
    const player = this.level.player;
    let vx = 0, vy = 0;
    let shouldAttack = false;

    if (this.botEnabled && this.botAI) {
      // Pass current game state to bot
      this.botAI.setGameState({
        bonfireFuel: this.bonfireFuel,
        bonfireMaxFuel: CONFIG.BONFIRE_MAX_FUEL,
        resources: { ...this.resources },
        campLevel: this.campLevel,
        campFuelAdded: this.campFuelAdded,
        availableBuildSpots: this.buildSpots
          .filter(s => s.state === 'unlocked')
          .filter(s => {
            // Exclude spots with blocked tiles — bot should clear them first
            const stx = Math.floor(s.wx / T), sty = Math.floor(s.wy / T);
            return !this.level.grid.isBlocked(stx, sty);
          })
          .map(s => ({ type: s.type, wx: s.wx, wy: s.wy, cost: BUILDINGS[s.type].cost })),
        // Build spots that are blocked by resources — bot should clear these
        blockedBuildSpots: this.buildSpots
          .filter(s => s.state === 'unlocked')
          .filter(s => {
            const stx = Math.floor(s.wx / T), sty = Math.floor(s.wy / T);
            return this.level.grid.isBlocked(stx, sty);
          })
          .map(s => ({ wx: s.wx, wy: s.wy })),
        drops: this.drops
          .filter(d => !d.isKilled() && !(d as any)._flyingToPlayer)
          .map(d => ({ x: d.pos.x, y: d.pos.y, type: (d as any).dropType as string })),
      });
      const cmd = this.botAI.update(dt);
      vx = cmd.vx;
      vy = cmd.vy;
      shouldAttack = cmd.attack;
      // Bot wants to interact (feed bonfire) — handled by runBonfire() with animation
    } else {
      // Human controls
      const kb = engine.input.keyboard;
      if (kb.isHeld(ex.Keys.W) || kb.isHeld(ex.Keys.Up)) vy = -1;
      if (kb.isHeld(ex.Keys.S) || kb.isHeld(ex.Keys.Down)) vy = 1;
      if (kb.isHeld(ex.Keys.A) || kb.isHeld(ex.Keys.Left)) vx = -1;
      if (kb.isHeld(ex.Keys.D) || kb.isHeld(ex.Keys.Right)) vx = 1;
      if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
      shouldAttack = kb.wasPressed(ex.Keys.Space);
    }

    // Freeze player during attack animation
    const playerAnim = player.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
    if (playerAnim?.isAttacking) {
      vx = 0; vy = 0;
    }

    const speed = CONFIG.PLAYER_SPEED;
    const gc = this.level.grid.applyGridCollision(
      player.pos.x - 8, player.pos.x + 8, player.pos.y - 7, player.pos.y + 7, vx, vy, speed);
    player.vel = ex.vec(gc.vx * speed, gc.vy * speed);

    if (gc.vx !== 0 || gc.vy !== 0) audioEngine.startFootsteps();
    else audioEngine.stopFootsteps();

    // Attack
    if (shouldAttack) {
      const melee = player.get(MeleeAttackComponent) as MeleeAttackComponent | null;
      const anim = player.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
      if (melee?.canAttack && !anim?.isAttacking) {
        audioEngine.playAttack();

        // Play attack animation with damage callback
        if (anim) {
          anim.playAttack(() => {
            // DAMAGE FRAME — deal damage to nearest enemy AND nearest resource in range

            // Enemies — nearest within melee range
            const nearest = this.level.enemies
              .filter(e => !e.isKilled() && !e.isDying && e.pos.distance(player.pos) < melee.range)
              .sort((a, b) => a.pos.distance(player.pos) - b.pos.distance(player.pos))[0];
            if (nearest) melee.startAttack(nearest);

            // Resources — prioritize resource in facing direction
            const pAnim = player.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
            const facing = pAnim?.direction ?? 'south';
            const facingDirs: Record<string, { x: number; y: number }> = {
              south: { x: 0, y: 1 }, north: { x: 0, y: -1 },
              east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
              'south-east': { x: 0.707, y: 0.707 }, 'south-west': { x: -0.707, y: 0.707 },
              'north-east': { x: 0.707, y: -0.707 }, 'north-west': { x: -0.707, y: -0.707 },
            };
            const fDir = facingDirs[facing] ?? { x: 0, y: 1 };

            const nearRes = this.level.entities
              .filter(e => !e.isKilled() && e.get(ResourceComponent) && e.pos.distance(player.pos) < 52)
              .sort((a, b) => {
                // Score = distance - facing bonus (dot * 30px)
                // Lower = better. Facing direction gets 30px advantage
                const tA = a.pos.sub(player.pos);
                const tB = b.pos.sub(player.pos);
                const lenA = tA.distance(ex.Vector.Zero) || 1;
                const lenB = tB.distance(ex.Vector.Zero) || 1;
                const dotA = (tA.x * fDir.x + tA.y * fDir.y) / lenA;
                const dotB = (tB.x * fDir.x + tB.y * fDir.y) / lenB;
                const scoreA = lenA - dotA * 30;
                const scoreB = lenB - dotB * 30;
                return scoreA - scoreB;
              })[0];
            if (nearRes) this.damageResource(nearRes);
          });
        }
      }
    }

    // Clean dead enemies — play death animation instead of instant kill
    this.level.enemies = this.level.enemies.filter(e => {
      if (e.isKilled()) return false;
      if (e.isDying) return true; // keep in list until fully dead
      const hp = e.get(HealthComponent) as HealthComponent | null;
      if (hp && !hp.alive) {
        this.kills++;
        audioEngine.playEnemyDeath();
        e.playDeath(); // fall over → 3s wait → 3s fade → kill
        return true; // keep in list during death animation
      }
      return true;
    });
  }

  // ======== DROP PICKUP — auto-collect when walking over ========

  private runDropPickup(): void {
    const player = this.level.player;
    this.drops = this.drops.filter(drop => {
      if (drop.isKilled()) return false;
      // Skip drops already flying to player
      if ((drop as any)._flyingToPlayer) return true;
      const dist = player.pos.distance(drop.pos);
      if (dist < CONFIG.PICKUP_RADIUS) {
        // Animate: fly toward player, then collect
        (drop as any)._flyingToPlayer = true;
        const type = (drop as any).dropType as string;
        drop.z = 9998;
        // Fly to player position over 300ms
        const flyDuration = 300;
        const startPos = drop.pos.clone();
        let elapsed = 0;
        drop.on('preupdate', (_evt: any) => {
          elapsed += 16; // ~60fps
          const t = Math.min(elapsed / flyDuration, 1);
          // Lerp toward current player position
          drop.pos = ex.vec(
            startPos.x + (player.pos.x - startPos.x) * t,
            startPos.y + (player.pos.y - startPos.y) * t - Math.sin(t * Math.PI) * 15, // slight arc up
          );
          drop.scale = ex.vec(1 - t * 0.5, 1 - t * 0.5); // shrink
          if (t >= 1) {
            if (type in this.resources) {
              (this.resources as any)[type] += 1;
            }
            drop.kill();
          }
        });
        return true; // keep in array until killed
      }
      return true;
    });
    // Remove killed
    this.drops = this.drops.filter(d => !d.isKilled());
  }

  /** Spawn a floating text that rises and fades */
  /** Spawn hit sparks when attacking a resource */
  private spawnHitSparks(x: number, y: number, resourceType: string): void {
    const colors: Record<string, string[]> = {
      wood: ['#8B6914', '#AA8833', '#665522', '#CCAA55'],
      stone: ['#888888', '#AAAAAA', '#666666', '#CCCCCC'],
      metal: ['#B87333', '#CC8844', '#FFAA44', '#DD9955'],
    };
    const palette = colors[resourceType] ?? colors.stone;
    const count = 4 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i++) {
      const spark = new ex.Actor({
        pos: ex.vec(x + (Math.random() - 0.5) * 8, y - 4 + (Math.random() - 0.5) * 8),
        anchor: ex.vec(0.5, 0.5),
      });
      const size = 1.5 + Math.random() * 2;
      const color = palette[Math.floor(Math.random() * palette.length)];
      spark.graphics.use(new ex.Rectangle({
        width: size, height: size,
        color: ex.Color.fromHex(color),
      }));
      spark.z = 9500;
      // Random velocity — spray outward
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 60;
      spark.vel = ex.vec(Math.cos(angle) * speed, Math.sin(angle) * speed - 30);
      // Gravity-like deceleration + fade
      spark.actions.fade(0, 300 + Math.random() * 200).die();
      this.add(spark);
    }
  }

  /** Damage a resource entity (tree, stone, metal) */
  private damageResource(entity: GameEntity): void {
    const hp = entity.get(HealthComponent) as HealthComponent | null;
    const res = entity.get(ResourceComponent) as ResourceComponent | null;
    if (!hp || !res) return;

    hp.damage(10);
    this.spawnHitSparks(entity.pos.x, entity.pos.y, res.resourceType);
    // Hit effect is handled by HitEffectComponent on the entity (auto-detects HP change)

    if (!hp.alive) {
      for (let i = 0; i < res.dropAmount; i++) {
        const drop = EntityFactory.createDrop(this, entity.pos.x, entity.pos.y, res.resourceType as any);
        this.drops.push(drop);
      }
      this.spawnFloatingText(entity.pos.x, entity.pos.y - 16,
        `+${res.dropAmount} ${res.resourceType}`, '#44FF44');
      if (entity.entityType === 'tree') {
        this.spawnStump(entity.pos.x, entity.pos.y);
      }
      entity.kill();
    }
  }

  /** Spawn a tree stump — visible for 20s, then fades out in 3s. Not a collider. */
  private spawnStump(x: number, y: number): void {
    const stump = new ex.Actor({
      pos: ex.vec(x, y + 10), // slightly below tree center (at ground)
      anchor: ex.vec(0.5, 0.5),
    });
    // Simple stump graphic — brown rectangle with darker top
    stump.graphics.use(new ex.Rectangle({
      width: 12, height: 8,
      color: ex.Color.fromHex('#5a3a1a'),
    }));
    stump.z = -0.5; // below characters but above ground
    stump.actions
      .delay(20000)   // visible for 20 seconds
      .fade(0, 3000)  // fade out over 3 seconds
      .die();
    this.add(stump);
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    const label = new ex.Label({
      text,
      pos: ex.vec(x, y),
      font: new ex.Font({
        family: 'monospace', size: 8, color: ex.Color.fromHex(color),
        textAlign: ex.TextAlign.Center,
      }),
      anchor: ex.vec(0.5, 0.5),
    });
    label.z = 9999;
    label.vel = ex.vec(0, -30);
    label.actions.fade(0, 1200).die();
    this.add(label);
  }

  /** Spawn a stick that flies parabolically from source to target */
  private spawnParabolicStick(fromX: number, fromY: number, toX: number, toY: number): void {
    const stick = new ex.Actor({
      pos: ex.vec(fromX, fromY),
      anchor: ex.vec(0.5, 0.5),
    });
    if (AssetLoader.woodDrop.isLoaded()) {
      stick.graphics.use(AssetLoader.woodDrop.toSprite());
    } else {
      stick.graphics.use(new ex.Rectangle({ width: 10, height: 4, color: ex.Color.fromHex('#8B6914') }));
    }
    stick.z = 9998;

    const duration = 500; // ms
    const startX = fromX, startY = fromY;
    const dx = toX - fromX, dy = toY - fromY;
    const arcHeight = 40 + Math.abs(dx) * 0.15; // higher arc for longer distances
    let elapsed = 0;

    stick.on('preupdate', () => {
      elapsed += 16;
      const t = Math.min(elapsed / duration, 1);
      // Linear position + parabolic arc
      stick.pos = ex.vec(
        startX + dx * t,
        startY + dy * t - Math.sin(t * Math.PI) * arcHeight,
      );
      // Rotate as it flies
      stick.rotation = t * Math.PI * 2;
      stick.scale = ex.vec(1 - t * 0.3, 1 - t * 0.3);
      if (t >= 1) {
        stick.kill();
      }
    });

    this.add(stick);
  }

  // ======== ENEMY AI — delegated to EnemyBrainSystem ========

  private runEnemyAI(dt: number): void {
    this.enemyBrains.update(
      this.level.enemies, this.level.player, this.level.bonfires, this, dt
    );
  }

  // ======== SPAWNING — progressive waves ========
  // Wave 0 (0:00): 1 mob, Wave 1 (1:00): 2 mobs, Wave 2 (2:00): 3 mobs, ...
  // Each wave spawns its quota spread over the minute (not all at once)
  // Max 10 alive enemies at any time

  // Enemy pool — early waves get weak enemies, later waves get stronger ones
  private static readonly WAVE_POOLS: EnemyType[][] = [
    ['SHADOW_WISP'],                                          // wave 0
    ['SHADOW_WISP', 'SHADOW_WISP', 'SHADOW_STALKER'],        // wave 1
    ['SHADOW_WISP', 'SHADOW_STALKER', 'SHADOW_STALKER'],     // wave 2
    ['SHADOW_STALKER', 'FOG_CRAWLER', 'SHADOW_ARCHER'],      // wave 3
    ['SHADOW_STALKER', 'SHADOW_ARCHER', 'VOID_MAGE', 'FOG_CRAWLER'], // wave 4
    ['SHADOW_BEAST', 'SHADOW_ARCHER', 'VOID_MAGE', 'SHADOW_STALKER'], // wave 5
    ['SHADOW_BEAST', 'SHADOW_LORD', 'VOID_MAGE', 'SHADOW_ARCHER', 'FOG_CRAWLER'], // wave 6+
  ];

  private runSpawning(dt: number): void {
    this.waveTimer += dt;
    this.spawnTimer += dt;

    // Check for new wave every 60 seconds
    const newWave = Math.floor(this.waveTimer / 60);
    if (newWave > this.waveNumber) {
      this.waveNumber = newWave;
      console.log(`[Spawn] Wave ${this.waveNumber} — spawning up to ${this.waveNumber + 1} enemies`);
    }

    // How many enemies this wave wants alive
    const waveQuota = Math.min(this.waveNumber + 1, this.MAX_ALIVE);
    const aliveCount = this.level.enemies.filter(e => !e.isKilled() && !e.isDying).length;

    // Spawn interval: spread spawns over the minute (min 3s between spawns)
    const spawnInterval = Math.max(3, 60 / (waveQuota + 1));

    if (this.spawnTimer >= spawnInterval && aliveCount < waveQuota) {
      this.spawnTimer = 0;

      const player = this.level.player;
      const angle = Math.random() * Math.PI * 2;
      const dist = 280 + Math.random() * 200;

      // Pick from wave-appropriate pool
      const poolIdx = Math.min(this.waveNumber, GameScene.WAVE_POOLS.length - 1);
      const pool = GameScene.WAVE_POOLS[poolIdx];
      const type = pool[Math.floor(Math.random() * pool.length)];

      // Find walkable spawn position
      const rawX = player.pos.x + Math.cos(angle) * dist;
      const rawY = player.pos.y + Math.sin(angle) * dist;
      const spawnPos = this.level.grid.findWalkableNear(rawX, rawY);

      const enemy = EntityFactory.createEnemy(this, spawnPos.x, spawnPos.y, type);
      this.level.enemies.push(enemy);
      this.totalSpawned++;

      if (Math.random() < 0.3) audioEngine.playEnemyRoar();
    }
  }

  // ======== BONFIRE + LEVEL SYSTEM ========

  private runBonfire(dt: number): void {
    this.bonfireFuel = Math.max(0, this.bonfireFuel - CONFIG.BONFIRE_BURN_RATE * dt);
    this.feedCooldown = Math.max(0, this.feedCooldown - dt);

    const player = this.level.player;
    const bf = this.level.bonfires[0];
    // Allow feeding if: fuel not full OR still leveling up (even at full fuel, feed for XP)
    const isMaxLevel = this.campLevel >= CONFIG.FIRE_LEVELS.length - 1;
    const needsFuel = this.bonfireFuel < CONFIG.BONFIRE_MAX_FUEL * 0.9;
    const needsLevelUp = !isMaxLevel;
    if (this.resources.wood > 0 && bf &&
      bf.pos.distance(player.pos) < CONFIG.INTERACT_RADIUS &&
      (needsFuel || needsLevelUp) &&
      this.feedCooldown <= 0) {
      this.resources.wood--;
      const added = Math.min(CONFIG.FUEL_PER_WOOD, CONFIG.BONFIRE_MAX_FUEL - this.bonfireFuel);
      this.bonfireFuel = Math.min(CONFIG.BONFIRE_MAX_FUEL, this.bonfireFuel + CONFIG.FUEL_PER_WOOD);
      this.campFuelAdded += CONFIG.FUEL_PER_WOOD; // cumulative — never decreases
      this.feedCooldown = 0.5;

      // Parabolic stick animation
      this.spawnParabolicStick(player.pos.x, player.pos.y - 8, bf.pos.x, bf.pos.y - 4);
      this.spawnFloatingText(bf.pos.x, bf.pos.y - 20, `+${Math.round(added)} fuel`, '#FF8800');

      // Check for level-up
      this.checkBonfireLevelUp(bf);
    }
  }

  private checkBonfireLevelUp(bf: GameEntity): void {
    const levels = CONFIG.FIRE_LEVELS;
    while (this.campLevel < levels.length - 1 &&
           this.campFuelAdded >= levels[this.campLevel + 1]) {
      this.campLevel++;
      console.log(`[Bonfire] Level UP! Now level ${this.campLevel}`);

      // Notification
      this.spawnFloatingText(bf.pos.x, bf.pos.y - 32,
        `CAMP LEVEL ${this.campLevel}!`, '#CC66FF');

      // Darkness stirs warning (level 2+)
      if (this.campLevel >= 2) {
        setTimeout(() => {
          this.spawnFloatingText(bf.pos.x, bf.pos.y - 44,
            'THE DARKNESS STIRS...', '#FF2222');
        }, 800);
      }
    }
  }

  // ======== BUILD SPOTS ========

  private initBuildSpots(): void {
    const bf = this.level.bonfires[0];
    if (!bf) return;

    for (const spot of CONFIG.BUILD_SPOTS) {
      const rad = (spot.angle * Math.PI) / 180;
      let wx = bf.pos.x + Math.cos(rad) * spot.dist * T;
      let wy = bf.pos.y + Math.sin(rad) * spot.dist * T;

      // Snap to nearest walkable tile if blocked
      const ttx = Math.floor(wx / T), tty = Math.floor(wy / T);
      if (this.level.grid.isBlocked(ttx, tty)) {
        let found = false;
        for (let r = 1; r <= 4 && !found; r++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            for (let dy = -r; dy <= r && !found; dy++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              if (!this.level.grid.isBlocked(ttx + dx, tty + dy)) {
                wx = (ttx + dx) * T + T / 2;
                wy = (tty + dy) * T + T / 2;
                found = true;
              }
            }
          }
        }
        if (!found) continue; // skip this spot entirely
      }

      this.buildSpots.push({
        type: spot.type as BuildingType,
        unlockLevel: spot.unlockLevel,
        wx, wy,
        state: 'locked',
      });
    }
  }

  private runBuildSpots(): void {
    const player = this.level.player;

    for (const spot of this.buildSpots) {
      // Unlock new spots when camp levels up
      if (spot.state === 'locked' && this.campLevel >= spot.unlockLevel) {
        spot.state = 'unlocked';
        spot.ghost = EntityFactory.createBuildSpotGhost(this, spot.wx, spot.wy, spot.type);
      }

      // Auto-build for bot (or E key for human) when near unlocked spot
      if (spot.state === 'unlocked') {
        // Check if spot tile is blocked by a resource — need to clear it first
        const spotTx = Math.floor(spot.wx / T), spotTy = Math.floor(spot.wy / T);
        if (this.level.grid.isBlocked(spotTx, spotTy)) continue; // tile blocked, can't build yet

        const dist = player.pos.distance(ex.vec(spot.wx, spot.wy));
        if (dist < CONFIG.INTERACT_RADIUS) {
          const def = BUILDINGS[spot.type];
          if (this.canAfford(def.cost)) {
            // Build it!
            this.deductCost(def.cost);
            if (spot.ghost) { spot.ghost.kill(); spot.ghost = undefined; }
            spot.building = EntityFactory.createBuilding(this, spot.wx, spot.wy, spot.type);
            spot.state = 'built';
            this.buildings.push(spot.building);

            // Init building component
            const bc = spot.building.get(BuildingComponent) as BuildingComponent | null;
            if (bc) bc.init(this, () => this.level.enemies);

            // Apply passive effects
            if (spot.type === 'ARMOR_WORKSHOP') this.armorBonus = 0.3;

            this.spawnFloatingText(spot.wx, spot.wy - 20, `${def.name} built!`, '#44FF44');
            console.log(`[Build] ${def.name} built at (${Math.round(spot.wx)}, ${Math.round(spot.wy)})`);
          }
        }
      }
    }
  }

  private canAfford(cost: Partial<Record<string, number>>): boolean {
    for (const [res, amt] of Object.entries(cost)) {
      if ((this.resources as any)[res] < (amt ?? 0)) return false;
    }
    return true;
  }

  private deductCost(cost: Partial<Record<string, number>>): void {
    for (const [res, amt] of Object.entries(cost)) {
      (this.resources as any)[res] -= amt ?? 0;
    }
  }

  // ======== FOG ========

  private updateFog(): void {
    const lights: FogLight[] = [];
    const zoom = this.camera.zoom;
    const player = this.level.player;

    // Update shadow light sources (world coordinates with wobble — same as fog)
    const shadowLights: Array<{ x: number; y: number; radius: number }> = [];
    const t = performance.now();
    for (const bf of this.level.bonfires) {
      const fuelFrac = this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL;
      const levelMult = 1.0 + this.campLevel * 0.5;
      const r = (CONFIG.BONFIRE_MIN_RADIUS + fuelFrac * (CONFIG.BONFIRE_BASE_RADIUS - CONFIG.BONFIRE_MIN_RADIUS)) * levelMult;
      // Same wobble as fog shader for consistent shadow movement
      const seed = bf.pos.x * 7.3 + bf.pos.y * 13.1;
      const wobbleX = Math.sin(t * 0.003 + seed) * 4 + Math.sin(t * 0.007 + seed * 0.5) * 2;
      const wobbleY = Math.cos(t * 0.004 + seed * 1.3) * 3 + Math.cos(t * 0.009 + seed * 0.7) * 1.5;
      shadowLights.push({ x: bf.pos.x + wobbleX, y: bf.pos.y + wobbleY, radius: r });
    }
    for (const b of this.buildings) {
      if (b.isKilled()) continue;
      const light = b.get(LightSourceComponent) as LightSourceComponent | null;
      if (light) shadowLights.push({ x: b.pos.x, y: b.pos.y, radius: light.radius });
    }
    ShadowCasterComponent.lightSources = shadowLights;

    for (const bf of this.level.bonfires) {
      const fuelFrac = this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL;
      const levelMult = 1.0 + this.campLevel * 0.5; // +50% per level
      const baseRadius = CONFIG.BONFIRE_MIN_RADIUS + fuelFrac * (CONFIG.BONFIRE_BASE_RADIUS - CONFIG.BONFIRE_MIN_RADIUS);
      const radius = baseRadius * levelMult;
      const t = performance.now(), seed = bf.pos.x * 7.3 + bf.pos.y * 13.1;
      const screen = this.engine.worldToScreenCoordinates(bf.pos.add(ex.vec(
        Math.sin(t * 0.003 + seed) * 4, Math.cos(t * 0.004 + seed * 1.3) * 3)));
      lights.push({ x: screen.x, y: screen.y, radius: radius * zoom, intensity: 1.0, softness: 0.5,
        tintR: 1.0, tintG: 0.47, tintB: 0.16, tintA: 0.12 });
    }
    // Outpost lights
    for (const b of this.buildings) {
      if (b.isKilled()) continue;
      const light = b.get(LightSourceComponent) as LightSourceComponent | null;
      if (light) {
        const bs = this.engine.worldToScreenCoordinates(b.pos);
        lights.push({ x: bs.x, y: bs.y, radius: light.radius * zoom, intensity: light.intensity, softness: light.softness,
          tintR: light.tintR, tintG: light.tintG, tintB: light.tintB, tintA: light.tintA });
      }
    }
    const ps = this.engine.worldToScreenCoordinates(player.pos);
    lights.push({ x: ps.x, y: ps.y, radius: 60 * zoom, intensity: 0.85, softness: 0.5,
      tintR: 0, tintG: 0, tintB: 0, tintA: 0 });
    this.fog.setLights(lights);
  }

  // ======== DEPTH SORT ========

  private depthSort(): void {
    this.level.player.z = this.level.player.pos.y;
    for (const e of this.level.entities) if (!e.isKilled()) e.z = e.pos.y;
    for (const e of this.level.enemies) if (!e.isKilled()) e.z = e.pos.y;
    for (const b of this.buildings) if (!b.isKilled()) b.z = b.pos.y;
  }

  // ======== ENEMY HP BARS ========

  private hpBars: Map<GameEntity, { bg: ex.Actor; fill: ex.Actor }> = new Map();

  private updateEnemyHPBars(): void {
    const BAR_W = 20, BAR_H = 3, Y_OFF = -18;

    for (const e of this.level.enemies) {
      if (e.isKilled() || e.isDying) {
        // Clean up bar for dead/dying enemies
        const bar = this.hpBars.get(e);
        if (bar) { bar.bg.kill(); bar.fill.kill(); this.hpBars.delete(e); }
        continue;
      }

      const hp = e.get(HealthComponent) as HealthComponent | null;
      if (!hp) continue;
      const ratio = hp.hp / hp.maxHp;

      let bar = this.hpBars.get(e);
      if (!bar) {
        // Create bar actors
        const bg = new ex.Actor({ pos: e.pos.add(ex.vec(0, Y_OFF)), anchor: ex.vec(0.5, 0.5) });
        bg.graphics.use(new ex.Rectangle({ width: BAR_W, height: BAR_H, color: ex.Color.fromHex('#333333') }));
        const fill = new ex.Actor({ pos: e.pos.add(ex.vec(0, Y_OFF)), anchor: ex.vec(0, 0.5) });
        fill.graphics.use(new ex.Rectangle({ width: BAR_W, height: BAR_H, color: ex.Color.fromHex('#44FF44') }));
        this.add(bg);
        this.add(fill);
        bar = { bg, fill };
        this.hpBars.set(e, bar);
      }

      // Update position
      bar.bg.pos = e.pos.add(ex.vec(0, Y_OFF));
      bar.bg.z = e.z + 0.1;
      bar.fill.pos = e.pos.add(ex.vec(-BAR_W / 2, Y_OFF));
      bar.fill.z = e.z + 0.2;

      // Update fill width + color
      const fillW = Math.max(1, Math.round(BAR_W * ratio));
      const color = ratio > 0.5 ? '#44FF44' : ratio > 0.25 ? '#FFAA00' : '#FF4444';
      bar.fill.graphics.use(new ex.Rectangle({ width: fillW, height: BAR_H, color: ex.Color.fromHex(color) }));

      // Hide at full HP
      bar.bg.graphics.opacity = ratio < 1 ? 0.8 : 0;
      bar.fill.graphics.opacity = ratio < 1 ? 1.0 : 0;
    }

    // Clean up bars for removed enemies
    for (const [e, bar] of this.hpBars) {
      if (e.isKilled() || !this.level.enemies.includes(e)) {
        bar.bg.kill();
        bar.fill.kill();
        this.hpBars.delete(e);
      }
    }
  }

  // ======== DEBUG OVERLAY ========

  private createDebugCheckbox(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:10001;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'debug-toggle';
    cb.checked = this.debugMode;
    cb.style.cssText = 'cursor:pointer;';
    cb.addEventListener('change', () => {
      this.debugMode = cb.checked;
      if (!this.debugMode) this.clearDebugOverlay();
    });
    const label = document.createElement('label');
    label.htmlFor = 'debug-toggle';
    label.textContent = ' Debug';
    label.style.cssText = 'color:#888;font:11px monospace;cursor:pointer;';
    wrap.appendChild(cb);
    wrap.appendChild(label);
    document.body.appendChild(wrap);
    this.debugCheckbox = cb;
    (this as any)._debugWrap = wrap;
  }

  private clearDebugOverlay(): void {
    for (const a of this.debugActors) a.kill();
    this.debugActors = [];
  }

  private renderDebugOverlay(): void {
    this.clearDebugOverlay();
    const cam = this.camera;
    const vp = this.engine.screen.resolution;
    const zoom = cam.zoom;

    // Visible tile range
    const camX = cam.pos.x, camY = cam.pos.y;
    const halfW = vp.width / zoom / 2 + T, halfH = vp.height / zoom / 2 + T;
    const minTX = Math.max(0, Math.floor((camX - halfW) / T));
    const maxTX = Math.min(this.level.grid.getSize() - 1, Math.ceil((camX + halfW) / T));
    const minTY = Math.max(0, Math.floor((camY - halfH) / T));
    const maxTY = Math.min(this.level.grid.getSize() - 1, Math.ceil((camY + halfH) / T));

    // Draw blocked tiles as red semi-transparent
    for (let tx = minTX; tx <= maxTX; tx++) {
      for (let ty = minTY; ty <= maxTY; ty++) {
        if (!this.level.grid.isBlocked(tx, ty)) continue;
        const a = new ex.Actor({
          pos: ex.vec(tx * T + T / 2, ty * T + T / 2),
          anchor: ex.vec(0.5, 0.5),
        });
        a.graphics.use(new ex.Rectangle({ width: T - 1, height: T - 1, color: ex.Color.fromRGB(255, 0, 0, 0.2) }));
        a.z = 8000;
        this.add(a);
        this.debugActors.push(a);
      }
    }

    // Highlight player tile (blue)
    {
      const pp = this.level.player;
      const ptx = Math.floor(pp.pos.x / T), pty = Math.floor(pp.pos.y / T);
      const pt = new ex.Actor({ pos: ex.vec(ptx * T + T / 2, pty * T + T / 2), anchor: ex.vec(0.5, 0.5) });
      pt.graphics.use(new ex.Rectangle({ width: T, height: T, color: ex.Color.fromRGB(0, 100, 255, 0.3) }));
      pt.z = 8001;
      this.add(pt);
      this.debugActors.push(pt);
    }

    // Highlight bot target tile (yellow)
    {
      const bg = this.botAI ? (this.botAI as any).currentGoal : null;
      if (bg?.target) {
        const ttx = Math.floor(bg.target.pos.x / T), tty = Math.floor(bg.target.pos.y / T);
        const tt = new ex.Actor({ pos: ex.vec(ttx * T + T / 2, tty * T + T / 2), anchor: ex.vec(0.5, 0.5) });
        tt.graphics.use(new ex.Rectangle({ width: T, height: T, color: ex.Color.fromRGB(255, 255, 0, 0.3) }));
        tt.z = 8001;
        this.add(tt);
        this.debugActors.push(tt);
      }
    }

    // Draw A* paths with lines + dots
    const drawPath = (
      points: Array<{ x: number; y: number }>,
      startIdx: number,
      startPos: { x: number; y: number },
      dotColor: ex.Color,
      lineColor: ex.Color,
    ) => {
      let prevX = startPos.x, prevY = startPos.y;
      for (let i = startIdx; i < points.length; i++) {
        const wp = points[i];
        // Line from prev to current
        const dx = wp.x - prevX, dy = wp.y - prevY;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          const line = new ex.Actor({
            pos: ex.vec((prevX + wp.x) / 2, (prevY + wp.y) / 2),
            anchor: ex.vec(0.5, 0.5),
          });
          line.graphics.use(new ex.Rectangle({ width: len, height: 1.5, color: lineColor }));
          line.rotation = Math.atan2(dy, dx);
          line.z = 8001;
          this.add(line);
          this.debugActors.push(line);
        }
        // Dot at waypoint
        const dot = new ex.Actor({ pos: ex.vec(wp.x, wp.y), anchor: ex.vec(0.5, 0.5) });
        dot.graphics.use(new ex.Circle({ radius: 3, color: dotColor }));
        dot.z = 8002;
        this.add(dot);
        this.debugActors.push(dot);
        prevX = wp.x; prevY = wp.y;
      }
    };

    // Player bot: A* path (green) or intent line (cyan) to goal
    const botPf = this.botAI ? (this.botAI as any).pathFollower : null;
    const botGoal = this.botAI ? (this.botAI as any).currentGoal : null;
    const player = this.level.player;
    if (botPf?.getPath()) {
      const path = botPf.getPath() as Array<{ x: number; y: number }>;
      const idx = botPf.getPathIdx() as number ?? 0;
      drawPath(path, idx, { x: player.pos.x, y: player.pos.y },
        ex.Color.fromRGB(0, 255, 0, 0.8),
        ex.Color.fromRGB(0, 255, 0, 0.4));
    } else if (botGoal && botGoal.x !== undefined && botGoal.y !== undefined) {
      // No A* path — show direct intent line (cyan dashed)
      drawPath([{ x: botGoal.x, y: botGoal.y }], 0,
        { x: player.pos.x, y: player.pos.y },
        ex.Color.fromRGB(0, 200, 255, 0.6),
        ex.Color.fromRGB(0, 200, 255, 0.3));
    }

    // Enemy paths (orange)
    for (const e of this.level.enemies) {
      if (e.isKilled()) continue;
      const ePath = (e as any)._aiPath as Array<{ x: number; y: number }> | null;
      const eIdx = (e as any)._aiPathIdx as number ?? 0;
      if (!ePath) continue;
      drawPath(ePath, eIdx, { x: e.pos.x, y: e.pos.y },
        ex.Color.fromRGB(255, 100, 0, 0.7),
        ex.Color.fromRGB(255, 100, 0, 0.3));
    }
  }

  // ======== HUD ========

  private hudEl!: HTMLDivElement;
  private createHUD(): void {
    this.hudEl = document.createElement('div');
    this.hudEl.style.cssText = 'position:fixed;top:8px;left:8px;color:#fff;font:bold 12px monospace;z-index:999;pointer-events:none;line-height:1.8;text-shadow:0 0 4px #000';
    document.body.appendChild(this.hudEl);
  }
  private updateHUD(): void {
    if (!this.hudEl) return;
    const fuelPct = Math.round(this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL * 100);
    const hpBar = '█'.repeat(Math.min(10, Math.round(this.hp / 100))) + '░'.repeat(Math.max(0, 10 - Math.round(this.hp / 100)));
    const fuelBar = '█'.repeat(Math.round(fuelPct / 10)) + '░'.repeat(10 - Math.round(fuelPct / 10));
    // Camp level progress
    const levels = CONFIG.FIRE_LEVELS;
    const isMax = this.campLevel >= levels.length - 1;
    let lvlProgress = 100;
    if (!isMax) {
      const prev = levels[this.campLevel];
      const next = levels[this.campLevel + 1];
      lvlProgress = Math.round(((this.campFuelAdded - prev) / (next - prev)) * 100);
    }
    const lvlBar = '█'.repeat(Math.round(lvlProgress / 10)) + '░'.repeat(10 - Math.round(lvlProgress / 10));
    const lvlLabel = isMax ? `Lv.${this.campLevel} MAX` : `Lv.${this.campLevel}`;

    this.hudEl.innerHTML = `
      <span style="color:#44FF44">HP [${hpBar}] ${Math.round(this.hp)}</span><br>
      <span style="color:#FF8800">FIRE [${fuelBar}] ${fuelPct}%</span><br>
      <span style="color:#CC66FF">CAMP [${lvlBar}] ${lvlLabel}</span><br>
      <span style="color:#AA8844">Wood ${this.resources.wood}</span> ·
      <span style="color:#888">Stone ${this.resources.stone}</span> ·
      <span style="color:#CC8844">Metal ${this.resources.metal}</span> ·
      <span style="color:#FFD700">Gold ${this.resources.gold}</span><br>
      <span style="color:#AA66FF">Kills ${this.kills}</span> ·
      <span style="color:#FF4444">Enemies ${this.level.enemies.filter(e => !e.isKilled() && !e.isDying).length}</span> ·
      <span style="color:#FFAA44">Wave ${this.waveNumber}</span>
      ${this.botEnabled ? `<br><span style="color:#44FFFF">BOT: ${this.botAI?.goal ?? '?'}</span>` : ''}`;
  }
  onDeactivate(): void {
    if (this.hudEl) this.hudEl.remove();
    if ((this as any)._debugWrap) (this as any)._debugWrap.remove();
    this.clearDebugOverlay();
    this.botAI?.removeDebugHUD();
  }
}
