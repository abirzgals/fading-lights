import * as ex from 'excalibur';
import { EnemyType } from '../types';

export type AIState = 'IDLE' | 'WANDER' | 'CHASE' | 'ATTACK' | 'FLEE' | 'MARCH' | 'ORBIT';

/**
 * Enemy AI state machine — handles all enemy behavior.
 * Replaces the inline AI logic from the original game.js updateEnemies().
 */
export class AIBrainComponent extends ex.Component {
  public state: AIState = 'WANDER';
  public enemyType: EnemyType;
  public speed: number;
  public damage: number;
  public isRanged: boolean;
  public attackRange: number;
  public attackCooldown: number;
  public sightRange: number = 350;

  // Internal timers
  public wanderAngle: number = Math.random() * Math.PI * 2;
  public wanderTimer: number = 0;
  public attackTimer: number = 0;
  public aggroFlag: boolean = false;

  constructor(type: EnemyType, speed: number, damage: number, opts?: {
    ranged?: boolean;
    attackRange?: number;
    attackCooldown?: number;
  }) {
    super();
    this.enemyType = type;
    this.speed = speed;
    this.damage = damage;
    this.isRanged = opts?.ranged ?? false;
    this.attackRange = opts?.attackRange ?? 30;
    this.attackCooldown = opts?.attackCooldown ?? 1000;
  }
}
