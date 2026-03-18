import * as ex from 'excalibur';
import { Direction } from '../types';

/**
 * Renders a directional sprite — automatically switches sprite based on velocity.
 * Like Unity's SpriteRenderer + Animator combined.
 */
export class SpriteRendererComponent extends ex.Component {
  public readonly type = 'SpriteRenderer';

  private rotations: Record<string, ex.ImageSource>;
  private fallbackGraphic: ex.Graphic;
  private currentDir: Direction = 'south';

  constructor(opts: {
    rotations: Record<string, ex.ImageSource>;
    fallback?: { width: number; height: number; color: ex.Color };
  }) {
    super();
    this.rotations = opts.rotations;
    const fb = opts.fallback ?? { width: 16, height: 16, color: ex.Color.Magenta };
    this.fallbackGraphic = new ex.Rectangle({ width: fb.width, height: fb.height, color: fb.color });
  }

  onAdd(owner: ex.Entity): void {
    const actor = owner as ex.Actor;
    this.applySprite(actor, 'south');
  }

  onPreUpdate(_engine: ex.Engine, _delta: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor || actor.vel.squareDistance() < 1) return;

    const dir = this.velocityToDirection(actor.vel.x, actor.vel.y);
    if (dir !== this.currentDir) {
      this.applySprite(actor, dir);
    }
  }

  private applySprite(actor: ex.Actor, dir: Direction): void {
    this.currentDir = dir;
    const img = this.rotations[dir];
    if (img?.isLoaded()) {
      actor.graphics.use(img.toSprite());
    } else {
      actor.graphics.use(this.fallbackGraphic);
    }
  }

  /** Force a specific direction (e.g. when idle facing a target) */
  setDirection(dir: Direction): void {
    const actor = this.owner as ex.Actor;
    if (actor) this.applySprite(actor, dir);
  }

  get direction(): Direction { return this.currentDir; }

  private velocityToDirection(vx: number, vy: number): Direction {
    if (vy > 0 && Math.abs(vx) < Math.abs(vy) * 0.5) return 'south';
    if (vy < 0 && Math.abs(vx) < Math.abs(vy) * 0.5) return 'north';
    if (vx > 0 && Math.abs(vy) < Math.abs(vx) * 0.5) return 'east';
    if (vx < 0 && Math.abs(vy) < Math.abs(vx) * 0.5) return 'west';
    if (vx > 0 && vy > 0) return 'south-east';
    if (vx < 0 && vy > 0) return 'south-west';
    if (vx > 0 && vy < 0) return 'north-east';
    return 'north-west';
  }
}
