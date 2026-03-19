import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { PathFollower } from '../engine/PathFollower';
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

/** Build spot info passed from GameScene */
export interface BotBuildSpot {
  type: string;
  wx: number;
  wy: number;
  cost: Partial<Record<string, number>>;
}

/** Game state passed in from GameScene each tick */
/** Drop on the ground the bot can pick up */
export interface BotDrop {
  x: number;
  y: number;
  type: string; // 'wood' | 'stone' | 'metal' | 'gold'
}

export interface BotGameState {
  bonfireFuel: number;
  bonfireMaxFuel: number;
  resources: { wood: number; stone: number; metal: number; gold: number };
  campLevel: number;
  campFuelAdded: number;
  availableBuildSpots: BotBuildSpot[];
  /** Build spots blocked by resources that need clearing */
  blockedBuildSpots: Array<{ wx: number; wy: number }>;
  /** Drops on the ground the bot can walk to */
  drops: BotDrop[];
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
  bestResourceByType: Record<string, { entity: GameEntity; dist: number; score: number }>;
  woodNeeded: number;
  hasEnoughWood: boolean;
  /** Can we level up the fire? */
  canLevelUp: boolean;
  /** How many wood logs needed to reach next fire level */
  woodForLevelUp: number;
  /** Nearest useful drop on the ground (needed resource type) */
  nearestNeededDrop: BotDrop | null;
  nearestNeededDropDist: number;
  /** Any nearest drop regardless of type */
  nearestDrop: BotDrop | null;
  nearestDropDist: number;
  /** Resource blocking a build spot that needs clearing */
  blockerResource: GameEntity | null;
  /** Build spot the bot can afford right now */
  affordableBuildSpot: BotBuildSpot | null;
  /** Build spot the bot should gather resources for */
  gatherBuildSpot: BotBuildSpot | null;
  /** What resource is missing for the gather build spot */
  gatherNeed: { type: string; amount: number } | null;
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

  // Shared pathfinder
  private pathFollower: PathFollower;

