// Dźwięk: WebAudio — SFX + cicha muzyka w tle.
const FILES = {
  ui_click: 'assets/audio/ui_click.wav',
  ui_open: 'assets/audio/ui_open.wav',
  ui_close: 'assets/audio/ui_close.wav',
  turn_end: 'assets/audio/turn_end.wav',
  alert: 'assets/audio/alert.wav',
  attack1: 'assets/audio/attack_swing1.wav',
  attack2: 'assets/audio/attack_swing2.wav',
  attack3: 'assets/audio/attack_swing3.wav',
  unit_ready: 'assets/audio/unit_ready.wav',
  unit_death: 'assets/audio/unit_death.wav',
  tech: 'assets/audio/tech_unlock.wav',
  wonder: 'assets/audio/wonder_complete.wav',
  gold1: 'assets/audio/gold1.wav',
  gold2: 'assets/audio/gold2.wav',
  build1: 'assets/audio/build_hammer.wav',
  build2: 'assets/audio/build_wood.wav',
  city: 'assets/audio/city_found.wav',
  barb1: 'assets/audio/barb_growl1.wav',
  barb2: 'assets/audio/barb_growl2.wav',
  spores: 'assets/audio/spores.wav',
  mycelium: 'assets/audio/mycelium.wav',
  swamp: 'assets/audio/swamp.wav',
  bees: 'assets/audio/bees.ogg',
  zap: 'assets/audio/zap_charge.wav',
  drums: 'assets/audio/war_drums.ogg',
  fanfare: 'assets/audio/victory_fanfare.mp3',
};
const MUSIC = ['assets/audio/music_market_day.mp3', 'assets/audio/music_tower_inn.mp3'];

class AudioSys {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.muted = false;
    this.musicEl = null;
    this.musicIdx = 0;
    this.started = false;
  }

  // Wywołaj po pierwszym geście użytkownika.
  async start() {
    if (this.started) return;
    this.started = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    // ładuj w tle
    for (const [name, url] of Object.entries(FILES)) {
      fetch(url).then(r => r.arrayBuffer())
        .then(ab => this.ctx.decodeAudioData(ab))
        .then(buf => this.buffers.set(name, buf))
        .catch(() => {});
    }
    this.playMusic();
  }

  playMusic(rate = this.musicRate || 1) {
    if (this.musicEl) return;
    const el = new Audio(MUSIC[this.musicIdx]);
    el.volume = this.muted ? 0 : 0.18;
    el.playbackRate = rate;
    el.addEventListener('ended', () => {
      this.musicIdx = (this.musicIdx + 1) % MUSIC.length;
      this.musicEl = null;
      this.playMusic();
    });
    el.play().catch(() => { this.musicEl = null; });
    this.musicEl = el;
  }

  // Każdy wynalazek przestraja muzykę: zmiana utworu + coraz żwawsze tempo epok.
  setEra(n) {
    const idx = n % MUSIC.length;
    this.musicRate = Math.min(1.18, 1 + n * 0.025);
    if (this.musicEl && this.musicIdx === idx) {
      this.musicEl.playbackRate = this.musicRate;
      return;
    }
    if (this.musicEl) {
      const old = this.musicEl;
      this.musicEl = null;
      const fade = setInterval(() => {
        old.volume = Math.max(0, old.volume - 0.025);
        if (old.volume <= 0.01) { clearInterval(fade); old.pause(); }
      }, 70);
    }
    this.musicIdx = idx;
    if (this.started) this.playMusic(this.musicRate);
  }

  play(name, { vol = 1, rate = 1, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }

  attack() { this.play('attack' + (1 + Math.floor(Math.random() * 3)), { vol: 0.9 }); }
  barb() { this.play('barb' + (1 + Math.floor(Math.random() * 2)), { vol: 0.8 }); }
  build() { this.play(Math.random() < 0.5 ? 'build1' : 'build2', { vol: 0.7 }); }
  gold() { this.play(Math.random() < 0.5 ? 'gold1' : 'gold2', { vol: 0.8 }); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.musicEl) this.musicEl.volume = this.muted ? 0 : 0.18;
    return this.muted;
  }
}

export const audio = new AudioSys();
