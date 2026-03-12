// ============================================================
// FILE-BASED AUDIO ENGINE
// ============================================================
// Audio files go in audio/ folder.
//
// LOOPS (seamless repeat):
//   audio/music.mp3          — background music
//   audio/fire_crackle.mp3   — bonfire ambient crackle
//   audio/footsteps.mp3      — grass walking loop
//   audio/ambient.mp3        — wind / dark atmosphere drone
//
// ONE-SHOTS (play once per trigger):
//   audio/attack.mp3         — weapon swing
//   audio/hit.mp3            — weapon hits enemy
//   audio/chop.mp3           — axe hits tree/stone
//   audio/pickup.mp3         — resource collected
//   audio/enemy_death.mp3    — shadow creature dies
//   audio/enemy_roar.mp3     — enemy spawn / aggro
//   audio/player_hurt.mp3    — player takes damage
//   audio/build.mp3          — building placed
//   audio/craft.mp3          — weapon crafted
//   audio/fire_fuel.mp3      — wood added to bonfire
//   audio/wave.mp3           — new wave warning
//   audio/game_over.mp3      — death screen
//
// Missing files are silently skipped.

const AUDIO_CONFIG = {
    // Loops
    menu_music:   { file: 'audio/menu_music.mp3',   volume: 0.3,  loop: true },
    music:        { file: 'audio/music.mp3',        volume: 0.25, loop: true },
    fire_crackle: { file: 'audio/fire_crackle.mp3', volume: 0.4,  loop: true },
    footsteps:    { file: 'audio/footsteps.mp3',    volume: 0.3,  loop: true },
    ambient:      { file: 'audio/ambient.mp3',      volume: 0.2,  loop: true },
    rain:         { file: 'audio/rain.mp3',        volume: 0.35, loop: true },

    // One-shots
    // Files present: attack.mp3, enemy_death.mp3, enemy_roar.mp3
    // Shared where dedicated files are missing — just drop in the mp3 to override
    attack:       { file: 'audio/attack.mp3',       volume: 0.5,  loop: false },
    hit:          { file: 'audio/hit.mp3',           volume: 0.5,  loop: false },       // falls back silently if missing
    chop:         { file: 'audio/chop.mp3',          volume: 0.5,  loop: false },       // falls back silently if missing
    pickup:       { file: 'audio/pickup.mp3',        volume: 0.4,  loop: false },
    enemy_death:  { file: 'audio/enemy_death.mp3',   volume: 0.5,  loop: false },
    enemy_roar:   { file: 'audio/enemy_roar.mp3',    volume: 0.4,  loop: false },
    player_hurt:  { file: 'audio/player_hurt.mp3',   volume: 0.5,  loop: false },
    build:        { file: 'audio/build.mp3',         volume: 0.5,  loop: false },
    craft:        { file: 'audio/craft.mp3',         volume: 0.5,  loop: false },
    fire_fuel:    { file: 'audio/fire_fuel.mp3',     volume: 0.5,  loop: false },
    wave:         { file: 'audio/wave.mp3',          volume: 0.6,  loop: false },
    game_over:    { file: 'audio/game_over.mp3',     volume: 0.6,  loop: false },
};

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.started = false;
        this.ready = false;          // true after all sounds loaded
        this.masterGain = null;
        this.buffers = {};
        this.loopSources = {};
        this.loadErrors = new Set();
        this.pendingLoops = [];      // queued startLoop calls before ready
    }

    async init() {
        if (this.started) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume suspended context (required by most browsers)
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5;
        this.masterGain.connect(this.ctx.destination);
        this.started = true;

        const loads = Object.entries(AUDIO_CONFIG).map(([key, cfg]) =>
            this.loadSound(key, cfg.file)
        );
        await Promise.all(loads);

        this.ready = true;

        // Play any loops that were requested before audio was ready
        for (const { key, fadeInMs } of this.pendingLoops) {
            this.startLoop(key, fadeInMs);
        }
        this.pendingLoops = [];
    }

    // Ensure context is running (call before any playback)
    async ensureResumed() {
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    async loadSound(key, file) {
        try {
            const response = await fetch(file);
            if (!response.ok) throw new Error(`${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            this.buffers[key] = await this.ctx.decodeAudioData(arrayBuffer);
        } catch (e) {
            this.loadErrors.add(key);
        }
    }

    // --- LOOPS ---
    startLoop(key, fadeInMs = 0) {
        // Queue if audio not ready yet
        if (!this.ready) {
            // Avoid duplicates in queue
            if (!this.pendingLoops.find(p => p.key === key)) {
                this.pendingLoops.push({ key, fadeInMs });
            }
            return;
        }
        if (!this.buffers[key]) return;
        if (this.loopSources[key]) return;
        this.ensureResumed();

        const cfg = AUDIO_CONFIG[key];
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[key];
        source.loop = true;

        const gain = this.ctx.createGain();
        if (fadeInMs > 0) {
            gain.gain.setValueAtTime(0, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(cfg.volume, this.ctx.currentTime + fadeInMs / 1000);
        } else {
            gain.gain.value = cfg.volume;
        }

        source.connect(gain);
        gain.connect(this.masterGain);
        source.start();

        this.loopSources[key] = { source, gain };
    }

    stopLoop(key, fadeOutMs = 500) {
        const loop = this.loopSources[key];
        if (!loop) return;
        const { source, gain } = loop;
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOutMs / 1000);
        setTimeout(() => {
            try { source.stop(); } catch (e) {}
        }, fadeOutMs);
        delete this.loopSources[key];
    }

    stopAllLoops(fadeOutMs = 1000) {
        for (const key of Object.keys(this.loopSources)) {
            this.stopLoop(key, fadeOutMs);
        }
    }

    setLoopVolume(key, volume, rampMs = 200) {
        const loop = this.loopSources[key];
        if (!loop) return;
        loop.gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + rampMs / 1000);
    }

    // --- ONE-SHOTS ---
    playOneShot(key, volumeScale = 1.0, pitchVariation = 0) {
        if (!this.started || !this.buffers[key]) return;
        this.ensureResumed();
        const cfg = AUDIO_CONFIG[key];

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[key];
        source.loop = false;

        if (pitchVariation > 0) {
            source.playbackRate.value = 1.0 + (Math.random() * 2 - 1) * pitchVariation;
        }

        const gain = this.ctx.createGain();
        gain.gain.value = cfg.volume * volumeScale;
        source.connect(gain);
        gain.connect(this.masterGain);
        source.start();

        return source;
    }

    // --- CONVENIENCE METHODS ---
    // Uses fallback to 'attack' sound if dedicated file is missing
    playAttack()     { this.playOneShot('attack', 1.0, 0.05); }
    playHit()        { this.playOneShot(this.buffers['hit'] ? 'hit' : 'attack', 0.7, 0.15); }
    playChop()       { this.playOneShot(this.buffers['chop'] ? 'chop' : 'attack', 0.6, 0.2); }
    playPickup()     { this.playOneShot('pickup'); }
    playEnemyDeath() { this.playOneShot('enemy_death', 1.0, 0.1); }
    playEnemyRoar()  { this.playOneShot('enemy_roar', 0.8, 0.15); }
    playPlayerHurt() { this.playOneShot(this.buffers['player_hurt'] ? 'player_hurt' : 'enemy_roar', 0.5, 0.1); }
    playBuild()      { this.playOneShot(this.buffers['build'] ? 'build' : 'attack', 0.4, 0.3); }
    playCraft()      { this.playOneShot(this.buffers['craft'] ? 'craft' : 'attack', 0.5, 0); }
    playFireFuel()   { this.playOneShot(this.buffers['fire_fuel'] ? 'fire_fuel' : 'attack', 0.3, 0.2); }
    playWave()       { this.playOneShot(this.buffers['wave'] ? 'wave' : 'enemy_roar', 1.0, 0); }
    playGameOver()   { this.playOneShot(this.buffers['game_over'] ? 'game_over' : 'enemy_death', 1.0, 0); }

    startFootsteps() { this.startLoop('footsteps'); }
    stopFootsteps()  { this.stopLoop('footsteps', 200); }

    // Proximity-based fire crackle:
    // - Close (< nearDist): full volume
    // - Mid: gradual fade
    // - Far (> farDist): silent, stop loop entirely
    updateFireProximity(distToNearest, nearDist = 120, farDist = 400) {
        if (distToNearest > farDist) {
            // Too far — stop the loop
            if (this.loopSources['fire_crackle']) {
                this.stopLoop('fire_crackle', 300);
            }
            return;
        }

        // Ensure loop is running
        if (!this.loopSources['fire_crackle']) {
            this.startLoop('fire_crackle', 200);
        }

        // Calculate volume: 1.0 at nearDist, 0.0 at farDist
        const baseVol = AUDIO_CONFIG.fire_crackle.volume;
        let t = 1.0;
        if (distToNearest > nearDist) {
            t = 1.0 - (distToNearest - nearDist) / (farDist - nearDist);
        }
        t = Math.max(0, Math.min(1, t));
        this.setLoopVolume('fire_crackle', baseVol * t * t); // quadratic for natural falloff
    }
}

const audioEngine = new AudioEngine();

// Start audio on first user interaction (browser requirement)
// Mobile browsers require touchstart specifically
const initAudio = () => {
    audioEngine.init();
    // Remove all listeners after first trigger
    document.removeEventListener('keydown', initAudio);
    document.removeEventListener('click', initAudio);
    document.removeEventListener('touchstart', initAudio);
    document.removeEventListener('touchend', initAudio);
    document.removeEventListener('pointerdown', initAudio);
};
document.addEventListener('keydown', initAudio);
document.addEventListener('click', initAudio);
document.addEventListener('touchstart', initAudio);
document.addEventListener('touchend', initAudio);
document.addEventListener('pointerdown', initAudio);
