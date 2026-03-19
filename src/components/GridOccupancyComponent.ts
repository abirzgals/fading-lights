import * as ex from 'excalibur';

// Forward reference — will be set by GridCollisionSystem
let _gridSystem: {
  setBlocked(tx: number, ty: number): void;
  setWalkable(tx: number, ty: number): void;
  isBlocked(tx: number, ty: number): boolean;
  getSize(): number;
} | null = null;

/** Set of tiles that are gap-fills (no entity) — can be recalculated */
const _gapFillTiles = new Set<string>();

export function setGridSystem(sys: typeof _gridSystem) {
  _gridSystem = sys;
}

/** Mark a tile as gap-fill (blocked by algorithm, not by entity) */
export function markGapFill(tx: number, ty: number) {
  _gapFillTiles.add(`${tx},${ty}`);
}

/** After a tree/resource is removed, recalculate gap-fills in the area */
function recalcGapFills(cx: number, cy: number) {
  if (!_gridSystem) return;
  // Check all gap-fill tiles within radius 3 of the removed tile
  const toCheck: string[] = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const key = `${cx + dx},${cy + dy}`;
      if (_gapFillTiles.has(key)) toCheck.push(key);
    }
  }
  for (const key of toCheck) {
    const [tx, ty] = key.split(',').map(Number);
    // Recount blocked neighbors — if < 3, this gap-fill is no longer valid
    let blockedNeighbors = 0;
    for (let ndx = -1; ndx <= 1; ndx++) {
      for (let ndy = -1; ndy <= 1; ndy++) {
        if (ndx === 0 && ndy === 0) continue;
        if (_gridSystem.isBlocked(tx + ndx, ty + ndy)) blockedNeighbors++;
      }
    }
    if (blockedNeighbors < 3) {
      _gridSystem.setWalkable(tx, ty);
      _gapFillTiles.delete(key);
    }
  }
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
      // Recalculate gap-fill tiles around the removed entity
      recalcGapFills(t.tx, t.ty);
    }
    this.tiles = [];
  }
}
