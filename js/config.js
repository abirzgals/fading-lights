// ============================================================
// GAME CONFIGURATION & DATA
// ============================================================

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
    SPAWN_INTERVAL: 9000,
    SPAWN_MARGIN: 120,
    MAX_ENEMIES: 15,
    FUEL_SPAWN_BURST: 2,       // enemies spawned when upgrading fire

    // Raider system (camp level 2+)
    RAID_SPAWN_INTERVAL: 12000,  // ms between raid spawns
    RAID_SIGHT_RANGE: 160,       // px — raider notices player
    RAID_LEASH_RANGE: 280,       // px — raider gives up chasing player
    RAID_ATTACK_RANGE: 35,       // px — raider attacks camp bonfire/buildings

    // Fire camp levels: fuel needed to reach each level
    // Level 1 = start, Level 2 = 5 fuel, Level 3 = 12, Level 4 = 22, Level 5 = 35
    FIRE_LEVELS: [0, 5, 12, 22, 35, 55],

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
    WOODEN_CLUB:  { name: 'Wooden Club',  damage: 10, range: 44, speed: 800, tier: 0, color: 0x8B6914 },
    STONE_AXE:    { name: 'Stone Axe',    damage: 18, range: 52, speed: 600, tier: 1, color: 0x888888, chopBonus: 2, cost: { wood: 10, stone: 8 } },
    IRON_SWORD:   { name: 'Iron Sword',   damage: 30, range: 60, speed: 400, tier: 2, color: 0xC0C0C0, cost: { wood: 5, stone: 10, metal: 8 } },
    FLAME_BLADE:  { name: 'Flame Blade',  damage: 38, range: 65, speed: 350, tier: 3, color: 0xFF6600, shadowBonus: 1.5, cost: { wood: 5, stone: 5, metal: 15 } },
};

const ENEMIES = {
    SHADOW_WISP:    { name: 'Shadow Wisp',    hp: 14,  damage: 5,  speed: 104, xp: 5,  size: 12, color: 0x4444AA, gold: 1 },
    SHADOW_STALKER: { name: 'Shadow Stalker', hp: 35,  damage: 12, speed: 76,  xp: 15, size: 18, color: 0x6622AA, gold: 2 },
    SHADOW_BEAST:   { name: 'Shadow Beast',   hp: 84,  damage: 25, speed: 52,  xp: 35, size: 28, color: 0x440066, gold: 4 },
    SHADOW_LORD:    { name: 'Shadow Lord',    hp: 210, damage: 40, speed: 44,  xp: 100, size: 36, color: 0x220044, gold: 10 },
    FOG_CRAWLER:    { name: 'Fog Crawler',    hp: 56,  damage: 0,  speed: 60,  xp: 25, size: 22, color: 0x333355, targetsFire: true, gold: 3 },
};

const BUILDINGS = {
    TURRET:         { name: 'Turret',          cost: { wood: 8, stone: 5 },               hp: 120, desc: 'Auto-attacks nearby enemies', attackRange: 180, attackDamage: 8, attackSpeed: 1200 },
    OUTPOST:        { name: 'Outpost',        cost: { wood: 20, stone: 10 },             hp: 200, lightRadius: 180, desc: 'Extends light' },
    FORGE:          { name: 'Forge',           cost: { wood: 15, stone: 20 },             hp: 150, unlocks: ['STONE_AXE'], desc: 'Unlocks Stone Axe' },
    WEAPON_SHOP:    { name: 'Weapon Shop',     cost: { wood: 10, stone: 15, metal: 10 },  hp: 150, unlocks: ['IRON_SWORD', 'FLAME_BLADE'], desc: 'Unlocks advanced weapons' },
    ARMOR_WORKSHOP: { name: 'Armor Workshop',  cost: { wood: 10, stone: 10, metal: 15 },  hp: 150, armorBonus: 0.3, desc: 'Reduces damage by 30%' },
    FRIEND_HUT:     { name: 'Friend Hut',      cost: { wood: 25, stone: 15, metal: 5 },   hp: 180, spawnsAlly: true, desc: 'Spawns NPC ally' },
};

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
    };
}

let gameState = createGameState();
