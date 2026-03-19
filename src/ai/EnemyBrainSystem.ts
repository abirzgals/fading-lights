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

      // Execute action
      const speed = ai.speed;
      switch (ctx.action) {
        case 'idle':
          e.vel = ex.vec(0, 0);
          break;

        case 'wander':
          if (ai.wanderTimer <= 0) {
            ai.wanderAngle = Math.random() * Math.PI * 2;
            ai.wanderTimer = 1 + Math.random() * 2;
          }
          e.vel = ex.vec(Math.cos(ai.wanderAngle) * speed * 0.3, Math.sin(ai.wanderAngle) * speed * 0.3);
          break;

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

        case 'flee':
          const away = e.pos.sub(target.pos).normalize();
          e.vel = ex.vec(away.x * speed * 0.8, away.y * speed * 0.8);
          break;

        case 'shoot':
          e.vel = ex.vec(0, 0);
          this.doRangedAttack(e, target, ai, scene);
          break;
      }
    }
  }

  /** Chase target using A* pathfinding */
  private chaseWithPathfinding(e: GameEntity, target: ex.Actor, speed: number, dt: number): void {
    let path = (e as any)._aiPath as Array<{ x: number; y: number }> | null;
    let pathIdx = (e as any)._aiPathIdx as number || 0;
    let repathTimer = ((e as any)._aiRepathTimer as number || 0) - dt;

    if (!path || pathIdx >= path.length || repathTimer <= 0) {
      path = this.grid.findPath(e.pos.x, e.pos.y, target.pos.x, target.pos.y);
      (e as any)._aiPath = path;
      (e as any)._aiPathIdx = 0;
      pathIdx = 0;
      repathTimer = 0.8 + Math.random() * 0.4;
    }
    (e as any)._aiRepathTimer = repathTimer;

    if (path && pathIdx < path.length) {
      const wp = path[pathIdx];
      if (Math.sqrt((e.pos.x - wp.x) ** 2 + (e.pos.y - wp.y) ** 2) < 16) {
        pathIdx++;
        (e as any)._aiPathIdx = pathIdx;
      }
      if (pathIdx < path.length) {
        const next = path[pathIdx];
        const dir = ex.vec(next.x - e.pos.x, next.y - e.pos.y).normalize();
        e.vel = ex.vec(dir.x * speed, dir.y * speed);
        return;
      }
    }

    // Fallback: direct movement
    const dir = target.pos.sub(e.pos).normalize();
    e.vel = ex.vec(dir.x * speed, dir.y * speed);
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

  /** Orbit target + fire ranged attack with animation */
  private doOrbit(e: GameEntity, target: ex.Actor, speed: number, ai: AIBrainComponent, scene: ex.Scene): void {
    // Circle around target
    const orbitDir = e.pos.sub(target.pos).normalize();
    e.vel = ex.vec(-orbitDir.y * speed * 0.5, orbitDir.x * speed * 0.5);

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
