// ============================================================
// INTRO SCENE — Plays intro video before menu
// ============================================================

class IntroScene extends Phaser.Scene {
    constructor() { super('IntroScene'); }

    create() {
        this.cameras.main.setBackgroundColor('#000000');
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

        // Create HTML video element
        const video = document.createElement('video');
        // Mobile: use compressed version (5MB vs 30MB), baseline profile for compatibility
        video.src = isMobile ? 'assets/intro_mobile.mp4' : 'assets/intro.mp4';
        video.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            object-fit: cover; z-index: 9999; background: #000;
        `;
        video.playsInline = true;
        video.setAttribute('playsinline', '');    // iOS Safari needs attribute
        video.setAttribute('webkit-playsinline', ''); // older iOS
        video.preload = 'auto';
        document.body.appendChild(video);
        this._video = video;

        // Skip button
        const skipBtn = document.createElement('div');
        skipBtn.textContent = 'Skip ▶';
        skipBtn.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 10000;
            color: rgba(255,255,255,0.6); font-family: monospace; font-size: 14px;
            cursor: pointer; padding: 8px 18px;
            border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
            background: rgba(0,0,0,0.5); transition: all 0.2s;
            -webkit-tap-highlight-color: transparent;
        `;
        skipBtn.onmouseenter = () => { skipBtn.style.color = '#fff'; skipBtn.style.borderColor = '#fff'; };
        skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.6)'; skipBtn.style.borderColor = 'rgba(255,255,255,0.3)'; };
        document.body.appendChild(skipBtn);
        this._skipBtn = skipBtn;

        // Cleanup helper — remove ALL intro overlay elements
        const cleanupAll = () => {
            document.querySelectorAll('[data-intro]').forEach(el => el.remove());
        };

        const goToMenu = () => {
            if (this._done) return;
            this._done = true;
            video.pause();
            // Immediately stop blocking clicks
            video.style.pointerEvents = 'none';
            skipBtn.style.pointerEvents = 'none';
            video.style.transition = 'opacity 0.5s';
            video.style.opacity = '0';
            skipBtn.style.transition = 'opacity 0.3s';
            skipBtn.style.opacity = '0';
            setTimeout(() => {
                cleanupAll();
                this.scene.start('MenuScene');
            }, 500);
        };

        // Tag all intro elements for cleanup
        video.setAttribute('data-intro', '1');
        skipBtn.setAttribute('data-intro', '1');

        // Safety: if video fails to load, skip to menu
        video.addEventListener('error', goToMenu);
        // Safety timeout: if nothing happens in 60s, skip
        setTimeout(() => { if (!this._done) goToMenu(); }, 60000);

        // Skip on click/tap/key
        skipBtn.onclick = goToMenu;
        skipBtn.ontouchend = (e) => { e.preventDefault(); goToMenu(); };
        video.addEventListener('ended', goToMenu);
        this.input.keyboard.on('keydown-SPACE', goToMenu);
        this.input.keyboard.on('keydown-ESC', goToMenu);
        this.input.keyboard.on('keydown-ENTER', goToMenu);

        // Mobile: start muted (required by autoplay policy), show tap-to-unmute
        if (isMobile) {
            video.muted = true;
            video.play().catch(() => {});

            // "Tap to unmute" hint
            const muteHint = document.createElement('div');
            muteHint.textContent = '🔇 Tap to unmute';
            muteHint.style.cssText = `
                position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                z-index: 10000; color: rgba(255,255,255,0.7); font-family: monospace;
                font-size: 12px; padding: 6px 14px; background: rgba(0,0,0,0.5);
                border-radius: 4px; transition: opacity 0.3s;
            `;
            muteHint.setAttribute('data-intro', '1');
            document.body.appendChild(muteHint);

            const unmute = () => {
                video.muted = false;
                muteHint.style.opacity = '0';
                setTimeout(() => muteHint.remove(), 300);
            };
            video.addEventListener('click', unmute, { once: true });
            video.addEventListener('touchend', unmute, { once: true });

            // Also allow tap on video to skip (second tap)
            let tapped = false;
            video.addEventListener('touchend', () => {
                if (tapped) goToMenu();
                tapped = true;
            });
        } else {
            // Desktop: try with sound, fallback to muted
            video.muted = false;
            video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {
                    // Video completely blocked — skip to menu
                    goToMenu();
                });
            });
            // Click on video to skip (desktop)
            video.addEventListener('click', goToMenu);
        }
    }
}
