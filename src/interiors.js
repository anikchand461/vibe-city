import * as THREE from 'three';
import { merge } from './utils.js';

/*
 * Vehicle interiors: the cabin you see from your own seat (C to the inside view).
 *
 * Every vehicle body is a solid shell with dark glass, so the cabin is a separate,
 * lightweight set of meshes: inner walls with the window and door openings cut out,
 * floor, ceiling, seats, dashboards, poles, fans and lamps. It is built the first
 * time someone sits inside that kind of vehicle (geometry cached per layout,
 * materials shared), and only shown while the camera is in the cabin, when the
 * outer shell of that one vehicle or rail car is hidden.
 *
 * Seats line up with where characters already sit: the driver's seat (def.seatX /
 * seatZ / seatY) and passengerSeat() on the road; on the rails, each layout lists
 * its seats so a boarding passenger sits down in a real one.
 *
 *  - Ambassador taxi (and the white Ambassador): bench seats in white covers,
 *    wooden-brown dash, the big thin steering wheel, a fare meter in the taxi
 *  - City bus: rows of two-seaters, barred open windows, grab rails and straps,
 *    the driver's seat beside the engine cover, a LADIES sign over the door side
 *  - Kolkata tram: teak panelling and ceiling fans; first class (front car) has
 *    cushioned forward-facing seats, second class wooden benches along the walls
 *  - EMU local: facing benches in bays, barred windows, luggage racks, fans,
 *    open doorways
 *  - Rajdhani coach: AC three-tier berths in bays, side berths, reading lamps
 *  - Metro: steel benches along the walls, poles, hanging handles, line map
 */

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);
function rod(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}
/** A seat back standing on (x, y, z), leaning back by `tilt` (face: which way the seat looks, ±1 along z). */
function seatBack(w, h, t, x, y, z, face, tilt = 0.14) {
  return new THREE.BoxGeometry(w, h, t).translate(0, h / 2, 0).rotateX(-tilt * face).translate(x, y, z);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------- Materials ---------- */
// glow: emissive always on (lamps, the Metro's lit cabin); night: extra emissive after dark
const MAT_DEFS = {
  floor: { color: 0x3a3b3d, roughness: 0.95 },
  woodFloor: { color: 0x5b4330, roughness: 0.85 },
  rubber: { color: 0x1f2022, roughness: 0.95 },
  ceiling: { color: 0xeeeae0, roughness: 0.8, night: 0.18 },
  frame: { color: 0x2a2b2e, roughness: 0.6, metalness: 0.4 },
  chrome: { color: 0xd9dce0, roughness: 0.2, metalness: 1 },
  steel: { color: 0xb9bdc2, roughness: 0.3, metalness: 0.85 },
  lamp: { color: 0xffffff, emissive: 0xfff6e2, glow: 0.9, night: 1.6 },
  // Ambassador
  ambyPanel: { color: 0xc9bd9b, roughness: 0.7, night: 0.08 },
  ambyCover: { color: 0xf1ede2, roughness: 0.9, night: 0.08 },
  ambyDash: { color: 0x4a3222, roughness: 0.55, metalness: 0.1 },
  gauge: { color: 0xf4f0e2, emissive: 0xffe9b8, glow: 0.15, night: 0.6 },
  meter: { color: 0x200000, emissive: 0xff2a1a, glow: 1.2, night: 1.5 },
  // bus
  busWall: { color: 0x8fb3a6, roughness: 0.6, night: 0.12 },
  busSeat: { color: 0x2d5f92, roughness: 0.5, night: 0.08 },
  // tram
  teak: { color: 0x7a4b28, roughness: 0.55, night: 0.1 },
  slat: { color: 0x9a6a3c, roughness: 0.6, night: 0.08 },
  tramSeat: { color: 0x2f6b4c, roughness: 0.55, night: 0.08 },
  // EMU
  emuWall: { color: 0xb7c2bc, roughness: 0.6, night: 0.15 },
  emuSeat: { color: 0x3f6f9a, roughness: 0.55, night: 0.08 },
  // Rajdhani
  coachWall: { color: 0xe3d9c3, roughness: 0.7, night: 0.15 },
  berth: { color: 0x2c4d8c, roughness: 0.6, night: 0.08 },
  curtain: { color: 0x8c3a2e, roughness: 0.9, night: 0.06 },
  // Metro (underground: lit day and night)
  metroWall: { color: 0xe7e9eb, roughness: 0.5, glow: 0.22 },
  metroFloor: { color: 0x575a5e, roughness: 0.9, glow: 0.12 },
  metroSeat: { color: 0xc3c7cb, roughness: 0.25, metalness: 0.8, glow: 0.1 },
  priority: { color: 0xb8322a, roughness: 0.4, metalness: 0.5, glow: 0.12 },
  glass: { color: 0x9fc3cf, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.12, depthWrite: false },
};
const MATS = {};
function mat(key) {
  if (MATS[key]) return MATS[key];
  const { glow = 0, night = 0, ...opts } = MAT_DEFS[key];
  const m = new THREE.MeshStandardMaterial(opts);
  if (!opts.emissive && (glow || night)) m.emissive.set(opts.color);
  m.emissiveIntensity = glow;
  m.userData.glow = glow;
  m.userData.night = night;
  return (MATS[key] = m);
}
const TEX_MATS = {};
function texMat(key, make) {
  if (!TEX_MATS[key]) {
    const t = make();
    TEX_MATS[key] = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6 });
    TEX_MATS[key].userData.glow = 0.25;
    TEX_MATS[key].userData.night = 0.5;
  }
  return TEX_MATS[key];
}

