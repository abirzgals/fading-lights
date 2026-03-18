import * as ex from 'excalibur';

/**
 * Base game entity — like Unity's GameObject.
 * Extends Excalibur Actor with auto-cleanup guarantee:
 * when kill() is called, ALL components' onRemove() fires automatically.
 *
 * Usage:
 *   class Tree extends GameEntity {
 *     onInitialize() {
 *       this.addComponent(new ShadowComponent());
 *       this.addComponent(new GridOccupancyComponent(tx, ty));
 *       this.addComponent(new HealthComponent(30));
 *     }
 *   }
 *   tree.kill(); // → all components cleaned up, grid cleared, shadow destroyed
 */
export class GameEntity extends ex.Actor {
  /** Debug tag for identification */
  public entityType: string = 'entity';

  constructor(config?: ex.ActorArgs) {
    super(config);
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
}
