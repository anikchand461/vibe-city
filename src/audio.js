// All sound is synthesised with WebAudio: engines (petrol, diesel, two-stroke, electric
// traction), horns and bells, tyres, wind, impacts, the street ambience of Kolkata, and an
// optional background music track (off by default).
import { damp, lerp } from './utils.js';

const loadFlag = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const saveFlag = (k, v) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
};

/** How each kind of vehicle sounds. */
const SOUND = {
  car: { base: 40, span: 150, filt: 300, filtSpan: 2200, lfo: 0.3, vol: 1, clatter: 0, electric: 0, horn: [392, 494], hornType: 'square' },
  amby: { base: 30, span: 118, filt: 220, filtSpan: 1500, lfo: 0.5, vol: 1.05, clatter: 0.015, electric: 0, horn: [420, 523], hornType: 'square' },
  diesel: { base: 22, span: 68, filt: 180, filtSpan: 1000, lfo: 0.55, vol: 1.25, clatter: 0.06, electric: 0, horn: [277, 349, 415], hornType: 'sawtooth' },
  auto: { base: 34, span: 120, filt: 650, filtSpan: 2600, lfo: 0.75, vol: 0.9, clatter: 0.035, electric: 0, horn: [740, 880], hornType: 'square' },
  bike: { base: 58, span: 230, filt: 600, filtSpan: 3200, lfo: 0.45, vol: 0.85, clatter: 0, electric: 0, horn: [660, 784], hornType: 'square' },
  boat: { base: 20, span: 60, filt: 160, filtSpan: 700, lfo: 0.6, vol: 1.2, clatter: 0.04, electric: 0, horn: [196, 247], hornType: 'sawtooth' },
  electric: { base: 0, span: 0, filt: 0, filtSpan: 0, lfo: 0, vol: 0, clatter: 0, electric: 1, horn: null },
  muscle: { base: 0, span: 0, filt: 0, filtSpan: 0, lfo: 0, vol: 0, clatter: 0, electric: 0, horn: null },
};
const KIND_SOUND = { auto: 'auto', taxi: 'amby', ambassador: 'amby', bus: 'diesel', schoolbus: 'diesel', truck: 'diesel', pickup: 'diesel', van: 'car', bike: 'bike', rickshaw: 'muscle', tram: 'electric', metro: 'electric', train: 'electric', express: 'electric', boat: 'boat' };

