// ============================================================
// GAME CONFIGURATION & DATA
// ============================================================

const GAME_VERSION = '0.7.0';

const CONFIG = {
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
    FUEL_SPAWN_BURST: 2,       // enemies spawned when upgrading fire

    // Rain system
    RAIN_MIN_INTERVAL: 90,        // seconds — min time between rain events
    RAIN_MAX_INTERVAL: 180,       // seconds — max time between rain events
    RAIN_DURATION_MIN: 20,        // seconds
    RAIN_DURATION_MAX: 45,        // seconds
    RAIN_FUEL_DRAIN: 0.8,         // fuel/second drained from bonfires during rain
    RAIN_START_LEVEL: 2,          // fire level needed before rain starts

    // Raider system (camp level 2+)
    RAID_SPAWN_INTERVAL: 8000,   // ms between raid spawns (tower-defense pace)
    ENEMY_MELEE_RANGE: 8,        // px — melee hit distance (touching)
    RAID_SIGHT_RANGE: 160,       // px — raider notices player
    RAID_LEASH_RANGE: 280,       // px — raider gives up chasing player
    RAID_ATTACK_RANGE: 35,       // px — raider attacks camp bonfire/buildings

    // Fire camp levels: fuel needed to reach each level (5x cost)
    // Level 1 = start, Level 2 = 25 fuel, Level 3 = 60, Level 4 = 110, Level 5 = 175
    FIRE_LEVELS: [0, 25, 60, 110, 175, 275],

    // Build spots — unlocked by fire camp level
    BUILD_SPOTS: [
        // Level 2 unlocks: 2 turrets
        { angle: 0,            dist: 4, type: 'TURRET',  label: 'Turret',  reqLevel: 2 },
        { angle: Math.PI,      dist: 4, type: 'TURRET',  label: 'Turret',  reqLevel: 2 },
        // Level 3 unlocks: 2 more spots (outpost + turret)
        { angle: Math.PI / 2,  dist: 5, type: 'TURRET',  label: 'Turret',  reqLevel: 3 },
        { angle: -Math.PI / 2, dist: 5, type: 'OUTPOST', label: 'Outpost', reqLevel: 3 },
        // Level 4 unlocks: 2 more
        { angle: Math.PI / 4,  dist: 6, type: 'TURRET',  label: 'Turret',  reqLevel: 4 },
        { angle: -Math.PI / 4, dist: 6, type: 'TURRET',  label: 'Turret',  reqLevel: 4 },
        // Level 5 unlocks: 2 more outposts
        { angle: 3*Math.PI/4,  dist: 7, type: 'OUTPOST', label: 'Outpost', reqLevel: 5 },
        { angle: -3*Math.PI/4, dist: 7, type: 'OUTPOST', label: 'Outpost', reqLevel: 5 },
    ],

    // Darkness
    DARKNESS_DAMAGE: 8,
    DARKNESS_DAMAGE_DELAY: 500,

    // Interaction
    PICKUP_RADIUS: 40,
    INTERACT_RADIUS: 60,
};

const WEAPONS = {
    // arcDeg = attack arc in degrees (cone centred on facing direction). 360 = hits all around.
    WOODEN_CLUB:  { name: 'Wooden Club',  damage: 10, range: 32, speed: 800, tier: 0, color: 0x8B6914, spriteFrame: 21, attackType: 'swing',  arcDeg: 120 },
    STONE_AXE:    { name: 'Stone Axe',    damage: 18, range: 52, speed: 600, tier: 1, color: 0x888888, chopBonus: 2, cost: { wood: 10, stone: 8 }, spriteFrame: 37, attackType: 'swing',  arcDeg: 155 },
    IRON_SWORD:   { name: 'Iron Sword',   damage: 30, range: 60, speed: 400, tier: 2, color: 0xC0C0C0, cost: { wood: 5, stone: 10, metal: 8 }, spriteFrame: 12, attackType: 'swing',  arcDeg: 115 },
    FLAME_BLADE:  { name: 'Flame Blade',  damage: 38, range: 65, speed: 350, tier: 3, color: 0xFF6600, shadowBonus: 1.5, cost: { wood: 5, stone: 5, metal: 15 }, spriteFrame: 68, attackType: 'swing',  arcDeg: 115 },
};

