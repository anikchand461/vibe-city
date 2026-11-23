import * as THREE from 'three';
import * as T from './textures.js';
import { TYPES } from './car.js';
import { clamp } from './utils.js';

/*
 * Combat: hitscan bullets against people, vehicles, trains and the city;
 * tracers, decals (bullet holes, blood, scorch marks), muzzle and blast lights,
 * and explosions with area damage.
 */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/* ---------- Ray helpers ---------- */
function rayBox(o, d, b) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const ox = o.x - b.x;
  const oy = o.y - b.y;
  const oz = o.z - b.z;
  const lo = [ox * c - oz * s, oy, ox * s + oz * c];
  const ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c];
  const ext = [b.hw, b.hh, b.hl];
  let t0 = -Infinity;
  let t1 = Infinity;
  let axis = 0;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < -ext[i] || lo[i] > ext[i]) return null;
      continue;
    }
    let ta = (-ext[i] - lo[i]) / ld[i];
    let tb = (ext[i] - lo[i]) / ld[i];
    let sg = -1;
    if (ta > tb) {
      [ta, tb] = [tb, ta];
      sg = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = i;
      sign = sg;
    }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  // local normal back to world
  const ln = [0, 0, 0];
  ln[axis] = sign;
  return { t: Math.max(0, t0), nx: ln[0] * c + ln[2] * s, ny: ln[1], nz: -ln[0] * s + ln[2] * c };
}

function rayCyl(o, d, cx, cz, r, y0, y1) {
  const fx = o.x - cx;
  const fz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return -1;
  const b = fx * d.x + fz * d.z;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / a, (-b + sq) / a]) {
    if (t < 0) continue;
    const y = o.y + d.y * t;
    if (y >= y0 && y <= y1) return t;
  }
  return -1;
}

/* ---------- Decals (instanced quads) ---------- */
class Decals {
  constructor(scene, max, mat) {
    this.max = max;
    this.idx = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.growing = [];
  }
  add(x, y, z, nx, ny, nz, size, grow = 0) {
    const i = this.idx;
    this.idx = (this.idx + 1) % this.max;
    _v.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(Z, _v);
    // random spin about the normal
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.random() * Math.PI * 2));
    const p = new THREE.Vector3(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    const rec = { i, p, q: _q.clone(), s: grow ? size * 0.2 : size, target: size, grow };
    this.growing = this.growing.filter((g) => g.i !== i);
    if (grow) this.growing.push(rec);
    this.set(rec);
  }
  set(r) {
    _m.compose(r.p, r.q, _s.set(r.s, r.s, r.s));
    this.mesh.setMatrixAt(r.i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    for (let k = this.growing.length - 1; k >= 0; k--) {
      const r = this.growing[k];
      r.s = Math.min(r.target, r.s + r.grow * dt);
      this.set(r);
      if (r.s >= r.target) this.growing.splice(k, 1);
    }
  }
}