/** Interior lamps and surfaces brighten after dark. */
export function setInteriorNight(night) {
  for (const m of [...Object.values(MATS), ...Object.values(TEX_MATS)]) m.emissiveIntensity = m.userData.glow + night * m.userData.night;
}

/* ---------- Signs ---------- */
function ladiesSign() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#f4efe2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3261e';
    g.font = 'bold 30px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('মহিলা  LADIES', w / 2, h / 2 + 2);
  });
}
function classSign() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#16233d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c21b';
    g.font = 'bold 28px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('প্রথম শ্রেণী  1st CLASS', w / 2, h / 2 + 2);
  });
}
const BLUE_LINE = ['Dakshineswar', 'Noapara', 'Dum Dum', 'Belgachia', 'Shyambazar', 'Shobhabazar', 'Girish Park', 'M.G. Road', 'Central', 'Chandni Chowk', 'Esplanade', 'Park Street', 'Maidan', 'Rabindra Sadan', 'Netaji Bhavan', 'Jatin Das Park', 'Kalighat', 'Rabindra Sarobar', 'Tollygunge', 'Netaji', 'Masterda Surya Sen', 'Gitanjali', 'Kavi Nazrul', 'Shahid Khudiram', 'Kavi Subhash'];
const GREEN_LINE = ['Howrah Maidan', 'Howrah', 'Mahakaran', 'Esplanade', 'Sealdah', 'Phoolbagan', 'Salt Lake Stadium', 'Bengal Chemical', 'City Centre', 'Central Park', 'Karunamoyee', 'Sector V'];
function lineMap(green) {
  const names = green ? GREEN_LINE : BLUE_LINE;
  const col = green ? '#1f9a4a' : '#1f4fbf';
  return canvasTex(2048, 96, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = col;
    g.fillRect(0, 0, w, 12);
    const x0 = 40;
    const x1 = w - 40;
    g.fillRect(x0, 40, x1 - x0, 8);
    g.textAlign = 'center';
    g.font = '15px Arial';
    names.forEach((n, i) => {
      const x = x0 + ((x1 - x0) * i) / (names.length - 1);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, 44, 9, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = col;
      g.stroke();
      g.fillStyle = '#1b1b1b';
      g.fillText(n, x, i % 2 ? 84 : 72);
    });
  });
}

/* ---------- Layout building blocks ---------- */
/** Collects geometry per material key, plus fans, seats and text panels. */
class Layout {
  constructor() {
    this.parts = new Map();
    this.fans = [];
    this.spots = [];
    this.signs = [];
    this.hood = null;
  }
  add(key, ...geos) {
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(...geos.filter(Boolean));
  }
  /** A place to sit: hip position (car-local x, z), cushion top y, and the way it faces (yaw offset). */
  spot(x, z, y, face) {
    this.spots.push({ x, z, y, face });
  }
  sign(material, w, h, x, y, z, ry) {
    this.signs.push({ material, geo: new THREE.PlaneGeometry(w, h), x, y, z, ry });
  }
  done() {
    this.geos = [...this.parts].map(([key, list]) => [key, merge(list)]).filter(([, g]) => g);
    this.parts = null;
    return this;
  }
}

/**
 * Wall pieces covering [a, b] × [y0, y1] except the openings ({ a, b, lo, hi }).
 * place(s0, s1, ya, yb) turns one closed rectangle into a box.
 */
function wallWithHoles(a, b, y0, y1, holes, place) {
  const cuts = new Set([a, b]);
  for (const h of holes) {
    if (h.a > a && h.a < b) cuts.add(h.a);
    if (h.b > a && h.b < b) cuts.add(h.b);
  }
  const xs = [...cuts].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const s0 = xs[i];
    const s1 = xs[i + 1];
    if (s1 - s0 < 1e-3) continue;
    const mid = (s0 + s1) / 2;
    const open = holes
      .filter((h) => mid > h.a && mid < h.b)
      .map((h) => [Math.max(y0, h.lo), Math.min(y1, h.hi)])
      .sort((p, q) => p[0] - q[0]);
    let y = y0;
    for (const [lo, hi] of open) {
      if (lo > y + 1e-3) out.push(place(s0, s1, y, lo));
      y = Math.max(y, hi);
    }
    if (y1 > y + 1e-3) out.push(place(s0, s1, y, y1));
  }
  return out;
}

const T = 0.05; // inner wall thickness
/**
 * A boxy cabin: side walls with windows and doorways, end walls, floor and ceiling.
 * o: { hw, z0, z1, floor, ceil, winLo, winHi, win: { 1: [[a, b]], -1: [...] }, doors: { 1: [...], -1: [...] },
 *      doorTop, ends: { 1: [holes across x], -1: [...] }, wall, floorMat, bars: [y...], glass }
 */
