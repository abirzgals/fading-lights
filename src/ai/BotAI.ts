import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { HealthComponent } from '../components/HealthComponent';
import { ResourceComponent } from '../components/ResourceComponent';
import { AIBrainComponent } from '../components/AIBrainComponent';
import { CONFIG } from '../config';

/**
 * Bot AI — Autonomous player decision tree.
 * Ported from original bot.js with kiting, dodge, and resource management.
 *
 * Priority order:
 * 1. SURVIVE — dodge enemy attacks, kite melee, evade projectiles
 * 2. COMBAT — fight nearby enemies (kite melee, dodge ranged)
 * 3. FEED FIRE — keep bonfire fuel above 30%
 * 4. GATHER — chop trees, mine stones for resources
 * 5. EXPLORE — move toward unexplored areas
 */
export class BotAI {
  private player: GameEntity;
  private grid: GridCollisionSystem;
  private getEntities: () => GameEntity[];
  private getEnemies: () => GameEntity[];
  private getBonfires: () => GameEntity[];

  // State
  private currentGoal: string = 'IDLE';
  private targetEntity: GameEntity | null = null;
  private path: Array<{ x: number; y: number }> | null = null;
  private pathIdx = 0;
  private stuckTimer = 0;
  private lastPos = { x: 0, y: 0 };
  private wanderAngle = 0;
  private kiteTimer = 0;
  private dodgeDir: ex.Vector | null = null;

  // Config
  private readonly ATTACK_REACH = 40;
  private readonly SIGHT_RANGE = 350;
  private readonly KITE_DISTANCE = 45;  // stay just outside enemy melee range
  private readonly DODGE_SPEED = 200;

  constructor(opts: {
    player: GameEntity;
    grid: GridCollisionSystem;
    getEntities: () => GameEntity[];
    getEnemies: () => GameEntity[];
    getBonfires: () => GameEntity[];
  }) {
    this.player = opts.player;
    this.grid = opts.grid;
    this.getEntities = opts.getEntities;
    this.getEnemies = opts.getEnemies;
    this.getBonfires = opts.getBonfires;
  }

  /** Call every tick from GameScene */
  update(dt: number): { vx: number; vy: number; attack: boolean; interact: boolean } {
    const p = this.player;
    const hp = p.get(HealthComponent) as HealthComponent | null;
    const hpRatio = hp ? hp.hp / hp.maxHp : 1;
    const enemies = this.getEnemies().filter(e => !e.isKilled());
    const bonfires = this.getBonfires();

    // Find nearest enemy
    let nearestEnemy: GameEntity | null = null;
    let nearestEnemyDist = Infinity;
    for (const e of enemies) {
      const d = p.pos.distance(e.pos);
      if (d < nearestEnemyDist) { nearestEnemyDist = d; nearestEnemy = e; }
    }

    // Find nearest resource
    let nearestResource: GameEntity | null = null;
    let nearestResourceDist = Infinity;
    for (const e of this.getEntities()) {
      if (e.isKilled() || !e.get(ResourceComponent)) continue;
      const d = p.pos.distance(e.pos);
      if (d < nearestResourceDist) { nearestResourceDist = d; nearestResource = e; }
    }

    // Bonfire fuel check
    const bonfire = bonfires[0];
    const nearBonfire = bonfire ? p.pos.distance(bonfire.pos) < CONFIG.INTERACT_RADIUS : false;

    // Check for incoming projectiles to dodge
    this.dodgeDir = this.findDodgeDirection(p, enemies);

    let vx = 0, vy = 0;
    let attack = false;
    let interact = false;

    // ============================================================
    // DECISION TREE — priority order
    // ============================================================

    // 1. DODGE PROJECTILES (highest priority reactive)
    if (this.dodgeDir) {
      this.currentGoal = 'DODGE';
      vx = this.dodgeDir.x;
      vy = this.dodgeDir.y;
    }
    // 2. KITE MELEE ENEMIES — if enemy is attacking (in melee range), step back
    else if (nearestEnemy && nearestEnemyDist < this.KITE_DISTANCE) {
      const ai = nearestEnemy.get(AIBrainComponent) as AIBrainComponent | null;
      if (ai && !ai.isRanged) {
        this.currentGoal = 'KITE';
        // Step away from enemy
        const away = p.pos.sub(nearestEnemy.pos).normalize();
        vx = away.x;
        vy = away.y;
        // Counter-attack when enemy is in their attack animation (they're stuck)
        this.kiteTimer += dt;
        if (this.kiteTimer > 0.3) {
          this.kiteTimer = 0;
          attack = true; // swing while backing up
        }
      } else {
        // Ranged enemy close — just flee
        this.currentGoal = 'FLEE';
        const away = p.pos.sub(nearestEnemy.pos).normalize();
        vx = away.x;
        vy = away.y;
      }
    }
    // 3. SURVIVE — retreat to bonfire if low HP
    else if (hpRatio < 0.3 && bonfire && !nearBonfire) {
      this.currentGoal = 'RETREAT';
      const dir = bonfire.pos.sub(p.pos).normalize();
      vx = dir.x;
      vy = dir.y;
    }
    // 4. COMBAT — attack nearby enemies (stay at weapon range, kite)
    else if (nearestEnemy && nearestEnemyDist < this.SIGHT_RANGE) {
      this.currentGoal = 'COMBAT';
      if (nearestEnemyDist < this.ATTACK_REACH) {
        // In attack range — swing!
        attack = true;
        // Slight kite back after attack
        const away = p.pos.sub(nearestEnemy.pos).normalize();
        vx = away.x * 0.3;
        vy = away.y * 0.3;
      } else {
        // Approach to attack range
        const dir = nearestEnemy.pos.sub(p.pos).normalize();
        vx = dir.x;
        vy = dir.y;
      }
    }
    // 5. GATHER RESOURCES — chop nearest tree/stone
    else if (nearestResource && nearestResourceDist < 300) {
      this.currentGoal = 'GATHER';
      if (nearestResourceDist < 52) {
        // In range — chop!
        attack = true;
      } else {
        // Walk to resource
        const dir = nearestResource.pos.sub(p.pos).normalize();
        vx = dir.x;
        vy = dir.y;
      }
    }
    // 6. WANDER — explore
    else {
      this.currentGoal = 'WANDER';
      this.stuckTimer += dt;
      if (this.stuckTimer > 3) {
        this.stuckTimer = 0;
        this.wanderAngle = Math.random() * Math.PI * 2;
      }
      vx = Math.cos(this.wanderAngle) * 0.5;
      vy = Math.sin(this.wanderAngle) * 0.5;
    }

    // Normalize
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > 1) { vx /= len; vy /= len; }

    return { vx, vy, attack, interact };
  }

  /** Find dodge direction to avoid incoming projectiles */
  private findDodgeDirection(player: GameEntity, enemies: GameEntity[]): ex.Vector | null {
    // Check all actors in scene for projectiles heading toward player
    if (!player.scene) return null;

    for (const actor of player.scene.actors) {
      if ((actor as any).entityType !== 'projectile') continue;
      const proj = actor;
      const dist = player.pos.distance(proj.pos);
      if (dist > 100 || dist < 5) continue;

      // Is projectile heading toward us?
      const toPlayer = player.pos.sub(proj.pos).normalize();
      const projDir = proj.vel.normalize();
      const dot = toPlayer.x * projDir.x + toPlayer.y * projDir.y;

      if (dot > 0.5) {
        // Projectile coming at us — dodge perpendicular
        return ex.vec(-projDir.y, projDir.x); // perpendicular
      }
    }

    return null;
  }

  get goal(): string { return this.currentGoal; }
}
