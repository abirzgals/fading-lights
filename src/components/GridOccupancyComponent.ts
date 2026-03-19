import * as ex from 'excalibur';

// Forward reference — set by LevelScript before entity creation
let _gridSystem: {
  setBlocked(tx: number, ty: number): void;
  setWalkable(tx: number, ty: number): void;
  isBlocked(tx: number, ty: number): boolean;
  getSize(): number;
} | null = null;

export function setGridSystem(sys: typeof _gridSystem) {
  _gridSystem = sys;
}

/**
 * Marks/unmarks tiles in the walkability grid.
 * On attach → tiles blocked. On remove (entity killed) → tiles walkable.
 * Supports adding extra tiles (gap-fills) that belong to this entity.
 */
export class GridOccupancyComponent extends ex.Component {
  private tiles: Array<{ tx: number; ty: number }> = [];

  constructor(...tiles: Array<{ tx: number; ty: number }>) {
    super();
    this.tiles = tiles;
  }

  /** Add an extra tile owned by this entity (e.g. forest gap-fill) */
  addTile(tx: number, ty: number): void {
    this.tiles.push({ tx, ty });
    _gridSystem?.setBlocked(tx, ty);
  }

  onAdd(): void {
    for (const t of this.tiles) {
      _gridSystem?.setBlocked(t.tx, t.ty);
    }
  }

  /** Free all tiles — called on component removal or entity kill */
  freeTiles(): void {
    for (const t of this.tiles) {
      _gridSystem?.setWalkable(t.tx, t.ty);
    }
    this.tiles = [];
  }

  onRemove(): void {
    this.freeTiles();
  }
}
