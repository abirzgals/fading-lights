import { GridCollisionSystem } from './GridCollisionSystem';
import { CONFIG } from '../config';

const T = CONFIG.TILE_SIZE;
const WAYPOINT_REACH = 16;

/**
 * Universal A* path follower — used by both player bot and enemy AI.
 * Single source of truth for pathfinding behavior.
 *
 * Features:
 * - A* via GridCollisionSystem.findPath()
 * - Nearest-side approach for blocked targets
 * - Auto-repath on timer or target move
 * - Direct movement for very short distances
 */
export class PathFollower {
  private path: Array<{ x: number; y: number }> | null = null;
  private pathIdx = 0;
  private repathTimer = 0;
  /** true if last moveTo arrived at destination; false if unreachable or still moving */
  public arrived = false;
  /** true if last moveTo couldn't find any path */
  public unreachable = false;
  private pathTarget: { x: number; y: number } | null = null;
  private grid: GridCollisionSystem;

  constructor(grid: GridCollisionSystem) {
    this.grid = grid;
  }

  /** Get current path for debug rendering */
  getPath(): Array<{ x: number; y: number }> | null { return this.path; }
  getPathIdx(): number { return this.pathIdx; }

  /** Clear current path (e.g. on goal change) */
  clearPath(): void {
    this.path = null;
    this.pathTarget = null;
  }

  /** Update repath timer. Call each frame with dt in seconds. */
  tick(dt: number): void {
    this.repathTimer -= dt;
  }

  /**
   * Move toward target using A* pathfinding.
   * Returns normalized direction vector {x, y}.
   * Handles: nearest-side approach, repath on timer, direct movement for short dist.
   */
  moveTo(
    fromX: number, fromY: number,
    toX: number, toY: number,
  ): { x: number; y: number } {
    this.arrived = false;
    this.unreachable = false;
    const directDist = Math.hypot(toX - fromX, toY - fromY);

    // Already at target
    if (directDist < 4) {
      this.arrived = true;
      return { x: 0, y: 0 };
    }

    // Repath if needed — including best-side calculation
    const targetMoved = this.pathTarget &&
      Math.hypot(toX - this.pathTarget.x, toY - this.pathTarget.y) > 60;
    if (!this.path || this.pathIdx >= this.path.length || this.repathTimer <= 0 || targetMoved) {
      // Find best approach side for blocked targets
      let goalX = toX, goalY = toY;
      const ttx = Math.floor(toX / T), tty = Math.floor(toY / T);
      if (this.grid.isBlocked(ttx, tty)) {
        let bestPath: Array<{ x: number; y: number }> | null = null;
        let bestLen = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = ttx + dx, ny = tty + dy;
            if (this.grid.isBlocked(nx, ny)) continue;
            const candidate = this.grid.findPath(fromX, fromY, nx * T + T / 2, ny * T + T / 2);
            if (candidate && candidate.length < bestLen) {
              bestLen = candidate.length;
              bestPath = candidate;
              goalX = nx * T + T / 2;
              goalY = ny * T + T / 2;
            }
          }
        }
        this.path = bestPath;
      } else {
        this.path = this.grid.findPath(fromX, fromY, goalX, goalY);
      }
      this.pathIdx = 0;
      this.repathTimer = 0.8 + Math.random() * 0.4;
      this.pathTarget = { x: goalX, y: goalY };
    }

    // Follow path
    if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const dist = Math.hypot(fromX - wp.x, fromY - wp.y);
      if (dist < WAYPOINT_REACH) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          this.arrived = true;
          return { x: 0, y: 0 }; // arrived
        }
      }
      if (this.pathIdx < this.path.length) {
        const next = this.path[this.pathIdx];
        const dx = next.x - fromX, dy = next.y - fromY;
        const len = Math.hypot(dx, dy);
        if (len > 1) return { x: dx / len, y: dy / len };
      }
    }

    // No path found — don't walk into walls
    this.unreachable = true;
    return { x: 0, y: 0 };
  }
}
