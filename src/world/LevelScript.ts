import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { GridCollisionSystem } from '../engine/GridCollisionSystem';
import { EntityFactory } from '../entities/EntityFactory';
import { AssetLoader } from '../engine/AssetLoader';
import { CONFIG } from '../config';
import { EnemyType } from '../types';
import { setGridSystem } from '../components/GridOccupancyComponent';
import { GridOccupancyComponent } from '../components/GridOccupancyComponent';

const T = CONFIG.TILE_SIZE;

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

export interface LevelData {
  player: GameEntity;
  bonfires: GameEntity[];
  entities: GameEntity[];
  enemies: GameEntity[];
  grid: GridCollisionSystem;
  pathTiles: Set<string>;
}

/**
 * Level 1 script — generates the overworld.
 * Assembles the level from GameEntity building blocks via EntityFactory.
 */
export class Level1Script {
  static generate(scene: ex.Scene, seed: number = 42): LevelData {
    const rng = seededRandom(seed);
    const worldSize = CONFIG.WORLD_TILES;
    const cx = Math.floor(worldSize / 2), cy = cx;

    const grid = new GridCollisionSystem(worldSize, T);
    setGridSystem(grid); // Set BEFORE creating entities so GridOccupancyComponent works
    const entities: GameEntity[] = [];
    const bonfires: GameEntity[] = [];
    const enemies: GameEntity[] = [];

    // ======== GROUND ========
    // Dark forest floor — chunked rectangles (visible under trees)
    const chunkSize = 32;
    for (let gy = 0; gy < worldSize; gy += chunkSize) {
      for (let gx = 0; gx < worldSize; gx += chunkSize) {
        const w = Math.min(chunkSize, worldSize - gx) * T;
        const h = Math.min(chunkSize, worldSize - gy) * T;
        const chunk = new ex.Actor({
          pos: ex.vec(gx * T + w / 2, gy * T + h / 2),
          width: w, height: h, color: ex.Color.fromHex('#0f1a08'), anchor: ex.vec(0.5, 0.5),
        });
        chunk.z = -10;
        scene.add(chunk);
      }
    }

    // ======== NOISE ========
    const noiseGrid = 16;
    const noiseVals: number[] = [];
    for (let i = 0; i < noiseGrid * noiseGrid; i++) noiseVals.push(rng());
    const getNoise = (tx: number, ty: number) => {
      const gx = (tx / worldSize) * (noiseGrid - 1), gy = (ty / worldSize) * (noiseGrid - 1);
      const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const ix1 = Math.min(ix + 1, noiseGrid - 1), iy1 = Math.min(iy + 1, noiseGrid - 1);
      const a = noiseVals[iy * noiseGrid + ix], b = noiseVals[iy * noiseGrid + ix1];
      const c = noiseVals[iy1 * noiseGrid + ix], d = noiseVals[iy1 * noiseGrid + ix1];
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };

    // ======== PATHS (winding roads) ========
    const pathTiles = new Set<string>();
    const numPaths = 4 + Math.floor(rng() * 3);
    for (let p = 0; p < numPaths; p++) {
      let angle = (p / numPaths) * Math.PI * 2 + (rng() - 0.5) * 0.6;
      let px = cx, py = cy;
      for (let step = 0; step < 30 + Math.floor(rng() * 40); step++) {
        angle += (rng() - 0.5) * 0.4;
        px += Math.cos(angle) * 1.2; py += Math.sin(angle) * 1.2;
        const tpx = Math.round(px), tpy = Math.round(py);
        if (tpx < 1 || tpx >= worldSize - 1 || tpy < 1 || tpy >= worldSize - 1) break;
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            if (Math.abs(dx) + Math.abs(dy) <= 1 || rng() < 0.3)
              pathTiles.add(`${tpx + dx},${tpy + dy}`);
      }
    }

    // ======== CLEARINGS ========
    const clearings = [{ x: cx, y: cy, r: 5 }];
    for (let c = 0; c < 6 + Math.floor(rng() * 5); c++) {
      const a = rng() * Math.PI * 2, d = 10 + rng() * 50;
      clearings.push({ x: Math.round(cx + Math.cos(a) * d), y: Math.round(cy + Math.sin(a) * d), r: 3 + Math.floor(rng() * 4) });
    }
    const isClearing = (tx: number, ty: number) => clearings.some(cl => (tx - cl.x) ** 2 + (ty - cl.y) ** 2 < cl.r ** 2);
    const isPath = (tx: number, ty: number) => pathTiles.has(`${tx},${ty}`);

    // ======== WANG TILE GROUND ========
    const WANG_TO_FRAME = [6, 7, 10, 9, 2, 11, 4, 15, 5, 14, 1, 8, 3, 0, 13, 12];
    const gs = AssetLoader.groundTileset.isLoaded()
      ? ex.SpriteSheet.fromImageSource({ image: AssetLoader.groundTileset, grid: { rows: 4, columns: 4, spriteWidth: 32, spriteHeight: 32 } })
      : null;

    // Build render set — paths + clearings + border tiles for Wang transitions
    const renderSet = new Set<string>();
    for (const key of pathTiles) {
      const [tx, ty] = key.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) renderSet.add(`${tx + dx},${ty + dy}`);
    }
    for (const cl of clearings) {
      for (let dx = -cl.r - 1; dx <= cl.r + 1; dx++)
        for (let dy = -cl.r - 1; dy <= cl.r + 1; dy++) {
          const tx = cl.x + dx, ty = cl.y + dy;
          if (tx >= 0 && ty >= 0 && tx < worldSize && ty < worldSize) renderSet.add(`${tx},${ty}`);
        }
    }

