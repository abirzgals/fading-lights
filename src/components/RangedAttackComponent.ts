import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { AssetLoader } from '../engine/AssetLoader';
import { HealthComponent } from './HealthComponent';

/**
 * Ranged attack — fires projectiles at targets.
 * Projectile travels and checks hit on arrival, not on fire.
 */
export class RangedAttackComponent extends ex.Component {
  public readonly type = 'RangedAttack';

  public damage: number;
  public range: number;
  public cooldownMs: number;
  public projectileSpeed: number;
  public projectileType: 'arrow' | 'magic';
  public splashRadius: number;

  private cooldownTimer: number = 0;

  constructor(opts: {
    damage: number;
    range: number;
    cooldownMs?: number;
    projectileSpeed?: number;
    projectileType?: 'arrow' | 'magic';
    splashRadius?: number;
  }) {
    super();
    this.damage = opts.damage;
    this.range = opts.range;
    this.cooldownMs = opts.cooldownMs ?? 2000;
    this.projectileSpeed = opts.projectileSpeed ?? 200;
    this.projectileType = opts.projectileType ?? 'arrow';
    this.splashRadius = opts.splashRadius ?? 0;
  }

  get canFire(): boolean { return this.cooldownTimer <= 0; }

  /** Fire a projectile at the target's current position */
  fire(target: ex.Actor, scene: ex.Scene): void {
    if (!this.canFire) return;
    this.cooldownTimer = this.cooldownMs;

    const actor = this.owner as ex.Actor;
    if (!actor) return;

    const dir = target.pos.sub(actor.pos).normalize();
    const ismagic = this.projectileType === 'magic';
    const damage = this.damage;

    const proj = new GameEntity({
      pos: actor.pos.clone(), anchor: ex.vec(0.5, 0.5),
    });
    proj.entityType = 'projectile';

    const projType = this.projectileType;

    if (ismagic) {
      // Magic orb — scaled down to 50% for smaller projectile
      if (AssetLoader.magicOrb.isLoaded()) {
        proj.graphics.use(AssetLoader.magicOrb.toSprite());
      } else {
        proj.graphics.use(new ex.Circle({ radius: 4, color: ex.Color.fromHex('#AA44FF') }));
      }
      proj.scale = ex.vec(0.5, 0.5);
      // Smaller glow halo
      const glow = new ex.Actor({ pos: actor.pos.clone(), anchor: ex.vec(0.5, 0.5) });
      glow.graphics.use(new ex.Circle({ radius: 8, color: ex.Color.fromRGB(170, 68, 255, 0.1) }));
      glow.z = 99;
      scene.add(glow);
      let pulseT = 0;
      proj.on('preupdate', () => {
        pulseT += 0.15;
        const s = 0.5 + Math.sin(pulseT) * 0.1;
        proj.scale = ex.vec(s, s);
        glow.pos = proj.pos.clone();
        glow.graphics.opacity = 0.1 + Math.sin(pulseT * 1.5) * 0.06;
        if (proj.isKilled()) { glow.kill(); }
      });
    } else {
      // Arrow — texture rotated to flight direction + 45° CW correction
      if (AssetLoader.arrowProj.isLoaded()) {
        proj.graphics.use(AssetLoader.arrowProj.toSprite());
        proj.scale = ex.vec(0.6, 0.6);
      } else {
        proj.graphics.use(new ex.Rectangle({ width: 8, height: 2, color: ex.Color.fromHex('#FFCC88') }));
      }
      proj.rotation = Math.atan2(dir.y, dir.x) + Math.PI * 0.25; // +45° CW to fix sprite orientation
    }

    proj.vel = dir.scale(this.projectileSpeed);
    proj.z = 100;

    // Trailing particles (matches original: follow proj, tinted, shrinking)
    let trailTimer = 0;
    proj.on('preupdate', () => {
      if (!proj.scene) return;
      trailTimer += 16;
      const freq = ismagic ? 30 : 50;
      if (trailTimer > freq) {
        trailTimer = 0;
        const tints = ismagic
          ? ['#AA44FF', '#8800FF', '#DD88FF']  // original magic tints
          : ['#FFCC88', '#AA8855', '#FF8844']; // original arrow tints
        // Main trail particle — circle that shrinks and fades
        const trail = new ex.Actor({ pos: proj.pos.clone(), anchor: ex.vec(0.5, 0.5) });
        const startSize = ismagic ? 3 + Math.random() * 2 : 2 + Math.random();
        trail.graphics.use(new ex.Circle({ radius: startSize,
          color: ex.Color.fromHex(tints[Math.floor(Math.random() * tints.length)]) }));
        trail.graphics.opacity = 0.8;
        trail.z = proj.z - 0.1;
        trail.vel = ex.vec((Math.random() - 0.5) * (ismagic ? 20 : 8),
                           (Math.random() - 0.5) * (ismagic ? 20 : 8));
        // Shrink + fade (like original scale start→0, alpha start→0)
        const life = ismagic ? 400 : 200;
        trail.actions.scaleTo(ex.vec(0.1, 0.1), ex.vec(2, 2)).die();
        trail.actions.fade(0, life);
        proj.scene.add(trail);

        // Extra magic particles (quantity: 2 in original)
        if (ismagic) {
          const extra = new ex.Actor({ pos: proj.pos.clone(), anchor: ex.vec(0.5, 0.5) });
          extra.graphics.use(new ex.Circle({ radius: 1 + Math.random() * 2,
            color: ex.Color.fromHex(tints[Math.floor(Math.random() * tints.length)]) }));
          extra.graphics.opacity = 0.6;
          extra.z = proj.z - 0.2;
          extra.vel = ex.vec((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15);
          extra.actions.fade(0, 300).die();
          proj.scene.add(extra);
        }
      }
    });

    // Impact explosion (matches original's expanding splash)
    const spawnImpact = (pos: ex.Vector) => {
      if (!proj.scene) return;
      const scn = proj.scene;

      if (ismagic) {
        // Explosion texture + expanding AOE
        const splash = new ex.Actor({ pos: pos.clone(), anchor: ex.vec(0.5, 0.5) });
        if (AssetLoader.magicExplosion.isLoaded()) {
          splash.graphics.use(AssetLoader.magicExplosion.toSprite());
        } else {
          splash.graphics.use(new ex.Circle({ radius: 20, color: ex.Color.fromRGB(170, 68, 255, 0.4) }));
        }
        splash.z = 102;
        splash.scale = ex.vec(0.3, 0.3);
        splash.actions.scaleTo(ex.vec(1.0, 1.0), ex.vec(3, 3));
        splash.actions.fade(0, 400).die();
        scn.add(splash);
      }

      // Burst particles
      const impactColors = ismagic
        ? ['#AA44FF', '#CC66FF', '#FF88FF', '#DDAAFF', '#8800FF']
        : ['#FFCC88', '#FF8844', '#FFAA44'];
      const count = ismagic ? 12 : 5;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const spd = 30 + Math.random() * (ismagic ? 60 : 30);
        const p = new ex.Actor({ pos: pos.clone(), anchor: ex.vec(0.5, 0.5) });
        const sz = ismagic ? 2 + Math.random() * 3 : 1 + Math.random();
        p.graphics.use(new ex.Circle({ radius: sz,
          color: ex.Color.fromHex(impactColors[Math.floor(Math.random() * impactColors.length)]) }));
        p.z = 103;
        p.vel = ex.vec(Math.cos(angle) * spd, Math.sin(angle) * spd);
        p.actions.scaleTo(ex.vec(0.1, 0.1), ex.vec(3, 3));
        p.actions.fade(0, 200 + Math.random() * 200).die();
        scn.add(p);
      }
    };

    // Hit detection on each frame
    const maxDist = this.range * 1.5;
    const startPos = actor.pos.clone();
    proj.on('preupdate', () => {
      // Check hit on target
      if (!target.isKilled() && proj.pos.distance(target.pos) < 16) {
        const hp = target.get(HealthComponent) as HealthComponent | null;
        if (hp) hp.damage(damage);
        spawnImpact(proj.pos);
        proj.kill();
        return;
      }
      // Max range — fizzle out
      if (proj.pos.distance(startPos) > maxDist) {
        spawnImpact(proj.pos);
        proj.kill();
      }
    });

    scene.add(proj);
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= deltaMs;
    }
  }
}