function cabin(L, o) {
  const walls = [];
  for (const sx of [1, -1]) {
    const holes = [...(o.win[sx] || []).map(([a, b]) => ({ a, b, lo: o.winLo, hi: o.winHi })), ...((o.doors && o.doors[sx]) || []).map(([a, b]) => ({ a, b, lo: o.floor - 0.1, hi: o.doorTop }))];
    walls.push(...wallWithHoles(o.z0, o.z1, o.floor, o.ceil, holes, (s0, s1, ya, yb) => box(T, yb - ya, s1 - s0, sx * (o.hw + T / 2), (ya + yb) / 2, (s0 + s1) / 2)));
    for (const [a, b] of o.win[sx] || []) {
      // sill and bars across the open windows
      L.add('frame', box(0.1, 0.04, b - a, sx * (o.hw - 0.02), o.winLo + 0.02, (a + b) / 2));
      for (const y of o.bars || []) L.add('chrome', box(0.02, 0.02, b - a, sx * (o.hw + 0.01), y, (a + b) / 2));
      if (o.glass) L.add('glass', box(0.01, o.winHi - o.winLo, b - a, sx * (o.hw + 0.03), (o.winLo + o.winHi) / 2, (a + b) / 2));
    }
  }
  for (const sz of [1, -1]) {
    const z = sz > 0 ? o.z1 : o.z0;
    walls.push(...wallWithHoles(-o.hw - T, o.hw + T, o.floor, o.ceil, (o.ends && o.ends[sz]) || [], (s0, s1, ya, yb) => box(s1 - s0, yb - ya, T, (s0 + s1) / 2, (ya + yb) / 2, z + (sz * T) / 2)));
  }
  L.add(o.wall, ...walls);
  const len = o.z1 - o.z0;
  const mz = (o.z0 + o.z1) / 2;
  L.add(o.floorMat || 'floor', box(o.hw * 2, 0.05, len, 0, o.floor - 0.025, mz));
  L.add('ceiling', box(o.hw * 2, 0.05, len, 0, o.ceil + 0.025, mz));
}

