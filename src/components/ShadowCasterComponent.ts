import * as ex from 'excalibur';

/**
 * Shadow caster — draws an elliptical shadow as part of the entity's own graphics.
 * NOT a separate actor — uses onPreDraw callback on the entity's GraphicsComponent.
 * Automatically destroyed when entity is killed (it's just a component).
 *
 * Original game formulas:
 * - Shadow length = min(1.2, 400 / (dist + 50))
 * - Alpha = max(0.08, 0.45 * edgeFade)
 * - Direction: away from nearest light source
 */
export class ShadowCasterComponent extends ex.Component {
  public readonly type = 'ShadowCaster';

  private entityWidth: number;
  private entityHeight: number;
  private installed = false;

  // Cached shadow params (updated in onPreUpdate, drawn in onPreDraw)
  private shadowVisible = false;
  private shadowX = 0;
  private shadowY = 0;
  private shadowScaleX = 1;
  private shadowScaleY = 0.3;
  private shadowAngle = 0;
  private shadowAlpha = 0.3;
  private shadowRadius = 8;

  /** Light sources — set by GameScene each frame (with wobble) */
  static lightSources: Array<{ x: number; y: number; radius: number }> = [];

  constructor(opts?: { entityWidth?: number; entityHeight?: number }) {
    super();
    this.entityWidth = opts?.entityWidth ?? 16;
    this.entityHeight = opts?.entityHeight ?? 24;
    this.shadowRadius = this.entityWidth * 0.5;
  }

  onAdd(owner: ex.Entity): void {
    this.installDraw(owner as ex.Actor);
  }

  private installDraw(actor: ex.Actor): void {
    if (this.installed) return;
    // Hook into entity's own graphics pipeline
    const origOnPreDraw = actor.graphics.onPreDraw;
    actor.graphics.onPreDraw = (ctx: ex.ExcaliburGraphicsContext, elapsed: number) => {
      if (origOnPreDraw) origOnPreDraw(ctx, elapsed);
      if (!this.shadowVisible) return;

      ctx.save();

      // Shadow position is relative to entity's own position (since we're in entity transform space)
      // But onPreDraw is called BEFORE the entity transform — so we're in world-ish space
      // Actually onPreDraw on GraphicsComponent is called in the entity's local space after transform
      // We need to offset from entity center

      const offsetX = this.shadowX;
      const offsetY = this.shadowY;

      ctx.translate(offsetX, offsetY);
      ctx.rotate(this.shadowAngle);
      ctx.scale(this.shadowScaleX, this.shadowScaleY);
      ctx.opacity = this.shadowAlpha;

      // Draw filled ellipse as a circle (scale handles the ellipse shape)
      ctx.drawCircle(ex.Vector.Zero, this.shadowRadius, ex.Color.Black);

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

    // Shadow direction — away from light
    const dx = actor.pos.x - bestLight.x;
    const dy = actor.pos.y - bestLight.y;
    const angle = Math.atan2(dy, dx);

    // Shadow length (original formula)
    const shadowLen = Math.min(1.2, 400 / (bestDist + 50));

    // Offset from entity center to feet, then in shadow direction
    const feetOffsetY = this.entityHeight * 0.3;
    const stretchDist = shadowLen * this.entityHeight * 0.3;

    this.shadowX = Math.cos(angle) * stretchDist;
    this.shadowY = feetOffsetY + Math.sin(angle) * stretchDist * 0.5;
    this.shadowAngle = angle;
    this.shadowScaleX = 1.0 + shadowLen * 0.4;
    this.shadowScaleY = 0.3 + shadowLen * 0.15;

    // Alpha: darker closer to light center
    const edgeFade = 1 - (bestDist / bestLight.radius);
    this.shadowAlpha = Math.max(0.08, 0.45 * edgeFade);
  }
}
