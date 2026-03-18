import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { FogOfWarPostProcessor, FogLight } from '../engine/FogOfWarPostProcessor';
import { AssetLoader } from '../engine/AssetLoader';
import { HealthComponent } from '../components/HealthComponent';
import { GridOccupancyComponent, setGridSystem } from '../components/GridOccupancyComponent';
import { LightSourceComponent } from '../components/LightSourceComponent';
import { CONFIG, ENEMIES, WEAPONS } from '../config';
import { EnemyType, Direction } from '../types';
import { audioEngine } from '../engine/AudioEngine';

const T = CONFIG.TILE_SIZE;
const WORLD_TILES = CONFIG.WORLD_TILES;

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function facingToDirection(fx: number, fy: number): Direction {
  if (fy > 0 && Math.abs(fx) < 0.3) return 'south';
  if (fy < 0 && Math.abs(fx) < 0.3) return 'north';
  if (fx > 0 && Math.abs(fy) < 0.3) return 'east';
  if (fx < 0 && Math.abs(fy) < 0.3) return 'west';
  if (fx > 0 && fy > 0) return 'south-east';
  if (fx < 0 && fy > 0) return 'south-west';
  if (fx > 0 && fy < 0) return 'north-east';
  return 'north-west';
}

export class GameScene extends ex.Scene {
  private grid!: GridCollisionSystem;
  private fog!: FogOfWarPostProcessor;
  private player!: GameEntity;
  private _gameEntities: GameEntity[] = [];
  private bonfires: GameEntity[] = [];
  private enemies: GameEntity[] = [];

  // Walk animations
  private walkAnims: Map<string, ex.Animation> = new Map();

  // State
  private facing = { x: 0, y: 1 };
  private lastDir: Direction = 'south';
  private attackCooldown = 0;
  private spawnTimer = 0;
  private kills = 0;
  private hp: number = CONFIG.PLAYER_MAX_HP;
  private bonfireFuel = 80;
  private resources = { wood: 5, stone: 0, metal: 0, gold: 0 };

  onInitialize(engine: ex.Engine): void {
    console.log('[GameScene] initializing...');

    this.grid = new GridCollisionSystem(WORLD_TILES, T);
    setGridSystem(this.grid);

    this.fog = new FogOfWarPostProcessor();
    engine.graphicsContext.addPostProcessor(this.fog);

    // Build walk animations
    const dirs: Direction[] = ['south', 'north', 'east', 'west', 'south-east', 'south-west', 'north-east', 'north-west'];
    for (const dir of dirs) {
      const sheet = AssetLoader.getWalkSpriteSheet(dir);
      if (sheet) {
        const anim = ex.Animation.fromSpriteSheet(sheet, ex.range(0, 5), 100);
        this.walkAnims.set(dir, anim);
      }
    }

    this.generateWorld();

    this.camera.strategy.lockToActor(this.player);
    this.camera.zoom = 2;
    this.createHUD(engine);

    // Start music and ambient audio
    audioEngine.startMusic();
    audioEngine.startFireCrackle();

    console.log(`[GameScene] initialized — ${this._gameEntities.length} entities`);
  }

