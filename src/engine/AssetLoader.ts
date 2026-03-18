import * as ex from 'excalibur';

/**
 * Central asset registry — loads all game sprites and spritesheets.
 * Call AssetLoader.load(engine) before starting scenes.
 */
export class AssetLoader {
  // Trees
  static darkTree = new ex.ImageSource('/assets/pixelart/dark-tree.png');
  static treePine = new ex.ImageSource('/assets/pixelart/tree_pine.png');
  static treeOak = new ex.ImageSource('/assets/pixelart/tree_oak.png');
  static treeDead = new ex.ImageSource('/assets/pixelart/tree_dead.png');
  static treeBirch = new ex.ImageSource('/assets/pixelart/tree_birch.png');

  // Stones / metals
  static stoneDeposit = new ex.ImageSource('/assets/pixelart/stone_deposit.png');
  static metalOre = new ex.ImageSource('/assets/pixelart/metal_ore.png');
  static rockWall = new ex.ImageSource('/assets/pixelart/rock_wall.png');

  // Ground tileset (32x32 per tile, 4x4 = 128x128)
  static groundTileset = new ex.ImageSource('/assets/pixelart/ground-tileset.png');

  // Weapons spritesheet
  static weaponsSheet = new ex.ImageSource('/assets/weapons.png');

  // Characters — male
  static maleSouth = new ex.ImageSource('/assets/characters/male/rotations/south.png');
  static maleNorth = new ex.ImageSource('/assets/characters/male/rotations/north.png');
  static maleEast = new ex.ImageSource('/assets/characters/male/rotations/east.png');
  static maleWest = new ex.ImageSource('/assets/characters/male/rotations/west.png');
  static maleSE = new ex.ImageSource('/assets/characters/male/rotations/south-east.png');
  static maleSW = new ex.ImageSource('/assets/characters/male/rotations/south-west.png');
  static maleNE = new ex.ImageSource('/assets/characters/male/rotations/north-east.png');
  static maleNW = new ex.ImageSource('/assets/characters/male/rotations/north-west.png');

  // Walk spritesheets (48x48 frames)
  static maleWalkSouth = new ex.ImageSource('/assets/characters/male/walk/south.png');
  static maleWalkNorth = new ex.ImageSource('/assets/characters/male/walk/north.png');
  static maleWalkEast = new ex.ImageSource('/assets/characters/male/walk/east.png');
  static maleWalkWest = new ex.ImageSource('/assets/characters/male/walk/west.png');
  static maleWalkSE = new ex.ImageSource('/assets/characters/male/walk/south-east.png');
  static maleWalkSW = new ex.ImageSource('/assets/characters/male/walk/south-west.png');
  static maleWalkNE = new ex.ImageSource('/assets/characters/male/walk/north-east.png');
  static maleWalkNW = new ex.ImageSource('/assets/characters/male/walk/north-west.png');

  // Menu background
  static menuBg = new ex.ImageSource('/assets/menu_bg.png');

  // Tree variants array for random selection
  static treeVariants: ex.ImageSource[] = [
    AssetLoader.darkTree, AssetLoader.treePine, AssetLoader.treeOak,
    AssetLoader.treeDead, AssetLoader.treeBirch,
  ];

  // Direction mapping for player sprites
  static maleRotations: Record<string, ex.ImageSource> = {
    'south': AssetLoader.maleSouth,
    'north': AssetLoader.maleNorth,
    'east': AssetLoader.maleEast,
    'west': AssetLoader.maleWest,
    'south-east': AssetLoader.maleSE,
    'south-west': AssetLoader.maleSW,
    'north-east': AssetLoader.maleNE,
    'north-west': AssetLoader.maleNW,
  };

  static maleWalkSheets: Record<string, ex.ImageSource> = {
    'south': AssetLoader.maleWalkSouth,
    'north': AssetLoader.maleWalkNorth,
    'east': AssetLoader.maleWalkEast,
    'west': AssetLoader.maleWalkWest,
    'south-east': AssetLoader.maleWalkSE,
    'south-west': AssetLoader.maleWalkSW,
    'north-east': AssetLoader.maleWalkNE,
    'north-west': AssetLoader.maleWalkNW,
  };

  static allResources(): ex.Loadable<any>[] {
    return [
      // Trees
      this.darkTree, this.treePine, this.treeOak, this.treeDead, this.treeBirch,
      // Resources
      this.stoneDeposit, this.metalOre, this.rockWall,
      // Ground
      this.groundTileset,
      // Weapons
      this.weaponsSheet,
      // Character rotations
      this.maleSouth, this.maleNorth, this.maleEast, this.maleWest,
      this.maleSE, this.maleSW, this.maleNE, this.maleNW,
      // Walk spritesheets
      this.maleWalkSouth, this.maleWalkNorth, this.maleWalkEast, this.maleWalkWest,
      this.maleWalkSE, this.maleWalkSW, this.maleWalkNE, this.maleWalkNW,
    ];
  }

  /** Create walk animation SpriteSheets (48x48 frames, 6 frames per direction) */
  static getWalkSpriteSheet(dir: string): ex.SpriteSheet | null {
    const src = this.maleWalkSheets[dir];
    if (!src || !src.isLoaded()) return null;
    return ex.SpriteSheet.fromImageSource({
      image: src,
      grid: { rows: 1, columns: 6, spriteWidth: 48, spriteHeight: 48 },
    });
  }
}
