import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { HealthComponent } from '../components/HealthComponent';
import { ResourceComponent } from '../components/ResourceComponent';
import { AIBrainComponent } from '../components/AIBrainComponent';
import { MeleeAttackComponent } from '../components/MeleeAttackComponent';
import { CONFIG } from '../config';

// ============================================================
// Decision tree node types
// ============================================================
interface TreeTrace {
  name: string;
  depth: number;
  status: 'active' | 'checking' | 'failed';
}

interface BotGoal {
  type: string;
  target?: GameEntity;
  x?: number;
  y?: number;
  evasion?: { x: number; y: number; urgency: number };
  _treePath: string;
}

interface TreeNode {
  name: string;
  check: (ctx: BotContext) => boolean;
  children?: TreeNode[];
  goal?: (ctx: BotContext) => BotGoal;
}

/** Game state passed in from GameScene each tick */
export interface BotGameState {
  bonfireFuel: number;
  bonfireMaxFuel: number;
  resources: { wood: number; stone: number; metal: number; gold: number };
}

interface BotContext {
  player: GameEntity;
  bonfire: GameEntity | null;
  bx: number; by: number;
  distToFire: number;
  hpRatio: number;
  fuelRatio: number;
  resources: BotGameState['resources'];
  enemies: GameEntity[];
  entities: GameEntity[];
  nearestEnemy: GameEntity | null;
  nearestEnemyDist: number;
  nearEnemyCount: number;
  strongEnemyClose: boolean;
  bestEnemy: GameEntity | null;
  enemyNearCamp: GameEntity | null;
  projectileAttacker: GameEntity | null;
  nearestResource: GameEntity | null;
  nearestResourceDist: number;
  woodNeeded: number;
  hasEnoughWood: boolean;
  evasion: { x: number; y: number; urgency: number } | null;
  dt: number;
}

// ============================================================
// BotAI — Full decision tree autonomous player with A* pathfinding
// ============================================================
export class BotAI {
  private player: GameEntity;
  private grid: GridCollisionSystem;
  private getEntities: () => GameEntity[];
  private getEnemies: () => GameEntity[];
  private getBonfires: () => GameEntity[];

  // State
  private currentGoal: BotGoal | null = null;
  private goalAge = 0;
  private goalMinTime = 0;
  private kiteTimer = 0;
  private retreating = false;
  private wanderAngle = 0;
  private wanderTimer = 0;
  private orbitAngle = 0;
  private stuckTimer = 0;
  private lastPos = { x: 0, y: 0 };

  // A* pathfinding state
  private path: Array<{ x: number; y: number }> | null = null;
  private pathIdx = 0;
  private repathTimer = 0;
  private pathTarget: { x: number; y: number } | null = null;

  // Movement smoothing
  private smoothVx = 0;
  private smoothVy = 0;
  private readonly SMOOTH_FACTOR = 0.18;

  // Decision tree debug trace
  private treeTrace: TreeTrace[] = [];
  private activeNodeName = '';
  private debugEl: HTMLDivElement | null = null;

  // Status label above player head
  private statusLabel: ex.Label | null = null;
  private statusText = '';

  // Config
  private readonly ATTACK_REACH = 40;
  private readonly SIGHT_RANGE = 350;
  private readonly CAMP_DEFENSE_RANGE = 250;
  private readonly KITE_DISTANCE = 50;
  private readonly WAYPOINT_REACH = 16;
  private readonly GATHER_RANGE = 180; // max distance from camp to gather

  // Game state (updated each tick from GameScene)
  private gameState: BotGameState = {
    bonfireFuel: 80,
    bonfireMaxFuel: CONFIG.BONFIRE_MAX_FUEL,
    resources: { wood: 5, stone: 0, metal: 0, gold: 0 },
  };

