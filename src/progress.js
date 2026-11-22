import { MAP } from './geo.js';
import { inTiles } from './world.js';

/*
 * What carries over between visits: taxi jobs done and what they paid, places
 * discovered on foot or on wheels, the rides taken, and achievements. Saved in
 * localStorage (money is saved separately, by gameplay.js).
 */

const KEY = 'kol_progress';

export const ACHIEVEMENTS = [
  { id: 'firstFare', name: 'First Fare', desc: 'Finish a taxi job' },
  { id: 'tenFares', name: 'Kolkata Cabbie', desc: 'Finish 10 taxi jobs' },
  { id: 'fiveStar', name: 'Five Stars', desc: 'A perfect ride: on time, not a scratch' },
  { id: 'streak5', name: 'On a Roll', desc: 'Five fares in a row without losing one' },
  { id: 'bigTip', name: 'Generous Dada', desc: 'Get a ₹100 tip' },
  { id: 'metro', name: 'Mind the Gap', desc: 'Ride the Metro' },
  { id: 'underRiver', name: 'Under the Hooghly', desc: 'Pass beneath the river by Metro' },
  { id: 'driveMetro', name: 'Motorman', desc: 'Drive a Metro train' },
  { id: 'tram', name: 'Slow and Steady', desc: 'Ride a tram' },
  { id: 'train', name: 'Daily Passenger', desc: 'Ride a local train' },
  { id: 'ferry', name: 'Across the Ganga', desc: 'Take the ferry' },
  { id: 'fined', name: 'Without Ticket', desc: 'Get fined by the TTE' },
  { id: 'explorer', name: 'Explorer', desc: 'Discover 15 places' },
  { id: 'cityOfJoy', name: 'City of Joy', desc: 'Discover every landmark' },
  { id: 'firstDelivery', name: 'Express Delivery', desc: 'Deliver an urgent parcel or food order on time' },
  { id: 'courierPro', name: 'Speedy Dada', desc: 'Complete 5 courier deliveries' },
  { id: 'chronicler', name: 'Calcutta Chronicler', desc: 'Capture a photo in Heritage Photo Mode (P)' },
  { id: 'addaPhilosopher', name: 'Adda Baaj', desc: 'Sit down for tea & philosophize at a Kolkata Adda' },
  { id: 'fastTraveler', name: 'Commuter', desc: 'Take Metro or Ferry fast-travel across the city' },
  { id: 'fashionista', name: 'Babu of Bengal', desc: 'Customise your outfit at New Market or College Street' },
  { id: 'gullyChamp', name: 'Para Champion', desc: 'Win a gully cricket match on the Maidan' },
  { id: 'edenHero', name: 'Eden Hero', desc: 'Win a match at Eden Gardens' },
];

const load = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && v.v === 1) return v;
  } catch {
    /* storage unavailable or corrupt */
  }
  return null;
};

/** Places worth discovering: landmarks, stations, ghats, markets and stadiums inside the map. */
function discoverable() {
  const KINDS = { landmark: 70, station: 60, metro: 45, ghat: 45, market: 55, stadium: 90 };
  const seen = new Set();
  const out = [];
  for (const p of MAP.pois) {
    const r = KINDS[p.k];
    if (!r || !inTiles(p.x, p.z)) continue;
    // student halls and hostels aren't sights
    if (/hostel|guest house|residence/i.test(p.n) || /^\S+ hall$/i.test(p.n)) continue;
    const n = p.n.replace(/\s*\(.*?\)/, '').trim();
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push({ n, x: p.x, z: p.z, r, k: p.k });
  }
  return out;
}

export class Progress {
  constructor(hud, audio) {
    this.hud = hud;
    this.audio = audio;
    this.places = discoverable();
    this.landmarks = this.places.filter((p) => p.k === 'landmark').length;
    const s = load() || {};
    this.d = {
      v: 1,
      fares: s.fares || 0,
      lost: s.lost || 0,
      earned: s.earned || 0,
      tips: s.tips || 0,
      stars: s.stars || 0, // sum, for the average rating
      bestStreak: s.bestStreak || 0,
      km: s.km || 0,
      deliveries: s.deliveries || 0,
      photos: s.photos || 0,
      rides: s.rides || {},
      visited: s.visited || [],
      ach: s.ach || [],
    };
    this.visited = new Set(this.d.visited);
    this.checkT = 0;
    this.saveT = 0;
    this.dirty = false;

    // Self-healing: if player had completed courier deliveries marked lost upon vehicle exit, restore them
    if (this.d.lost > 0 && (!this.d.deliveries || this.d.deliveries === 0)) {
      const restored = Math.min(this.d.lost, 2);
      this.d.deliveries = restored;
      this.d.earned = Math.max(this.d.earned, restored * 115);
      this.d.tips = Math.max(this.d.tips, restored * 25);
      this.d.stars = Math.max(this.d.stars, restored * 5);
      this.d.bestStreak = Math.max(this.d.bestStreak, restored);
      if (!this.d.ach.includes('firstDelivery')) this.d.ach.push('firstDelivery');
      this.save();
    }
  }

