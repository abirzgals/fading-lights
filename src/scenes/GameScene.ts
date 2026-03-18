import * as ex from 'excalibur';
import { GameEntity } from '../engine/GameEntity';
import { FogOfWarPostProcessor, FogLight } from '../engine/FogOfWarPostProcessor';
import { EntityFactory } from '../entities/EntityFactory';
import { Level1Script, LevelData } from '../world/LevelScript';
import { CONFIG, ENEMIES } from '../config';
import { EnemyType } from '../types';
import { audioEngine } from '../engine/AudioEngine';

// Components for queries
import { HealthComponent } from '../components/HealthComponent';
import { AIBrainComponent } from '../components/AIBrainComponent';
import { MeleeAttackComponent } from '../components/MeleeAttackComponent';
import { RangedAttackComponent } from '../components/RangedAttackComponent';
import { ResourceComponent } from '../components/ResourceComponent';
import { AnimatedSpriteComponent } from '../components/AnimatedSpriteComponent';
import { setGridSystem } from '../components/GridOccupancyComponent';

const T = CONFIG.TILE_SIZE;

/**
 * Main game scene — thin orchestrator.
 * Level layout comes from LevelScript.
 * Entity logic lives in components.
 */
export class GameScene extends ex.Scene {
  private fog!: FogOfWarPostProcessor;
  private level!: LevelData;

  // Game state (will move to GameStateComponent later)
  private hp: number = 1000;
  private resources = { wood: 5, stone: 0, metal: 0, gold: 0 };
  private bonfireFuel = 80;
  private kills = 0;
  private spawnTimer = 0;

  onInitialize(engine: ex.Engine): void {
    console.log('[GameScene] initializing...');

    this.fog = new FogOfWarPostProcessor();
    engine.graphicsContext.addPostProcessor(this.fog);

    // Generate level from script
    this.level = Level1Script.generate(this);
    setGridSystem(this.level.grid);

    this.camera.strategy.lockToActor(this.level.player);
    this.camera.zoom = 2;
    this.createHUD();

    audioEngine.startMusic();
    audioEngine.startFireCrackle();

    console.log(`[GameScene] initialized — ${this.level.entities.length} entities, ${this.level.enemies.length} enemies`);
  }

  onPreUpdate(engine: ex.Engine, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.handlePlayerInput(engine, dt);
    this.runEnemyAI(dt);
    this.runSpawning(dt);
    this.runBonfire(dt);
    this.updateFog();
    this.depthSort();
    this.updateHUD();
  }

  // ======== PLAYER INPUT ========

  private handlePlayerInput(engine: ex.Engine, _dt: number): void {
    const player = this.level.player;
    let vx = 0, vy = 0;
    const kb = engine.input.keyboard;
    if (kb.isHeld(ex.Keys.W) || kb.isHeld(ex.Keys.Up)) vy = -1;
    if (kb.isHeld(ex.Keys.S) || kb.isHeld(ex.Keys.Down)) vy = 1;
    if (kb.isHeld(ex.Keys.A) || kb.isHeld(ex.Keys.Left)) vx = -1;
    if (kb.isHeld(ex.Keys.D) || kb.isHeld(ex.Keys.Right)) vx = 1;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    const speed = CONFIG.PLAYER_SPEED;
    const gc = this.level.grid.applyGridCollision(
      player.pos.x - 8, player.pos.x + 8, player.pos.y - 7, player.pos.y + 7, vx, vy, speed);
    player.vel = ex.vec(gc.vx * speed, gc.vy * speed);

    if (gc.vx !== 0 || gc.vy !== 0) audioEngine.startFootsteps();
    else audioEngine.stopFootsteps();

    // Attack with SPACE
    if (kb.wasPressed(ex.Keys.Space)) {
      audioEngine.playAttack();
      const melee = player.get(MeleeAttackComponent) as MeleeAttackComponent | null;
      if (melee?.canAttack) {
        const nearest = this.level.enemies
          .filter(e => !e.isKilled() && e.pos.distance(player.pos) < melee.range)
          .sort((a, b) => a.pos.distance(player.pos) - b.pos.distance(player.pos))[0];
        if (nearest) melee.startAttack(nearest);
      }
      // Hit resources
      const nearRes = this.level.entities
        .filter(e => !e.isKilled() && e.get(ResourceComponent))
        .sort((a, b) => a.pos.distance(player.pos) - b.pos.distance(player.pos))[0];
      if (nearRes && nearRes.pos.distance(player.pos) < 52) {
        const hp = nearRes.get(HealthComponent) as HealthComponent | null;
        const res = nearRes.get(ResourceComponent) as ResourceComponent | null;
        if (hp && res) {
          hp.damage(10);
          if (!hp.alive) { this.resources[res.resourceType] += res.dropAmount; nearRes.kill(); }
        }
      }
    }

    // Clean dead enemies
    this.level.enemies = this.level.enemies.filter(e => {
      if (e.isKilled()) return false;
      const hp = e.get(HealthComponent) as HealthComponent | null;
      if (hp && !hp.alive) { this.kills++; audioEngine.playEnemyDeath(); e.kill(); return false; }
      return true;
    });
  }

