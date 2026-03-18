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

    if (ismagic) {
      // Magic orb — larger, glowing purple with inner bright core
      proj.graphics.use(new ex.Circle({
        radius: 5,
        color: ex.Color.fromHex('#9933DD'),
      }));
      // Inner bright core
      const core = new ex.Actor({
        pos: actor.pos.clone(), anchor: ex.vec(0.5, 0.5),
      });
      core.graphics.use(new ex.Circle({ radius: 2, color: ex.Color.fromHex('#DDAAFF') }));
      core.z = 101;
      scene.add(core);
      // Core follows projectile
      proj.on('preupdate', () => {
        core.pos = proj.pos.clone();
        if (proj.isKilled()) core.kill();
      });
    } else {
      // Arrow — elongated rectangle that rotates with direction
      proj.graphics.use(new ex.Rectangle({
        width: 8, height: 2,
        color: ex.Color.fromHex('#DDBB44'),
      }));
      proj.rotation = Math.atan2(dir.y, dir.x);
    }

    proj.vel = dir.scale(this.projectileSpeed);
    proj.z = 100;

    // Trail particles
    const projType = this.projectileType;
    let trailTimer = 0;
    proj.on('preupdate', (_evt: any) => {
      if (!proj.scene) return;
      trailTimer += 16; // approximate frame time
      if (trailTimer > (projType === 'magic' ? 30 : 50)) {
        trailTimer = 0;
        const colors = projType === 'magic'
          ? ['#AA44FF', '#CC66FF', '#8822DD', '#DD88FF']
          : ['#CCAA44', '#AA8833'];
        const trail = new ex.Actor({
          pos: proj.pos.clone(), anchor: ex.vec(0.5, 0.5),
        });
        const sz = projType === 'magic' ? 2 + Math.random() * 3 : 1;
        trail.graphics.use(new ex.Circle({ radius: sz,
          color: ex.Color.fromHex(colors[Math.floor(Math.random() * colors.length)]) }));
        trail.graphics.opacity = 0.6;
        trail.z = proj.z - 0.1;
        trail.vel = ex.vec((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15);
        trail.actions.fade(0, projType === 'magic' ? 250 : 120).die();
        proj.scene.add(trail);

        // Magic sparks
        if (projType === 'magic' && Math.random() < 0.4) {
          const spark = new ex.Actor({
            pos: proj.pos.add(ex.vec((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10)),
            anchor: ex.vec(0.5, 0.5),
          });
          spark.graphics.use(new ex.Rectangle({ width: 1, height: 1, color: ex.Color.fromHex('#FFAAFF') }));
          spark.z = proj.z + 0.1;
          spark.vel = ex.vec((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50);
          spark.actions.fade(0, 100).die();
          proj.scene.add(spark);
        }
      }
    });

    // Impact explosion
    const spawnImpact = (pos: ex.Vector) => {
      if (!proj.scene) return;
      const impactColors = ismagic
        ? ['#AA44FF', '#CC66FF', '#FF88FF', '#DDAAFF']
        : ['#FFAA44', '#FFDD44', '#FF8800'];
      for (let i = 0; i < (ismagic ? 8 : 4); i++) {
        const p = new ex.Actor({
          pos: pos.add(ex.vec((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)),
          anchor: ex.vec(0.5, 0.5),
        });
        const sz = ismagic ? 2 + Math.random() * 4 : 1 + Math.random() * 2;
        p.graphics.use(new ex.Circle({ radius: sz,
          color: ex.Color.fromHex(impactColors[Math.floor(Math.random() * impactColors.length)]) }));
        p.z = 102;
        p.vel = ex.vec((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
        p.actions.fade(0, 200 + Math.random() * 200).die();
        proj.scene.add(p);
      }
    };

    // Hit detection on each frame
    const maxDist = this.range * 1.5;
    const startPos = actor.pos.clone();
    proj.on('preupdate', () => {
      // Check hit on target
      if (!target.isKilled() && proj.pos.distance(target.pos) < 16) {
        const hp = target.get(HealthComponent) as HealthComponent | null;
        if (hp) hp.damage(damage);
        spawnImpact(proj.pos);
        proj.kill();
        return;
      }
      // Max range — fizzle out
      if (proj.pos.distance(startPos) > maxDist) {
        spawnImpact(proj.pos);
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