const ENEMIES = {
    SHADOW_WISP:    { name: 'Shadow Wisp',    hp: 14,  damage: 5,  speed: 104, xp: 5,  size: 12, color: 0x4444AA, gold: 1 },
    SHADOW_STALKER: { name: 'Shadow Stalker', hp: 35,  damage: 12, speed: 76,  xp: 15, size: 18, color: 0x6622AA, gold: 2 },
    SHADOW_BEAST:   { name: 'Shadow Beast',   hp: 84,  damage: 25, speed: 52,  xp: 35, size: 28, color: 0x440066, gold: 4 },
    SHADOW_LORD:    { name: 'Shadow Lord',    hp: 210, damage: 40, speed: 44,  xp: 100, size: 36, color: 0x220044, gold: 10 },
    FOG_CRAWLER:    { name: 'Fog Crawler',    hp: 56,  damage: 0,  speed: 60,  xp: 25, size: 22, color: 0x333355, targetsFire: true, gold: 3 },
    SHADOW_ARCHER:  { name: 'Shadow Archer',  hp: 42,  damage: 14, speed: 62,  xp: 20, size: 16, color: 0x553388, gold: 3, ranged: true, projectileSpeed: 220, attackRange: 200, attackCooldown: 2200, projectileType: 'arrow' },
    VOID_MAGE:      { name: 'Void Mage',      hp: 65,  damage: 22, speed: 48,  xp: 40, size: 20, color: 0x6600AA, gold: 5, ranged: true, projectileSpeed: 160, attackRange: 240, attackCooldown: 3000, projectileType: 'magic' },
};

const BUILDINGS = {
    TURRET:         { name: 'Turret',          cost: { wood: 8, stone: 5 },               hp: 120, desc: 'Auto-attacks nearby enemies', attackRange: 180, attackDamage: 8, attackSpeed: 1200 },
    OUTPOST:        { name: 'Outpost',        cost: { wood: 20, stone: 10 },             hp: 200, lightRadius: 180, desc: 'Extends light' },
    FORGE:          { name: 'Forge',           cost: { wood: 15, stone: 20 },             hp: 150, unlocks: ['STONE_AXE'], desc: 'Unlocks Stone Axe' },
    WEAPON_SHOP:    { name: 'Weapon Shop',     cost: { wood: 10, stone: 15, metal: 10 },  hp: 150, unlocks: ['IRON_SWORD', 'FLAME_BLADE'], desc: 'Unlocks advanced weapons' },
    ARMOR_WORKSHOP: { name: 'Armor Workshop',  cost: { wood: 10, stone: 10, metal: 15 },  hp: 150, armorBonus: 0.3, desc: 'Reduces damage by 30%' },
    FRIEND_HUT:     { name: 'Friend Hut',      cost: { wood: 25, stone: 15, metal: 5 },   hp: 180, spawnsAlly: true, desc: 'Spawns NPC ally' },
};

// Weapons enemies can carry and drop — player can pick up and equip them
// damage here = what the player gets; enemies deal 40% of this (see ENEMY_WEAPON_DMG_MULT)
const ENEMY_WEAPONS = [
    { name: 'Rusty Blade',   damage: 14, range: 52, speed: 700, color: 0x998877, spriteFrame: 1,  attackType: 'swing',  arcDeg: 115 },
    { name: 'Bone Club',     damage: 10, range: 38, speed: 900, color: 0xCCBB99, spriteFrame: 21, attackType: 'swing',  arcDeg: 120 },
    { name: 'Dark Axe',      damage: 20, range: 50, speed: 650, color: 0x554433, spriteFrame: 17, attackType: 'swing',  arcDeg: 155 },
    { name: 'Shadow Blade',  damage: 22, range: 55, speed: 550, color: 0x662288, spriteFrame: 24, attackType: 'swing',  arcDeg: 115 },
    { name: 'Dark Dagger',   damage: 12, range: 34, speed: 300, color: 0x334455, spriteFrame: 0,  attackType: 'swing',  arcDeg: 50  },
    { name: 'Void Mace',     damage: 18, range: 48, speed: 800, color: 0x550077, spriteFrame: 28, attackType: 'swing',  arcDeg: 150 },
    { name: 'Plague Lance',  damage: 24, range: 65, speed: 520, color: 0x335533, spriteFrame: 35, attackType: 'thrust', arcDeg: 270 },
    { name: 'Hex Staff',     damage: 16, range: 80, speed: 600, color: 0x7733CC, spriteFrame: 25, attackType: 'shoot',  arcDeg: 30, hitRadius: 18, splashRadius: 50 },
];
const ENEMY_WEAPON_DMG_MULT = 0.4; // enemies deal 40% of the weapon's damage stat

