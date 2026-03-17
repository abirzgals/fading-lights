// ============================================================
// INTRO SCENE — Click/tap to start → intro video → menu
// ============================================================

class IntroScene extends Phaser.Scene {
    constructor() { super('IntroScene'); }

    create() {
        this.cameras.main.setBackgroundColor('#000000');
        this._done = false;

        // Always clean up any leftover intro elements from previous sessions
        document.querySelectorAll('[data-intro]').forEach(el => el.remove());

        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

        // --- Phase 1: "Tap to start" splash screen ---
        const splash = document.createElement('div');
        splash.setAttribute('data-intro', '1');
        splash.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            z-index: 9999; background: #020105;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            cursor: pointer; -webkit-tap-highlight-color: transparent;
        `;
        splash.innerHTML = `
            <div style="color: #FF8800; font-family: Georgia, serif; font-size: 28px;
                        letter-spacing: 4px; text-shadow: 0 0 20px rgba(255,100,0,0.5);
                        margin-bottom: 30px;">THE FADING LIGHT</div>
            <div style="color: rgba(255,255,255,0.5); font-family: monospace; font-size: 14px;
                        animation: introP 2s ease-in-out infinite;">Click or tap to begin</div>
            <style>@keyframes introP { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }</style>
        `;
        document.body.appendChild(splash);

        const goToMenu = () => {
            if (this._done) return;
            this._done = true;
            document.querySelectorAll('[data-intro]').forEach(el => {
                el.style.pointerEvents = 'none';
            });
            setTimeout(() => {
                document.querySelectorAll('[data-intro]').forEach(el => el.remove());
                this.input.keyboard.removeAllListeners();
                this.scene.start('MenuScene');
            }, 300);
        };

        const startIntro = () => {
            splash.style.transition = 'opacity 0.4s';
            splash.style.opacity = '0';
            splash.style.pointerEvents = 'none';

            setTimeout(() => {
                splash.remove();
                this._playVideo(isMobile, goToMenu);
            }, 400);
        };

        splash.addEventListener('click', startIntro, { once: true });
        splash.addEventListener('touchend', (e) => { e.preventDefault(); startIntro(); }, { once: true });
        this.input.keyboard.on('keydown-SPACE', startIntro);
        this.input.keyboard.on('keydown-ENTER', startIntro);
    }

    _playVideo(isMobile, goToMenu) {
        if (this._done) return;

        const video = document.createElement('video');
        video.src = isMobile ? 'assets/intro_mobile.mp4' : 'assets/intro.mp4';
        video.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            object-fit: contain; z-index: 9999; background: #000;
        `;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('data-intro', '1');
        video.preload = 'auto';
        document.body.appendChild(video);

        // Skip button
        const skipBtn = document.createElement('div');
        skipBtn.textContent = 'Skip ▶';
        skipBtn.setAttribute('data-intro', '1');
        skipBtn.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 10000;
            color: rgba(255,255,255,0.6); font-family: monospace; font-size: 14px;
            cursor: pointer; padding: 8px 18px;
            border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
            background: rgba(0,0,0,0.5); transition: all 0.2s;
            -webkit-tap-highlight-color: transparent;
        `;
        document.body.appendChild(skipBtn);

        // Skip controls
        skipBtn.onclick = goToMenu;
        skipBtn.ontouchend = (e) => { e.preventDefault(); goToMenu(); };
        video.addEventListener('ended', goToMenu);
        video.addEventListener('error', goToMenu);
        video.addEventListener('click', goToMenu);
        this.input.keyboard.on('keydown-SPACE', goToMenu);
        this.input.keyboard.on('keydown-ESC', goToMenu);
        this.input.keyboard.on('keydown-ENTER', goToMenu);

        // Safety timeout
        setTimeout(() => { if (!this._done) goToMenu(); }, 60000);

        // Play with sound
        video.muted = false;
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => goToMenu());
        });
    }
}
