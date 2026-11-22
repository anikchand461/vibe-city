import * as THREE from 'three';
import { Character, POSE, randomLook } from './character.js';
import { clamp, damp, dampAngle, paint, merge } from './utils.js';

// The seated pose puts the hips 0.95 m above the feet; the bench seat is at 0.47 m
const SEAT_DROP = -0.42;
// Sitting on a bench: the car seat's legs, but hands resting on the knees instead of a wheel
function benchPose(P, T) {
  for (const side of ['L', 'R']) {
    POSE.leg(P, side, 1.45, 0.08);
    POSE.knee(P, side, 1.35);
    POSE.arm(P, side, 0.5, 0.18);
    POSE.elbow(P, side, 0.95);
  }
  P.spine[0] = -0.1;
  P.head[1] = Math.sin(T * 0.4) * 0.15; // looking about
}
const VENDOR_LINES = ['Cha garam! Gorom cha!', 'Dada, ar ek bhar?', 'Lebu cha, masala cha, dudh cha!', 'Biscuit nebe, dada?'];

/*
 * The Kolkata "Adda" & Street Bench Mechanic:
 * Quintessential Kolkata culture — tea in clay bhars, benches along the Maidan
 * and river ghats, philosophizing with locals, time acceleration to watch
 * sunsets, and health regeneration.
 */

export const ADDA_SPOTS = [
  { id: 'prinsep', name: 'Prinsep Ghat Riverbank', x: -2797, z: 1062, yaw: Math.PI / 2, desc: 'Watch Vidyasagar Setu & Hooghly breeze' },
  { id: 'babughat', name: 'Babu Ghat Steps', x: -1940, z: 120, yaw: -Math.PI / 2, desc: 'River ghats, ferries & evening chai' },
  { id: 'maidan', name: 'Maidan Tree Shade', x: -1763, z: 1730, yaw: -Math.PI / 3, desc: 'Lush greenery & Victoria Memorial vista' },
  { id: 'victoria', name: 'Victoria Memorial Gardens', x: -1642, z: 2336, yaw: Math.PI, desc: 'White marble monument & water reflection' },
  { id: 'collegest', name: 'College Street Boi Para', x: 542, z: -1094, yaw: Math.PI / 4, desc: 'Coffee House, old books & fierce debates' },
  { id: 'howrah', name: 'Howrah Riverfront Forecourt', x: -1557, z: -1797, yaw: -Math.PI / 2, desc: 'Bustling chai stalls under Howrah Bridge' },
  { id: 'millennium', name: 'Millennium Park Promenade', x: -1451, z: -779, yaw: Math.PI / 2, desc: 'Riverside promenade & passing steamers' },
  { id: 'collegesq', name: 'College Square Heritage Tank', x: 531, z: -889, yaw: 0, desc: 'Historic swimming tank & student adda' },
  { id: 'esplanade', name: 'Esplanade Tram Corner', x: -849, z: 322, yaw: -Math.PI / 4, desc: 'Vintage tram bells & street chai counters' },
  { id: 'allenpark', name: 'Park Street & Allen Park', x: -425, z: 1757, yaw: Math.PI / 3, desc: 'South Kolkata heartbeat & evening snacks' },
];

export const ADDA_DIALOGUES = [
  'Dada, ebar derby-te East Bengal na Mohun Bagan? Arrey chhere din, age cha-ta khan!',
  'Kolkatar moto shanti ar erom mishti adda shara prithibite ar kothao paben na bhai.',
  "Uttam Kumarer 'Nayak' ar Soumitro-r 'Charulata'... sei cinema kothay ajkal!",
  'Dada, arek bhar gorom cha hobe? Beshi cha-pata, kom chini!',
  'Shondhe-bela Howrah Bridge-er aalor roshnai dekhle mon bhalo hoye jaay.',
  'Boi-para, tram-er ghonta, ar bikel-er adda... ei to amader Kolkata.',
  'Ei shohorer batasheo ekta kobita ache, bujhlen?',
  'Politics niye matha ghamiye labh nei dada, gorom singara ar telebhaja khan!',
  'Brishti porle khichuri ar ilish machh... aah, sworgo!',
  'Robindronather gaan ar bikeler Ganga-r batas... bas, ar ki chai jibone!',
  'Coffee House-er sei adda-ta aj ar nei... tobu smriti-gulo beche ache.',
];

const box = (w, h, d, x, y, z, hex) => {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex);
};

