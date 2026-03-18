import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { HealthComponent } from './HealthComponent';

/**
 * Ranged attack — fires projectiles at targets.
 * Projectile travels and checks hit on arrival, not on fire.
 */
export class RangedAttackComponent extends ex.Component {
  public readonly type = 'RangedAttack';

  public damage: number;
  public range: number;
  public cooldownMs: number;
  public projectileSpeed: number;
  public projectileType: 'arrow' | 'magic';
  public splashRadius: number;

  private cooldownTimer: number = 0;

  constructor(opts: {
    damage: number;
    range: number;
    cooldownMs?: number;
    projectileSpeed?: number;
    projectileType?: 'arrow' | 'magic';
    splashRadius?: number;
  }) {
    super();
    this.damage = opts.damage;
    this.range = opts.range;
    this.cooldownMs = opts.cooldownMs ?? 2000;
    this.projectileSpeed = opts.projectileSpeed ?? 200;
    this.projectileType = opts.projectileType ?? 'arrow';
    this.splashRadius = opts.splashRadius ?? 0;
  }

  get canFire(): boolean { return this.cooldownTimer <= 0; }

  /** Fire a projectile at the target's current position */
  fire(target: ex.Actor, scene: ex.Scene): void {
    if (!this.canFire) return;
    this.cooldownTimer = this.cooldownMs;

    const actor = this.owner as ex.Actor;
    if (!actor) return;

    const dir = target.pos.sub(actor.pos).normalize();
    const ismagic = this.projectileType === 'magic';
    const damage = this.damage;

    const proj = new GameEntity({
      pos: actor.pos.clone(), anchor: ex.vec(0.5, 0.5),
    });
    proj.entityType = 'projectile';
    proj.graphics.use(new ex.Circle({
      radius: ismagic ? 4 : 2,
      color: ismagic ? ex.Color.fromHex('#AA44FF') : ex.Color.fromHex('#CCAA44'),
    }));
    proj.vel = dir.scale(this.projectileSpeed);
    proj.z = 100;

    // Hit detection on each frame
    const maxDist = this.range * 1.5;
    const startPos = actor.pos.clone();
    proj.on('preupdate', () => {
      // Check hit on target
      if (!target.isKilled() && proj.pos.distance(target.pos) < 16) {
        const hp = target.get(HealthComponent) as HealthComponent | null;
        if (hp) hp.damage(damage);
        proj.kill();
        return;
      }
      // Max range
      if (proj.pos.distance(startPos) > maxDist) {
        proj.kill();
      }
    });

    scene.add(proj);
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= deltaMs;
    }
  }
}