    // Render Wang tiles for paths/clearings transitions
    for (const key of renderSet) {
      const [tx, ty] = key.split(',').map(Number);
      const nw = pathTiles.has(`${tx},${ty}`) ? 1 : 0;
      const ne = pathTiles.has(`${tx + 1},${ty}`) ? 1 : 0;
      const sw = pathTiles.has(`${tx},${ty + 1}`) ? 1 : 0;
      const se = pathTiles.has(`${tx + 1},${ty + 1}`) ? 1 : 0;
      const wangIdx = nw * 8 + ne * 4 + sw * 2 + se;
      const tile = new ex.Actor({ pos: ex.vec(tx * T + T / 2, ty * T + T / 2), anchor: ex.vec(0.5, 0.5) });
      if (gs) {
        const fi = WANG_TO_FRAME[wangIdx], col = fi % 4, row = Math.floor(fi / 4);
        tile.graphics.use(gs.getSprite(col, row)!);
      } else {
        tile.graphics.use(new ex.Rectangle({ width: T, height: T, color: ex.Color.fromHex(wangIdx === 0 ? '#0a1a05' : '#3a2a1a') }));
      }
      tile.z = -8;
      scene.add(tile);
    }

    // Forest ground: single dark background handles it (no per-tile actors needed)
    // The dark chunks at z=-10 provide the forest floor color

    // ======== BONFIRE ========
    const bonfire = EntityFactory.createBonfire(scene, cx * T + T / 2, cy * T + T / 2);
    bonfires.push(bonfire);
    entities.push(bonfire);

    // ======== PLAYER ========
    const player = EntityFactory.createPlayer(scene, cx * T + T / 2, (cy - 2) * T + T / 2,
      (window as any).__playerName || 'Wanderer');

