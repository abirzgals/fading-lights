import * as ex from 'excalibur';
import { BuildingType, BuildingDef } from '../types';
import { BUILDINGS } from '../config';
import { GameEntity } from '../engine/GameEntity';
import { HealthComponent } from './HealthComponent';

/**
 * Building component — handles per-type behavior.
 * TURRET: auto-attacks nearest enemy in range
 * OUTPOST: just provides light (via LightSourceComponent)
 * FORGE/WEAPON_SHOP: passive unlock (checked by GameScene)
 * ARMOR_WORKSHOP: passive armor bonus (checked by GameScene)
 * FRIEND_HUT: spawns ally once (handled by GameScene)
 */
export class BuildingComponent extends ex.Component {
  public readonly type = 'Building';
  public readonly buildingType: BuildingType;
  public readonly def: BuildingDef;

  // Turret state
  private attackTimer = 0;
  private getEnemies: (() => GameEntity[]) | null = null;
  private scene: ex.Scene | null = null;

  constructor(buildingType: BuildingType) {
    super();
    this.buildingType = buildingType;
    this.def = BUILDINGS[buildingType];
  }

  /** Call from GameScene to provide enemy list for turrets */
  init(scene: ex.Scene, getEnemies: () => GameEntity[]): void {
    this.scene = scene;
    this.getEnemies = getEnemies;
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    if (this.buildingType !== 'TURRET') return;
    if (!this.scene || !this.getEnemies) return;

    const actor = this.owner as ex.Actor;
    if (!actor) return;

    this.attackTimer -= deltaMs;
    if (this.attackTimer > 0) return;

    const range = this.def.attackRange ?? 180;
    const damage = this.def.attackDamage ?? 8;
    const enemies = this.getEnemies();

    // Find nearest enemy in range
    let nearest: GameEntity | null = null;
    let nearestDist = Infinity;
    for (const e of enemies) {
      if (e.isKilled()) continue;
      const d = actor.pos.distance(e.pos);
      if (d < range && d < nearestDist) { nearestDist = d; nearest = e; }
    }

    if (nearest) {
      this.attackTimer = this.def.attackSpeed ?? 1200;

      // Fire a simple projectile
      const dir = nearest.pos.sub(actor.pos).normalize();
      const proj = new ex.Actor({
        pos: actor.pos.clone(),
        anchor: ex.vec(0.5, 0.5),
      });
      proj.graphics.use(new ex.Circle({ radius: 3, color: ex.Color.fromHex('#FFAA00') }));
      (proj as any).entityType = 'turret_projectile';
      proj.vel = ex.vec(dir.x * 300, dir.y * 300);
      proj.z = 9000;

      // Simple collision check each frame
      const target = nearest;
      proj.on('preupdate', () => {
        if (target.isKilled()) { proj.kill(); return; }
        if (proj.pos.distance(target.pos) < 16) {
          const hp = target.get(HealthComponent) as HealthComponent | null;
          if (hp) hp.damage(damage);
          // Impact flash
          const flash = new ex.Actor({
            pos: proj.pos.clone(),
            anchor: ex.vec(0.5, 0.5),
          });
          flash.graphics.use(new ex.Circle({ radius: 6, color: ex.Color.fromHex('#FFDD44') }));
          flash.z = 9001;
          flash.actions.fade(0, 200).die();
          this.scene!.add(flash);
          proj.kill();
        }
        // Lifetime
        if (proj.pos.distance(actor.pos) > range * 1.5) proj.kill();
      });

      this.scene.add(proj);
    }
  }
}
