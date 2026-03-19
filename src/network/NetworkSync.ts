import * as ex from 'excalibur';
import { NetworkClient } from './NetworkClient';
import { GameEntity } from '../engine/GameEntity';
import { HealthComponent } from '../components/HealthComponent';
import { AnimatedSpriteComponent } from '../components/AnimatedSpriteComponent';
import { AssetLoader } from '../engine/AssetLoader';
import { EntityFactory } from '../entities/EntityFactory';
import { ShadowCasterComponent } from '../components/ShadowCasterComponent';
import { CONFIG, ENEMIES } from '../config';
import { EnemyType } from '../types';

/**
 * NetworkSync — full game state synchronization.
 *
 * Host: spawns enemies, runs AI, broadcasts all state.
 * Client: renders remote players, receives enemy/resource/building state.
 *
 * Message types:
 *   s  — player state (position, dir, anim)
 *   attack — player attack event
 *   enemies — batch enemy positions + HP (host→clients, 5fps)
 *   enemy_spawned — new enemy created (host→clients)
 *   enemy_killed — enemy HP=0 (host→clients)
 *   resource_killed — resource destroyed (any→all)
 *   building_placed — building constructed (any→all)
 *   bonfire_state — fuel + level (host→clients, 1fps)
 *   resources_state — shared resource pool (host→clients, 1fps)
 *   world_seed — level generation seed (host→client on join)
 */
export class NetworkSync {
  private net: NetworkClient;
  private scene: ex.Scene;
  private remotePlayers: Map<string, { entity: GameEntity; label: ex.Label; name: string; lastUpdate: number }> = new Map();
  private worldSeed: number;

  // Network enemy tracking — netId → local GameEntity
  private netEnemies: Map<number, GameEntity> = new Map();

  // Sync timers
  private enemySyncTimer = 0;
  private stateSyncTimer = 0;
  private readonly ENEMY_SYNC_MS = 200;
  private readonly STATE_SYNC_MS = 1000;

  // Callbacks to GameScene
  public onResourceKilled: ((x: number, y: number, type: string) => void) | null = null;
  public onBuildingPlaced: ((x: number, y: number, type: string) => void) | null = null;
  public onBonfireState: ((fuel: number, campLevel: number, campFuelAdded: number) => void) | null = null;
  public onResourcesState: ((wood: number, stone: number, metal: number, gold: number) => void) | null = null;
  public onEnemySpawned: ((netId: number, x: number, y: number, type: EnemyType) => GameEntity | null) | null = null;
  public onEnemyKilled: ((netId: number) => void) | null = null;
  public onDropPickup: ((x: number, y: number, type: string, playerX: number, playerY: number) => void) | null = null;
  public onPlayerHP: ((peerId: string, hp: number, maxHp: number) => void) | null = null;
  public onFullState: ((state: any) => void) | null = null;

  constructor(net: NetworkClient, scene: ex.Scene, worldSeed: number) {
    this.net = net;
    this.scene = scene;
    this.worldSeed = worldSeed;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.net.on('s', (msg) => this.onPeerState(msg));
    this.net.on('attack', (msg) => this.onRemoteAttack(msg));
    this.net.on('peer_joined', (msg) => this.onPeerJoined(msg));
    this.net.on('peer_left', (msg) => this.onPeerLeft(msg));
    this.net.on('world_seed', (msg) => this.onWorldSeed(msg));
    this.net.on('enemies', (msg) => this.onEnemiesSync(msg));
    this.net.on('enemy_spawned', (msg) => this.onEnemySpawnedMsg(msg));
    this.net.on('enemy_killed', (msg) => this.onEnemyKilledMsg(msg));
    this.net.on('resource_killed', (msg) => this.onResourceKilledMsg(msg));
    this.net.on('building_placed', (msg) => this.onBuildingPlacedMsg(msg));
    this.net.on('drop_pickup', (msg) => this.onDropPickupMsg(msg));
    this.net.on('player_hp', (msg) => this.onPlayerHPMsg(msg));
    this.net.on('full_state', (msg) => this.onFullStateMsg(msg));
  }

  // ============================================================
  // SEND — called by GameScene
  // ============================================================

  sendPlayerState(player: GameEntity): void {
    const anim = player.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
    this.net.sendState({
      x: Math.round(player.pos.x),
      y: Math.round(player.pos.y),
      dir: anim?.direction ?? 'south',
      anim: anim?.isAttacking ? 'attack' : (player.vel.squareDistance() > 1 ? 'walk' : 'idle'),
    });
  }

  sendAttack(x: number, y: number, dir: string): void {
    this.net.send({ type: 'attack', x: Math.round(x), y: Math.round(y), dir });
  }

