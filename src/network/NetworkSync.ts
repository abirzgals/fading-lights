import * as ex from 'excalibur';
import { NetworkClient } from './NetworkClient';
import { GameEntity } from '../engine/GameEntity';
import { HealthComponent } from '../components/HealthComponent';
import { AnimatedSpriteComponent } from '../components/AnimatedSpriteComponent';
import { AssetLoader } from '../engine/AssetLoader';
import { SpriteRendererComponent } from '../components/SpriteRendererComponent';
import { CONFIG } from '../config';

/**
 * NetworkSync — syncs game state between players via NetworkClient.
 *
 * Host responsibilities:
 * - Send world seed on peer join
 * - Broadcast enemy positions/HP every 200ms
 * - Broadcast resource destruction
 * - Broadcast building placement
 *
 * All players:
 * - Send own position every 50ms
 * - Send attack events
 * - Render remote players
 */
export class NetworkSync {
  private net: NetworkClient;
  private scene: ex.Scene;
  private remotePlayers: Map<string, { entity: GameEntity; name: string; lastUpdate: number }> = new Map();
  private worldSeed: number;

  // Host sync timers
  private enemySyncTimer = 0;
  private readonly ENEMY_SYNC_INTERVAL = 200; // ms

  constructor(net: NetworkClient, scene: ex.Scene, worldSeed: number) {
    this.net = net;
    this.scene = scene;
    this.worldSeed = worldSeed;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Remote player position updates
    this.net.on('s', (msg) => this.onPeerState(msg));

    // Peer joined — send world data if host
    this.net.on('peer_joined', (msg) => this.onPeerJoined(msg));
    this.net.on('peer_left', (msg) => this.onPeerLeft(msg));

    // World seed from host (for clients)
    this.net.on('world_seed', (msg) => this.onWorldSeed(msg));

    // Enemy sync from host
    this.net.on('enemies', (msg) => this.onEnemiesSync(msg));
    this.net.on('enemy_killed', (msg) => this.onEnemyKilled(msg));

    // Resource destroyed
    this.net.on('resource_killed', (msg) => this.onResourceKilled(msg));

    // Building placed
    this.net.on('building_placed', (msg) => this.onBuildingPlaced(msg));

    // Remote attack
    this.net.on('attack', (msg) => this.onRemoteAttack(msg));
  }

  /** Send local player state */
  sendPlayerState(player: GameEntity): void {
    const anim = player.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
    this.net.sendState({
      x: Math.round(player.pos.x),
      y: Math.round(player.pos.y),
      dir: anim?.direction ?? 'south',
      anim: anim?.isAttacking ? 'attack' : (player.vel.squareDistance() > 1 ? 'walk' : 'idle'),
    });
  }

  /** Send attack event */
  sendAttack(x: number, y: number): void {
    this.net.send({ type: 'attack', x: Math.round(x), y: Math.round(y) });
  }

  /** Host: send enemy positions */
  sendEnemySync(enemies: GameEntity[], dt: number): void {
    if (!this.net.isHost) return;
    this.enemySyncTimer += dt * 1000;
    if (this.enemySyncTimer < this.ENEMY_SYNC_INTERVAL) return;
    this.enemySyncTimer = 0;

    const data = enemies
      .filter(e => !e.isKilled())
      .map(e => {
        const hp = e.get(HealthComponent) as HealthComponent | null;
        return {
          id: (e as any)._netId ?? 0,
          x: Math.round(e.pos.x),
          y: Math.round(e.pos.y),
          hp: hp?.hp ?? 0,
          type: (e as any).enemyType ?? 'SHADOW_WISP',
        };
      });
    this.net.send({ type: 'enemies', data });
  }

  /** Host: broadcast resource destruction */
  sendResourceKilled(x: number, y: number, resourceType: string): void {
    this.net.send({ type: 'resource_killed', x: Math.round(x), y: Math.round(y), resourceType });
  }

  /** Host: broadcast building placement */
  sendBuildingPlaced(x: number, y: number, buildingType: string): void {
    this.net.send({ type: 'building_placed', x: Math.round(x), y: Math.round(y), buildingType });
  }