  private generateWorld(): void {
    const rng = seededRandom(42);
    const worldSize = WORLD_TILES;
    const cx = Math.floor(worldSize / 2);
    const cy = Math.floor(worldSize / 2);

    // Dark ground chunks
    const chunkSize = 16;
    for (let gy = 0; gy < worldSize; gy += chunkSize) {
      for (let gx = 0; gx < worldSize; gx += chunkSize) {
        const chunk = new ex.Actor({
          pos: ex.vec((gx + chunkSize / 2) * T, (gy + chunkSize / 2) * T),
          width: chunkSize * T, height: chunkSize * T,
          color: ex.Color.fromHex('#050a02'), anchor: ex.vec(0.5, 0.5),
        });
        chunk.z = -10;
        this.add(chunk);
      }
    }

    // Perlin-like noise for tree density (exact original algo)
    const noiseGrid = 16;
    const noiseVals: number[] = [];
    for (let i = 0; i < noiseGrid * noiseGrid; i++) noiseVals.push(rng());
    const getNoise = (tx: number, ty: number) => {
      const gx = (tx / worldSize) * (noiseGrid - 1);
      const gy = (ty / worldSize) * (noiseGrid - 1);
      const ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy;
      const ix1 = Math.min(ix + 1, noiseGrid - 1), iy1 = Math.min(iy + 1, noiseGrid - 1);
      const a = noiseVals[iy * noiseGrid + ix], b = noiseVals[iy * noiseGrid + ix1];
      const c = noiseVals[iy1 * noiseGrid + ix], d = noiseVals[iy1 * noiseGrid + ix1];
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };

    // Winding paths from center (original algo)
    const pathTiles = new Set<string>();
    const numPaths = 4 + Math.floor(rng() * 3);
    for (let p = 0; p < numPaths; p++) {
      let angle = (p / numPaths) * Math.PI * 2 + (rng() - 0.5) * 0.6;
      let px = cx, py = cy;
      for (let step = 0; step < 30 + Math.floor(rng() * 40); step++) {
        angle += (rng() - 0.5) * 0.4;
        px += Math.cos(angle) * 1.2; py += Math.sin(angle) * 1.2;
        const tpx = Math.round(px), tpy = Math.round(py);
        if (tpx < 1 || tpx >= worldSize - 1 || tpy < 1 || tpy >= worldSize - 1) break;
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            if (Math.abs(dx) + Math.abs(dy) <= 1 || rng() < 0.3)
              pathTiles.add(`${tpx + dx},${tpy + dy}`);
      }
    }

    // Clearings
    const clearings = [{ x: cx, y: cy, r: 5 }];
    for (let c = 0; c < 6 + Math.floor(rng() * 5); c++) {
      const a = rng() * Math.PI * 2, d = 10 + rng() * 50;
      clearings.push({ x: Math.round(cx + Math.cos(a) * d), y: Math.round(cy + Math.sin(a) * d), r: 3 + Math.floor(rng() * 4) });
    }
    const isClearing = (tx: number, ty: number) => clearings.some(cl => (tx - cl.x) ** 2 + (ty - cl.y) ** 2 < cl.r ** 2);
    const isPath = (tx: number, ty: number) => pathTiles.has(`${tx},${ty}`);

    // Draw roads with Wang tile transitions (same as original)
    const WANG_TO_FRAME = [6,7,10,9,2,11,4,15,5,14,1,8,3,0,13,12];
    const gs = AssetLoader.groundTileset.isLoaded()
      ? ex.SpriteSheet.fromImageSource({ image: AssetLoader.groundTileset, grid: { rows: 4, columns: 4, spriteWidth: 32, spriteHeight: 32 } })
      : null;

    // Build render set (path tiles + 1-tile border for transitions)
    const renderSet = new Set<string>();
    for (const key of pathTiles) {
      const [tx, ty] = key.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          renderSet.add(`${tx + dx},${ty + dy}`);
    }

    for (const key of renderSet) {
      const [tx, ty] = key.split(',').map(Number);
      // Wang corner sampling: NW, NE, SW, SE
      const nw = pathTiles.has(`${tx},${ty}`) ? 1 : 0;
      const ne = pathTiles.has(`${tx + 1},${ty}`) ? 1 : 0;
      const sw = pathTiles.has(`${tx},${ty + 1}`) ? 1 : 0;
      const se = pathTiles.has(`${tx + 1},${ty + 1}`) ? 1 : 0;
      const wangIdx = nw * 8 + ne * 4 + sw * 2 + se;
      if (wangIdx === 0) continue; // all corners empty = no tile

      const road = new ex.Actor({ pos: ex.vec(tx * T + T / 2, ty * T + T / 2), anchor: ex.vec(0.5, 0.5) });
      if (gs) {
        const frameIdx = WANG_TO_FRAME[wangIdx];
        const col = frameIdx % 4, row = Math.floor(frameIdx / 4);
        road.graphics.use(gs.getSprite(col, row)!);
      } else {
        road.graphics.use(new ex.Rectangle({ width: T, height: T, color: ex.Color.fromHex('#3a2a1a') }));
      }
      road.z = -8;
      this.add(road);
    }

    // Bonfire + Player
    this.createBonfire(cx * T + T / 2, cy * T + T / 2);
    this.player = this.createPlayer(cx * T + T / 2, (cy - 2) * T + T / 2);

    // Trees — noise-driven density (original algorithm)
    for (let tx = 2; tx < worldSize - 2; tx++) {
      for (let ty = 2; ty < worldSize - 2; ty++) {
        if (isClearing(tx, ty) || isPath(tx, ty)) continue;
        const density = getNoise(tx, ty) * 0.6 + getNoise(tx * 2.7 + 50, ty * 2.7 + 50) * 0.4;
        const threshold = density > 0.55 ? 0.25 : density > 0.35 ? 0.7 : 0.94;
        if (rng() > threshold) continue;
        if ((tx - cx) ** 2 + (ty - cy) ** 2 < 25) continue;
        if (this.grid.isBlocked(tx, ty)) continue;
        this.createTree(tx * T + T / 2, ty * T + T / 2 - T, tx, ty, Math.floor(rng() * AssetLoader.treeVariants.length));
      }
    }

    // Starter stones near bonfire
    let placed = 0;
    for (let s = 0; placed < 12 && s < 50; s++) {
      const a = (s / 12) * Math.PI * 2, d = 3 + Math.floor(rng() * 3);
      const stx = Math.round(cx + Math.cos(a) * d), sty = Math.round(cy + Math.sin(a) * d);
      if (this.grid.isBlocked(stx, sty) || isPath(stx, sty)) continue;
      this.createStone(stx * T + T / 2, sty * T + T / 2, stx, sty);
      placed++;
    }

    // Scattered stones
    for (let i = 0; i < 60; i++) {
      const tx = Math.floor(rng() * (worldSize - 10)) + 5, ty = Math.floor(rng() * (worldSize - 10)) + 5;
      if (isPath(tx, ty) || isClearing(tx, ty) || this.grid.isBlocked(tx, ty)) continue;
      if ((tx - cx) ** 2 + (ty - cy) ** 2 < 64) continue;
      this.createStone(tx * T + T / 2, ty * T + T / 2, tx, ty);
    }

    // Metal ore (far regions)
    for (let i = 0; i < 30; i++) {
      const tx = Math.floor(rng() * (worldSize - 20)) + 10, ty = Math.floor(rng() * (worldSize - 20)) + 10;
      if ((tx - cx) ** 2 + (ty - cy) ** 2 < 625 || isPath(tx, ty) || this.grid.isBlocked(tx, ty)) continue;
      this.createMetal(tx * T + T / 2, ty * T + T / 2, tx, ty);
    }
  }

  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.updatePlayerMovement(engine, dt);
    this.updatePlayerAnimation(engine);
    this.updateCombat(engine, dt);
    this.updateEnemyAI(dt);
    this.updateSpawning(dt);
    this.updateBonfire(dt);
    this.updateFog();
    this.updateDepthSort();
    this.updateHUD();
  }

  private updatePlayerMovement(engine: ex.Engine, _dt: number): void {
    let vx = 0, vy = 0;
    const kb = engine.input.keyboard;
    if (kb.isHeld(ex.Keys.W) || kb.isHeld(ex.Keys.Up)) vy = -1;
    if (kb.isHeld(ex.Keys.S) || kb.isHeld(ex.Keys.Down)) vy = 1;
    if (kb.isHeld(ex.Keys.A) || kb.isHeld(ex.Keys.Left)) vx = -1;
    if (kb.isHeld(ex.Keys.D) || kb.isHeld(ex.Keys.Right)) vx = 1;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    if (vx !== 0 || vy !== 0) {
      this.facing = { x: vx, y: vy };
      this.lastDir = facingToDirection(vx, vy);
    }

    const speed = CONFIG.PLAYER_SPEED;
    const hw = 8, hh = 7;
    const gc = this.grid.applyGridCollision(
      this.player.pos.x - hw, this.player.pos.x + hw,
      this.player.pos.y - hh, this.player.pos.y + hh,
      vx, vy, speed
    );
    this.player.vel = ex.vec(gc.vx * speed, gc.vy * speed);

    // Footsteps audio
    if (gc.vx !== 0 || gc.vy !== 0) {
      audioEngine.startFootsteps();
    } else {
      audioEngine.stopFootsteps();
    }
  }

  private updatePlayerAnimation(_engine: ex.Engine): void {
    const isMoving = this.player.vel.squareDistance() > 1;
    const walkAnim = this.walkAnims.get(this.lastDir);
    const rotImg = AssetLoader.maleRotations[this.lastDir];

    if (isMoving && walkAnim) {
      if (this.player.graphics.current !== walkAnim) {
        this.player.graphics.use(walkAnim);
      }
    } else if (rotImg && rotImg.isLoaded()) {
      const sprite = rotImg.toSprite();
      this.player.graphics.use(sprite);
    }
  }

  private updateCombat(engine: ex.Engine, dt: number): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (!engine.input.keyboard.wasPressed(ex.Keys.Space) || this.attackCooldown > 0) return;

    this.attackCooldown = 0.4;
    audioEngine.playAttack();
    const weapon = WEAPONS.WOODEN_CLUB;
    const range = weapon.range;

    // Attack enemies
    for (const e of this.enemies) {
      if (e.isKilled()) continue;
      if (e.pos.distance(this.player.pos) < range) {
        const hp = e.findComponent(HealthComponent);
        if (hp) {
          hp.damage(weapon.damage);
          const dir = e.pos.sub(this.player.pos).normalize();
          e.pos = e.pos.add(dir.scale(8));
          if (!hp.alive) { this.kills++; audioEngine.playEnemyDeath(); e.kill(); }
        }
      }
    }

    // Attack nearest resource
    const nearest = this._gameEntities
      .filter(e => (e.entityType === 'tree' || e.entityType === 'stone' || e.entityType === 'metal') && !e.isKilled())
      .sort((a, b) => a.pos.distance(this.player.pos) - b.pos.distance(this.player.pos))[0];
    if (nearest && nearest.pos.distance(this.player.pos) < range + 20) {
      const hp = nearest.findComponent(HealthComponent);
      if (hp) {
        hp.damage(weapon.damage);
        if (!hp.alive) {
          if (nearest.entityType === 'tree') this.resources.wood += CONFIG.WOOD_PER_TREE;
          if (nearest.entityType === 'stone') this.resources.stone += CONFIG.STONE_PER_DEPOSIT;
          if (nearest.entityType === 'metal') this.resources.metal += CONFIG.METAL_PER_DEPOSIT;
          nearest.kill();
        }
      }
    }
  }

  private updateEnemyAI(dt: number): void {
    for (const e of this.enemies) {
      if (e.isKilled()) continue;
      const dist = e.pos.distance(this.player.pos);
      const speed = (e as any)._speed || 60;
      if (dist < T * 10) {
        const dir = this.player.pos.sub(e.pos).normalize();
        e.vel = ex.vec(dir.x * speed, dir.y * speed);
        if (dist < CONFIG.ENEMY_MELEE_RANGE + 20) {
          const dmg = (e as any)._damage || 5;
          this.hp = Math.max(0, this.hp - dmg * dt);
        }
      } else {
        e.vel = ex.vec(0, 0);
      }
    }
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer += dt;
    if (this.spawnTimer > 8 && this.enemies.filter(e => !e.isKilled()).length < CONFIG.MAX_ENEMIES) {
      this.spawnTimer = 0;
      const angle = Math.random() * Math.PI * 2;
      const dist = 300 + Math.random() * 200;
      const types: EnemyType[] = ['SHADOW_WISP', 'SHADOW_STALKER', 'SHADOW_ARCHER'];
      this.createEnemy(
        this.player.pos.x + Math.cos(angle) * dist,
        this.player.pos.y + Math.sin(angle) * dist,
        types[Math.floor(Math.random() * types.length)]
      );
    }
  }

  private updateBonfire(dt: number): void {
    this.bonfireFuel = Math.max(0, this.bonfireFuel - CONFIG.BONFIRE_BURN_RATE * dt);
    if (this.resources.wood > 0 && this.bonfires[0] &&
        this.bonfires[0].pos.distance(this.player.pos) < CONFIG.INTERACT_RADIUS &&
        this.bonfireFuel < CONFIG.BONFIRE_MAX_FUEL * 0.9) {
      this.resources.wood--;
      this.bonfireFuel = Math.min(CONFIG.BONFIRE_MAX_FUEL, this.bonfireFuel + CONFIG.FUEL_PER_WOOD);
    }
  }

  private updateFog(): void {
    const lights: FogLight[] = [];
    // Pass CSS screen coords — PostProcessor handles DPR scaling internally
    const zoom = this.camera.zoom;

    for (const bf of this.bonfires) {
      const fuelFrac = this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL;
      const radius = CONFIG.BONFIRE_MIN_RADIUS + fuelFrac * (CONFIG.BONFIRE_BASE_RADIUS - CONFIG.BONFIRE_MIN_RADIUS);
      const t = performance.now();
      const seed = bf.pos.x * 7.3 + bf.pos.y * 13.1;
      const wobX = Math.sin(t * 0.003 + seed) * 4;
      const wobY = Math.cos(t * 0.004 + seed * 1.3) * 3;
      const screen = this.engine.worldToScreenCoordinates(bf.pos.add(ex.vec(wobX, wobY)));
      lights.push({
        x: screen.x, y: screen.y,
        radius: radius * zoom,
        intensity: 1.0, softness: 0.5,
        tintR: 1.0, tintG: 0.47, tintB: 0.16, tintA: 0.12,
      });
    }

    const ps = this.engine.worldToScreenCoordinates(this.player.pos);
    lights.push({
      x: ps.x, y: ps.y,
      radius: 60 * zoom,
      intensity: 0.85, softness: 0.5,
      tintR: 0, tintG: 0, tintB: 0, tintA: 0,
    });

    this.fog.setLights(lights);
  }

  private updateDepthSort(): void {
    this.player.z = this.player.pos.y;
    for (const e of this._gameEntities) if (!e.isKilled()) e.z = e.pos.y;
    for (const e of this.enemies) if (!e.isKilled()) e.z = e.pos.y;
  }

  // --- HUD ---
  private hudEl!: HTMLDivElement;

  private createHUD(_engine: ex.Engine): void {
    this.hudEl = document.createElement('div');
    this.hudEl.style.cssText = 'position:fixed;top:8px;left:8px;color:#fff;font:bold 12px monospace;z-index:999;pointer-events:none;line-height:1.8;text-shadow:0 0 4px #000';
    document.body.appendChild(this.hudEl);
  }

  private updateHUD(): void {
    if (!this.hudEl) return;
    const fuelPct = Math.round(this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL * 100);
    const hpBar = '█'.repeat(Math.round(this.hp / 10)) + '░'.repeat(10 - Math.round(this.hp / 10));
    const fuelBar = '█'.repeat(Math.round(fuelPct / 10)) + '░'.repeat(10 - Math.round(fuelPct / 10));
    this.hudEl.innerHTML = `
      <span style="color:#44FF44">HP [${hpBar}] ${Math.round(this.hp)}</span><br>
      <span style="color:#FF8800">FIRE [${fuelBar}] ${fuelPct}%</span><br>
      <span style="color:#AA8844">Wood ${this.resources.wood}</span> ·
      <span style="color:#888">Stone ${this.resources.stone}</span> ·
      <span style="color:#CC8844">Metal ${this.resources.metal}</span> ·
      <span style="color:#FFD700">Gold ${this.resources.gold}</span><br>
      <span style="color:#AA66FF">Kills ${this.kills}</span>
    `;
  }

  onDeactivate(): void { if (this.hudEl) this.hudEl.remove(); }

  // --- Entity factories with REAL sprites ---

  private createPlayer(x: number, y: number): GameEntity {
    const p = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    p.entityType = 'player';
    // Use character sprite
    const img = AssetLoader.maleSouth;
    if (img.isLoaded()) {
      p.graphics.use(img.toSprite());
    } else {
      p.graphics.use(new ex.Rectangle({ width: 16, height: 24, color: ex.Color.fromHex('#FFAA44') }));
    }
    p.addComponent(new HealthComponent(CONFIG.PLAYER_MAX_HP));
    this.add(p);

    // Name label above player
    const playerName = (window as any).__playerName || 'Wanderer';
    const nameLabel = new ex.Label({
      text: playerName,
      pos: ex.vec(x, y - 28),
      font: new ex.Font({
        family: 'monospace', size: 8,
        color: ex.Color.White, textAlign: ex.TextAlign.Center,
      }),
    });
    nameLabel.z = 9999;
    this.add(nameLabel);
    // Follow player
    this.on('preupdate', () => {
      nameLabel.pos = p.pos.add(ex.vec(0, -28));
      nameLabel.z = p.z + 0.1;
    });

    return p;
  }

  private createTree(x: number, y: number, tx: number, ty: number, variant: number): GameEntity {
    const tree = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.8) });
    tree.entityType = 'tree';
    const src = AssetLoader.treeVariants[variant];
    if (src && src.isLoaded()) {
      tree.graphics.use(src.toSprite());
    } else {
      tree.graphics.use(new ex.Rectangle({ width: 22, height: 40, color: ex.Color.fromHex('#1a5a1a') }));
    }
    tree.addComponent(new HealthComponent(30));
    tree.addComponent(new GridOccupancyComponent({ tx, ty }));
    this.add(tree);
    this._gameEntities.push(tree);
    return tree;
  }

  private createStone(x: number, y: number, tx: number, ty: number): GameEntity {
    const stone = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    stone.entityType = 'stone';
    if (AssetLoader.stoneDeposit.isLoaded()) {
      stone.graphics.use(AssetLoader.stoneDeposit.toSprite());
    } else {
      stone.graphics.use(new ex.Rectangle({ width: 20, height: 16, color: ex.Color.fromHex('#666666') }));
    }
    stone.addComponent(new HealthComponent(40));
    stone.addComponent(new GridOccupancyComponent({ tx, ty }));
    this.add(stone);
    this._gameEntities.push(stone);
    return stone;
  }

  private createMetal(x: number, y: number, tx: number, ty: number): GameEntity {
    const metal = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    metal.entityType = 'metal';
    if (AssetLoader.metalOre.isLoaded()) {
      metal.graphics.use(AssetLoader.metalOre.toSprite());
    } else {
      metal.graphics.use(new ex.Rectangle({ width: 20, height: 16, color: ex.Color.fromHex('#CC8844') }));
    }
    metal.addComponent(new HealthComponent(50));
    metal.addComponent(new GridOccupancyComponent({ tx, ty }));
    this.add(metal);
    this._gameEntities.push(metal);
    return metal;
  }

  private createBonfire(x: number, y: number): GameEntity {
    const bf = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    bf.entityType = 'bonfire';
    bf.z = 3;

    // Log base
    bf.graphics.use(new ex.Rectangle({ width: 20, height: 10, color: ex.Color.fromHex('#5a3a1a') }));

    // Simple fire particle spawner using timer
    const scene = this;
    const fireTimer = new ex.Timer({
      interval: 80,
      repeats: true,
      fcn: () => {
        const spark = new ex.Actor({
          pos: ex.vec(x + (Math.random() - 0.5) * 10, y - 4),
          width: 3 + Math.random() * 3, height: 3 + Math.random() * 3,
          color: Math.random() > 0.5 ? ex.Color.fromHex('#FF6600') : ex.Color.fromHex('#FFDD44'),
          anchor: ex.vec(0.5, 0.5),
        });
        spark.z = 10;
        spark.vel = ex.vec((Math.random() - 0.5) * 20, -20 - Math.random() * 30);
        spark.actions.fade(0, 600).die();
        scene.add(spark);
      },
    });
    this.add(fireTimer);
    fireTimer.start();

    bf.addComponent(new LightSourceComponent({
      radius: CONFIG.BONFIRE_BASE_RADIUS, intensity: 1.0, softness: 0.5,
      tintR: 1.0, tintG: 0.47, tintB: 0.16, tintA: 0.12,
    }));
    this.add(bf);
    this.bonfires.push(bf);
    this._gameEntities.push(bf);
    return bf;
  }

  private createEnemy(x: number, y: number, type: EnemyType): GameEntity {
    const def = ENEMIES[type];
    const enemy = new GameEntity({
      pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5),
    });
    enemy.entityType = 'enemy';
    enemy.graphics.use(new ex.Circle({
      radius: def.size / 2,
      color: ex.Color.fromRGB((def.color >> 16) & 0xFF, (def.color >> 8) & 0xFF, def.color & 0xFF),
    }));
    enemy.addComponent(new HealthComponent(def.hp));
    (enemy as any)._speed = def.speed;
    (enemy as any)._damage = def.damage;
    (enemy as any)._type = type;
    this.add(enemy);
    this.enemies.push(enemy);
    return enemy;
  }
}