  /** Host: broadcast enemy spawn */
  sendEnemySpawned(netId: number, x: number, y: number, type: EnemyType): void {
    if (!this.net.isHost) return;
    this.net.send({ type: 'enemy_spawned', netId, x: Math.round(x), y: Math.round(y), enemyType: type });
  }

  /** Host: batch sync enemy positions + HP */
  sendEnemySync(enemies: GameEntity[], dt: number): void {
    if (!this.net.isHost) return;
    this.enemySyncTimer += dt * 1000;
    if (this.enemySyncTimer < this.ENEMY_SYNC_MS) return;
    this.enemySyncTimer = 0;

    const data = enemies
      .filter(e => !e.isKilled())
      .map(e => ({
        id: (e as any)._netId ?? 0,
        x: Math.round(e.pos.x),
        y: Math.round(e.pos.y),
        hp: (e.get(HealthComponent) as HealthComponent | null)?.hp ?? 0,
        dying: e.isDying,
      }));
    this.net.send({ type: 'enemies', data });
  }

  sendEnemyKilled(netId: number): void {
    this.net.send({ type: 'enemy_killed', netId });
  }

  sendResourceKilled(x: number, y: number, resourceType: string): void {
    this.net.send({ type: 'resource_killed', x: Math.round(x), y: Math.round(y), resourceType });
  }

  sendBuildingPlaced(x: number, y: number, buildingType: string): void {
    this.net.send({ type: 'building_placed', x: Math.round(x), y: Math.round(y), buildingType });
  }

  /** Any player: broadcast drop pickup — includes player position for fly animation */
  sendDropPickup(x: number, y: number, dropType: string, playerX: number, playerY: number): void {
    this.net.send({
      type: 'drop_pickup',
      x: Math.round(x), y: Math.round(y),
      dropType,
      px: Math.round(playerX), py: Math.round(playerY),
    });
  }

  /** Broadcast player HP (when damaged or healed significantly) */
  sendPlayerHP(hp: number, maxHp: number): void {
    this.net.send({ type: 'player_hp', hp: Math.round(hp), maxHp });
  }

  /** Host: broadcast full state periodically (bonfire + resources + buildings + player HP) */
  sendGameState(
    fuel: number, campLevel: number, campFuelAdded: number,
    resources: { wood: number; stone: number; metal: number; gold: number },
    buildings: Array<{ x: number; y: number; type: string }>,
    playerHp: number, playerMaxHp: number,
    kills: number, waveNumber: number,
    dt: number
  ): void {
    if (!this.net.isHost) return;
    this.stateSyncTimer += dt * 1000;
    if (this.stateSyncTimer < this.STATE_SYNC_MS) return;
    this.stateSyncTimer = 0;

    // Single full state message — one source of truth
    this.net.send({
      type: 'full_state',
      fuel, campLevel, campFuelAdded,
      ...resources,
      buildings,
      hostHp: Math.round(playerHp),
      hostMaxHp: playerMaxHp,
      kills, waveNumber,
    });
  }

  /** Register a locally-spawned enemy with a netId */
  registerEnemy(netId: number, entity: GameEntity): void {
    (entity as any)._netId = netId;
    this.netEnemies.set(netId, entity);
  }

  /** Update remote players + cleanup */
  update(dt: number): void {
    const now = performance.now();
    for (const [peerId, rp] of this.remotePlayers) {
      if (now - rp.lastUpdate > 5000) {
        rp.entity.kill();
        rp.label.kill();
        this.remotePlayers.delete(peerId);
      }
    }
  }

  get playerCount(): number { return this.remotePlayers.size + 1; }

  // ============================================================
  // RECEIVE — from network
  // ============================================================

  private onPeerState(msg: any): void {
    const peerId = msg.from;
    if (!peerId || peerId === this.net.peerId) return;

    let rp = this.remotePlayers.get(peerId);
    if (!rp) {
      const entity = new GameEntity({ pos: ex.vec(msg.x, msg.y), anchor: ex.vec(0.5, 0.5) });
      entity.entityType = 'remote_player';
      entity.addComponent(new AnimatedSpriteComponent({
        rotations: AssetLoader.maleRotations,
        walkSpriteSheets: AssetLoader.maleWalkSheets,
        walkSheetGrid: { columns: 6, spriteWidth: 48, spriteHeight: 48 },
        walkFrameRate: 10,
        fallback: { width: 16, height: 24, color: ex.Color.fromHex('#44AAFF') },
      }));
      entity.addComponent(new ShadowCasterComponent({ feetOffset: 10 }));
      this.scene.add(entity);

      const name = msg.fromName ?? `P${peerId}`;
      const label = new ex.Label({
        text: name, pos: ex.vec(msg.x, msg.y - 28),
        font: new ex.Font({ family: 'monospace', size: 8, color: ex.Color.fromHex('#44AAFF'), textAlign: ex.TextAlign.Center }),
        anchor: ex.vec(0.5, 0.5),
      });
      label.z = 9999;
      this.scene.add(label);

      rp = { entity, label, name, lastUpdate: performance.now() };
      this.remotePlayers.set(peerId, rp);
      console.log(`[Net] Remote player: ${name}`);
    }

    // Smooth interpolation
    const dx = msg.x - rp.entity.pos.x, dy = msg.y - rp.entity.pos.y;
    rp.entity.vel = ex.vec(dx * 5, dy * 5);
    rp.entity.z = rp.entity.pos.y;
    rp.label.pos = rp.entity.pos.add(ex.vec(0, -28));
    rp.label.z = rp.entity.z + 0.1;
    rp.lastUpdate = performance.now();
  }

