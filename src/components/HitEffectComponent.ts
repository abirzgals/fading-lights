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
      this.timer = this.effectType === 'shake' ? 400 : 150;
      this.phase = 0;
    }
    if (hp) this.lastHp = hp.hp;

    if (this.timer <= 0) return;
    this.timer -= deltaMs;
    this.phase += deltaMs;

    if (this.effectType === 'shake') {
      // Tree sway — rotate around anchor (trunk base)
      const decay = this.timer / 400;
      const angle = Math.sin(this.phase * 0.025) * 0.15 * decay; // ~8.5 degrees max
      actor.rotation = angle;
      if (this.timer <= 0) actor.rotation = 0;
    } else {
      // Stone/metal hit — scale bounce + bright flash
      const t = this.phase / 150; // 0..1 over 150ms
      if (t < 0.2) {
        // Impact: scale up + go bright
        actor.scale = ex.vec(1.2, 1.2);
        actor.graphics.opacity = 2.0; // over-bright (clamped by renderer but pushes brightness)
      } else if (t < 0.5) {
        // Bounce back
        const s = 1.2 - (t - 0.2) / 0.3 * 0.25;
        actor.scale = ex.vec(s, s);
        actor.graphics.opacity = 0.5;
      } else {
        // Settle
        const s = 0.95 + (t - 0.5) / 0.5 * 0.05;
        actor.scale = ex.vec(s, s);
        actor.graphics.opacity = 0.7 + (t - 0.5) * 0.6;
      }
      if (this.timer <= 0) {
        actor.scale = ex.vec(1, 1);
        actor.graphics.opacity = 1.0;
      }
    }
  }
}
