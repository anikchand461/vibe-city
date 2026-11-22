import * as THREE from 'three';
import { damp, dampAngle, paint, merge } from './utils.js';

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
  { id: 'howrah', name: 'Howrah Riverfront Forecourt', x: -1360, z: -1750, yaw: -Math.PI / 2, desc: 'Bustling chai stalls under Howrah Bridge' },
  { id: 'millennium', name: 'Millennium Park Promenade', x: -1460, z: -779, yaw: Math.PI / 2, desc: 'Riverside promenade & passing steamers' },
  { id: 'collegesq', name: 'College Square Heritage Tank', x: 543, z: -935, yaw: 0, desc: 'Historic swimming tank & student adda' },
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
  }

  buildSpots() {
    const benchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const stallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

    for (const def of ADDA_SPOTS) {
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
    this.camOrbit = spot.yaw;

    player.mode = 'adda';
    player.pos.set(spot.x, spot.y + 0.02, spot.z);
    player.yaw = spot.yaw;
    player.ch.mode = 'sit';
    player.ch.mesh.position.copy(player.pos);
    player.ch.mesh.rotation.set(0, player.yaw, 0);

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

    // 3. Keep character seated facing the vista
    player.ch.mode = 'sit';
    player.pos.set(spot.x, spot.y + 0.02, spot.z);
    player.yaw = spot.yaw;
    player.ch.mesh.position.copy(player.pos);
    player.ch.mesh.rotation.set(0, player.yaw, 0);
    player.ch.update(dt, elapsed);

    // 4. HUD prompt to exit
    player.prompt = { key: 'E', text: 'Stand Up · Watching the city', key2: 'WASD', text2: 'Move to Exit' };

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
      const text = ADDA_DIALOGUES[Math.floor(Math.random() * ADDA_DIALOGUES.length)];
      this.hud.say(player.ch, text, 3.8);
    }

    // 7. Cinematic slow camera orbit framing the scenery
    this.camOrbit += dt * 0.05;
    const camDist = 5.5;
    const camH = 1.9;
    const cx = spot.x - Math.sin(this.camOrbit) * camDist;
    const cz = spot.z - Math.cos(this.camOrbit) * camDist;
    const cy = spot.y + camH;

    if (game.cam) {
      game.cam.pos.set(cx, cy, cz);
      game.cam.look.set(spot.x, spot.y + 0.9, spot.z);
    }
  }
}
