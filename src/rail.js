import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';
import { Buf, ribbon, flatPoly, inTiles } from './world.js';
import { MAP, nodeXZ, polygon, inPoly, offsetLine, Poly, nearestOnRing, Grid } from './geo.js';
import { buildIndianCar, buildCatenary } from './trains.js';
import { merge, clamp, damp, lerp } from './utils.js';
import { crashDamage } from './car.js';

/*
 * Rail transport on Kolkata's real tracks: trams under their overhead wires,
 * EMU locals and a Rajdhani out of Howrah and Sealdah, and a Circular Railway
 * local along the river. All shuttle between stops on their own, and the
 * player can take the controls.
 */

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rbox = (w, h, d, x, y, z, r = 0.08) => new RoundedBoxGeometry(w, h, d, 3, r).translate(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);
function rod(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

/* ---------- Track: a polyline resampled every STEP metres ---------- */
const STEP = 0.5;
export class Track {
  constructor(corners, radius) {
    // Round each interior corner with a quadratic curve
    const pts = [corners[0]];
    for (let i = 1; i < corners.length - 1; i++) {
      const [a, p, b] = [corners[i - 1], corners[i], corners[i + 1]];
      const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const r = Math.min(radius, la / 2, lb / 2);
      const s = [p[0] - ((p[0] - a[0]) / la) * r, p[1] - ((p[1] - a[1]) / la) * r];
      const e = [p[0] + ((b[0] - p[0]) / lb) * r, p[1] + ((b[1] - p[1]) / lb) * r];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const u = 1 - t;
        pts.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
      }
    }
    pts.push(corners[corners.length - 1]);
    this.x = [];
    this.z = [];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      let d = carry;
      while (d < l) {
        this.x.push(ax + ((bx - ax) * d) / l);
        this.z.push(az + ((bz - az) * d) / l);
        d += STEP;
      }
      carry = d - l;
    }
    const last = pts[pts.length - 1];
    this.x.push(last[0]);
    this.z.push(last[1]);
    this.len = (this.x.length - 1) * STEP;
  }
  at(s, out) {
    const f = clamp(s, 0, this.len) / STEP;
    const i = Math.min(Math.floor(f), this.x.length - 2);
    const t = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    out.tx = this.x[i + 1] - this.x[i];
    out.tz = this.z[i + 1] - this.z[i];
    return out;
  }
  nearest(x, z) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.x.length; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best * STEP;
  }
}

/** Boxes laid along the track every `step` metres (rails, ballast, sleepers). */
export function alongTrack(track, step, make) {
  const out = [];
  const p = {};
  const q = {};
  for (let s = 0; s < track.len - 1e-3; s += step) {
    const e = Math.min(track.len, s + step);
    track.at(s, p);
    track.at(e, q);
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const yaw = Math.atan2(q.x - p.x, q.z - p.z);
    for (const g of make(len)) {
      g.rotateY(yaw);
      g.translate((p.x + q.x) / 2, 0, (p.z + q.z) / 2);
      out.push(g);
    }
  }
  return out;
}

export function signTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#123a6b';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffffff';
  g.font = 'bold 58px Arial';
  g.textAlign = 'center';
  g.fillText(text, 256, 66);
  g.font = '600 26px Arial';
  g.fillStyle = '#9fd8ff';
  g.fillText(sub, 256, 106);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- Rolling stock ---------- */
// body: paint for the whole shell (null = stainless steel); color: the livery stripe
export const KINDS = {
  tram: { label: 'Kolkata Tram', L: 9.6, gap: 0.6, cars: 2, hw: 1.2, floor: 0.35, roof: 3.35, base: 0.3, top: 11, accel: 1.1, dec: 1.8, y: 0, seatY: -0.1, camDist: 12, camH: 4, engine: 0.7, color: 0x1f56b8, body: 0xf1efe8, look: 22 },
  metro: { label: 'Kolkata Metro', L: 19, gap: 0.7, cars: 4, hw: 1.4, floor: 0.93, roof: 3.7, base: 0.3, top: 22, accel: 1.3, dec: 1.7, y: -11.88, seatY: 0.55, camDist: 5, camH: 0.6, engine: 0.85, color: 0x1f4fbf, look: 30, under: true, doors: true },
  train: { label: 'EMU Local', L: 20, gap: 0.9, cars: 6, hw: 1.6, floor: 1.15, roof: 4.1, base: 0.75, top: 22, accel: 0.9, dec: 1.1, y: 0.3, seatY: 0.62, camDist: 26, camH: 8, engine: 0.45, color: 0xb8322a, look: 70 },
  express: { label: 'Rajdhani Express', L: 22, gap: 1.0, cars: 8, hw: 1.6, floor: 1.2, roof: 4.2, base: 0.75, top: 26, accel: 0.6, dec: 0.9, y: 0.3, seatY: 0.62, camDist: 30, camH: 9, engine: 0.4, color: 0xd8c690, body: 0xa8322b, look: 80 },
};

let RM = null;
export function railMats() {
  if (RM) return RM;
  RM = {
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.35, metalness: 0.15 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0c1218, metalness: 0.9, roughness: 0.06 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8b8e93, roughness: 0.35, metalness: 0.9 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a2a, emissiveIntensity: 0.6 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.9 }),
    ballast: new THREE.MeshStandardMaterial({ color: 0x8a7f72, map: T.asphalt(false).map, roughness: 1 }),
    sleeper: new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.6 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.6 }),
  };
  return RM;
}

let TB = null;
function tramBoard() {
  if (TB) return TB;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = '#16233d';
  g.fillRect(0, 0, 256, 56);
  g.fillStyle = '#ffffff';
  g.fillRect(6, 8, 40, 40);
  g.fillStyle = '#16233d';
  g.font = 'bold 34px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('5', 26, 30);
  g.fillStyle = '#ffffff';
  g.font = 'bold 19px Arial';
  g.fillText('SHYAMBAZAR', 150, 18);
  g.fillText('ESPLANADE', 150, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  TB = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.6 });
  return TB;
}

const bodyMats = new Map();
function bodyMat(c) {
  if (!bodyMats.has(c)) bodyMats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.2 }));
  return bodyMats.get(c);
}

