import * as ex from 'excalibur';
import { GAME_VERSION } from '../config';
import { AssetLoader } from '../engine/AssetLoader';
import { audioEngine } from '../engine/AudioEngine';

/**
 * Main menu — atmospheric pixel art forest with campfire, particles, fog.
 */
export class MenuScene extends ex.Scene {
  private hudEl!: HTMLDivElement;

  onInitialize(engine: ex.Engine): void {
    const W = engine.drawWidth;
    const H = engine.drawHeight;

    // Background — use menu_bg.png if available, else dark gradient
    if (AssetLoader.menuBg.isLoaded()) {
      const bgActor = new ex.Actor({
        pos: ex.vec(W / 2, H / 2), anchor: ex.vec(0.5, 0.5),
      });
      const sprite = AssetLoader.menuBg.toSprite();
      // Scale to fill screen
      const scaleX = W / sprite.width;
      const scaleY = H / sprite.height;
      const scale = Math.max(scaleX, scaleY);
      bgActor.scale = ex.vec(scale, scale);
      bgActor.graphics.use(sprite);
      bgActor.z = -10;
      this.add(bgActor);
    } else {
      const bg = new ex.Actor({
        pos: ex.vec(W / 2, H / 2), width: W, height: H,
        color: ex.Color.fromHex('#020105'), anchor: ex.vec(0.5, 0.5),
      });
      bg.z = -10;
      this.add(bg);
    }

    // Dark vignette overlay
    const vignette = new ex.Actor({
      pos: ex.vec(W / 2, H / 2), width: W, height: H,
      color: ex.Color.fromRGB(0, 0, 0, 0.4), anchor: ex.vec(0.5, 0.5),
    });
    vignette.z = -5;
    this.add(vignette);

    // Campfire position
    const fireX = W / 2;
    const fireY = H * 0.62;
    const scene = this;

    // Fire particles — multiple layers for richness
    const fireTimer = new ex.Timer({
      interval: 40, repeats: true,
      fcn: () => {
        // Main flames
        const colors = ['#FF5500', '#FF8800', '#FFAA22', '#FFDD44', '#FF3300'];
        for (let i = 0; i < 2; i++) {
          const spark = new ex.Actor({
            pos: ex.vec(fireX + (Math.random() - 0.5) * 20, fireY + (Math.random() - 0.5) * 6),
            width: 2 + Math.random() * 5, height: 2 + Math.random() * 5,
            color: ex.Color.fromHex(colors[Math.floor(Math.random() * colors.length)]),
            anchor: ex.vec(0.5, 0.5),
          });
          spark.z = 10;
          spark.vel = ex.vec((Math.random() - 0.5) * 12, -25 - Math.random() * 35);
          spark.actions.fade(0, 300 + Math.random() * 500).die();
          scene.add(spark);
        }
        // Occasional ember flying up
        if (Math.random() < 0.15) {
          const ember = new ex.Actor({
            pos: ex.vec(fireX + (Math.random() - 0.5) * 10, fireY),
            width: 1, height: 1,
            color: ex.Color.fromHex('#FFCC00'),
            anchor: ex.vec(0.5, 0.5),
          });
          ember.z = 15;
          ember.vel = ex.vec((Math.random() - 0.5) * 30, -50 - Math.random() * 60);
          ember.actions.fade(0, 1000 + Math.random() * 1500).die();
          scene.add(ember);
        }
      },
    });
    this.add(fireTimer);
    fireTimer.start();

    // Ground glow
    const glow = new ex.Actor({
      pos: ex.vec(fireX, fireY + 10), anchor: ex.vec(0.5, 0.5),
    });
    glow.graphics.use(new ex.Circle({
      radius: 80, color: ex.Color.fromRGB(255, 80, 0, 0.06),
    }));
    glow.z = 6;
    this.add(glow);

    // Floating fireflies
    const fireflyTimer = new ex.Timer({
      interval: 500, repeats: true,
      fcn: () => {
        const ff = new ex.Actor({
          pos: ex.vec(Math.random() * W, Math.random() * H),
          width: 2, height: 2,
          color: ex.Color.fromHex('#88AA44'),
          anchor: ex.vec(0.5, 0.5),
        });
        ff.z = 8;
        ff.vel = ex.vec((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8);
        ff.actions.fade(0, 2000 + Math.random() * 3000).die();
        scene.add(ff);
      },
    });
    this.add(fireflyTimer);
    fireflyTimer.start();

    // HTML overlay for menu
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'menu-overlay';
    this.hudEl.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: monospace; color: #fff; z-index: 999; pointer-events: none;
    `;
    this.hudEl.innerHTML = `
      <div style="font-size: 36px; color: #FFD700; letter-spacing: 5px; margin-bottom: 10px;
                  text-shadow: 0 0 30px rgba(255,200,0,0.5), 0 0 60px rgba(255,100,0,0.2);
                  animation: titleGlow 3s ease-in-out infinite;">
        THE FADING LIGHT
      </div>
      <div style="font-size: 12px; color: #777; margin-bottom: 50px; letter-spacing: 2px;">
        Survive the eternal darkness
      </div>
      <div style="pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 14px;">
        <input id="player-name" type="text" placeholder="Enter your name..." maxlength="16"
          style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,200,0,0.25);
                 color: #FFD700; font-family: monospace; font-size: 14px; padding: 10px 20px;
                 text-align: center; border-radius: 6px; width: 220px; outline: none;
                 transition: border-color 0.3s;" />
        <button id="start-btn" style="
          background: rgba(255,200,0,0.12); border: 1px solid rgba(255,200,0,0.35);
          color: #FFD700; font-family: monospace; font-size: 18px; letter-spacing: 4px;
          padding: 14px 50px; border-radius: 8px; cursor: pointer;
          text-shadow: 0 0 15px rgba(255,200,0,0.3);
          transition: all 0.3s;
        ">START GAME</button>
      </div>
      <div style="position: fixed; bottom: 10px; right: 14px; font-size: 10px; color: #333;">
        v${GAME_VERSION}
      </div>
      <div style="position: fixed; bottom: 10px; left: 14px; font-size: 9px; color: #444;">
        WASD move · SPACE / LMB attack · E / RMB interact · TAB crafting · B build
      </div>
      <style>
        @keyframes titleGlow {
          0%, 100% { text-shadow: 0 0 30px rgba(255,200,0,0.5), 0 0 60px rgba(255,100,0,0.2); }
          50% { text-shadow: 0 0 40px rgba(255,200,0,0.7), 0 0 80px rgba(255,100,0,0.3); }
        }
        #start-btn:hover {
          background: rgba(255,200,0,0.25) !important;
          border-color: rgba(255,200,0,0.6) !important;
          transform: scale(1.02);
        }
        #player-name:focus {
          border-color: rgba(255,200,0,0.5) !important;
        }
      </style>
    `;
    document.body.appendChild(this.hudEl);

    // Enter key starts game
    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.startGame(engine);
    });

    // Start button
    document.getElementById('start-btn')?.addEventListener('click', () => this.startGame(engine));

    // Menu music
    audioEngine.startMenuMusic();
  }

  private startGame(engine: ex.Engine): void {
    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    (window as any).__playerName = nameInput?.value.trim() || 'Wanderer';

    this.hudEl.style.transition = 'opacity 1.2s';
    this.hudEl.style.opacity = '0';
    this.hudEl.style.pointerEvents = 'none';

    audioEngine.stopLoop('menu_music', 1200);

    setTimeout(() => {
      this.hudEl.remove();
      engine.goToScene('game');
    }, 1200);
  }

  onDeactivate(): void {
    if (this.hudEl?.parentNode) this.hudEl.remove();
  }
}