  private onRemoteAttack(msg: any): void {
    // Visual + sound feedback for remote player attack
    // TODO: play swing animation at msg.x, msg.y
  }

  private onPeerJoined(msg: any): void {
    if (this.net.isHost) {
      // Send world seed + current game state to new peer
      this.net.send({ type: 'world_seed', seed: this.worldSeed });

      // Send all existing enemies
      for (const [netId, e] of this.netEnemies) {
        if (e.isKilled()) continue;
        const hp = e.get(HealthComponent) as HealthComponent | null;
        this.net.send({
          type: 'enemy_spawned',
          netId,
          x: Math.round(e.pos.x),
          y: Math.round(e.pos.y),
          enemyType: (e as any).enemyType ?? 'SHADOW_WISP',
          hp: hp?.hp ?? 0,
        });
      }
    }
  }

  private onPeerLeft(msg: any): void {
    const rp = this.remotePlayers.get(msg.peerId);
    if (rp) {
      rp.entity.kill();
      rp.label.kill();
      this.remotePlayers.delete(msg.peerId);
    }
  }

  private onWorldSeed(msg: any): void {
    console.log(`[Net] World seed: ${msg.seed}`);
    // TODO: regenerate world if seed differs
  }

  private onEnemiesSync(msg: any): void {
    if (this.net.isHost) return; // host doesn't receive own sync
    for (const ed of msg.data) {
      const enemy = this.netEnemies.get(ed.id);
      if (!enemy || enemy.isKilled()) continue;
      // Interpolate position
      const dx = ed.x - enemy.pos.x, dy = ed.y - enemy.pos.y;
      enemy.vel = ex.vec(dx * 5, dy * 5);
      enemy.z = enemy.pos.y;
      // Sync HP
      const hp = enemy.get(HealthComponent) as HealthComponent | null;
      if (hp && Math.abs(hp.hp - ed.hp) > 1) {
        (hp as any).hp = ed.hp; // direct set for sync
      }
      // Sync dying
      if (ed.dying && !enemy.isDying) {
        enemy.playDeath();
      }
    }
  }

  private onEnemySpawnedMsg(msg: any): void {
    if (this.net.isHost) return;
    // Client creates enemy from host data
    if (this.netEnemies.has(msg.netId)) return; // already exists
    const entity = this.onEnemySpawned?.(msg.netId, msg.x, msg.y, msg.enemyType as EnemyType);
    if (entity) {
      this.registerEnemy(msg.netId, entity);
      // Set HP if provided
      if (msg.hp !== undefined) {
        const hp = entity.get(HealthComponent) as HealthComponent | null;
        if (hp) (hp as any).hp = msg.hp;
      }
    }
  }

  private onEnemyKilledMsg(msg: any): void {
    if (this.net.isHost) return;
    const enemy = this.netEnemies.get(msg.netId);
    if (enemy && !enemy.isKilled() && !enemy.isDying) {
      enemy.playDeath();
    }
    this.onEnemyKilled?.(msg.netId);
  }

  private onResourceKilledMsg(msg: any): void {
    this.onResourceKilled?.(msg.x, msg.y, msg.resourceType);
  }

  private onBuildingPlacedMsg(msg: any): void {
    this.onBuildingPlaced?.(msg.x, msg.y, msg.buildingType);
  }

  private onDropPickupMsg(msg: any): void {
    this.onDropPickup?.(msg.x, msg.y, msg.dropType, msg.px, msg.py);
  }

  private onPlayerHPMsg(msg: any): void {
    this.onPlayerHP?.(msg.from, msg.hp, msg.maxHp);
  }

  private onFullStateMsg(msg: any): void {
    if (this.net.isHost) return;
    this.onFullState?.(msg);
  }

  destroy(): void {
    for (const [, rp] of this.remotePlayers) { rp.entity.kill(); rp.label.kill(); }
    this.remotePlayers.clear();
    this.netEnemies.clear();
    this.net.disconnect();
  }
}
