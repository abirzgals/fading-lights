import * as ex from 'excalibur';

/** Prefix asset path with Vite base URL (handles GitHub Pages subpath) */
const B = (import.meta as any).env?.BASE_URL ?? '/';
const img = (path: string) => new ex.ImageSource(B + path);

/**
 * Central asset registry — loads all game sprites and spritesheets.
 * Call AssetLoader.load(engine) before starting scenes.
 */
export class AssetLoader {
  // Trees
  static darkTree = img('assets/pixelart/dark-tree.png');
  static treePine = img('assets/pixelart/tree_pine.png');
  static treeOak = img('assets/pixelart/tree_oak.png');
  static treeDead = img('assets/pixelart/tree_dead.png');
  static treeBirch = img('assets/pixelart/tree_birch.png');

  // Stones / metals
  static stoneDeposit = img('assets/pixelart/stone_deposit_new.png');
  static metalOre = img('assets/pixelart/metal_ore_new.png');
  static rockWall = img('assets/pixelart/rock_wall.png');

  // Stumps (3 variants)
  static stump1 = img('assets/pixelart/stump1.png');
  static stump2 = img('assets/pixelart/stump2.png');
  static stump3 = img('assets/pixelart/stump3.png');
  static stumpVariants: ex.ImageSource[] = [AssetLoader.stump1, AssetLoader.stump2, AssetLoader.stump3];

  // Buildings
  static turretSprite = img('assets/pixelart/turret.png');
  static outpostSprite = img('assets/pixelart/outpost.png');

  // Drop item textures
  static woodDrop = img('assets/pixelart/wood_drop.png');
  static stoneDrop = img('assets/pixelart/stone_drop.png');
  static metalDrop = img('assets/pixelart/metal_drop.png');

  // Ground tileset (32x32 per tile, 4x4 = 128x128)
  static groundTileset = img('assets/pixelart/ground-tileset.png');

  // Weapons spritesheet
  static weaponsSheet = img('assets/weapons.png');

  // Characters — male
  static maleSouth = img('assets/characters/male/rotations/south.png');
  static maleNorth = img('assets/characters/male/rotations/north.png');
  static maleEast = img('assets/characters/male/rotations/east.png');
  static maleWest = img('assets/characters/male/rotations/west.png');
  static maleSE = img('assets/characters/male/rotations/south-east.png');
  static maleSW = img('assets/characters/male/rotations/south-west.png');
  static maleNE = img('assets/characters/male/rotations/north-east.png');
  static maleNW = img('assets/characters/male/rotations/north-west.png');

  // Walk spritesheets (48x48 frames)
  static maleWalkSouth = img('assets/characters/male/walk/south.png');
  static maleWalkNorth = img('assets/characters/male/walk/north.png');
  static maleWalkEast = img('assets/characters/male/walk/east.png');
  static maleWalkWest = img('assets/characters/male/walk/west.png');
  static maleWalkSE = img('assets/characters/male/walk/south-east.png');
  static maleWalkSW = img('assets/characters/male/walk/south-west.png');
  static maleWalkNE = img('assets/characters/male/walk/north-east.png');
  static maleWalkNW = img('assets/characters/male/walk/north-west.png');

  // Melee attack spritesheets (48x48 frames, 3 frames per direction)
  static maleMeleeSouth = img('assets/characters/male/melee/south.png');
  static maleMeleeNorth = img('assets/characters/male/melee/north.png');
  static maleMeleeEast = img('assets/characters/male/melee/east.png');
  static maleMeleeWest = img('assets/characters/male/melee/west.png');
  static maleMeleeSE = img('assets/characters/male/melee/south-east.png');
  static maleMeleeSW = img('assets/characters/male/melee/south-west.png');
  static maleMeleeNE = img('assets/characters/male/melee/north-east.png');
  static maleMeleeNW = img('assets/characters/male/melee/north-west.png');

