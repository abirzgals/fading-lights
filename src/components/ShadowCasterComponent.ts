import * as ex from 'excalibur';

/**
 * Shadow caster — renders a dark silhouette below an entity,
 * stretched away from the nearest light source.
 *
 * Matches the original game's shadow formulas:
 * - Shadow length = min(1.2, 400 / (dist + 50))
 * - Alpha = max(0.05, 0.35 * edgeFade)
 * - Rotated away from light, anchored at entity's feet
 * - Size matches entity's sprite dimensions
 */
export class ShadowCasterComponent extends ex.Component {
  public readonly type = 'ShadowCaster';

  private shadowActor: ex.Actor | null = null;
  private entityHeight: number;
  private shadowGraphic: ex.Rectangle | null = null;

  /** Light sources — set by GameScene each frame */
  static lightSources: Array<{ x: number; y: number; radius: number }> = [];

  constructor(opts?: { entityHeight?: number }) {
    super();
    this.entityHeight = opts?.entityHeight ?? 24;
  }

  onAdd(owner: ex.Entity): void {
    const actor = owner as ex.Actor;
    if (actor.scene) this.createShadow(actor);
  }

  private createShadow(actor: ex.Actor): void {
    if (this.shadowActor) return;

    // Get entity's current graphic dimensions
    const g = actor.graphics.current;
    const w = g ? g.width : 16;
    const h = g ? g.height : 24;

    this.shadowActor = new ex.Actor({
      pos: actor.pos.clone(),
      anchor: ex.vec(0.5, 0.9), // bottom-center — shadow grows from feet upward
    });

    // Dark rectangle matching entity width, squished vertically
    this.shadowGraphic = new ex.Rectangle({
      width: w * 0.9,
      height: h * 0.7,
      color: ex.Color.fromRGB(0, 0, 0, 0.35),
    });
    this.shadowActor.graphics.use(this.shadowGraphic);
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

    // Update shadow size if entity graphic changed
    const g = actor.graphics.current;
    if (g && this.shadowGraphic) {
      const w = g.width * 0.9;
      const h = g.height * 0.7;
      if (Math.abs(w - this.shadowGraphic.width) > 2 || Math.abs(h - this.shadowGraphic.height) > 2) {
        this.shadowGraphic = new ex.Rectangle({
          width: w, height: h,
          color: ex.Color.fromRGB(0, 0, 0, 0.35),
        });
        this.shadowActor.graphics.use(this.shadowGraphic);
      }
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

    // Shadow length: closer = longer (exact same formula as original game)
    const shadowLen = Math.min(1.2, 400 / (bestDist + 50));

    // Feet position (ground contact)
    const feetY = actor.pos.y + this.entityHeight * 0.35;

    // Position at feet
    this.shadowActor.pos = ex.vec(actor.pos.x, feetY);

    // Rotation: point away from light (+90° for anchor orientation)
    this.shadowActor.rotation = angle + Math.PI * 0.5;

    // Scale: X = entity width, Y = shadow stretch
    const baseScale = actor.scale?.x ?? 1;
    this.shadowActor.scale = ex.vec(baseScale, shadowLen * 0.5);

    // Alpha: 35% at light center, fading to 5% at edge (exact same as original)
    const edgeFade = 1 - (bestDist / bestLight.radius);
    this.shadowActor.graphics.opacity = Math.max(0.05, 0.35 * edgeFade);

    // Z: just below parent
    this.shadowActor.z = actor.z - 0.1;
  }
}
