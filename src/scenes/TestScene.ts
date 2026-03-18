import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { HealthComponent } from '../components/HealthComponent';
import { GridOccupancyComponent, setGridSystem } from '../components/GridOccupancyComponent';
import { LightSourceComponent } from '../components/LightSourceComponent';
import { CONFIG } from '../config';

const T = CONFIG.TILE_SIZE;
const GRID_SIZE = 30; // small 30x30 test map

/**
 * Test scene — small level with player, trees, bonfire, enemy.
 * Tests: grid collision, component auto-cleanup, fog shader, entity lifecycle.
 */
export class TestScene extends ex.Scene {
  private grid!: GridCollisionSystem;
  private player!: GameEntity;
  private _gameEntities: GameEntity[] = [];

  onInitialize(engine: ex.Engine): void {
    // Grid collision system
    this.grid = new GridCollisionSystem(GRID_SIZE, T);
    setGridSystem(this.grid);

    // Ground — dark green
    const worldSize = GRID_SIZE * T;
    const ground = new ex.Actor({
      pos: ex.vec(worldSize / 2, worldSize / 2),
      width: worldSize,
      height: worldSize,
      color: ex.Color.fromHex('#1a2a0a'),
      anchor: ex.vec(0.5, 0.5),
    });
    ground.z = -10;
    this.add(ground);

    // Road — brown strip through the middle
    const road = new ex.Actor({
      pos: ex.vec(worldSize / 2, worldSize / 2),
      width: T * 3,
      height: worldSize,
      color: ex.Color.fromHex('#3a2a1a'),
      anchor: ex.vec(0.5, 0.5),
    });
    road.z = -9;
    this.add(road);

    // Bonfire at center
    const bonfireX = GRID_SIZE / 2 * T + T / 2;
    const bonfireY = GRID_SIZE / 2 * T + T / 2;
    const bonfire = this.createBonfire(bonfireX, bonfireY);

    // Player near bonfire
    this.player = this.createPlayer(bonfireX, bonfireY - T * 2);

    // Trees around the edges
    for (let i = 0; i < 40; i++) {
      const tx = Math.floor(Math.random() * GRID_SIZE);
      const ty = Math.floor(Math.random() * GRID_SIZE);
      // Don't place on road or near bonfire
      const cx = GRID_SIZE / 2;
      const dx = tx - cx, dy = ty - cx;
      if (Math.abs(tx - cx) <= 1) continue; // road
      if (dx * dx + dy * dy < 9) continue; // near bonfire
      if (this.grid.isBlocked(tx, ty)) continue;
      this.createTree(tx * T + T / 2, ty * T + T / 2, tx, ty);
    }

    // Enemy
    this.createEnemy(bonfireX + T * 5, bonfireY + T * 3);

    // Camera follow player
    this.camera.strategy.lockToActor(this.player);
    this.camera.zoom = 2;

    // Status label
    const status = new ex.Label({
      text: '',
      pos: ex.vec(10, 10),
      font: new ex.Font({ family: 'monospace', size: 10, color: ex.Color.fromHex('#88ff88') }),
    });
    status.z = 1000;
    this.add(status);

    // Update status each frame
    this.on('preupdate', () => {
      const entityCount = this._gameEntities.filter(e => !e.isKilled()).length;
      status.text = `Entities: ${entityCount} | Trees: ${this._gameEntities.filter(e => e.entityType === 'tree' && !e.isKilled()).length} | WASD move, SPACE attack tree`;
      status.pos = this.camera.pos.add(ex.vec(-engine.halfDrawWidth + 10, -engine.halfDrawHeight + 10));
    });

    console.log('[TestScene] initialized —', this._gameEntities.length, 'entities');
  }

  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    this.updatePlayerMovement(engine, deltaMs);
    this.updateEnemyAI(deltaMs);
  }

  private updatePlayerMovement(engine: ex.Engine, _deltaMs: number): void {
    let vx = 0, vy = 0;
    if (engine.input.keyboard.isHeld(ex.Keys.W) || engine.input.keyboard.isHeld(ex.Keys.Up)) vy = -1;
    if (engine.input.keyboard.isHeld(ex.Keys.S) || engine.input.keyboard.isHeld(ex.Keys.Down)) vy = 1;
    if (engine.input.keyboard.isHeld(ex.Keys.A) || engine.input.keyboard.isHeld(ex.Keys.Left)) vx = -1;
    if (engine.input.keyboard.isHeld(ex.Keys.D) || engine.input.keyboard.isHeld(ex.Keys.Right)) vx = 1;

    // Normalize diagonal
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    // Grid collision
    const speed = CONFIG.PLAYER_SPEED;
    const b = this.player;
    const halfW = 8, halfH = 7;
    const gc = this.grid.applyGridCollision(
      b.pos.x - halfW, b.pos.x + halfW,
      b.pos.y - halfH, b.pos.y + halfH,
      vx, vy, speed
    );

    this.player.vel = ex.vec(gc.vx * speed, gc.vy * speed);

    // Attack nearest tree with SPACE
    if (engine.input.keyboard.wasPressed(ex.Keys.Space)) {
      const nearestTree = this._gameEntities
        .filter(e => e.entityType === 'tree' && !e.isKilled())
        .sort((a, b) => a.pos.distance(this.player.pos) - b.pos.distance(this.player.pos))[0];
      if (nearestTree && nearestTree.pos.distance(this.player.pos) < T * 2) {
        const hp = nearestTree.findComponent(HealthComponent);
        if (hp) {
          hp.damage(10);
          console.log(`[Attack] Tree HP: ${hp.hp}/${hp.maxHp}`);
          if (!hp.alive) {
            console.log('[Attack] Tree destroyed — components auto-cleanup');
            nearestTree.kill();
          }
        }
      }
    }
  }

  private updateEnemyAI(_deltaMs: number): void {
    for (const e of this._gameEntities) {
      if (e.entityType !== 'enemy' || e.isKilled()) continue;
      // Simple chase toward player
      const dir = this.player.pos.sub(e.pos);
      const dist = dir.distance();
      if (dist > T * 0.5 && dist < T * 8) {
        const norm = dir.normalize();
        const speed = 50;
        const gc = this.grid.applyGridCollision(
          e.pos.x - 6, e.pos.x + 6, e.pos.y - 6, e.pos.y + 6,
          norm.x, norm.y, speed
        );
        e.vel = ex.vec(gc.vx * speed, gc.vy * speed);
      } else {
        e.vel = ex.vec(0, 0);
      }
    }
  }

  // --- Entity factories ---

  private createPlayer(x: number, y: number): GameEntity {
    const player = new GameEntity({
      pos: ex.vec(x, y),
      width: 16,
      height: 14,
      color: ex.Color.fromHex('#FFAA44'),
      anchor: ex.vec(0.5, 0.5),
    });
    player.entityType = 'player';
    player.z = 5;
    player.addComponent(new HealthComponent(CONFIG.PLAYER_MAX_HP));
    this.add(player);
    return player;
  }

  private createTree(x: number, y: number, tx: number, ty: number): GameEntity {
    const tree = new GameEntity({
      pos: ex.vec(x, y),
      width: 20,
      height: 28,
      color: ex.Color.fromHex('#1a5a1a'),
      anchor: ex.vec(0.5, 0.5),
    });
    tree.entityType = 'tree';
    tree.z = y; // depth sort
    tree.addComponent(new HealthComponent(30));
    tree.addComponent(new GridOccupancyComponent({ tx, ty }));
    this.add(tree);
    this._gameEntities.push(tree);
    return tree;
  }

  private createBonfire(x: number, y: number): GameEntity {
    const bonfire = new GameEntity({
      pos: ex.vec(x, y),
      width: 24,
      height: 24,
      color: ex.Color.fromHex('#FF6600'),
      anchor: ex.vec(0.5, 0.5),
    });
    bonfire.entityType = 'bonfire';
    bonfire.z = 3;
    bonfire.addComponent(new LightSourceComponent({
      radius: 300,
      intensity: 1.0,
      softness: 0.5,
      tintR: 1.0, tintG: 0.47, tintB: 0.16, tintA: 0.12,
    }));
    this.add(bonfire);
    this._gameEntities.push(bonfire);
    return bonfire;
  }

  private createEnemy(x: number, y: number): GameEntity {
    const enemy = new GameEntity({
      pos: ex.vec(x, y),
      width: 14,
      height: 14,
      color: ex.Color.fromHex('#8822CC'),
      anchor: ex.vec(0.5, 0.5),
    });
    enemy.entityType = 'enemy';
    enemy.z = y;
    enemy.addComponent(new HealthComponent(20));
    this.add(enemy);
    this._gameEntities.push(enemy);
    return enemy;
  }
}
