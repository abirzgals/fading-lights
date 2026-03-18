import * as ex from 'excalibur';
import { Direction } from '../types';

interface AnimFrames {
  /** Map of direction → array of ImageSources (frames) */
  directions: Record<string, ex.ImageSource[]>;
  frameRate: number;
  loop: boolean;
  /** Frame index at which gameplay event triggers (e.g. damage on attack) */
  eventFrame?: number;
}

/**
 * Animated sprite with 8-directional walk and attack animations.
 * Replaces SpriteRendererComponent with full animation support.
 *
 * - Walk animation plays while moving
 * - Attack animation plays on demand (with damage frame callback)
 * - Falls back to static rotation sprite when idle
 */
export class AnimatedSpriteComponent extends ex.Component {
  public readonly type = 'AnimatedSprite';

  private rotations: Record<string, ex.ImageSource>;
  private walkAnim: AnimFrames | null = null;
  private attackAnim: AnimFrames | null = null;
  private fallbackGraphic: ex.Graphic;

  private currentDir: Direction = 'south';
  private currentAnim: 'idle' | 'walk' | 'attack' = 'idle';
  private animFrame: number = 0;
  private animTimer: number = 0;
  private attackCallback: (() => void) | null = null;
  private attackEventFired: boolean = false;

  constructor(opts: {
    rotations: Record<string, ex.ImageSource>;
    walkFrames?: Record<string, ex.ImageSource[]>;
    walkFrameRate?: number;
    attackFrames?: Record<string, ex.ImageSource[]>;
    attackFrameRate?: number;
    attackDamageFrame?: number;
    fallback?: { width: number; height: number; color: ex.Color };
  }) {
    super();
    this.rotations = opts.rotations;
    const fb = opts.fallback ?? { width: 16, height: 16, color: ex.Color.Magenta };
    this.fallbackGraphic = new ex.Rectangle({ width: fb.width, height: fb.height, color: fb.color });

    if (opts.walkFrames) {
      this.walkAnim = {
        directions: opts.walkFrames,
        frameRate: opts.walkFrameRate ?? 10,
        loop: true,
      };
    }
    if (opts.attackFrames) {
      this.attackAnim = {
        directions: opts.attackFrames,
        frameRate: opts.attackFrameRate ?? 12,
        loop: false,
        eventFrame: opts.attackDamageFrame ?? 3,
      };
    }
  }

  onAdd(owner: ex.Entity): void {
    this.applyFrame(owner as ex.Actor);
  }

  /** Start attack animation. Callback fires on damage frame. */
  playAttack(onDamageFrame: () => void): void {
    if (this.currentAnim === 'attack') return;
    this.currentAnim = 'attack';
    this.animFrame = 0;
    this.animTimer = 0;
    this.attackCallback = onDamageFrame;
    this.attackEventFired = false;
  }

  get isAttacking(): boolean { return this.currentAnim === 'attack'; }
  get direction(): Direction { return this.currentDir; }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor) return;

    // Determine direction from velocity
    if (actor.vel.squareDistance() > 1) {
      this.currentDir = this.velocityToDirection(actor.vel.x, actor.vel.y);
    }

    // State machine: attack overrides walk overrides idle
    if (this.currentAnim === 'attack' && this.attackAnim) {
      this.animTimer += deltaMs;
      const frameDuration = 1000 / this.attackAnim.frameRate;
      if (this.animTimer >= frameDuration) {
        this.animTimer -= frameDuration;
        this.animFrame++;

        // Damage frame callback
        if (!this.attackEventFired && this.animFrame >= (this.attackAnim.eventFrame ?? 3)) {
          this.attackEventFired = true;
          this.attackCallback?.();
        }

        // Animation complete
        const frames = this.attackAnim.directions[this.currentDir];
        if (!frames || this.animFrame >= frames.length) {
          this.currentAnim = 'idle';
          this.attackCallback = null;
        }
      }
    } else if (actor.vel.squareDistance() > 1 && this.walkAnim) {
      this.currentAnim = 'walk';
      this.animTimer += deltaMs;
      const frameDuration = 1000 / this.walkAnim.frameRate;
      if (this.animTimer >= frameDuration) {
        this.animTimer -= frameDuration;
        const frames = this.walkAnim.directions[this.currentDir];
        this.animFrame = frames ? (this.animFrame + 1) % frames.length : 0;
      }
    } else if (this.currentAnim !== 'attack') {
      this.currentAnim = 'idle';
      this.animFrame = 0;
    }

    this.applyFrame(actor);
  }

  private applyFrame(actor: ex.Actor): void {
    let img: ex.ImageSource | undefined;
    let useAnim = false;

    if (this.currentAnim === 'attack' && this.attackAnim) {
      const frames = this.attackAnim.directions[this.currentDir];
      if (frames && this.animFrame < frames.length && frames[0]?.isLoaded()) {
        img = frames[this.animFrame];
        useAnim = true;
      }
    } else if (this.currentAnim === 'walk' && this.walkAnim) {
      const frames = this.walkAnim.directions[this.currentDir];
      if (frames && this.animFrame < frames.length && frames[0]?.isLoaded()) {
        img = frames[this.animFrame];
        useAnim = true;
      }
    }

    // If no animation frame available for this direction,
    // always fall back to the correct static rotation (all 8 exist)
    if (!useAnim || !img?.isLoaded()) {
      img = this.rotations[this.currentDir];
    }

    if (img?.isLoaded()) {
      actor.graphics.use(img.toSprite());
    } else {
      actor.graphics.use(this.fallbackGraphic);
    }
  }

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
