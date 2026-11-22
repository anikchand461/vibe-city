import * as THREE from 'three';
import { Character } from './character.js';
import { LINES, pick } from './lines.js';
import { MAP, inPoly } from './geo.js';
import { merge, paint, damp, dampAngle } from './utils.js';
import { terminusRoutes } from './busroutes.js';

/*
 * Life at Howrah Station: a ticket window, food and book stalls on the
 * concourse and the forecourt, a TTE (travelling ticket examiner) who checks
 * anyone heading for the platforms, and buses and yellow taxis waiting outside.
 */

const STALLS = [
  { id: 'tickets', en: 'TICKETS', bn: 'টিকিট', color: '#1f3f9a', price: 10, text: 'Buy a ticket', where: 'in', u: -1, v: -0.15 },
  { id: 'cha', en: 'CHA', bn: 'চা', color: '#b5322b', price: 10, hp: 15, text: 'Cha in a clay bhar', where: 'in', u: 1, v: 0.15 },
  { id: 'books', en: 'A.H. WHEELER', bn: 'বই ও পত্রিকা', color: '#2f6b46', price: 5, text: 'Buy The Calcutta Chronicle', where: 'in', u: 1, v: 0.45 },
  { id: 'mishti', en: 'MISHTI', bn: 'মিষ্টি', color: '#d98a1f', price: 40, hp: 35, text: 'Rosogolla and sandesh', where: 'in', u: 1, v: -0.45 },
  { id: 'phuchka', en: 'PHUCHKA', bn: 'ফুচকা', color: '#7a3fa0', price: 30, hp: 30, text: 'Phuchka, six pieces', where: 'out', v: -0.12 },
  { id: 'jhalmuri', en: 'JHALMURI', bn: 'ঝালমুড়ি', color: '#c0392b', price: 20, hp: 25, text: 'A cone of jhalmuri', where: 'out', v: 0.12 },
  { id: 'fruit', en: 'FRUITS', bn: 'ফল', color: '#3c8d2f', price: 25, hp: 20, text: 'Cut fruit with chaat masala', where: 'out', v: 0.34 },
];
// how each stall shows on the map
const STALL_MAP = {
  tickets: ['🎫', 'Tickets'],
  cha: ['☕', 'Cha'],
  books: ['📰', 'Newspaper'],
  mishti: ['🍬', 'Mishti'],
  phuchka: ['🥟', 'Phuchka'],
  jhalmuri: ['🥜', 'Jhalmuri'],
  fruit: ['🍉', 'Fruit'],
};
const NEWS = [
  'The Calcutta Chronicle: Underwater Metro shatters cross-river transit records!',
  'The Calcutta Chronicle: 85,000 roar at Yuva Bharati as Kolkata Derby ends in 2-2 draw.',
  'The Calcutta Chronicle: Citizens rally at Esplanade to defend century-old wooden trams.',
  'The Calcutta Chronicle: Torrential cloudburst inundates Thanthania and College Street.',
  'The Calcutta Chronicle: Kumartuli sculptors work through the night as festival magic nears.',
];

function signTex(en, bn, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#fff8e8';
  g.textAlign = 'center';
  g.font = 'bold 64px "Kohinoor Bangla", "Bangla MN", "Noto Sans Bengali", Arial, sans-serif';
  g.fillText(bn, 256, 72, 480);
  g.font = 'bold 44px Arial, sans-serif';
  g.fillText(en, 256, 136, 480);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const box = (w, h, d, x, y, z, hex) => {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex);
};

