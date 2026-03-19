import * as ex from 'excalibur';
import { HealthComponent } from './HealthComponent';

/**
 * Hit feedback effect — attached to any damageable game object.
 * Listens to HP changes and plays visual feedback:
 * - 'shake': horizontal oscillation (trees)
 * - 'flash': white flash (stones, metals)
 */
export class HitEffectComponent extends ex.Component {
  public readonly type = 'HitEffect';

  private effectType: 'shake' | 'flash';
  private lastHp = -1;
  private shakeTimer = 0;
  private shakePhase = 0;
  private flashTimer = 0;
  private origX = 0;

  constructor(effectType: 'shake' | 'flash' = 'shake') {
    super();
    this.effectType = effectType;
  }

  onAdd(owner: ex.Entity): void {
    const hp = owner.get(HealthComponent) as HealthComponent | null;
    if (hp) this.lastHp = hp.hp;
    this.origX = (owner as ex.Actor).pos.x;
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor) return;

    // Detect damage by comparing HP
    const hp = actor.get(HealthComponent) as HealthComponent | null;
    if (hp && this.lastHp >= 0 && hp.hp < this.lastHp) {
      // Took damage — trigger effect
      if (this.effectType === 'shake') {
        this.shakeTimer = 200; // shake for 200ms
        this.origX = actor.pos.x;
      } else {
        this.flashTimer = 100; // flash for 100ms
      }
    }
    if (hp) this.lastHp = hp.hp;

    // Run shake effect
    if (this.shakeTimer > 0) {
      this.shakeTimer -= deltaMs;
      this.shakePhase += deltaMs * 0.05;
      const intensity = (this.shakeTimer / 200) * 3; // fade out
      actor.pos.x = this.origX + Math.sin(this.shakePhase * 10) * intensity;
      if (this.shakeTimer <= 0) {
        actor.pos.x = this.origX;
      }
    }

    // Run flash effect
    if (this.flashTimer > 0) {
      this.flashTimer -= deltaMs;
      const g = actor.graphics.current;
      if (g) {
        if (this.flashTimer > 0) {
          g.tint = ex.Color.White;
          actor.graphics.opacity = 1.0;
        } else {
          g.tint = ex.Color.White; // reset (White = no tint)
        }
      }
    }
  }
}