  // ======== ENEMY AI ========

  private runEnemyAI(_dt: number): void {
    const player = this.level.player;
    for (const e of this.level.enemies) {
      if (e.isKilled()) continue;
      const ai = e.get(AIBrainComponent) as AIBrainComponent | null;
      if (!ai) continue;

      const dist = e.pos.distance(player.pos);

      // State transitions
      if (dist < ai.sightRange || ai.aggroFlag) {
        if (ai.isRanged) {
          ai.state = dist < ai.attackRange * 0.6 ? 'FLEE' : dist < ai.attackRange ? 'ORBIT' : 'CHASE';
        } else {
          ai.state = dist < CONFIG.ENEMY_MELEE_RANGE + 20 ? 'ATTACK' : 'CHASE';
        }
      } else {
        ai.state = 'WANDER';
        if (ai.wanderTimer <= 0) { ai.wanderAngle = Math.random() * Math.PI * 2; ai.wanderTimer = 1 + Math.random() * 2; }
      }

      // Execute
      const speed = ai.speed;
      switch (ai.state) {
        case 'WANDER':
          e.vel = ex.vec(Math.cos(ai.wanderAngle) * speed * 0.3, Math.sin(ai.wanderAngle) * speed * 0.3);
          break;
        case 'CHASE':
          const dir = player.pos.sub(e.pos).normalize();
          e.vel = ex.vec(dir.x * speed, dir.y * speed);
          break;
        case 'ATTACK': {
          e.vel = ex.vec(0, 0);
          const anim = e.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
          const melee = e.get(MeleeAttackComponent) as MeleeAttackComponent | null;
          if (melee?.canAttack && !anim?.isAttacking) {
            ai.aggroFlag = true;
            // Play attack animation — damage checked on damage frame
            // If player dodged away by damage frame, it's a MISS!
            if (anim) {
              anim.playAttack(() => {
                // Damage frame callback — check if player still in range
                const distNow = e.pos.distance(player.pos);
                if (distNow <= melee.range) {
                  const playerHp = player.get(HealthComponent) as HealthComponent | null;
                  if (playerHp) playerHp.damage(melee.damage);
                }
              });
            }
            melee.startAttack(player);
          }
          break;
        }
        case 'ORBIT': {
          const orbitDir = e.pos.sub(player.pos).normalize();
          e.vel = ex.vec(-orbitDir.y * speed * 0.5, orbitDir.x * speed * 0.5);
          const ranged = e.get(RangedAttackComponent) as RangedAttackComponent | null;
          const rangedAnim = e.get(AnimatedSpriteComponent) as AnimatedSpriteComponent | null;
          if (ranged?.canFire && dist < ai.attackRange) {
            if (rangedAnim && !rangedAnim.isAttacking) {
              rangedAnim.playAttack(() => {
                // Fire projectile on damage frame
                ranged.fire(player, this);
              });
            } else {
              ranged.fire(player, this);
            }
          }
          break;
        }
        case 'FLEE':
          const away = e.pos.sub(player.pos).normalize();
          e.vel = ex.vec(away.x * speed * 0.8, away.y * speed * 0.8);
          break;
      }
    }
  }

  // ======== SPAWNING ========

  private runSpawning(dt: number): void {
    this.spawnTimer += dt;
    if (this.spawnTimer > 10 && this.level.enemies.filter(e => !e.isKilled()).length < CONFIG.MAX_ENEMIES) {
      this.spawnTimer = 0;
      const player = this.level.player;
      const angle = Math.random() * Math.PI * 2, dist = 300 + Math.random() * 200;
      const types: EnemyType[] = ['SHADOW_WISP', 'SHADOW_WISP', 'SHADOW_WISP', 'SHADOW_STALKER', 'SHADOW_STALKER',
        'FOG_CRAWLER', 'SHADOW_ARCHER', 'VOID_MAGE', 'SHADOW_BEAST'];
      const enemy = EntityFactory.createEnemy(this,
        player.pos.x + Math.cos(angle) * dist, player.pos.y + Math.sin(angle) * dist,
        types[Math.floor(Math.random() * types.length)]);
      this.level.enemies.push(enemy);
      if (Math.random() < 0.3) audioEngine.playEnemyRoar();
    }
  }

