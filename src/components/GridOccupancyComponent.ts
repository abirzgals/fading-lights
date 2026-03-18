import * as ex from 'excalibur';

// Forward reference — will be set by GridCollisionSystem
let _gridSystem: { setBlocked(tx: number, ty: number): void; setWalkable(tx: number, ty: number): void } | null = null;

export function setGridSystem(sys: typeof _gridSystem) {
  _gridSystem = sys;
}

/**
 * Marks/unmarks tiles in the walkability grid.
 * On attach → tile blocked. On remove (entity killed) → tile walkable.
 * No more ghost colliders from forgotten cleanup.
 */
export class GridOccupancyComponent extends ex.Component {
  private tiles: Array<{ tx: number; ty: number }> = [];

  constructor(...tiles: Array<{ tx: number; ty: number }>) {
    super();
    this.tiles = tiles;
  }

  onAdd(): void {
    for (const t of this.tiles) {
      _gridSystem?.setBlocked(t.tx, t.ty);
    }
  }

  onRemove(): void {
    for (const t of this.tiles) {
      _gridSystem?.setWalkable(t.tx, t.ty);
    }
    this.tiles = [];
  }
}