/** One rail car. cabF / cabB put a sloped driver's cab on the front / back end. */
function buildRailCar(kind, cabF, cabB, paint, middle, index = 0) {
  if (kind === 'train' || kind === 'express' || kind === 'tram') return buildIndianCar(kind, KINDS[kind], cabF, cabB, index);
  const K = KINDS[kind];
  const M = railMats();
  const { L, hw, base, roof, floor } = K;
  const W = hw * 2;
  const h2 = L / 2;
  // Kolkata trams and EMUs have flat, upright fronts
  const nose = kind === 'tram' ? 0.15 : kind === 'metro' ? 0.7 : kind === 'express' ? 2.2 : 0.3;
  const s = new THREE.Shape();
  const lo = base;
  s.moveTo(-h2 + (cabB ? nose * 0.5 : 0), lo);
  s.lineTo(h2 - (cabF ? nose * 0.5 : 0), lo);
  if (cabF) {
    s.lineTo(h2, lo + 0.45);
    s.lineTo(h2 + 0.05, floor + 0.9);
    s.quadraticCurveTo(h2 - nose * 0.2, roof - 0.3, h2 - nose, roof);
  } else {
    s.lineTo(h2, lo);
    s.lineTo(h2, roof);
  }
  if (cabB) {
    s.lineTo(-h2 + nose, roof);
    s.quadraticCurveTo(-h2 + nose * 0.2, roof - 0.3, -h2 - 0.05, floor + 0.9);
    s.lineTo(-h2, lo + 0.45);
  } else {
    s.lineTo(-h2, roof);
    s.lineTo(-h2, lo);
  }
  s.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: W - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3, curveSegments: 12 });
  bodyGeo.translate(0, 0, -(W - 0.16) / 2);
  bodyGeo.rotateY(-Math.PI / 2);

  const glass = [];
  const dark = [];
  const winLo = floor + 0.85;
  const winHi = roof - 0.55;
  const winY = (winLo + winHi) / 2;
  const winH = winHi - winLo;
  const span = L - (cabF ? nose + 1.2 : 0.6) - (cabB ? nose + 1.2 : 0.6);
  const zc = ((cabB ? nose + 1.2 : 0.6) - (cabF ? nose + 1.2 : 0.6)) / 2;
  const metro = kind === 'metro';
  // Kolkata Metro rakes: four sliding doorways a side
  const doors = kind === 'tram' ? [-L / 4, L / 4] : metro ? [-L * 0.36, -L * 0.12, L * 0.12, L * 0.36] : [-L / 3, L / 3];
  const dy0 = floor + 0.05;
  const dy1 = roof - 0.5;
  const leaves = metro ? { 1: { 1: [], [-1]: [] }, [-1]: { 1: [], [-1]: [] } } : null;
  const inside = [];
  for (const sx of [1, -1]) {
    glass.push(box(0.03, winH, span, sx * (hw + 0.005), winY, zc));
    const nm = Math.floor(span / 1.4);
    for (let i = 0; i <= nm; i++) dark.push(box(0.035, winH, 0.07, sx * (hw + 0.008), winY, zc - span / 2 + (i * span) / nm));
    for (const dz of doors) {
      if (metro) {
        // the lit carriage seen through an open doorway, a frame round it, and two leaves
        inside.push(box(0.02, dy1 - dy0, 1.3, sx * (hw + 0.018), (dy0 + dy1) / 2, dz));
        dark.push(box(0.03, dy1 - dy0 + 0.08, 0.06, sx * (hw + 0.02), (dy0 + dy1) / 2, dz - 0.68), box(0.03, dy1 - dy0 + 0.08, 0.06, sx * (hw + 0.02), (dy0 + dy1) / 2, dz + 0.68));
        dark.push(box(0.03, 0.06, 1.42, sx * (hw + 0.02), dy1 + 0.04, dz));
        for (const dir of [1, -1]) leaves[sx][dir].push(box(0.04, dy1 - dy0, 0.65, sx * (hw + 0.058), (dy0 + dy1) / 2, dz + dir * 0.325));
        continue;
      }
      glass.push(box(0.03, roof - 0.5 - (floor + 0.05), 1.3, sx * (hw + 0.012), (roof - 0.5 + floor + 0.05) / 2, dz));
      dark.push(box(0.036, roof - 0.5 - floor, 0.04, sx * (hw + 0.014), (roof - 0.5 + floor) / 2, dz));
    }
    if (cabF) glass.push(box(0.03, winH * 0.8, 0.7, sx * (hw + 0.005), winY, h2 - nose - 0.4));
    if (cabB) glass.push(box(0.03, winH * 0.8, 0.7, sx * (hw + 0.005), winY, -h2 + nose + 0.4));
  }
  const head = [];
  const tail = [];
  const cabEnd = (sign) => {
    // windscreen following the nose curve
    const z0 = sign * (h2 - 0.02);
    const z1 = sign * (h2 - nose * 0.85);
    const y0 = floor + 1.0;
    const y1 = roof - 0.15;
    const len = Math.hypot(z1 - z0, y1 - y0);
    const g = new THREE.BoxGeometry(W - 0.5, len, 0.04);
    g.rotateX(sign * -Math.atan2(Math.abs(z0 - z1), y1 - y0));
    g.translate(0, (y0 + y1) / 2, (z0 + z1) / 2 + sign * 0.06);
    glass.push(g);
    for (const sx of [1, -1]) {
      head.push(box(0.32, 0.14, 0.06, sx * (hw - 0.4), lo + 0.75, sign * (h2 + 0.03)));
      tail.push(box(0.14, 0.14, 0.06, sx * (hw - 0.12), lo + 0.75, sign * (h2 + 0.02)));
    }
    dark.push(box(W - 0.3, 0.25, 0.15, 0, lo + 0.15, sign * (h2 - 0.05)));
  };
  if (cabF) cabEnd(1);
  if (cabB) cabEnd(-1);
  // Bogies and wheels
  const bz = h2 - (kind === 'tram' ? 1.7 : kind === 'metro' ? 2.2 : 2.6);
  const wheels = [];
  for (const z of [bz, -bz]) {
    dark.push(box(W - 0.5, 0.35, 2.6, 0, kind === 'tram' ? 0.32 : 0.55, z));
    for (const dz of [-0.85, 0.85]) {
      for (const sx of [1, -1]) wheels.push(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16).rotateZ(Math.PI / 2).translate(sx * 0.72, 0.42 - (kind === 'tram' ? 0.12 : 0), z + dz));
    }
  }
  if (kind !== 'tram') {
    dark.push(box(W - 0.7, 0.5, L * 0.35, 0, 0.75, 0));
  }
  // Gangway / articulation bellows behind this car
  if (!cabB) dark.push(box(W - 0.35, roof - floor - 0.3, K.gap + 0.1, 0, (roof + floor) / 2, -h2 - K.gap / 2));
  // Roof gear
  const roofGeo = [];
  if (kind !== 'tram') roofGeo.push(rbox(1.6, 0.32, 2.4, 0, roof + 0.15, L * 0.22), rbox(1.6, 0.32, 2.4, 0, roof + 0.15, -L * 0.22));
  else roofGeo.push(rbox(1.5, 0.35, 3.2, 0, roof + 0.17, 0));
  const panto = [];
  if (kind === 'tram' && middle) {
    // Pantograph reaching up to the contact wire at 6 m
    const py = roof + 0.35;
    panto.push(rod([0.45, py, -0.6], [0.0, py + 1.25, 0.25], 0.03), rod([-0.45, py, -0.6], [0.0, py + 1.25, 0.25], 0.03), rod([0, py + 1.25, 0.25], [0.0, 5.95, -0.2], 0.03), box(1.5, 0.05, 0.08, 0, 5.98, -0.2));
  }
  // Livery: a stripe; the tram's whole lower body is blue, the metro gets a deep band
  const stripe = [];
  const front = [];
  const sh = kind === 'tram' ? floor + 0.95 : kind === 'metro' ? 0.55 : 0.32;
  const sy = kind === 'tram' ? (base + floor + 0.95) / 2 + 0.02 : floor + 0.45;
  const sl = L - (cabF ? 0.2 : 0) - (cabB ? 0.2 : 0);
  for (const sx of [1, -1]) stripe.push(box(0.02, kind === 'tram' ? floor + 0.95 - base : sh, sl, sx * (hw + 0.008), sy, ((cabB ? 0.2 : 0) - (cabF ? 0.2 : 0)) / 2));
  for (const sign of [cabF ? 1 : 0, cabB ? -1 : 0].filter(Boolean)) {
    const z = sign * (h2 + 0.06);
    if (kind === 'tram') {
      // blue apron with the white chevron
      stripe.push(box(W - 0.1, floor + 0.95 - base, 0.04, 0, sy, z));
      for (const s of [1, -1]) front.push(box(0.12, 0.85, 0.02, 0, 0, 0).rotateZ(s * 1.05).translate(s * 0.42, floor + 0.55, z + sign * 0.03));
    } else if (kind === 'train') {
      // the yellow cab front of a Kolkata EMU, with its two windows
      const fz = sign * (h2 + 0.01);
      front.push(box(W - 0.06, roof - base - 0.15, 0.04, 0, (roof + base) / 2, fz));
      for (const s of [1, -1]) glass.push(box(W * 0.36, 0.95, 0.02, s * W * 0.22, roof - 1.05, fz + sign * 0.035));
    } else if (kind === 'metro') {
      front.push(box(W - 0.1, roof - floor - 0.5, 0.05, 0, (roof + floor) / 2 - 0.2, z - sign * 0.3));
    }
  }

  const root = new THREE.Group();
  const add = (geo, mat) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  add(bodyGeo, K.body !== undefined ? bodyMat(K.body) : M.silver);
  add(merge(glass), M.glass);
  add(merge([...dark, ...roofGeo]), M.dark);
  add(merge(wheels), M.steel);
  add(merge(stripe), paint);
  if (front.length) add(merge(front), kind === 'train' ? bodyMat(0xf2c21b) : bodyMat(0xf4f4f0));
  if (panto.length) add(merge(panto), M.wire);
  // red roof on the trams, with the route board up front
  if (kind === 'tram') {
    add(box(W - 0.1, 0.18, L - 0.4, 0, roof + 0.05, 0), bodyMat(0xb5302a));
    for (const sign of [cabF ? 1 : 0, cabB ? -1 : 0].filter(Boolean)) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.32), tramBoard());
      b.position.set(0, roof - 0.35, sign * (h2 + 0.1));
      if (sign < 0) b.rotation.y = Math.PI;
      root.add(b);
    }
  }
  const meshes = {};
  if (head.length) {
    meshes.head = add(merge(head), M.head);
    meshes.tail = add(merge(tail), M.tail);
  }
  if (leaves) {
    add(merge(inside), interiorMat());
    // one mesh per side and sliding direction, moved as a whole when the doors open
    meshes.doors = [];
    const lm = doorLeafMat(paint.color.getHex(), dy1 - dy0, floor + 0.45 - 0.275 - dy0, 0.55);
    for (const sx of [1, -1]) for (const dir of [1, -1]) meshes.doors.push({ mesh: add(merge(leaves[sx][dir]), lm), sx, dir });
  }
  return { root, meshes };
}

let INTERIOR = null;
function interiorMat() {
  return (INTERIOR ||= new THREE.MeshStandardMaterial({ color: 0x8d9096, emissive: 0xfff2dc, emissiveIntensity: 0.55, roughness: 0.6 }));
}
const LEAF = new Map();
/** A Metro door leaf: brushed steel, a tall window and the line-colour band. */
function doorLeafMat(color, h, bandY, bandH) {
  if (LEAF.has(color)) return LEAF.get(color);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c4c8cc';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let y = 0; y < 256; y += 6) g.fillRect(0, y, 64, 2);
  const py = (y) => 256 - (y / h) * 256;
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.fillRect(0, py(bandY + bandH), 64, (bandH / h) * 256);
  const gr = g.createLinearGradient(0, 30, 0, 140);
  gr.addColorStop(0, '#2d3a46');
  gr.addColorStop(1, '#0d1318');
  g.fillStyle = gr;
  g.fillRect(10, 26, 44, 112);
  g.strokeStyle = '#1a1c1f';
  g.lineWidth = 4;
  g.strokeRect(10, 26, 44, 112);
  g.fillStyle = '#1a1c1f';
  g.fillRect(0, 0, 64, 4);
  g.fillRect(0, 252, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.55 });
  LEAF.set(color, m);
  return m;
}

/* =========================================================
   Consist: a set of rail cars that moves as one along a track.
   Implements the same interface as a road Vehicle so the player
   can drive it and the camera/HUD can follow it.
   ========================================================= */
