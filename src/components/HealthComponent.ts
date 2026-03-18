import * as ex from 'excalibur';

/**
 * Health component — manages HP, damage, healing, death.
 * Emits 'death' event when HP reaches 0.
 * Auto-cleaned on entity kill().
 */
export class HealthComponent extends ex.Component {
  public hp: number;
  public maxHp: number;
  public armor: number = 0;       // 0-1, fraction of damage reduced
  public invincibleMs: number = 0; // remaining invincibility frames

  constructor(maxHp: number) {
    super();
    this.hp = maxHp;
    this.maxHp = maxHp;
  }

  damage(amount: number): number {
    if (this.invincibleMs > 0) return 0;
    const reduced = Math.max(1, Math.round(amount * (1 - this.armor)));
    this.hp = Math.max(0, this.hp - reduced);
    if (this.hp <= 0) {
      this.owner?.emit('death', new ex.GameEvent());
    }
    return reduced;
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get fraction(): number {
    return this.hp / this.maxHp;
  }

  onPreUpdate(_engine: ex.Engine, deltaMs: number): void {
    if (this.invincibleMs > 0) {
      this.invincibleMs = Math.max(0, this.invincibleMs - deltaMs);
    }
  }
}
