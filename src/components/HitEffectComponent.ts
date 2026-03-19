import * as ex from 'excalibur';
import { HealthComponent } from './HealthComponent';

/**
 * Hit feedback effect — attached to any damageable game object.
 * Auto-detects HP changes and plays visual feedback:
 * - 'shake': rotation oscillation around anchor point (trees swaying leaves)
 * - 'flash': scale pulse + opacity blink (stones, metals getting hit)
 */
export class HitEffectComponent extends ex.Component {
  public readonly type = 'HitEffect';

  private effectType: 'shake' | 'flash';
  private lastHp = -1;
  private timer = 0;
  private phase = 0;

  constructor(effectType: 'shake' | 'flash' = 'shake') {
    super();
    this.effectType = effectType;
  }

  onAdd(owner: ex.Entity): void {
    const hp = owner.get(HealthComponent) as HealthComponent | null;
    if (hp) this.lastHp = hp.hp;
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    const actor = this.owner as ex.Actor;
    if (!actor) return;

    // Detect damage
    const hp = actor.get(HealthComponent) as HealthComponent | null;
    if (hp && this.lastHp >= 0 && hp.hp < this.lastHp) {
      this.timer = this.effectType === 'shake' ? 300 : 150;
      this.phase = 0;
    }
    if (hp) this.lastHp = hp.hp;

    if (this.timer <= 0) return;
    this.timer -= deltaMs;
    this.phase += deltaMs;

    if (this.effectType === 'shake') {
      // Tree sway — rotate around anchor (0.5, 0.8 = trunk base)
      // Oscillate rotation with decaying amplitude
      const decay = this.timer / 300;
      const angle = Math.sin(this.phase * 0.03) * 0.08 * decay; // ~4.5 degrees max
      actor.rotation = angle;
      if (this.timer <= 0) actor.rotation = 0;
    } else {
      // Stone/metal flash — rapid scale pulse + opacity blink
      if (this.phase < 60) {
        // Phase 1: grow + brighten
        actor.scale = ex.vec(1.12, 1.12);
        actor.graphics.opacity = 0.6;
      } else if (this.phase < 100) {
        // Phase 2: shrink back
        actor.scale = ex.vec(1.0, 1.0);
        actor.graphics.opacity = 1.0;
      } else {
        // Phase 3: second pulse (smaller)
        actor.scale = ex.vec(1.05, 1.05);
        actor.graphics.opacity = 0.8;
      }
      if (this.timer <= 0) {
        actor.scale = ex.vec(1, 1);
        actor.graphics.opacity = 1.0;
      }
    }
  }
}
