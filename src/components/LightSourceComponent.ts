import * as ex from 'excalibur';

/**
 * Marks an entity as a light source for the fog of war shader.
 * FogOfWarPostProcessor queries all entities with this component each frame.
 */
export class LightSourceComponent extends ex.Component {
  public radius: number;
  public intensity: number;
  public softness: number;
  public tintR: number;
  public tintG: number;
  public tintB: number;
  public tintA: number;

  constructor(opts: {
    radius: number;
    intensity?: number;
    softness?: number;
    tintR?: number;
    tintG?: number;
    tintB?: number;
    tintA?: number;
  }) {
    super();
    this.radius = opts.radius;
    this.intensity = opts.intensity ?? 1.0;
    this.softness = opts.softness ?? 0.5;
    this.tintR = opts.tintR ?? 0;
    this.tintG = opts.tintG ?? 0;
    this.tintB = opts.tintB ?? 0;
    this.tintA = opts.tintA ?? 0;
  }
}