  // Enemy sprites (8 directions each)
  static enemySprites: Record<string, Record<string, ex.ImageSource>> = {
    SHADOW_WISP: {
      south: img('assets/enemies/shadow_wisp/rotations/south.png'),
      north: img('assets/enemies/shadow_wisp/rotations/north.png'),
      east: img('assets/enemies/shadow_wisp/rotations/east.png'),
      west: img('assets/enemies/shadow_wisp/rotations/west.png'),
      'south-east': img('assets/enemies/shadow_wisp/rotations/south-east.png'),
      'south-west': img('assets/enemies/shadow_wisp/rotations/south-west.png'),
      'north-east': img('assets/enemies/shadow_wisp/rotations/north-east.png'),
      'north-west': img('assets/enemies/shadow_wisp/rotations/north-west.png'),
    },
    SHADOW_STALKER: {
      south: img('assets/pixelart/shadow-stalker/rotations/south.png'),
      north: img('assets/pixelart/shadow-stalker/rotations/north.png'),
      east: img('assets/pixelart/shadow-stalker/rotations/east.png'),
      west: img('assets/pixelart/shadow-stalker/rotations/west.png'),
      'south-east': img('assets/pixelart/shadow-stalker/rotations/south-east.png'),
      'south-west': img('assets/pixelart/shadow-stalker/rotations/south-west.png'),
      'north-east': img('assets/pixelart/shadow-stalker/rotations/north-east.png'),
      'north-west': img('assets/pixelart/shadow-stalker/rotations/north-west.png'),
    },
    SHADOW_BEAST: {
      south: img('assets/enemies/shadow_beast/rotations/south.png'),
      north: img('assets/enemies/shadow_beast/rotations/north.png'),
      east: img('assets/enemies/shadow_beast/rotations/east.png'),
      west: img('assets/enemies/shadow_beast/rotations/west.png'),
      'south-east': img('assets/enemies/shadow_beast/rotations/south-east.png'),
      'south-west': img('assets/enemies/shadow_beast/rotations/south-west.png'),
      'north-east': img('assets/enemies/shadow_beast/rotations/north-east.png'),
      'north-west': img('assets/enemies/shadow_beast/rotations/north-west.png'),
    },
    SHADOW_LORD: {
      south: img('assets/enemies/shadow_lord/rotations/south.png'),
      north: img('assets/enemies/shadow_lord/rotations/north.png'),
      east: img('assets/enemies/shadow_lord/rotations/east.png'),
      west: img('assets/enemies/shadow_lord/rotations/west.png'),
      'south-east': img('assets/enemies/shadow_lord/rotations/south-east.png'),
      'south-west': img('assets/enemies/shadow_lord/rotations/south-west.png'),
      'north-east': img('assets/enemies/shadow_lord/rotations/north-east.png'),
      'north-west': img('assets/enemies/shadow_lord/rotations/north-west.png'),
    },
    FOG_CRAWLER: {
      south: img('assets/enemies/fog_crawler/rotations/south.png'),
      north: img('assets/enemies/fog_crawler/rotations/north.png'),
      east: img('assets/enemies/fog_crawler/rotations/east.png'),
      west: img('assets/enemies/fog_crawler/rotations/west.png'),
      'south-east': img('assets/enemies/fog_crawler/rotations/south-east.png'),
      'south-west': img('assets/enemies/fog_crawler/rotations/south-west.png'),
      'north-east': img('assets/enemies/fog_crawler/rotations/north-east.png'),
      'north-west': img('assets/enemies/fog_crawler/rotations/north-west.png'),
    },
    SHADOW_ARCHER: {
      south: img('assets/enemies/shadow_archer/rotations/south.png'),
      north: img('assets/enemies/shadow_archer/rotations/north.png'),
      east: img('assets/enemies/shadow_archer/rotations/east.png'),
      west: img('assets/enemies/shadow_archer/rotations/west.png'),
      'south-east': img('assets/enemies/shadow_archer/rotations/south-east.png'),
      'south-west': img('assets/enemies/shadow_archer/rotations/south-west.png'),
      'north-east': img('assets/enemies/shadow_archer/rotations/north-east.png'),
      'north-west': img('assets/enemies/shadow_archer/rotations/north-west.png'),
    },
    VOID_MAGE: {
      south: img('assets/enemies/void_mage/rotations/south.png'),
      north: img('assets/enemies/void_mage/rotations/north.png'),
      east: img('assets/enemies/void_mage/rotations/east.png'),
      west: img('assets/enemies/void_mage/rotations/west.png'),
      'south-east': img('assets/enemies/void_mage/rotations/south-east.png'),
      'south-west': img('assets/enemies/void_mage/rotations/south-west.png'),
      'north-east': img('assets/enemies/void_mage/rotations/north-east.png'),
      'north-west': img('assets/enemies/void_mage/rotations/north-west.png'),
    },
  };

  // Enemy animation frames — pre-created and registered for loading
  private static _animCache: Record<string, Record<string, ex.ImageSource[]>> = {};
  private static _animInitialized = false;

