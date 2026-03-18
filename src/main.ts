import * as ex from 'excalibur';
import { GAME_VERSION } from './config';
import { IntroScene } from './scenes/IntroScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { AssetLoader } from './engine/AssetLoader';

console.log(`The Fading Light v${GAME_VERSION} — Excalibur.js + TypeScript`);

const game = new ex.Engine({
  width: window.innerWidth,
  height: window.innerHeight,
  displayMode: ex.DisplayMode.FillScreen,
  backgroundColor: ex.Color.Black,
  pixelArt: true,
  antialiasing: false,
  suppressPlayButton: true,
});

const loader = new ex.Loader(AssetLoader.allResources());
loader.suppressPlayButton = true;

game.addScene('intro', new IntroScene());
game.addScene('menu', new MenuScene());
game.addScene('game', new GameScene());

game.start(loader).then(() => {
  console.log('[Assets] loaded');
  game.goToScene('intro');
});
