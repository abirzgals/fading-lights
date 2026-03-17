// ============================================================
// INTRO SCENE — Plays intro video before menu
// ============================================================

class IntroScene extends Phaser.Scene {
    constructor() { super('IntroScene'); }

    create() {
        const w = this.scale.width;
        const h = this.scale.height;
        this.cameras.main.setBackgroundColor('#000000');

        // Create HTML video element
        const video = document.createElement('video');
        video.src = 'assets/intro.mp4';
        video.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            object-fit: cover; z-index: 9999; background: #000;
        `;
        video.playsInline = true;
        video.muted = false;
        video.autoplay = true;
        document.body.appendChild(video);
        this._video = video;

        // Skip button
        const skipBtn = document.createElement('div');
        skipBtn.textContent = 'Skip >';
        skipBtn.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 10000;
            color: rgba(255,255,255,0.6); font-family: monospace; font-size: 14px;
            cursor: pointer; padding: 8px 18px;
            border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
            background: rgba(0,0,0,0.5); transition: all 0.2s;
        `;
        skipBtn.onmouseenter = () => { skipBtn.style.color = '#fff'; skipBtn.style.borderColor = '#fff'; };
        skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.6)'; skipBtn.style.borderColor = 'rgba(255,255,255,0.3)'; };
        document.body.appendChild(skipBtn);
        this._skipBtn = skipBtn;

        const goToMenu = () => {
            if (this._done) return;
            this._done = true;
            video.pause();
            // Fade out
            video.style.transition = 'opacity 0.5s';
            video.style.opacity = '0';
            skipBtn.style.transition = 'opacity 0.3s';
            skipBtn.style.opacity = '0';
            setTimeout(() => {
                video.remove();
                skipBtn.remove();
                this.scene.start('MenuScene');
            }, 500);
        };

        // Skip on click/tap/key
        skipBtn.onclick = goToMenu;
        video.addEventListener('ended', goToMenu);
        this.input.keyboard.on('keydown-SPACE', goToMenu);
        this.input.keyboard.on('keydown-ESC', goToMenu);
        this.input.keyboard.on('keydown-ENTER', goToMenu);
        // Tap anywhere on mobile
        video.addEventListener('click', goToMenu);

        // Auto-play with sound (may need user interaction first)
        video.play().catch(() => {
            // Autoplay blocked — play muted, then unmute on interaction
            video.muted = true;
            video.play();
            const unmute = () => {
                video.muted = false;
                document.removeEventListener('click', unmute);
                document.removeEventListener('touchstart', unmute);
            };
            document.addEventListener('click', unmute, { once: true });
            document.addEventListener('touchstart', unmute, { once: true });
        });
    }
}