export class Consist {
  constructor(scene, track, kind, stops, fx, color = null) {
    const K = KINDS[kind];
    this.K = K;
    this.kind = kind;
    this.rail = true;
    this.type = kind;
    this.track = track;
    this.fx = fx;
    this.paint = new THREE.MeshStandardMaterial({ color: color ?? K.color, roughness: 0.4, metalness: 0.3 });
    this.cars = [];
    for (let i = 0; i < K.cars; i++) {
      const c = buildRailCar(kind, i === 0, i === K.cars - 1, this.paint, i === 1, i);
      scene.add(c.root);
      this.cars.push({ ...c, x: 0, z: 0, yaw: 0 });
    }
    // Driver's cab in use: +1 = front of car 0 (facing +s), -1 = back of the last car (facing -s)
    this.cab = 1;
    this.car = { root: this.cars[0].root, meshes: this.cars[0].meshes };
    this.pitch = 0;
    this.roll = 0;
    this.span = (K.cars - 1) * (K.L + K.gap);
    this.sMin = this.span + K.L / 2 + 1;
    this.sMax = track.len - K.L / 2 - 1;
    // Stops are stored as lead-car positions; the AI turns round at endA / endB
    this.setStops([this.sMin, ...stops.map((c) => c + this.span / 2), this.sMax]);
    this.s = this.stops[Math.floor(this.stops.length / 2)];
    this.v = 0;
    this.dir = 1;
    this.state = 'dwell';
    this.dwell = 3 + Math.random() * 4;
    // Sliding doors (Metro): 0 = shut, 1 = open; side is the car-local x sign (0 = both)
    this.doors = !!K.doors;
    this.doorT = 0;
    this.doorWant = false;
    this.doorSide = 0;
    this.doorPlan = this.doors ? 'pending' : null;
    this.doorDelay = 1;
    this.stillT = 0;
    this.sideAt = null; // (lead-car s) -> platform side at a station, or null between stations
    // Double track (Metro): which way the train is bound, and its offset across the line
    this.bound = 'up';
    this.laneAt = null; // (s, bound) -> sideways offset of that track at s
    this.peers = null; // other trains on the same line, kept apart
    this.xover = null; // where the crossovers beyond the end stations are
    this.blockedT = 0;
    this.ignoreT = 0;
    this.hornT = 0;
    this.def = { label: K.label, seatX: 0, seatZ: K.L / 2 - (kind === 'tram' ? 1.2 : 1.9), seatY: K.seatY, hw: K.hw, hl: K.L / 2, h: K.roof, camDist: K.camDist, camH: K.camH, headZ: K.L / 2, headY: K.base + 0.75, mass: 60, engine: K.engine, offs: [0], rad: K.hw, top: K.top };
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0;
    this.steer = 0;
    this.impact = 0;
    this.nitro = 0;
    this.nitroOn = false;
    this.slip = 0;
    this.skid = 0;
    this.rpm = 0;
    this.gear = 1;
    this.braking = false;
    this.driven = false;
    this.locked = false;
    this.asleep = false;
    this.wrecked = false;
    this.tmp = {};
    this.place();
  }
  get label() {
    return this.K.label;
  }
  /** Lead-car stopping points, in order; the first and last are where the AI turns round. */
  setStops(list) {
    const out = [];
    for (const s of list.filter((s) => s >= this.sMin && s <= this.sMax).sort((a, b) => a - b)) if (!out.length || s - out[out.length - 1] > 1) out.push(s);
    this.stops = out;
    this.endA = out[0];
    this.endB = out[out.length - 1];
  }
  /** Turn round at the last real station instead of wherever the mapped track runs out. */
  trimEnds(a, b) {
    const inner = (s) => s > this.sMin + 1 && s < this.sMax - 1;
    let list = this.stops;
    if (a && list.length > 2 && !inner(list[0]) && inner(list[1])) list = list.slice(1);
    if (b && list.length > 2 && !inner(list[list.length - 1]) && inner(list[list.length - 2])) list = list.slice(0, -1);
    this.setStops(list);
    this.s = clamp(this.s, this.endA, this.endB);
  }
  /** Is the train standing with its doors open (Metro), or always boardable (the rest)? */
  get boardable() {
    return this.speed < 0.6 && (!this.doors || this.doorT > 0.7);
  }
  openDoors(side) {
    this.doorWant = true;
    this.doorSide = side;
  }
  closeDoors(ctx) {
    if (!this.doorWant) return;
    this.doorWant = false;
    const c = ctx || this.env;
    if (c && c.near && c.near(this.pos) < 80) c.audio.metroChime(c.near(this.pos));
  }
  /** Lead car arrives at a stopping point. */
  arrive(tgt) {
    this.s = tgt;
    this.v = 0;
    this.state = 'dwell';
    this.lastStop = tgt;
    const atEnd = tgt <= this.endA + 1 || tgt >= this.endB - 1;
    this.dwell = atEnd && this.termDwell ? this.termDwell : this.kind === 'tram' ? 9 : this.kind === 'express' ? 30 : this.kind === 'train' ? 18 : 16;
    this.doorPlan = this.doors ? 'pending' : null;
    this.doorDelay = 1;
  }
  get speed() {
    return Math.abs(this.v);
  }
  /** Speed as seen from the driver's seat (negative = backing up). */
  get vf() {
    return this.v * this.cab;
  }
  /** Which cab end is closest to a point; and that cab's door-side position. */
  cabNear(x, z) {
    const a = this.cars[0];
    const b = this.cars[this.cars.length - 1];
    const off = this.def.seatZ;
    const pa = { x: a.x + Math.sin(a.yaw) * off, z: a.z + Math.cos(a.yaw) * off };
    const pb = { x: b.x - Math.sin(b.yaw) * off, z: b.z - Math.cos(b.yaw) * off };
    const da = Math.hypot(pa.x - x, pa.z - z);
    const db = Math.hypot(pb.x - x, pb.z - z);
    return da <= db ? { cab: 1, d: da } : { cab: -1, d: db };
  }
  setCab(cab) {
    this.cab = cab;
    const c = cab > 0 ? this.cars[0] : this.cars[this.cars.length - 1];
    this.car = { root: c.root, meshes: c.meshes };
    this.place();
  }
  local(x, z) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return { x: this.pos.x + x * c + z * s, z: this.pos.z - x * s + z * c };
  }
  setDriven(on) {
    this.driven = on;
    if (on) {
      this.state = 'run';
      this.lastStop = undefined;
      this.doorsServed = false;
    } else if (this.laneAt) {
      // back to the timetable: carry on the way this track runs
      this.dir = this.bound === 'up' ? 1 : -1;
    }
  }
  /** Track point at s, moved across onto the train's own track. */
  onTrack(s, out) {
    this.track.at(s, out);
    const off = this.laneAt ? this.laneAt(s, this.bound) : 0;
    if (off) {
      const l = Math.hypot(out.tx, out.tz) || 1;
      out.x -= (out.tz / l) * off;
      out.z += (out.tx / l) * off;
    }
    return out;
  }
  damage() {}

  /** Position every car from the lead car's track distance. */
  place() {
    const K = this.K;
    const a = this.tmp;
    const b = {};
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const sc = this.s - i * (K.L + K.gap);
      this.onTrack(sc + K.L * 0.35, a);
      const fx = a.x;
      const fz = a.z;
      this.onTrack(sc - K.L * 0.35, b);
      c.x = (fx + b.x) / 2;
      c.z = (fz + b.z) / 2;
      c.yaw = Math.atan2(fx - b.x, fz - b.z);
      c.root.position.set(c.x, K.y, c.z);
      c.root.rotation.y = c.yaw;
    }
    const c0 = this.cab > 0 ? this.cars[0] : this.cars[this.cars.length - 1];
    this.pos.set(c0.x, K.y, c0.z);
    this.yaw = c0.yaw + (this.cab > 0 ? 0 : Math.PI);
    this.vel.set(Math.sin(c0.yaw) * this.v, Math.cos(c0.yaw) * this.v);
  }

  /** Nearest thing on the track ahead in the direction of travel. */
  scanAhead(objs, dir) {
    const K = this.K;
    const front = dir > 0 ? this.s + K.L / 2 : this.s - this.span - K.L / 2;
    const p = this.onTrack(front, {});
    const tl = Math.hypot(p.tx, p.tz) || 1;
    const tx = (p.tx / tl) * dir;
    const tz = (p.tz / tl) * dir;
    let best = Infinity;
    for (const o of objs) {
      // Someone up on the platform, or a train on another level, isn't on this track
      if (o.y !== undefined && (o.y > K.y + 0.45 || o.y < K.y - 4)) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const ahead = dx * tx + dz * tz;
      if (ahead < -1 || ahead > K.look) continue;
      if (Math.abs(dx * tz - dz * tx) < K.hw + (o.r || 1.2)) best = Math.min(best, ahead);
    }
    return best;
  }

  update(dt, inp, night, ctx = null) {
    const K = this.K;
    this.impact = 0;
    if (this.driven && inp) {
      // Controls are relative to the cab: W drives the way the driver faces
      let th = this.locked ? 0 : inp.throttle;
      const br = this.locked ? 0 : inp.brake;
      if (this.doors) th = this.driverDoors(dt, th, br);
      let u = this.v * this.cab;
      this.braking = false;
      if (th > 0) u += (u < -0.3 ? K.dec * 2.5 : K.accel * 1.8 * Math.max(0, 1 - Math.max(0, u) / K.top)) * th * dt;
      if (br > 0) {
        if (u > 0.3) {
          u -= K.dec * 2.5 * br * dt;
          this.braking = true;
        } else u = Math.max(-6, u - K.accel * br * dt);
      }
      if (inp.handbrake) u -= Math.sign(u) * Math.min(Math.abs(u), K.dec * 4 * dt);
      if (!th && !br) u -= Math.sign(u) * Math.min(Math.abs(u), 0.15 * dt);
      this.v = u * this.cab;
      this.dir = Math.sign(this.v) || this.dir;
    } else {
      this.updateAI(dt, ctx);
    }
    // Buffer stops at the ends of the line
    let ns = this.s + this.v * dt;
    // Arriving at a stop: if this step crosses the stopping point at low speed, stop on it
    // (otherwise a train can roll a few metres past and never open its doors)
    const tgt = this._target;
    if (!this.driven && this.state === 'run' && tgt !== undefined && tgt !== this.lastStop && Math.abs(this.v) < 4 && (tgt - this.s) * (tgt - ns) <= 0) {
      this.arrive(tgt);
      ns = tgt;
    }
    if (ns > this.sMax || ns < this.sMin) {
      if (Math.abs(this.v) > 2) {
        this.impact = Math.abs(this.v);
        const p = this.track.at(ns > this.sMax ? this.track.len : 0, {});
        this.fx.sparks(p.x, K.floor + 0.5, p.z, this.impact);
      }
      ns = clamp(ns, this.sMin, this.sMax);
      this.v = 0;
    }
    this.s = ns;
    this.rpm = damp(this.rpm, clamp(0.2 + Math.abs(this.v) / K.top, 0, 1), 6, dt);
    this.gear = this.vf < -0.3 ? -1 : 1;
    this.place();
    if (this.doors) {
      // the leaves take about a second and a half to slide
      const want = this.doorWant ? 1 : 0;
      this.doorT += clamp(want - this.doorT, -dt / 1.5, dt / 1.5);
      for (const c of this.cars) {
        if (!c.meshes.doors) continue;
        for (const d of c.meshes.doors) d.mesh.position.z = d.dir * 0.64 * (this.doorSide === 0 || this.doorSide === d.sx ? this.doorT : 0);
      }
    }
    const lightOn = lerp(0.6, 6, night);
    for (const c of [this.cars[0], this.cars[this.cars.length - 1]]) {
      if (c.meshes.head) c.meshes.head.material.emissiveIntensity = lightOn;
    }
  }

  /**
   * Doors while the player drives: stand still at a platform and they open by themselves;
   * pull away (W) and they shut first, with the chime; the train waits until they're closed.
   * Returns the throttle the driver is allowed.
   */
  driverDoors(dt, th, br) {
    const hud = this.env && this.env.game ? this.env.game.hud : null;
    const stopped = Math.abs(this.v) < 0.15;
    if (!stopped) this.stillT = 0;
    else if (!this.doorWant && this.doorT === 0 && !th && !br) {
      this.stillT += dt;
      const side = this.sideAt ? this.sideAt(this.s) : null;
      if (this.stillT > 0.8 && side !== null && !this.doorsServed) {
        this.openDoors(side);
        this.doorsServed = true;
        this.doorOpenT = 0;
        if (hud) hud.notify('DOORS OPEN', 'W to close the doors and pull away', '#38f3ff');
      }
    }
    if (!stopped) this.doorsServed = false;
    if (this.doorWant) {
      this.doorOpenT = (this.doorOpenT || 0) + dt;
      // they close on their own after a while, or as soon as you want to go
      if (th > 0 || this.doorOpenT > 20) {
        this.closeDoors();
        this.doorsServed = true;
        if (hud) hud.notify('DOORS CLOSING', 'Please stand clear of the doors', '#ffd36b');
      }
    }
    return this.doorT > 0 ? 0 : th;
  }

  signal(ctx) {
    const d = ctx.near(this.pos);
    if (this.kind === 'train' || this.kind === 'express') ctx.audio.trainHorn(d);
    else if (this.kind === 'metro') ctx.audio.metroChime(d);
    else ctx.audio.tramBell(d);
  }

  updateAI(dt, ctx) {
    const K = this.K;
    this.braking = false;
    if (this.state === 'dwell') {
      this.v = damp(this.v, 0, 6, dt);
      this.dwell -= dt;
      if (this.doors) {
        // stop, doors open, dwell, chime, doors shut, depart
        this.doorDelay -= dt;
        if (this.doorPlan === 'pending' && this.doorDelay <= 0 && this.dwell > 4) {
          const side = this.sideAt ? this.sideAt(this.s) : 0;
          // reversing in a siding: no platform, doors stay shut
          if (side === null) this.doorPlan = 'shut';
          else {
            this.openDoors(side);
            this.doorPlan = 'open';
          }
        } else if (this.doorPlan !== 'shut' && this.dwell <= 3) {
          this.closeDoors(ctx);
          this.doorPlan = 'shut';
        }
        if (this.dwell <= 0 && this.doorT > 0) return;
      }
      if (this.dwell <= 0) {
        this.state = 'run';
        if ((this.dir > 0 && this.s >= this.endB - 0.5) || (this.dir < 0 && this.s <= this.endA + 0.5)) {
          this.dir *= -1;
          if (this.laneAt) this.bound = this.dir > 0 ? 'up' : 'down';
        }
        if (ctx && ctx.near(this.pos) < 70 && !this.doors) this.signal(ctx);
      }
      return;
    }
    // Left past the end of the service (the player drove it there): head back
    if (this.dir > 0 && this.s > this.endB + 0.5) this.dir = -1;
    else if (this.dir < 0 && this.s < this.endA - 0.5) this.dir = 1;
    if (this.doorWant) this.closeDoors(ctx);
    // Next stop in the direction of travel
    let target = this.dir > 0 ? this.endB : this.endA;
    for (const st of this.dir > 0 ? this.stops : [...this.stops].reverse()) {
      // the next stop ahead that this train hasn't just served
      if ((st - this.s) * this.dir > -0.5 && st !== this.lastStop) {
        target = st;
        break;
      }
    }
    this._target = target;
    const dist = Math.abs(target - this.s);
    let want = Math.min(K.top, Math.sqrt(2 * K.dec * 0.85 * dist));
    // Obstacles on the line
    this.ignoreT -= dt;
    this.hornT -= dt;
    if (ctx && this.ignoreT <= 0) {
      let ahead = this.scanAhead(ctx.objs, this.dir);
      // Other rail cars crossing or sharing the line
      if (ctx.consists) {
        const others = [];
        for (const o of ctx.consists) if (o !== this && !(this.peers && this.peers.includes(o)) && !!o.K.under === !!this.K.under) for (const c of o.cars) others.push({ x: c.x, z: c.z, r: o.K.hw + o.K.L * 0.3, y: o.K.y });
        ahead = Math.min(ahead, this.scanAhead(others, this.dir));
      }
      if (ahead < K.look) {
        if (this.kind === 'tram') want = Math.min(want, Math.max(0, (ahead - 3) * 0.7));
        else want = Math.min(want, Math.max(0, ahead - 6) * 0.5);
        if (this.hornT <= 0 && ctx.near(this.pos) < 90) {
          this.signal(ctx);
          this.hornT = 3.5;
        }
        if (Math.abs(this.v) < 0.3) this.blockedT += dt;
      } else this.blockedT = 0;
      // Waited long enough: nudge through
      if (this.blockedT > 6) {
        this.ignoreT = 4;
        this.blockedT = 0;
      }
    }
    if (this.peers) want = Math.min(want, this.headway());
    if (this.doorT > 0) want = 0;
    const sp = this.v * this.dir;
    if (sp < want) this.v += this.dir * Math.min(want - sp, K.accel * dt);
    else {
      this.v -= this.dir * Math.min(sp - want, K.dec * 1.6 * dt);
      this.braking = true;
    }
    // Close enough and slow enough: draw up exactly on the mark
    if (target !== this.lastStop && dist < 2.5 && Math.abs(this.v) < 1.2) this.arrive(target);
  }

  /**
   * Fastest safe speed behind the trains ahead on the same line: brake to stop 25 m short
   * of the train in front on this track, and don't run into a crossover while a train
   * from the other track is still coming through it.
   */
  headway() {
    const K = this.K;
    const X = this.xover;
    const front = this.dir > 0 ? this.s + K.L / 2 : this.s - this.span - K.L / 2;
    let gapMin = Infinity;
    for (const p of this.peers) {
      if (p === this) continue;
      let rear = null;
      if (p.bound === this.bound) rear = this.dir > 0 ? p.s - p.span - K.L / 2 : p.s + K.L / 2;
      else if (X && this.dir > 0 && p.s + K.L / 2 > X.X0) rear = X.X0;
      else if (X && this.dir < 0 && p.s - p.span - K.L / 2 < X.Y1) rear = X.Y1;
      if (rear === null) continue;
      const gap = (rear - front) * this.dir;
      if (gap > -2 && gap < gapMin) gapMin = gap;
    }
    return gapMin === Infinity ? Infinity : Math.sqrt(2 * K.dec * 0.85 * Math.max(0, gapMin - 25));
  }

  /** Each car as a capsule: segment endpoints + radius. */
  capsules(out) {
    const K = this.K;
    for (const c of this.cars) {
      const hl = K.L / 2 - K.hw;
      const fx = Math.sin(c.yaw) * hl;
      const fz = Math.cos(c.yaw) * hl;
      out.push({ ax: c.x - fx, az: c.z - fz, bx: c.x + fx, bz: c.z + fz, r: K.hw, consist: this });
    }
  }
}

