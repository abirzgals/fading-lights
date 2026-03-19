import { WeaponDef, EnemyDef, BuildingDef, EnemyType, BuildingType } from './types';

export const GAME_VERSION = '2.0.0';

export const CONFIG = {
  // World
  WORLD_TILES: 150,
  TILE_SIZE: 32,

  // Player
  PLAYER_SPEED: 160,
  PLAYER_MAX_HP: 100,

  // Bonfire
  BONFIRE_MAX_FUEL: 100,
  BONFIRE_BURN_RATE: 0.4,
  BONFIRE_BASE_RADIUS: 420,
  BONFIRE_MIN_RADIUS: 140,

  // Resources
  WOOD_PER_TREE: 3,
  TREE_HITS: 3,
  STONE_PER_DEPOSIT: 2,
  STONE_HITS: 4,
  METAL_PER_DEPOSIT: 2,
  METAL_HITS: 5,
  FUEL_PER_WOOD: 15,

  // Enemies
  SPAWN_INTERVAL: 14000,
  SPAWN_MARGIN: 120,
  MAX_ENEMIES: 8,

  // Combat
  ENEMY_MELEE_RANGE: 8,
  PICKUP_RADIUS: 40,
  INTERACT_RADIUS: 60,

  // Fire levels: cumulative fuel added for each level
  FIRE_LEVELS: [0, 25, 60, 110, 175, 275] as readonly number[],

  // Build spots around bonfire (angle in degrees, dist in tiles)
  BUILD_SPOTS: [
    { type: 'TURRET'         as BuildingType, angle: 0,    dist: 3, unlockLevel: 1 },
    { type: 'TURRET'         as BuildingType, angle: 180,  dist: 3, unlockLevel: 1 },
    { type: 'OUTPOST'        as BuildingType, angle: 90,   dist: 4, unlockLevel: 2 },
    { type: 'FORGE'          as BuildingType, angle: 270,  dist: 3, unlockLevel: 2 },
    { type: 'ARMOR_WORKSHOP' as BuildingType, angle: 45,   dist: 4, unlockLevel: 3 },
    { type: 'WEAPON_SHOP'    as BuildingType, angle: 135,  dist: 3, unlockLevel: 3 },
    { type: 'OUTPOST'        as BuildingType, angle: 225,  dist: 4, unlockLevel: 4 },
    { type: 'TURRET'         as BuildingType, angle: 315,  dist: 3, unlockLevel: 4 },
    { type: 'FRIEND_HUT'    as BuildingType, angle: 160,  dist: 4, unlockLevel: 5 },
  ],
} as const;

export const WEAPONS: Record<string, WeaponDef> = {
  WOODEN_CLUB:  { name: 'Wooden Club',  damage: 10, range: 32, speed: 800, tier: 0, color: 0x8B6914, spriteFrame: 21, attackType: 'swing',  arcDeg: 120 },
  STONE_AXE:    { name: 'Stone Axe',    damage: 18, range: 52, speed: 600, tier: 1, color: 0x888888, spriteFrame: 37, attackType: 'swing',  arcDeg: 155, chopBonus: 2, cost: { wood: 10, stone: 8 } },
  IRON_SWORD:   { name: 'Iron Sword',   damage: 30, range: 60, speed: 400, tier: 2, color: 0xC0C0C0, spriteFrame: 12, attackType: 'swing',  arcDeg: 115, cost: { wood: 5, stone: 10, metal: 8 } },
  FLAME_BLADE:  { name: 'Flame Blade',  damage: 38, range: 65, speed: 350, tier: 3, color: 0xFF6600, spriteFrame: 68, attackType: 'swing',  arcDeg: 115, shadowBonus: 1.5, cost: { wood: 5, stone: 5, metal: 15 } },
};

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  SHADOW_WISP:    { name: 'Shadow Wisp',    hp: 14,  damage: 5,  speed: 104, xp: 5,  size: 12, color: 0x4444AA, gold: 1 },
  SHADOW_STALKER: { name: 'Shadow Stalker', hp: 35,  damage: 12, speed: 76,  xp: 15, size: 18, color: 0x6622AA, gold: 2 },
  SHADOW_BEAST:   { name: 'Shadow Beast',   hp: 84,  damage: 25, speed: 52,  xp: 35, size: 28, color: 0x440066, gold: 4 },
  SHADOW_LORD:    { name: 'Shadow Lord',    hp: 210, damage: 40, speed: 44,  xp: 100, size: 36, color: 0x220044, gold: 10 },
  FOG_CRAWLER:    { name: 'Fog Crawler',    hp: 56,  damage: 0,  speed: 60,  xp: 25, size: 22, color: 0x333355, gold: 3, targetsFire: true },
  SHADOW_ARCHER:  { name: 'Shadow Archer',  hp: 42,  damage: 14, speed: 62,  xp: 20, size: 16, color: 0x553388, gold: 3, ranged: true, projectileSpeed: 220, attackRange: 200, attackCooldown: 2200, projectileType: 'arrow' },
  VOID_MAGE:      { name: 'Void Mage',      hp: 65,  damage: 22, speed: 48,  xp: 40, size: 20, color: 0x6600AA, gold: 5, ranged: true, projectileSpeed: 160, attackRange: 240, attackCooldown: 3000, projectileType: 'magic' },
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  TURRET:         { name: 'Turret',          cost: { wood: 8, stone: 5 },               hp: 120, desc: 'Auto-attacks nearby enemies', attackRange: 180, attackDamage: 8, attackSpeed: 1200 },
  OUTPOST:        { name: 'Outpost',         cost: { wood: 20, stone: 10 },             hp: 200, desc: 'Extends light', lightRadius: 180 },
  FORGE:          { name: 'Forge',           cost: { wood: 15, stone: 20 },             hp: 150, desc: 'Unlocks Stone Axe', unlocks: ['STONE_AXE'] },
  WEAPON_SHOP:    { name: 'Weapon Shop',     cost: { wood: 10, stone: 15, metal: 10 },  hp: 150, desc: 'Unlocks advanced weapons', unlocks: ['IRON_SWORD', 'FLAME_BLADE'] },
  ARMOR_WORKSHOP: { name: 'Armor Workshop',  cost: { wood: 10, stone: 10, metal: 15 },  hp: 150, desc: 'Reduces damage by 30%', armorBonus: 0.3 },
  FRIEND_HUT:     { name: 'Friend Hut',      cost: { wood: 25, stone: 15, metal: 5 },   hp: 180, desc: 'Spawns NPC ally', spawnsAlly: true },
};