export const RADIO_STATIONS = [
  { id: 'synth', name: 'Synthwave 96', dial: '96.0 FM', desc: 'Neon Kolkata High-Tempo Synth', bpm: 96, color: '#ff3fa4' },
  { id: 'air', name: 'AIR Kolkata', dial: '657 kHz AM', desc: 'Akashvani Kolkata · Morning Raga & Sitar', bpm: 72, color: '#f4c51c' },
  { id: 'disco', name: 'Park Street Disco', dial: '104.2 FM', desc: '80s Retro Bengali & Bollywood Funk', bpm: 118, color: '#3f86d8' },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.radioOn = loadFlag('kol_music', false);
    const savedSt = parseInt(localStorage.getItem('kol_station_idx') || '0', 10);
    this.stationIndex = isNaN(savedSt) ? 0 : Math.max(0, Math.min(RADIO_STATIONS.length - 1, savedSt));
    this.kind = 'car';
    this.clackT = 0;
    this.stepT = 0;
    this.hornWas = false;
    this.amb = { hornT: 3, crowT: 8, modT: 0 };
    this.initDhak();
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp);

    // Noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Engine: detuned saws + sub, amplitude-modulated for a "firing" pulse
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 3;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engAM = ctx.createGain();
    this.engAM.gain.value = 0.7;
    this.engFilter.connect(this.engAM).connect(this.engGain).connect(this.master);
    this.oscs = [
      ['sawtooth', 1, 0.5],
      ['sawtooth', 1.005, 0.4],
      ['square', 0.5, 0.35],
      ['sine', 0.25, 0.6],
    ].map(([type, mul, g]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.engFilter);
      o.start();
      return { o, mul };
    });
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;
    this.lfo.connect(lfoGain).connect(this.engAM.gain);
    this.lfo.start();

    // Tyre screech
    this.screech = this.loopNoise('bandpass', 1900, 5);
    // Wind
    this.wind = this.loopNoise('lowpass', 500, 0.7);

    // Horn
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornGain.connect(this.master);
    this.hornOscs = [392, 494, 415].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.value = i < 2 ? 1 : 0.7;
      o.connect(lp).connect(g).connect(this.hornGain);
      o.start();
      return o;
    });

    // Diesel clatter: band-passed noise chopped at the firing rate
    this.clatter = this.loopNoise('bandpass', 1500, 1.4);
    this.clatterLfo = ctx.createOscillator();
    this.clatterLfo.type = 'square';
    this.clatterDepth = ctx.createGain();
    this.clatterDepth.gain.value = 0;
    this.clatterLfo.connect(this.clatterDepth).connect(this.clatter.g.gain);
    this.clatterLfo.start();
    // Electric traction: a motor whine and wheel rumble
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineGain.connect(this.master);
    this.whine = [1, 2.02].map((m) => {
      const o = ctx.createOscillator();
      o.type = m === 1 ? 'sine' : 'triangle';
      const g = ctx.createGain();
      g.gain.value = m === 1 ? 0.6 : 0.25;
      o.connect(g).connect(this.whineGain);
      o.start();
      return { o, m };
    });
    this.rumble = this.loopNoise('lowpass', 220, 0.8);

    // Street ambience: traffic bed, crowd murmur, the river
    this.trafficBed = this.loopNoise('lowpass', 180, 0.5);
    this.crowd = this.loopNoise('bandpass', 650, 0.7);
    this.river = this.loopNoise('lowpass', 420, 0.5);
    // rain: a hiss on the roofs and road, and a softer patter underneath
    this.rainHiss = this.loopNoise('highpass', 1600, 0.4);
    this.rainPatter = this.loopNoise('bandpass', 520, 0.6);

    this.initRadio();
    this.initDhak();
  }

  loopNoise(type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { g, f };
  }

  update({ rpm, throttle, speed, skid, nitro, engineOn = true, pitch = 1, kind = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const S = SOUND[KIND_SOUND[kind] || 'car'];
    this.kind = kind;
    const f = (S.base + rpm * S.span) * pitch;
    const run = engineOn && S.vol > 0;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(Math.max(10, f * mul), t, 0.04);
    this.lfo.frequency.setTargetAtTime(Math.max(5, f * 0.5), t, 0.04);
    this.engAM.gain.setTargetAtTime(0.7 * (1 - S.lfo * 0.5), t, 0.1);
    this.engFilter.frequency.setTargetAtTime(S.filt + rpm * S.filtSpan * (0.35 + throttle * 0.65) + (nitro ? 900 : 0), t, 0.05);
    this.engGain.gain.setTargetAtTime(run ? (0.06 + throttle * 0.08 + rpm * 0.04) * S.vol : 0, t, 0.15);
    // diesel knock at the firing frequency
    const knock = run ? S.clatter * (0.6 + throttle * 0.8) : 0;
    this.clatterLfo.frequency.setTargetAtTime(Math.max(4, f * 0.5), t, 0.05);
    this.clatter.g.gain.setTargetAtTime(knock, t, 0.1);
    this.clatterDepth.gain.setTargetAtTime(knock, t, 0.1);
    // electric traction: whine rising with speed, rumble of the wheels
    const el = engineOn && S.electric ? 1 : 0;
    for (const { o, m } of this.whine) o.frequency.setTargetAtTime((90 + speed * 38) * m * (kind === 'metro' ? 1.4 : 1), t, 0.1);
    this.whineGain.gain.setTargetAtTime(el * Math.min(0.05, 0.006 + speed * 0.0025), t, 0.2);
    this.rumble.g.gain.setTargetAtTime(el * Math.min(0.18, speed * 0.008), t, 0.2);
    // rail joints every 13 m: a double clack as each bogie passes
    if (el && kind !== 'metro' && speed > 1.5) {
      this.clackT -= 1 / 60;
      if (this.clackT <= 0) {
        this.clackT = 13 / speed;
        const v = Math.min(0.25, 0.05 + speed * 0.008);
        for (const d of [0, 0.11, 0.55 * Math.min(1, 8 / speed), 0.66 * Math.min(1, 8 / speed)]) this.burst(t + d, { type: 'lowpass', freq: 900, vol: v, dur: 0.06 });
      }
    }
    // the rickshaw puller's bare feet on the road
    if (kind === 'rickshaw' && speed > 0.3) {
      this.stepT -= 1 / 60;
      if (this.stepT <= 0) {
        this.stepT = 0.85 / Math.max(0.6, speed * 0.55);
        this.burst(t, { type: 'lowpass', freq: 320, vol: 0.12, dur: 0.07 });
      }
    }
    this.screech.g.gain.setTargetAtTime(kind === 'rickshaw' || el ? 0 : skid * 0.12, t, 0.05);
    this.screech.f.frequency.setTargetAtTime(1700 + skid * 600, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(1, speed / 70) * 0.12, t, 0.2);
  }

  /**
   * Kolkata's streets: a traffic bed, horns in the distance, people talking, crows
   * by day and water lapping near the river. Inputs are 0..1-ish densities.
   */
  ambient(dt, { traffic = 0, people = 0, river = 0, night = 0, underground = false }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const A = this.amb;
    const out = underground ? 0.15 : 1;
    this.trafficBed.g.gain.setTargetAtTime(Math.min(0.09, 0.012 + traffic * 0.012) * out, t, 0.5);
    this.crowd.g.gain.setTargetAtTime(Math.min(0.05, people * 0.006) * out, t, 0.4);
    this.river.g.gain.setTargetAtTime(river * 0.06 * out, t, 0.6);
    A.modT -= dt;
    if (A.modT <= 0) {
      // let the murmur and the water wander
      A.modT = 0.35;
      this.crowd.f.frequency.setTargetAtTime(450 + Math.random() * 700, t, 0.2);
      this.river.f.frequency.setTargetAtTime(280 + Math.random() * 300, t, 0.4);
    }
    // crows by day
    A.crowT -= dt;
    if (A.crowT <= 0) {
      A.crowT = 6 + Math.random() * 16;
      if (night < 0.4 && !underground) {
        const pan = Math.random() * 2 - 1;
        const caws = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < caws; k++) this.caw(k * 0.42, pan, 0.02 + Math.random() * 0.02);
      }
    }
  }

  /** Rain at 0..1 (already lowered underground by the caller). */
  rain(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainHiss.g.gain.setTargetAtTime(level * 0.07, t, 1.2);
    this.rainPatter.g.gain.setTargetAtTime(level * 0.05, t, 1.2);
  }
  /** Thunder after `delay` seconds: a crack, then a long low roll. */
  thunder(delay, vol = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    this.burst(t, { type: 'lowpass', freq: 1800, endFreq: 300, q: 0.7, vol: 0.12 * vol, dur: 0.35 });
    for (let k = 0; k < 9; k++) {
      const at = t + 0.15 + k * 0.28 + Math.random() * 0.12;
      this.burst(at, { type: 'lowpass', freq: 220 - k * 12, endFreq: 60, q: 0.9, vol: (0.2 - k * 0.018) * vol, dur: 0.45 });
    }
  }

  /** A horn from a vehicle dist metres away, pan -1..1, in that kind of vehicle's voice. */
  hornAt(kind, dist, pan) {
    if (!this.ctx) return;
    const S = SOUND[KIND_SOUND[kind] || 'car'];
    if (!S.horn) return;
    const v = Math.min(0.06, 1.2 / Math.max(dist, 6) / 6);
    const n = Math.random() < 0.3 ? 2 : 1;
    const len = S.hornType === 'sawtooth' ? 0.5 : 0.22 + Math.random() * 0.2;
    for (let k = 0; k < n; k++) for (const fr of S.horn) this.toneP(fr, len, S.hornType, v, null, k * 0.3, pan, Math.max(700, 2200 - dist * 15));
  }

  /** One crow's "kaa". */
  caw(delay, pan, vol) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(760, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.28);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(bp).connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  /** A tone through a low-pass and a stereo panner (distant horns). */
  toneP(freq, dur, type, vol, endFreq, delay, pan, cutoff) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(lp).connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** The rickshaw-wallah's bell, knocked against the shaft. */
  rickshawBell() {
    [0, 0.16, 0.32].forEach((d) => {
      this.tone(2650, 0.35, 'sine', 0.09, null, d);
      this.tone(5300, 0.15, 'sine', 0.03, null, d);
    });
  }

  /** The player's horn: a car horn, a bus's air horn, a bell on the rickshaw and tram, the train's horn. */
  horn(on, kind = null) {
    if (!this.ctx) return;
    const S = SOUND[KIND_SOUND[kind] || 'car'];
    const rising = on && !this.hornWas;
    this.hornWas = on;
    if (!S.horn) {
      this.hornGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      if (rising) {
        if (kind === 'rickshaw') this.rickshawBell();
        else if (kind === 'tram') this.tramBell(4);
        else if (kind === 'metro') this.metroChime(4);
        else this.trainHorn(4);
      }
      return;
    }
    if (rising) {
      this.hornOscs.forEach((o, i) => {
        o.type = S.hornType;
        o.frequency.value = S.horn[i % S.horn.length];
      });
    }
    this.hornGain.gain.setTargetAtTime(on ? (S.hornType === 'sawtooth' ? 0.07 : 0.09) : 0, this.ctx.currentTime, 0.02);
  }

  impact(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600 + strength * 60;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.9, 0.15 + strength * 0.04), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.5);
    this.tone(70, 0.3, 'sine', Math.min(0.5, strength * 0.03), 30);
  }

  tone(freq, dur, type = 'sine', vol = 0.2, endFreq = null, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  honk(dist = 10, kind = 'car', pan = 0) {
    if (!this.ctx) return;
    this.hornAt(kind, dist, pan);
  }
  pickup() {
    [880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, null, i * 0.05));
  }
  beep(high = false) {
    this.tone(high ? 1320 : 660, 0.25, 'square', 0.08);
  }
  fanfare() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'square', 0.07, null, i * 0.12));
  }
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.8);
  }

  /** Physical paper rustling sound for vintage newspaper unfolding/folding. */
  paperRustle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, { type: 'bandpass', freq: 1100, endFreq: 420, q: 1.4, vol: 0.18, dur: 0.22 });
    this.burst(t + 0.07, { type: 'highpass', freq: 2200, endFreq: 1100, q: 0.9, vol: 0.12, dur: 0.16 });
  }

  /** Filtered noise burst routed to the master bus. */
  burst(t, { type = 'lowpass', freq = 1000, endFreq = null, q = 0.8, vol = 0.3, dur = 0.3 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** Gunshot: a sharp crack, a body thump and a couple of quieter street echoes. */
  gunshot(kind, dist = 0) {
    if (!this.ctx) return;
    const S = {
      pistol: { crack: 2600, body: 900, vol: 0.5, dur: 0.16, thump: 120, echo: 0.35 },
      smg: { crack: 3200, body: 1100, vol: 0.38, dur: 0.1, thump: 140, echo: 0.2 },
      shotgun: { crack: 1500, body: 600, vol: 0.75, dur: 0.38, thump: 70, echo: 0.5 },
      rifle: { crack: 3000, body: 1000, vol: 0.55, dur: 0.15, thump: 100, echo: 0.4 },
      sniper: { crack: 3600, body: 700, vol: 0.85, dur: 0.32, thump: 60, echo: 0.8 },
    }[kind] || { crack: 2600, body: 900, vol: 0.5, dur: 0.16, thump: 120, echo: 0.3 };
    const att = 1 / (1 + dist * 0.05);
    const t = this.ctx.currentTime;
    const v = S.vol * att;
    this.burst(t, { type: 'highpass', freq: S.crack, q: 0.7, vol: v * 0.9, dur: 0.05 + S.dur * 0.25 });
    this.burst(t, { type: 'lowpass', freq: S.body * (dist > 40 ? 0.5 : 1), endFreq: 120, vol: v, dur: S.dur });
    this.tone(S.thump, S.dur * 1.2, 'sine', v * 0.8, 35);
    for (let i = 1; i <= 2; i++) this.burst(t + 0.09 * i + Math.random() * 0.05, { type: 'bandpass', freq: 700, q: 0.6, vol: v * S.echo * (0.45 / i), dur: S.dur * 2 });
  }
  dryFire() {
    this.tone(1800, 0.03, 'square', 0.05);
  }
  reload() {
    if (!this.ctx) return;
    [0, 0.35, 0.7].forEach((d, i) => {
      this.tone(i === 1 ? 900 : 1400, 0.04, 'square', 0.05, null, d);
      this.burst(this.ctx.currentTime + d, { type: 'highpass', freq: 3000, vol: 0.08, dur: 0.05 });
    });
  }
  swing() {
    if (!this.ctx) return;
    this.burst(this.ctx.currentTime, { type: 'bandpass', freq: 600, endFreq: 1800, q: 1.5, vol: 0.12, dur: 0.18 });
  }
  hitFlesh(strong = false) {
    if (!this.ctx) return;
    this.burst(this.ctx.currentTime, { type: 'lowpass', freq: strong ? 700 : 1100, vol: strong ? 0.5 : 0.3, dur: 0.12 });
    this.tone(strong ? 90 : 140, 0.12, 'sine', 0.3, 50);
  }
  ricochet(dist = 0) {
    if (!this.ctx || Math.random() > 0.35) return;
    const v = 0.06 / (1 + dist * 0.05);
    this.tone(2400 + Math.random() * 1500, 0.22, 'sine', v, 700);
  }
  metalHit(dist = 0) {
    if (!this.ctx) return;
    const v = 0.18 / (1 + dist * 0.05);
    this.tone(1300 + Math.random() * 600, 0.15, 'triangle', v, 600);
    this.burst(this.ctx.currentTime, { type: 'highpass', freq: 2500, vol: v, dur: 0.06 });
  }
  explosion(dist = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, 1.6 / (1 + dist * 0.03));
    this.burst(t, { type: 'lowpass', freq: 1400, endFreq: 80, vol: v, dur: 1.8 });
    this.burst(t, { type: 'highpass', freq: 1500, vol: v * 0.4, dur: 0.12 });
    this.tone(55, 1.2, 'sine', v * 0.9, 25);
    this.burst(t + 0.25, { type: 'bandpass', freq: 400, q: 0.5, vol: v * 0.3, dur: 1.4 });
  }
  trainHorn(dist = 0) {
    if (!this.ctx) return;
    const v = Math.min(0.12, 2.5 / Math.max(dist, 8));
    for (const f of [277, 349, 415]) this.tone(f, 1.3, 'sawtooth', v * 0.5);
  }
  tramBell(dist = 0) {
    if (!this.ctx) return;
    const v = Math.min(0.12, 2 / Math.max(dist, 6));
    [0, 0.28].forEach((d) => {
      this.tone(1568, 0.6, 'sine', v, null, d);
      this.tone(3136, 0.3, 'sine', v * 0.4, null, d);
    });
  }
  metroChime(dist = 0) {
    if (!this.ctx) return;
    const v = Math.min(0.1, 2 / Math.max(dist, 6));
    [[988, 0], [784, 0.32], [659, 0.64]].forEach(([f, d]) => this.tone(f, 0.5, 'sine', v, null, d));
  }
  shutter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1900, 0.02, 'square', 0.12, null, 0);
    this.burst(t, { type: 'highpass', freq: 4200, vol: 0.22, dur: 0.04 });
    this.burst(t + 0.07, { type: 'bandpass', freq: 1100, vol: 0.25, dur: 0.05 });
    this.burst(t + 0.12, { type: 'highpass', freq: 3600, vol: 0.16, dur: 0.03 });
  }
  hurt() {
    this.tone(220, 0.18, 'sawtooth', 0.06, 110);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }
  /** Background music on or off (remembered between visits). */
  setRadio(on) {
    this.radioOn = on;
    saveFlag('kol_music', on);
    if (this.ctx) this.musicGain.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.3);
    return on;
  }
  toggleRadio() {
    return this.setRadio(!this.radioOn);
  }
  setStation(idx) {
    this.stationIndex = ((idx % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    try { localStorage.setItem('kol_station_idx', String(this.stationIndex)); } catch {}
    const st = RADIO_STATIONS[this.stationIndex];
    if (this.ctx) {
      this.stepDur = 60 / st.bpm / 4;
      if (this.delay) this.delay.delayTime.setTargetAtTime((60 / st.bpm) * 0.75, this.ctx.currentTime, 0.1);
    }
    return st;
  }
  nextStation() {
    if (!this.radioOn) this.setRadio(true);
    return this.setStation(this.stationIndex + 1);
  }
  prevStation() {
    if (!this.radioOn) this.setRadio(true);
    return this.setStation(this.stationIndex - 1);
  }
  get currentStation() {
    return RADIO_STATIONS[this.stationIndex] || RADIO_STATIONS[0];
  }

  /* ---------- Multi-Station Procedural Radio ---------- */
  initRadio() {
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.radioOn ? 0.22 : 0;
    this.musicGain.connect(this.master);
    const cur = this.currentStation;
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / cur.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2500;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.musicGain);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.2;
    this.stepDur = 60 / cur.bpm / 4;
    // Synthwave progression: Am - F - C - G
    this.prog = [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [48, 52, 55, 60],
      [55, 59, 62, 67],
    ];
    // AIR Kolkata Indian classical Raga scale: C, Db, E, F, G, Ab, Bb (Ahir Bhairav flavor)
    this.raga = [60, 61, 64, 65, 67, 68, 70, 72, 73, 76];
    // Park Street Disco: Dm7 - Gm7 - C7 - A7
    this.discoChords = [
      [50, 53, 57, 60], // Dm7
      [43, 46, 50, 53], // Gm7
      [48, 52, 55, 58], // C7
      [45, 49, 52, 55], // A7
    ];
    setInterval(() => this.schedule(), 25);
  }

  schedule() {
    const ctx = this.ctx;
    if (!this.radioOn) {
      this.nextTime = Math.max(this.nextTime, ctx.currentTime + 0.05);
      return;
    }
    while (this.nextTime < ctx.currentTime + 0.12) {
      const st = this.currentStation;
      if (st.id === 'air') this.playAirStep(this.step, this.nextTime);
      else if (st.id === 'disco') this.playDiscoStep(this.step, this.nextTime);
      else this.playSynthStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  note(midi, t, dur, type, vol, cutoff, toDelay = false, bendToMidi = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const baseFreq = 440 * Math.pow(2, (midi - 69) / 12);
    o.frequency.setValueAtTime(baseFreq, t);
    if (bendToMidi != null) {
      const targetFreq = 440 * Math.pow(2, (bendToMidi - 69) / 12);
      o.frequency.exponentialRampToValueAtTime(targetFreq, t + dur * 0.7);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.3), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(this.musicGain);
    if (toDelay) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  drum(t, kind) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.4);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 8000 : 1800;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.05 : 0.22;
    g.gain.setValueAtTime(kind === 'hat' ? 0.18 : 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.musicGain);
    if (kind === 'snare') g.connect(this.delay);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /* Station 1: Synthwave 96 */
  playSynthStep(i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    const ch = this.prog[bar];
    const section = Math.floor(i / 128) % 2;
    if (s % 4 === 0) this.drum(t, 'kick');
    if (s === 4 || s === 12) this.drum(t, 'snare');
    if (s % 2 === 1) this.drum(t, 'hat');
    if (s % 2 === 0) this.note(ch[0] - 24, t, this.stepDur * 1.8, 'sawtooth', 0.22, 700);
    const arp = [0, 1, 2, 3, 2, 1, 0, 2];
    const n = ch[arp[s % 8]] + (s >= 8 ? 12 : 0);
    this.note(n, t, this.stepDur * 0.9, section ? 'square' : 'triangle', 0.06, 3200, true);
    if (s === 0) {
      for (const m of ch.slice(0, 3)) this.note(m, t, this.stepDur * 15, 'sawtooth', 0.025, 1400);
    }
  }

  /* Station 2: AIR Kolkata (All India Radio) - Sitar & Morning Raga with AM crackle */
  playAirStep(i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    // Continuous Tanpura Drone: Root Sa (C3 = 48) and Pa (G3 = 55)
    if (s === 0) {
      this.note(48, t, this.stepDur * 15.5, 'sawtooth', 0.04, 520);
      this.note(55, t, this.stepDur * 15.5, 'triangle', 0.045, 600);
      this.note(60, t, this.stepDur * 15.5, 'sine', 0.03, 800);
    }
    // Vintage AM radio crackle burst on bar boundaries
    if (s === 0 && Math.random() < 0.35) {
      this.burst(t, { type: 'bandpass', freq: 1600, q: 2.2, vol: 0.025, dur: 0.15 });
    }
    // Tabla: Bayan (bass) on step 0, 8; Dayan (tuned ring) on step 4, 12
    if (s === 0 || s === 8) {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(86, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.25);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.32);
    }
    if (s === 4 || s === 12) {
      this.note(67, t, this.stepDur * 0.8, 'sine', 0.14, 1800);
      this.burst(t, { type: 'highpass', freq: 4500, q: 1, vol: 0.05, dur: 0.04 });
    }
    if (s % 2 === 1 && Math.random() < 0.4) {
      this.burst(t, { type: 'bandpass', freq: 2800, q: 1.5, vol: 0.03, dur: 0.03 });
    }
    // Sitar / Bansuri melodic phrases with meend (ornamented pitch bends)
    const phrase = [
      [0, 60, null],
      [2, 61, 64],
      [4, 64, null],
      [6, 65, 67],
      [8, 67, null],
      [10, 68, 67],
      [12, 65, 64],
      [14, 61, 60],
    ];
    const match = phrase.find(([step]) => step === s);
    if (match) {
      const [, m, bend] = match;
      const octave = bar >= 2 ? 12 : 0;
      // Sitar twang: sawtooth with high resonance and gentle slide
      this.note(m + octave, t, this.stepDur * 1.6, 'sawtooth', 0.09, 2800, true, bend ? bend + octave : null);
    }
    // Soft Bansuri (Bamboo flute) sustain on second half
    if (s === 6 && (bar === 1 || bar === 3)) {
      this.note(72, t, this.stepDur * 6, 'sine', 0.05, 1200);
    }
  }

  /* Station 3: Park Street 80s Disco - Funky Slap Bass & Bollywood Groove */
  playDiscoStep(i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    const chord = this.discoChords[bar];
    const root = chord[0] - 12; // Bass register
    // 4-on-the-floor Disco Kick
    if (s % 4 === 0) {
      this.drum(t, 'kick');
    }
    // Snappy Disco Snare + Claps on 4 & 12
    if (s === 4 || s === 12) {
      this.drum(t, 'snare');
      this.burst(t, { type: 'bandpass', freq: 2200, q: 1.2, vol: 0.22, dur: 0.12 });
    }
    // 16th-note Hi-Hats: ticks on even steps, open sizzle on upbeat
    if (s % 2 === 1) {
      this.drum(t, 'hat');
    }
    if (s === 2 || s === 6 || s === 10 || s === 14) {
      this.burst(t, { type: 'highpass', freq: 7500, q: 0.8, vol: 0.16, dur: 0.14 });
    }
    // 80s Funky Slap Bass (octave bounces & syncopation)
    const bassRiff = [
      root,             // 0: slap root
      root + 12,        // 1: pop octave
      null,             // 2: rest
      root,             // 3: ghost
      root + 3,         // 4: minor 3rd
      null,             // 5: rest
      root + 5,         // 6: 4th
      root + 7,         // 7: 5th
      root + 12,        // 8: pop octave
      null,             // 9: rest
      root + 10,        // 10: 7th
      root + 12,        // 11: pop octave
      root,             // 12: slap root
      null,             // 13: rest
      root + 5,         // 14: pass
      root + 6,         // 15: chromatic slide
    ];
    const bNote = bassRiff[s];
    if (bNote != null) {
      const isPop = s === 1 || s === 8 || s === 11;
      this.note(bNote, t, this.stepDur * (isPop ? 0.6 : 1.2), 'sawtooth', isPop ? 0.26 : 0.22, isPop ? 1800 : 750);
    }
    // Disco Brass / Synth Stabs on syncopated 16ths (steps 3, 6, 9, 14)
    if (s === 3 || s === 6 || s === 9 || s === 14) {
      for (const m of chord.slice(1, 4)) {
        this.note(m + 12, t, this.stepDur * 0.75, 'sawtooth', 0.045, 2200, true);
      }
    }
  }

  /* ---------- Durga Puja Dhak Drum Rhythm ---------- */
  initDhak() {
    this.dhakStep = 0;
    this.dhakCycle = 0;
    this.dhakNextT = 0;
    this.dhakVol = 0;
  }

  dhakStroke(t, stroke, vol) {
    if (!this.ctx || vol <= 0.001) return;
    const now = this.ctx.currentTime;
    const delay = Math.max(0, t - now);
    const v = Math.min(0.65, vol);

    if (stroke === 'dha') {
      // Primary open hit: resonant skin drop with cane stick crack
      this.tone(152, 0.28, 'triangle', v * 0.85, 84, delay);
      this.tone(76, 0.32, 'sine', v * 0.5, 48, delay);
      this.burst(t, { type: 'bandpass', freq: 2200, q: 2.0, vol: v * 0.45, dur: 0.04 });
    } else if (stroke === 'kur') {
      // Snappy cane-stick rim click
      this.tone(480, 0.035, 'sine', v * 0.25, 360, delay);
      this.burst(t, { type: 'highpass', freq: 3400, q: 1.8, vol: v * 0.38, dur: 0.035 });
    } else if (stroke === 'ta') {
      // Crisp damped slap on secondary skin
      this.tone(250, 0.08, 'triangle', v * 0.65, 135, delay);
      this.burst(t, { type: 'bandpass', freq: 1850, q: 1.4, vol: v * 0.5, dur: 0.05 });
    } else if (stroke === 'kashor') {
      // High brass bell / gong accompaniment (কাঁসর ঘণ্টা)
      this.tone(2840, 0.45, 'sine', v * 0.16, null, delay);
      this.tone(4260, 0.35, 'sine', v * 0.1, null, delay);
    }
  }

  updateDhak(dt, dist, enabled) {
    if (!this.ctx) return;
    if (!enabled || this.muted || !this.radioOn) {
      this.dhakVol = 0;
      return;
    }

    // Louder near Howrah Bridge / Park Street, quieter elsewhere
    const targetVol = dist < 180 ? 0.42 : dist < 850 ? lerp(0.42, 0.08, (dist - 180) / 670) : 0.05;
    this.dhakVol = damp(this.dhakVol || 0, targetVol, 4, dt);
    if (this.dhakVol < 0.005) return;

    const t = this.ctx.currentTime;
    if (!this.dhakNextT || this.dhakNextT < t) this.dhakNextT = t + 0.05;

    const stepDur = 60 / 134 / 4; // ~134 BPM 16th note (~0.112s)
    while (this.dhakNextT < t + 0.18) {
      const s = this.dhakStep;
      const bar = this.dhakCycle % 4;
      const flourish = bar === 3;
      const hitT = this.dhakNextT + (Math.random() - 0.5) * 0.008; // subtle micro-jitter for organic hand feel
      const hitV = this.dhakVol * (0.88 + Math.random() * 0.24);

      if (!flourish) {
        // Classic "Dha - kur-kur - ta - Dha" Durga Puja rhythm
        if (s === 0) {
          this.dhakStroke(hitT, 'dha', hitV * 1.1);
          this.dhakStroke(hitT, 'kashor', hitV);
        } else if (s === 2) {
          this.dhakStroke(hitT, 'ta', hitV * 0.6);
        } else if (s === 4 || s === 5) {
          this.dhakStroke(hitT, 'kur', hitV * 0.7);
        } else if (s === 6) {
          this.dhakStroke(hitT, 'ta', hitV * 0.9);
        } else if (s === 8) {
          this.dhakStroke(hitT, 'dha', hitV * 1.05);
          this.dhakStroke(hitT, 'kashor', hitV);
        } else if (s === 10) {
          this.dhakStroke(hitT, 'ta', hitV * 0.6);
        } else if (s === 12 || s === 13) {
          this.dhakStroke(hitT, 'kur', hitV * 0.7);
        } else if (s === 14) {
          this.dhakStroke(hitT, 'ta', hitV * 0.95);
        }
      } else {
        // 4th bar festive roll flourish (kuru-kuru-kuru-kuru dha-dha!)
        if (s === 0) {
          this.dhakStroke(hitT, 'dha', hitV * 1.15);
          this.dhakStroke(hitT, 'kashor', hitV * 1.2);
        } else if (s === 2) {
          this.dhakStroke(hitT, 'ta', hitV * 0.75);
        } else if (s >= 4 && s <= 7) {
          this.dhakStroke(hitT, 'kur', hitV * (0.7 + (s - 4) * 0.1));
        } else if (s === 8) {
          this.dhakStroke(hitT, 'dha', hitV * 1.1);
          this.dhakStroke(hitT, 'kashor', hitV);
        } else if (s === 10 || s === 11) {
          this.dhakStroke(hitT, 'kur', hitV * 0.85);
        } else if (s === 12 || s === 14) {
          this.dhakStroke(hitT, 'dha', hitV * 1.1);
          if (s === 14) this.dhakStroke(hitT, 'kashor', hitV * 1.2);
        }
      }

      this.dhakStep = (this.dhakStep + 1) % 16;
      if (this.dhakStep === 0) this.dhakCycle++;
      this.dhakNextT += stepDur;
    }
  }
}