function closestOnSeg(c, x, z) {
  const dx = c.bx - c.ax;
  const dz = c.bz - c.az;
  const t = clamp(((x - c.ax) * dx + (z - c.az) * dz) / (dx * dx + dz * dz), 0, 1);
  return { x: c.ax + dx * t, z: c.az + dz * t };
}

/* =========================================================
   Rail network
   ========================================================= */

/** Node-level graph of rail ways: node index -> Set of neighbouring node indices. */
function railGraph(rails) {
  const adj = new Map();
  const link = (a, b) => {
    let set = adj.get(a);
    if (!set) adj.set(a, (set = new Set()));
    set.add(b);
  };
  for (const r of rails) {
    for (let i = 1; i < r.n.length; i++) {
      link(r.n[i - 1], r.n[i]);
      link(r.n[i], r.n[i - 1]);
    }
  }
  return adj;
}
/** Follow the straightest line out of `start` (having come from `from`), up to maxLen metres. */
function walkRail(adj, start, from, maxLen, maxTurn = 0.5) {
  const out = [start];
  const seen = new Set(out);
  let cur = start;
  let len = 0;
  while (len < maxLen) {
    const nb = adj.get(cur);
    if (!nb) break;
    const [cx, cz] = nodeXZ(cur);
    let dx0 = 0;
    let dz0 = 0;
    if (from != null) {
      const [fx, fz] = nodeXZ(from);
      const l = Math.hypot(cx - fx, cz - fz) || 1;
      dx0 = (cx - fx) / l;
      dz0 = (cz - fz) / l;
    }
    let best = null;
    let bestDot = -2;
    for (const n of nb) {
      if (n === from || seen.has(n)) continue;
      const [nx, nz] = nodeXZ(n);
      const l = Math.hypot(nx - cx, nz - cz) || 1;
      const dot = from == null ? 1 : ((nx - cx) * dx0 + (nz - cz) * dz0) / l;
      if (dot > bestDot) {
        bestDot = dot;
        best = n;
      }
    }
    if (best == null || (from != null && bestDot < Math.cos(maxTurn))) break;
    const [bx, bz] = nodeXZ(best);
    len += Math.hypot(bx - cx, bz - cz);
    out.push(best);
    seen.add(best);
    from = cur;
    cur = best;
  }
  return { nodes: out, len };
}
const overlap = (a, b) => {
  const set = new Set(b.nodes);
  let k = 0;
  for (const n of a.nodes) if (set.has(n)) k++;
  return k / a.nodes.length;
};