const cyl = (rt, rb, h, x, y, z, hex, seg = 8) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex);
};

export class AddaManager {
  constructor(scene, world, hud, audio) {
    this.scene = scene;
    this.world = world;
    this.hud = hud;
    this.audio = audio;
    this.active = false;
    this.currentSpot = null;
    this.dialogueTimer = 2.5;
    this.camOrbit = 0;
    this.spots = [];
    this.buildSpots();
    // the adda's own camera, and the company round the bench (only while you're sitting)
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.crowd = [];
    this.crowdSpot = null; // the bench the company is at (only ever the one nearest you)
    this.lookT = 0;
    this.chatT = 4;
  }

  /** Every frame: the nearest bench has its regulars, sitting or not; they leave when you go. */
  ambient(dt, elapsed, pos, underground) {
    this.lookT -= dt;
    if (this.lookT <= 0 && !this.active) {
      this.lookT = 0.5;
      let best = null;
      let bestD = 60;
      for (const s of this.spots) {
        const d = Math.hypot(pos.x - s.x, pos.z - s.z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      const cur = this.crowdSpot;
      const keep = cur && !underground && Math.hypot(pos.x - cur.x, pos.z - cur.z) < 90;
      if (!keep && cur) this.disperse();
      if (!keep && best && !underground) this.gather(best);
    }
    if (!this.crowd.length) return;
    for (const c of this.crowd) c.ch.update(dt, elapsed);
    // within earshot, the friend and the uncle keep talking whether you join or not
    if (!this.active && Math.hypot(pos.x - this.crowdSpot.x, pos.z - this.crowdSpot.z) < 15) {
      this.chatT -= dt;
      if (this.chatT <= 0) {
        this.chatT = 7 + Math.random() * 5;
        const vendor = Math.random() < 0.25;
        const c = this.crowd[vendor ? 2 : Math.random() < 0.5 ? 0 : 1];
        const lines = vendor ? VENDOR_LINES : ADDA_DIALOGUES;
        this.hud.say(c.ch, lines[Math.floor(Math.random() * lines.length)], 3.8);
      }
    }
  }

  /** The way to the nearest water within 60 m, or null. */
  faceWater(p) {
    for (let d = 8; d <= 60; d += 4) {
      let sx = 0;
      let sz = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        if (this.world.isWet(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d)) {
          sx += Math.sin(a);
          sz += Math.cos(a);
        }
      }
      if (sx || sz) return Math.atan2(sx, sz);
    }
    return null;
  }

  /** A point beside the bench, in its own frame (x along the seat, z out in front), to world x, z. */
  local(spot, lx, lz) {
    const c = Math.cos(spot.yaw);
    const s = Math.sin(spot.yaw);
    return [spot.x + lx * c + lz * s, spot.z - lx * s + lz * c];
  }

  /** Someone at the adda: sitting on the bench or standing at lx, lz, facing yaw. */
  place(ch, spot, lx, lz, yaw, sit) {
    const [x, z] = this.local(spot, lx, lz);
    ch.mesh.position.set(x, spot.y + (sit ? SEAT_DROP : 0), z);
    ch.mesh.rotation.set(0, yaw, 0);
    ch.mode = sit ? 'pose' : 'move';
    ch.poseFn = sit ? benchPose : null;
    ch.speed = 0;
  }

  /** A friend on the bench, an uncle holding forth, and the chaiwala at his counter; your seat stays free. */
  gather(spot) {
    const people = [
      { lx: 0.5, lz: 0, yaw: spot.yaw, sit: true },
      { lx: -1.5, lz: 0.9, yaw: spot.yaw + Math.atan2(1.3, -0.9), sit: false },
      { lx: 1.6, lz: -0.35, yaw: spot.yaw, sit: false, vendor: true },
    ];
    for (const p of people) {
      const ch = new Character(this.scene, randomLook());
      this.scene.add(ch.mesh);
      this.place(ch, spot, p.lx, p.lz, p.yaw, p.sit);
      this.crowd.push({ ch, ...p });
    }
    this.crowdSpot = spot;
  }
  disperse() {
    for (const c of this.crowd) {
      c.ch.mesh.removeFromParent();
      c.ch.mesh.geometry.dispose();
    }
    this.crowd = [];
    this.crowdSpot = null;
  }

  /** The orbit round the bench: camOrbit round it, camPitch up over it, camDist out from it. */
  frame(spot) {
    const flat = Math.cos(this.camPitch) * this.camDist;
    this.camLook.set(spot.x, spot.y + 0.9, spot.z);
    this.camPos.set(spot.x - Math.sin(this.camOrbit) * flat, this.camLook.y + Math.sin(this.camPitch) * this.camDist, spot.z - Math.cos(this.camOrbit) * flat);
  }

  buildSpots() {
    const benchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const stallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

    for (const d0 of ADDA_SPOTS) {
      // a bench by the river or a tank looks out over the water
      const def = { ...d0, yaw: this.faceWater(d0) ?? d0.yaw };
      const y = this.world.height(def.x, def.z);
      const spot = { ...def, y };

      // 1. Procedural Kolkata Wooden Park Bench
      const bg = [];
      // Cast-iron side legs & armrests
      for (const sx of [-0.9, 0.9]) {
        bg.push(box(0.08, 0.45, 0.5, sx, 0.22, 0, '#2b3130'));
        bg.push(box(0.08, 0.5, 0.08, sx, 0.65, -0.25, '#2b3130')); // back upright
        bg.push(box(0.08, 0.06, 0.52, sx, 0.48, 0.02, '#3d4543')); // armrest
      }
      // Wooden slats (seat)
      for (const sz of [-0.18, -0.06, 0.06, 0.18]) {
        bg.push(box(1.9, 0.04, 0.09, 0, 0.45, sz, '#8b5a36'));
      }
      // Wooden slats (backrest)
      for (const sy of [0.6, 0.74, 0.88]) {
        bg.push(box(1.9, 0.09, 0.04, 0, sy, -0.25, '#9a643c'));
      }
      const benchGeom = merge(bg);
      if (benchGeom) {
        const benchMesh = new THREE.Mesh(benchGeom, benchMat);
        benchMesh.position.set(def.x, y, def.z);
        benchMesh.rotation.y = def.yaw;
        benchMesh.castShadow = true;
        this.scene.add(benchMesh);
      }

      // 2. Roadside Tea Counter (Chai Bhar Stall) beside the bench
      const tg = [];
      const cx = 1.6;
      const cz = 0.3;
      // Wooden stall table
      tg.push(box(1.1, 0.85, 0.7, cx, 0.42, cz, '#5a4228'));
      tg.push(box(1.2, 0.06, 0.8, cx, 0.86, cz, '#785532'));
      // Copper kettle
      tg.push(cyl(0.12, 0.14, 0.25, cx - 0.25, 1.0, cz - 0.1, '#bf6530', 10));
      // Clay bhars (earthen tea cups) stacked
      for (let bx = -0.1; bx <= 0.2; bx += 0.15) {
        for (let bz = -0.15; bz <= 0.15; bz += 0.15) {
          tg.push(cyl(0.04, 0.025, 0.08, cx + bx, 0.92, cz + bz, '#b85f38', 6));
        }
      }
      // Glass jar with biscuits
      tg.push(cyl(0.1, 0.1, 0.28, cx + 0.35, 1.01, cz + 0.1, '#d8eef5', 8));

      const stallGeom = merge(tg);
      if (stallGeom) {
        const stallMesh = new THREE.Mesh(stallGeom, stallMat);
        stallMesh.position.set(def.x, y, def.z);
        stallMesh.rotation.y = def.yaw;
        stallMesh.castShadow = true;
        this.scene.add(stallMesh);
      }

      // Add collision so vehicles/player don't phase through the bench & counter
      this.world.addCircle(def.x, def.z, 0.8);
      this.world.addCircle(def.x + Math.cos(def.yaw) * 1.6, def.z - Math.sin(def.yaw) * 1.6, 0.6);

      this.spots.push(spot);
    }
  }

  /** The benches, for the map when you're nearby. */
  pois() {
    return this.spots.map((s) => ({ x: s.x, z: s.z, icon: '🪑', name: 'Adda & cha', color: '#ffd36b' }));
  }

  /** Find nearest Adda spot within interaction distance (on foot) */
  near(pos) {
    if (this.active) return null;
    for (const s of this.spots) {
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d < 2.8) {
        return {
          spot: s,
          text: `Join Adda & Cha (${s.name})`,
          act: (player) => this.start(player, s),
        };
      }
    }
    return null;
  }

