import * as ex from 'excalibur';

/**
 * Decision Tree node types:
 * - Selector: tries children in order, returns first success
 * - Sequence: runs children in order, fails on first failure
 * - Leaf: executes an action, returns success/failure
 */
export type NodeStatus = 'success' | 'failure' | 'running';

export interface TreeNode {
  name: string;
  evaluate(ctx: DecisionContext): NodeStatus;
}

/** Context passed to decision tree each tick */
export interface DecisionContext {
  self: ex.Actor;
  target: ex.Actor | null;
  distToTarget: number;
  hp: number;
  maxHp: number;
  isRanged: boolean;
  attackRange: number;
  speed: number;
  sightRange: number;
  dt: number;
  /** Set by leaf nodes — the chosen action */
  action: 'idle' | 'wander' | 'chase' | 'attack' | 'flee' | 'orbit' | 'shoot';
  moveDir: ex.Vector;
}

/** Selector — tries children in priority order, returns first success */
export class Selector implements TreeNode {
  name: string;
  children: TreeNode[];
  constructor(name: string, children: TreeNode[]) {
    this.name = name;
    this.children = children;
  }
  evaluate(ctx: DecisionContext): NodeStatus {
    for (const child of this.children) {
      const result = child.evaluate(ctx);
      if (result !== 'failure') return result;
    }
    return 'failure';
  }
}

/** Sequence — runs all children, fails on first failure */
export class Sequence implements TreeNode {
  name: string;
  children: TreeNode[];
  constructor(name: string, children: TreeNode[]) {
    this.name = name;
    this.children = children;
  }
  evaluate(ctx: DecisionContext): NodeStatus {
    for (const child of this.children) {
      const result = child.evaluate(ctx);
      if (result !== 'success') return result;
    }
    return 'success';
  }
}

/** Condition — checks a predicate */
export class Condition implements TreeNode {
  name: string;
  private check: (ctx: DecisionContext) => boolean;
  constructor(name: string, check: (ctx: DecisionContext) => boolean) {
    this.name = name;
    this.check = check;
  }
  evaluate(ctx: DecisionContext): NodeStatus {
    return this.check(ctx) ? 'success' : 'failure';
  }
}

/** Action — sets the action on context */
export class Action implements TreeNode {
  name: string;
  private exec: (ctx: DecisionContext) => NodeStatus;
  constructor(name: string, exec: (ctx: DecisionContext) => NodeStatus) {
    this.name = name;
    this.exec = exec;
  }
  evaluate(ctx: DecisionContext): NodeStatus {
    return this.exec(ctx);
  }
}

// ============================================================
// Pre-built enemy behavior trees
// ============================================================

/** Melee enemy: chase → attack when close, flee when low HP */
export function createMeleeTree(): TreeNode {
  return new Selector('Root', [
    // Flee when low HP
    new Sequence('Flee', [
      new Condition('LowHP', ctx => ctx.hp < ctx.maxHp * 0.2),
      new Condition('TargetNear', ctx => ctx.distToTarget < ctx.sightRange),
      new Action('RunAway', ctx => { ctx.action = 'flee'; return 'success'; }),
    ]),
    // Attack when in range
    new Sequence('Attack', [
      new Condition('TargetInMelee', ctx => ctx.distToTarget < 30),
      new Action('MeleeAttack', ctx => { ctx.action = 'attack'; return 'success'; }),
    ]),
    // Chase when target visible
    new Sequence('Chase', [
      new Condition('TargetVisible', ctx => ctx.distToTarget < ctx.sightRange),
      new Action('ChaseTarget', ctx => { ctx.action = 'chase'; return 'success'; }),
    ]),
    // Wander when idle
    new Action('Wander', ctx => { ctx.action = 'wander'; return 'success'; }),
  ]);
}

/** Ranged enemy: orbit at range → shoot, flee if too close */
export function createRangedTree(): TreeNode {
  return new Selector('Root', [
    // Flee when too close
    new Sequence('TooClose', [
      new Condition('TargetVeryClose', ctx => ctx.distToTarget < ctx.attackRange * 0.5),
      new Action('Retreat', ctx => { ctx.action = 'flee'; return 'success'; }),
    ]),
    // Shoot when in range
    new Sequence('Shoot', [
      new Condition('InRange', ctx => ctx.distToTarget < ctx.attackRange),
      new Action('OrbitAndShoot', ctx => { ctx.action = 'orbit'; return 'success'; }),
    ]),
    // Chase to get in range
    new Sequence('Approach', [
      new Condition('TargetVisible', ctx => ctx.distToTarget < ctx.sightRange),
      new Action('ChaseTarget', ctx => { ctx.action = 'chase'; return 'success'; }),
    ]),
    // Wander
    new Action('Wander', ctx => { ctx.action = 'wander'; return 'success'; }),
  ]);
}

/** Fire crawler: beeline to bonfire, ignore player */
export function createCrawlerTree(): TreeNode {
  return new Selector('Root', [
    // Always move toward target (bonfire)
    new Sequence('ToFire', [
      new Condition('HasTarget', ctx => ctx.target !== null),
      new Action('CrawlToFire', ctx => { ctx.action = 'chase'; return 'success'; }),
    ]),
    new Action('Wander', ctx => { ctx.action = 'wander'; return 'success'; }),
  ]);
}

/** Boss: complex behavior with phases */
export function createBossTree(): TreeNode {
  return new Selector('Root', [
    // Phase 1: ranged attacks when far
    new Sequence('RangedPhase', [
      new Condition('FarAway', ctx => ctx.distToTarget > 100),
      new Action('Shoot', ctx => { ctx.action = 'orbit'; return 'success'; }),
    ]),
    // Phase 2: melee when close
    new Sequence('MeleePhase', [
      new Condition('Close', ctx => ctx.distToTarget < 60),
      new Action('Attack', ctx => { ctx.action = 'attack'; return 'success'; }),
    ]),
    // Chase
    new Action('Chase', ctx => { ctx.action = 'chase'; return 'success'; }),
  ]);
}