/** Two-, three-seat bench across the car (x from xa to xb), facing ±z; hips at zHip. */
function crossBench(L, xa, xb, zHip, face, top, floor, cushion, spotX) {
  const w = Math.abs(xb - xa);
  const xc = (xa + xb) / 2;
  L.add(cushion, box(w, 0.1, 0.46, xc, top - 0.05, zHip + face * 0.06));
  L.add(cushion, seatBack(w, 0.55, 0.08, xc, top - 0.02, zHip - face * 0.2, face));
  L.add('frame', box(w - 0.1, top - 0.1 - floor, 0.06, xc, (top - 0.1 + floor) / 2, zHip + face * 0.18));
  L.add('chrome', box(w, 0.03, 0.03, xc, top + 0.56, zHip - face * 0.28));
  if (spotX != null) L.spot(spotX, zHip, top, face > 0 ? 0 : Math.PI);
}
/** Bench along the wall on side sx from za to zb, facing the aisle. */
function wallBench(L, sx, wallX, za, zb, top, floor, cushion, slats = false) {
  const len = zb - za;
  const zc = (za + zb) / 2;
  const x = sx * (wallX - 0.25);
  if (slats) for (const k of [-0.15, 0, 0.15]) L.add(cushion, box(0.13, 0.05, len, x + sx * k, top - 0.025, zc));
  else L.add(cushion, box(0.46, 0.1, len, x, top - 0.05, zc));
  L.add(cushion, box(0.06, 0.5, len, sx * (wallX - 0.03), top + 0.3, zc));
  L.add('frame', box(0.06, top - 0.1 - floor, len, sx * (wallX - 0.42), (top - 0.1 + floor) / 2, zc));
  for (let z = za + 0.3; z < zb - 0.2; z += 0.55) L.spot(sx * (wallX - 0.3), z, top, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
}
function pole(L, x, z, y0, y1, key = 'chrome') {
  L.add(key, rod([x, y0, z], [x, y1, z], 0.022));
}
/** A grab rail along z with hanging handles. */
function strapRail(L, x, y, za, zb, every = 0.5, key = 'chrome') {
  L.add(key, rod([x, y, za], [x, y, zb], 0.018));
  for (let z = za + every / 2; z < zb; z += every) {
    L.add('rubber', box(0.025, 0.2, 0.025, x, y - 0.11, z));
    L.add('rubber', new THREE.TorusGeometry(0.06, 0.012, 4, 10).translate(x, y - 0.27, z));
  }
}
function tube(L, x, y, za, zb) {
  L.add('lamp', box(0.08, 0.03, zb - za, x, y - 0.02, (za + zb) / 2));
}

/* ---------- Road vehicles ---------- */
function ambassador(taxi) {
  const L = new Layout();
  const floor = 0.22;
  // floor, door cards, parcel shelf, firewall
  L.add('rubber', box(1.56, 0.04, 2.6, 0, floor - 0.02, -0.45));
  for (const sx of [1, -1]) {
    L.add('ambyPanel', box(0.04, 0.8, 2.6, sx * 0.8, 0.6, -0.45));
    L.add('ambyPanel', box(0.08, 0.05, 0.55, sx * 0.75, 0.78, 0.05), box(0.08, 0.05, 0.55, sx * 0.75, 0.78, -0.95));
    L.add('chrome', box(0.03, 0.03, 0.12, sx * 0.77, 0.86, 0.35), box(0.03, 0.03, 0.12, sx * 0.77, 0.86, -0.6));
    // pillars round the windows
    L.add('ambyPanel', rod([sx * 0.76, 1.0, 0.9], [sx * 0.74, 1.46, 0.52], 0.035));
    L.add('ambyPanel', box(0.06, 0.48, 0.1, sx * 0.76, 1.24, -0.12));
    L.add('ambyPanel', box(0.06, 0.48, 0.22, sx * 0.76, 1.24, -1.18));
    L.add('ambyPanel', rod([sx * 0.74, 1.0, -1.34], [sx * 0.72, 1.48, -0.8], 0.04));
    L.add('ambyPanel', box(0.04, 0.05, 2.0, sx * 0.77, 1.0, -0.2));
  }
  L.add('ceiling', box(1.56, 0.04, 1.38, 0, 1.48, -0.14));
  L.add('ambyPanel', box(1.56, 0.04, 0.5, 0, 1.0, -1.56), box(1.56, 0.8, 0.04, 0, 0.6, -1.8));
  L.add('ambyPanel', box(1.56, 0.6, 0.04, 0, 0.5, 0.9));
  // dashboard: wood-brown fascia, chrome strip, the round speedo in front of the driver
  L.add('ambyDash', box(1.56, 0.24, 0.32, 0, 0.88, 0.75));
  L.add('chrome', box(1.36, 0.02, 0.02, 0, 0.82, 0.585));
  L.add('gauge', new THREE.CylinderGeometry(0.085, 0.085, 0.02, 20).rotateX(Math.PI / 2).translate(0.38, 0.9, 0.59));
  L.add('chrome', new THREE.TorusGeometry(0.09, 0.012, 6, 20).translate(0.38, 0.9, 0.585));
  L.add('frame', box(0.4, 0.13, 0.01, -0.42, 0.86, 0.586));
  // the big, thin steering wheel and its column
  L.add('frame', new THREE.TorusGeometry(0.2, 0.016, 6, 24).rotateX(0.42).translate(0.38, 0.97, 0.3));
  L.add('frame', new THREE.BoxGeometry(0.38, 0.02, 0.02).rotateX(0.42).translate(0.38, 0.97, 0.3), rod([0.38, 0.97, 0.3], [0.38, 0.84, 0.62], 0.025));
  L.add('frame', box(0.2, 0.06, 0.02, 0, 1.39, 0.5));
  if (taxi) {
    // the fare meter on the dash
    L.add('frame', box(0.2, 0.11, 0.1, -0.18, 1.06, 0.74));
    L.add('meter', box(0.15, 0.045, 0.005, -0.18, 1.07, 0.688));
  }
  // bench seats, front and back, in white covers
  L.add('ambyCover', box(1.42, 0.12, 0.5, 0, 0.49, -0.12), seatBack(1.42, 0.56, 0.1, 0, 0.53, -0.43, 1, 0.16));
  L.add('ambyCover', box(1.5, 0.12, 0.5, 0, 0.49, -1.12), seatBack(1.5, 0.52, 0.1, 0, 0.53, -1.42, 1, 0.2));
  L.add('frame', box(1.4, 0.3, 0.06, 0, 0.36, 0.1), box(1.48, 0.3, 0.06, 0, 0.36, -0.9));
  // the bonnet, seen over the dash
  L.hood = merge([box(1.62, 0.08, 1.22, 0, 0.98, 1.52), box(0.08, 0.1, 1.2, 0.78, 0.95, 1.52), box(0.08, 0.1, 1.2, -0.78, 0.95, 1.52)]);
  return L.done();
}

function cityBus() {
  const L = new Layout();
  const hw = 1.2;
  const floor = 0.82;
  const ceil = 3.0;
  const winLo = 1.62;
  const winHi = 2.78;
  const panes = [[-5.3, -3.95], [-3.85, -2.5], [-2.4, -1.05], [-0.95, 0.4], [0.5, 1.85], [1.95, 3.2]];
  const backDoor = [0.25, 1.45];
  const frontDoor = [4.38, 5.52];
  const clear = ([a, b]) => b <= backDoor[0] || a >= backDoor[1];
  cabin(L, {
    hw,
    z0: -5.95,
    z1: 5.95,
    floor,
    ceil,
    winLo,
    winHi,
    win: { 1: [...panes, [4.4, 5.5]], [-1]: panes.filter(clear) },
    doors: { [-1]: [backDoor, frontDoor] },
    doorTop: 2.7,
    ends: { 1: [{ a: -1.12, b: 1.12, lo: 1.55, hi: 2.62 }], [-1]: [{ a: -0.95, b: 0.95, lo: 1.97, hi: 2.72 }] },
    wall: 'busWall',
    floorMat: 'woodFloor',
    bars: [1.95, 2.3],
  });
  // rows of two-seaters; the long bench across the back
  const top = floor + 0.45;
  for (let z = -4.7; z < 3.6; z += 0.8) {
    crossBench(L, 0.24, 1.17, z, 1, top, floor, 'busSeat', 0.6);
    const legs = [z - 0.3, z + 0.5];
    if (legs[1] < backDoor[0] - 0.1 || legs[0] > backDoor[1] + 0.1) crossBench(L, -1.17, -0.24, z, 1, top, floor, 'busSeat', -0.6);
  }
  crossBench(L, -1.17, 1.17, -5.5, 1, top, floor, 'busSeat', 0);
  // driver: seat beside the engine cover, the flat wheel, dash under the windscreen
  crossBench(L, 0.3, 0.8, 4.85, 1, top, floor, 'busSeat');
  L.add('frame', box(0.75, 0.6, 1.1, -0.2, floor + 0.3, 5.3));
  L.add('busWall', box(2.3, 0.7, 0.4, 0, floor + 0.35, 5.75));
  L.add('frame', box(2.3, 0.06, 0.45, 0, floor + 0.72, 5.72));
  L.add('frame', new THREE.TorusGeometry(0.25, 0.02, 6, 24).rotateX(1.15).translate(0.55, floor + 0.92, 5.3));
  L.add('frame', rod([0.55, floor + 0.92, 5.3], [0.55, floor + 0.5, 5.65], 0.03));
  L.add('chrome', rod([0.95, floor, 4.45], [0.95, ceil, 4.45], 0.022), rod([-0.3, floor + 0.9, 4.45], [1.2, floor + 0.9, 4.45], 0.02));
  // grab rails with straps, poles by the doors, tube lights
  for (const x of [0.45, -0.45]) strapRail(L, x, 2.72, -5.2, 4.2, 0.6);
  for (const z of [backDoor[0] - 0.05, backDoor[1] + 0.05, frontDoor[0] - 0.05]) pole(L, -0.95, z, floor, ceil);
  for (const z of [-3.2, 0.2, 3.0]) tube(L, 0, ceil, z - 0.6, z + 0.6);
  L.sign(texMat('ladies', ladiesSign), 0.9, 0.22, -hw + 0.03, 2.88, 2.6, Math.PI / 2);
  return L.done();
}

/* ---------- Rail ---------- */
/** Kolkata tram: car 0 is first class (cushioned, facing forward), car 1 second class (wooden wall benches). */
function tram(K, first, cabF, cabB) {
  const L = new Layout();
  const hw = K.hw - 0.06;
  const h2 = K.L / 2;
  const floor = K.floor;
  const ceil = 2.95;
  const win = [];
  for (let u = 0.5; u < K.L - 0.9; u += 1.05) {
    if (u + 0.85 > h2 - 0.6 - 0.08 && u < h2 + 0.6 + 0.08) continue;
    win.push([h2 - u - 0.85, h2 - u]);
  }
  const door = [-0.6, 0.6];
  const end = [{ a: -0.85, b: 0.85, lo: 1.4, hi: 2.5 }];
  cabin(L, { hw, z0: -h2 + 0.05, z1: h2 - 0.05, floor, ceil, winLo: 1.35, winHi: 2.55, win: { 1: win, [-1]: win }, doors: { 1: [door], [-1]: [door] }, doorTop: 2.75, ends: { 1: end, [-1]: end }, wall: 'teak', floorMat: 'woodFloor', bars: [1.75, 2.15] });
  // vertical grille bars in the windows
  for (const sx of [1, -1]) for (const [a, b] of win) for (let z = a + 0.12; z < b; z += 0.14) L.add('frame', box(0.015, 1.2, 0.015, sx * (hw + 0.02), 1.95, z));
  const top = floor + 0.45;
  const zMax = h2 - (cabF ? 1.0 : 0.3);
  const zMin = -h2 + (cabB ? 1.0 : 0.3);
  if (first) {
    for (let z = zMin + 0.3; z < zMax - 0.3; z += 0.8) {
      if (z + 0.3 > door[0] - 0.25 && z - 0.25 < door[1] + 0.25) continue;
      crossBench(L, 0.28, hw - 0.03, z, 1, top, floor, 'tramSeat', 0.75);
      crossBench(L, -hw + 0.03, -0.28, z, 1, top, floor, 'tramSeat', -0.75);
    }
    L.sign(texMat('class', classSign), 0.9, 0.22, 0, ceil - 0.2, zMax - 0.05, Math.PI);
  } else {
    for (const sx of [1, -1]) {
      wallBench(L, sx, hw, zMin, door[0] - 0.25, top, floor, 'slat', true);
      wallBench(L, sx, hw, door[1] + 0.25, zMax, top, floor, 'slat', true);
    }
    for (const x of [0.7, -0.7]) strapRail(L, x, 2.7, zMin, zMax, 0.5, 'teak');
  }
  // driver's platform: controller and brake handle at each cab end
  for (const [cab, sz] of [[cabF, 1], [cabB, -1]]) {
    if (!cab) continue;
    const z = sz * (h2 - 0.45);
    L.add('frame', box(0.35, 0.9, 0.3, 0.35, floor + 0.45, z), rod([0.35, floor + 0.9, z], [0.35, floor + 1.15, z - sz * 0.1], 0.02));
    L.add('chrome', rod([-hw, floor + 1.0, sz * (h2 - 0.9)], [hw, floor + 1.0, sz * (h2 - 0.9)], 0.02));
  }
  for (const sx of [1, -1]) for (const z of [door[0], door[1]]) pole(L, sx * (hw - 0.15), z, floor, ceil);
  for (const z of [-h2 / 2, h2 / 2]) {
    L.fans.push([0, ceil, z]);
    tube(L, 0.5, ceil, z - 0.5, z + 0.5);
  }
  return L.done();
}

/** EMU local: facing benches in bays between three open doorways a side. */
function emu(K, cabF, cabB) {
  const L = new Layout();
  const hw = K.hw - 0.06;
  const h2 = K.L / 2;
  const floor = K.floor;
  const ceil = 3.82;
  const winLo = 2.1;
  const winHi = 3.16;
  const doors = [K.L * 0.3, 0, -K.L * 0.3].map((d) => [d - 0.65, d + 0.65]);
  const win = [];
  for (let k = 0; k <= doors.length; k++) {
    // the same panes the side artwork paints, between the doorways
    const a = k === 0 ? 0.6 : h2 - doors[k - 1][0] + 0.25;
    const b = k === doors.length ? K.L - 0.6 : h2 - doors[k][1] - 0.25;
    for (let u = a + 0.12; u + 0.95 <= b; u += 1.16) win.push([h2 - u - 0.95, h2 - u]);
  }
  const end = (cab) => (cab ? [{ a: -1.3, b: -0.2, lo: 2.3, hi: 3.2 }, { a: 0.2, b: 1.3, lo: 2.3, hi: 3.2 }] : [{ a: -0.6, b: 0.6, lo: floor, hi: 3.3 }]);
  cabin(L, { hw, z0: -h2 + 0.05, z1: h2 - 0.05, floor, ceil, winLo, winHi, win: { 1: win, [-1]: win }, doors: { 1: doors, [-1]: doors }, doorTop: 3.5, ends: { 1: end(cabF), [-1]: end(cabB) }, wall: 'emuWall', bars: [2.45, 2.8] });
  const top = floor + 0.45;
  // zones between the doorways (and the cabs) filled with bays of facing benches
  const lim = [h2 - (cabF ? 2.0 : 0.15), ...doors.flatMap(([a, b]) => [b + 0.55, a - 0.55]), -h2 + (cabB ? 2.0 : 0.15)];
  for (let i = 0; i < lim.length; i += 2) {
    const hi = lim[i];
    const lo = lim[i + 1];
    const n = Math.floor((hi - lo) / 1.7);
    const s0 = (hi + lo) / 2 - (n * 1.7) / 2;
    for (let k = 0; k < n; k++) {
      const s = s0 + k * 1.7;
      for (const sx of [1, -1]) {
        const xa = sx * 0.4;
        const xb = sx * (hw - 0.03);
        crossBench(L, xa, xb, s + 0.32, 1, top, floor, 'emuSeat', sx * (hw - 0.4));
        crossBench(L, xa, xb, s + 1.38, -1, top, floor, 'emuSeat', sx * (hw - 0.4));
      }
    }
  }
  // cab bulkheads with their doors, luggage racks, grab rails, fans and tube lights
  for (const [cab, sz] of [[cabF, 1], [cabB, -1]]) {
    if (!cab) continue;
    const z = sz * (h2 - 1.6);
    L.add('emuWall', ...wallWithHoles(-hw, hw, floor, ceil, [{ a: -0.4, b: 0.4, lo: floor, hi: 3.0 }], (s0, s1, ya, yb) => box(s1 - s0, yb - ya, T, (s0 + s1) / 2, (ya + yb) / 2, z)));
    L.add('frame', box(0.8, 2.0, 0.04, 0, floor + 1.0, z), box(0.4, 0.3, 0.01, 0, floor + 1.55, z - sz * 0.03));
  }
  for (const sx of [1, -1]) {
    L.add('steel', box(0.45, 0.03, K.L - 0.4, sx * (hw - 0.25), 3.35, 0));
    for (let z = -h2 + 0.6; z < h2 - 0.4; z += 1.5) L.add('steel', box(0.03, 0.18, 0.03, sx * (hw - 0.45), 3.27, z));
    strapRail(L, sx * 0.15, 3.55, -h2 + 0.4, h2 - 0.4, 0.55);
  }
  for (const [a, b] of doors) for (const sx of [1, -1]) for (const z of [a - 0.06, b + 0.06]) pole(L, sx * (hw - 0.08), z, floor + 0.3, 3.3);
  for (let z = -h2 + 2; z < h2 - 1.5; z += 2.5) {
    L.fans.push([0.95, ceil, z], [-0.95, ceil, z]);
    tube(L, 0, ceil, z + 0.5, z + 1.6);
  }
  return L.done();
}

/** Rajdhani AC three-tier coach: bays of six berths with side berths across the aisle. */
function rajdhani(K) {
  const L = new Layout();
  const hw = K.hw - 0.06;
  const h2 = K.L / 2;
  const floor = K.floor;
  const ceil = 3.95;
  const win = [];
  for (let u = 2.4; u + 1.1 < K.L - 2.4; u += 1.6) win.push([h2 - u - 1.1, h2 - u]);
  const vest = h2 - 2.1;
  const end = [{ a: -0.45, b: 0.45, lo: floor, hi: 3.3 }];
  cabin(L, { hw, z0: -h2 + 0.05, z1: h2 - 0.05, floor, ceil, winLo: 2.14, winHi: 2.93, win: { 1: win, [-1]: win }, doors: { 1: [[h2 - 1.8, h2 - 0.9], [-h2 + 0.9, -h2 + 1.8]], [-1]: [[h2 - 1.8, h2 - 0.9], [-h2 + 0.9, -h2 + 1.8]] }, doorTop: 3.3, ends: { 1: end, [-1]: end }, wall: 'coachWall', glass: true });
  // vestibule bulkheads with a doorway each
  for (const sz of [1, -1]) L.add('coachWall', ...wallWithHoles(-hw, hw, floor, ceil, [{ a: -0.45, b: 0.45, lo: floor, hi: 3.2 }], (s0, s1, ya, yb) => box(s1 - s0, yb - ya, T, (s0 + s1) / 2, (ya + yb) / 2, sz * vest)));
  const n = Math.floor((vest * 2) / 2.15);
  const s0 = -(n * 2.15) / 2;
  const xa = hw - 0.02;
  const xb = -0.35;
  const w = xa - xb;
  const xc = (xa + xb) / 2;
  const top = floor + 0.45;
  for (let k = 0; k < n; k++) {
    const s = s0 + k * 2.15;
    // partition at the bay's start, lower berths facing each other, middle berths folded as backrests, upper berths
    L.add('coachWall', box(w, ceil - floor - 0.3, 0.05, xc, (floor + ceil - 0.3) / 2, s));
    for (const [z, face] of [[s + 0.33, 1], [s + 2.15 - 0.33, -1]]) {
      L.add('berth', box(w, 0.1, 0.6, xc, top - 0.05, z + face * 0.02));
      L.add('berth', box(w, 0.6, 0.08, xc, top + 0.4, z - face * 0.3));
      L.add('berth', box(w, 0.08, 0.6, xc, floor + 2.0, z + face * 0.02));
      L.add('frame', box(w - 0.1, top - 0.1 - floor, 0.05, xc, (top - 0.1 + floor) / 2, z + face * 0.28));
      L.spot(0.85, z - face * 0.08, top, face > 0 ? 0 : Math.PI);
    }
    // side berths along the far wall, with a curtain rail
    L.add('berth', box(0.6, 0.1, 1.9, -hw + 0.32, top - 0.05, s + 1.07), box(0.6, 0.08, 1.9, -hw + 0.32, floor + 1.8, s + 1.07));
    L.add('chrome', rod([-0.4, ceil - 0.1, s + 0.1], [-0.4, ceil - 0.1, s + 2.05], 0.015));
    L.add('curtain', box(0.03, 1.3, 0.35, -0.4, ceil - 0.8, s + 0.3));
    L.add('lamp', box(0.15, 0.05, 0.08, hw - 0.1, floor + 2.3, s + 1.07));
    L.add('steel', rod([-0.3, floor + 0.5, s + 1.07], [-0.3, floor + 2.0, s + 1.07], 0.02));
  }
  for (let z = -vest + 1; z < vest - 1; z += 3) tube(L, -0.6, ceil, z, z + 1.3);
  return L.done();
}

/** Kolkata Metro: steel wall benches between four doorways a side, poles and handles. */
function metroCar(K, cabF, cabB, green) {
  const L = new Layout();
  const hw = K.hw - 0.08;
  const h2 = K.L / 2;
  const floor = K.floor;
  const ceil = 3.3;
  const winLo = floor + 0.85;
  const winHi = 3.05;
  const doors = [-K.L * 0.36, -K.L * 0.12, K.L * 0.12, K.L * 0.36].map((d) => [d - 0.65, d + 0.65]);
  const zf = cabF ? h2 - 1.5 : h2 - 0.05;
  const zb = cabB ? -h2 + 1.5 : -h2 + 0.05;
  const win = [];
  const edges = [zb + 0.3, ...doors.flatMap(([a, b]) => [a - 0.15, b + 0.15]), zf - 0.3];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i];
    const b = edges[i + 1];
    if (b - a < 0.5) continue;
    const n = Math.max(1, Math.round((b - a) / 1.45));
    for (let k = 0; k < n; k++) win.push([a + ((b - a) * k) / n + 0.06, a + ((b - a) * (k + 1)) / n - 0.06]);
  }
  const end = (cab) => (cab ? [{ a: -0.4, b: 0.4, lo: floor + 1.3, hi: floor + 1.8 }] : [{ a: -0.55, b: 0.55, lo: floor, hi: 3.0 }]);
  cabin(L, { hw, z0: zb, z1: zf, floor, ceil, winLo, winHi, win: { 1: win, [-1]: win }, doors: { 1: doors, [-1]: doors }, doorTop: K.roof - 0.5, ends: { 1: end(cabF), [-1]: end(cabB) }, wall: 'metroWall', floorMat: 'metroFloor', glass: true });
  // cab bulkhead door
  for (const [cab, z, sz] of [[cabF, zf, 1], [cabB, zb, -1]]) if (cab) L.add('frame', box(0.8, 2.1, 0.03, 0, floor + 1.05, z - sz * 0.03));
  const top = floor + 0.45;
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i] + 0.15;
    const b = edges[i + 1] - 0.15;
    if (b - a < 0.8) continue;
    for (const sx of [1, -1]) {
      wallBench(L, sx, hw, a, b, top, floor, 'metroSeat');
      // the seats nearest each door are kept for the elderly and ladies (the red ones)
      const pl = Math.min(0.9, (b - a) / 3);
      L.add('priority', box(0.42, 0.02, pl, sx * (hw - 0.25), top + 0.005, a + pl / 2), box(0.42, 0.02, pl, sx * (hw - 0.25), top + 0.005, b - pl / 2));
      L.add('chrome', rod([sx * (hw - 0.5), floor, a], [sx * (hw - 0.5), ceil, a], 0.022), rod([sx * (hw - 0.5), floor, b], [sx * (hw - 0.5), ceil, b], 0.022));
      L.sign(texMat(green ? 'mapG' : 'mapB', () => lineMap(green)), b - a - 0.1, 0.16, sx * (hw - 0.01), winHi + 0.11, (a + b) / 2, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  for (const [a, b] of doors) pole(L, 0, (a + b) / 2, floor, ceil);
  for (const sx of [1, -1]) {
    strapRail(L, sx * 0.55, ceil - 0.15, zb + 0.4, zf - 0.4, 0.45, 'steel');
    tube(L, sx * 0.85, ceil, zb + 0.3, zf - 0.3);
  }
  return L.done();
}

/* ---------- Layout cache and lookups ---------- */
const CACHE = new Map();
function cached(key, make) {
  if (!CACHE.has(key)) CACHE.set(key, make());
  return CACHE.get(key);
}

/** The interior layout for a road vehicle type, or null when it has none (open vehicles show their own seats). */
export function roadLayout(type) {
  if (type === 'taxi' || type === 'ambassador') return cached(type, () => ambassador(type === 'taxi'));
  if (type === 'bus') return cached('bus', cityBus);
  return null;
}

/** The layout for car i of a train, tram or Metro rake (null for the Rajdhani's locomotive). */
export function railLayout(cs, i) {
  const n = cs.cars.length;
  const cabF = i === 0;
  const cabB = i === n - 1;
  const K = cs.K;
  if (cs.kind === 'tram') return cached(`tram:${i === 0}:${cabF}:${cabB}`, () => tram(K, i === 0, cabF, cabB));
  if (cs.kind === 'train') return cached(`emu:${cabF}:${cabB}`, () => emu(K, cabF, cabB));
  if (cs.kind === 'express') return i === 0 ? null : cached('rajdhani', () => rajdhani(K));
  if (cs.kind === 'metro') {
    const c = cs.paint.color;
    const green = c.g > c.b;
    return cached(`metro:${cabF}:${cabB}:${green}`, () => metroCar(K, cabF, cabB, green));
  }
  return null;
}

/** Seats in car i of a rail consist (car-local, y = cushion top). */
export function railSeats(cs, i) {
  const lay = railLayout(cs, i);
  return lay ? lay.spots : [];
}

let FAN = null;
function fanGeo() {
  if (FAN) return FAN;
  const blades = [];
  for (let k = 0; k < 3; k++) blades.push(new THREE.BoxGeometry(0.11, 0.01, 0.55).translate(0, 0, 0.33).rotateY((k * Math.PI * 2) / 3));
  FAN = { rod: new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6).translate(0, -0.15, 0), hub: merge([new THREE.CylinderGeometry(0.08, 0.06, 0.08, 12).translate(0, -0.32, 0), ...blades.map((b) => b.translate(0, -0.33, 0))]) };
  return FAN;
}

