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

  // Enemy sprites (8 directions each)
  static enemySprites: Record<string, Record<string, ex.ImageSource>> = {
    SHADOW_WISP: {
      south: new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/south.png'),
      north: new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/north.png'),
      east: new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/east.png'),
      west: new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/enemies/shadow_wisp/rotations/north-west.png'),
    },
    SHADOW_STALKER: {
      south: new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/south.png'),
      north: new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/north.png'),
      east: new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/east.png'),
      west: new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/pixelart/shadow-stalker/rotations/north-west.png'),
    },
    SHADOW_BEAST: {
      south: new ex.ImageSource('/assets/enemies/shadow_beast/rotations/south.png'),
      north: new ex.ImageSource('/assets/enemies/shadow_beast/rotations/north.png'),
      east: new ex.ImageSource('/assets/enemies/shadow_beast/rotations/east.png'),
      west: new ex.ImageSource('/assets/enemies/shadow_beast/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/enemies/shadow_beast/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/enemies/shadow_beast/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/enemies/shadow_beast/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/enemies/shadow_beast/rotations/north-west.png'),
    },
    SHADOW_LORD: {
      south: new ex.ImageSource('/assets/enemies/shadow_lord/rotations/south.png'),
      north: new ex.ImageSource('/assets/enemies/shadow_lord/rotations/north.png'),
      east: new ex.ImageSource('/assets/enemies/shadow_lord/rotations/east.png'),
      west: new ex.ImageSource('/assets/enemies/shadow_lord/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/enemies/shadow_lord/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/enemies/shadow_lord/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/enemies/shadow_lord/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/enemies/shadow_lord/rotations/north-west.png'),
    },
    FOG_CRAWLER: {
      south: new ex.ImageSource('/assets/enemies/fog_crawler/rotations/south.png'),
      north: new ex.ImageSource('/assets/enemies/fog_crawler/rotations/north.png'),
      east: new ex.ImageSource('/assets/enemies/fog_crawler/rotations/east.png'),
      west: new ex.ImageSource('/assets/enemies/fog_crawler/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/enemies/fog_crawler/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/enemies/fog_crawler/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/enemies/fog_crawler/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/enemies/fog_crawler/rotations/north-west.png'),
    },
    SHADOW_ARCHER: {
      south: new ex.ImageSource('/assets/enemies/shadow_archer/rotations/south.png'),
      north: new ex.ImageSource('/assets/enemies/shadow_archer/rotations/north.png'),
      east: new ex.ImageSource('/assets/enemies/shadow_archer/rotations/east.png'),
      west: new ex.ImageSource('/assets/enemies/shadow_archer/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/enemies/shadow_archer/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/enemies/shadow_archer/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/enemies/shadow_archer/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/enemies/shadow_archer/rotations/north-west.png'),
    },
    VOID_MAGE: {
      south: new ex.ImageSource('/assets/enemies/void_mage/rotations/south.png'),
      north: new ex.ImageSource('/assets/enemies/void_mage/rotations/north.png'),
      east: new ex.ImageSource('/assets/enemies/void_mage/rotations/east.png'),
      west: new ex.ImageSource('/assets/enemies/void_mage/rotations/west.png'),
      'south-east': new ex.ImageSource('/assets/enemies/void_mage/rotations/south-east.png'),
      'south-west': new ex.ImageSource('/assets/enemies/void_mage/rotations/south-west.png'),
      'north-east': new ex.ImageSource('/assets/enemies/void_mage/rotations/north-east.png'),
      'north-west': new ex.ImageSource('/assets/enemies/void_mage/rotations/north-west.png'),
    },
  };

  // Enemy animation frames — pre-created and registered for loading
  private static _animCache: Record<string, Record<string, ex.ImageSource[]>> = {};
  private static _animInitialized = false;

  // Map of which directions actually exist for each enemy animation
  // (MCP generates partial directions — not always all 8)
  private static readonly ANIM_DIRS: Record<string, string[]> = {
    'SHADOW_WISP:walking':     ['south', 'south-west', 'west'],
    'SHADOW_WISP:cross-punch': ['south', 'south-west', 'west', 'north', 'north-west'],
    'SHADOW_BEAST:walking':    ['south', 'south-west', 'north-west'],
    'SHADOW_BEAST:cross-punch':['south', 'south-west', 'west', 'north', 'north-west'],
    'SHADOW_LORD:walking':     ['south', 'south-west', 'north-west'],
    'SHADOW_LORD:cross-punch': ['south', 'south-west', 'west', 'north-west'],
    'FOG_CRAWLER:walking':     ['east', 'north', 'west'],
    'FOG_CRAWLER:cross-punch': ['south', 'east', 'north', 'north-west'],
    'SHADOW_ARCHER:walking':   ['south', 'south-west', 'west', 'east', 'north-east'],
    'SHADOW_ARCHER:fireball':  ['south', 'south-west', 'west', 'north-east'],
    'VOID_MAGE:walking':       ['south', 'south-west', 'west', 'north', 'north-west'],
    'VOID_MAGE:fireball':      ['south-west', 'north', 'north-west'],
  };

  // Mirror map: if a direction doesn't exist, use this one instead
  private static readonly DIR_MIRRORS: Record<string, string> = {
    'north': 'south',
    'north-east': 'south-west',
    'east': 'west',
    'south-east': 'south-west',
    'north-west': 'south-west',
  };

  private static _initAnimFrames(): void {
    if (this._animInitialized) return;
    this._animInitialized = true;

    const allDirs = ['south', 'north', 'east', 'west', 'south-east', 'south-west', 'north-east', 'north-west'];
    const enemyAnims: Record<string, string[]> = {
      SHADOW_WISP: ['walking', 'cross-punch'],
      SHADOW_BEAST: ['walking', 'cross-punch'],
      SHADOW_LORD: ['walking', 'cross-punch'],
      FOG_CRAWLER: ['walking', 'cross-punch'],
      SHADOW_ARCHER: ['walking', 'fireball'],
      VOID_MAGE: ['walking', 'fireball'],
    };

    for (const [type, anims] of Object.entries(enemyAnims)) {
      const folder = type.toLowerCase();
      for (const animName of anims) {
        const key = `${type}:${animName}`;
        const existingDirs = this.ANIM_DIRS[key] ?? [];
        const result: Record<string, ex.ImageSource[]> = {};

        // Create frames for existing directions
        for (const dir of existingDirs) {
          const frames: ex.ImageSource[] = [];
          for (let i = 0; i < 6; i++) {
            frames.push(new ex.ImageSource(`/assets/enemies/${folder}/animations/${animName}/${dir}/frame_00${i}.png`));
          }
          result[dir] = frames;
        }

        // Mirror missing directions to closest existing one
        for (const dir of allDirs) {
          if (result[dir]) continue;
          // Try mirror, then fallback to 'south'
          const mirror = this.DIR_MIRRORS[dir];
          if (mirror && result[mirror]) {
            result[dir] = result[mirror];
          } else if (result['south']) {
            result[dir] = result['south'];
          }
        }

        this._animCache[key] = result;
      }
    }
  }

  /** Get pre-created animation frames (pre-loaded by the Loader) */
  static getEnemyAnimFrames(enemyType: string, animName: string): Record<string, ex.ImageSource[]> {
    this._initAnimFrames();
    return this._animCache[`${enemyType}:${animName}`] ?? {};
  }

  /** Get ALL animation ImageSources for the Loader — only existing files */
  static allAnimResources(): ex.Loadable<any>[] {
    this._initAnimFrames();
    // Collect unique ImageSources (mirrored dirs share same refs — use Set to deduplicate)
    const seen = new Set<ex.ImageSource>();
    for (const dirFrames of Object.values(this._animCache)) {
      for (const frames of Object.values(dirFrames)) {
        for (const img of frames) {
          seen.add(img);
        }
      }
    }
    return [...seen];
  }

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
      // Enemy sprites (all directions)
      ...Object.values(this.enemySprites).flatMap(dirs => Object.values(dirs)),
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