function decalMat(color, opacity) {
  return new THREE.MeshBasicMaterial({ map: T.glow(), color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
}

/* ---------- Tracers: short bright streaks flying down the bullet path ---------- */
const TRACER_MAX = 64;
const TRACER_SPEED = 420;
class Tracers {
  constructor(scene) {
    this.pos = new Float32Array(TRACER_MAX * 6);
    this.col = new Float32Array(TRACER_MAX * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);
    this.list = [];
  }
  add(a, b) {
    const len = a.distanceTo(b);
    if (len < 1) return;
    if (this.list.length >= TRACER_MAX) this.list.shift();
    this.list.push({ a: a.clone(), d: b.clone().sub(a).divideScalar(len), len, t: 0 });
  }
  update(dt) {
    let n = 0;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const tr = this.list[k];
      tr.t += dt;
      // The streak flies down the path; it's gone once its tail passes the hit point
      const head = Math.min(tr.len, tr.t * TRACER_SPEED);
      const tail = Math.max(0, tr.t * TRACER_SPEED - 9);
      if (tail >= tr.len - 0.01) {
        this.list.splice(k, 1);
        continue;
      }
      const j = n * 6;
      for (let e = 0; e < 2; e++) {
        const s = e ? head : tail;
        this.pos[j + e * 3] = tr.a.x + tr.d.x * s;
        this.pos[j + e * 3 + 1] = tr.a.y + tr.d.y * s;
        this.pos[j + e * 3 + 2] = tr.a.z + tr.d.z * s;
        const k2 = e ? 1 : 0.15;
        this.col[j + e * 3] = 2.4 * k2;
        this.col[j + e * 3 + 1] = 1.7 * k2;
        this.col[j + e * 3 + 2] = 0.8 * k2;
      }
      n++;
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, n * 2);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

/* =========================================================
   Combat
   ========================================================= */
export class Combat {
  constructor(scene, world, fx, audio, game) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.game = game;
    this.holes = new Decals(scene, 260, decalMat(0x0b0b0b, 0.9));
    this.blood = new Decals(scene, 60, decalMat(0x4a0404, 0.85));
    this.scorch = new Decals(scene, 24, decalMat(0x050403, 0.85));
    this.tracers = new Tracers(scene);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.blastLight = new THREE.PointLight(0xff8a3a, 0, 60, 1.6);
    scene.add(this.muzzleLight, this.blastLight);
    this.boxes = [];
  }

  /** Distance from the listener (camera focus) for sound attenuation. */
  hearDist(x, z) {
    const f = this.game.player.focus;
    return Math.hypot(x - f.x, z - f.z);
  }

  /**
   * Ray against everything shootable. opts: { minT, ignore (a vehicle), skipPeds }
   */
  raycast(o, d, maxT, opts = {}) {
    const minT = opts.minT || 0;
    const g = this.game;
    // Underground: tunnel walls, floor and ceiling bound the shot
    const metro = o.y < -2.5 ? this.world.under : null;
    if (metro) {
      const c = metro.ceilingAt(o.x, o.z, o.y);
      if (d.y > 1e-4) maxT = Math.min(maxT, (c - o.y) / d.y);
    }
    let best = { t: maxT, type: null };
    // People
    if (!opts.skipPeds) {
      for (const n of g.peds.list) {
        if (!n.ch.mesh.visible) continue;
        const lying = n.ch.mode === 'down';
        const sc = n.ch.look.scale || 1;
        const t = lying ? rayCyl(o, d, n.x, n.z, 0.85, n.y, n.y + 0.45) : rayCyl(o, d, n.x, n.z, 0.3, n.y, n.y + 1.8 * sc);
        if (t >= minT && t < best.t) {
          const hy = o.y + d.y * t;
          best = { t, type: 'ped', target: n, head: !lying && hy > n.y + 1.52 * sc, nx: -d.x, ny: 0, nz: -d.z };
        }
      }
    }
    // Vehicles, traffic and rail cars as oriented boxes
    const boxes = this.boxes;
    boxes.length = 0;
    for (const v of g.vehicles) {
      if (v === opts.ignore) continue;
      const D = v.def;
      boxes.push({ x: v.pos.x, y: v.pos.y + v.hy + D.h / 2, z: v.pos.z, yaw: v.yaw, hw: D.hw, hh: D.h / 2, hl: D.hl, vehicle: v });
    }
    for (const c of g.traffic.cars) {
      const D = TYPES[c.type];
      boxes.push({ x: c.x, y: D.h / 2, z: c.z, yaw: c.yaw, hw: D.hw, hh: D.h / 2, hl: D.hl, traffic: c });
    }
    g.rail.boxes(boxes);
    for (const b of boxes) {
      if (b.rail && b.rail === opts.ignore) continue;
      const dx = b.x - o.x;
      const dz = b.z - o.z;
      const along = dx * d.x + dz * d.z;
      if (along < -b.hl - 2 || along > best.t + b.hl + 2) continue;
      const h = rayBox(o, d, b);
      if (h && h.t >= minT && h.t < best.t) best = { t: h.t, type: b.vehicle ? 'vehicle' : b.traffic ? 'traffic' : 'rail', target: b.vehicle || b.traffic || b.rail, nx: h.nx, ny: h.ny, nz: h.nz };
    }
    // Buildings, poles and palm trunks (or tunnel walls)
    const ex = o.x + d.x * best.t;
    const ez = o.z + d.z * best.t;
    const w = (metro || this.world).raycastHit(o.x, o.z, ex, ez);
    if (w) {
      const t = w.t * best.t;
      const y = o.y + d.y * t;
      if (t >= minT && (metro || (y > -0.5 && y < 60))) best = { t, type: 'world', nx: w.nx, ny: 0, nz: w.nz };
    }
    // Hitting the tunnel ceiling
    if (metro && !best.type && d.y > 1e-4) best = { t: best.t, type: 'world', nx: 0, ny: -1, nz: 0 };
    // Ground
    if (d.y < -1e-4) {
      let t = (o.y - (metro ? o.y - 1.5 : 0.1)) / -d.y;
      if (t < best.t) {
        const gy = this.world.groundAt(o.x + d.x * t, o.z + d.z * t, o.y);
        t = (o.y - gy) / -d.y;
        if (t >= minT && t < best.t) best = { t, type: 'ground', nx: 0, ny: 1, nz: 0 };
      }
    }
    best.x = o.x + d.x * best.t;
    best.y = o.y + d.y * best.t;
    best.z = o.z + d.z * best.t;
    return best;
  }

  /** Apply one bullet's effect at a hit. Returns 'kill' | 'hit' | null. */
  applyHit(hit, w, d, shooter) {
    const g = this.game;
    const dist = this.hearDist(hit.x, hit.z);
    switch (hit.type) {
      case 'ped': {
        const n = hit.target;
        const dmg = w.dmg * (hit.head ? w.head || 2 : 1);
        this.fx.blood(hit.x, hit.y, hit.z, d.x, d.z, hit.head ? 1.6 : 1);
        if (n.state === 'dead') return null;
        const killed = g.peds.damage(n, dmg, d.x * 3, d.z * 3, shooter, 'bullet', hit.head);
        this.audio.hitFlesh(false);
        if (killed) this.blood.add(n.x - d.x * 0.3, n.y + 0.03, n.z - d.z * 0.3, 0, 1, 0, 1.8 + Math.random(), 0.6);
        return killed ? 'kill' : 'hit';
      }
      case 'vehicle':
        hit.target.damage(w.dmg * 0.3);
        this.fx.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, true);
        this.audio.metalHit(dist);
        return 'veh';
      case 'traffic': {
        // The driver stops and bails out; the car becomes a free physics vehicle
        const c = hit.target;
        const v = g.adoptTrafficCar(c, c.vel.clone().multiplyScalar(0.5), 0);
        v.damage(w.dmg * 0.3);
        const door = v.local(v.def.hw + 0.6, v.def.seatZ);
        g.peds.spawnEjected(door.x, door.z, v.yaw, g.player.focus);
        this.fx.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, true);
        this.audio.metalHit(dist);
        return 'veh';
      }
      case 'rail':
        this.fx.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, true);
        this.audio.metalHit(dist);
        return null;
      case 'world':
      case 'ground':
        this.fx.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, false);
        this.holes.add(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.13 + Math.random() * 0.05);
        this.audio.ricochet(dist);
        return null;
      default:
        return null;
    }
  }

  flash(p, big) {
    this.muzzleLight.position.copy(p);
    this.muzzleLight.intensity = big ? 60 : 30;
  }

  /** Player shot along the camera's aim. Returns the strongest result for the hit marker. */
  playerFire(w, camera, muzzle, player) {
    const g = this.game;
    const o = camera.position;
    const aimDir = camera.getWorldDirection(new THREE.Vector3());
    // Skip the stretch between the camera and the player's shoulder
    const chest = new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z);
    const minT = Math.max(0, chest.sub(o).dot(aimDir)) + 0.5;
    const spread = player.aiming ? w.aim : w.spread;
    let result = null;
    for (let p = 0; p < (w.pellets || 1); p++) {
      const d = aimDir.clone();
      if (spread > 0) {
        d.x += (Math.random() - 0.5) * 2 * spread;
        d.y += (Math.random() - 0.5) * 2 * spread;
        d.z += (Math.random() - 0.5) * 2 * spread;
        d.normalize();
      }
      const hit = this.raycast(o, d, minT + w.range, { minT, ignore: player.vehicle });
      const end = new THREE.Vector3(hit.x, hit.y, hit.z);
      if (p < 3) this.tracers.add(muzzle, end);
      const r = hit.type ? this.applyHit(hit, w, d, player.pos) : null;
      if (r === 'kill' || (r === 'hit' && result !== 'kill')) result = r;
    }
    const fd = aimDir;
    this.fx.muzzle(muzzle.x, muzzle.y, muzzle.z, fd.x, fd.y, fd.z, w.pellets || w.scope);
    this.flash(muzzle, w.pellets || w.scope);
    this.audio.gunshot(w.sound, 0);
    g.peds.panic(player.pos.x, player.pos.z, w.scope ? 60 : 38, true, true);
    g.traffic.panic(player.pos.x, player.pos.z, 45);
    return result;
  }

  /** A gun-toting pedestrian shooting at the player. */
  npcFire(n, muzzle, w, chance) {
    const g = this.game;
    const pl = g.player;
    const tgt = pl.vehicle && pl.mode === 'driving' ? pl.vehicle.pos : pl.pos;
    const aim = new THREE.Vector3(tgt.x, tgt.y + (pl.mode === 'driving' ? 1.0 : 1.3), tgt.z);
    const hitIt = Math.random() < chance;
    if (!hitIt) {
      aim.x += (Math.random() - 0.5) * 3;
      aim.y += (Math.random() - 0.3) * 1.5;
      aim.z += (Math.random() - 0.5) * 3;
    }
    const d = aim.clone().sub(muzzle);
    const dist = d.length();
    d.divideScalar(dist);
    let end;
    if (hitIt) {
      // Something solid in the way?
      const block = this.raycast(muzzle, d, dist, { skipPeds: true, ignore: pl.mode === 'driving' ? pl.vehicle : null });
      if (block.type && block.type !== 'ground') {
        end = new THREE.Vector3(block.x, block.y, block.z);
        this.applyHit(block, w, d, null);
      } else {
        end = aim;
        if (pl.mode === 'driving') {
          pl.vehicle.damage(w.dmg * 0.35);
          this.fx.impact(aim.x, aim.y, aim.z, -d.x, -d.y, -d.z, true);
          this.audio.metalHit(0);
        } else {
          pl.hurt(w.dmg * 0.3, n.x, n.z);
          this.fx.blood(aim.x, aim.y, aim.z, d.x, d.z, 0.6);
        }
      }
    } else {
      const hit = this.raycast(muzzle, d, 90, { skipPeds: true, ignore: pl.mode === 'driving' ? pl.vehicle : null });
      end = new THREE.Vector3(hit.x, hit.y, hit.z);
      if (hit.type) this.applyHit(hit, w, d, null);
    }
    this.tracers.add(muzzle, end);
    this.fx.muzzle(muzzle.x, muzzle.y, muzzle.z, d.x, d.y, d.z, false);
    this.flash(muzzle, false);
    this.audio.gunshot(w.sound, this.hearDist(n.x, n.z));
    g.peds.panic(n.x, n.z, 25, false, true);
  }

  /** Explosion with area damage, knockback and a scorch mark. */
  explode(x, y, z, size = 1, source = null) {
    const g = this.game;
    const R = 10 * size;
    this.fx.explosion(x, y, z, size);
    this.blastLight.position.set(x, y + 2, z);
    this.blastLight.intensity = 900 * size;
    this.scorch.add(x, this.world.height(x, z) + 0.02, z, 0, 1, 0, 7 * size);
    const dist = this.hearDist(x, z);
    this.audio.explosion(dist);
    g.shake(clamp(1.2 - dist / 60, 0, 1));
    const pl = g.player;
    // The vehicle that blew up
    if (source) {
      source.pop(5 + Math.random() * 3);
      source.angVel += (Math.random() - 0.5) * 3;
      if (pl.vehicle === source && (pl.mode === 'driving' || pl.mode === 'entering')) pl.blastOut(source);
    }
    // People
    for (const n of g.peds.list) {
      if (n.state === 'dead') continue;
      const dx = n.x - x;
      const dz = n.z - z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = 1 - d / R;
      const l = d || 1;
      g.peds.damage(n, 280 * k, (dx / l) * 14 * k, (dz / l) * 14 * k, null, 'blast');
    }
    g.peds.panic(x, z, 60, true, true);
    g.traffic.panic(x, z, 60);
    // Player on foot
    if (pl.mode === 'foot') {
      const dx = pl.pos.x - x;
      const dz = pl.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        const k = 1 - d / R;
        const l = d || 1;
        pl.hurt(170 * k, x, z);
        if (k > 0.25) pl.knockDown((dx / l) * 12 * k, (dz / l) * 12 * k);
      }
    }
    // Other vehicles (chain reactions)
    for (const v of g.vehicles) {
      if (v === source) continue;
      const dx = v.pos.x - x;
      const dz = v.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = 1 - d / R;
      const l = d || 1;
      const m = Math.sqrt(v.def.mass);
      v.damage((150 * k) / m);
      v.vel.x += ((dx / l) * 14 * k) / m;
      v.vel.y += ((dz / l) * 14 * k) / m;
      v.angVel += ((Math.random() - 0.5) * 4 * k) / m;
      v.pop((6 * k) / m);
    }
    for (const c of [...g.traffic.cars]) {
      const dx = c.x - x;
      const dz = c.z - z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = 1 - d / R;
      const l = d || 1;
      const m = Math.sqrt(c.def.mass);
      const v = g.adoptTrafficCar(c, new THREE.Vector2(((dx / l) * 14 * k) / m, ((dz / l) * 14 * k) / m), (Math.random() - 0.5) * 3 * k);
      v.damage((150 * k) / m);
      v.pop((6 * k) / m);
    }
  }

  update(dt) {
    this.tracers.update(dt);
    this.blood.update(dt);
    this.muzzleLight.intensity *= Math.exp(-40 * dt);
    this.blastLight.intensity *= Math.exp(-5 * dt);
  }
}