export class Station {
  constructor(scene, world, hud, rail) {
    this.scene = scene;
    this.world = world;
    this.hud = hud;
    this.stalls = [];
    this.parked = [];
    this.ticketT = 0; // seconds of ticket validity left
    this.tte = null;
    const st = world.station;
    if (!st) return;
    // Headhouse frame: +u out of the facade towards the river, +v along it
    const a = st.a;
    const ux = st.ux;
    const uz = st.uz;
    const D = st.depth;
    const W = st.W;
    const hc = st.headCentre;
    const P = (u, v) => [hc.x + ux * u - uz * v, hc.z + uz * u + ux * v];
    this.P = P;
    this.frameA = a;
    this.D = D;
    this.hc = hc;
    this.ux = ux;
    this.uz = uz;
    this.platforms = rail ? rail.platforms.filter((p) => p.covered) : [];

    /* ---- Stalls ---- */
    const parts = [];
    const signs = [];
    for (const def of STALLS) {
      // concourse stalls back onto the headhouse and face the platforms; forecourt stalls face the river
      const u = def.where === 'in' ? -D / 2 - 4 : D / 2 + 5;
      const v = def.v * W;
      const face = def.where === 'in' ? -1 : 1;
      const [x, z] = P(u, v);
      const yaw = Math.atan2(ux * face, uz * face);
      const g = [];
      g.push(box(3.2, 1.1, 1.2, 0, 0.55, 0.6, def.id === 'tickets' ? '#c9c2b4' : '#7a5a3a')); // counter
      g.push(box(3.4, 0.08, 1.4, 0, 1.14, 0.6, '#d8d0c0'));
      for (const [px, pz] of [[-1.55, -0.9], [1.55, -0.9], [-1.55, 1.2], [1.55, 1.2]]) g.push(box(0.1, 2.6, 0.1, px, 1.3, pz, '#2a2b2e'));
      g.push(box(3.8, 0.1, 2.8, 0, 2.62, 0.15, def.color)); // awning
      g.push(box(3.3, 2.5, 0.1, 0, 1.25, -0.95, '#5a4a3a')); // back
      // wares on the counter
      for (let k = -1; k <= 1; k++) g.push(box(0.5, 0.3 + Math.random() * 0.3, 0.5, k * 0.9, 1.35, 0.6, ['#e8d5a0', '#c0392b', '#f2c14e', '#ffffff'][(k + 4) % 4]));
      const geo = merge(g);
      geo.rotateY(yaw);
      geo.translate(x, 0, z);
      parts.push(geo);
      const tex = signTex(def.en, def.bn, def.color);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 }));
      sign.position.set(x + Math.sin(yaw) * 1.6, 3.2, z + Math.cos(yaw) * 1.6);
      sign.rotation.y = yaw;
      signs.push(sign);
      world.addCircle(x, z, 1.7);
      // a tube light under the awning, over the counter
      world.addStationLamp(x + Math.sin(yaw) * 0.5, 2.53, z + Math.cos(yaw) * 0.5, yaw + Math.PI / 2, 2.8, 0, 5);
      // the vendor
      const vendor = new Character(scene, { female: def.id === 'mishti', skin: '#9a6948', shirt: def.id === 'tickets' ? '#e8e4d8' : ['#ffffff', '#e8d9a8', '#cfe3f2'][Math.floor(Math.random() * 3)], pants: '#3d3b39', shoes: '#2a2018', hair: '#120d0a', longHair: def.id === 'mishti', skirt: def.id === 'mishti', longSleeve: true, scale: 0.98 });
      vendor.mesh.position.set(x - Math.sin(yaw) * 0.3, 0, z - Math.cos(yaw) * 0.3);
      vendor.mesh.rotation.y = yaw;
      const front = [x + Math.sin(yaw) * 2.4, z + Math.cos(yaw) * 2.4];
      this.stalls.push({ def, x: front[0], z: front[1], vendor, acc: 0 });
    }
    const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh, ...signs);

    /* ---- The TTE, at the gate where the platforms begin ---- */
    let gx = 0;
    let gz = 0;
    let k = 0;
    for (const p of this.platforms) {
      const ends = [p.spine.at(0, {}), p.spine.at(p.spine.len, {})].map((q) => [q.x, q.z]);
      const e = ends.sort((A, B) => Math.hypot(A[0] - hc.x, A[1] - hc.z) - Math.hypot(B[0] - hc.x, B[1] - hc.z))[0];
      gx += e[0];
      gz += e[1];
      k++;
    }
    const [px, pz] = k ? [gx / k, gz / k] : P(-D / 2 - 12, 0);
    const dl = Math.hypot(hc.x - px, hc.z - pz) || 1;
    const tx = px + ((hc.x - px) / dl) * 5;
    const tz = pz + ((hc.z - pz) / dl) * 5;
    const ch = new Character(scene, { female: false, skin: '#8a5a3c', shirt: '#17181c', pants: '#17181c', shoes: '#0d0d0d', hair: '#120d0a', glasses: true, longSleeve: true, scale: 1.0 });
    const face = Math.atan2(hc.x - px, hc.z - pz);
    this.tte = { ch, x: tx, z: tz, y: 0, yaw: face, face, post: [tx, tz], state: 'idle', speed: 0, acc: 0, sayT: 0 };

    /* ---- Buses at Howrah Bus Station, taxis at the rank ---- */
    const bus = MAP.pois.find((p) => /howrah bus station/i.test(p.n));
    if (bus) {
      const n = world.graph.nearest(bus.x, bus.z, 120);
      const yaw = n ? Math.atan2(n.tx, n.tz) : a;
      // real routes that start (or end) here, each waiting to leave
      const runs = terminusRoutes(world.graph, /^howrah (station|stn)$/i, 5);
      runs.forEach((run, i) => {
        const off = (i - 2) * 4.2;
        const x = bus.x + Math.cos(yaw) * off;
        const z = bus.z - Math.sin(yaw) * off;
        if (!world.collideCircle(x, z, 1.8)) this.parked.push(['bus', run.route.livery, x, z, yaw, run]);
      });
    }
    // The taxi rank: two long rows of yellow Ambassadors, and the pre-paid taxi booth
    for (const row of [12, 17]) {
      for (let i = 0; i < 9; i++) {
        const [x, z] = P(D / 2 + row, W * 0.1 + (i - 4) * 6.2);
        if (!world.collideCircle(x, z, 1.3)) this.parked.push(['taxi', 0xf2c21b, x, z, a + Math.PI / 2]);
      }
    }
    {
      const [x, z] = P(D / 2 + 14.5, W * 0.1 - 33);
      const yaw = Math.atan2(ux, uz);
      const g = merge([box(3.2, 2.6, 2.4, 0, 1.3, 0, '#d8d0c0'), box(3.6, 0.15, 2.8, 0, 2.7, 0, '#9a3a2a'), box(2.2, 0.8, 0.05, 0, 1.5, 1.22, '#20262e')]);
      g.rotateY(yaw).translate(x, 0, z);
      const booth = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
      booth.castShadow = true;
      scene.add(booth);
      const tex = signTex('PRE-PAID TAXI', 'প্রিপেড ট্যাক্সি', '#1f3f9a');
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 }));
      sg.position.set(x + Math.sin(yaw) * 1.25, 3.3, z + Math.cos(yaw) * 1.25);
      sg.rotation.y = yaw;
      scene.add(sg);
      world.addCircle(x, z, 1.9);
    }
    this.spawn = P(D / 2 + 8, 0);
  }

  /** The stalls, for the map when you're at the station. */
  pois() {
    return this.stalls.map(({ def, x, z }) => {
      const [icon, name] = STALL_MAP[def.id] || ['•', def.en];
      return { x, z, icon, name: `${name} ₹${def.price}`, color: def.id === 'tickets' ? '#6ea6ff' : def.id === 'books' ? '#f4f1e8' : '#ffb36b' };
    });
  }

  /** Something to do near this point (E): buy from a stall. */
  near(pos) {
    for (const st of this.stalls) {
      if (Math.hypot(pos.x - st.x, pos.z - st.z) > 2.2) continue;
      const d = st.def;
      return { text: `${d.text} · ₹${d.price}`, act: () => this.buy(st) };
    }
    return null;
  }

  buy(st) {
    const g = this.game;
    const d = st.def;
    if (g.gameplay.money < d.price) {
      this.hud.say(st.vendor, pick(LINES.noMoney), 2.4);
      g.audio.beep(false);
      return;
    }
    g.gameplay.addMoney(-d.price);
    g.audio.beep(true);
    if (d.id === 'tickets') {
      this.ticketT = 300;
      this.hud.notify('TICKET BOUGHT', 'Valid for 5 minutes on any train', '#f4c51c');
      this.hud.say(st.vendor, pick(LINES.ticketSold), 2.4);
    } else if (d.id === 'books') {
      if (g.newspaper) {
        g.newspaper.buyAndOpen();
      } else {
        this.hud.notify('THE CALCUTTA CHRONICLE', NEWS[Math.floor(Math.random() * NEWS.length)], '#ffffff');
      }
    } else {
      g.player.hp = Math.min(100, g.player.hp + d.hp);
      this.hud.notify(d.en, `+${d.hp} health`, '#5dff9e');
      if (LINES[d.id]) this.hud.say(this.game.player.ch, pick(LINES[d.id]), 2);
      setTimeout(() => this.hud.say(st.vendor, pick(LINES.comeAgain), 2), 1700);
    }
  }

  /** Standing on one of Howrah's platforms? */
  onPlatforms(x, z) {
    return this.platforms.some((p) => inPoly(p.poly, x, z));
  }

  update(dt, t, ctx) {
    const { player, camPos } = ctx;
    this.ticketT = Math.max(0, this.ticketT - dt);
    // Vendors idle and look at whoever is close
    for (const st of this.stalls) {
      st.acc += dt;
      const d = Math.hypot(st.vendor.mesh.position.x - camPos.x, st.vendor.mesh.position.z - camPos.z);
      st.vendor.mesh.visible = d < 120;
      if (d < 60 && st.acc > 1 / 20) {
        st.vendor.update(st.acc, t);
        st.acc = 0;
      }
    }
    const T = this.tte;
    if (!T) return;
    const p = player.pos;
    const foot = player.mode === 'foot' && !player.dead;
    const dist = Math.hypot(p.x - T.x, p.z - T.z);
    let goal = null;
    T.sayT -= dt;
    if (T.state === 'idle') {
      if (foot && this.onPlatforms(p.x, p.z)) {
        if (this.ticketT > 0) {
          if (dist < 6 && T.sayT <= 0) {
            this.hud.say(T.ch, pick(LINES.ticketOk), 2);
            T.sayT = 20;
          }
        } else {
          T.state = 'chase';
          // Far down a long platform, a TTE on patrol steps out of the crowd behind you
          if (dist > 50) {
            const k = 30 / dist;
            T.x = p.x + (T.post[0] - p.x) * k;
            T.z = p.z + (T.post[1] - p.z) * k;
          }
          this.hud.say(T.ch, pick(LINES.ticketPlease), 2.6);
          ctx.audio.beep(false);
        }
      }
    } else if (T.state === 'chase') {
      goal = [p.x, p.z];
      if (!foot || dist > 240 || this.ticketT > 0) {
        T.state = 'return';
        if (dist > 240) this.hud.notify('GOT AWAY', 'The TTE lost you in the crowd', '#ffd36b');
      } else if (dist < 1.8) {
        const fine = Math.min(250, this.game.gameplay.money);
        this.game.gameplay.addMoney(-fine);
        if (this.game.progress) this.game.progress.event('fined');
        this.ticketT = 300;
        this.hud.say(T.ch, pick(fine ? LINES.fined : LINES.noFine), 3);
        this.hud.notify('CAUGHT WITHOUT A TICKET', fine ? `Fined ₹${fine} by the TTE` : 'Let off with a warning', '#ff5f6d');
        T.state = 'return';
      }
    } else if (T.state === 'return') {
      goal = T.post;
      if (Math.hypot(T.x - T.post[0], T.z - T.post[1]) < 0.6) {
        T.state = 'idle';
        T.yaw = T.face;
      }
    }
    let speed = 0;
    if (goal) {
      const dx = goal[0] - T.x;
      const dz = goal[1] - T.z;
      const d = Math.hypot(dx, dz) || 1;
      speed = T.state === 'chase' ? 5.2 : 1.6;
      T.x += (dx / d) * Math.min(d, speed * dt);
      T.z += (dz / d) * Math.min(d, speed * dt);
      T.yaw = dampAngle(T.yaw, Math.atan2(dx, dz), 8, dt);
      const hit = this.world.collideCircle(T.x, T.z, 0.35);
      if (hit) {
        T.x += hit.px;
        T.z += hit.pz;
      }
    } else if (dist < 10 && foot) T.yaw = dampAngle(T.yaw, Math.atan2(p.x - T.x, p.z - T.z), 3, dt);
    T.speed = damp(T.speed, speed, 8, dt);
    T.y = damp(T.y, this.world.height(T.x, T.z), 12, dt);
    const m = T.ch.mesh;
    m.position.set(T.x, T.y, T.z);
    m.rotation.y = T.yaw;
    T.ch.speed = T.speed;
    T.ch.mode = 'move';
    T.acc += dt;
    if (Math.hypot(T.x - camPos.x, T.z - camPos.z) < 80 && T.acc > 1 / 30) {
      T.ch.update(T.acc, t);
      T.acc = 0;
    }
  }
}