function buildGroup(lay, paint) {
  const g = new THREE.Group();
  g.name = 'interior';
  for (const [key, geo] of lay.geos) g.add(new THREE.Mesh(geo, mat(key)));
  if (lay.hood && paint) g.add(new THREE.Mesh(lay.hood, paint));
  const fans = [];
  const F = fanGeo();
  for (const [x, y, z] of lay.fans) {
    const r = new THREE.Mesh(F.rod, mat('frame'));
    r.position.set(x, y, z);
    const hub = new THREE.Mesh(F.hub, mat('frame'));
    hub.position.set(x, y, z);
    g.add(r, hub);
    fans.push(hub);
  }
  for (const s of lay.signs) {
    const m = new THREE.Mesh(s.geo, s.material);
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    g.add(m);
  }
  g.userData.fans = fans;
  return g;
}

/**
 * Shows the cabin of whatever the player is sitting in while the camera is inside,
 * hiding that vehicle's outer shell; puts everything back when the view leaves.
 */
export class Interiors {
  constructor() {
    this.cur = null;
  }
  get active() {
    return !!this.cur;
  }
  /** target: { rec (the car record), parent (group the shell lives in), lay, paint?, keep? } or null. */
  update(dt, target) {
    if ((target && target.rec) !== (this.cur && this.cur.rec)) {
      this.leave();
      if (target) this.enter(target);
    }
    if (this.cur) for (const f of this.cur.rec.interior.userData.fans) f.rotation.y += dt * 9;
  }
  enter({ rec, parent, lay, paint, keep }) {
    if (!rec.interior) {
      rec.interior = buildGroup(lay, paint);
      parent.add(rec.interior);
    }
    const hidden = [];
    for (const c of parent.children) {
      if (c === rec.interior || (keep && keep.has(c)) || !c.visible) continue;
      c.visible = false;
      hidden.push(c);
    }
    rec.interior.visible = true;
    this.cur = { rec, hidden };
  }
  leave() {
    if (!this.cur) return;
    for (const c of this.cur.hidden) c.visible = true;
    this.cur.rec.interior.visible = false;
    this.cur = null;
  }
}

/** What to show for a player in vehicle v (car ci of a rail consist), or null. */
export function interiorTarget(v, ci) {
  if (v.rail) {
    const c = v.cars[ci];
    const lay = c && railLayout(v, ci);
    if (!lay) return null;
    return { rec: c, parent: c.root, lay, keep: new Set((c.meshes.doors || []).map((d) => d.mesh)) };
  }
  const lay = roadLayout(v.type);
  if (!lay || !v.car.body) return null;
  return { rec: v.car, parent: v.car.body, lay, paint: v.car.paint };
}
