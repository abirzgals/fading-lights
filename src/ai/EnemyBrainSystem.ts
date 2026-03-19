import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { AIBrainComponent } from '../components/AIBrainComponent';
import { MeleeAttackComponent } from '../components/MeleeAttackComponent';
import { RangedAttackComponent } from '../components/RangedAttackComponent';
import { AnimatedSpriteComponent } from '../components/AnimatedSpriteComponent';
import { HealthComponent } from '../components/HealthComponent';
import {
  TreeNode, Selector, Sequence, Condition, Action,
  DecisionContext, createMeleeTree, createRangedTree, createCrawlerTree,
} from '../components/DecisionTreeComponent';
import { CONFIG } from '../config';
import { PathFollower } from '../engine/PathFollower';

/**
 * Enemy Brain System — runs decision trees for all enemies.
 * Replaces inline AI in GameScene. Each enemy type gets its own tree.
 *
 * Handles: A* pathfinding, attack animations with damage frame,
 * state transitions, projectile firing.
 */
export class EnemyBrainSystem {
  private trees: Map<string, TreeNode> = new Map();
  private grid: GridCollisionSystem;
  private pathFollowers: Map<GameEntity, PathFollower> = new Map();

  /** Get or create PathFollower for an enemy */
  private getPathFollower(e: GameEntity): PathFollower {
    let pf = this.pathFollowers.get(e);
    if (!pf) { pf = new PathFollower(this.grid); this.pathFollowers.set(e, pf); }
    return pf;
  }

  constructor(grid: GridCollisionSystem) {
    this.grid = grid;
    // Pre-build decision trees per enemy type
    this.trees.set('melee', createMeleeTree());
    this.trees.set('ranged', createRangedTree());
    this.trees.set('crawler', createCrawlerTree());
  }

  /** Update all enemies AI each frame */
  update(enemies: GameEntity[], player: GameEntity, bonfires: GameEntity[], scene: ex.Scene, dt: number): void {
    for (const e of enemies) {
      if (e.isKilled() || e.isDying) continue; // skip dying enemies
      const ai = e.get(AIBrainComponent) as AIBrainComponent | null;
      if (!ai) continue;

      // Determine target
      let target: ex.Actor;
      if (ai.enemyType === 'FOG_CRAWLER' && bonfires.length > 0) {
        // Crawler targets bonfire, not player
        target = bonfires[0];
      } else {
        target = player;
      }

      const dist = e.pos.distance(target.pos);

      // Build context for decision tree
      const hp = e.get(HealthComponent) as HealthComponent | null;
      const ctx: DecisionContext = {
        self: e,
        target,
        distToTarget: dist,
        hp: hp?.hp ?? 0,
        maxHp: hp?.maxHp ?? 1,
        isRanged: ai.isRanged,
        attackRange: ai.attackRange,
        speed: ai.speed,
        sightRange: ai.sightRange,
        dt,
        action: 'idle',
        moveDir: ex.vec(0, 0),
      };

      // Evaluate decision tree
      const treeKey = ai.isRanged ? 'ranged' : ai.enemyType === 'FOG_CRAWLER' ? 'crawler' : 'melee';
      const tree = this.trees.get(treeKey)!;
      tree.evaluate(ctx);

      // Update AI state for debug
      ai.state = ctx.action.toUpperCase() as any;
      ai.wanderTimer -= dt;

      // Freeze during attack animation — no movement until animation completes
      const anim = e.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
      if (anim?.isAttacking) {
        e.vel = ex.vec(0, 0);
        continue; // skip all movement logic
      }

      // Execute action
      const speed = ai.speed;
      switch (ctx.action) {
        case 'idle':
          e.vel = ex.vec(0, 0);
          break;

        case 'wander': {
          if (ai.wanderTimer <= 0) {
            ai.wanderAngle = Math.random() * Math.PI * 2;
            ai.wanderTimer = 1 + Math.random() * 2;
          }
          // Wander via pathfinding
          const wanderX = e.pos.x + Math.cos(ai.wanderAngle) * 80;
          const wanderY = e.pos.y + Math.sin(ai.wanderAngle) * 80;
          const wanderTo = this.grid.findWalkableNear(wanderX, wanderY);
          const wpf = this.getPathFollower(e);
          wpf.tick(dt);
          const wdir = wpf.moveTo(e.pos.x, e.pos.y, wanderTo.x, wanderTo.y);
          e.vel = ex.vec(wdir.x * speed * 0.3, wdir.y * speed * 0.3);
          (e as any)._aiPath = wpf.getPath();
          (e as any)._aiPathIdx = wpf.getPathIdx();
          break;
        }

        case 'chase':
          this.chaseWithPathfinding(e, target, speed, dt);
          break;

        case 'attack':
          e.vel = ex.vec(0, 0);
          this.doMeleeAttack(e, target, ai);
          break;

        case 'orbit':
          this.doOrbit(e, target, speed, ai, scene);
          break;

        case 'flee': {
          // Flee via pathfinding — find a point away from target
          const away = e.pos.sub(target.pos).normalize();
          const fleeX = e.pos.x + away.x * 120;
          const fleeY = e.pos.y + away.y * 120;
          const fleeTo = this.grid.findWalkableNear(fleeX, fleeY);
          const pf = this.getPathFollower(e);
          pf.tick(dt);
          const dir = pf.moveTo(e.pos.x, e.pos.y, fleeTo.x, fleeTo.y);
          e.vel = ex.vec(dir.x * speed * 0.8, dir.y * speed * 0.8);
          // Store path for debug
          (e as any)._aiPath = pf.getPath();
          (e as any)._aiPathIdx = pf.getPathIdx();
          // Ranged enemies occasionally shoot while fleeing
          if (ai.isRanged && Math.random() < 0.1 * dt) {
            this.doRangedAttack(e, target, ai, scene);
          }
          break;
        }

        case 'shoot':
          e.vel = ex.vec(0, 0);
          this.doRangedAttack(e, target, ai, scene);
          break;
      }
    }
  }

