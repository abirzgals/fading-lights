/**
 * Audio engine — Web Audio API wrapper for music loops and sound effects.
 * Ported from original audio.js with typed API.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private loops: Map<string, { source: AudioBufferSourceNode; gain: GainNode }> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  private loading: Map<string, Promise<AudioBuffer>> = new Map();

  constructor() {
    // Create context on first user interaction (browser autoplay policy)
    const resume = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5;
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    document.addEventListener('click', resume, { once: false });
    document.addEventListener('keydown', resume, { once: false });
    document.addEventListener('touchstart', resume, { once: false });
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    if (this.buffers.has(url)) return this.buffers.get(url)!;
    if (this.loading.has(url)) return this.loading.get(url)!;

    const promise = fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => this.ctx!.decodeAudioData(buf))
      .then(decoded => {
        this.buffers.set(url, decoded);
        return decoded;
      });
    this.loading.set(url, promise);
    return promise;
  }

  /** Play a one-shot sound effect */
  async playOneShot(url: string, volume: number = 0.5): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    try {
      const buffer = await this.loadBuffer(url);
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.masterGain);
      source.start();
    } catch (e) { /* silent fail */ }
  }

  /** Start a looping audio track with fade-in */
  async startLoop(name: string, url: string, volume: number = 0.3, fadeMs: number = 3000): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    if (this.loops.has(name)) return; // already playing

    try {
      const buffer = await this.loadBuffer(url);
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.masterGain);
      source.start();

      // Fade in
      gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + fadeMs / 1000);

      this.loops.set(name, { source, gain });
    } catch (e) { /* silent fail */ }
  }

  /** Stop a looping track with fade-out */
  stopLoop(name: string, fadeMs: number = 1000): void {
    const loop = this.loops.get(name);
    if (!loop || !this.ctx) return;

    // Remove from map immediately so startLoop can re-create if needed
    this.loops.delete(name);
    loop.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeMs / 1000);
    setTimeout(() => {
      try { loop.source.stop(); } catch (_e) { /* already stopped */ }
    }, fadeMs);
  }

  /** Stop all loops */
  stopAll(fadeMs: number = 500): void {
    for (const name of this.loops.keys()) {
      this.stopLoop(name, fadeMs);
    }
  }

  // --- Convenience methods (same names as original) ---

  playAttack() { this.playOneShot('/audio/attack.mp3', 0.5); }
  playEnemyDeath() { this.playOneShot('/audio/enemy_death.mp3', 0.5); }
  playEnemyRoar() { this.playOneShot('/audio/enemy_roar.mp3', 0.4); }
  playFireFuel() { this.playOneShot('/audio/fire_crackle.mp3', 0.3); }

  startMusic() { this.startLoop('music', '/audio/music.mp3', 0.25, 3000); }
  startMenuMusic() { this.startLoop('menu_music', '/audio/menu_music.mp3', 0.3, 3000); }
  startMazeMusic() { this.startLoop('music_lvl2', '/audio/music_lvl2.mp3', 0.25, 3000); }
  startFireCrackle() { this.startLoop('fire_crackle', '/audio/fire_crackle.mp3', 0.4, 1000); }
  startFootsteps() { this.startLoop('footsteps', '/audio/footsteps.mp3', 0.3, 200); }
  startAmbient() { this.startLoop('ambient', '/audio/rain.mp3', 0.15, 2000); }
  stopFootsteps() { this.stopLoop('footsteps', 100); }
  stopMusic() { this.stopLoop('music', 1000); }
}

/** Global audio engine singleton */
export const audioEngine = new AudioEngine();