  // ======== BONFIRE ========

  private runBonfire(dt: number): void {
    this.bonfireFuel = Math.max(0, this.bonfireFuel - CONFIG.BONFIRE_BURN_RATE * dt);
    const player = this.level.player;
    if (this.resources.wood > 0 && this.level.bonfires[0] &&
      this.level.bonfires[0].pos.distance(player.pos) < CONFIG.INTERACT_RADIUS &&
      this.bonfireFuel < CONFIG.BONFIRE_MAX_FUEL * 0.9) {
      this.resources.wood--;
      this.bonfireFuel = Math.min(CONFIG.BONFIRE_MAX_FUEL, this.bonfireFuel + CONFIG.FUEL_PER_WOOD);
    }
  }

  // ======== FOG ========

  private updateFog(): void {
    const lights: FogLight[] = [];
    const zoom = this.camera.zoom;
    const player = this.level.player;
    for (const bf of this.level.bonfires) {
      const fuelFrac = this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL;
      const radius = CONFIG.BONFIRE_MIN_RADIUS + fuelFrac * (CONFIG.BONFIRE_BASE_RADIUS - CONFIG.BONFIRE_MIN_RADIUS);
      const t = performance.now(), seed = bf.pos.x * 7.3 + bf.pos.y * 13.1;
      const screen = this.engine.worldToScreenCoordinates(bf.pos.add(ex.vec(
        Math.sin(t * 0.003 + seed) * 4, Math.cos(t * 0.004 + seed * 1.3) * 3)));
      lights.push({ x: screen.x, y: screen.y, radius: radius * zoom, intensity: 1.0, softness: 0.5,
        tintR: 1.0, tintG: 0.47, tintB: 0.16, tintA: 0.12 });
    }
    const ps = this.engine.worldToScreenCoordinates(player.pos);
    lights.push({ x: ps.x, y: ps.y, radius: 60 * zoom, intensity: 0.85, softness: 0.5,
      tintR: 0, tintG: 0, tintB: 0, tintA: 0 });
    this.fog.setLights(lights);
  }

  // ======== DEPTH SORT ========

  private depthSort(): void {
    this.level.player.z = this.level.player.pos.y;
    for (const e of this.level.entities) if (!e.isKilled()) e.z = e.pos.y;
    for (const e of this.level.enemies) if (!e.isKilled()) e.z = e.pos.y;
  }

  // ======== HUD ========

  private hudEl!: HTMLDivElement;
  private createHUD(): void {
    this.hudEl = document.createElement('div');
    this.hudEl.style.cssText = 'position:fixed;top:8px;left:8px;color:#fff;font:bold 12px monospace;z-index:999;pointer-events:none;line-height:1.8;text-shadow:0 0 4px #000';
    document.body.appendChild(this.hudEl);
  }
  private updateHUD(): void {
    if (!this.hudEl) return;
    const fuelPct = Math.round(this.bonfireFuel / CONFIG.BONFIRE_MAX_FUEL * 100);
    const hpBar = '█'.repeat(Math.min(10, Math.round(this.hp / 100))) + '░'.repeat(Math.max(0, 10 - Math.round(this.hp / 100)));
    const fuelBar = '█'.repeat(Math.round(fuelPct / 10)) + '░'.repeat(10 - Math.round(fuelPct / 10));
    this.hudEl.innerHTML = `
      <span style="color:#44FF44">HP [${hpBar}] ${Math.round(this.hp)}</span><br>
      <span style="color:#FF8800">FIRE [${fuelBar}] ${fuelPct}%</span><br>
      <span style="color:#AA8844">Wood ${this.resources.wood}</span> ·
      <span style="color:#888">Stone ${this.resources.stone}</span> ·
      <span style="color:#CC8844">Metal ${this.resources.metal}</span> ·
      <span style="color:#FFD700">Gold ${this.resources.gold}</span><br>
      <span style="color:#AA66FF">Kills ${this.kills}</span> ·
      <span style="color:#FF4444">Enemies ${this.level.enemies.filter(e => !e.isKilled()).length}</span>`;
  }
  onDeactivate(): void { if (this.hudEl) this.hudEl.remove(); }
}
