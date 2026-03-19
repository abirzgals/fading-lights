import * as ex from 'excalibur';
import { GridOccupancyComponent } from '../components/GridOccupancyComponent';

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

  /** If true, skip component updates (for off-screen static entities) */
  public culled = false;

  /** Drive all component updates each frame — skipped if culled */
  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    if (this.culled) return;
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

  /** Free grid tiles on kill — Excalibur may not call Component.onRemove() on kill() */
  onPreKill(): void {
    const gc = this.get(GridOccupancyComponent) as GridOccupancyComponent | null;
    if (gc) gc.freeTiles();
  }

  /** Whether this entity is in the dying animation (not yet killed) */
  public isDying = false;

  /**
   * Play death sequence: flash red → shrink → wait 3s → fade out 3s → kill.
   * No rotation — shadow stays correct. Uses scale + opacity for death effect.
   */
  playDeath(onComplete?: () => void): void {
    if (this.isDying || this.isKilled()) return;
    this.isDying = true;

    // Stop all movement
    this.vel = ex.vec(0, 0);

    // Phase 1: Red flash + hit stagger (0.3s)
    this.actions
      .callMethod(() => {
        this.graphics.opacity = 0.8;
      })
      .delay(100)
      .callMethod(() => {
        this.graphics.opacity = 1.0;
      })
      .delay(100)
      .callMethod(() => {
        this.graphics.opacity = 0.6;
      })
      // Phase 2: Collapse — shrink Y to simulate falling flat (0.3s)
      .scaleTo(ex.vec(this.scale.x * 1.1, this.scale.y * 0.3), ex.vec(2, 3))
      .callMethod(() => {
        // Lying flat on ground
        this.graphics.opacity = 0.5;
      })
      // Phase 3: Wait on ground (3s)
      .delay(3000)
      // Phase 4: Fade out (3s)
      .fade(0, 3000)
      .callMethod(() => {
        onComplete?.();
        this.kill();
      });
  }
}