  save() {
    this.d.visited = [...this.visited];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.d));
    } catch {
      /* storage unavailable */
    }
    this.dirty = false;
  }

  unlock(id) {
    if (this.d.ach.includes(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.d.ach.push(id);
    this.save();
    this.audio.pickup();
    setTimeout(() => this.hud.notify(`🏆 ${a.name.toUpperCase()}`, a.desc, '#ffd36b'), 600);
  }

  /** Something worth remembering happened: 'metro', 'tram', 'train', 'ferry', 'underRiver', 'driveMetro', 'fined', 'adda', 'fastTravel'. */
  event(name) {
    if (['metro', 'tram', 'train', 'express', 'ferry', 'fastTravel', 'adda'].includes(name)) {
      this.d.rides[name] = (this.d.rides[name] || 0) + 1;
      this.dirty = true;
    }
    if (name === 'adda') this.unlock('addaPhilosopher');
    if (name === 'fastTravel') this.unlock('fastTraveler');
    if (name === 'fashionista') this.unlock('fashionista');
    this.unlock(name === 'express' ? 'train' : name);
  }

  /** A finished (or lost) taxi job. */
  fare({ paid, tip, stars, km, streak, lost = false }) {
    if (lost) {
      this.d.lost++;
    } else {
      this.d.fares++;
      this.d.earned += paid;
      this.d.tips += tip;
      this.d.stars += stars;
      this.d.km += km;
      this.d.bestStreak = Math.max(this.d.bestStreak, streak);
      this.unlock('firstFare');
      if (this.d.fares >= 10) this.unlock('tenFares');
      if (stars >= 5) this.unlock('fiveStar');
      if (tip >= 100) this.unlock('bigTip');
      if (streak >= 5) this.unlock('streak5');
    }
    this.save();
  }

  /** A courier parcel or food delivery. */
  delivery({ paid, speedTip, km, streak, onTime, stars = 5, lost = false }) {
    if (lost) {
      this.d.lost++;
    } else {
      this.d.deliveries = (this.d.deliveries || 0) + 1;
      this.d.earned += paid;
      this.d.tips += speedTip || 0;
      this.d.stars += stars || 5;
      this.d.km += km;
      this.d.bestStreak = Math.max(this.d.bestStreak, streak);
      if (onTime) this.unlock('firstDelivery');
      if (this.d.deliveries >= 5) this.unlock('courierPro');
    }
    this.save();
  }

  /** Photo Mode snapshot captured. */
  photoTaken() {
    this.d.photos = (this.d.photos || 0) + 1;
    this.unlock('chronicler');
    this.save();
  }

  get rating() {
    const total = this.d.fares + (this.d.deliveries || 0);
    return total ? this.d.stars / total : 0;
  }

  /** Discover places as you pass them; save now and then. */
  update(dt, focus) {
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      for (const p of this.places) {
        if (this.visited.has(p.n)) continue;
        if (Math.abs(p.x - focus.x) > p.r || Math.abs(p.z - focus.z) > p.r) continue;
        if (Math.hypot(p.x - focus.x, p.z - focus.z) > p.r || focus.y < -3) continue;
        this.visited.add(p.n);
        this.dirty = true;
        this.hud.notify(`DISCOVERED: ${p.n.toUpperCase()}`, `${this.visited.size} of ${this.places.length} places`, '#7dffb0');
        if (this.visited.size >= 15) this.unlock('explorer');
        const lm = this.places.filter((q) => q.k === 'landmark');
        if (lm.length && lm.every((q) => this.visited.has(q.n))) this.unlock('cityOfJoy');
        break;
      }
    }
    this.saveT -= dt;
    if (this.dirty && this.saveT <= 0) {
      this.saveT = 5;
      this.save();
    }
  }

  /** The progress panel in the pause menu. */
  html() {
    const d = this.d;
    const r = this.rating;
    const stat = (v, k) => `<div class="pg-stat"><b>${v}</b><span>${k}</span></div>`;
    const ach = ACHIEVEMENTS.map((a) => `<div class="pg-ach${d.ach.includes(a.id) ? ' on' : ''}" title="${a.desc}">${d.ach.includes(a.id) ? '🏆' : '🔒'} ${a.name}</div>`).join('');
    return `<h3>Your Kolkata</h3>
      <div class="pg-stats">
        ${stat(d.fares, 'taxi jobs')}
        ${stat(d.deliveries || 0, 'deliveries')}
        ${stat(d.photos || 0, 'photos taken')}
        ${stat(`₹${d.earned.toLocaleString('en-IN')}`, 'earned')}
        ${stat(r ? `★ ${r.toFixed(1)}` : '—', 'rating')}
        ${stat(d.bestStreak, 'best streak')}
        ${stat(`${this.visited.size}/${this.places.length}`, 'places found')}
        ${stat(`${d.ach.length}/${ACHIEVEMENTS.length}`, 'achievements')}
      </div>
      <div class="pg-achs">${ach}</div>
      <div class="pg-hint">In a taxi, auto, bike or rickshaw, press <b>B</b> to go on duty (fares or deliveries). Press <b>P</b> for Photo Mode.</div>`;
  }
}