// Shop — wandering merchant weapon templates
// Each weapon has base stats; actual values are randomized ±20% per session
const SHOP_WEAPONS = [
    { name: 'Short Sword',    baseDmg: 15, baseRange: 48, baseSpeed: 650, color: 0xAAAAAA, baseGold: 8,  spriteFrame: 1,  attackType: 'swing',  arcDeg: 115 },
    { name: 'Battle Axe',     baseDmg: 28, baseRange: 56, baseSpeed: 550, color: 0x888888, baseGold: 15, chopBonus: 3, spriteFrame: 17, attackType: 'swing',  arcDeg: 155 },
    { name: 'War Hammer',     baseDmg: 35, baseRange: 50, baseSpeed: 700, color: 0x666688, baseGold: 20, spriteFrame: 28, attackType: 'swing',  arcDeg: 150 },
    { name: 'Elven Bow',      baseDmg: 12, baseRange: 120, baseSpeed: 400, color: 0x88AA44, baseGold: 18, hitRadius: 20, spriteFrame: 16, attackType: 'shoot',  arcDeg: 25 },
    { name: 'Crystal Staff',  baseDmg: 18, baseRange: 90,  baseSpeed: 550, color: 0xAA44FF, baseGold: 22, shadowBonus: 1.3, spriteFrame: 25, attackType: 'shoot',  arcDeg: 30, splashRadius: 55 },
    { name: 'Obsidian Blade', baseDmg: 40, baseRange: 62, baseSpeed: 380, color: 0x333344, baseGold: 30, shadowBonus: 1.4, spriteFrame: 24, attackType: 'swing',  arcDeg: 115 },
    { name: 'Fire Lance',     baseDmg: 32, baseRange: 70, baseSpeed: 450, color: 0xFF6622, baseGold: 25, spriteFrame: 35, attackType: 'thrust', arcDeg: 270 },
    { name: 'Shadow Dagger',  baseDmg: 18, baseRange: 36, baseSpeed: 250, color: 0x442266, baseGold: 14, shadowBonus: 1.6, spriteFrame: 0,  attackType: 'swing',  arcDeg: 50  },
    { name: 'Holy Mace',      baseDmg: 22, baseRange: 52, baseSpeed: 600, color: 0xFFDD88, baseGold: 16, shadowBonus: 1.8, spriteFrame: 40, attackType: 'swing',  arcDeg: 150 },
    { name: 'Runic Greatsword', baseDmg: 45, baseRange: 68, baseSpeed: 500, color: 0x4488FF, baseGold: 35, spriteFrame: 41, attackType: 'swing',  arcDeg: 130 },
];

// How many weapons the shop offers per session
const SHOP_ITEM_COUNT = 4;

// Objectives — randomly selected per map session
// Each objective has: type (tracking key), desc (display text), target (amount needed), reward
const OBJECTIVES = [
    // Resource gathering
    { type: 'wood_collected',   desc: 'Collect {n} wood',          target: [30, 50, 80],   reward: { gold: 5 } },
    { type: 'stone_collected',  desc: 'Collect {n} stone',         target: [15, 25, 40],   reward: { gold: 5 } },
    { type: 'metal_collected',  desc: 'Collect {n} metal',         target: [10, 18, 30],   reward: { gold: 8 } },
    { type: 'gold_collected',   desc: 'Collect {n} gold',          target: [20, 40, 60],   reward: { wood: 15, stone: 10 } },

    // Combat
    { type: 'enemies_killed',   desc: 'Kill {n} enemies',          target: [15, 30, 50],   reward: { gold: 8 } },
    { type: 'raiders_killed',   desc: 'Kill {n} raiders',          target: [8, 15, 25],    reward: { gold: 10 } },
    { type: 'archers_killed',   desc: 'Kill {n} shadow archers',   target: [5, 10, 18],    reward: { gold: 12, metal: 5 } },
    { type: 'mages_killed',     desc: 'Kill {n} void mages',       target: [3, 7, 12],     reward: { gold: 15, metal: 8 } },
    { type: 'waves_survived',   desc: 'Survive {n} waves',         target: [5, 10, 15],    reward: { gold: 10, wood: 10 } },

    // Camp progression
    { type: 'fire_level',       desc: 'Reach fire level {n}',      target: [3, 4, 5],      reward: { gold: 10 } },
    { type: 'fuel_added',       desc: 'Add {n} fuel to bonfires',  target: [15, 30, 50],   reward: { gold: 5, wood: 5 } },
    { type: 'buildings_built',  desc: 'Build {n} structures',      target: [2, 4, 6],      reward: { gold: 8, stone: 5 } },
    { type: 'second_camp_lit',  desc: 'Find and light the abandoned camp', target: [1, 1, 1], reward: { gold: 15, wood: 20 } },

    // Exploration / misc
    { type: 'trees_chopped',    desc: 'Chop down {n} trees',       target: [10, 25, 40],   reward: { gold: 5 } },
    { type: 'stones_mined',     desc: 'Mine {n} stone deposits',   target: [8, 15, 25],    reward: { gold: 5 } },
];

// How many objectives to give per session
const OBJECTIVES_PER_SESSION = 4;

// Mutable game state — reset on new game
function createGameState() {
    return {
        hp: CONFIG.PLAYER_MAX_HP,
        resources: { wood: 5, stone: 0, metal: 0, gold: 0 },
        fuelAdded: 0,        // cumulative wood put into fire
        fireLevel: 1,        // current fire camp level
        weapon: 'WOODEN_CLUB',
        armor: 0,
        unlockedWeapons: ['WOODEN_CLUB'],
        unlockedBuildings: [],
        buildings: [],
        kills: 0,
        time: 0,
        waveNumber: 0,
        craftingOpen: false,
        buildMode: false,
        buildType: null,
        gameOver: false,
        hasTorch: false,
    };
}

let gameState = createGameState();
