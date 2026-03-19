import * as ex from 'excalibur';

/**
 * Shadow caster — draws the entity's own sprite as a black silhouette,
 * skewed and stretched away from the nearest light source.
 *
 * Part of the entity's graphics pipeline (onPreDraw) — auto-destroyed with entity.
 * Uses Graphic.tint = Black to make a solid black copy of the sprite.
 *
 * Original game formulas:
 * - Shadow length = min(1.2, 400 / (dist + 50))
 * - Alpha = max(0.08, 0.45 * edgeFade)
 * - Rotation: angle away from light + PI/2
 * - Scale: (entityScaleX, shadowLen * 0.45)
 */
export class ShadowCasterComponent extends ex.Component {
  public readonly type = 'ShadowCaster';

  private entityHeight: number;
  private installed = false;

  // Cached shadow params
  private shadowVisible = false;
  private shadowOffsetX = 0;
  private shadowOffsetY = 0;
  private shadowRotation = 0;
  private shadowScaleX = 1;
  private shadowScaleY = 0.45;
  private shadowAlpha = 0.35;

  /** Light sources — set by GameScene each frame */
  static lightSources: Array<{ x: number; y: number; radius: number }> = [];

  constructor(opts?: { entityHeight?: number }) {
    super();
    this.entityHeight = opts?.entityHeight ?? 24;
  }

  onAdd(owner: ex.Entity): void {
    this.installDraw(owner as ex.Actor);
  }

  private installDraw(actor: ex.Actor): void {
    if (this.installed) return;
    const origOnPreDraw = actor.graphics.onPreDraw;
    const self = this;

    actor.graphics.onPreDraw = (ctx: ex.ExcaliburGraphicsContext, elapsed: number) => {
      if (origOnPreDraw) origOnPreDraw(ctx, elapsed);
      if (!self.shadowVisible) return;

      // Get current graphic from entity
      const graphic = actor.graphics.current;
      if (!graphic) return;

      ctx.save();

      // Move to feet position + shadow offset
      ctx.translate(self.shadowOffsetX, self.shadowOffsetY);

      // Rotate away from light
      ctx.rotate(self.shadowRotation);

      // Scale: X = entity width, Y = shadow stretch (squished for ground)
      ctx.scale(self.shadowScaleX, self.shadowScaleY);

      // Set opacity for shadow
      ctx.opacity = self.shadowAlpha;

      // Draw the same graphic but tinted black
      // We temporarily set tint, draw, then restore
      const origTint = graphic.tint;
      graphic.tint = ex.Color.Black;
      graphic.draw(ctx, -graphic.width / 2, -graphic.height);
      graphic.tint = origTint ?? ex.Color.White;

      ctx.restore();
    };
    this.installed = true;
  }

  onPreUpdate(_engine: ex.Engine, _deltaMs: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor) return;
    if (!this.installed) this.installDraw(actor);

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
      this.shadowVisible = false;
      return;
    }

    this.shadowVisible = true;

    // Direction away from light
    const dx = actor.pos.x - bestLight.x;
    const dy = actor.pos.y - bestLight.y;
    const angle = Math.atan2(dy, dx);

    // Shadow length (original formula)
    const shadowLen = Math.min(1.2, 400 / (bestDist + 50));

    // Position: at entity feet
    this.shadowOffsetX = 0;
    this.shadowOffsetY = this.entityHeight * 0.35;

    // Rotation: point away from light (same as original: angle + PI/2)
    this.shadowRotation = angle + Math.PI * 0.5;

    // Scale: X = entity scale, Y = shadow stretch
    this.shadowScaleX = actor.scale?.x ?? 1;
    this.shadowScaleY = shadowLen * 0.45;

    // Alpha: 45% at center, 8% at edge
    const edgeFade = 1 - (bestDist / bestLight.radius);
    this.shadowAlpha = Math.max(0.08, 0.45 * edgeFade);
  }
}
