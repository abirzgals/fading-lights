// ============================================================
// GAME LAUNCH — Phaser config with proper scaling
// ============================================================

const GAME_VERSION = '0.5.1';

const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
        autoCenter: Phaser.Scale.CENTER_BOTH,
        autoRound: true,
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false,
        }
    },
    scene: [MenuScene, GameScene],
    render: {
        pixelArt: true,
        antialias: false,
    },
    input: {
        activePointers: 2,
    },
});

// Handle window resize for fog canvas
window.addEventListener('resize', () => {
    // Scenes will recreate their fog canvases on next create()
});
