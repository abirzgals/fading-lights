import { CONFIG } from '../config';

/**
 * Tile-based walkability grid + A* pathfinding.
 * Ported from shared.js findPathAStar + game.js _applyGridCollision.
 */
export class GridCollisionSystem {
  private grid: Uint8Array;
  private size: number;
  private tileSize: number;

  constructor(gridSize: number, tileSize: number = CONFIG.TILE_SIZE) {
    this.size = gridSize;
    this.tileSize = tileSize;
    this.grid = new Uint8Array(gridSize * gridSize).fill(1); // all walkable
  }

  getSize(): number { return this.size; }

  isBlocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return true;
    return this.grid[ty * this.size + tx] === 0;
  }

  setBlocked(tx: number, ty: number): void {
    if (tx >= 0 && ty >= 0 && tx < this.size && ty < this.size) {
      this.grid[ty * this.size + tx] = 0;
    }
  }

  setWalkable(tx: number, ty: number): void {
    if (tx >= 0 && ty >= 0 && tx < this.size && ty < this.size) {
      this.grid[ty * this.size + tx] = 1;
    }
  }

  worldToTile(wx: number, wy: number): { tx: number; ty: number } {
    return { tx: Math.floor(wx / this.tileSize), ty: Math.floor(wy / this.tileSize) };
  }

  // Reusable flood-fill distance array (avoids allocation each call)
  private floodDist: Uint16Array | null = null;
  private readonly FLOOD_UNREACHABLE = 65535;

  /** BFS flood-fill. Returns flat Uint16Array[gridSize*gridSize], value = distance in tiles (65535 = unreachable). */
  floodFill(wx: number, wy: number, maxTiles: number = 200): Uint16Array {
    const T = this.tileSize;
    const gs = this.size;
    // Reuse array — avoid allocation
    if (!this.floodDist || this.floodDist.length !== gs * gs) {
      this.floodDist = new Uint16Array(gs * gs);
    }
    this.floodDist.fill(this.FLOOD_UNREACHABLE);

    const sx = Math.floor(wx / T), sy = Math.floor(wy / T);
    let startX = sx, startY = sy;
    if (this.isBlocked(sx, sy)) {
      const fix = this.pushOutOfBlocked(wx, wy);
      if (!fix) return this.floodDist;
      startX = Math.floor(fix.x / T); startY = Math.floor(fix.y / T);
    }

    // BFS with flat queue (no objects, no strings)
    const queueX = new Int16Array(maxTiles + 4);
    const queueY = new Int16Array(maxTiles + 4);
    const queueD = new Uint16Array(maxTiles + 4);
    let head = 0, tail = 0, count = 0;

    this.floodDist[startY * gs + startX] = 0;
    queueX[tail] = startX; queueY[tail] = startY; queueD[tail] = 0; tail++;
    count++;

    while (head < tail && count < maxTiles) {
      const cx = queueX[head], cy = queueY[head], cd = queueD[head]; head++;
      // 4 cardinal directions
      for (let dir = 0; dir < 4; dir++) {
        const nx = cx + (dir === 0 ? -1 : dir === 1 ? 1 : 0);
        const ny = cy + (dir === 2 ? -1 : dir === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
        const idx = ny * gs + nx;
        if (this.floodDist[idx] !== this.FLOOD_UNREACHABLE) continue;
        if (this.grid[idx] === 0) continue; // blocked
        this.floodDist[idx] = cd + 1;
        queueX[tail] = nx; queueY[tail] = ny; queueD[tail] = cd + 1; tail++;
        count++;
      }
    }
    return this.floodDist;
  }

  /** Get flood distance at tile (returns 65535 if unreachable) */
  getFloodDist(dist: Uint16Array, tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return this.FLOOD_UNREACHABLE;
    return dist[ty * this.size + tx];
  }

  /** If position is inside a blocked tile, return nearest walkable position. Otherwise return null. */
  pushOutOfBlocked(wx: number, wy: number): { x: number; y: number } | null {
    const T = this.tileSize;
    const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
    if (!this.isBlocked(tx, ty)) return null; // not stuck

    // Search expanding ring for nearest walkable tile
    for (let r = 1; r <= 5; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = tx + dx, ny = ty + dy;
          if (!this.isBlocked(nx, ny)) {
            return { x: nx * T + T / 2, y: ny * T + T / 2 };
          }
        }
      }
    }
    return null;
  }

  /** Find a valid walkable spawn position near the given world coordinates */
  findWalkableNear(wx: number, wy: number): { x: number; y: number } {
    const T = this.tileSize;
    const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
    if (!this.isBlocked(tx, ty)) return { x: wx, y: wy };
    const result = this.pushOutOfBlocked(wx, wy);
    return result ?? { x: wx, y: wy };
  }

  /** Apply grid collision — modifies velocity to prevent entering blocked tiles.
   *  Checks X and Y independently for wall-sliding behavior. */
  applyGridCollision(
    bodyLeft: number, bodyRight: number, bodyTop: number, bodyBottom: number,
    vx: number, vy: number, speed: number
  ): { vx: number; vy: number } {
    const T = this.tileSize;
    const dt = 1 / 60;
    const margin = 2;

    const origVx = vx, origVy = vy;

    // X-axis check (using current Y position)
    if (vx !== 0) {
      const futureEdge = vx > 0
        ? bodyRight + vx * speed * dt + margin
        : bodyLeft + vx * speed * dt - margin;
      const checkTX = Math.floor(futureEdge / T);
      const tyMin = Math.floor(bodyTop / T);
      const tyMax = Math.floor((bodyBottom - 1) / T);
      for (let ty = tyMin; ty <= tyMax; ty++) {
        if (this.isBlocked(checkTX, ty)) { vx = 0; break; }
      }
    }

    // Y-axis check (using current X position)
    if (vy !== 0) {
      const futureEdge = vy > 0
        ? bodyBottom + vy * speed * dt + margin
        : bodyTop + vy * speed * dt - margin;
      const checkTY = Math.floor(futureEdge / T);
      const txMin = Math.floor(bodyLeft / T);
      const txMax = Math.floor((bodyRight - 1) / T);
      for (let tx = txMin; tx <= txMax; tx++) {
        if (this.isBlocked(tx, checkTY)) { vy = 0; break; }
      }
    }

    // Corner slide: if BOTH axes blocked but either alone would work, allow sliding
    if (vx === 0 && vy === 0 && origVx !== 0 && origVy !== 0) {
      // Try X only (vy = 0)
      let tryVx = origVx;
      {
        const futureEdge = tryVx > 0
          ? bodyRight + tryVx * speed * dt + margin
          : bodyLeft + tryVx * speed * dt - margin;
        const checkTX = Math.floor(futureEdge / T);
        const tyMin = Math.floor(bodyTop / T);
        const tyMax = Math.floor((bodyBottom - 1) / T);
        for (let ty = tyMin; ty <= tyMax; ty++) {
          if (this.isBlocked(checkTX, ty)) { tryVx = 0; break; }
        }
      }
      if (tryVx !== 0) { vx = tryVx; vy = 0; }
      else {
        // Try Y only (vx = 0)
        let tryVy = origVy;
        {
          const futureEdge = tryVy > 0
            ? bodyBottom + tryVy * speed * dt + margin
            : bodyTop + tryVy * speed * dt - margin;
          const checkTY = Math.floor(futureEdge / T);
          const txMin = Math.floor(bodyLeft / T);
          const txMax = Math.floor((bodyRight - 1) / T);
          for (let tx = txMin; tx <= txMax; tx++) {
            if (this.isBlocked(tx, checkTY)) { tryVy = 0; break; }
          }
        }
        if (tryVy !== 0) { vx = 0; vy = tryVy; }
      }
    }

    return { vx, vy };
  }

  /** A* pathfinding — returns waypoints or null */
  findPath(fromWX: number, fromWY: number, toWX: number, toWY: number): Array<{ x: number; y: number }> | null {
    const T = this.tileSize;
    const gs = this.size;
    const sx = Math.floor(fromWX / T), sy = Math.floor(fromWY / T);
    let ex = Math.floor(toWX / T), ey = Math.floor(toWY / T);

    if (sx < 0 || sy < 0 || ex < 0 || ey < 0 || sx >= gs || sy >= gs || ex >= gs || ey >= gs) return null;
    if (this.isBlocked(sx, sy)) return null;

    // Snap destination to nearest walkable if blocked
    if (this.isBlocked(ex, ey)) {
      let found = false;
      for (let r = 1; r <= 5 && !found; r++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = ex + dx, ny = ey + dy;
            if (nx >= 0 && ny >= 0 && nx < gs && ny < gs && !this.isBlocked(nx, ny)) {
              ex = nx; ey = ny; found = true;
            }
          }
        }
      }
      if (!found) return null;
    }

    // A* with 8-directional movement
    const key = (x: number, y: number) => y * gs + x;
    const open = new Map<number, { x: number; y: number; g: number; f: number }>();
    const closed = new Set<number>();
    const parent = new Map<number, number>();

    const h = (x: number, y: number) => Math.abs(x - ex) + Math.abs(y - ey);
    const startKey = key(sx, sy);
    open.set(startKey, { x: sx, y: sy, g: 0, f: h(sx, sy) });

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    let iterations = 0;
    const MAX_ITER = 800; // reduced for performance — paths >800 steps are unreasonable

    while (open.size > 0 && iterations++ < MAX_ITER) {
      // Find lowest f
      let best: { x: number; y: number; g: number; f: number } | null = null;
      let bestKey = -1;
      for (const [k, node] of open) {
        if (!best || node.f < best.f) { best = node; bestKey = k; }
      }
      if (!best) break;

      if (best.x === ex && best.y === ey) {
        // Reconstruct path
        const path: Array<{ x: number; y: number }> = [];
        let cur = bestKey;
        while (cur !== startKey) {
          const cy = Math.floor(cur / gs), cx = cur % gs;
          path.unshift({ x: cx * T + T / 2, y: cy * T + T / 2 });
          const p = parent.get(cur);
          if (p === undefined) break;
          cur = p;
        }
        return path;
      }

      open.delete(bestKey);
      closed.add(bestKey);

      for (const [dx, dy] of dirs) {
        const nx = best.x + dx, ny = best.y + dy;
        if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
        const nk = key(nx, ny);
        if (closed.has(nk) || this.isBlocked(nx, ny)) continue;

        // Diagonal: check both adjacent tiles are walkable
        if (dx !== 0 && dy !== 0) {
          if (this.isBlocked(best.x + dx, best.y) || this.isBlocked(best.x, best.y + dy)) continue;
        }

        const g = best.g + (dx !== 0 && dy !== 0 ? 1.414 : 1);
        const existing = open.get(nk);
        if (!existing || g < existing.g) {
          open.set(nk, { x: nx, y: ny, g, f: g + h(nx, ny) });
          parent.set(nk, bestKey);
        }
      }
    }

    return null; // no path
  }
}
