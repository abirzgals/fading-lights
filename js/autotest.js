// ============================================================
// AUTO-TEST — Quick start: load game, start bot
// Add ?autotest to URL or ?autotest=PlayerName
// Add ?nobot to skip starting the bot
// ============================================================

// ============================================================
// MAZE DEBUG — Skip straight to Level 2 (MazeScene)
// Add ?maze to URL
// Textures are generated in MenuScene.preload(), so we wait
// for the menu to be ready then jump directly to MazeScene.
// ============================================================
if (new URLSearchParams(location.search).has('maze')) {
    console.log('%c[MAZE] Waiting for engine...', 'color:#44AAFF');

    var _mazeCheck = setInterval(function() {
        if (typeof game === 'undefined' || !game || !game.scene) return;
        var menu = game.scene.getScene('MenuScene');
        // Wait until MenuScene has finished preload (textures ready)
        if (!menu || !menu.textures || !menu.textures.exists('player')) return;
        clearInterval(_mazeCheck);

        console.log('%c[MAZE] Textures ready — jumping straight to MazeScene', 'color:#44AAFF');

        // Seed gameState so MazeScene has everything it needs
        gameState.hp         = CONFIG.PLAYER_MAX_HP;
        gameState.weapon     = 'IRON_SWORD';
        gameState.armor      = 0;
        gameState.hasTorch   = true;
        gameState.resources  = { wood: 10, stone: 5, metal: 3, gold: 0 };
        gameState.time       = 0;
        gameState.gameOver   = false;

        // Also init network stub so MazeScene doesn't crash on network.playerColor
        if (typeof network !== 'undefined' && !network.playerColor) {
            network.playerColor = '#4488FF';
        }

        game.scene.start('MazeScene');
        console.log('%c[MAZE] MazeScene started', 'color:#44FF44');
    }, 100);
}

if (new URLSearchParams(location.search).has('autotest')) {
    var _atName = new URLSearchParams(location.search).get('autotest') || 'BotHost';
    var _atBot = !new URLSearchParams(location.search).has('nobot');

    console.log('%c[AUTOTEST] Will auto-start as "' + _atName + '"', 'color: #FFaa00');

    var _atMenuCheck = setInterval(function() {
        // game is a const from main.js — accessible in same script scope
        if (typeof game === 'undefined' || !game || !game.scene) return;
        var menu = game.scene.getScene('MenuScene');
        if (!menu || !menu._startGame) return;
        clearInterval(_atMenuCheck);

        // Set player name
        var nameInput = document.getElementById('player-name-input');
        if (nameInput) nameInput.value = _atName;

        // Wait for GameScene after starting
        var _atGameCheck = setInterval(function() {
            if (window._gs && window._gs.player && window._gs.player.active) {
                clearInterval(_atGameCheck);
                console.log('%c[AUTOTEST] GameScene ready', 'color: #44FF44');
                if (_atBot && window.startAI) {
                    setTimeout(function() {
                        window.startAI();
                        console.log('%c[AUTOTEST] Bot started', 'color: #44FF44');
                    }, 500);
                }
            }
        }, 200);

        console.log('%c[AUTOTEST] Starting game...', 'color: #FFaa00');
        menu._startGame();
    }, 100);
}