  /** Chase target using shared PathFollower */
  private chaseWithPathfinding(e: GameEntity, target: ex.Actor, speed: number, dt: number): void {
    const pf = this.getPathFollower(e);
    pf.tick(dt);
    const dir = pf.moveTo(e.pos.x, e.pos.y, target.pos.x, target.pos.y);
    e.vel = ex.vec(dir.x * speed, dir.y * speed);

    // Store path for debug rendering
    (e as any)._aiPath = pf.getPath();
    (e as any)._aiPathIdx = pf.getPathIdx();
  }

  /** Execute melee attack with animation + damage frame dodge */
  private doMeleeAttack(e: GameEntity, target: ex.Actor, ai: AIBrainComponent): void {
    const anim = e.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
    const melee = e.get(MeleeAttackComponent) as MeleeAttackComponent | null;

    if (melee?.canAttack && !anim?.isAttacking) {
      ai.aggroFlag = true;
      if (anim) {
        anim.playAttack(() => {
          // DAMAGE FRAME — check distance NOW
          // If player dodged away → MISS!
          const distNow = e.pos.distance(target.pos);
          if (distNow <= melee.range) {
            const targetHp = target.get(HealthComponent) as HealthComponent | null;
            if (targetHp) targetHp.damage(melee.damage);
          }
        });
      }
      melee.startAttack(target);
    }
  }

  /** Orbit target via pathfinding + fire ranged attack */
  private doOrbit(e: GameEntity, target: ex.Actor, speed: number, ai: AIBrainComponent, scene: ex.Scene): void {
    // Calculate orbit point — perpendicular to target direction
    const toTarget = e.pos.sub(target.pos).normalize();
    const orbitX = e.pos.x + (-toTarget.y) * 60;
    const orbitY = e.pos.y + toTarget.x * 60;
    const orbitTo = this.grid.findWalkableNear(orbitX, orbitY);
    const pf = this.getPathFollower(e);
    pf.tick(1 / 60);
    const dir = pf.moveTo(e.pos.x, e.pos.y, orbitTo.x, orbitTo.y);
    e.vel = ex.vec(dir.x * speed * 0.5, dir.y * speed * 0.5);
    (e as any)._aiPath = pf.getPath();
    (e as any)._aiPathIdx = pf.getPathIdx();

    this.doRangedAttack(e, target, ai, scene);
  }

  /** Fire ranged projectile with animation */
  private doRangedAttack(e: GameEntity, target: ex.Actor, ai: AIBrainComponent, scene: ex.Scene): void {
    const ranged = e.get(RangedAttackComponent) as RangedAttackComponent | null;
    const anim = e.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
    const dist = e.pos.distance(target.pos);

    if (ranged?.canFire && dist < ai.attackRange) {
      if (anim && !anim.isAttacking) {
        anim.playAttack(() => {
          // Fire projectile on damage frame
          ranged.fire(target, scene);
        });
      } else if (!anim) {
        ranged.fire(target, scene);
      }
    }
  }
}
