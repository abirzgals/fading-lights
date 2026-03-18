import * as ex from 'excalibur';
import { GAME_VERSION } from '../config';
import { AssetLoader } from '../engine/AssetLoader';
import { audioEngine } from '../engine/AudioEngine';

/**
 * Main menu scene — atmospheric dark forest with fire particles.
 * Shows title, name input, start button.
 */
export class MenuScene extends ex.Scene {
  private hudEl!: HTMLDivElement;

  onInitialize(engine: ex.Engine): void {
    // Dark background
    const bg = new ex.Actor({
      pos: ex.vec(engine.halfDrawWidth, engine.halfDrawHeight),
      width: engine.drawWidth, height: engine.drawHeight,
      color: ex.Color.fromHex('#020105'),
      anchor: ex.vec(0.5, 0.5),
    });
    bg.z = -10;
    this.add(bg);

    // Menu background image if loaded
    if (AssetLoader.menuBg.isLoaded()) {
      const bgImg = new ex.Actor({
        pos: ex.vec(engine.halfDrawWidth, engine.halfDrawHeight),
        anchor: ex.vec(0.5, 0.5),
      });
      bgImg.graphics.use(AssetLoader.menuBg.toSprite());
      bgImg.z = -5;
      this.add(bgImg);
    }

    // Fire particles at bottom center
    const fireX = engine.halfDrawWidth;
    const fireY = engine.drawHeight * 0.65;
    const scene = this;
    const fireTimer = new ex.Timer({
      interval: 60,
      repeats: true,
      fcn: () => {
        const colors = ['#FF6600', '#FFDD44', '#FF4400', '#FFAA22'];
        const spark = new ex.Actor({
          pos: ex.vec(fireX + (Math.random() - 0.5) * 30, fireY + (Math.random() - 0.5) * 10),
          width: 2 + Math.random() * 4, height: 2 + Math.random() * 4,
          color: ex.Color.fromHex(colors[Math.floor(Math.random() * colors.length)]),
          anchor: ex.vec(0.5, 0.5),
        });
        spark.z = 10;
        spark.vel = ex.vec((Math.random() - 0.5) * 15, -30 - Math.random() * 40);
        spark.actions.fade(0, 400 + Math.random() * 400).die();
        scene.add(spark);
      },
    });
    this.add(fireTimer);
    fireTimer.start();

    // Warm glow around fire
    const glow = new ex.Actor({
      pos: ex.vec(fireX, fireY - 10),
      anchor: ex.vec(0.5, 0.5),
    });
    glow.graphics.use(new ex.Circle({
      radius: 60,
      color: ex.Color.fromRGB(255, 100, 0, 0.08),
    }));
    glow.z = 5;
    this.add(glow);

    // HTML overlay for menu UI
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'menu-overlay';
    this.hudEl.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: monospace; color: #fff; z-index: 999; pointer-events: none;
    `;
    this.hudEl.innerHTML = `
      <div style="font-size: 32px; color: #FFD700; letter-spacing: 4px; margin-bottom: 8px;
                  text-shadow: 0 0 20px rgba(255,200,0,0.5);">THE FADING LIGHT</div>
      <div style="font-size: 12px; color: #888; margin-bottom: 40px;">Survive the eternal darkness</div>
      <div style="pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <input id="player-name" type="text" placeholder="Your name..." maxlength="16"
          style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,200,0,0.3);
                 color: #FFD700; font-family: monospace; font-size: 14px; padding: 8px 16px;
                 text-align: center; border-radius: 4px; width: 200px; outline: none;" />
        <button id="start-btn" style="
          background: rgba(255,200,0,0.15); border: 1px solid rgba(255,200,0,0.4);
          color: #FFD700; font-family: monospace; font-size: 16px; letter-spacing: 3px;
          padding: 12px 40px; border-radius: 6px; cursor: pointer;
          text-shadow: 0 0 10px rgba(255,200,0,0.3);
        ">START GAME</button>
      </div>
      <div style="position: fixed; bottom: 8px; right: 12px; font-size: 10px; color: #444;">
        v${GAME_VERSION}
      </div>
      <div style="position: fixed; bottom: 8px; left: 12px; font-size: 9px; color: #555;">
        WASD move · SPACE attack · E interact
      </div>
    `;
    document.body.appendChild(this.hudEl);

    // Start button click
    const startBtn = document.getElementById('start-btn');
    startBtn?.addEventListener('click', () => {
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      const playerName = nameInput?.value.trim() || 'Wanderer';
      (window as any).__playerName = playerName;

      // Fade out menu
      this.hudEl.style.transition = 'opacity 1s';
      this.hudEl.style.opacity = '0';
      this.hudEl.style.pointerEvents = 'none';

      audioEngine.stopLoop('menu_music', 1200);

      setTimeout(() => {
        this.hudEl.remove();
        engine.goToScene('game');
      }, 1000);
    });

    // Start menu music
    audioEngine.startMenuMusic();
  }

  onDeactivate(): void {
    if (this.hudEl && this.hudEl.parentNode) {
      this.hudEl.remove();
    }
  }
}
