import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { AssetLoader } from '../engine/AssetLoader';
import { CONFIG, ENEMIES } from '../config';
import { EnemyType } from '../types';

// Components
import { HealthComponent } from '../components/HealthComponent';
import { GridOccupancyComponent } from '../components/GridOccupancyComponent';
import { LightSourceComponent } from '../components/LightSourceComponent';
import { AIBrainComponent } from '../components/AIBrainComponent';
import { SpriteRendererComponent } from '../components/SpriteRendererComponent';
import { AnimatedSpriteComponent } from '../components/AnimatedSpriteComponent';
import { MeleeAttackComponent } from '../components/MeleeAttackComponent';
import { RangedAttackComponent } from '../components/RangedAttackComponent';
import { ResourceComponent } from '../components/ResourceComponent';
import { BonfireAnimComponent } from '../components/BonfireAnimComponent';

/**
 * Entity factory — creates game entities by assembling components.
 * Like Unity's prefab system. All entity creation goes through here.
 */
export class EntityFactory {

  static createPlayer(scene: ex.Scene, x: number, y: number, name: string): GameEntity {
    const player = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    player.entityType = 'player';

    player.addComponent(new SpriteRendererComponent({
      rotations: AssetLoader.maleRotations,
      fallback: { width: 16, height: 24, color: ex.Color.fromHex('#FFAA44') },
    }));
    // 1000 HP for testing, CONFIG.PLAYER_MAX_HP for production
    player.addComponent(new HealthComponent(1000));
    player.addComponent(new MeleeAttackComponent({
      damage: 10, range: 32, cooldownMs: 800, damageFrame: 2, totalFrames: 3, arcDeg: 120,
    }));

    scene.add(player);

    // Name label
    const label = new ex.Label({
      text: name,
      pos: ex.vec(x, y - 28),
      font: new ex.Font({ family: 'monospace', size: 8, color: ex.Color.White, textAlign: ex.TextAlign.Center }),
    });
    label.z = 9999;
    scene.add(label);
    scene.on('preupdate', () => {
      label.pos = player.pos.add(ex.vec(0, -28));
      label.z = player.z + 0.1;
    });

    return player;
  }

  static createEnemy(scene: ex.Scene, x: number, y: number, type: EnemyType): GameEntity {
    const def = ENEMIES[type];
    const enemy = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    enemy.entityType = 'enemy';

    // Animated sprite with walk + attack animations
    const sprites = AssetLoader.enemySprites[type] ?? {};
    const r = (def.color >> 16) & 0xFF, g = (def.color >> 8) & 0xFF, b = def.color & 0xFF;
    const typeKey = type.toLowerCase();

    // Load animation frames (may not all exist yet — graceful fallback)
    const walkFrames = AssetLoader.getEnemyAnimFrames(type, 'walking');
    // Ranged enemies use 'fireball' attack animation, melee use 'cross-punch'
    const attackAnimName = def.ranged ? 'fireball' : 'cross-punch';
    const attackFrames = AssetLoader.getEnemyAnimFrames(type, attackAnimName);

    enemy.addComponent(new AnimatedSpriteComponent({
      rotations: sprites,
      walkFrames,
      walkFrameRate: 10,
      attackFrames,
      attackFrameRate: 12,
      attackDamageFrame: 3,
      fallback: { width: def.size, height: def.size, color: ex.Color.fromRGB(r, g, b) },
    }));

    // Health
    enemy.addComponent(new HealthComponent(def.hp));

    // AI Brain
    enemy.addComponent(new AIBrainComponent(type, def.speed, def.damage, {
      ranged: def.ranged,
      attackRange: def.attackRange ?? 30,
      attackCooldown: def.attackCooldown ?? 1000,
    }));

    // Attack component — melee or ranged
    if (def.ranged) {
      enemy.addComponent(new RangedAttackComponent({
        damage: def.damage,
        range: def.attackRange ?? 200,
        cooldownMs: def.attackCooldown ?? 2000,
        projectileSpeed: def.projectileSpeed ?? 200,
        projectileType: def.projectileType ?? 'arrow',
      }));
    } else {
      enemy.addComponent(new MeleeAttackComponent({
        damage: def.damage,
        range: CONFIG.ENEMY_MELEE_RANGE + def.size,
        cooldownMs: 1000,
        damageFrame: 3,
        totalFrames: 6,
      }));
    }

    // Fade in
    enemy.graphics.opacity = 0;
    enemy.actions.fade(1, 600);

    scene.add(enemy);
    return enemy;
  }

