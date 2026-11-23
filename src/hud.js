import { BOUNDS } from './world.js';
import { MAP } from './geo.js';
import * as THREE from 'three';
import { clamp, etaText } from './utils.js';
import { EMOTE_LIST, EMOTE_LABELS } from './character.js';
import { SLOTS, WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
// Overview image of the whole map; close up, the map is drawn from vectors
const MAP_PPM = 0.5; // pixels per metre
const MAP_PAD = 500;
const MAP_X0 = BOUNDS.x0 - MAP_PAD;
const MAP_Z0 = BOUNDS.z0 - MAP_PAD;
const MAP_W = BOUNDS.x1 - BOUNDS.x0 + MAP_PAD * 2;
const MAP_H = BOUNDS.z1 - BOUNDS.z0 + MAP_PAD * 2;
const COL = { ground: '#24271f', outside: '#1b1d19', building: '#4a4b4f', buildingEdge: '#56575c', water: '#1d4f6e', green: '#2f5a2a', road: '#8d939c', major: '#d9a54e', foot: '#5d6066', rail: '#b8bcc2', deck: '#c9b48a' };

export class HUD {
  constructor(world) {
    this.el = {
      hud: $('hud'),
      money: $('money'),
      clock: $('clock'),
      mission: $('mission'),
      notify: $('notify'),
      drift: $('drift'),
      countdown: $('countdown'),
      hint: $('hint'),
      title: $('title'),
      loading: $('loading'),
      play: $('play'),
      pause: $('pause'),
      photo: $('photo-mode'),
      fade: $('screen-fade'),
      moneyPopups: $('money-popups'),
    };
    this.whereEl = $('where-to');
    this.mm = $('minimap').getContext('2d');
    this.sp = $('speedo').getContext('2d');
    this.shownMoney = 0;
    this.targetMoney = 0;
    this.world = world;
    this.transit = { lines: [], stations: [] };
    this.map = this.buildMap(world);
    this.mapRect = { x0: MAP_X0, z0: MAP_Z0, w: MAP_W, h: MAP_H };
    this.route = null;
    this.waypointEl = $('wpdist');
    this.driftEls = { score: this.el.drift.querySelector('.score'), mult: this.el.drift.querySelector('.mult') };
    this.bubbleRoot = $('bubbles');
    this.bubbles = [];
    this.promptEl = $('prompt');
    this.speedoEl = $('speedo');
    this.v3 = new THREE.Vector3();
    this.buildWheel();
    this.cw = {
      weapon: $('weapon'),
      wname: $('weapon').querySelector('.wname'),
      wammo: $('weapon').querySelector('.wammo'),
      health: $('health'),
      hfill: $('health').querySelector('.fill'),
      cross: $('crosshair'),
      hit: $('hitmark'),
      scope: $('scope'),
      dmg: $('dmg'),
      dmgdir: $('dmgdir'),
    };
    this.dmgFlash = 0;
  }

  /** Rail lines, the metro and their stations drawn onto the map. */
  drawTransit(lines, stations) {
    this.transit = { lines, stations };
    const g = this.map.getContext('2d');
    g.save();
    g.scale(MAP_PPM, MAP_PPM);
    g.translate(-MAP_X0, -MAP_Z0);
    this.drawTransitLayer(g, 1 / MAP_PPM);
    g.restore();
  }
  /** Transit in world units; px = metres per screen pixel (keeps line widths constant). */
  drawTransitLayer(g, px, names = false) {
    const { lines, stations } = this.transit;
    for (const { pts, color, width, dash } of lines) {
      g.save();
      g.strokeStyle = color;
      g.lineWidth = width * px;
      g.setLineDash((dash || []).map((d) => d * px));
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.stroke();
      g.restore();
    }
    for (const { x, z, color, label, name, small } of stations) {
      if (small && px > 2.5) continue;
      g.beginPath();
      g.arc(x, z, (small ? 4.5 : 6) * px, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 2 * px;
      g.strokeStyle = '#fff';
      g.stroke();
      if (label) {
        g.fillStyle = '#fff';
        g.font = `bold ${9 * px}px Rajdhani`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, x, z + 0.5 * px);
      }
      if (names && name && px < (small ? 1.1 : 1.8)) {
        g.font = `bold ${11 * px}px Rajdhani`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.lineWidth = 3 * px;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText(name, x, z + 8 * px);
        g.fillStyle = color;
        g.fillText(name, x, z + 8 * px);
      }
    }
  }
  /** Distance to the waypoint; riding, with the time it'll take and what it is ("LAST STOP"). */
  waypoint(dist, eta = null, label = '') {
    let t = dist == null ? '' : dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    if (t && eta != null) t = `${label ? `${label} · ` : ''}${t} · ${etaText(eta)}`;
    if (t !== this._wp) {
      this.waypointEl.textContent = this._wp = t;
      this.waypointEl.classList.toggle('hidden', !t);
    }
  }

  /* ---------- Weapon wheel ---------- */
  setWeaponIcons(icons) {
    this.icons = icons;
    const w = $('wwheel');
    this.wwEl = w;
    this.wwName = w.querySelector('.wwname');
    this.wwAmmo = w.querySelector('.wwammo');
    this.wwItems = SLOTS.map((id, i) => {
      const a = (i / SLOTS.length) * Math.PI * 2 - Math.PI / 2;
      const el = document.createElement('div');
      el.className = 'wwitem';
      el.innerHTML = `<span class="wwk">${i + 1}</span><img src="${icons[id] || ''}" alt="" /><span class="wwa"></span>`;
      el.style.left = `${50 + Math.cos(a) * 37}%`;
      el.style.top = `${50 + Math.sin(a) * 37}%`;
      w.appendChild(el);
      return { id, a, el, ammo: el.querySelector('.wwa') };
    });
  }
  /** Radial weapon picker. Returns the highlighted weapon id. */
  weaponWheel(open, vec, arsenal) {
    if (!this.wwEl) return null;
    this.wwEl.classList.toggle('hidden', !open);
    if (!open) return this._wwSel || null;
    let sel = this._wwOpen ? this._wwSel : arsenal.cur;
    this._wwOpen = true;
    if (Math.hypot(vec.x, vec.y) > 30) {
      const a = Math.atan2(vec.y, vec.x);
      let best = 9;
      for (const it of this.wwItems) {
        const d = Math.abs(Math.atan2(Math.sin(a - it.a), Math.cos(a - it.a)));
        if (d < best) {
          best = d;
          sel = it.id;
        }
      }
    }
    this._wwSel = sel;
    for (const it of this.wwItems) {
      it.el.classList.toggle('sel', it.id === sel);
      it.el.classList.toggle('cur', it.id === arsenal.cur);
      const c = arsenal.ammo[it.id];
      it.ammo.textContent = c ? `${c.mag} / ${c.reserve}` : '∞';
      it.el.classList.toggle('empty', !!c && c.mag + c.reserve === 0);
    }
    const w = WEAPONS[sel];
    this.wwName.textContent = w.name.toUpperCase();
    const c = arsenal.ammo[sel];
    this.wwAmmo.textContent = c ? `${c.mag + c.reserve} rounds` : w.kind === 'melee' ? 'Melee' : '';
    return sel;
  }
  closeWeaponWheel() {
    this._wwOpen = false;
    this._wwSel = null;
    if (this.wwEl) this.wwEl.classList.add('hidden');
  }

  /* ---------- Combat ---------- */
  /** Weapon name + ammo readout, crosshair and scope. state from Player each frame. */
  combat({ name, mag, reserve, gun, reloading, cross, dot, target, aiming, scoped, spread, hp, dead }) {
    const c = this.cw;
    if (name !== this._wname) {
      c.wname.textContent = this._wname = name;
      const id = SLOTS.find((k) => WEAPONS[k].name.toUpperCase() === name);
      if (this.icons && id) c.weapon.querySelector('.wicon').src = this.icons[id];
      c.weapon.classList.remove('flash');
      void c.weapon.offsetWidth;
      c.weapon.classList.add('flash');
    }
    const ammo = gun ? (reloading ? 'RELOADING' : `${mag}<span> / ${reserve}</span>`) : '';
    if (ammo !== this._ammo) {
      c.wammo.innerHTML = this._ammo = ammo;
      c.wammo.classList.toggle('low', gun && !reloading && mag <= 2);
    }
    if (cross !== this._cross) c.cross.classList.toggle('hidden', !(this._cross = cross));
    if (dot !== this._dot) c.cross.classList.toggle('dot', (this._dot = dot));
    if (target !== this._target) c.cross.classList.toggle('target', (this._target = target));
    if (cross) {
      const gap = Math.round(aiming ? 3 + spread * 300 : 7 + spread * 500);
      if (gap !== this._gap) c.cross.style.setProperty('--gap', `${(this._gap = gap)}px`);
    }
    if (scoped !== this._scoped) c.scope.classList.toggle('hidden', !(this._scoped = scoped));
    const hpw = Math.max(0, Math.round(hp));
    if (hpw !== this._hp) {
      c.hfill.style.width = `${(this._hp = hpw)}%`;
      c.health.classList.toggle('low', hpw < 30);
    }
    if (dead !== this._dead) this.el.hud.classList.toggle('dead', (this._dead = dead));
  }
  hitmark(kill) {
    const h = this.cw.hit;
    h.classList.remove('on', 'kill');
    void h.offsetWidth;
    h.classList.add('on');
    if (kill) h.classList.add('kill');
  }
  /** Red edge flash plus an arc pointing at where the damage came from (angle relative to the camera). */
  damage(angle, amount) {
    this.dmgFlash = Math.min(1, this.dmgFlash + amount / 30);
    if (!Number.isFinite(angle) || amount < 2) return;
    const a = document.createElement('div');
    a.className = 'dmgarc';
    a.style.transform = `rotate(${-angle}rad)`;
    this.cw.dmgdir.appendChild(a);
    while (this.cw.dmgdir.children.length > 4) this.cw.dmgdir.firstChild.remove();
    setTimeout(() => a.remove(), 1100);
  }

  /* ---------- Speech bubbles ---------- */
  say(ch, text, dur = 2.6) {
    const old = this.bubbles.find((b) => b.ch === ch);
    if (old) {
      old.el.remove();
      this.bubbles.splice(this.bubbles.indexOf(old), 1);
    }
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    this.bubbleRoot.appendChild(el);
    this.bubbles.push({ ch, el, until: performance.now() + dur * 1000 });
    // ...and say it out loud, from where they stand
    if (this.voice && ch.mesh) {
      const p = ch.mesh.position;
      const cam = this.camera;
      let dist = 4;
      let pan = 0;
      if (cam) {
        const c = cam.position;
        dist = Math.max(0, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) - 4);
        // left/right of the camera
        const e = cam.matrixWorld.elements;
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const l = Math.hypot(dx, dz) || 1;
        pan = (dx * e[0] + dz * e[2]) / l;
      }
      this.voice.speak(text, { female: !!(ch.look && ch.look.female), dist, pan, priority: dist < 8, seed: ch.mesh.id });
    }
  }
  updateBubbles(camera) {
    const now = performance.now();
    const w = innerWidth;
    const h = innerHeight;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (now > b.until) {
        b.el.remove();
        this.bubbles.splice(i, 1);
        continue;
      }
      const p = b.ch.bones.head.getWorldPosition(this.v3);
      p.y += 0.45;
      const dist = p.distanceTo(camera.position);
      p.project(camera);
      const vis = p.z < 1 && dist < 45 && b.ch.mesh.visible;
      b.el.style.display = vis ? 'block' : 'none';
      if (vis) {
        const sc = clamp(14 / dist, 0.55, 1.1);
        b.el.style.transform = `translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%, -100%) scale(${sc})`;
      }
    }
  }

  /* ---------- Context prompt ---------- */
  prompt(p) {
    const kClass = (k, extra) => `key ${extra || ''} ${k === 'B' ? 'kb' : ''}`.trim();
    const html = p
      ? `<span class="${kClass(p.key, '')}">${p.key}</span>${p.text}${p.key2 ? `<span class="${kClass(p.key2, 'k2')}">${p.key2}</span>${p.text2}` : ''}${p.key3 ? `<span class="${kClass(p.key3, 'k3')}">${p.key3}</span>${p.text3}` : ''}`
      : '';
    if (html !== this._prompt) {
      this.promptEl.innerHTML = html;
      this.promptEl.classList.toggle('hidden', !p);
      this._prompt = html;
    }
  }

  whereTo({ title, titleColor = '', subtitle = '', balance, groups = [], confirmation = '', pageLabel = '', onPageChange, onChoose, onConfirm, onCancel }) {
    const root = this.whereEl;
    root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'wt-head';
    const h = document.createElement('h2');
    h.id = 'where-title';
    h.textContent = title;
    h.style.color = titleColor;
    head.append(h);
    if (Number.isFinite(balance)) {
      const amount = document.createElement('span');
      amount.className = 'wt-balance';
      amount.textContent = `Balance · ₹${Math.floor(balance)}`;
      head.append(amount);
    }
    root.append(head);
    if (subtitle) {
      const sub = document.createElement('p');
      sub.className = 'wt-subtitle';
      sub.textContent = subtitle;
      root.append(sub);
    }
    if (confirmation) {
      const summary = document.createElement('div');
      summary.className = 'wt-confirm';
      summary.textContent = confirmation;
      root.append(summary);
    }
    if (groups.length) {
      const groupRoot = document.createElement('div');
      groupRoot.className = 'wt-groups';
      for (const group of groups) {
        if (!group.choices.length) continue;
        const section = document.createElement('div');
        section.className = 'wt-group';
        const label = document.createElement('h3');
        label.textContent = group.label;
        label.style.color = group.color || '';
        section.append(label);
        for (const choice of group.choices) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'wt-row';
          row.disabled = choice.fare > balance;
          row.setAttribute('aria-label', `${choice.number}. ${choice.name}, ${choice.km.toFixed(1)} kilometres, ₹${choice.fare}`);
          const number = document.createElement('span');
          number.className = 'wt-number';
          number.textContent = String(choice.number);
          const name = document.createElement('span');
          name.textContent = choice.name;
          const distance = document.createElement('span');
          distance.className = 'wt-distance';
          distance.textContent = `${choice.km.toFixed(1)} km`;
          const fare = document.createElement('span');
          fare.className = 'wt-fare';
          fare.textContent = `₹${choice.fare}`;
          row.append(number, name, distance, fare);
          row.addEventListener('click', () => onChoose(choice.number));
          section.append(row);
        }
        groupRoot.append(section);
      }
      root.append(groupRoot);
    }
    const actions = document.createElement('div');
    actions.className = 'wt-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wt-cancel';
    cancel.textContent = 'Esc · Cancel';
    cancel.addEventListener('click', onCancel);
    if (onPageChange && pageLabel) {
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'wt-cancel';
      previous.textContent = '‹ Previous';
      previous.addEventListener('click', () => onPageChange(-1));
      const page = document.createElement('span');
      page.className = 'wt-balance';
      page.textContent = pageLabel;
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'wt-cancel';
      next.textContent = 'Next ›';
      next.addEventListener('click', () => onPageChange(1));
      actions.append(previous, page, next);
    }
    actions.append(cancel);
    if (onConfirm) {
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.textContent = 'Enter · Go';
      confirm.addEventListener('click', onConfirm);
      actions.append(confirm);
    }
    root.append(actions);
    root.classList.remove('hidden');
    root.querySelector(onConfirm ? '.wt-actions button:not(.wt-cancel)' : '.wt-row:not(:disabled), .wt-cancel')?.focus();
  }

  closeWhereTo() {
    this.whereEl.classList.add('hidden');
    this.whereEl.replaceChildren();
  }

  /* ---------- Gesture wheel ---------- */
  buildWheel() {
    const w = $('wheel');
    this.wheelEl = w;
    this.wheelItems = EMOTE_LIST.map((name, i) => {
      const a = (i / EMOTE_LIST.length) * Math.PI * 2 - Math.PI / 2;
      const el = document.createElement('div');
      el.className = 'witem';
      el.textContent = EMOTE_LABELS[name];
      el.style.left = `${50 + Math.cos(a) * 36}%`;
      el.style.top = `${50 + Math.sin(a) * 36}%`;
      w.appendChild(el);
      return { name, a, el };
    });
  }
  wheel(open, vec) {
    this.wheelEl.classList.toggle('hidden', !open);
    let sel = null;
    if (Math.hypot(vec.x, vec.y) > 30) {
      const a = Math.atan2(vec.y, vec.x);
      let best = 9;
      for (const it of this.wheelItems) {
        const d = Math.abs(Math.atan2(Math.sin(a - it.a), Math.cos(a - it.a)));
        if (d < best) {
          best = d;
          sel = it.name;
        }
      }
    }
    for (const it of this.wheelItems) it.el.classList.toggle('sel', it.name === sel);
    return sel;
  }

  buildMap(world) {
    const c = document.createElement('canvas');
    c.width = Math.round(MAP_W * MAP_PPM);
    c.height = Math.round(MAP_H * MAP_PPM);
    const g = c.getContext('2d');
    g.scale(MAP_PPM, MAP_PPM);
    g.translate(-MAP_X0, -MAP_Z0);
    g.fillStyle = COL.outside;
    g.fillRect(MAP_X0, MAP_Z0, MAP_W, MAP_H);
    g.fillStyle = COL.ground;
    for (const [x0, z0, x1, z1] of MAP.tiles) g.fillRect(x0, z0, x1 - x0, z1 - z0);
    this.drawWorldLayer(g, MAP_X0, MAP_Z0, MAP_X0 + MAP_W, MAP_Z0 + MAP_H, 1 / MAP_PPM, true);
    return c;
  }

  /** Streets, buildings, water and parks inside a world rectangle; px = metres per pixel. */
  drawWorldLayer(g, x0, z0, x1, z1, px, all = false) {
    const w = this.world;
    const vis = (p) => all || !(p.x1 < x0 || p.x0 > x1 || p.z1 < z0 || p.z0 > z1);
    const path = (p) => {
      g.beginPath();
      for (let i = 0; i < p.n; i++) (i ? g.lineTo : g.moveTo).call(g, p.xs[i], p.zs[i]);
      g.closePath();
    };
    g.fillStyle = COL.green;
    for (const p of w.greens) if (vis(p)) {
      path(p);
      g.fill();
    }
    g.fillStyle = COL.water;
    for (const p of w.waterPolys) if (vis(p)) {
      path(p);
      g.fill();
    }
    // Roads: lanes first, then main roads on top
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const edges = [];
    if (all) edges.push(...w.graph.edges);
    else w.graph.grid.query(x0, x1, z0, z1, (e) => edges.push(e));
    edges.sort((a, b) => b.c - a.c);
    for (const e of edges) {
      g.strokeStyle = e.br ? COL.deck : e.c <= 2 ? COL.major : COL.road;
      g.lineWidth = Math.max(e.w, px * (e.c <= 2 ? 3 : 1.6));
      g.beginPath();
      for (let i = 0; i < e.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, e.pts[i], e.pts[i + 1]);
      g.stroke();
    }
    g.fillStyle = COL.building;
    if (all) {
      for (const p of w.buildingPolys) {
        path(p);
        g.fill();
      }
    } else {
      w.grid.query(x0, x1, z0, z1, (o) => {
        if (o.t !== 2) return;
        path(o.p);
        g.fill();
      });
    }
  }

  /** Draw the map for a view: the overview image when zoomed out, vectors close up. */
  drawMapView(g, x0, z0, x1, z1, px, names = false) {
    g.fillStyle = COL.outside;
    g.fillRect(x0, z0, x1 - x0, z1 - z0);
    this.drawRegionLayer(g, x0, z0, x1, z1, px);
    if (px > 1 / MAP_PPM * 0.7) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.map, MAP_X0, MAP_Z0, MAP_W, MAP_H);
      return;
    }
    g.fillStyle = COL.ground;
    for (const [tx0, tz0, tx1, tz1] of MAP.tiles) g.fillRect(tx0, tz0, tx1 - tx0, tz1 - tz0);
    this.drawWorldLayer(g, x0, z0, x1, z1, px);
    this.drawTransitLayer(g, px, names);
  }

  /** Kolkata beyond the playable area: the suburban railway and every Metro line. */
  drawRegionLayer(g, x0, z0, x1, z1, px) {
    const R = MAP.region;
    if (!R) return;
    if (!this.regionLines) {
      // official Metro colours: 1 Blue, 2 Green, 3 Purple, 4 Yellow, 5 Pink, 6 Orange
      const metroColor = (n = '') =>
        /line.?1|blue|north.?south|dakshine|kavi subhash/i.test(n) ? '#2f6fe0' : /line.?2|green|east.?west/i.test(n) ? '#2fbf5a' : /line.?3|purple|joka/i.test(n) ? '#9b4dca' : /line.?4|yellow|noapara|barasat/i.test(n) ? '#e8c21b' : /line.?5|pink/i.test(n) ? '#e85aa0' : /line.?6|orange|new garia|airport/i.test(n) ? '#f07d1e' : '#7f8fb0';
      this.regionLines = R.rails.map((r) => {
        let bx0 = Infinity;
        let bx1 = -Infinity;
        let bz0 = Infinity;
        let bz1 = -Infinity;
        for (let i = 0; i < r.p.length; i += 2) {
          bx0 = Math.min(bx0, r.p[i]);
          bx1 = Math.max(bx1, r.p[i]);
          bz0 = Math.min(bz0, r.p[i + 1]);
          bz1 = Math.max(bz1, r.p[i + 1]);
        }
        const metro = r.k !== 'rail';
        return { p: r.p, bx0, bx1, bz0, bz1, metro, color: metro ? (r.c && r.c.startsWith('#') ? r.c : metroColor(r.name)) : '#9aa0a8' };
      });
      this.regionLines.sort((a, b) => a.metro - b.metro);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const l of this.regionLines) {
      if (l.bx1 < x0 || l.bx0 > x1 || l.bz1 < z0 || l.bz0 > z1) continue;
      g.strokeStyle = l.color;
      g.lineWidth = (l.metro ? 3 : 1.8) * px;
      g.setLineDash(l.metro ? [] : [6 * px, 3 * px]);
      g.beginPath();
      for (let i = 0; i < l.p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, l.p[i], l.p[i + 1]);
      g.stroke();
    }
    g.setLineDash([]);
  }

  /* ---------- Title / loading ---------- */
  setLoading(p, text) {
    this.el.loading.querySelector('.fill').style.width = `${Math.round(p * 100)}%`;
    this.el.loading.querySelector('.text').textContent = text;
  }
  ready() {
    this.el.loading.classList.add('hidden');
    this.el.play.classList.remove('hidden');
  }
  start() {
    this.el.title.classList.add('out');
    this.el.hud.classList.remove('hidden');
    setTimeout(() => this.el.hint.classList.add('fade'), 12000);
  }
  setPaused(p) {
    this.el.pause.classList.toggle('hidden', !p);
  }
  setPhoto(p) {
    this.el.photo.classList.toggle('hidden', !p);
    this.el.hud.classList.toggle('hidden', p);
  }

  /* ---------- Messages ---------- */
  setMoney(v, instant = false, delta = null, note = '') {
    const prev = this.targetMoney;
    this.targetMoney = v;
    if (instant) {
      this.shownMoney = v;
      return;
    }
    const diff = delta !== null ? delta : (v - prev);
    if (diff !== 0) {
      this.moneyDelta(diff, note);
      const isGain = diff > 0;
      this.el.money.classList.remove('bump', 'bump-gain', 'bump-loss');
      void this.el.money.offsetWidth;
      this.el.money.classList.add('bump', isGain ? 'bump-gain' : 'bump-loss');
      clearTimeout(this._bump);
      this._bump = setTimeout(() => {
        this.el.money.classList.remove('bump', 'bump-gain', 'bump-loss');
      }, 260);
    }
  }

  /** Large, hard-to-miss money change popup on the lower-right side of the HUD. */
  moneyDelta(delta, note = '') {
    if (!delta || !this.el.moneyPopups) return;
    const isGain = delta > 0;
    const abs = Math.abs(delta);
    const sign = isGain ? '+' : '−';
    const formatted = `${sign}₹${abs.toLocaleString('en-IN')}`;
    const cleanNote = note ? note.replace(/^TIP\s*\+?₹?\d*\s*/i, 'Tip: ').trim() : '';
    const now = Date.now();

    // Merge changes within ~350 ms into a single popup with the total (same sign)
    const last = this.el.moneyPopups.lastElementChild;
    if (last && (now - (last._time || 0) < 350) && (last._sign === (isGain ? 1 : -1))) {
      last._val += delta;
      last._time = now;
      const combinedAbs = Math.abs(last._val);
      const combinedSign = last._val >= 0 ? '+' : '−';
      const isBig = combinedAbs >= 500;
      last.classList.toggle('big', isBig);

      const numEl = last.querySelector('.mp-num');
      if (numEl) numEl.textContent = `${combinedSign}₹${combinedAbs.toLocaleString('en-IN')}`;

      if (cleanNote) {
        let noteEl = last.querySelector('.mp-note');
        if (!noteEl) {
          noteEl = document.createElement('div');
          noteEl.className = 'mp-note';
          last.appendChild(noteEl);
        }
        noteEl.textContent = cleanNote;
      }

      // Re-trigger the pop animation
      last.style.animation = 'none';
      void last.offsetWidth;
      last.style.animation = '';
      return;
    }

    // Limit maximum stacked popups to 4
    while (this.el.moneyPopups.children.length >= 4) {
      this.el.moneyPopups.firstElementChild.remove();
    }

    const isBig = abs >= 500;
    const el = document.createElement('div');
    el.className = `money-popup ${isGain ? 'gain' : 'loss'}${isBig ? ' big' : ''}`;
    el._val = delta;
    el._sign = isGain ? 1 : -1;
    el._time = now;

    el.innerHTML = `<div class="mp-num">${formatted}</div>${cleanNote ? `<div class="mp-note">${cleanNote}</div>` : ''}`;

    const remove = () => {
      if (el.parentNode) el.remove();
    };
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 1700);

    this.el.moneyPopups.appendChild(el);
  }
  notify(title, sub = '', color = '#ffd36b') {
    const n = document.createElement('div');
    n.className = 'note';
    n.innerHTML = `<div class="nt" style="color:${color}">${title}</div>${sub ? `<div class="ns">${sub}</div>` : ''}`;
    this.el.notify.appendChild(n);
    while (this.el.notify.children.length > 3) this.el.notify.firstChild.remove();
    setTimeout(() => n.remove(), 3300);
  }
  fadeTransition(duration = 0.8, onBlack = null) {
    const el = this.el.fade;
    if (!el) {
      if (onBlack) onBlack();
      return;
    }
    el.classList.add('black');
    setTimeout(() => {
      if (onBlack) onBlack();
      setTimeout(() => {
        el.classList.remove('black');
      }, duration * 350);
    }, duration * 450);
  }
  mission(html) {
    if (!html) {
      this.el.mission.classList.add('hidden');
      return;
    }
    this.el.mission.classList.remove('hidden');
    if (this._mission !== html) {
      this.el.mission.innerHTML = html;
      this._mission = html;
    }
  }
  countdown(text) {
    const c = this.el.countdown;
    c.textContent = text;
    c.classList.remove('pop');
    void c.offsetWidth;
    if (text) c.classList.add('pop');
  }
  drift(show, score = 0, mult = 1) {
    this.el.drift.classList.toggle('hidden', !show);
    if (show) {
      this.driftEls.score.textContent = Math.floor(score).toLocaleString();
      this.driftEls.mult.textContent = `x${mult.toFixed(1)}`;
    }
  }

  /* ---------- Per-frame ---------- */
  update(dt, player, hours, blips, vehicle, camera) {
    this.camera = camera;
    if (this.dmgFlash > 0.001 || this._flash) {
      this.dmgFlash *= Math.exp(-2.5 * dt);
      const o = this.dmgFlash.toFixed(2);
      if (o !== this._flash) this.cw.dmg.style.opacity = this._flash = o;
    }
    if (this.shownMoney !== this.targetMoney) {
      const d = this.targetMoney - this.shownMoney;
      this.shownMoney += Math.sign(d) * Math.max(1, Math.abs(d) * Math.min(1, dt * 6));
      if (Math.abs(this.targetMoney - this.shownMoney) < 1) this.shownMoney = this.targetMoney;
    }
    const money = `₹${Math.round(this.shownMoney).toLocaleString('en-IN')}`;
    if (money !== this._money) this.el.money.textContent = this._money = money;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    if (clock !== this._clock) this.el.clock.textContent = this._clock = clock;
    // Canvas widgets redraw at ~30 Hz — plenty for a HUD, half the CPU
    this._hudT = (this._hudT || 0) + dt;
    if (this._hudT >= 1 / 30) {
      this._hudT = 0;
      this.drawMinimap(player, blips());
      if (!!vehicle !== this._veh) {
        this._veh = !!vehicle;
        this.speedoEl.classList.toggle('hidden', !vehicle);
      }
      if (vehicle) this.drawSpeedo(vehicle);
    }
    if (this.bubbles.length) this.updateBubbles(camera);
  }

  drawMinimap(p, blips) {
    const g = this.mm;
    const S = 440;
    const C = S / 2;
    const zoom = 1.5 - clamp(p.speed / 40, 0, 1) * 0.85;
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(p.yaw), Math.sin(p.yaw));
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(C, C, C, 0, Math.PI * 2);
    g.clip();
    g.translate(C, C);
    g.rotate(rot);
    g.scale(zoom, zoom);
    g.translate(-p.pos.x, -p.pos.z);
    const R = C / zoom;
    this.drawMapView(g, p.pos.x - R, p.pos.z - R, p.pos.x + R, p.pos.z + R, 1 / zoom);
    // GPS route to the waypoint
    if (this.route && this.route.length > 1) {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [w, col] of [[11, 'rgba(0,0,0,0.5)'], [6, '#ff3fa4']]) {
        g.strokeStyle = col;
        g.lineWidth = w / zoom;
        g.beginPath();
        this.route.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
        g.stroke();
      }
    }
    g.restore();

    // Blips (clamped to the rim)
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (const b of blips) {
      const dx = (b.x - p.pos.x) * zoom;
      const dz = (b.z - p.pos.z) * zoom;
      let sx = dx * cs - dz * sn;
      let sy = dx * sn + dz * cs;
      const d = Math.hypot(sx, sy);
      const maxR = C - 16;
      const edge = d > maxR;
      if (edge) {
        if (!b.always) continue;
        sx *= maxR / d;
        sy *= maxR / d;
      }
      // stalls and shops round where you are: an icon on a dark disc, ringed in their colour
      const r = b.poi ? 17 : b.r || 8;
      g.beginPath();
      g.arc(C + sx, C + sy, r, 0, Math.PI * 2);
      g.fillStyle = b.poi ? 'rgba(11, 13, 20, 0.85)' : b.color;
      g.shadowColor = b.color;
      g.shadowBlur = 12;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = b.poi ? 3 : 2.5;
      g.strokeStyle = b.poi ? b.color : '#000';
      g.stroke();
      if (b.label) {
        g.fillStyle = '#000';
        g.font = b.poi ? '19px sans-serif' : 'bold 13px Rajdhani';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.label, C + sx, C + sy + 1);
      }
    }
    // Player arrow
    g.save();
    g.translate(C, C);
    g.beginPath();
    g.moveTo(0, -16);
    g.lineTo(11, 12);
    g.lineTo(0, 6);
    g.lineTo(-11, 12);
    g.closePath();
    g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 10;
    g.fill();
    g.restore();
    // North marker
    const nx = sn * (C - 18);
    const ny = -cs * (C - 18);
    g.fillStyle = '#fff';
    g.font = 'bold 22px Rajdhani';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', C + nx, C + ny);
  }

  drawSpeedo(p) {
    const g = this.sp;
    const S = 460;
    const C = S / 2;
    const R = 180;
    const kmh = p.speed * 3.6;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const t = clamp(kmh / 300, 0, 1);
    g.clearRect(0, 0, S, S);
    const bg = g.createRadialGradient(C, C, 40, C, C, R + 30);
    bg.addColorStop(0, 'rgba(10,8,20,0.65)');
    bg.addColorStop(1, 'rgba(10,8,20,0)');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(C, C, R + 30, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    g.lineWidth = 16;
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.arc(C, C, R, a0, a1);
    g.stroke();
    const grad = g.createLinearGradient(C - R, C, C + R, C);
    grad.addColorStop(0, '#38f3ff');
    grad.addColorStop(0.6, '#b45bff');
    grad.addColorStop(1, '#ff3fa4');
    g.strokeStyle = grad;
    g.shadowColor = '#ff3fa4';
    g.shadowBlur = 20;
    g.beginPath();
    g.arc(C, C, R, a0, a0 + (a1 - a0) * t);
    g.stroke();
    g.shadowBlur = 0;
    // ticks
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 3;
    for (let i = 0; i <= 15; i++) {
      const a = a0 + ((a1 - a0) * i) / 15;
      const r0 = i % 5 === 0 ? R - 34 : R - 26;
      g.beginPath();
      g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
      g.lineTo(C + Math.cos(a) * (R - 16), C + Math.sin(a) * (R - 16));
      g.stroke();
    }
    // nitro arc
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.arc(C, C, R - 52, a0, a1);
    g.stroke();
    g.strokeStyle = p.nitroOn ? '#7fd8ff' : '#3a8bff';
    g.shadowColor = '#3a8bff';
    g.shadowBlur = p.nitroOn ? 18 : 6;
    g.beginPath();
    g.arc(C, C, R - 52, a0, a0 + (a1 - a0) * p.nitro);
    g.stroke();
    g.shadowBlur = 0;
    // numbers
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '110px "Bebas Neue"';
    g.fillText(String(Math.round(kmh)), C, C + 4);
    g.font = '600 26px Rajdhani';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText('KM/H', C, C + 64);
    g.font = '44px "Bebas Neue"';
    g.fillStyle = '#ffd36b';
    g.fillText(p.gear < 0 ? 'R' : p.speed < 0.5 ? 'N' : String(p.gear), C, C + 120);
    g.font = '600 18px Rajdhani';
    g.fillStyle = '#7fd8ff';
    g.fillText('NITRO', C, C - 78);
  }
}
