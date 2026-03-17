// ============================================================
// PROCEDURAL TEXTURE GENERATION
// ============================================================

// Map a facing vector {x, y} to one of 8 compass direction strings
function facingToDirection(fx, fy) {
    const angle = Math.atan2(fy, fx);
    // Quantize to 8 sectors (each 45° = PI/4)
    const sector = Math.round(angle / (Math.PI / 4));
    const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
    return dirs[((sector % 8) + 8) % 8];
}

function generatePlayerTexture(scene, g, key, tshirtColor) {
    g.clear();
    // Head (skin)
    g.fillStyle(0xDDCCAA, 1);
    g.fillCircle(16, 14, 8);
    // Tshirt body
    g.fillStyle(tshirtColor, 1);
    g.fillRect(10, 22, 12, 14);
    // Legs
    g.fillStyle(0x6B5B3A, 1);
    g.fillRect(10, 36, 5, 8);
    g.fillRect(17, 36, 5, 8);
    g.generateTexture(key, 32, 48);
}

function getPlayerTextureKey(color) {
    return 'player_' + color.toString(16).padStart(6, '0');
}

function generateTextures(scene) {
    const g = scene.make.graphics({ add: false });

    // Ground tiles — dark forest floor matching the pixel art tileset
    for (let i = 0; i < 4; i++) {
        g.clear();
        const base = [0x1e3520, 0x213822, 0x1b311d, 0x1f3621][i];
        g.fillStyle(base, 1);
        g.fillRect(0, 0, 32, 32);
        for (let d = 0; d < 6; d++) {
            g.fillStyle(0x2a4a2a, 0.25);
            g.fillRect(Math.random() * 30, Math.random() * 30, 2, 2);
        }
        for (let d = 0; d < 3; d++) {
            g.fillStyle(0x162a16, 0.3);
            g.fillRect(Math.random() * 28, Math.random() * 28, 3, 2);
        }
        g.generateTexture('ground' + i, 32, 32);
    }

    // Road / dirt path tiles (4 variants for variety)
    for (let i = 0; i < 4; i++) {
        g.clear();
        const base = [0x5C4A32, 0x584630, 0x54422E, 0x5A4834][i];
        g.fillStyle(base, 1);
        g.fillRect(0, 0, 32, 32);
        // Dirt specks
        for (let d = 0; d < 6; d++) {
            g.fillStyle(0x6B5A40, 0.4);
            g.fillRect(Math.random() * 28, Math.random() * 28, 3, 2);
        }
        // Small pebbles
        for (let d = 0; d < 3; d++) {
            g.fillStyle(0x7A6B50, 0.3);
            g.fillCircle(Math.random() * 28 + 2, Math.random() * 28 + 2, 1);
        }
        g.generateTexture('road' + i, 32, 32);
    }

    // Road edge tiles (transition from road to grass)
    for (let i = 0; i < 4; i++) {
        g.clear();
        const base = [0x3D5A33, 0x3A5630, 0x385230, 0x3C5834][i];
        g.fillStyle(base, 1);
        g.fillRect(0, 0, 32, 32);
        // Mix of dirt and grass specks
        for (let d = 0; d < 4; d++) {
            g.fillStyle(0x5C4A32, 0.35);
            g.fillRect(Math.random() * 28, Math.random() * 28, 4, 3);
        }
        for (let d = 0; d < 4; d++) {
            g.fillStyle(0x4A6A3A, 0.3);
            g.fillRect(Math.random() * 28, Math.random() * 28, 3, 2);
        }
        g.generateTexture('road_edge' + i, 32, 32);
    }

    // Player (default green tshirt)
    generatePlayerTexture(scene, g, 'player', 0x557755);

    // Pre-generate all tshirt color variants for multiplayer
    if (typeof network !== 'undefined') {
        for (const color of network.TSHIRT_COLORS) {
            const key = 'player_' + color.toString(16).padStart(6, '0');
            if (!scene.textures.exists(key)) {
                generatePlayerTexture(scene, g, key, color);
            }
        }
    }

    // Tree (skip if pixel art loaded)
    if (!scene.textures.exists('dark_tree')) {
        g.clear();
        g.fillStyle(0x4A3520, 1);
        g.fillRect(12, 28, 8, 20);
        g.fillStyle(0x1B5E20, 1);
        g.fillCircle(16, 18, 16);
        g.fillStyle(0x2E7D32, 0.5);
        g.fillCircle(12, 14, 10);
        g.fillCircle(22, 16, 9);
        g.generateTexture('tree', 32, 48);
    }

    // Tree stump
    g.clear();
    g.fillStyle(0x4A3520, 1);
    g.fillRect(10, 10, 12, 10);
    g.fillStyle(0x5D4E37, 1);
    g.fillEllipse(16, 10, 14, 6);
    g.generateTexture('stump', 32, 24);

    // Stone deposit (skip if pixel art loaded)
    if (!scene.textures.exists('pa_stone')) {
        g.clear();
        g.fillStyle(0x666666, 1);
        g.fillCircle(16, 20, 12);
        g.fillStyle(0x777777, 0.6);
        g.fillCircle(12, 16, 7);
        g.fillStyle(0x555555, 0.8);
        g.fillCircle(22, 22, 6);
        g.generateTexture('stone', 32, 32);
    }

    // Metal ore (skip if pixel art loaded)
    if (!scene.textures.exists('pa_metal')) {
        g.clear();
        g.fillStyle(0x5C4033, 1);
        g.fillCircle(16, 20, 12);
        g.fillStyle(0xB87333, 0.8);
        g.fillCircle(10, 16, 5);
        g.fillCircle(20, 22, 4);
        g.fillCircle(16, 14, 3);
        g.generateTexture('metal', 32, 32);
    }

    // Rock wall (skip if pixel art loaded)
    if (!scene.textures.exists('pa_rock_wall')) {
        g.clear();
        g.fillStyle(0x4A4A4A, 1);
        g.fillEllipse(32, 30, 58, 36);
        g.fillStyle(0x555555, 0.7);
        g.fillEllipse(24, 24, 32, 22);
        g.fillEllipse(42, 26, 28, 20);
        g.fillStyle(0x3A3A3A, 0.8);
        g.fillEllipse(32, 36, 44, 20);
        g.fillStyle(0x606060, 0.4);
        g.fillRect(18, 22, 6, 2);
        g.fillRect(38, 28, 8, 2);
        g.fillStyle(0x383838, 0.5);
        g.fillRect(26, 32, 12, 1);
        g.generateTexture('rock_wall', 64, 48);
    }

    // Metal mine (skip if pixel art loaded)
    if (!scene.textures.exists('pa_metal_mine')) {
        g.clear();
        g.fillStyle(0x444444, 1);
        g.fillEllipse(24, 28, 44, 36);
        g.fillStyle(0x505050, 0.7);
        g.fillEllipse(18, 22, 24, 18);
        g.fillEllipse(32, 24, 20, 16);
        g.fillStyle(0x222222, 0.9);
        g.fillEllipse(24, 30, 16, 12);
        g.fillStyle(0xCC7733, 0.9);
        g.fillRect(8, 18, 6, 3);
        g.fillRect(34, 16, 5, 3);
        g.fillRect(12, 34, 7, 2);
        g.fillStyle(0xDD8844, 0.7);
        g.fillCircle(10, 20, 2);
        g.fillCircle(38, 18, 2);
        g.fillCircle(14, 36, 2);
        g.fillStyle(0xBB6622, 0.6);
        g.fillRect(28, 36, 8, 2);
        g.generateTexture('metal_mine', 48, 48);
    }

    // Bonfire
    g.clear();
    g.fillStyle(0x4A3520, 1);
    g.fillRect(6, 24, 20, 6);
    g.fillStyle(0x3E2C1A, 1);
    g.fillRect(4, 22, 8, 4);
    g.fillRect(20, 22, 8, 4);
    g.fillStyle(0x555555, 1);
    for (let a = 0; a < 8; a++) {
        const ax = 16 + Math.cos(a * Math.PI / 4) * 14;
        const ay = 26 + Math.sin(a * Math.PI / 4) * 8;
        g.fillCircle(ax, ay, 3);
    }
    g.generateTexture('bonfire', 32, 32);

    // Particle
    g.clear();
    g.fillStyle(0xFFFFFF, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('particle', 8, 8);

    // Soft glow (for menu)
    g.clear();
    g.fillStyle(0xFFFFFF, 1);
    g.fillCircle(16, 16, 16);
    g.generateTexture('glow', 32, 32);

    // Resource drops
    g.clear();
    g.fillStyle(0x8B6914, 1);
    g.fillRect(2, 6, 12, 4);
    g.generateTexture('wood_drop', 16, 16);

    g.clear();
    g.fillStyle(0x888888, 1);
    g.fillCircle(8, 8, 6);
    g.generateTexture('stone_drop', 16, 16);

    g.clear();
    g.fillStyle(0xB87333, 1);
    g.fillCircle(8, 8, 5);
    g.fillStyle(0xCC8844, 0.5);
    g.fillCircle(6, 6, 2);
    g.generateTexture('metal_drop', 16, 16);

    // Gold drop (coin)
    g.clear();
    g.fillStyle(0xFFD700, 1);
    g.fillCircle(8, 8, 5);
    g.fillStyle(0xFFEE44, 0.6);
    g.fillCircle(6, 6, 2);
    g.fillStyle(0xCC9900, 0.5);
    g.fillCircle(10, 10, 2);
    g.generateTexture('gold_drop', 16, 16);

    // Heart drop (big round monsters)
    g.clear();
    g.fillStyle(0xFF1144, 1);
    g.fillCircle(5, 5, 4);   // left lobe
    g.fillCircle(10, 5, 4);  // right lobe
    g.fillTriangle(1, 6, 14, 6, 7, 14); // bottom point
    g.fillStyle(0xFF6688, 0.6);
    g.fillCircle(4, 4, 2);   // highlight
    g.generateTexture('heart_drop', 15, 15);

    // Buildings
    // Turret
    g.clear();
    g.fillStyle(0x444444, 1);
    g.fillRect(8, 14, 16, 18);    // base
    g.fillStyle(0x666666, 1);
    g.fillRect(10, 8, 12, 10);    // head
    g.fillStyle(0xFF4400, 0.8);
    g.fillRect(13, 4, 6, 6);      // barrel/eye
    g.generateTexture('building_turret', 32, 32);

    // Build spot placeholder (ghostly circle)
    g.clear();
    g.lineStyle(2, 0xFF8800, 0.5);
    g.strokeCircle(16, 16, 14);
    g.fillStyle(0xFF8800, 0.08);
    g.fillCircle(16, 16, 14);
    g.generateTexture('build_spot', 32, 32);

    // Locked build spot (darker)
    g.clear();
    g.lineStyle(1, 0x555555, 0.3);
    g.strokeCircle(16, 16, 14);
    g.fillStyle(0x333333, 0.05);
    g.fillCircle(16, 16, 14);
    g.generateTexture('build_spot_locked', 32, 32);

    // Outpost
    g.clear();
    g.fillStyle(0x4A3520, 1);
    g.fillRect(4, 8, 24, 24);
    g.fillStyle(0xFF6600, 0.6);
    g.fillCircle(16, 16, 6);
    g.generateTexture('building_outpost', 32, 32);

    g.clear();
    g.fillStyle(0x555555, 1);
    g.fillRect(2, 6, 28, 26);
    g.fillStyle(0xFF4400, 0.7);
    g.fillRect(10, 10, 12, 10);
    g.generateTexture('building_forge', 32, 32);

    g.clear();
    g.fillStyle(0x3A3A4A, 1);
    g.fillRect(2, 6, 28, 26);
    g.fillStyle(0xC0C0C0, 0.6);
    g.fillRect(12, 8, 3, 18);
    g.fillRect(8, 14, 16, 3);
    g.generateTexture('building_weapon_shop', 32, 32);

    g.clear();
    g.fillStyle(0x3A3A3A, 1);
    g.fillRect(2, 6, 28, 26);
    g.fillStyle(0x7777AA, 0.6);
    g.fillCircle(16, 18, 8);
    g.generateTexture('building_armor_workshop', 32, 32);

    g.clear();
    g.fillStyle(0x5D4E37, 1);
    g.fillRect(4, 12, 24, 20);
    g.fillStyle(0x8B6914, 1);
    g.fillTriangle(2, 14, 16, 2, 30, 14);
    g.generateTexture('building_friend_hut', 32, 32);

    // NPC ally
    g.clear();
    g.fillStyle(0xAAAADD, 1);
    g.fillCircle(16, 14, 7);
    g.fillStyle(0x5555AA, 1);
    g.fillRect(11, 21, 10, 12);
    g.generateTexture('ally', 32, 40);

    // Enemies
    g.clear();
    g.fillStyle(0x4444AA, 0.3);
    g.fillCircle(12, 12, 10);
    g.fillStyle(0xFF0000, 1);
    g.fillCircle(8, 10, 2);
    g.fillCircle(16, 10, 2);
    g.generateTexture('enemy_wisp', 24, 24);

    // Shadow Stalker (skip if pixel art loaded)
    if (!scene.textures.exists('stalker_south')) {
        g.clear();
        g.fillStyle(0x220033, 0.7);
        g.fillCircle(16, 10, 8);
        g.fillRect(10, 18, 12, 16);
        g.fillRect(8, 34, 6, 8);
        g.fillRect(18, 34, 6, 8);
        g.fillStyle(0xFF2200, 1);
        g.fillCircle(12, 9, 2);
        g.fillCircle(20, 9, 2);
        g.generateTexture('enemy_stalker', 32, 44);
    }

    g.clear();
    g.fillStyle(0x110022, 0.8);
    g.fillCircle(24, 24, 22);
    g.fillStyle(0x220033, 0.5);
    g.fillCircle(18, 18, 12);
    g.fillCircle(32, 20, 10);
    g.fillStyle(0xFF0000, 1);
    g.fillCircle(16, 16, 3);
    g.fillCircle(30, 16, 3);
    g.generateTexture('enemy_beast', 48, 48);

    g.clear();
    g.fillStyle(0x0A0015, 0.9);
    g.fillCircle(28, 32, 26);
    g.fillStyle(0x150025, 0.6);
    g.fillCircle(28, 24, 14);
    g.fillTriangle(16, 8, 20, 20, 12, 20);
    g.fillTriangle(28, 4, 32, 18, 24, 18);
    g.fillTriangle(40, 8, 44, 20, 36, 20);
    g.fillStyle(0xFF0044, 1);
    g.fillCircle(20, 26, 3);
    g.fillCircle(36, 26, 3);
    g.generateTexture('enemy_lord', 56, 60);

    g.clear();
    g.fillStyle(0x222244, 0.5);
    g.fillEllipse(20, 16, 36, 20);
    g.fillStyle(0x334466, 0.3);
    g.fillEllipse(20, 16, 28, 14);
    g.fillStyle(0x88AAFF, 0.8);
    g.fillCircle(12, 12, 2);
    g.fillCircle(28, 12, 2);
    g.generateTexture('enemy_crawler', 40, 32);

    // Shadow Mind — dark humanoid mirroring player shape, glowing purple eyes
    g.clear();
    // Shadow aura wisps (behind body)
    g.fillStyle(0x6600AA, 0.12);
    g.fillCircle(16, 24, 18);
    g.fillStyle(0x440088, 0.10);
    g.fillCircle(14, 28, 10);
    g.fillCircle(20, 26, 8);
    // Legs (dark void)
    g.fillStyle(0x0A0010, 1);
    g.fillRect(10, 36, 5, 8);
    g.fillRect(17, 36, 5, 8);
    // Purple-black boots
    g.fillStyle(0x1A0030, 1);
    g.fillRect(9, 40, 6, 4);
    g.fillRect(16, 40, 6, 4);
    // Body / torso (dark void)
    g.fillStyle(0x080012, 1);
    g.fillRect(10, 22, 12, 14);
    // Shoulder guards (dark purple)
    g.fillStyle(0x2A0050, 0.9);
    g.fillRect(8, 22, 4, 6);
    g.fillRect(20, 22, 4, 6);
    // Dark cloak over body
    g.fillStyle(0x110020, 0.7);
    g.fillRect(11, 24, 10, 10);
    // Head (shadow orb)
    g.fillStyle(0x0A0015, 1);
    g.fillCircle(16, 14, 8);
    // Glowing purple eyes
    g.fillStyle(0xCC44FF, 1);
    g.fillCircle(13, 13, 2.5);
    g.fillCircle(19, 13, 2.5);
    // Eye inner glow
    g.fillStyle(0xFFAAFF, 0.9);
    g.fillCircle(13, 12.5, 1);
    g.fillCircle(19, 12.5, 1);
    // Shadow wisps rising (top of head)
    g.fillStyle(0x8822CC, 0.25);
    g.fillCircle(13, 6, 3);
    g.fillCircle(19, 4, 2.5);
    g.fillCircle(16, 2, 2);
    g.generateTexture('enemy_shadow_mind', 32, 48);

    // Shadow Archer — hooded figure with bow
    g.clear();
    g.fillStyle(0x1A0033, 0.8);
    g.fillCircle(16, 10, 8);           // hood
    g.fillRect(10, 18, 12, 18);        // body/cloak
    g.fillRect(8, 36, 5, 8);           // left leg
    g.fillRect(19, 36, 5, 8);          // right leg
    g.fillStyle(0x553388, 0.6);
    g.fillRect(10, 18, 12, 6);         // shoulders
    // Bow (right side)
    g.lineStyle(2, 0x886622, 0.9);
    g.beginPath();
    g.arc(26, 22, 12, -1.2, 1.2);
    g.strokePath();
    g.lineStyle(1, 0xCCBB88, 0.7);
    g.lineBetween(26, 10, 26, 34);     // bowstring
    // Glowing eyes
    g.fillStyle(0xFF3300, 1);
    g.fillCircle(13, 9, 1.5);
    g.fillCircle(19, 9, 1.5);
    g.generateTexture('enemy_archer', 36, 44);

    // Void Mage — floating robed figure with staff
    g.clear();
    g.fillStyle(0x200044, 0.85);
    g.fillCircle(20, 12, 10);          // hood (larger)
    g.fillStyle(0x150030, 0.7);
    g.fillTriangle(8, 20, 32, 20, 20, 48);  // flowing robe
    g.fillStyle(0x2A0055, 0.5);
    g.fillTriangle(12, 22, 28, 22, 20, 44); // inner robe
    // Staff
    g.lineStyle(2, 0x664400, 0.9);
    g.lineBetween(34, 8, 34, 46);      // staff shaft
    // Staff orb (glowing)
    g.fillStyle(0xAA44FF, 0.9);
    g.fillCircle(34, 6, 5);
    g.fillStyle(0xDD88FF, 0.6);
    g.fillCircle(34, 6, 3);
    g.fillStyle(0xFFCCFF, 0.8);
    g.fillCircle(34, 5, 1.5);
    // Glowing eyes
    g.fillStyle(0xBB00FF, 1);
    g.fillCircle(16, 11, 2);
    g.fillCircle(24, 11, 2);
    g.generateTexture('enemy_mage', 42, 50);

    // Arrow projectile
    g.clear();
    g.fillStyle(0xCCBB88, 1);
    g.fillRect(2, 5, 16, 2);           // shaft
    g.fillStyle(0x888888, 1);
    g.fillTriangle(18, 3, 22, 6, 18, 9); // arrowhead
    g.fillStyle(0x886644, 0.7);
    g.fillTriangle(0, 3, 4, 6, 0, 9);   // fletching
    g.generateTexture('proj_arrow', 22, 12);

    // Magic orb projectile
    g.clear();
    g.fillStyle(0x8800FF, 0.6);
    g.fillCircle(8, 8, 8);
    g.fillStyle(0xBB44FF, 0.8);
    g.fillCircle(8, 8, 5);
    g.fillStyle(0xEE99FF, 0.9);
    g.fillCircle(8, 7, 3);
    g.fillStyle(0xFFDDFF, 1);
    g.fillCircle(7, 6, 1.5);
    g.generateTexture('proj_magic', 16, 16);

    // Monster Lair — dark cave/nest with glowing eyes inside (64x64)
    g.clear();
    // Cave mound (dark rock)
    g.fillStyle(0x1A1A2A, 1);
    g.fillEllipse(32, 40, 60, 44);
    g.fillStyle(0x222238, 0.8);
    g.fillEllipse(28, 34, 48, 36);
    g.fillEllipse(38, 36, 40, 32);
    // Cave entrance (dark hole)
    g.fillStyle(0x050508, 1);
    g.fillEllipse(32, 42, 28, 20);
    g.fillStyle(0x080810, 0.9);
    g.fillEllipse(32, 40, 22, 16);
    // Spiky protrusions on top
    g.fillStyle(0x181828, 1);
    g.fillTriangle(12, 24, 18, 8, 24, 24);
    g.fillTriangle(28, 20, 34, 4, 40, 20);
    g.fillTriangle(42, 22, 48, 10, 54, 24);
    // Eerie red glow from inside
    g.fillStyle(0xFF2200, 0.4);
    g.fillCircle(26, 42, 6);
    g.fillCircle(38, 42, 6);
    // Glowing eyes deep inside
    g.fillStyle(0xFF0000, 1);
    g.fillCircle(26, 41, 2.5);
    g.fillCircle(38, 41, 2.5);
    // Purple mist around base
    g.fillStyle(0x6622AA, 0.15);
    g.fillCircle(16, 52, 10);
    g.fillCircle(48, 50, 8);
    g.fillCircle(32, 56, 12);
    g.generateTexture('monster_lair', 64, 64);

    // Wandering Merchant Shop — wooden stall with lantern and sign
    g.clear();
    // Base platform (wooden planks)
    g.fillStyle(0x5D4E37, 1);
    g.fillRect(4, 32, 40, 16);
    g.fillStyle(0x4A3520, 0.8);
    g.fillRect(4, 34, 40, 2); // plank line
    g.fillRect(4, 40, 40, 2); // plank line
    // Counter/table
    g.fillStyle(0x6B5B3A, 1);
    g.fillRect(6, 24, 36, 10);
    g.fillStyle(0x7D6B4A, 0.6);
    g.fillRect(8, 26, 32, 2); // highlight
    // Awning (canopy)
    g.fillStyle(0x8B2252, 0.9);
    g.fillTriangle(0, 18, 24, 4, 48, 18);
    g.fillStyle(0xA0335E, 0.6);
    g.fillTriangle(6, 18, 24, 7, 42, 18); // lighter inner
    // Awning stripes
    g.fillStyle(0xCC9944, 0.5);
    g.fillRect(10, 12, 4, 7);
    g.fillRect(22, 8, 4, 11);
    g.fillRect(34, 12, 4, 7);
    // Support posts
    g.fillStyle(0x4A3520, 1);
    g.fillRect(6, 18, 3, 28);
    g.fillRect(39, 18, 3, 28);
    // Lantern (left post)
    g.fillStyle(0xFFAA00, 0.9);
    g.fillCircle(7, 16, 3);
    g.fillStyle(0xFFDD44, 0.6);
    g.fillCircle(7, 16, 2);
    // Wares on counter (sword, potion, scroll)
    g.fillStyle(0xC0C0C0, 0.9);
    g.fillRect(12, 22, 2, 8); // sword blade
    g.fillStyle(0x886622, 1);
    g.fillRect(11, 29, 4, 2); // sword handle
    g.fillStyle(0x44AA44, 0.8);
    g.fillCircle(24, 27, 3); // potion
    g.fillStyle(0xDDCC88, 0.7);
    g.fillRect(32, 23, 6, 8); // scroll
    g.fillStyle(0xBBAA77, 0.5);
    g.fillRect(33, 24, 4, 6); // scroll inner
    // Sign
    g.fillStyle(0x5D4E37, 1);
    g.fillRect(42, 6, 2, 14);
    g.fillStyle(0x8B6914, 1);
    g.fillRect(34, 4, 12, 8);
    g.fillStyle(0xFFD700, 0.8);
    g.fillCircle(40, 8, 2); // gold coin on sign
    g.generateTexture('shop', 48, 48);

    // Attack slash
    g.clear();
    g.fillStyle(0xFFFFFF, 0.8);
    for (let a = -0.7; a <= 0.7; a += 0.15) {
        g.fillCircle(16 + Math.cos(a) * 14, 16 + Math.sin(a) * 14, 2);
    }
    g.generateTexture('slash', 32, 32);

    // Arrow projectile (for bow weapons) — thin line with arrowhead
    g.clear();
    g.fillStyle(0xCCBB88, 1);
    g.fillRect(4, 7, 20, 2);          // shaft
    g.fillStyle(0xAAAAAA, 1);
    g.fillTriangle(24, 8, 18, 4, 18, 12); // arrowhead
    g.fillStyle(0x886644, 1);
    g.fillRect(2, 6, 4, 4);           // fletching
    g.generateTexture('arrow_proj', 28, 16);

    // Menu tree silhouettes (larger, atmospheric)
    g.clear();
    g.fillStyle(0x0A0A0A, 1);
    g.fillRect(14, 60, 4, 40);
    g.fillStyle(0x080808, 1);
    g.fillCircle(16, 40, 22);
    g.fillCircle(10, 30, 16);
    g.fillCircle(24, 35, 14);
    g.generateTexture('menu_tree', 48, 100);

    // Torch item drop — flickering flame on a stick
    g.clear();
    g.fillStyle(0x6B4C1A, 1);
    g.fillRect(6, 14, 4, 18);           // handle
    g.fillStyle(0xFFCC00, 1);
    g.fillCircle(8, 10, 6);             // main flame
    g.fillStyle(0xFF6600, 0.85);
    g.fillCircle(8, 8, 4);
    g.fillStyle(0xFFFFAA, 0.7);
    g.fillCircle(8, 7, 2);             // bright core
    g.generateTexture('torch_item', 16, 32);

    // Abandoned cave — like monster_lair but worn and warm-lit (no evil eyes)
    g.clear();
    // Rough stone base
    g.fillStyle(0x2A2830, 1);
    g.fillRect(0, 20, 64, 44);
    // Mossy/cracked stone blocks
    g.fillStyle(0x1E1C24, 1);
    g.fillRect(4, 28, 18, 14);
    g.fillRect(24, 32, 16, 10);
    g.fillRect(42, 26, 16, 14);
    g.fillStyle(0x35303E, 0.5);
    g.fillRect(6, 38, 14, 4);
    g.fillRect(44, 36, 12, 4);
    // Cave mouth (dark opening)
    g.fillStyle(0x0A080F, 1);
    g.fillEllipse(32, 44, 26, 18);
    g.fillStyle(0x100E18, 0.85);
    g.fillEllipse(32, 42, 20, 13);
    // Worn stone spires (crumbled, not sharp like lair)
    g.fillStyle(0x1A1820, 1);
    g.fillTriangle(10, 26, 16, 14, 22, 26);
    g.fillTriangle(26, 22, 32, 8,  38, 22);
    g.fillTriangle(42, 26, 48, 14, 54, 26);
    // Warm torch glow from inside (orange, not red/evil)
    g.fillStyle(0xFF8800, 0.18);
    g.fillCircle(32, 44, 14);
    g.fillStyle(0xFFCC44, 0.1);
    g.fillCircle(32, 42, 9);
    // Faint embers scattered on floor
    g.fillStyle(0xFF6600, 0.35);
    g.fillCircle(24, 50, 2);
    g.fillCircle(38, 52, 1.5);
    g.fillCircle(32, 55, 1.5);
    // Overgrown vines hint
    g.fillStyle(0x2A3B1A, 0.45);
    g.fillRect(0, 40, 6, 16);
    g.fillRect(58, 38, 6, 18);
    g.generateTexture('abandoned_cave', 64, 64);

    // Maze stone wall tile (32x32 — solid underground block)
    g.clear();
    g.fillStyle(0x2A2A35, 1);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x333340, 0.9);
    g.fillRect(1, 1, 14, 14);
    g.fillRect(17, 1, 14, 14);
    g.fillRect(1, 17, 30, 14);
    g.fillStyle(0x1E1E28, 0.6);
    g.fillRect(0, 15, 32, 2);
    g.fillRect(15, 0, 2, 15);
    g.fillStyle(0x3D3D4D, 0.3);
    g.fillRect(3, 3, 4, 2);
    g.fillRect(20, 5, 6, 2);
    g.fillRect(5, 22, 8, 2);
    g.fillRect(20, 25, 5, 2);
    g.generateTexture('maze_stone', 32, 32);

    // Maze floor tile (32x32 — dark underground floor)
    g.clear();
    g.fillStyle(0x18181F, 1);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x222230, 0.5);
    g.fillRect(0, 0, 32, 1);
    g.fillRect(0, 0, 1, 32);
    g.fillStyle(0x1C1C25, 0.4);
    for (let i = 0; i < 6; i++) {
        g.fillRect(Math.floor(Math.random() * 28) + 2, Math.floor(Math.random() * 28) + 2, 2, 1);
    }
    g.generateTexture('maze_floor', 32, 32);

    // Treasure chest (24x20)
    g.clear();
    g.fillStyle(0x7B4A0E, 1);
    g.fillRect(0, 6, 24, 14);           // chest body
    g.fillStyle(0x5C3508, 1);
    g.fillRect(0, 6, 24, 3);            // lid bottom edge
    g.fillStyle(0xA0631A, 1);
    g.fillRect(0, 0, 24, 9);            // lid
    g.fillStyle(0xFFCC00, 1);
    g.fillRect(9, 3, 6, 5);             // clasp
    g.fillRect(2, 8, 20, 2);            // metal band
    g.fillStyle(0xFFDD44, 0.6);
    g.fillRect(1, 1, 6, 2);             // highlight
    g.generateTexture('treasure_chest', 24, 20);

    g.destroy();
}