  /** Enter Adda mode: player sits on bench, tea time begins */
  start(player, spot) {
    if (this.active || player.mode === 'driving' || player.dead) return;
    this.active = true;
    this.currentSpot = spot;
    this.dialogueTimer = 1.2;

    player.mode = 'adda';
    player.pos.set(spot.x, spot.y, spot.z);
    player.yaw = spot.yaw;
    this.place(player.ch, spot, -0.45, 0, spot.yaw, true);
    if (this.crowdSpot !== spot) {
      this.disperse();
      this.gather(spot);
    }
    // the camera starts in front, a little to one side, so you see the company; it drifts round from there
    this.camOrbit = spot.yaw + Math.PI + 0.6;
    this.camPitch = 0.18;
    this.camDist = 5.5;
    this.idleT = 0;
    this.frame(spot);

    if (this.audio) this.audio.pickup();
    this.hud.notify(`☕ KOLKATA ADDA: ${spot.name.toUpperCase()}`, `${spot.desc} · +Health & Sunset View`, '#5dff9e');
    if (player.game && player.game.progress) player.game.progress.event('adda');
  }

  /** Stop Adda mode: player stands up */
  stop(player) {
    if (!this.active) return;
    this.active = false;
    this.currentSpot = null;
    if (player.mode === 'adda') {
      player.mode = 'foot';
      player.ch.mode = 'move';
      player.ch.poseFn = null;
      // Step slightly forward off the bench
      const fwdX = Math.sin(player.yaw) * 0.8;
      const fwdZ = Math.cos(player.yaw) * 0.8;
      player.pos.x += fwdX;
      player.pos.z += fwdZ;
    }
    this.hud.notify('STAND UP', 'Refreshed from Adda · Time returned to normal', '#ffffff');
  }

