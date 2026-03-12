// ============================================================
// PROCEDURAL TEXTURE GENERATION
// ============================================================

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

    // Ground tiles
    for (let i = 0; i < 4; i++) {
        g.clear();
        const base = [0x1a2a1a, 0x1c2c1c, 0x182818, 0x1b2b1b][i];
        g.fillStyle(base, 1);
        g.fillRect(0, 0, 32, 32);
        for (let d = 0; d < 8; d++) {
            g.fillStyle(0x223322, 0.3);
            g.fillRect(Math.random() * 30, Math.random() * 30, 2, 2);
        }
        g.generateTexture('ground' + i, 32, 32);
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

    // Tree
    g.clear();
    g.fillStyle(0x4A3520, 1);
    g.fillRect(12, 28, 8, 20);
    g.fillStyle(0x1B5E20, 1);
    g.fillCircle(16, 18, 16);
    g.fillStyle(0x2E7D32, 0.5);
    g.fillCircle(12, 14, 10);
    g.fillCircle(22, 16, 9);
    g.generateTexture('tree', 32, 48);

    // Tree stump
    g.clear();
    g.fillStyle(0x4A3520, 1);
    g.fillRect(10, 10, 12, 10);
    g.fillStyle(0x5D4E37, 1);
    g.fillEllipse(16, 10, 14, 6);
    g.generateTexture('stump', 32, 24);

    // Stone deposit
    g.clear();
    g.fillStyle(0x666666, 1);
    g.fillCircle(16, 20, 12);
    g.fillStyle(0x777777, 0.6);
    g.fillCircle(12, 16, 7);
    g.fillStyle(0x555555, 0.8);
    g.fillCircle(22, 22, 6);
    g.generateTexture('stone', 32, 32);

    // Metal ore
    g.clear();
    g.fillStyle(0x5C4033, 1);
    g.fillCircle(16, 20, 12);
    g.fillStyle(0xB87333, 0.8);
    g.fillCircle(10, 16, 5);
    g.fillCircle(20, 22, 4);
    g.fillCircle(16, 14, 3);
    g.generateTexture('metal', 32, 32);

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

    // Attack slash
    g.clear();
    g.fillStyle(0xFFFFFF, 0.8);
    for (let a = -0.7; a <= 0.7; a += 0.15) {
        g.fillCircle(16 + Math.cos(a) * 14, 16 + Math.sin(a) * 14, 2);
    }
    g.generateTexture('slash', 32, 32);

    // Menu tree silhouettes (larger, atmospheric)
    g.clear();
    g.fillStyle(0x0A0A0A, 1);
    g.fillRect(14, 60, 4, 40);
    g.fillStyle(0x080808, 1);
    g.fillCircle(16, 40, 22);
    g.fillCircle(10, 30, 16);
    g.fillCircle(24, 35, 14);
    g.generateTexture('menu_tree', 48, 100);

    g.destroy();
}
