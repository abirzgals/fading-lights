import * as ex from 'excalibur';

/** Interface for components that want per-frame updates */
export interface UpdatableComponent {
  onPreUpdate?(engine: ex.Engine, deltaMs: number): void;
}

/**
 * Base game entity — like Unity's GameObject.
 * Extends Excalibur Actor with:
 * - Auto-cleanup: kill() removes all components
 * - Component updates: onPreUpdate drives all component.onPreUpdate()
 */
export class GameEntity extends ex.Actor {
  /** Debug tag for identification */
  public entityType: string = 'entity';

  /** Track components that need per-frame updates */
  private _updatableComponents: UpdatableComponent[] = [];

  constructor(config?: ex.ActorArgs) {
    super(config);
  }

  /** Override addComponent to track updatable components */
  addComponent<T extends ex.Component>(component: T, force?: boolean): this {
    super.addComponent(component, force);
    if (typeof (component as any).onPreUpdate === 'function') {
      this._updatableComponents.push(component as unknown as UpdatableComponent);
    }
    return this;
  }

  /** Drive all component updates each frame */
  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    for (const comp of this._updatableComponents) {
      comp.onPreUpdate?.(engine, deltaMs);
    }
  }

  /** Get a typed component or throw */
  requireComponent<T extends ex.Component>(type: new (...args: any[]) => T): T {
    const comp = this.get(type) as unknown as T | null;
    if (!comp) throw new Error(`${this.entityType} missing component ${type.name}`);
    return comp;
  }

  /** Get a typed component or return undefined */
  findComponent<T extends ex.Component>(type: new (...args: any[]) => T): T | undefined {
    return (this.get(type) as unknown as T | null) ?? undefined;
  }

  /** Check if entity has a component */
  hasComponent<T extends ex.Component>(type: new (...args: any[]) => T): boolean {
    return !!(this.get(type));
  }

  /** Whether this entity is in the dying animation (not yet killed) */
  public isDying = false;

  /**
   * Play death sequence: flash red → fall over → wait 3s → fade out 3s → kill.
   * Call this instead of kill() for enemies/player.
   */
  playDeath(onComplete?: () => void): void {
    if (this.isDying || this.isKilled()) return;
    this.isDying = true;

    // Stop all movement
    this.vel = ex.vec(0, 0);

    // Phase 1: Flash red + fall over (0.4s)
    const fallDir = (Math.random() > 0.5 ? 1 : -1) * (Math.PI * 0.35 + Math.random() * 0.2);
    this.actions
      .callMethod(() => {
        // Red tint flash — darken the sprite
        this.graphics.opacity = 0.7;
      })
      .rotateTo(fallDir, 4) // fall over
      .callMethod(() => {
        // Phase 2: Lie on ground for 3 seconds
        this.graphics.opacity = 0.6;
      })
      .delay(3000)
      // Phase 3: Fade out over 3 seconds
      .fade(0, 3000)
      .callMethod(() => {
        onComplete?.();
        this.kill();
      });
  }
}
