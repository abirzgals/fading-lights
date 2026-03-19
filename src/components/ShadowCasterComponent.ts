import * as ex from 'excalibur';

/**
 * Shadow caster — renders an elliptical dark shadow below an entity,
 * stretched away from the nearest light source (bonfire).
 *
 * Uses original game formulas:
 * - Shadow length = min(1.2, 400 / (dist + 50))
 * - Alpha = max(0.08, 0.45 * edgeFade)
 * - Light wobble synced with fog shader
 */
export class ShadowCasterComponent extends ex.Component {
  public readonly type = 'ShadowCaster';

  private shadowActor: ex.Actor | null = null;
  private entityWidth: number;
  private entityHeight: number;

  /** Light sources — set by GameScene each frame (with wobble) */
  static lightSources: Array<{ x: number; y: number; radius: number }> = [];

  constructor(opts?: { entityWidth?: number; entityHeight?: number }) {
    super();
    this.entityWidth = opts?.entityWidth ?? 16;
    this.entityHeight = opts?.entityHeight ?? 24;
  }

  onAdd(owner: ex.Entity): void {
    const actor = owner as ex.Actor;
    if (actor.scene) this.createShadow(actor);
  }

  private createShadow(actor: ex.Actor): void {
    if (this.shadowActor) return;

    this.shadowActor = new ex.Actor({
      pos: actor.pos.clone(),
      anchor: ex.vec(0.5, 0.5),
    });

    // Ellipse shadow: circle scaled to oval
    // Width = entity width, squished to ~30% height for ground perspective
    this.shadowActor.graphics.use(new ex.Circle({
      radius: this.entityWidth * 0.5,
      color: ex.Color.fromRGB(0, 0, 0, 0.45),
    }));

    this.shadowActor.z = -1;
    actor.scene?.add(this.shadowActor);
  }

  onRemove(): void {
    if (this.shadowActor) {
      this.shadowActor.kill();
      this.shadowActor = null;
    }
  }

  onPreUpdate(_engine: ex.Engine, _deltaMs: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor) return;
    if (!this.shadowActor) {
      if (actor.scene) this.createShadow(actor);
      return;
    }

    // Find nearest light source
    const lights = ShadowCasterComponent.lightSources;
    let bestLight: { x: number; y: number; radius: number } | null = null;
    let bestDist = Infinity;

    for (const l of lights) {
      const d = Math.hypot(actor.pos.x - l.x, actor.pos.y - l.y);
      if (d < l.radius && d < bestDist) {
        bestDist = d;
        bestLight = l;
      }
    }

    if (!bestLight || bestDist < 3) {
      this.shadowActor.graphics.opacity = 0;
      return;
    }

    // Shadow direction — away from light
    const dx = actor.pos.x - bestLight.x;
    const dy = actor.pos.y - bestLight.y;
    const angle = Math.atan2(dy, dx);

    // Shadow length (original formula)
    const shadowLen = Math.min(1.2, 400 / (bestDist + 50));

    // Feet position (ground contact point)
    const feetY = actor.pos.y + this.entityHeight * 0.3;

    // Shadow offset from feet in light-away direction
    const offsetDist = shadowLen * this.entityHeight * 0.3;
    const shadowX = actor.pos.x + Math.cos(angle) * offsetDist;
    const shadowY = feetY + Math.sin(angle) * offsetDist * 0.5; // flatten Y for ground perspective

    this.shadowActor.pos = ex.vec(shadowX, shadowY);

    // Ellipse scale: wider along shadow direction, squished for ground
    // Base ellipse is a circle — scale X for width, Y for ground flatness
    const stretchX = 1.0 + shadowLen * 0.4;    // stretch along shadow dir
    const stretchY = 0.3 + shadowLen * 0.15;    // ground perspective (flat)
    this.shadowActor.scale = ex.vec(stretchX, stretchY);

    // Rotate to point away from light
    this.shadowActor.rotation = angle;

    // Alpha: darker shadows, same edge-fade as original
    const edgeFade = 1 - (bestDist / bestLight.radius);
    this.shadowActor.graphics.opacity = Math.max(0.08, 0.45 * edgeFade);

    // Z: just below parent
    this.shadowActor.z = actor.z - 0.1;
  }
}
