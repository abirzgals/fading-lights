import * as ex from 'excalibur';

interface GlowPoint {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Renders glowing effect on bright pixels (eyes, runes, magic).
 * Uses additive blending overlay that pulses.
 */
export class GlowEffectComponent extends ex.Component {
  public readonly type = 'GlowEffect';

  private glowPoints: Record<string, GlowPoint[]>;
  private glowActors: ex.Actor[] = [];
  private pulsePhase: number = Math.random() * Math.PI * 2;

  constructor(glowData: Record<string, GlowPoint[]>) {
    super();
    this.glowPoints = glowData;
  }

  onAdd(owner: ex.Entity): void {
    const actor = owner as ex.Actor;
    const scene = actor.scene;
    if (!scene) return;

    // Create small glow dots for the 'south' direction initially
    const points = this.glowPoints['south'] || [];
    for (const p of points) {
      const glow = new ex.Actor({
        pos: actor.pos.add(ex.vec(p.x - 24, p.y - 24)), // center offset (48px sprite)
        anchor: ex.vec(0.5, 0.5),
      });
      glow.graphics.use(new ex.Circle({
        radius: 2,
        color: ex.Color.fromRGB(p.r, p.g, p.b, 0.6),
      }));
      glow.z = actor.z + 0.1;
      scene.add(glow);
      this.glowActors.push(glow);
    }
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor) return;

    this.pulsePhase += deltaMs * 0.003;
    const pulse = 0.4 + Math.sin(this.pulsePhase) * 0.3;

    // Update glow positions to follow parent
    const points = this.glowPoints['south'] || [];
    for (let i = 0; i < this.glowActors.length && i < points.length; i++) {
      const p = points[i];
      this.glowActors[i].pos = actor.pos.add(ex.vec(p.x - 24, p.y - 24));
      this.glowActors[i].z = actor.z + 0.1;
      this.glowActors[i].graphics.opacity = pulse;
    }
  }

  onRemove(): void {
    for (const g of this.glowActors) {
      if (!g.isKilled()) g.kill();
    }
    this.glowActors = [];
  }
}