  static createTree(scene: ex.Scene, x: number, y: number, tx: number, ty: number, variant: number): GameEntity {
    const tree = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.8) });
    tree.entityType = 'tree';

    const src = AssetLoader.treeVariants[variant];
    if (src?.isLoaded()) {
      tree.graphics.use(src.toSprite());
    } else {
      tree.graphics.use(new ex.Rectangle({ width: 22, height: 40, color: ex.Color.fromHex('#1a5a1a') }));
    }

    tree.addComponent(new HealthComponent(30));
    tree.addComponent(new GridOccupancyComponent({ tx, ty }));
    tree.addComponent(new ResourceComponent('wood', CONFIG.WOOD_PER_TREE));

    scene.add(tree);
    return tree;
  }

  static createStone(scene: ex.Scene, x: number, y: number, tx: number, ty: number): GameEntity {
    const stone = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    stone.entityType = 'stone';

    if (AssetLoader.stoneDeposit.isLoaded()) {
      stone.graphics.use(AssetLoader.stoneDeposit.toSprite());
    } else {
      stone.graphics.use(new ex.Rectangle({ width: 20, height: 16, color: ex.Color.fromHex('#666666') }));
    }

    stone.addComponent(new HealthComponent(40));
    stone.addComponent(new GridOccupancyComponent({ tx, ty }));
    stone.addComponent(new ResourceComponent('stone', CONFIG.STONE_PER_DEPOSIT));

    scene.add(stone);
    return stone;
  }

  static createMetal(scene: ex.Scene, x: number, y: number, tx: number, ty: number): GameEntity {
    const metal = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    metal.entityType = 'metal';

    if (AssetLoader.metalOre.isLoaded()) {
      metal.graphics.use(AssetLoader.metalOre.toSprite());
    } else {
      metal.graphics.use(new ex.Rectangle({ width: 20, height: 16, color: ex.Color.fromHex('#CC8844') }));
    }

    metal.addComponent(new HealthComponent(50));
    metal.addComponent(new GridOccupancyComponent({ tx, ty }));
    metal.addComponent(new ResourceComponent('metal', CONFIG.METAL_PER_DEPOSIT));

    scene.add(metal);
    return metal;
  }

  static createBonfire(scene: ex.Scene, x: number, y: number): GameEntity {
    const bf = new GameEntity({ pos: ex.vec(x, y), anchor: ex.vec(0.5, 0.5) });
    bf.entityType = 'bonfire';
    bf.z = 3;

    // Bonfire pixel art sprite with pulse
    if (AssetLoader.bonfireSprite.isLoaded()) {
      bf.graphics.use(AssetLoader.bonfireSprite.toSprite());
    } else {
      bf.graphics.use(new ex.Rectangle({ width: 20, height: 10, color: ex.Color.fromHex('#5a3a1a') }));
    }
    // Subtle scale pulse like original
    let bfPulse = 0;
    bf.on('preupdate', () => {
      bfPulse += 0.004;
      const s = 1.0 + Math.sin(bfPulse) * 0.06;
      bf.scale = ex.vec(s, s);
    });
    bf.addComponent(new LightSourceComponent({
      radius: CONFIG.BONFIRE_BASE_RADIUS, intensity: 1.0, softness: 0.5,
      tintR: 1.0, tintG: 0.47, tintB: 0.16, tintA: 0.12,
    }));

    // Fire particles
    const fireTimer = new ex.Timer({
      interval: 80, repeats: true,
      fcn: () => {
        const spark = new ex.Actor({
          pos: ex.vec(x + (Math.random() - 0.5) * 10, y - 4),
          width: 3 + Math.random() * 3, height: 3 + Math.random() * 3,
          color: Math.random() > 0.5 ? ex.Color.fromHex('#FF6600') : ex.Color.fromHex('#FFDD44'),
          anchor: ex.vec(0.5, 0.5),
        });
        spark.z = 10;
        spark.vel = ex.vec((Math.random() - 0.5) * 20, -20 - Math.random() * 30);
        spark.actions.fade(0, 600).die();
        scene.add(spark);
      },
    });
    scene.add(fireTimer);
    fireTimer.start();

    scene.add(bf);
    return bf;
  }
}