/** Station names on Indian Railways boards: Bengali, Hindi, English. */
const BOARD_NAMES = {
  'HOWRAH': ['হাওড়া', 'हावड़ा'],
  'SEALDAH': ['শিয়ালদহ', 'सियालदह'],
  'B.B.D. BAG': ['বি.বা.দী. বাগ', 'बी.बा.दी. बाग'],
  'BBD BAGH': ['বি.বা.দী. বাগ', 'बी.बा.दी. बाग'],
  'EDEN GARDENS': ['ইডেন গার্ডেন্স', 'ईडन गार्डन्स'],
  'PRINSEP GHAT': ['প্রিন্সেপ ঘাট', 'प्रिंसेप घाट'],
  'BARRA BAZAR': ['বড়বাজার', 'बड़ाबाज़ार'],
  'SOVABAZAR AHIRITOLA': ['শোভাবাজার আহিরীটোলা', 'शोभाबाजार अहिरीटोला'],
  'PARK CIRCUS': ['পার্ক সার্কাস', 'पार्क सर्कस'],
  'SIR GURUDAS BANERJEE HALT': ['স্যার গুরুদাস ব্যানার্জী হল্ট', 'सर गुरुदास बनर्जी हॉल्ट'],
};
function boardName(n) {
  return n.replace(/ junction| railway station| station/gi, '').toUpperCase().trim();
}
/** Yellow Indian Railways station board. */
export function boardTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#f4c51c';
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = '#111';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 184);
  g.fillStyle = '#111';
  g.textAlign = 'center';
  const [bn, hi] = BOARD_NAMES[name] || [];
  const lines = [bn, hi, name].filter(Boolean);
  const sizes = lines.length === 3 ? [46, 40, 44] : [60];
  lines.forEach((t, i) => {
    g.font = `bold ${sizes[i] || 44}px "Kohinoor Bangla", "Bangla MN", "Noto Sans Bengali", "Kohinoor Devanagari", "Noto Sans Devanagari", Arial, sans-serif`;
    const y = lines.length === 3 ? 56 + i * 58 : 118;
    g.fillText(t, 256, y, 480);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ballast texture with sleepers, running along v. */
function sleeperTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#7c7266';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,36,30' : '170,160,145'},0.5)`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  g.fillStyle = '#5d5047';
  g.fillRect(4, 22, 56, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Rail {
  constructor(scene, world, fx) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    const M = railMats();
    const statics = [];
    this.trams = [];
    this.tramTracks = [];
    this.trainTracks = [];
    this.consists = [];
    this.stations = [];
    this.platforms = [];

    /* ---- Track beds for every railway line in the data ---- */
    const heavy = MAP.rails.filter((r) => (r.k === 'rail' || r.k === 'narrow_gauge') && !r.tn);
    const trams = MAP.rails.filter((r) => r.k === 'tram' && !r.tn);
    const bed = new Buf();
    const steel = new Buf();
    const grooves = new Buf();
    for (const r of heavy) {
      const pts = r.n.flatMap(nodeXZ);
      ribbon(bed, pts, 3.0, 0.045, { uv: 'along', scale: 0.65 });
      for (const o of [0.7175, -0.7175]) ribbon(steel, offsetLine(pts, o), 0.1, 0.2);
    }
    for (const r of trams) {
      const pts = r.n.flatMap(nodeXZ);
      for (const o of [0.72, -0.72]) ribbon(grooves, offsetLine(pts, o), 0.09, 0.045);
    }
    // Overhead catenary over the main lines; masts only where they clear the neighbouring tracks
    const segGrid = new Grid(25);
    {
      for (const r of heavy) {
        for (let i = 1; i < r.n.length; i++) {
          const [ax, az] = nodeXZ(r.n[i - 1]);
          const [bx, bz] = nodeXZ(r.n[i]);
          const sg = { ax, az, bx, bz };
          segGrid.insert(sg, Math.min(ax, bx) - 3, Math.max(ax, bx) + 3, Math.min(az, bz) - 3, Math.max(az, bz) + 3);
        }
      }
      const clear = (x, z) => {
        let ok = true;
        segGrid.query(x - 3, x + 3, z - 3, z + 3, (sg) => {
          const dx = sg.bx - sg.ax;
          const dz = sg.bz - sg.az;
          const t = clamp(((x - sg.ax) * dx + (z - sg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
          if (Math.hypot(x - sg.ax - dx * t, z - sg.az - dz * t) < 2.6) ok = false;
        });
        return ok && !world.collideCircle(x, z, 0.4);
      };
      const cat = buildCatenary(scene, heavy.filter((r) => !r.sv).map((r) => r.n.flatMap(nodeXZ)), clear);
      if (cat) statics.push(...cat);
    }
    const bedMat = new THREE.MeshStandardMaterial({ map: sleeperTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const [b, m] of [[bed, bedMat], [steel, M.steel], [grooves, M.steel]]) {
      const g = b.geometry();
      if (g) statics.push(new THREE.Mesh(g, m));
    }

    /* ---- Platforms: raised pads with yellow edges, boards and roofs ---- */
    const platTop = new Buf();
    const platSide = new Buf();
    const edge = new Buf();
    const posts = [];
    const canopy = [];
    const shed = world.station ? polygon(world.station.footprint) : null;
    const hcs = world.station ? world.station.headCentre : null;
    const PH = 0.85;
    const railStations = MAP.stations.filter((st) => st.k === 'rail');
    const boards = new Map();
    const benches = [];
    const addPlatform = (ring, ref = null) => {
      const poly = polygon(ring);
      if (!inTiles((poly.x0 + poly.x1) / 2, (poly.z0 + poly.z1) / 2, 50)) return;
      world.addPad(ring, PH);
      flatPoly(platTop, ring, PH, 3);
      for (let i = 0, j = poly.n - 1; i < poly.n; j = i++) {
        const ax = poly.xs[j];
        const az = poly.zs[j];
        const bx = poly.xs[i];
        const bz = poly.zs[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const b0 = platSide.n;
        const nx = (bz - az) / len;
        const nz = -(bx - ax) / len;
        platSide.v(ax, PH, az, nx, 0, nz, 0, PH);
        platSide.v(bx, PH, bz, nx, 0, nz, len, PH);
        platSide.v(bx, 0, bz, nx, 0, nz, len, 0);
        platSide.v(ax, 0, az, nx, 0, nz, 0, 0);
        platSide.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3, b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
        if (len > 6) ribbon(edge, [ax, az, bx, bz], 0.35, PH + 0.012);
      }
      // Centre line of the platform (they curve at the termini): sample inside, bin along the long axis
      const pts = [];
      for (let x = poly.x0 + 0.75; x < poly.x1; x += 1.5) for (let z = poly.z0 + 0.75; z < poly.z1; z += 1.5) if (inPoly(poly, x, z)) pts.push([x, z]);
      if (pts.length < 6) return;
      let mx = 0;
      let mz = 0;
      for (const [x, z] of pts) {
        mx += x;
        mz += z;
      }
      mx /= pts.length;
      mz /= pts.length;
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      for (const [x, z] of pts) {
        sxx += (x - mx) ** 2;
        szz += (z - mz) ** 2;
        sxz += (x - mx) * (z - mz);
      }
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const ux = Math.cos(ang);
      const uz = Math.sin(ang);
      const bins = new Map();
      for (const [x, z] of pts) {
        const k = Math.round(((x - mx) * ux + (z - mz) * uz) / 6);
        const b = bins.get(k) || bins.set(k, [0, 0, 0]).get(k);
        b[0] += x;
        b[1] += z;
        b[2]++;
      }
      const spine = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => [b[0] / b[2], b[1] / b[2]]);
      const sp = new Poly(spine.flat());
      const len = sp.len;
      const mid = sp.at(len / 2, {});
      const cx = mid.x;
      const cz = mid.z;
      const covered = !!hcs && Math.hypot(cx - hcs.x, cz - hcs.z) < 650;
      const st = railStations.reduce((a, b) => (Math.hypot(b.x - cx, b.z - cz) < Math.hypot(a.x - cx, a.z - cz) ? b : a), railStations[0]);
      const name = st ? boardName(st.n) : 'KOLKATA';
      this.platforms.push({ poly, cx, cz, ux, uz, len, name, covered, spine: sp, ref: ref ? ref.split(';').map(Number) : null });
      // Columns (tall sheds at Howrah, a simple canopy elsewhere) and name boards, all along the centre line
      const ch = covered ? 6.8 : 4.4;
      const q = {};
      for (let s = 6; s <= len - 6; s += covered ? 12 : 10) {
        sp.at(s, q);
        if (!inPoly(poly, q.x, q.z)) continue;
        const yaw = Math.atan2(q.tx, q.tz);
        posts.push(new THREE.CylinderGeometry(0.18, 0.22, ch - PH, 8).translate(q.x, PH + (ch - PH) / 2, q.z));
        world.addCircle(q.x, q.z, 0.25);
        canopy.push(new THREE.BoxGeometry(covered ? 9 : 4.2, 0.14, covered ? 12.4 : 10.4).rotateY(yaw).translate(q.x, ch + 0.05, q.z));
        // tube lights under the roof, either side of the column under Howrah's wide sheds
        for (const o of covered ? [-2.4, 2.4] : [0]) world.addStationLamp(q.x + q.tz * o, ch - 0.06, q.z - q.tx * o, yaw, covered ? 8 : 6, PH, covered ? 7 : 6.5);
        // a bench back to back with the column, every other bay
        if (!covered && Math.round(s / 10) % 2 === 0 && s + 5 < len - 6) {
          sp.at(s + 5, q);
          const by = Math.atan2(q.tx, q.tz);
          benches.push(new THREE.BoxGeometry(0.45, 0.06, 1.8).rotateY(by).translate(q.x, PH + 0.45, q.z));
          for (const o of [-0.7, 0.7]) benches.push(new THREE.BoxGeometry(0.4, 0.45, 0.06).rotateY(by).translate(q.x + Math.sin(by) * o, PH + 0.22, q.z + Math.cos(by) * o));
          world.addCircle(q.x, q.z, 0.5);
        }
      }
      for (const f of [0.25, 0.75]) {
        sp.at(len * f, q);
        if (!inPoly(poly, q.x, q.z)) continue;
        const yaw = Math.atan2(q.tx, q.tz);
        if (!boards.has(name)) boards.set(name, new THREE.MeshStandardMaterial({ map: boardTexture(name), roughness: 0.6, emissive: 0xffffff, emissiveMap: boardTexture(name), emissiveIntensity: 0.15 }));
        const b = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.27), boards.get(name));
        b.position.set(q.x, PH + 2.6, q.z);
        b.rotation.y = yaw + Math.PI / 2;
        statics.push(b);
        const back = b.clone();
        back.rotation.y += Math.PI;
        statics.push(back);
        for (const o of [-1.5, 1.5]) posts.push(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(q.x + q.tx * o, PH + 1.3, q.z + q.tz * o));
      }
    };
    for (const pl of MAP.platforms) {
      let ring = pl.p;
      if (!ring) {
        const L = offsetLine(pl.l, 3);
        const R = offsetLine(pl.l, -3);
        ring = [...L];
        for (let i = R.length - 2; i >= 0; i -= 2) ring.push(R[i], R[i + 1]);
      }
      addPlatform(ring, pl.ref);
    }
    this.stations = railStations.filter((st) => inTiles(st.x, st.z)).map((st) => [boardName(st.n), st.x, st.z]);

    /* ---- Trains out of the termini, on the real platform roads ---- */
    const adj = railGraph(heavy);
    const ends = [...adj.keys()].filter((n) => adj.get(n).size === 1);
    const terminus = (test, count, kinds, maxLen = 2600) => {
      const paths = ends
        .filter((n) => test(...nodeXZ(n)))
        .map((n) => walkRail(adj, n, null, maxLen))
        .filter((p) => p.len > 600)
        .sort((a, b) => b.len - a.len);
      const chosen = [];
      for (const p of paths) {
        if (chosen.length >= count) break;
        if (chosen.some((c) => Math.hypot(...nodeXZ(c.nodes[0]).map((v, i) => v - nodeXZ(p.nodes[0])[i])) < 12)) continue;
        chosen.push(p);
      }
      return chosen.map((p, i) => {
        const pts = p.nodes.map(nodeXZ);
        const track = new Track(pts, 2);
        const kind = kinds[i % kinds.length];
        // stop at every station along the way
        const pl = new Poly(pts.flat());
        const stops = [];
        for (const st of railStations) {
          const q = pl.project(st.x, st.z);
          if (q.d < 70 && q.s > 300 && q.s < pl.len - 150) stops.push(track.nearest(st.x, st.z));
        }
        const cs = new Consist(scene, track, kind, stops, fx);
        cs.trim = [false, true];
        // waiting at the platform, leaving one after another
        cs.s = cs.sMin;
        cs.termDwell = 45 + (i % 3) * 20;
        cs.dwell = 8 + i * 22;
        cs.place();
        this.trainTracks.push({ track, color: KINDS[kind].color });
        this.consists.push(cs);
        return { cs, pl };
      });
    };
    if (shed) {
      const q = {};
      for (const { cs } of terminus((x, z) => inPoly(shed, x, z) || nearestOnRing(shed, x, z, q).d < 90, 7, ['train', 'express', 'train', 'train', 'express', 'train', 'train'])) cs.origin = 'howrah';
    }
    const sealdah = MAP.stations.find((st) => /^sealdah$/i.test(st.n) && st.k === 'rail');
    if (sealdah) {
      const near = (x, z) => Math.hypot(x - sealdah.x, z - sealdah.z) < 420;
      const made = terminus(near, 3, ['train', 'express', 'train'], 4500);
      for (const { cs } of made) cs.origin = 'sealdah';
      // Sealdah South: make sure a local runs out past Park Circus
      const pc = MAP.stations.find((st) => /park circus/i.test(st.n));
      if (pc && !made.some(({ pl }) => pl.project(pc.x, pc.z).d < 70)) {
        const south = ends
          .filter((n) => near(...nodeXZ(n)))
          .flatMap((n) => [0.35, 0.6, 0.9].map((t) => walkRail(adj, n, null, 5000, t)))
          .map((p) => ({ p, d: new Poly(p.nodes.flatMap(nodeXZ)).project(pc.x, pc.z).d }))
          .sort((a, b) => a.d - b.d)[0];
        if (south && south.d < 70) {
          const pts = south.p.nodes.map(nodeXZ);
          const track = new Track(pts, 2);
          const pl = new Poly(pts.flat());
          const stops = railStations.filter((st) => pl.project(st.x, st.z).d < 70 && pl.project(st.x, st.z).s > 300).map((st) => track.nearest(st.x, st.z));
          const cs = new Consist(scene, track, 'train', stops, fx, 0x2f6b9a);
          cs.trim = [false, true];
          cs.s = cs.sMin;
          cs.termDwell = 50;
          cs.dwell = 20;
          cs.place();
          this.trainTracks.push({ track, color: 0x2f6b9a });
          this.consists.push(cs);
          this.southLocal = cs;
          cs.origin = 'sealdah-south';
        }
      }
    }

    /* ---- Circular Railway along the river, stopping at its stations ---- */
    const eden = MAP.stations.find((st) => /eden gardens/i.test(st.n));
    if (eden) {
      let best = null;
      for (const n of adj.keys()) {
        const [x, z] = nodeXZ(n);
        const d = Math.hypot(x - eden.x, z - eden.z);
        if (!best || d < best.d) best = { n, d };
      }
      if (best && best.d < 120) {
        const nb = [...adj.get(best.n)];
        if (nb.length >= 2) {
          const a = walkRail(adj, best.n, nb[0], 4200, 0.35);
          const b = walkRail(adj, best.n, nb[1], 4200, 0.35);
          const nodes = [...a.nodes.reverse(), ...b.nodes.slice(1)];
          if (a.len + b.len > 1500) {
            const track = new Track(nodes.map(nodeXZ), 3);
            const pl = new Poly(nodes.flatMap(nodeXZ));
            const stops = [];
            for (const st of railStations) {
              const p = pl.project(st.x, st.z);
              if (p.d < 60 && p.s > 150 && p.s < pl.len - 150) stops.push(p.s);
            }
            for (const k of [0, 1]) {
              const cs = new Consist(scene, track, 'train', stops, fx, 0x1f6b3a);
              cs.trim = [true, true];
              cs.s = k ? cs.sMax : cs.sMin;
              cs.dir = k ? -1 : 1;
              cs.termDwell = 40;
              cs.dwell = 6 + k * 15;
              cs.circular = true;
              cs.place();
              this.consists.push(cs);
            }
            this.trainTracks.push({ track, color: 0x1f6b3a });
          }
        }
      }
    }

    /* ---- Every stop gets a platform: line the train up beside the mapped one, or build one ---- */
    {
      const onPlatform = (x, z) => this.platforms.some((p) => x >= p.poly.x0 && x <= p.poly.x1 && z >= p.poly.z0 && z <= p.poly.z1 && inPoly(p.poly, x, z));
      const railNear = (x, z) => {
        let d = Infinity;
        segGrid.query(x - 3, x + 3, z - 3, z + 3, (sg) => {
          const dx = sg.bx - sg.ax;
          const dz = sg.bz - sg.az;
          const t = clamp(((x - sg.ax) * dx + (z - sg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
          d = Math.min(d, Math.hypot(x - sg.ax - dx * t, z - sg.az - dz * t));
        });
        return d;
      };
      const roadAt = (x, z) => {
        const n = world.graph.nearest(x, z, 15);
        return !!n && n.d < n.e.w / 2 + 0.5;
      };
      const q = {};
      const across = (track, s) => {
        track.at(s, q);
        const l = Math.hypot(q.tx, q.tz) || 1;
        return { x: q.x, z: q.z, nx: q.tz / l, nz: -q.tx / l };
      };
      // How much of a train standing at lead-car position `lead` has a platform beside it
      const coverage = (cs, lead) => {
        let best = 0;
        for (const side of [1, -1]) {
          let hit = 0;
          let n = 0;
          for (let s = lead - cs.span - cs.K.L / 2; s <= lead + cs.K.L / 2; s += 5) {
            const p = across(cs.track, s);
            n++;
            if (onPlatform(p.x + p.nx * 3 * side, p.z + p.nz * 3 * side)) hit++;
          }
          best = Math.max(best, hit / n);
        }
        return best;
      };
      // A new platform beside the track, on whichever side (and spot nearby) is clear
      const IN = 1.75;
      const W = 5;
      const build = (cs, lead, terminus = false) => {
        const len = cs.span + cs.K.L + 10;
        let best = null;
        for (const ds of terminus ? [0, 15, 30, 50, 75] : [0, 15, -15, 30, -30, 50, -50, 75, -75]) {
          const c = lead - cs.span / 2 + ds;
          if (c - len / 2 < 2 || c + len / 2 > cs.track.len - 2 || (!terminus && lead + ds <= cs.sMin + 1) || lead + ds >= cs.sMax - 1) continue;
          for (const side of [1, -1]) {
            // a full-width platform, or a narrow island where the next track is close
            for (const w of [W, 3.4, 2.6]) {
              let bad = 0;
              let n = 0;
              for (let s = c - len / 2; s <= c + len / 2; s += 6) {
                const p = across(cs.track, s);
                for (const o of [IN + 0.5, IN + w / 2, IN + w - 0.2]) {
                  const x = p.x + p.nx * o * side;
                  const z = p.z + p.nz * o * side;
                  n++;
                  if (railNear(x, z) < 1.9 || world.collideCircle(x, z, 0.4) || world.overWater(x, z) || roadAt(x, z) || onPlatform(x, z)) bad++;
                }
              }
              const score = bad / n + Math.abs(ds) * 0.0008 + (W - w) * 0.01;
              if (!best || score < best.score) best = { score, c, side, ds, w };
            }
          }
          if (best && best.score < 0.08) break;
        }
        if (!best || best.score > 0.4) return null;
        const inner = [];
        const outer = [];
        for (let s = best.c - len / 2; ; s += 4) {
          const ss = Math.min(s, best.c + len / 2);
          const p = across(cs.track, ss);
          inner.push(p.x + p.nx * IN * best.side, p.z + p.nz * IN * best.side);
          outer.push(p.x + p.nx * (IN + best.w) * best.side, p.z + p.nz * (IN + best.w) * best.side);
          if (ss >= best.c + len / 2) break;
        }
        const ring = [...inner];
        for (let i = outer.length - 2; i >= 0; i -= 2) ring.push(outer[i], outer[i + 1]);
        const before = this.platforms.length;
        addPlatform(ring);
        return this.platforms.length > before ? lead + best.ds : null;
      };
      const drop = [];
      for (const cs of this.consists) {
        if (cs.kind !== 'train' && cs.kind !== 'express') continue;
        const out = [];
        for (const st of cs.stops) {
          // Howrah and Sealdah: the terminus, where the train can only move up the platform road
          const terminus = st <= cs.sMin + 1 && !cs.circular;
          // the far end of a main line is out past the mapped city (and the Circular's ends are trimmed)
          if ((st <= cs.sMin + 1 && !terminus) || st >= cs.sMax - 1) {
            out.push(st);
            continue;
          }
          let best = { ds: 0, cov: coverage(cs, st) };
          if (best.cov < 0.8) {
            for (let k = 5; k <= (terminus ? 200 : 150); k += 5) {
              for (const ds of terminus ? [k] : [k, -k]) {
                if ((!terminus && st + ds <= cs.sMin + 1) || st + ds >= cs.sMax - 1) continue;
                const cov = coverage(cs, st + ds);
                if (cov > best.cov + 0.05) best = { ds, cov };
              }
            }
          }
          if (best.cov >= 0.55) out.push(st + best.ds);
          else {
            const s2 = build(cs, st, terminus);
            // nowhere to put a platform: better not to stop here at all (a terminus keeps its buffer stop)
            if (s2 !== null) out.push(s2);
            else if (terminus) drop.push(cs); // stuck in the yard with no platform: no service from here
          }
        }
        cs.setStops(out);
        if (cs.trim) cs.trimEnds(...cs.trim);
        if (cs.circular) cs.s = cs.dir < 0 ? cs.endB : cs.endA;
        else if (cs.s < cs.endA) cs.s = cs.endA;
        cs.place();
      }
      for (const cs of drop) {
        for (const c of cs.cars) scene.remove(c.root);
        this.consists.splice(this.consists.indexOf(cs), 1);
      }
    }
    /* ---- Platform numbers: every face with a track beside it, counted across each station ---- */
    {
      const railAt = (x, z) => {
        let d = Infinity;
        segGrid.query(x - 3, x + 3, z - 3, z + 3, (sg) => {
          const dx = sg.bx - sg.ax;
          const dz = sg.bz - sg.az;
          const t = clamp(((x - sg.ax) * dx + (z - sg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
          d = Math.min(d, Math.hypot(x - sg.ax - dx * t, z - sg.az - dz * t));
        });
        return d;
      };
      const q = {};
      const byStation = new Map();
      for (const p of this.platforms) {
        p.faces = [];
        p.hw = 0;
        // look along the platform (a long or curving one may only have a track beside part of it)
        for (const side of [1, -1]) {
          for (const k of [0.5, 0.35, 0.65, 0.2, 0.8]) {
            p.spine.at(p.len * k, q);
            const l = Math.hypot(q.tx, q.tz) || 1;
            const nx = (q.tz / l) * side;
            const nz = (-q.tx / l) * side;
            // out to the platform edge, then look for the track beyond it
            let w = 0.5;
            while (w < 15 && inPoly(p.poly, q.x + nx * w, q.z + nz * w)) w += 0.25;
            p.hw = Math.max(p.hw, w);
            let found = null;
            for (let o = 1; o <= 2.6 && !found; o += 0.4) {
              const x = q.x + nx * (w + o);
              const z = q.z + nz * (w + o);
              if (railAt(x, z) < 0.8) found = { side, w, x, z, nx, nz, p, k };
            }
            if (found) {
              p.faces.push(found);
              break;
            }
          }
        }
        if (!byStation.has(p.name)) byStation.set(p.name, []);
        byStation.get(p.name).push(...p.faces);
      }
      // Across each station. The map gives the real numbers for most platforms (Howrah 1-23,
      // Sealdah 1-21; an island is tagged "6;7"). Faces on the same track share its number, which
      // settles which side of an island is which; anything left is filled in between its
      // neighbours or counted on, platform 1 nearest the station building.
      for (const [name, faces] of byStation) {
        if (!faces.length) continue;
        const r = faces[0];
        const dOf = (x, z) => (x - r.x) * r.nx + (z - r.z) * r.nz;
        for (const f of faces) f.d = dOf(f.x, f.z);
        // the same track: within a metre or so across, and alongside each other
        const twins = (f) => faces.filter((o) => o !== f && o.p !== f.p && Math.hypot(o.x - f.x, o.z - f.z) < f.p.len / 2 + o.p.len / 2 && railAt((o.x + f.x) / 2, (o.z + f.z) / 2) < 3 && Math.abs(o.d - f.d) < 1.5);
        const plats = [...new Set(faces.map((f) => f.p))];
        const refd = plats.filter((p) => p.ref);
        // islands: a face takes the number its track shares with the platform across it
        for (const p of refd) {
          const mine = faces.filter((f) => f.p === p);
          for (const f of mine) {
            for (const o of twins(f)) {
              const common = o.p.ref && p.ref.find((n) => o.p.ref.includes(n));
              if (common) f.no = common;
            }
          }
          if (p.ref.length > 1 && mine.length === 2) {
            const [a, b] = mine;
            if (a.no && !b.no) b.no = p.ref.find((n) => n !== a.no);
            if (b.no && !a.no) a.no = p.ref.find((n) => n !== b.no);
          }
        }
        // still open: the side towards the nearest lower-numbered platform takes the lower number
        for (const p of refd) {
          const mine = faces.filter((f) => f.p === p && !f.no);
          if (!mine.length) continue;
          const pd = dOf(p.cx, p.cz);
          const nb = refd.filter((o) => o !== p).sort((a, b) => Math.abs(dOf(a.cx, a.cz) - pd) - Math.abs(dOf(b.cx, b.cz) - pd))[0];
          const lowSide = nb ? Math.sign(dOf(nb.cx, nb.cz) - pd) * (nb.ref[0] < p.ref[0] ? 1 : -1) : 1;
          if (p.ref.length === 1) {
            const n = p.ref[0];
            const both = faces.filter((f) => f.p === p);
            if (mine.length === 2 && Math.abs(mine[0].d - mine[1].d) >= 1.5) {
              // tracks both sides but one number: the map left out its neighbour (Howrah 22 beside 23)
              const free = (k) => k > 0 && !plats.some((o) => o.ref && o.ref.includes(k)) && !faces.some((f) => f.no === k);
              const [lo, hi] = free(n - 1) ? [n - 1, n] : free(n + 1) ? [n, n + 1] : [n, n];
              for (const f of mine) f.no = (f.d - pd) * lowSide > 0 ? lo : hi;
            } else for (const f of mine) f.no = both.find((f) => f.no)?.no || n;
            continue;
          }
          const taken = faces.filter((f) => f.p === p && f.no).map((f) => f.no);
          for (const f of mine) {
            const want = (f.d - pd) * lowSide > 0 ? p.ref[0] : p.ref[p.ref.length - 1];
            f.no = taken.includes(want) ? p.ref.find((n) => !taken.includes(n)) || want : want;
          }
        }
        for (const f of faces) if (!f.no) for (const o of twins(f)) if (o.no) f.no = o.no;
        // which way the numbers run across the station
        let dir = 1;
        const numbered = faces.filter((f) => f.no);
        if (numbered.length > 1) {
          const md = numbered.reduce((a, f) => a + f.d, 0) / numbered.length;
          const mn = numbered.reduce((a, f) => a + f.no, 0) / numbered.length;
          dir = numbered.reduce((a, f) => a + (f.d - md) * (f.no - mn), 0) >= 0 ? 1 : -1;
        } else {
          const st = railStations.filter((o) => boardName(o.n) === name).reduce((a, o) => (!a || Math.hypot(o.x - r.x, o.z - r.z) < Math.hypot(a.x - r.x, a.z - r.z) ? o : a), null);
          const ds = faces.map((f) => f.d);
          if (st) dir = Math.abs(dOf(st.x, st.z) - Math.min(...ds)) <= Math.abs(dOf(st.x, st.z) - Math.max(...ds)) ? 1 : -1;
        }
        const ordered = [...faces].sort((a, b) => (a.d - b.d) * dir);
        // a gap in the numbers (a platform the map left unnumbered) is filled in order
        const used = new Set(faces.map((f) => f.no).filter(Boolean));
        let next = Math.max(0, ...used);
        let last = null;
        ordered.forEach((f, i) => {
          if (f.no) return;
          if (last && Math.abs(f.d - last.d) < 1.5) {
            f.no = last.no;
            return;
          }
          const prev = ordered.slice(0, i).reverse().find((o) => o.no);
          const after = ordered.slice(i + 1).find((o) => o.no);
          const lo = prev ? prev.no : 0;
          const hi = after ? after.no : Infinity;
          let n = lo + 1;
          while (used.has(n) && n < hi) n++;
          if (n >= hi || used.has(n)) {
            // no number free between its neighbours: the far side of a platform that already has
            // one is a siding, left without a sign; otherwise count on past the highest
            if (faces.some((o) => o.p === f.p && o.no)) return;
            n = ++next;
          }
          f.no = n;
          used.add(n);
          last = f;
        });
        for (const p of plats) p.faces = p.faces.filter((f) => f.no);
      }
      this.platformFaces = byStation;
    }
    const platMat = new THREE.MeshStandardMaterial({ color: 0xe2dacb, map: T.sidewalk(), roughness: 0.9 });
    for (const [b, m] of [[platTop, platMat], [platSide, platMat], [edge, M.yellow]]) {
      const g = b.geometry();
      if (g) statics.push(new THREE.Mesh(g, m));
    }
    if (posts.length || benches.length) statics.push(new THREE.Mesh(merge([...posts, ...benches]), M.dark));
    if (canopy.length) statics.push(new THREE.Mesh(merge(canopy), new THREE.MeshStandardMaterial({ color: 0x8a3a2c, roughness: 0.7 })));

    /* ---- Trams on the longest tram lines, under overhead wires ---- */
    const tadj = railGraph(trams);
    const tends = [...tadj.keys()].filter((n) => tadj.get(n).size === 1);
    const tpaths = tends.map((n) => walkRail(tadj, n, null, 6000, 0.7)).filter((p) => p.len > 700).sort((a, b) => b.len - a.len);
    const lines = [];
    // distinct routes: a line that mostly runs beside one already chosen (the other track
    // of a double-track route) doesn't count
    const near = (p, l) => {
      const L = l.poly || (l.poly = new Poly(l.nodes.flatMap(nodeXZ)));
      let close = 0;
      let all = 0;
      for (let i = 0; i < p.nodes.length; i += 3) {
        const [x, z] = nodeXZ(p.nodes[i]);
        all++;
        if (L.project(x, z).d < 25) close++;
      }
      return close / Math.max(1, all);
    };
    for (const p of tpaths) {
      if (lines.length >= 3) break;
      if (lines.some((l) => overlap(p, l) > 0.4 || near(p, l) > 0.5)) continue;
      lines.push(p);
    }
    const wire = [];
    this.tramStops = [];
    const stopPosts = [];
    const namedPois = MAP.pois.filter((p) => ['area', 'landmark', 'station', 'metro', 'market', 'college', 'park'].includes(p.k));
    const stopName = (x, z) => {
      let best = null;
      for (const p of namedPois) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < 260 && (!best || d < best.d)) best = { d, n: p.n.replace(/\s*\(.*?\)/, '') };
      }
      if (best) return best.n;
      const e = world.graph.nearest(x, z, 60);
      return e && e.e.name ? e.e.name : 'Tram Stop';
    };
    for (const p of lines) {
      const track = new Track(p.nodes.map(nodeXZ), 4);
      const stops = [];
      const q0 = {};
      for (let s = 300; s < track.len - 200; s += 340) {
        stops.push(s);
        track.at(s, q0);
        const name = stopName(q0.x, q0.z);
        if (this.tramStops.some((t) => t.name === name && Math.hypot(t.x - q0.x, t.z - q0.z) < 500)) continue;
        this.tramStops.push({ name, x: q0.x, z: q0.z, track, s });
        const l = Math.hypot(q0.tx, q0.tz) || 1;
        const px = q0.x + (q0.tz / l) * 3.6;
        const pz = q0.z - (q0.tx / l) * 3.6;
        stopPosts.push({ x: px, z: pz, yaw: Math.atan2(q0.tx, q0.tz) });
      }
      // two trams a line, running opposite ways
      for (const k of [0, 1]) {
        const tram = new Consist(scene, track, 'tram', stops, fx);
        tram.s = k ? tram.sMax - 5 : tram.sMin + 5;
        tram.dir = k ? -1 : 1;
        tram.dwell = 4 + k * 6;
        tram.termDwell = 25;
        tram.place();
        this.trams.push(tram);
        this.consists.push(tram);
      }
      this.tramTracks.push({ track, color: KINDS.tram.color });
      wire.push(...alongTrack(track, 20, (len) => [box(0.025, 0.025, len, 0, 6.0, 0)]));
      const q = {};
      for (let s = 10; s < track.len; s += 50) {
        track.at(s, q);
        const l = Math.hypot(q.tx, q.tz) || 1;
        const tx = q.tx / l;
        const tz = q.tz / l;
        const poleOk = [1, -1].filter((side) => !world.collideCircle(q.x + tz * 6.5 * side, q.z - tx * 6.5 * side, 0.4));
        for (const side of poleOk) {
          const px = q.x + tz * 6.5 * side;
          const pz = q.z - tx * 6.5 * side;
          wire.push(new THREE.CylinderGeometry(0.09, 0.13, 7.2, 8).translate(px, 3.6, pz));
          wire.push(rod([px, 6.75, pz], [q.x, 6.75, q.z], 0.02, 4), rod([q.x, 6.75, q.z], [q.x, 6.02, q.z], 0.012, 4));
        }
      }
    }
    if (wire.length) statics.push(new THREE.Mesh(merge(wire), M.wire));
    // Tram stop posts with a blue sign
    if (stopPosts.length) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#1f56b8';
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold 40px "Kohinoor Bangla", "Bangla MN", "Noto Sans Bengali", Arial';
      g.fillText('ট্রাম স্টপ', 128, 40);
      g.font = 'bold 34px Arial';
      g.fillText('TRAM STOP', 128, 94);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const signMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 });
      const poles = [];
      for (const sp of stopPosts) {
        if (world.collideCircle(sp.x, sp.z, 0.3)) continue;
        poles.push(new THREE.CylinderGeometry(0.05, 0.05, 3.3, 6).translate(sp.x, 1.65, sp.z));
        world.addStationLamp(sp.x, 3.32, sp.z, sp.yaw, 1.2, 0, 5);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), signMat);
        b.position.set(sp.x, 2.5, sp.z);
        b.rotation.y = sp.yaw + Math.PI / 2;
        statics.push(b);
      }
      if (poles.length) statics.push(new THREE.Mesh(merge(poles), M.dark));
    }
    this.tram = this.trams[0];

    for (const m of statics) {
      m.receiveShadow = true;
      m.castShadow = m.material !== M.steel && m.material !== bedMat;
      scene.add(m);
      m.updateMatrixWorld(true);
      m.matrixAutoUpdate = false;
    }
    this.caps = [];
    this.objs = [];
    this.obstacleList = [];
  }

  /** Lines and stations for the map. */
  mapLayers() {
    const pts = (t) => t.x.filter((_, i) => i % 10 === 0).map((x, i) => [x, t.z[i * 10]]);
    const lines = [];
    for (const r of MAP.rails) {
      if (r.k !== 'rail' || r.tn) continue;
      lines.push({ pts: r.n.map(nodeXZ), color: '#8f949b', width: 1.5 });
    }
    for (const { track } of this.tramTracks) lines.push({ pts: pts(track), color: '#3f86d8', width: 3 });
    const stations = this.stations.map(([n, x, z]) => ({ x, z, color: '#f4c51c', name: n }));
    return { lines, stations };
  }

  /** Traffic treats rail cars as obstacles. */
  obstacles() {
    let i = 0;
    for (const cs of this.consists) {
      if (cs.K.under) continue;
      for (const c of cs.cars) {
        const o = this.obstacleList[i] || (this.obstacleList[i] = { pos: { x: 0, z: 0 }, def: { hl: 0 } });
        o.pos.x = c.x;
        o.pos.z = c.z;
        o.def.hl = cs.K.L / 2;
        i++;
      }
    }
    this.obstacleList.length = i;
    return this.obstacleList;
  }

  /** Rail cars as oriented boxes, for bullets. */
  boxes(out) {
    for (const cs of this.consists) {
      const K = cs.K;
      for (const c of cs.cars) out.push({ x: c.x, y: K.y + (K.roof + K.base) / 2, z: c.z, yaw: c.yaw, hw: K.hw, hh: (K.roof - K.base) / 2, hl: K.L / 2, rail: cs });
    }
    return out;
  }

  update(dt, night, ctx) {
    const { player, peds, vehicles, traffic, game, audio } = ctx;
    const focus = player.focus;
    const near = (p) => Math.hypot(p.x - focus.x, p.z - focus.z);
    // Things the AI driver brakes for
    const objs = this.objs;
    objs.length = 0;
    const under = player.mode === 'foot' && player.pos.y < -2.5;
    if (player.mode === 'foot' && !under) objs.push({ x: player.pos.x, z: player.pos.z, r: 0.6, y: player.pos.y });
    for (const v of vehicles) if (!v.rail && !v.boat) objs.push({ x: v.pos.x, z: v.pos.z, r: v.def.hw + 0.3 });
    for (const c of traffic.cars) objs.push({ x: c.x, z: c.z, r: c.def.hw + 0.3 });
    const aiCtx = { objs, audio, near, consists: this.consists, game };
    // Underground trains only meet the player (and each other)
    const underCtx = { objs: under ? [{ x: player.pos.x, z: player.pos.z, r: 0.6, y: player.pos.y }] : [], audio, near: (p) => (player.pos.y < -2.5 ? near(p) : 999), consists: this.consists, game };
    for (const cs of this.consists) {
      // a driven train is updated by the player; it still needs the audio and HUD
      cs.env = cs.K.under ? underCtx : aiCtx;
      if (cs === player.vehicle && player.mode === 'driving') continue;
      cs.update(dt, null, night, cs.K.under ? underCtx : aiCtx);
    }
    // Collisions: rail cars are effectively immovable
    const caps = this.caps;
    caps.length = 0;
    for (const cs of this.consists) cs.capsules(caps);
    for (const c of caps) {
      const cs = c.consist;
      const cvx = cs.vel.x;
      const cvz = cs.vel.y;
      const moving = cs.speed > 2.5;
      // Player on foot
      if (player.mode === 'foot' && !player.dead) {
        const q = closestOnSeg(c, player.pos.x, player.pos.z);
        const dx = player.pos.x - q.x;
        const dz = player.pos.z - q.z;
        const d = Math.hypot(dx, dz);
        const rr = c.r + 0.35;
        if (d < rr && d > 1e-4 && player.pos.y < cs.K.y + cs.K.roof && player.pos.y > cs.K.y - 2) {
          player.pos.x += (dx / d) * (rr - d);
          player.pos.z += (dz / d) * (rr - d);
          if (moving) {
            player.knockDown(cvx * 0.8 + (dx / d) * 4, cvz * 0.8 + (dz / d) * 4);
            player.hurt(cs.speed * 5, q.x, q.z);
          }
        }
      }
      if (cs.K.under) continue;
      // Pedestrians
      for (const n of peds.list) {
        if (n.state === 'dead' && !moving) continue;
        const q = closestOnSeg(c, n.x, n.z);
        const dx = n.x - q.x;
        const dz = n.z - q.z;
        const d = Math.hypot(dx, dz);
        const rr = c.r + 0.35;
        if (d >= rr || d < 1e-4) continue;
        n.x += (dx / d) * (rr - d);
        n.z += (dz / d) * (rr - d);
        if (moving && n.state !== 'dead') peds.damage(n, cs.speed * 8, cvx * 0.8 + (dx / d) * 3, cvz * 0.8 + (dz / d) * 3, null, 'vehicle');
      }
      // Road vehicles (boats are on the water: a train beside the river never touches them)
      for (const v of vehicles) {
        if (v.rail || v.boat) continue;
        const fx = Math.sin(v.yaw);
        const fz = Math.cos(v.yaw);
        for (const off of v.def.offs) {
          const px = v.pos.x + fx * off;
          const pz = v.pos.z + fz * off;
          const q = closestOnSeg(c, px, pz);
          const dx = px - q.x;
          const dz = pz - q.z;
          const d = Math.hypot(dx, dz);
          const rr = c.r + v.def.rad;
          if (d >= rr || d < 1e-4) continue;
          const nx = dx / d;
          const nz = dz / d;
          v.pos.x += nx * (rr - d);
          v.pos.z += nz * (rr - d);
          v.asleep = false;
          const vn = (v.vel.x - cvx) * nx + (v.vel.y - cvz) * nz;
          if (vn < 0) {
            v.vel.x -= 1.6 * vn * nx;
            v.vel.y -= 1.6 * vn * nz;
            v.angVel += (Math.random() - 0.5) * -vn * 0.05;
            v.impact = Math.max(v.impact, -vn);
            cs.impact = Math.max(cs.impact, -vn);
            crashDamage(v, -vn * 1.6);
            if (-vn > 4) this.fx.sparks(q.x + nx * c.r, 0.9, q.z + nz * c.r, -vn);
          }
        }
      }
      // AI traffic gets shoved loose
      if (cs.speed > 0.5) {
        for (const t of [...traffic.cars]) {
          const fx = Math.sin(t.yaw);
          const fz = Math.cos(t.yaw);
          let hit = null;
          for (const off of t.def.offs) {
            const q = closestOnSeg(c, t.x + fx * off, t.z + fz * off);
            const dx = t.x + fx * off - q.x;
            const dz = t.z + fz * off - q.z;
            const d = Math.hypot(dx, dz);
            if (d < c.r + t.def.rad && d > 1e-4) hit = { nx: dx / d, nz: dz / d };
          }
          if (!hit) continue;
          const vel = new THREE.Vector2(cvx * 1.1 + hit.nx * 4, cvz * 1.1 + hit.nz * 4);
          const v = game.adoptTrafficCar(t, vel, (Math.random() - 0.5) * 2);
          crashDamage(v, cs.speed * 2);
          this.fx.sparks(t.x, 0.9, t.z, cs.speed);
        }
      }
    }
  }
}