  private readonly tree: TreeNode;

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
    this.tree = this.buildDecisionTree();
  }

  setGameState(state: BotGameState): void {
    this.gameState = state;
  }

  // Reactive goal types that can interrupt any goal immediately
  private static readonly REACTIVE_GOALS = new Set(['flee', 'dodge', 'kite', 'kill']);

  private static readonly GOAL_HOLD_TIMES: Record<string, number> = {
    kill: 2.0,
    chop: 1.5,
    mine: 1.5,
    feed: 1.5,
    flee: 0.8,
    kite: 0.4,
    dodge: 0.2,
    idle: 1.0,
  };

  update(dt: number): { vx: number; vy: number; attack: boolean; interact: boolean } {
    const ctx = this.buildContext(dt);
    this.goalAge += dt;
    this.repathTimer -= dt;

    // Evaluate decision tree
    const trace: TreeTrace[] = [];
    const newGoal = this.evaluateTree(this.tree, ctx, 0, trace);
    this.treeTrace = trace;

    const candidate = newGoal || { type: 'idle', x: ctx.bx, y: ctx.by, _treePath: 'FALLBACK' };

    const shouldSwitch = this.shouldSwitchGoal(candidate, ctx);
    if (shouldSwitch) {
      this.currentGoal = candidate;
      this.goalAge = 0;
      this.goalMinTime = BotAI.GOAL_HOLD_TIMES[candidate.type] ?? 1.0;
      this.activeNodeName = candidate._treePath;
      // Clear path on goal switch
      this.path = null;
      this.pathTarget = null;
    } else {
      // Update target position
      if (this.currentGoal?.target && !this.currentGoal.target.isKilled()) {
        this.currentGoal.x = this.currentGoal.target.pos.x;
        this.currentGoal.y = this.currentGoal.target.pos.y;
      }
    }

    // Execute goal
    const raw = this.executeGoal(this.currentGoal!, ctx, dt);

    // Movement smoothing
    this.smoothVx += (raw.vx - this.smoothVx) * this.SMOOTH_FACTOR;
    this.smoothVy += (raw.vy - this.smoothVy) * this.SMOOTH_FACTOR;
    if (Math.abs(this.smoothVx) < 0.02) this.smoothVx = 0;
    if (Math.abs(this.smoothVy) < 0.02) this.smoothVy = 0;

    // Stuck detection
    const moved = Math.hypot(
      this.player.pos.x - this.lastPos.x,
      this.player.pos.y - this.lastPos.y
    );
    this.lastPos.x = this.player.pos.x;
    this.lastPos.y = this.player.pos.y;
    if (moved < 1) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.0) {
        this.stuckTimer = 0;
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.orbitAngle += 1.5;
        this.path = null; // force repath
        this.goalAge = 999;
      }
    } else {
      this.stuckTimer = 0;
    }

    // Update status label above player
    this.updateStatusLabel();

    this.renderDebugHUD();
    return { vx: this.smoothVx, vy: this.smoothVy, attack: raw.attack, interact: raw.interact };
  }

  /** Status label displayed above the player showing current action */
  private updateStatusLabel(): void {
    if (!this.player.scene) return;

    // Create label on first use
    if (!this.statusLabel) {
      this.statusLabel = new ex.Label({
        text: '',
        pos: this.player.pos.add(ex.vec(0, -36)),
        font: new ex.Font({
          family: 'monospace', size: 7, color: ex.Color.fromHex('#AADDFF'),
          textAlign: ex.TextAlign.Center,
        }),
        anchor: ex.vec(0.5, 0.5),
      });
      this.statusLabel.z = 10000;
      this.player.scene.add(this.statusLabel);
    }

    // Update position
    this.statusLabel.pos = this.player.pos.add(ex.vec(0, -36));
    this.statusLabel.z = this.player.z + 0.2;

    // Map goal to readable status
    const goalType = this.currentGoal?.type ?? 'idle';
    const statusMap: Record<string, string> = {
      idle: 'Resting',
      feed: 'Feeding fire',
      chop: 'Chopping wood',
      mine: 'Mining',
      kill: 'Fighting!',
      flee: 'Retreating!',
      dodge: 'Dodging!',
      kite: 'Kiting!',
    };
    const newStatus = statusMap[goalType] ?? goalType;
    if (newStatus !== this.statusText) {
      this.statusText = newStatus;
      this.statusLabel.text = newStatus;
      // Color by urgency
      const urgentTypes = ['flee', 'dodge', 'kite', 'kill'];
      const color = urgentTypes.includes(goalType) ? '#FF6644' : '#AADDFF';
      this.statusLabel.font = new ex.Font({
        family: 'monospace', size: 7, color: ex.Color.fromHex(color),
        textAlign: ex.TextAlign.Center,
      });
    }
  }

  private shouldSwitchGoal(candidate: BotGoal, _ctx: BotContext): boolean {
    if (!this.currentGoal) return true;
    if (this.currentGoal.target && this.currentGoal.target.isKilled()) return true;

    // Kill is reactive — if enemy is near camp/player, interrupt lower-priority goals
    if (BotAI.REACTIVE_GOALS.has(candidate.type) && candidate.type !== this.currentGoal.type) {
      // For 'kill', only interrupt if current goal is low priority
      if (candidate.type === 'kill') {
        const lowPriority = ['idle', 'chop', 'mine', 'feed', 'gather'];
        if (lowPriority.includes(this.currentGoal.type)) return true;
      } else {
        return true;
      }
    }

    if (candidate.type === this.currentGoal.type &&
        candidate.target === this.currentGoal.target) return false;
    if (this.goalAge < this.goalMinTime && this.currentGoal.type !== 'idle') return false;

    return candidate.type !== this.currentGoal.type ||
           candidate.target !== this.currentGoal.target;
  }

  // ============================================================
  // A* PATHFINDING — follow path to target
  // ============================================================
  private moveToWithPathfinding(tx: number, ty: number): { x: number; y: number } {
    const p = this.player;

    // Repath if needed
    if (!this.path || this.pathIdx >= this.path.length || this.repathTimer <= 0 ||
      (this.pathTarget && Math.hypot(tx - this.pathTarget.x, ty - this.pathTarget.y) > 60)) {
      this.path = this.grid.findPath(p.pos.x, p.pos.y, tx, ty);
      this.pathIdx = 0;
      this.repathTimer = 0.8 + Math.random() * 0.4;
      this.pathTarget = { x: tx, y: ty };
    }

    if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const dist = Math.hypot(p.pos.x - wp.x, p.pos.y - wp.y);
      if (dist < this.WAYPOINT_REACH) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          return { x: 0, y: 0 }; // arrived
        }
      }
      if (this.pathIdx < this.path.length) {
        const next = this.path[this.pathIdx];
        const dx = next.x - p.pos.x, dy = next.y - p.pos.y;
        const len = Math.hypot(dx, dy);
        if (len > 1) return { x: dx / len, y: dy / len };
      }
    }

    // Fallback: direct movement
    return this.dirTo(p.pos, tx, ty);
  }

  // ============================================================
  // DECISION TREE
  // ============================================================
  private buildDecisionTree(): TreeNode {
    return {
      name: 'SURVIVE & PROGRESS',
      check: () => true,
      children: [
        // === SURVIVAL ===
        {
          name: 'SURVIVE',
          check: () => true,
          children: [
            {
              name: 'Low HP Retreat',
              check: (ctx) => {
                if (ctx.hpRatio < 0.35) this.retreating = true;
                if (ctx.hpRatio > 0.6) this.retreating = false;
                return this.retreating && ctx.distToFire > 60;
              },
              goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by, _treePath: 'Low HP Retreat' }),
            },
            {
              name: 'Dodge Projectile',
              check: (ctx) => ctx.evasion !== null && ctx.evasion.urgency > 1.5,
              goal: (ctx) => ({ type: 'dodge', evasion: ctx.evasion!, _treePath: 'Dodge Projectile' }),
            },
            {
              name: 'Surrounded',
              check: (ctx) => ctx.nearEnemyCount >= 3 && ctx.hpRatio < 0.7,
              goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by, _treePath: 'Surrounded' }),
            },
          ],
        },
        // === DEFEND CAMP — enemy near bonfire ===
        {
          name: 'Defend Camp',
          check: (ctx) => ctx.enemyNearCamp !== null,
          goal: (ctx) => ({
            type: 'kill', target: ctx.enemyNearCamp!,
            x: ctx.enemyNearCamp!.pos.x, y: ctx.enemyNearCamp!.pos.y,
            _treePath: 'Defend Camp',
          }),
        },
        // === COUNTER-ATTACK — kill projectile attacker ===
        {
          name: 'Counter-Attack',
          check: (ctx) => ctx.projectileAttacker !== null,
          goal: (ctx) => ({
            type: 'kill', target: ctx.projectileAttacker!,
            x: ctx.projectileAttacker!.pos.x, y: ctx.projectileAttacker!.pos.y,
            _treePath: 'Counter-Attack',
          }),
        },
        // === KITE MELEE ENEMIES ===
        {
          name: 'Kite Melee',
          check: (ctx) => {
            if (!ctx.nearestEnemy || ctx.nearestEnemyDist > this.KITE_DISTANCE) return false;
            const ai = ctx.nearestEnemy.get(AIBrainComponent) as AIBrainComponent | null;
            return ai !== null && !ai.isRanged;
          },
          goal: (ctx) => ({
            type: 'kite', target: ctx.nearestEnemy!,
            x: ctx.nearestEnemy!.pos.x, y: ctx.nearestEnemy!.pos.y,
            _treePath: 'Kite Melee',
          }),
        },
        // === FIRE EMERGENCY ===
        {
          name: 'FIRE DYING',
          check: (ctx) => ctx.fuelRatio < 0.35,
          children: [
            {
              name: 'Feed Fire (critical)',
              check: (ctx) => ctx.resources.wood >= 1 && ctx.bonfire !== null,
              goal: (ctx) => ({ type: 'feed', x: ctx.bx, y: ctx.by, _treePath: 'Feed Fire (critical)' }),
            },
            {
              name: 'Chop for Fire (urgent)',
              check: (ctx) => ctx.hpRatio >= 0.35 && ctx.nearestResource !== null && ctx.nearestResourceDist < 300,
              goal: (ctx) => ({
                type: 'chop', target: ctx.nearestResource!,
                x: ctx.nearestResource!.pos.x, y: ctx.nearestResource!.pos.y,
                _treePath: 'Chop for Fire (urgent)',
              }),
            },
          ],
        },
        // === COMBAT — fight visible enemies ===
        {
          name: 'COMBAT',
          check: (ctx) => ctx.bestEnemy !== null,
          children: [
            {
              name: 'Kill Enemy',
              check: () => true,
              goal: (ctx) => ({
                type: 'kill', target: ctx.bestEnemy!,
                x: ctx.bestEnemy!.pos.x, y: ctx.bestEnemy!.pos.y,
                _treePath: 'Kill Enemy',
              }),
            },
          ],
        },
        // === HAS WOOD → FEED FIRE ===
        {
          name: 'Feed Fire',
          check: (ctx) => ctx.resources.wood >= 1 && ctx.bonfire !== null && ctx.fuelRatio < 0.85,
          goal: (ctx) => ({ type: 'feed', x: ctx.bx, y: ctx.by, _treePath: 'Feed Fire' }),
        },
        // === NEED WOOD → GATHER (only enough + 2 extra, near camp) ===
        {
          name: 'Gather Wood',
          check: (ctx) => {
            if (ctx.hpRatio < 0.4) return false;
            if (ctx.hasEnoughWood) return false; // already have enough
            return ctx.nearestResource !== null;
          },
          goal: (ctx) => ({
            type: 'chop', target: ctx.nearestResource!,
            x: ctx.nearestResource!.pos.x, y: ctx.nearestResource!.pos.y,
            _treePath: `Gather Wood (need ${ctx.woodNeeded})`,
          }),
        },
        // === IDLE — stay near bonfire, orbit slowly ===
        {
          name: 'Camp Idle',
          check: () => true,
          goal: (ctx) => ({ type: 'idle', x: ctx.bx, y: ctx.by, _treePath: 'Camp Idle' }),
        },
      ],
    };
  }

  // ============================================================
  // Tree evaluator
  // ============================================================
  private evaluateTree(node: TreeNode, ctx: BotContext, depth: number, trace: TreeTrace[]): BotGoal | null {
    const passed = node.check(ctx);
    if (!passed) { trace.push({ name: node.name, depth, status: 'failed' }); return null; }
    if (node.goal) { trace.push({ name: node.name, depth, status: 'active' }); return node.goal(ctx); }
    if (node.children) {
      trace.push({ name: node.name, depth, status: 'checking' });
      for (const child of node.children) {
        const result = this.evaluateTree(child, ctx, depth + 1, trace);
        if (result) {
          for (let i = trace.length - 1; i >= 0; i--) {
            if (trace[i].depth === depth && trace[i].name === node.name) { trace[i].status = 'active'; break; }
          }
          result._treePath = node.name + ' > ' + result._treePath;
          return result;
        }
      }
      const bi = trace.findIndex(t => t.depth === depth && t.name === node.name);
      if (bi >= 0) trace[bi].status = 'failed';
    }
    return null;
  }

  // ============================================================
  // Context builder
  // ============================================================
  private buildContext(dt: number): BotContext {
    const p = this.player;
    const hp = p.get(HealthComponent) as HealthComponent | null;
    const enemies = this.getEnemies().filter(e => !e.isKilled());
    const bonfires = this.getBonfires();
    const bonfire = bonfires[0] ?? null;
    const bx = bonfire?.pos.x ?? p.pos.x;
    const by = bonfire?.pos.y ?? p.pos.y;

    let nearestEnemy: GameEntity | null = null;
    let nearestEnemyDist = Infinity;
    let nearEnemyCount = 0;
    let strongEnemyClose = false;
    let enemyNearCamp: GameEntity | null = null;
    let enemyNearCampDist = Infinity;

    for (const e of enemies) {
      const d = p.pos.distance(e.pos);
      if (d < nearestEnemyDist) { nearestEnemyDist = d; nearestEnemy = e; }
      if (d < 80) nearEnemyCount++;
      if (d < 55) {
        const ai = e.get(AIBrainComponent) as AIBrainComponent | null;
        if (ai && ai.damage >= 15) strongEnemyClose = true;
      }
      // Enemy near bonfire — defend camp
      if (bonfire) {
        const campDist = e.pos.distance(bonfire.pos);
        if (campDist < this.CAMP_DEFENSE_RANGE && campDist < enemyNearCampDist) {
          enemyNearCampDist = campDist;
          enemyNearCamp = e;
        }
      }
    }

    // Best enemy to hunt
    let bestEnemy: GameEntity | null = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
      const d = p.pos.distance(e.pos);
      if (d > this.SIGHT_RANGE) continue;
      const selfDefense = d < 60;
      const eHp = (e.get(HealthComponent) as HealthComponent | null)?.hp ?? 20;
      const score = (selfDefense ? 500 : 0) + (300 - d) - eHp * 0.5;
      if (score > bestScore) { bestScore = score; bestEnemy = e; }
    }

    // Find attacker — who shot a projectile at us?
    let projectileAttacker: GameEntity | null = null;
    if (p.scene) {
      for (const actor of p.scene.actors) {
        if ((actor as any).entityType !== 'projectile') continue;
        const dist = p.pos.distance(actor.pos);
        if (dist > 150) continue;
        // Is it heading toward us?
        const toPlayer = p.pos.sub(actor.pos).normalize();
        const projDir = actor.vel.normalize();
        const dot = toPlayer.x * projDir.x + toPlayer.y * projDir.y;
        if (dot > 0.5) {
          // Find the enemy who owns this projectile (nearest ranged enemy)
          for (const e of enemies) {
            const ai = e.get(AIBrainComponent) as AIBrainComponent | null;
            if (ai?.isRanged && e.pos.distance(actor.pos) < 300) {
              projectileAttacker = e;
              break;
            }
          }
          if (projectileAttacker) break;
        }
      }
    }

    // Nearest resource — search near CAMP, not player (stay close to base)
    let nearestResource: GameEntity | null = null;
    let nearestResourceDist = Infinity;
    for (const e of this.getEntities()) {
      if (e.isKilled() || !e.get(ResourceComponent)) continue;
      // Only consider resources within GATHER_RANGE of camp
      if (bonfire && e.pos.distance(bonfire.pos) > this.GATHER_RANGE) continue;
      const d = p.pos.distance(e.pos);
      if (d < nearestResourceDist) { nearestResourceDist = d; nearestResource = e; }
    }

    // How much wood do we need? (fuel deficit + 2 extra logs buffer)
    const fuelDeficit = this.gameState.bonfireMaxFuel * 0.8 - this.gameState.bonfireFuel;
    const woodNeeded = Math.max(0, Math.ceil(fuelDeficit / CONFIG.FUEL_PER_WOOD)) + 2;
    const hasEnoughWood = this.gameState.resources.wood >= woodNeeded;

    const evasion = this.computeEvasion(p, enemies);

    return {
      player: p, bonfire, bx, by,
      distToFire: bonfire ? p.pos.distance(bonfire.pos) : 0,
      hpRatio: hp ? hp.hp / hp.maxHp : 1,
      fuelRatio: this.gameState.bonfireFuel / this.gameState.bonfireMaxFuel,
      resources: this.gameState.resources,
      enemies, entities: this.getEntities(),
      nearestEnemy, nearestEnemyDist, nearEnemyCount, strongEnemyClose,
      bestEnemy, enemyNearCamp, projectileAttacker,
      nearestResource, nearestResourceDist,
      woodNeeded, hasEnoughWood,
      evasion, dt,
    };
  }

  // ============================================================
  // Evasion
  // ============================================================
  private computeEvasion(
    player: GameEntity, enemies: GameEntity[]
  ): { x: number; y: number; urgency: number } | null {
    if (!player.scene) return null;
    let evX = 0, evY = 0;
    const px = player.pos.x, py = player.pos.y;
    const ENEMY_AVOID_R = 55;
    const PROJ_AVOID_R = 100;

    for (const e of enemies) {
      const ed = player.pos.distance(e.pos);
      if (ed < ENEMY_AVOID_R && ed > 1) {
        const strength = (ENEMY_AVOID_R - ed) / ENEMY_AVOID_R * 0.7;
        evX += (px - e.pos.x) / ed * strength;
        evY += (py - e.pos.y) / ed * strength;
      }
    }

    for (const actor of player.scene.actors) {
      if ((actor as any).entityType !== 'projectile') continue;
      const dist = player.pos.distance(actor.pos);
      if (dist > PROJ_AVOID_R || dist < 5) continue;
      const speed = actor.vel.distance(ex.Vector.Zero);
      if (speed < 10) continue;
      const tpx = px - actor.pos.x, tpy = py - actor.pos.y;
      const dot = tpx * actor.vel.x + tpy * actor.vel.y;
      if (dot < 0) continue;
      const tClosest = dot / (speed * speed);
      const cpx = actor.pos.x + actor.vel.x * tClosest;
      const cpy = actor.pos.y + actor.vel.y * tClosest;
      const minDist = Math.hypot(cpx - px, cpy - py);
      if (minDist > 30) continue;
      const pnx = -actor.vel.y / speed, pny = actor.vel.x / speed;
      const bf = this.getBonfires()[0];
      if (bf) {
        const toBfX = bf.pos.x - px, toBfY = bf.pos.y - py;
        const dotBf = pnx * toBfX + pny * toBfY;
        const sign = dotBf >= 0 ? 1 : -1;
        const urgency = tClosest < 0.3 ? 3.0 : tClosest < 0.7 ? 2.0 : 1.2;
        evX += pnx * sign * urgency;
        evY += pny * sign * urgency;
      } else {
        evX += pnx * 2.0;
        evY += pny * 2.0;
      }
    }

    const len = Math.hypot(evX, evY);
    if (len < 0.1) return null;
    return { x: evX / len, y: evY / len, urgency: len };
  }

  // ============================================================
  // Goal execution — uses A* pathfinding for all movement
  // ============================================================
  private executeGoal(
    goal: BotGoal, ctx: BotContext, dt: number
  ): { vx: number; vy: number; attack: boolean; interact: boolean } {
    let vx = 0, vy = 0;
    let attack = false;
    let interact = false;

    switch (goal.type) {
      case 'flee': {
        // A* pathfind to bonfire
        const dir = this.moveToWithPathfinding(goal.x!, goal.y!);
        vx = dir.x;
        vy = dir.y;
        // Blend evasion
        if (ctx.evasion && ctx.evasion.urgency > 0.5) {
          const blend = Math.min(ctx.evasion.urgency * 0.4, 0.6);
          vx = vx * (1 - blend) + ctx.evasion.x * blend;
          vy = vy * (1 - blend) + ctx.evasion.y * blend;
        }
        break;
      }

      case 'dodge': {
        if (goal.evasion) { vx = goal.evasion.x; vy = goal.evasion.y; }
        break;
      }

      case 'kite': {
        const enemy = goal.target!;
        const away = ctx.player.pos.sub(enemy.pos).normalize();
        if (ctx.bonfire) {
          const toBf = this.dirTo(ctx.player.pos, ctx.bx, ctx.by);
          vx = away.x * 0.6 + toBf.x * 0.4;
          vy = away.y * 0.6 + toBf.y * 0.4;
        } else {
          vx = away.x; vy = away.y;
        }
        this.kiteTimer += dt;
        if (this.kiteTimer > 0.25) { this.kiteTimer = 0; attack = true; }
        break;
      }

      case 'kill': {
        const enemy = goal.target!;
        if (enemy.isKilled()) break;
        const dist = ctx.player.pos.distance(enemy.pos);
        if (dist < this.ATTACK_REACH) {
          attack = true;
          // Kite backward, pull toward bonfire
          const away = ctx.player.pos.sub(enemy.pos).normalize();
          if (ctx.bonfire) {
            const toBf = this.dirTo(ctx.player.pos, ctx.bx, ctx.by);
            vx = away.x * 0.6 + toBf.x * 0.4;
            vy = away.y * 0.6 + toBf.y * 0.4;
          } else {
            vx = away.x * 0.3; vy = away.y * 0.3;
          }
        } else {
          // A* pathfind to enemy
          const dir = this.moveToWithPathfinding(enemy.pos.x, enemy.pos.y);
          vx = dir.x; vy = dir.y;
          // Blend evasion while approaching
          if (ctx.evasion && ctx.evasion.urgency > 0.5) {
            const blend = Math.min(ctx.evasion.urgency * 0.3, 0.5);
            vx = vx * (1 - blend) + ctx.evasion.x * blend;
            vy = vy * (1 - blend) + ctx.evasion.y * blend;
          }
        }
        break;
      }

      case 'feed': {
        if (!ctx.bonfire) break;
        const dist = ctx.player.pos.distance(ctx.bonfire.pos);
        if (dist < CONFIG.INTERACT_RADIUS) {
          this.orbitAngle += dt * 1.5;
          const ox = ctx.bx + Math.cos(this.orbitAngle) * 30;
          const oy = ctx.by + Math.sin(this.orbitAngle) * 30;
          const dir = this.dirTo(ctx.player.pos, ox, oy);
          vx = dir.x * 0.4; vy = dir.y * 0.4;
          interact = true;
        } else {
          // A* to bonfire
          const dir = this.moveToWithPathfinding(ctx.bx, ctx.by);
          vx = dir.x; vy = dir.y;
          if (ctx.evasion && ctx.evasion.urgency > 1.0) {
            vx = ctx.evasion.x; vy = ctx.evasion.y;
          }
        }
        break;
      }

      case 'chop':
      case 'mine': {
        const target = goal.target!;
        if (target.isKilled()) break;
        const dist = ctx.player.pos.distance(target.pos);
        if (dist < 52) {
          attack = true;
          this.orbitAngle += dt * 2;
          const ox = target.pos.x + Math.cos(this.orbitAngle) * 30;
          const oy = target.pos.y + Math.sin(this.orbitAngle) * 30;
          const dir = this.dirTo(ctx.player.pos, ox, oy);
          vx = dir.x * 0.3; vy = dir.y * 0.3;
          if (ctx.evasion && ctx.evasion.urgency > 1.0) {
            vx = ctx.evasion.x; vy = ctx.evasion.y;
          }
        } else {
          // A* to resource
          const dir = this.moveToWithPathfinding(target.pos.x, target.pos.y);
          vx = dir.x; vy = dir.y;
          if (ctx.evasion && ctx.evasion.urgency > 0.5) {
            const blend = Math.min(ctx.evasion.urgency * 0.4, 0.6);
            vx = vx * (1 - blend) + ctx.evasion.x * blend;
            vy = vy * (1 - blend) + ctx.evasion.y * blend;
          }
        }
        break;
      }

      case 'idle': {
        if (ctx.bonfire && ctx.distToFire > 70) {
          // Too far from camp — walk back
          const dir = this.moveToWithPathfinding(ctx.bx, ctx.by);
          vx = dir.x * 0.5; vy = dir.y * 0.5;
        } else if (ctx.bonfire) {
          // Near camp — slow orbit, occasionally change side
          this.wanderTimer += dt;
          if (this.wanderTimer > 5 + Math.random() * 4) {
            this.wanderTimer = 0;
            this.orbitAngle += Math.PI * (0.5 + Math.random()); // jump to different side
          }
          this.orbitAngle += dt * 0.3; // slow orbit
          const ox = ctx.bx + Math.cos(this.orbitAngle) * 40;
          const oy = ctx.by + Math.sin(this.orbitAngle) * 40;
          const dir = this.dirTo(ctx.player.pos, ox, oy);
          vx = dir.x * 0.2; vy = dir.y * 0.2; // very slow movement
        } else {
          vx = Math.cos(this.wanderAngle) * 0.5;
          vy = Math.sin(this.wanderAngle) * 0.5;
        }
        break;
      }
    }

    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > 1) { vx /= len; vy /= len; }
    return { vx, vy, attack, interact };
  }

  private dirTo(from: ex.Vector, tx: number, ty: number): { x: number; y: number } {
    const dx = tx - from.x, dy = ty - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  // ============================================================
  // DEBUG HUD
  // ============================================================
  private renderDebugHUD(): void {
    if (!this.debugEl) {
      this.debugEl = document.createElement('div');
      this.debugEl.style.cssText = `
        position: fixed; top: 8px; right: 8px; z-index: 10000;
        background: rgba(0,0,0,0.85); color: #ccc;
        font-family: monospace; font-size: 11px; line-height: 1.5;
        padding: 8px 12px; border-radius: 6px;
        pointer-events: none; max-width: 340px; min-width: 200px;
        border: 1px solid rgba(100,255,100,0.2);
      `;
      document.body.appendChild(this.debugEl);
    }

    const statusColors: Record<string, string> = { active: '#44ff44', checking: '#888', failed: '#555' };
    const statusIcons: Record<string, string> = { active: '\u25B6', checking: '\u25CB', failed: '\u00D7' };

    let html = '<div style="color:#44ff44;font-weight:bold;margin-bottom:4px">BOT AI</div>';
    const fuelPct = Math.round(this.gameState.bonfireFuel / this.gameState.bonfireMaxFuel * 100);
    html += `<div style="color:#ff8800">Fuel: ${fuelPct}%</div>`;
    html += `<div style="color:#aa8844">Wood: ${this.gameState.resources.wood}</div>`;

    html += '<div style="margin-top:4px;border-top:1px solid #333;padding-top:4px">';
    for (const entry of this.treeTrace) {
      const indent = '\u00A0\u00A0'.repeat(entry.depth);
      const color = statusColors[entry.status] || '#555';
      const icon = statusIcons[entry.status] || '\u00B7';
      const bold = entry.status === 'active' ? 'font-weight:bold;' : '';
      html += `<div style="color:${color};${bold}">${indent}${icon} ${entry.name}</div>`;
    }
    html += '</div>';

    if (this.currentGoal) {
      html += `<div style="color:#ffaa00;margin-top:4px;border-top:1px solid #333;padding-top:4px">`;
      html += `Goal: ${this.currentGoal.type}`;
      if (this.currentGoal.target) {
        const tType = (this.currentGoal.target as any).entityType;
        if (tType) html += ` (${tType})`;
      }
      html += ` [${this.goalAge.toFixed(1)}s]`;
      if (this.path) html += ` A*:${this.path.length - this.pathIdx}wp`;
      html += '</div>';
    }

    this.debugEl.innerHTML = html;
  }

  removeDebugHUD(): void {
    if (this.debugEl) { this.debugEl.remove(); this.debugEl = null; }
    if (this.statusLabel) { this.statusLabel.kill(); this.statusLabel = null; }
  }

  get goal(): string { return this.currentGoal?._treePath ?? 'IDLE'; }
  get trace(): TreeTrace[] { return this.treeTrace; }
}