  // Map of which directions actually exist for each enemy animation
  // (MCP generates partial directions — not always all 8)
  private static readonly ANIM_DIRS: Record<string, string[]> = {
    'SHADOW_WISP:walking':     ['south', 'south-west', 'south-east', 'west', 'east', 'north', 'north-east', 'north-west'],
    'SHADOW_WISP:cross-punch': ['south', 'south-west', 'south-east', 'west', 'north', 'north-east', 'north-west'],
    'SHADOW_BEAST:walking':    ['south', 'south-west', 'south-east', 'west', 'east', 'north-east', 'north-west'],
    'SHADOW_BEAST:cross-punch':['south', 'south-west', 'south-east', 'west', 'east', 'north', 'north-east', 'north-west'],
    'SHADOW_LORD:walking':     ['south', 'south-west', 'south-east', 'east', 'north-east', 'north-west'],
    'SHADOW_LORD:cross-punch': ['south', 'south-west', 'west', 'east', 'north-east', 'north-west'],
    'FOG_CRAWLER:walking':     ['south', 'south-west', 'south-east', 'west', 'east', 'north'],
    'FOG_CRAWLER:cross-punch': ['south', 'south-east', 'east', 'north', 'north-east', 'north-west'],
    'SHADOW_ARCHER:walking':   ['south', 'south-west', 'south-east', 'west', 'east', 'north-east', 'north-west'],
    'SHADOW_ARCHER:fireball':  ['south', 'south-west', 'west', 'north-east'],
    'VOID_MAGE:walking':       ['south', 'south-west', 'south-east', 'west', 'east', 'north', 'north-east', 'north-west'],
    'VOID_MAGE:fireball':      ['south-west', 'east', 'north', 'north-east', 'north-west'],
  };

  // Mirror map: if a direction doesn't exist, use the closest available
  // Prefer same vertical direction, just mirror horizontally
  private static readonly DIR_MIRRORS: Record<string, string[]> = {
    'north':      ['south', 'north-west', 'north-east'],
    'north-east': ['north-west', 'east', 'south-east', 'south'],
    'east':       ['west', 'south-east', 'north-east', 'south'],
    'south-east': ['south-west', 'east', 'south'],
    'south':      ['south-west', 'south-east', 'west'],
    'south-west': ['south-east', 'south', 'west'],
    'west':       ['east', 'south-west', 'north-west', 'south'],
    'north-west': ['north-east', 'west', 'south-west', 'south'],
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

        // Mirror missing directions — try each fallback in order
        for (const dir of allDirs) {
          if (result[dir]) continue;
          const fallbacks = this.DIR_MIRRORS[dir] ?? [];
          let found = false;
          for (const fb of fallbacks) {
            if (result[fb]) { result[dir] = result[fb]; found = true; break; }
          }
          if (!found && result['south']) {
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

  // Effect textures
  static magicOrb = img('assets/effects/magic_orb.png');
  static arrowProj = img('assets/effects/arrow.png');
  static magicExplosion = img('assets/effects/magic_explosion.png');
  static bonfireSprite = img('assets/effects/bonfire.png');

  // Menu background
  static menuBg = img('assets/menu_bg.png');

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

  static maleMeleeSheets: Record<string, ex.ImageSource> = {
    'south': AssetLoader.maleMeleeSouth,
    'north': AssetLoader.maleMeleeNorth,
    'east': AssetLoader.maleMeleeEast,
    'west': AssetLoader.maleMeleeWest,
    'south-east': AssetLoader.maleMeleeSE,
    'south-west': AssetLoader.maleMeleeSW,
    'north-east': AssetLoader.maleMeleeNE,
    'north-west': AssetLoader.maleMeleeNW,
  };

  static allResources(): ex.Loadable<any>[] {
    return [
      // Trees
      this.darkTree, this.treePine, this.treeOak, this.treeDead, this.treeBirch,
      // Resources
      this.stoneDeposit, this.metalOre, this.rockWall,
      // Stumps
      this.stump1, this.stump2, this.stump3,
      // Buildings
      this.turretSprite, this.outpostSprite,
      // Drop textures
      this.woodDrop, this.stoneDrop, this.metalDrop,
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
      // Melee attack spritesheets
      this.maleMeleeSouth, this.maleMeleeNorth, this.maleMeleeEast, this.maleMeleeWest,
      this.maleMeleeSE, this.maleMeleeSW, this.maleMeleeNE, this.maleMeleeNW,
      // Effects
      this.magicOrb, this.arrowProj, this.magicExplosion, this.bonfireSprite,
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
