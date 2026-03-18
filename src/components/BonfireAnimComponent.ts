import * as ex from 'excalibur';

const DIRS = ['south', 'north', 'east'];
const FRAME_COUNT = 4;

/**
 * Animated bonfire with pulsing fire.
 * Loads breathing-idle animation frames and cycles through them.
 */
export class BonfireAnimComponent {
  private frames: ex.ImageSource[] = [];
  private frameIdx = 0;
  private timer = 0;
  private loaded = false;

  constructor() {
    // Load south-facing frames
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new ex.ImageSource(`/assets/effects/bonfire_anim/animations/breathing-idle/south/frame_00${i}.png`);
      img.load().catch(() => {});
      this.frames.push(img);
    }
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    const actor = (this as any).owner as ex.Actor;
    if (!actor) return;

    // Check if first frame loaded
    if (!this.loaded && this.frames[0]?.isLoaded()) {
      this.loaded = true;
      actor.graphics.use(this.frames[0].toSprite());
    }
    if (!this.loaded) return;

    // Cycle through frames (100ms per frame = 10fps fire animation)
    this.timer += deltaMs;
    if (this.timer > 100) {
      this.timer = 0;
      this.frameIdx = (this.frameIdx + 1) % FRAME_COUNT;
      const frame = this.frames[this.frameIdx];
      if (frame?.isLoaded()) {
        actor.graphics.use(frame.toSprite());
      }
    }

    // Subtle scale pulse (like original bonfire)
    const pulse = 1.0 + Math.sin(performance.now() * 0.004) * 0.05;
    actor.scale = ex.vec(pulse, pulse);
  }
}