  /** Host: broadcast enemy killed */
  sendEnemyKilled(netId: number): void {
    this.net.send({ type: 'enemy_killed', netId });
  }

  /** Update remote player entities */
  update(dt: number): void {
    const now = performance.now();
    // Remove stale remote players (no update for 5s)
    for (const [peerId, rp] of this.remotePlayers) {
      if (now - rp.lastUpdate > 5000) {
        rp.entity.kill();
        this.remotePlayers.delete(peerId);
        console.log(`[Net] Removed stale remote player ${rp.name}`);
      }
    }
  }

  /** Get remote player count */
  get playerCount(): number { return this.remotePlayers.size + 1; }

  // ---- Handlers ----

  private onPeerState(msg: any): void {
    const peerId = msg.from;
    if (!peerId || peerId === this.net.peerId) return;

    let rp = this.remotePlayers.get(peerId);
    if (!rp) {
      // Create remote player entity
      const entity = new GameEntity({
        pos: ex.vec(msg.x, msg.y),
        anchor: ex.vec(0.5, 0.5),
      });
      entity.entityType = 'remote_player';

      // Use player sprite
      entity.addComponent(new AnimatedSpriteComponent({
        rotations: AssetLoader.maleRotations,
        walkSpriteSheets: AssetLoader.maleWalkSheets,
        walkSheetGrid: { columns: 6, spriteWidth: 48, spriteHeight: 48 },
        walkFrameRate: 10,
        fallback: { width: 16, height: 24, color: ex.Color.fromHex('#44AAFF') },
      }));

      this.scene.add(entity);

      // Name label
      const name = msg.fromName ?? `Player ${peerId}`;
      const label = new ex.Label({
        text: name,
        pos: ex.vec(msg.x, msg.y - 28),
        font: new ex.Font({ family: 'monospace', size: 8, color: ex.Color.fromHex('#44AAFF'), textAlign: ex.TextAlign.Center }),
        anchor: ex.vec(0.5, 0.5),
      });
      label.z = 9999;
      this.scene.add(label);
      entity.on('preupdate', () => {
        label.pos = entity.pos.add(ex.vec(0, -28));
        label.z = entity.z + 0.1;
      });
      entity.on('kill', () => label.kill());

      rp = { entity, name, lastUpdate: performance.now() };
      this.remotePlayers.set(peerId, rp);
      console.log(`[Net] Created remote player: ${name}`);
    }

    // Smooth interpolation to target position
    const targetX = msg.x, targetY = msg.y;
    const dx = targetX - rp.entity.pos.x, dy = targetY - rp.entity.pos.y;
    rp.entity.vel = ex.vec(dx * 5, dy * 5); // smooth lerp via velocity
    rp.entity.z = rp.entity.pos.y;
    rp.lastUpdate = performance.now();
  }

  private onPeerJoined(msg: any): void {
    // If we're host, send world seed to new peer
    if (this.net.isHost) {
      this.net.send({ type: 'world_seed', seed: this.worldSeed });
    }
  }

  private onPeerLeft(msg: any): void {
    const rp = this.remotePlayers.get(msg.peerId);
    if (rp) {
      rp.entity.kill();
      this.remotePlayers.delete(msg.peerId);
    }
  }

  private onWorldSeed(msg: any): void {
    // Client received world seed — could trigger world regeneration
    console.log(`[Net] Received world seed: ${msg.seed}`);
  }

  private onEnemiesSync(msg: any): void {
    // Client receives enemy positions from host
    // TODO: update local enemy positions to match host state
  }

  private onEnemyKilled(msg: any): void {
    // TODO: find enemy by netId and trigger death
  }

  private onResourceKilled(msg: any): void {
    // TODO: find resource near (x,y) and destroy it
  }

  private onBuildingPlaced(msg: any): void {
    // TODO: create building at (x,y) of given type
  }

  private onRemoteAttack(msg: any): void {
    // TODO: play attack animation/sound at position
  }

  destroy(): void {
    for (const [, rp] of this.remotePlayers) rp.entity.kill();
    this.remotePlayers.clear();
    this.net.disconnect();
  }
}
