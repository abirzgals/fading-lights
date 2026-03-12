// ============================================================
// AUTO-TEST — Quick start: load game, start bot
// Add ?autotest to URL or ?autotest=PlayerName
// Add ?nobot to skip starting the bot
// ============================================================

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