    // ======== TREES ========
    // Track tree by grid tile for gap-fill assignment
    const treeByTile = new Map<string, GameEntity>();
    for (let tx = 2; tx < worldSize - 2; tx++) {
      for (let ty = 2; ty < worldSize - 2; ty++) {
        if (isClearing(tx, ty) || isPath(tx, ty)) continue;
        const density = getNoise(tx, ty) * 0.6 + getNoise(tx * 2.7 + 50, ty * 2.7 + 50) * 0.4;
        const threshold = density > 0.55 ? 0.15 : density > 0.35 ? 0.55 : 0.92;
        if (rng() > threshold) continue;
        if ((tx - cx) ** 2 + (ty - cy) ** 2 < 25 || grid.isBlocked(tx, ty)) continue;
        // Place tree: pos at tile center, anchor 0.8 handles visual offset
        // Collider = same tile as tree (tx, ty) — no offset needed
        const tree = EntityFactory.createTree(scene, tx * T + T / 2, ty * T + T / 2, tx, ty,
          Math.floor(rng() * AssetLoader.treeVariants.length));
        entities.push(tree);
        treeByTile.set(`${tx},${ty}`, tree);
      }
    }

    // ======== FOREST WALL — fill gaps, assign to nearest tree ========
    let gapsFilled = 0;
    for (let tx = 2; tx < worldSize - 2; tx++) {
      for (let ty = 2; ty < worldSize - 2; ty++) {
        if (grid.isBlocked(tx, ty)) continue;
        if (isPath(tx, ty) || isClearing(tx, ty)) continue;
        let blockedNeighbors = 0;
        let nearestTree: GameEntity | null = null;
        let nearestDist = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (grid.isBlocked(tx + dx, ty + dy)) {
              blockedNeighbors++;
              const tree = treeByTile.get(`${tx + dx},${ty + dy}`);
              if (tree) {
                const d = Math.abs(dx) + Math.abs(dy);
                if (d < nearestDist) { nearestDist = d; nearestTree = tree; }
              }
            }
          }
        }
        if (blockedNeighbors >= 3 && nearestTree) {
          const gc = nearestTree.get(GridOccupancyComponent) as GridOccupancyComponent | null;
          if (gc) {
            gc.addTile(tx, ty);
            treeByTile.set(`${tx},${ty}`, nearestTree);
            gapsFilled++;
          }
        }
      }
    }
    console.log(`[Level] Filled ${gapsFilled} forest gaps (owned by trees)`);

    // ======== STARTER STONES ========
    let placed = 0;
    for (let s = 0; placed < 12 && s < 50; s++) {
      const a = (s / 12) * Math.PI * 2, d = 3 + Math.floor(rng() * 3);
      const stx = Math.round(cx + Math.cos(a) * d), sty = Math.round(cy + Math.sin(a) * d);
      if (grid.isBlocked(stx, sty) || isPath(stx, sty)) continue;
      entities.push(EntityFactory.createStone(scene, stx * T + T / 2, sty * T + T / 2, stx, sty));
      placed++;
    }

    // ======== SCATTERED STONES ========
    for (let i = 0; i < 60; i++) {
      const tx = Math.floor(rng() * (worldSize - 10)) + 5, ty = Math.floor(rng() * (worldSize - 10)) + 5;
      if (isPath(tx, ty) || isClearing(tx, ty) || grid.isBlocked(tx, ty) || (tx - cx) ** 2 + (ty - cy) ** 2 < 64) continue;
      entities.push(EntityFactory.createStone(scene, tx * T + T / 2, ty * T + T / 2, tx, ty));
    }

    // ======== METAL ORE ========
    for (let i = 0; i < 30; i++) {
      const tx = Math.floor(rng() * (worldSize - 20)) + 10, ty = Math.floor(rng() * (worldSize - 20)) + 10;
      if ((tx - cx) ** 2 + (ty - cy) ** 2 < 625 || isPath(tx, ty) || grid.isBlocked(tx, ty)) continue;
      entities.push(EntityFactory.createMetal(scene, tx * T + T / 2, ty * T + T / 2, tx, ty));
    }

    // Enemies are spawned progressively by GameScene.runSpawning()

    return { player, bonfires, entities, enemies, grid, pathTiles };
  }
}
