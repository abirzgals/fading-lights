import * as ex from 'excalibur';
import { HealthComponent } from './HealthComponent';

/**
 * Melee attack with damage frame — damage is checked at a specific animation frame.
 * If the target moved away by the damage frame, it's a miss.
 */
export class MeleeAttackComponent extends ex.Component {
  public readonly type = 'MeleeAttack';

  public damage: number;
  public range: number;
  public cooldownMs: number;
  public damageFrame: number;     // frame index when damage is applied
  public totalFrames: number;     // total animation frames
  public arcDeg: number;          // attack cone in degrees

  private cooldownTimer: number = 0;
  private attacking: boolean = false;
  private attackFrame: number = 0;
  private attackTarget: ex.Actor | null = null;
  private frameDuration: number;

  constructor(opts: {
    damage: number;
    range: number;
    cooldownMs?: number;
    damageFrame?: number;
    totalFrames?: number;
    arcDeg?: number;
  }) {
    super();
    this.damage = opts.damage;
    this.range = opts.range;
    this.cooldownMs = opts.cooldownMs ?? 1000;
    this.damageFrame = opts.damageFrame ?? 3;
    this.totalFrames = opts.totalFrames ?? 6;
    this.arcDeg = opts.arcDeg ?? 120;
    this.frameDuration = this.cooldownMs / this.totalFrames;
  }

  get isAttacking(): boolean { return this.attacking; }
  get canAttack(): boolean { return this.cooldownTimer <= 0 && !this.attacking; }

  /** Start an attack aimed at a target */
  startAttack(target: ex.Actor): void {
    if (!this.canAttack) return;
    this.attacking = true;
    this.attackFrame = 0;
    this.attackTarget = target;
    this.cooldownTimer = this.cooldownMs;
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= deltaMs;
    }

    if (this.attacking) {
      this.attackFrame += deltaMs / this.frameDuration;

      // Damage frame reached — check if target is still in range
      if (this.attackFrame >= this.damageFrame && this.attackTarget) {
        const actor = this.owner as ex.Actor;
        if (actor && this.attackTarget) {
          const dist = actor.pos.distance(this.attackTarget.pos);
          if (dist <= this.range) {
            // HIT — target is still in range at the damage frame
            const hp = this.attackTarget.get(HealthComponent) as HealthComponent | null;
            if (hp) {
              hp.damage(this.damage);
            }
          }
          // Either way, damage check is done
          this.attackTarget = null;
        }
      }

      // Animation complete
      if (this.attackFrame >= this.totalFrames) {
        this.attacking = false;
        this.attackTarget = null;
      }
    }
  }
}
