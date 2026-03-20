import * as ex from 'excalibur';

/**
 * Intro scene — splash screen → video → menu.
 * Click/tap to start, then plays intro video, then transitions to menu.
 */
export class IntroScene extends ex.Scene {
  private overlay!: HTMLDivElement;

  onInitialize(engine: ex.Engine): void {
    // Splash screen
    this.overlay = document.createElement('div');
    this.overlay.id = 'intro-overlay';
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #000; display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 10000;
      cursor: pointer; font-family: monospace;
    `;
    this.overlay.innerHTML = `
      <div style="color: #FFD700; font-size: 28px; letter-spacing: 4px; margin-bottom: 16px;
                  text-shadow: 0 0 30px rgba(255,200,0,0.4);">THE FADING LIGHT</div>
      <div style="color: #666; font-size: 13px; animation: pulse 2s ease-in-out infinite;">
        Click or tap to begin
      </div>
      <style>@keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }</style>
    `;
    document.body.appendChild(this.overlay);

    let transitioned = false;
    const goToMenu = () => {
      if (transitioned) return; // prevent double-fire from video error + timeout
      transitioned = true;
      this.overlay.style.transition = 'opacity 0.5s';
      this.overlay.style.opacity = '0';
      setTimeout(() => {
        if (this.overlay.parentNode) this.overlay.remove();
        engine.goToScene('menu');
      }, 500);
    };

    const startIntro = () => {
      // Try to play video, fallback to menu
      this.playVideo(engine, goToMenu);
    };

    this.overlay.addEventListener('click', startIntro, { once: true });
    this.overlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      startIntro();
    }, { once: true });
  }

  private playVideo(engine: ex.Engine, onDone: () => void): void {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    // Replace splash with video
    this.overlay.innerHTML = '';
    this.overlay.style.cursor = 'default';

    const video = document.createElement('video');
    video.src = isMobile ? '/assets/intro_mobile.mp4' : '/assets/intro.mp4';
    video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
    video.playsInline = true;
    video.muted = isMobile; // iOS requires muted autoplay
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    this.overlay.appendChild(video);

    // Skip button
    const skipBtn = document.createElement('div');
    skipBtn.textContent = 'Skip ▶';
    skipBtn.style.cssText = `
      position: absolute; bottom: 30px; right: 30px;
      color: #888; font-family: monospace; font-size: 14px;
      cursor: pointer; padding: 8px 16px;
      border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
      transition: color 0.2s;
    `;
    skipBtn.addEventListener('mouseenter', () => skipBtn.style.color = '#fff');
    skipBtn.addEventListener('mouseleave', () => skipBtn.style.color = '#888');
    skipBtn.addEventListener('click', onDone);
    this.overlay.appendChild(skipBtn);

    // Timeout fallback (30s max)
    const timeout = setTimeout(onDone, 30000);

    // Video events — clear timeout on ALL completion paths
    video.addEventListener('ended', () => { clearTimeout(timeout); onDone(); });
    video.addEventListener('error', () => { clearTimeout(timeout); onDone(); });

    video.play().catch(() => {
      // Autoplay blocked — go to menu
      clearTimeout(timeout);
      onDone();
    });
  }

  onDeactivate(): void {
    if (this.overlay?.parentNode) this.overlay.remove();
  }
}
