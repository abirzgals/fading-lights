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

    console.log(`[GameScene] initialized — ${this.level.entities.length} entities, ${this.level.enemies.length} enemies`);
  }

  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.handlePlayerInput(engine, dt);
    this.runEnemyAI(dt);
    this.runSpawning(dt);
    this.runDropPickup();
    this.runBonfire(dt);
    this.runBuildSpots();
    this.updateFog();
    this.depthSort();
    this.updateEnemyHPBars();
    this.updateHUD();
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
          .map(s => ({ type: s.type, wx: s.wx, wy: s.wy, cost: BUILDINGS[s.type].cost })),
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
            // DAMAGE FRAME — deal damage to nearest enemy or resource
            // Enemies
            const nearest = this.level.enemies
              .filter(e => !e.isKilled() && e.pos.distance(player.pos) < melee.range)
              .sort((a, b) => a.pos.distance(player.pos) - b.pos.distance(player.pos))[0];
            if (nearest) melee.startAttack(nearest);

            // Resources
            const nearRes = this.level.entities
              .filter(e => !e.isKilled() && e.get(ResourceComponent))
              .sort((a, b) => a.pos.distance(player.pos) - b.pos.distance(player.pos))[0];
            if (nearRes && nearRes.pos.distance(player.pos) < 52) {
              const hp = nearRes.get(HealthComponent) as HealthComponent | null;
              const res = nearRes.get(ResourceComponent) as ResourceComponent | null;
              if (hp && res) {
                hp.damage(10);
                if (!hp.alive) {
                  // Spawn drops on the ground
                  for (let i = 0; i < res.dropAmount; i++) {
                    const drop = EntityFactory.createDrop(this, nearRes.pos.x, nearRes.pos.y, res.resourceType as any);
                    this.drops.push(drop);
                  }
                  this.spawnFloatingText(nearRes.pos.x, nearRes.pos.y - 16,
                    `+${res.dropAmount} ${res.resourceType}`, '#44FF44');
                  nearRes.kill();
                }
              }
            }
          });
        }
      }
    }

    // Clean dead enemies
    this.level.enemies = this.level.enemies.filter(e => {
      if (e.isKilled()) return false;
      const hp = e.get(HealthComponent) as HealthComponent | null;
      if (hp && !hp.alive) { this.kills++; audioEngine.playEnemyDeath(); e.kill(); return false; }
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
    const aliveCount = this.level.enemies.filter(e => !e.isKilled()).length;

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

      const enemy = EntityFactory.createEnemy(this,
        player.pos.x + Math.cos(angle) * dist,
        player.pos.y + Math.sin(angle) * dist, type);
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
      const wx = bf.pos.x + Math.cos(rad) * spot.dist * T;
      const wy = bf.pos.y + Math.sin(rad) * spot.dist * T;

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

    // Update shadow light sources (world coordinates)
    const shadowLights: Array<{ x: number; y: number; radius: number }> = [];
    for (const bf of this.level.bonfires) {
      const fuelFrac = this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL;
      const levelMult = 1.0 + this.campLevel * 0.5;
      const r = (CONFIG.BONFIRE_MIN_RADIUS + fuelFrac * (CONFIG.BONFIRE_BASE_RADIUS - CONFIG.BONFIRE_MIN_RADIUS)) * levelMult;
      shadowLights.push({ x: bf.pos.x, y: bf.pos.y, radius: r });
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
      if (e.isKilled()) {
        // Clean up bar
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
      <span style="color:#FF4444">Enemies ${this.level.enemies.filter(e => !e.isKilled()).length}</span> ·
      <span style="color:#FFAA44">Wave ${this.waveNumber}</span>
      ${this.botEnabled ? `<br><span style="color:#44FFFF">BOT: ${this.botAI?.goal ?? '?'}</span>` : ''}`;
  }
  onDeactivate(): void {
    if (this.hudEl) this.hudEl.remove();
    this.botAI?.removeDebugHUD();
  }
}
