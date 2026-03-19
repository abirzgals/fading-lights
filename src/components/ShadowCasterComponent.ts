import * as ex from 'excalibur';

/**
 * Shadow caster — renders an ellipse shadow below an entity,
 * stretched away from the nearest light source (bonfire).
 *
 * Original game used texture-based shadows; we use simple dark ellipses
 * which are cheaper and look good at small pixel-art scale.
 */
export class ShadowCasterComponent extends ex.Component {
  public readonly type = 'ShadowCaster';

  private shadowActor: ex.Actor | null = null;
  private baseWidth: number;
  private baseHeight: number;

  /** Light sources — set by GameScene each frame */
  static lightSources: Array<{ x: number; y: number; radius: number }> = [];

  constructor(opts?: { width?: number; height?: number }) {
    super();
    this.baseWidth = opts?.width ?? 16;
    this.baseHeight = opts?.height ?? 6;
  }

  onAdd(owner: ex.Entity): void {
    const actor = owner as ex.Actor;
    if (!actor.scene) return;
    this.createShadow(actor);
  }

  private createShadow(actor: ex.Actor): void {
    if (this.shadowActor) return;
    this.shadowActor = new ex.Actor({
      pos: actor.pos.clone(),
      anchor: ex.vec(0.5, 0.5),
    });
    // Use a circle scaled to ellipse shape (Excalibur has no Ellipse graphic)
    this.shadowActor.graphics.use(new ex.Circle({
      radius: this.baseWidth / 2,
      color: ex.Color.fromRGB(0, 0, 0, 0.3),
    }));
    this.shadowActor.scale = ex.vec(1, this.baseHeight / this.baseWidth);
    this.shadowActor.z = -1; // below everything
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
    if (!actor || !this.shadowActor) {
      // Lazy init if scene wasn't available in onAdd
      if (actor?.scene && !this.shadowActor) this.createShadow(actor);
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
      // No light or too close — hide shadow
      this.shadowActor.graphics.opacity = 0;
      return;
    }

    // Direction away from light
    const dx = actor.pos.x - bestLight.x;
    const dy = actor.pos.y - bestLight.y;
    const angle = Math.atan2(dy, dx);

    // Shadow length scales inversely with distance (closer = longer shadow)
    const shadowLen = Math.min(1.2, 400 / (bestDist + 50));

    // Position at entity's feet, offset in shadow direction
    const feetY = actor.pos.y + this.baseHeight * 0.5;
    const offsetX = Math.cos(angle) * shadowLen * 8;
    const offsetY = Math.sin(angle) * shadowLen * 4;

    this.shadowActor.pos = ex.vec(actor.pos.x + offsetX, feetY + offsetY);
    this.shadowActor.rotation = angle;

    // Scale: stretch along shadow direction
    this.shadowActor.scale = ex.vec(1.0 + shadowLen * 0.3, shadowLen * 0.5 + 0.3);

    // Opacity fades at light edge
    const edgeFade = 1 - (bestDist / bestLight.radius);
    this.shadowActor.graphics.opacity = Math.max(0.05, 0.3 * edgeFade);

    // Z below parent
    this.shadowActor.z = actor.z - 0.5;
  }
}
