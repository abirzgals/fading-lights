import * as ex from 'excalibur';

/**
 * Shadow caster — draws the entity's own sprite as a black silhouette,
 * stretched away from the nearest light source.
 *
 * Part of the entity's graphics pipeline (onPreDraw) — auto-destroyed with entity.
 *
 * @param feetOffset — Y offset from entity pos to ground contact point.
 *   0 = pos IS the ground (e.g. tree with anchor 0.8)
 *   8 = ground is 8px below pos (e.g. character with anchor 0.5)
 */
export class ShadowCasterComponent extends ex.Component {
  public readonly type = 'ShadowCaster';

  private feetOffset: number;
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

  constructor(opts?: { feetOffset?: number }) {
    super();
    // feetOffset: how many pixels below entity.pos.y is the ground
    this.feetOffset = opts?.feetOffset ?? 8;
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

      const graphic = actor.graphics.current;
      if (!graphic) return;

      ctx.save();

      // Translate to feet position (ground contact point)
      ctx.translate(self.shadowOffsetX, self.shadowOffsetY);

      // Rotate away from light
      ctx.rotate(self.shadowRotation);

      // Scale: X = entity width, Y = shadow stretch
      ctx.scale(self.shadowScaleX, self.shadowScaleY);

      ctx.opacity = self.shadowAlpha;

      // Draw black silhouette of the sprite
      // Anchor the sprite drawing so its BOTTOM is at the current origin (feet)
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

    // Hide shadow during death animation
    if ((actor as any).isDying) {
      this.shadowVisible = false;
      return;
    }

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

    const dx = actor.pos.x - bestLight.x;
    const dy = actor.pos.y - bestLight.y;
    const angle = Math.atan2(dy, dx);

    const shadowLen = Math.min(1.2, 400 / (bestDist + 50));

    // Shadow origin = feet position (feetOffset below entity pos)
    this.shadowOffsetX = 0;
    this.shadowOffsetY = this.feetOffset;

    // Rotation: point away from light
    this.shadowRotation = angle + Math.PI * 0.5;

    // Scale
    this.shadowScaleX = actor.scale?.x ?? 1;
    this.shadowScaleY = shadowLen * 0.45;

    // Alpha
    const edgeFade = 1 - (bestDist / bestLight.radius);
    this.shadowAlpha = Math.max(0.08, 0.45 * edgeFade);
  }
}
