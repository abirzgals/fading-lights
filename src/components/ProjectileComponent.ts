import * as ex from 'excalibur';

/**
 * Component for projectiles (arrows, magic orbs).
 * Handles lifetime and damage on hit.
 */
export class ProjectileComponent extends ex.Component {
  public damage: number;
  public lifetime: number;
  public splashRadius: number;
  public projectileType: 'arrow' | 'magic';
  public elapsed: number = 0;

  constructor(opts: {
    damage: number;
    lifetime?: number;
    splashRadius?: number;
    type?: 'arrow' | 'magic';
  }) {
    super();
    this.damage = opts.damage;
    this.lifetime = opts.lifetime ?? 3000;
    this.splashRadius = opts.splashRadius ?? 0;
    this.projectileType = opts.type ?? 'arrow';
  }
}
