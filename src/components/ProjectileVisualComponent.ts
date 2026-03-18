import * as ex from 'excalibur';

/**
 * Visual effects for projectiles — trails, sparks, glow.
 * Attached to projectile GameEntity to make them look awesome.
 */
export class ProjectileVisualComponent {
  private type: 'arrow' | 'magic';
  private trailTimer: number = 0;
  private sparkTimer: number = 0;

  constructor(type: 'arrow' | 'magic') {
    this.type = type;
  }

  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    const actor = (this as any).owner as ex.Actor;
    if (!actor || !actor.scene) return;

    this.trailTimer += deltaMs;
    this.sparkTimer += deltaMs;

    if (this.type === 'magic') {
      this.updateMagicVisuals(actor, deltaMs);
    } else {
      this.updateArrowVisuals(actor, deltaMs);
    }
  }

  private updateMagicVisuals(actor: ex.Actor, _deltaMs: number): void {
    const scene = actor.scene!;

    // Trailing glow particles every 30ms
    if (this.trailTimer > 30) {
      this.trailTimer = 0;
      const colors = ['#AA44FF', '#CC66FF', '#8822DD', '#DD88FF'];
      const trail = new ex.Actor({
        pos: actor.pos.clone(),
        anchor: ex.vec(0.5, 0.5),
      });
      const size = 2 + Math.random() * 3;
      trail.graphics.use(new ex.Circle({
        radius: size,
        color: ex.Color.fromHex(colors[Math.floor(Math.random() * colors.length)]),
      }));
      trail.graphics.opacity = 0.7;
      trail.z = actor.z - 0.1;
      // Slight random drift
      trail.vel = ex.vec((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      trail.actions.fade(0, 200 + Math.random() * 200).die();
      scene.add(trail);
    }

    // Sparks every 80ms
    if (this.sparkTimer > 80) {
      this.sparkTimer = 0;
      const spark = new ex.Actor({
        pos: actor.pos.add(ex.vec((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8)),
        anchor: ex.vec(0.5, 0.5),
      });
      spark.graphics.use(new ex.Rectangle({
        width: 1, height: 1,
        color: ex.Color.fromHex('#FFAAFF'),
      }));
      spark.z = actor.z + 0.1;
      spark.vel = ex.vec((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
      spark.actions.fade(0, 100 + Math.random() * 150).die();
      scene.add(spark);
    }

    // Pulsating glow on the projectile itself
    const pulse = 0.6 + Math.sin(performance.now() * 0.01) * 0.3;
    actor.graphics.opacity = pulse;
  }

  private updateArrowVisuals(actor: ex.Actor, _deltaMs: number): void {
    const scene = actor.scene!;

    // Rotation to face movement direction
    if (actor.vel.squareDistance() > 1) {
      actor.rotation = Math.atan2(actor.vel.y, actor.vel.x);
    }

    // Subtle trail every 50ms
    if (this.trailTimer > 50) {
      this.trailTimer = 0;
      const trail = new ex.Actor({
        pos: actor.pos.clone(),
        anchor: ex.vec(0.5, 0.5),
      });
      trail.graphics.use(new ex.Rectangle({
        width: 3, height: 1,
        color: ex.Color.fromHex('#CCAA44'),
      }));
      trail.graphics.opacity = 0.4;
      trail.z = actor.z - 0.1;
      trail.rotation = actor.rotation;
      trail.actions.fade(0, 150).die();
      scene.add(trail);
    }
  }
}
