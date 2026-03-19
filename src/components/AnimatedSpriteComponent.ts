import * as ex from 'excalibur';
import { Direction } from '../types';

/** Frame can be either an ImageSource (enemy individual frames) or a Graphic (spritesheet-extracted) */
type AnimFrame = ex.ImageSource | ex.Graphic;

interface AnimFrames {
  /** Map of direction → array of frames (ImageSource or Graphic) */
  directions: Record<string, AnimFrame[]>;
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
 *
 * Supports two frame formats:
 *   - ImageSource[] per direction (enemy-style, individual frame images)
 *   - SpriteSheet per direction via walkSpriteSheets (player-style, spritesheet strip)
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

  // Deferred spritesheet extraction (sheets may not be loaded at construct time)
  private walkSheetSources: Record<string, ex.ImageSource> | null = null;
  private walkSheetGrid: { columns: number; spriteWidth: number; spriteHeight: number } | null = null;
  private walkSheetsExtracted = false;

  constructor(opts: {
    rotations: Record<string, ex.ImageSource>;
    /** Individual frame images per direction (used by enemies) */
    walkFrames?: Record<string, ex.ImageSource[]>;
    /** Spritesheet strips per direction (used by player — 1 row, N columns) */
    walkSpriteSheets?: Record<string, ex.ImageSource>;
    walkSheetGrid?: { columns: number; spriteWidth: number; spriteHeight: number };
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
        directions: opts.walkFrames as Record<string, AnimFrame[]>,
        frameRate: opts.walkFrameRate ?? 10,
        loop: true,
      };
    }

    if (opts.walkSpriteSheets) {
      // Deferred extraction — sheets may not be loaded yet
      this.walkSheetSources = opts.walkSpriteSheets;
      this.walkSheetGrid = opts.walkSheetGrid ?? { columns: 6, spriteWidth: 48, spriteHeight: 48 };
    }

    if (opts.attackFrames) {
      this.attackAnim = {
        directions: opts.attackFrames as Record<string, AnimFrame[]>,
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

    // Deferred: extract sprites from spritesheets once loaded
    this.tryExtractWalkSheets();

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

  /** Try to extract walk frames from spritesheets (deferred until loaded) */
  private tryExtractWalkSheets(): void {
    if (this.walkSheetsExtracted || !this.walkSheetSources || !this.walkSheetGrid) return;

    // Check if at least one sheet is loaded
    const firstSrc = Object.values(this.walkSheetSources)[0];
    if (!firstSrc?.isLoaded()) return;

    const grid = this.walkSheetGrid;
    const dirs: Record<string, ex.Graphic[]> = {};

    for (const [dir, src] of Object.entries(this.walkSheetSources)) {
      if (!src.isLoaded()) continue;
      const sheet = ex.SpriteSheet.fromImageSource({
        image: src,
        grid: { rows: 1, columns: grid.columns, spriteWidth: grid.spriteWidth, spriteHeight: grid.spriteHeight },
      });
      const frames: ex.Graphic[] = [];
      for (let i = 0; i < grid.columns; i++) {
        const sprite = sheet.getSprite(i, 0); // (column, row) — horizontal strip
        if (sprite) frames.push(sprite);
      }
      if (frames.length > 0) dirs[dir] = frames;
    }

    if (Object.keys(dirs).length > 0) {
      this.walkAnim = {
        directions: dirs,
        frameRate: this.walkAnim?.frameRate ?? 10,
        loop: true,
      };
      this.walkSheetsExtracted = true;
    }
  }

  private applyFrame(actor: ex.Actor): void {
    let graphic: ex.Graphic | undefined;
    let useAnim = false;

    if (this.currentAnim === 'attack' && this.attackAnim) {
      const frames = this.attackAnim.directions[this.currentDir];
      if (frames && this.animFrame < frames.length) {
        const f = frames[this.animFrame];
        graphic = this.resolveGraphic(f);
        if (graphic) useAnim = true;
      }
    } else if (this.currentAnim === 'walk' && this.walkAnim) {
      const frames = this.walkAnim.directions[this.currentDir];
      if (frames && this.animFrame < frames.length) {
        const f = frames[this.animFrame];
        graphic = this.resolveGraphic(f);
        if (graphic) useAnim = true;
      }
    }

    // If no animation frame available, fall back to static rotation
    if (!useAnim || !graphic) {
      const img = this.rotations[this.currentDir];
      graphic = img?.isLoaded() ? img.toSprite() : undefined;
    }

    if (graphic) {
      actor.graphics.use(graphic);
    } else {
      actor.graphics.use(this.fallbackGraphic);
    }
  }

  /** Resolve a frame to a displayable Graphic — handles both ImageSource and Graphic */
  private resolveGraphic(frame: any): ex.Graphic | undefined {
    // If it's already a Graphic (Sprite from spritesheet extraction)
    if (frame instanceof ex.Graphic) return frame;
    // If it's an ImageSource
    if (frame && typeof frame.isLoaded === 'function' && frame.isLoaded()) {
      return frame.toSprite();
    }
    return undefined;
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