  // Cached BFS + resource search (throttled to 500ms)
  private cachedReachable: Map<string, number> = new Map();
  private reachableCacheTimer = 0;
  private cachedResources: {
    bestByType: Record<string, { entity: GameEntity; dist: number; score: number }>;
    nearest: GameEntity | null;
    nearestDist: number;
  } = { bestByType: {}, nearest: null, nearestDist: Infinity };
  private cachedEnemyContext: {
    bestEnemy: GameEntity | null;
    enemyNearCamp: GameEntity | null;
    projectileAttacker: GameEntity | null;
  } = { bestEnemy: null, enemyNearCamp: null, projectileAttacker: null };

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
    campLevel: 0,
    campFuelAdded: 0,
    availableBuildSpots: [],
    blockedBuildSpots: [],
    drops: [],
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
    this.pathFollower = new PathFollower(opts.grid);
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
    build: 2.0,
    pickup: 0.5,
    flee: 0.8,
    kite: 0.4,
    dodge: 0.2,
    idle: 1.0,
  };

  // Profiling data — read by GameScene
  public _lastPerfBreakdown: Record<string, number> = {};

  update(dt: number): { vx: number; vy: number; attack: boolean; interact: boolean } {
    const perf: Record<string, number> = {};
    let t0 = performance.now();
    const ctx = this.buildContext(dt);
    perf.context = performance.now() - t0;

    this.goalAge += dt;
    this.pathFollower.tick(dt);

    t0 = performance.now();
    const trace: TreeTrace[] = [];
    const newGoal = this.evaluateTree(this.tree, ctx, 0, trace);
    this.treeTrace = trace;
    perf.tree = performance.now() - t0;

    const candidate = newGoal || { type: 'idle', x: ctx.bx, y: ctx.by, _treePath: 'FALLBACK' };

    const shouldSwitch = this.shouldSwitchGoal(candidate, ctx);
    if (shouldSwitch) {
      this.currentGoal = candidate;
      this.goalAge = 0;
      this.goalMinTime = BotAI.GOAL_HOLD_TIMES[candidate.type] ?? 1.0;
      this.activeNodeName = candidate._treePath;
      this.pathFollower.clearPath();
    } else {
      // Update target position
      if (this.currentGoal?.target && !this.currentGoal.target.isKilled()) {
        this.currentGoal.x = this.currentGoal.target.pos.x;
        this.currentGoal.y = this.currentGoal.target.pos.y;
      }
    }

    // Execute goal
    t0 = performance.now();
    const raw = this.executeGoal(this.currentGoal!, ctx, dt);
    perf.execute = performance.now() - t0;

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
        this.pathFollower.clearPath(); // force repath
        this.goalAge = 999;
      }
    } else {
      this.stuckTimer = 0;
    }

    // Update status label above player
    this.updateStatusLabel();

    this.renderDebugHUD();
    this._lastPerfBreakdown = perf;
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
      build: 'Building',
      pickup: 'Picking up',
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

    // Build goal: if bot is near the spot but can't afford → switch to gather
    if (this.currentGoal.type === 'build' && _ctx.affordableBuildSpot === null) {
      return true; // can't afford anymore — go gather
    }

    // Reactive goals can interrupt, but current goal must have run for at least 0.3s
    // This prevents rapid cycling between flee/dodge/kill every frame
    if (BotAI.REACTIVE_GOALS.has(candidate.type) && candidate.type !== this.currentGoal.type) {
      if (this.goalAge < 0.3) return false; // let current action play out briefly
      if (candidate.type === 'kill') {
        const lowPriority = ['idle', 'chop', 'mine', 'feed', 'gather'];
        if (lowPriority.includes(this.currentGoal.type)) return true;
      } else {
        return true;
      }
    }

    if (candidate.type === this.currentGoal.type &&
        candidate.target === this.currentGoal.target) return false;

    // Chop/mine: commit to target until it's destroyed — don't switch trees
    if ((this.currentGoal.type === 'chop' || this.currentGoal.type === 'mine') &&
        this.currentGoal.target && !this.currentGoal.target.isKilled()) {
      return false;
    }

    if (this.goalAge < this.goalMinTime && this.currentGoal.type !== 'idle') return false;

    return candidate.type !== this.currentGoal.type ||
           candidate.target !== this.currentGoal.target;
  }

  /** Move toward target using shared PathFollower */
  private moveToWithPathfinding(tx: number, ty: number): { x: number; y: number } {
    return this.pathFollower.moveTo(this.player.pos.x, this.player.pos.y, tx, ty);
  }

  // ============================================================
  // DECISION TREE
  // ============================================================
  private buildDecisionTree(): TreeNode {
    return {
      name: 'SURVIVE & PROGRESS',
      check: () => true,
      children: [
        // === SURVIVAL — only flee when critically low HP or surrounded ===
        {
          name: 'SURVIVE',
          check: () => true,
          children: [
            {
              name: 'Critical HP Retreat',
              check: (ctx) => {
                // Retreat at < 25% HP, stop retreating at > 50%
                if (ctx.hpRatio < 0.25) this.retreating = true;
                if (ctx.hpRatio > 0.5) this.retreating = false;
                if (!this.retreating || ctx.distToFire <= 60) return false;
                // But if we can win (1 weak enemy left), keep fighting
                if (ctx.nearEnemyCount <= 1 && ctx.nearestEnemy) {
                  const eHp = (ctx.nearestEnemy.get(HealthComponent) as HealthComponent | null)?.hp ?? 999;
                  if (eHp < 30) return false; // enemy almost dead — finish it
                }
                return true;
              },
              goal: (ctx) => ({ type: 'flee', x: ctx.bx, y: ctx.by, _treePath: 'Critical HP Retreat' }),
            },
            {
              name: 'Dodge Projectile',
              check: (ctx) => {
                if (!ctx.evasion) return false;
                // Dodge earlier — urgency > 1.8 triggers full dodge
                return ctx.evasion.urgency > 1.8;
              },
              goal: (ctx) => ({ type: 'dodge', evasion: ctx.evasion!, _treePath: 'Dodge Projectile' }),
            },
            {
              name: 'Surrounded',
              check: (ctx) => ctx.nearEnemyCount >= 3 && ctx.hpRatio < 0.5,
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
        // === KITE — only when surrounded by 2+ melee enemies ===
        {
          name: 'Kite (surrounded)',
          check: (ctx) => {
            if (!ctx.nearestEnemy || ctx.nearestEnemyDist > this.KITE_DISTANCE) return false;
            if (ctx.nearEnemyCount < 2) return false; // 1v1 → stand and fight
            const ai = ctx.nearestEnemy.get(AIBrainComponent) as AIBrainComponent | null;
            return ai !== null && !ai.isRanged;
          },
          goal: (ctx) => ({
            type: 'kite', target: ctx.nearestEnemy!,
            x: ctx.nearestEnemy!.pos.x, y: ctx.nearestEnemy!.pos.y,
            _treePath: 'Kite (surrounded)',
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
        // === HAS WOOD → FEED FIRE (maintenance) ===
        {
          name: 'Feed Fire',
          check: (ctx) => ctx.resources.wood >= 1 && ctx.bonfire !== null && ctx.fuelRatio < 0.85,
          goal: (ctx) => ({ type: 'feed', x: ctx.bx, y: ctx.by, _treePath: 'Feed Fire' }),
        },
        // === CLEAR BUILD SPOT — destroy resource blocking a build spot ===
        {
          name: 'Clear Build Spot',
          check: (ctx) => ctx.blockerResource !== null && ctx.hpRatio >= 0.4,
          goal: (ctx) => ({
            type: 'chop', target: ctx.blockerResource!,
            x: ctx.blockerResource!.pos.x, y: ctx.blockerResource!.pos.y,
            _treePath: `Clear spot (${ctx.blockerResource!.entityType})`,
          }),
        },
        // === BUILD — higher priority than leveling up ===
        {
          name: 'Build',
          check: (ctx) => ctx.affordableBuildSpot !== null,
          goal: (ctx) => ({
            type: 'build',
            x: ctx.affordableBuildSpot!.wx, y: ctx.affordableBuildSpot!.wy,
            _treePath: `Build ${ctx.affordableBuildSpot!.type}`,
          }),
        },
        // === GATHER FOR BUILDING — pick up drops first, then chop/mine ===
        {
          name: 'Gather for Build',
          check: (ctx) => {
            if (ctx.hpRatio < 0.4) return false;
            return ctx.gatherBuildSpot !== null && ctx.gatherNeed !== null;
          },
          children: [
            {
              name: 'Pick Up for Build',
              check: (ctx) => ctx.nearestNeededDrop !== null && ctx.nearestNeededDropDist < 200,
              goal: (ctx) => ({
                type: 'pickup',
                x: ctx.nearestNeededDrop!.x, y: ctx.nearestNeededDrop!.y,
                _treePath: `Pick up ${ctx.nearestNeededDrop!.type} for ${ctx.gatherBuildSpot!.type}`,
              }),
            },
            {
              name: 'Chop/Mine for Build',
              check: (ctx) => {
                // Find a resource of the NEEDED type — if none exists, skip (can't gather)
                const need = ctx.gatherNeed!.type;
                const resMap: Record<string, string> = { wood: 'wood', stone: 'stone', metal: 'metal' };
                const rType = resMap[need];
                if (!rType) return false;
                return ctx.bestResourceByType[rType] !== undefined;
              },
              goal: (ctx) => {
                const need = ctx.gatherNeed!.type;
                const r = ctx.bestResourceByType[need];
                return {
                  type: 'chop', target: r.entity,
                  x: r.entity.pos.x, y: r.entity.pos.y,
                  _treePath: `Mine ${need} for ${ctx.gatherBuildSpot!.type} (need ${ctx.gatherNeed!.amount})`,
                };
              },
            },
          ],
        },
        // === LEVEL UP FIRE — after buildings are built ===
        {
          name: 'Level Up Fire',
          check: (ctx) => ctx.canLevelUp && ctx.hpRatio >= 0.4,
          children: [
            {
              name: 'Feed to Level Up',
              check: (ctx) => ctx.resources.wood >= 1 && ctx.bonfire !== null,
              goal: (ctx) => ({ type: 'feed', x: ctx.bx, y: ctx.by,
                _treePath: `Feed to Lv.${this.gameState.campLevel + 1} (${ctx.woodForLevelUp} wood left)` }),
            },
            {
              name: 'Gather for Level Up',
              check: (ctx) => ctx.nearestResource !== null,
              goal: (ctx) => ({
                type: 'chop', target: ctx.nearestResource!,
                x: ctx.nearestResource!.pos.x, y: ctx.nearestResource!.pos.y,
                _treePath: `Gather for Lv.${this.gameState.campLevel + 1} (need ${ctx.woodForLevelUp} wood)`,
              }),
            },
          ],
        },
        // === PICK UP NEARBY DROPS ===
        {
          name: 'Pick Up Drops',
          check: (ctx) => ctx.nearestDrop !== null && ctx.nearestDropDist < 120,
          goal: (ctx) => ({
            type: 'pickup',
            x: ctx.nearestDrop!.x, y: ctx.nearestDrop!.y,
            _treePath: `Pick up ${ctx.nearestDrop!.type}`,
          }),
        },
        // === NEED WOOD → GATHER for fire ===
        {
          name: 'Gather Wood',
          check: (ctx) => {
            if (ctx.hpRatio < 0.4) return false;
            if (ctx.hasEnoughWood) return false;
            return ctx.bestResourceByType['wood'] !== undefined;
          },
          goal: (ctx) => {
            const r = ctx.bestResourceByType['wood'];
            return {
              type: 'chop', target: r.entity,
              x: r.entity.pos.x, y: r.entity.pos.y,
              _treePath: `Chop Wood (need ${ctx.woodNeeded})`,
            };
          },
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
    const enemies = this.getEnemies().filter(e => !e.isKilled() && !e.isDying);
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
      // Enemy near bonfire — defend camp (reachability checked after wave)
      if (bonfire) {
        const campDist = e.pos.distance(bonfire.pos);
        if (campDist < this.CAMP_DEFENSE_RANGE && campDist < enemyNearCampDist) {
          enemyNearCampDist = campDist;
          enemyNearCamp = e; // will be validated by wave below
        }
      }
    }

    // === HEAVY COMPUTATION — throttled to every 500ms ===
    this.reachableCacheTimer -= dt;
    const needsRecompute = this.reachableCacheTimer <= 0;
    if (needsRecompute) {
      this.reachableCacheTimer = 0.5;
      this.cachedReachable = this.grid.floodFill(p.pos.x, p.pos.y, 300);
    }
    const reachable = this.cachedReachable;

    // Wave distance helper — Infinity if unreachable
    const getWaveDist = (e: GameEntity): number => {
      const etx = Math.floor(e.pos.x / 32), ety = Math.floor(e.pos.y / 32);
      const selfDist = reachable.get(`${etx},${ety}`);
      if (selfDist !== undefined) return selfDist;
      let best = Infinity;
      for (let ddx = -1; ddx <= 1; ddx++)
        for (let ddy = -1; ddy <= 1; ddy++)
          if (ddx !== 0 || ddy !== 0) {
            if (this.grid.isBlocked(etx + ddx, ety + ddy)) continue;
            const nd = reachable.get(`${etx + ddx},${ety + ddy}`);
            if (nd !== undefined && nd < best) best = nd;
          }
      return best;
    };

    // Heavy enemy + resource scoring — only on recompute (every 500ms)
    if (needsRecompute) {
      // Validate enemyNearCamp
      if (enemyNearCamp && getWaveDist(enemyNearCamp) === Infinity) enemyNearCamp = null;

      // Best enemy — scored by wave distance
      let bestEnemy: GameEntity | null = null;
      let bestEnemyScore = -Infinity;
      for (const e of enemies) {
        const wd = getWaveDist(e);
        if (wd === Infinity) continue;
        const walkDist = wd * 32;
        if (walkDist > this.SIGHT_RANGE * 2) continue;
        const straightDist = p.pos.distance(e.pos);
        const selfDefense = straightDist < 60;
        const eHp = (e.get(HealthComponent) as HealthComponent | null)?.hp ?? 20;
        const score = (selfDefense ? 500 : 0) + (300 - walkDist) - eHp * 0.5;
        if (score > bestEnemyScore) { bestEnemyScore = score; bestEnemy = e; }
      }

      // Find projectile attacker (scan only enemies, not all scene actors)
      let projectileAttacker: GameEntity | null = null;
      // Simple: check if any ranged enemy is in range and has line of sight
      for (const e of enemies) {
        const ai = e.get(AIBrainComponent) as AIBrainComponent | null;
        if (!ai?.isRanged) continue;
        const d = p.pos.distance(e.pos);
        if (d < ai.attackRange * 1.2 && getWaveDist(e) !== Infinity) {
          projectileAttacker = e;
          break;
        }
      }

      this.cachedEnemyContext = { bestEnemy, enemyNearCamp, projectileAttacker };

      // Best resource per type — only from reachable tiles
      const bestResourceByType: Record<string, { entity: GameEntity; dist: number; score: number }> = {};
      let nearestResource: GameEntity | null = null;
      let nearestResourceDist = Infinity;
      let bestOverallScore = Infinity;

      for (const e of this.getEntities()) {
        if (e.isKilled()) continue;
        const rc = e.get(ResourceComponent) as ResourceComponent | null;
        if (!rc) continue;
        const rType = rc.resourceType;
        const etx = Math.floor(e.pos.x / 32), ety = Math.floor(e.pos.y / 32);
        let waveDist = Infinity;
        const selfDist = reachable.get(`${etx},${ety}`);
        if (selfDist !== undefined) { waveDist = selfDist; }
        else {
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              if (this.grid.isBlocked(etx + dx, ety + dy)) continue;
              const nd = reachable.get(`${etx + dx},${ety + dy}`);
              if (nd !== undefined && nd < waveDist) waveDist = nd;
            }
        }
        if (waveDist === Infinity) continue;
        const distToCamp = bonfire ? e.pos.distance(bonfire.pos) : waveDist * 32;
        if (distToCamp > this.GATHER_RANGE * 1.5) continue;
        const score = waveDist * 32 * 0.6 + distToCamp * 0.4;
        const prev = bestResourceByType[rType];
        if (!prev || score < prev.score) {
          bestResourceByType[rType] = { entity: e, dist: waveDist * 32, score };
        }
        if (score < bestOverallScore) {
          bestOverallScore = score;
          nearestResource = e;
          nearestResourceDist = waveDist * 32;
        }
      }
      this.cachedResources = { bestByType: bestResourceByType, nearest: nearestResource, nearestDist: nearestResourceDist };
    }

    // Use cached results
    const { bestEnemy, projectileAttacker } = this.cachedEnemyContext;
    enemyNearCamp = this.cachedEnemyContext.enemyNearCamp;
    // Validate cached enemies still alive
    if (bestEnemy?.isKilled()) this.cachedEnemyContext.bestEnemy = null;
    if (enemyNearCamp?.isKilled()) { enemyNearCamp = null; this.cachedEnemyContext.enemyNearCamp = null; }
    if (projectileAttacker?.isKilled()) this.cachedEnemyContext.projectileAttacker = null;

    const bestResourceByType = this.cachedResources.bestByType;
    let nearestResource = this.cachedResources.nearest;
    let nearestResourceDist = this.cachedResources.nearestDist;
    if (nearestResource?.isKilled()) { nearestResource = null; nearestResourceDist = Infinity; }

    // How much wood do we need for fuel?
    const fuelDeficit = this.gameState.bonfireMaxFuel * 0.8 - this.gameState.bonfireFuel;
    const woodNeeded = Math.max(0, Math.ceil(fuelDeficit / CONFIG.FUEL_PER_WOOD)) + 2;
    const hasEnoughWood = this.gameState.resources.wood >= woodNeeded;

    // Fire level-up: how much fuel (wood) needed to reach next level?
    const levels = CONFIG.FIRE_LEVELS;
    const cl = this.gameState.campLevel;
    const canLevelUp = cl < levels.length - 1;
    let woodForLevelUp = 0;
    if (canLevelUp) {
      const fuelNeeded = levels[cl + 1] - this.gameState.campFuelAdded;
      woodForLevelUp = Math.max(0, Math.ceil(fuelNeeded / CONFIG.FUEL_PER_WOOD));
    }

    // Drop analysis — find nearest drops, prioritize needed types
    let nearestDrop: BotDrop | null = null;
    let nearestDropDist = Infinity;
    let nearestNeededDrop: BotDrop | null = null;
    let nearestNeededDropDist = Infinity;
    // Figure out what resource types are needed (for building or fire)
    const neededTypes = new Set<string>();
    neededTypes.add('wood'); // always useful for fire
    for (const spot of this.gameState.availableBuildSpots) {
      for (const [r, amt] of Object.entries(spot.cost)) {
        if (((this.gameState.resources as any)[r] ?? 0) < (amt ?? 0)) neededTypes.add(r);
      }
    }
    for (const drop of this.gameState.drops) {
      const d = Math.hypot(p.pos.x - drop.x, p.pos.y - drop.y);
      if (d < nearestDropDist) { nearestDropDist = d; nearestDrop = drop; }
      if (neededTypes.has(drop.type) && d < nearestNeededDropDist) {
        nearestNeededDropDist = d; nearestNeededDrop = drop;
      }
    }

    // Find resource blocking a build spot
    let blockerResource: GameEntity | null = null;
    for (const bs of this.gameState.blockedBuildSpots) {
      // Find the nearest entity at this position that has a ResourceComponent
      let bestBlocker: GameEntity | null = null;
      let bestDist = 60; // search radius
      for (const e of this.getEntities()) {
        if (e.isKilled()) continue;
        if (!e.get(ResourceComponent)) continue;
        const d = Math.hypot(e.pos.x - bs.wx, e.pos.y - bs.wy);
        if (d < bestDist) { bestDist = d; bestBlocker = e; }
      }
      if (bestBlocker) { blockerResource = bestBlocker; break; }
    }

    // Build spot analysis — check INVENTORY ONLY (not drops on ground)
    const res = this.gameState.resources;
    let affordableBuildSpot: BotBuildSpot | null = null;
    let gatherBuildSpot: BotBuildSpot | null = null;
    let gatherNeed: { type: string; amount: number } | null = null;

    for (const spot of this.gameState.availableBuildSpots) {
      // Check affordability: INVENTORY ONLY (drops must be picked up first)
      let canAfford = true;
      let missingType = '';
      let missingAmt = 0;
      for (const [r, amt] of Object.entries(spot.cost)) {
        const have = (res as any)[r] ?? 0;
        if (have < (amt ?? 0)) {
          canAfford = false;
          if (!missingType) { missingType = r; missingAmt = (amt ?? 0) - have; }
        }
      }
      if (canAfford) {
        affordableBuildSpot = spot;
        break; // first affordable wins
      }
      if (!gatherBuildSpot && missingType) {
        gatherBuildSpot = spot;
        gatherNeed = { type: missingType, amount: missingAmt };
      }
    }

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
      nearestResource, nearestResourceDist, bestResourceByType,
      woodNeeded, hasEnoughWood,
      nearestNeededDrop, nearestNeededDropDist: nearestNeededDropDist,
      nearestDrop, nearestDropDist: nearestDropDist,
      canLevelUp, woodForLevelUp,
      blockerResource,
      affordableBuildSpot, gatherBuildSpot, gatherNeed,
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
    const PROJ_AVOID_R = 150; // detect projectiles earlier

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
        if (enemy.isKilled() || (enemy as any).isDying) break;
        const dist = ctx.player.pos.distance(enemy.pos);
        if (dist < this.ATTACK_REACH) {
          attack = true;
          // Face the enemy — tiny velocity toward them so sprite turns
          const toEnemy = this.dirTo(ctx.player.pos, enemy.pos.x, enemy.pos.y);
          vx = toEnemy.x * 0.01; vy = toEnemy.y * 0.01;
          if (ctx.evasion && ctx.evasion.urgency > 1.0) {
            vx = ctx.evasion.x;
            vy = ctx.evasion.y;
          }
        } else {
          // A* pathfind to enemy
          const dir = this.moveToWithPathfinding(enemy.pos.x, enemy.pos.y);
          if (this.pathFollower.unreachable) { this.goalAge = 999; break; }
          if (this.pathFollower.arrived && dist >= this.ATTACK_REACH) {
            // Walk directly — grid collision will slide along walls
            const toE = this.dirTo(ctx.player.pos, enemy.pos.x, enemy.pos.y);
            vx = toE.x; vy = toE.y;
            break;
          }
          vx = dir.x; vy = dir.y;
          // Evasion while approaching — weave to avoid projectiles
          if (ctx.evasion && ctx.evasion.urgency > 1.0) {
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

        // Attack only if within actual weapon reach (52px — same as GameScene damage check)
        const distToTarget = ctx.player.pos.distance(target.pos);
        if (distToTarget < 50) {
          attack = true;
          // Face the resource
          const toRes = this.dirTo(ctx.player.pos, target.pos.x, target.pos.y);
          vx = toRes.x * 0.01; vy = toRes.y * 0.01;
          break;
        }

        // Move toward target
        const dir = this.moveToWithPathfinding(target.pos.x, target.pos.y);

        // Unreachable — can't path to this resource, give up goal
        if (this.pathFollower.unreachable) {
          this.goalAge = 999;
          break;
        }

        if (this.pathFollower.arrived) {
          if (distToTarget < 50) {
            // Close enough — attack
            attack = true;
            const toRes = this.dirTo(ctx.player.pos, target.pos.x, target.pos.y);
            vx = toRes.x * 0.01; vy = toRes.y * 0.01;
          } else {
            // Arrived at approach tile but still too far — walk directly toward target
            // Grid collision will slide along walls
            const toRes = this.dirTo(ctx.player.pos, target.pos.x, target.pos.y);
            vx = toRes.x; vy = toRes.y;
          }
        } else {
          // Still moving toward target
          vx = dir.x; vy = dir.y;
          if (ctx.evasion && ctx.evasion.urgency > 0.5) {
            const blend = Math.min(ctx.evasion.urgency * 0.4, 0.6);
            vx = vx * (1 - blend) + ctx.evasion.x * blend;
            vy = vy * (1 - blend) + ctx.evasion.y * blend;
          }
        }
        break;
      }

      case 'pickup': {
        // Find the actual nearest drop (use current position, not cached goal coords)
        let closestDrop: { x: number; y: number } | null = null;
        let closestDropDist = Infinity;
        for (const d of this.gameState.drops) {
          const dd = Math.hypot(d.x - ctx.player.pos.x, d.y - ctx.player.pos.y);
          if (dd < closestDropDist) { closestDropDist = dd; closestDrop = d; }
        }
        if (!closestDrop) {
          this.goalAge = 999; // no drops left
          break;
        }
        // Walk directly to drop — no A* needed, drops are on walkable tiles
        const ddx = closestDrop.x - ctx.player.pos.x;
        const ddy = closestDrop.y - ctx.player.pos.y;
        const ddLen = Math.hypot(ddx, ddy);
        if (ddLen > 4) {
          vx = ddx / ddLen; vy = ddy / ddLen;
        }
        // Update goal coords for debug intent line
        goal.x = closestDrop.x; goal.y = closestDrop.y;
        break;
      }

      case 'build': {
        // Walk to build spot — building happens automatically in GameScene.runBuildSpots()
        const dist = ctx.player.pos.distance(ex.vec(goal.x!, goal.y!));
        if (dist < CONFIG.INTERACT_RADIUS) {
          // At spot — stand still, GameScene will auto-build
          vx = 0; vy = 0;
        } else {
          const dir = this.moveToWithPathfinding(goal.x!, goal.y!);
          vx = dir.x; vy = dir.y;
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
      const pf = this.pathFollower.getPath();
      if (pf) html += ` A*:${pf.length - this.pathFollower.getPathIdx()}wp`;
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