  /** Update active Adda state: heal, cinematic camera, dialogue snippets, time acceleration */
  update(dt, elapsed, game, input) {
    const player = game.player;
    if (!this.active || player.mode !== 'adda') {
      this.active = false;
      return;
    }

    const spot = this.currentSpot;
    if (!spot) {
      this.stop(player);
      return;
    }

    // 2. Health regeneration: +14 HP/second while relaxing at Adda
    if (player.hp < 100) {
      player.hp = Math.min(100, player.hp + 14 * dt);
    }

    // 3. Keep character seated facing the vista, and the company going
    player.pos.set(spot.x, spot.y, spot.z);
    player.yaw = spot.yaw;
    this.place(player.ch, spot, -0.45, 0, spot.yaw, true);
    player.ch.update(dt, elapsed);

    // 4. HUD prompt to exit
    player.prompt = { key: 'E', text: 'Stand Up', key2: 'MOUSE', text2: 'Look Around', key3: 'SCROLL', text3: 'Zoom' };

    // 5. Exit triggers: E, W, A, S, D, Space, or F
    if (input.hit('KeyE') || input.hit('KeyF') || input.hit('Space') ||
        input.keys.has('KeyW') || input.keys.has('KeyS') || input.keys.has('KeyA') || input.keys.has('KeyD')) {
      this.stop(player);
      return;
    }

    // 6. Occasional authentic Bengali Adda dialogue snippet
    this.dialogueTimer -= dt;
    if (this.dialogueTimer <= 0) {
      this.dialogueTimer = 5.5 + Math.random() * 3.5;
      // whoever's turn it is: the friend, the uncle, now and then the chaiwala, sometimes you
      const r = Math.random();
      const who = r < 0.15 ? player.ch : this.crowd[r < 0.3 ? 2 : r < 0.65 ? 0 : 1]?.ch || player.ch;
      const vendor = this.crowd[2] && who === this.crowd[2].ch;
      const lines = vendor ? VENDOR_LINES : ADDA_DIALOGUES;
      this.hud.say(who, lines[Math.floor(Math.random() * lines.length)], 3.8);
    }

    // 7. The camera: the mouse looks round the bench and the wheel zooms; left alone, it drifts slowly round
    const { dx, dy } = input.mouse;
    if (dx || dy) {
      this.camOrbit -= dx * 0.004;
      this.camPitch = clamp(this.camPitch + dy * 0.003, -0.05, 1.2);
      this.idleT = 4;
    }
    if (input.wheelSteps) this.camDist = clamp(this.camDist + input.wheelSteps * 0.8, 2.5, 10);
    if (this.idleT > 0) this.idleT -= dt;
    else this.camOrbit += dt * 0.05;
    this.frame(spot);
  }
}
