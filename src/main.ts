import * as ex from 'excalibur';
import { GAME_VERSION } from './config';
import { IntroScene } from './scenes/IntroScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { AssetLoader } from './engine/AssetLoader';

console.log(`The Fading Light v${GAME_VERSION} — Excalibur.js + TypeScript`);

// Custom loading screen
const loadingEl = document.createElement('div');
loadingEl.style.cssText = `
  position: fixed; inset: 0; z-index: 99999;
  background: #020105;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  font-family: 'Georgia', serif;
  overflow: hidden;
`;
loadingEl.innerHTML = `
  <div style="position:relative;text-align:center">
    <h1 id="title" style="
      font-size: 48px; color: #ff8844; margin: 0;
      text-shadow: 0 0 30px rgba(255,136,68,0.5), 0 0 60px rgba(255,100,30,0.3);
      letter-spacing: 6px; animation: titlePulse 2s ease-in-out infinite;
    ">THE FADING LIGHT</h1>
    <div style="
      font-size: 14px; color: #664422; margin-top: 12px;
      letter-spacing: 8px; text-transform: uppercase;
    ">SURVIVE THE DARKNESS</div>
    <div id="load-bar-bg" style="
      width: 300px; height: 4px; background: #1a1a1a;
      margin: 40px auto 0; border-radius: 2px; overflow: hidden;
    ">
      <div id="load-bar-fill" style="
        width: 0%; height: 100%;
        background: linear-gradient(90deg, #ff6600, #ffaa44);
        border-radius: 2px; transition: width 0.2s;
      "></div>
    </div>
    <div id="load-text" style="
      font-size: 11px; color: #444; margin-top: 12px;
      font-family: monospace;
    ">Loading...</div>
  </div>
  <div id="particles" style="position:absolute;inset:0;pointer-events:none;overflow:hidden"></div>
`;
document.body.appendChild(loadingEl);

// Particle effect — floating embers
const particlesEl = loadingEl.querySelector('#particles') as HTMLDivElement;
function spawnEmber() {
  const ember = document.createElement('div');
  const x = 20 + Math.random() * 60;
  const size = 2 + Math.random() * 3;
  const dur = 3 + Math.random() * 4;
  ember.style.cssText = `
    position: absolute; bottom: -10px; left: ${x}%;
    width: ${size}px; height: ${size}px;
    background: ${Math.random() > 0.5 ? '#ff6600' : '#ffaa44'};
    border-radius: 50%; opacity: 0.6;
    animation: emberRise ${dur}s linear forwards;
  `;
  particlesEl.appendChild(ember);
  setTimeout(() => ember.remove(), dur * 1000);
}
const emberInterval = setInterval(() => spawnEmber(), 150);

// CSS animations
const style = document.createElement('style');
style.textContent = `
  /* Hide Excalibur's default loader behind our overlay */
  .excalibur-loader, #excalibur-play { display: none !important; }
  @keyframes titlePulse {
    0%, 100% { text-shadow: 0 0 30px rgba(255,136,68,0.5), 0 0 60px rgba(255,100,30,0.3); }
    50% { text-shadow: 0 0 40px rgba(255,136,68,0.7), 0 0 80px rgba(255,100,30,0.5), 0 0 120px rgba(255,60,0,0.2); }
  }
  @keyframes emberRise {
    0% { transform: translateY(0) translateX(0); opacity: 0.7; }
    100% { transform: translateY(-100vh) translateX(${(Math.random() - 0.5) * 100}px); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Engine setup
const game = new ex.Engine({
  width: window.innerWidth,
  height: window.innerHeight,
  displayMode: ex.DisplayMode.FillScreen,
  backgroundColor: ex.Color.Black,
  pixelArt: true,
  antialiasing: false,
  suppressPlayButton: true,
});

// Custom loader — suppress Excalibur's default UI
const allAssets = [
  ...AssetLoader.allResources(),
  ...AssetLoader.allAnimResources(),
];
const loader = new ex.Loader(allAssets);
loader.suppressPlayButton = true;

// Track loading progress on our custom bar
const fillBar = document.getElementById('load-bar-fill');
const loadText = document.getElementById('load-text');
let loadedCount = 0;
const totalCount = allAssets.length;
let progressInterval = setInterval(() => {
  const progress = Math.round((loadedCount / Math.max(1, totalCount)) * 100);
  if (fillBar) fillBar.style.width = `${progress}%`;
  if (loadText) loadText.textContent = `Loading... ${progress}%`;
}, 200);

game.addScene('intro', new IntroScene());
game.addScene('menu', new MenuScene());
game.addScene('game', new GameScene());

game.start(loader).then(() => {
  clearInterval(progressInterval);
  clearInterval(emberInterval);
  console.log(`[Assets] loaded ${allAssets.length} resources`);

  // Fade out loading screen
  if (fillBar) fillBar.style.width = '100%';
  if (loadText) loadText.textContent = 'Ready';

  loadingEl.style.transition = 'opacity 0.8s';
  loadingEl.style.opacity = '0';
  setTimeout(() => {
    loadingEl.remove();
    style.remove();
  }, 800);

  // Skip intro for tests, go to game directly
  const params = new URLSearchParams(window.location.search);
  if (params.get('skipIntro')) {
    (window as any).__playerName = 'Dev';
    game.goToScene('game');
  } else {
    game.goToScene('intro');
  }
});
