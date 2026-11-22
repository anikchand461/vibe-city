import * as THREE from 'three';
import { merge, paint, lerp } from './utils.js';
import { MAP, polygon, inPoly, nearestOnRing } from './geo.js';

/*
 * Kolkata's landmarks, modelled in code and placed on their real OpenStreetMap
 * footprints: Howrah Bridge, Howrah Station, Victoria Memorial, Shaheed Minar,
 * Eden Gardens, St Paul's Cathedral, Nakhoda Mosque and James Prinsep's memorial.
 * They are recognisable sketches at real scale, not survey-exact replicas.
 */

/** Buildings whose OSM footprint is replaced by a model here. */
export const LANDMARK_FOOTPRINTS = [/^victoria memorial$/i, /^howrah junction$/i, /saint paul's anglican cathedral$/i, /^nakhoda mosque$/i, /^writers' building$/i, /^calcutta town hall$/i, /^indian museum$/i, /^kolkata new market$/i, /^birla planetarium$/i, /^marble palace$/i, /^presidency university main building$/i];

/**
 * Heritage buildings modelled from their footprints: colour, height, and the features
 * that make them recognisable (porticoes, colonnades, towers, domes, statues).
 */
const HERITAGE = [
  { re: /^writers' building$/i, H: 21, wall: '#a8432f', trim: '#f0e2c4', floors: 3, portico: { cols: 8, w: 0.18 }, pediments: 3, statues: true },
  { re: /^calcutta town hall$/i, H: 19, wall: '#efe3c6', trim: '#ffffff', floors: 2, portico: { cols: 6, w: 0.45, doric: true } },
  { re: /^indian museum$/i, H: 18, wall: '#e6c8a4', trim: '#fbf3e4', floors: 2, colonnade: true },
  { re: /^kolkata new market$/i, H: 11, wall: '#a8432f', trim: '#efe3c6', floors: 2, tower: { h: 36, clock: true }, arcade: true },
  { re: /^birla planetarium$/i, H: 6, wall: '#f4f1ea', trim: '#ffffff', floors: 1, dome: 0.95, stupa: true },
  { re: /^marble palace$/i, H: 17, wall: '#f1eee6', trim: '#ffffff', floors: 3, portico: { cols: 6, w: 0.4 } },
  { re: /^presidency university main building$/i, H: 20, wall: '#c9b48a', trim: '#f3ead6', floors: 3, portico: { cols: 4, w: 0.25 }, tower: { h: 30 } },
];

/** Real heights where the generic estimate is off. */
const HEIGHTS = [
  [/writers'? building/i, 21],
  [/calcutta town hall/i, 19],
  [/indian museum/i, 18],
  [/esplanade mansions/i, 22],
];
export function adjustBuildings(buildings) {
  for (const b of buildings) if (b.name) for (const [re, h] of HEIGHTS) if (re.test(b.name)) b.h = h;
}

const UP = new THREE.Vector3(0, 1, 0);
const M4 = new THREE.Matrix4();

/** Geometry collected per material key, in a landmark's local frame. */
class Kit {
  constructor() {
    this.parts = {};
  }
  add(k, g, hex) {
    g.deleteAttribute('uv');
    (this.parts[k] ||= []).push(paint(g, hex));
    return g;
  }
  box(k, w, h, d, x, y, z, hex, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    return this.add(k, g.translate(x, y, z), hex);
  }
  cyl(k, rt, rb, h, x, y, z, hex, seg = 16) {
    return this.add(k, new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), hex);
  }
  /** Dome: a hemisphere, optionally stretched up into an onion. */
  dome(k, r, x, y, z, hex, stretch = 1, seg = 20) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, stretch, 1);
    return this.add(k, g.translate(x, y, z), hex);
  }
  /** Square beam from a to b (arrays [x, y, z]). */
  beam(k, a, b, w, hex) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    if (len < 0.01) return null;
    const g = new THREE.BoxGeometry(w, w, len);
    M4.lookAt(B, A, UP);
    g.applyMatrix4(M4);
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return this.add(k, g, hex);
  }
  /** Four-sided pyramid roof. */
  pyramid(k, w, h, x, y, z, hex) {
    const g = new THREE.ConeGeometry(w * 0.7071, h, 4, 1).rotateY(Math.PI / 4).translate(x, y + h / 2, z);
    return this.add(k, g, hex);
  }
  /** Move everything into place: rotate so local +x runs along angle a, then translate. */
  place(cx, cz, a, y = 0) {
    for (const list of Object.values(this.parts)) for (const g of list) g.rotateY(-a).translate(cx, y, cz);
    return this;
  }
}

/** Centre, main axis angle and half extents of a footprint. */
export function frame(flat) {
  const n = flat.length / 2;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += flat[i * 2];
    cz += flat[i * 2 + 1];
  }
  cx /= n;
  cz /= n;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < n; i++) {
    const dx = flat[i * 2] - cx;
    const dz = flat[i * 2 + 1] - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = flat[i * 2] - cx;
    const dz = flat[i * 2 + 1] - cz;
    const u = dx * ux + dz * uz;
    const v = -dx * uz + dz * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  // re-centre on the box middle
  const mu = (u0 + u1) / 2;
  const mv = (v0 + v1) / 2;
  return { cx: cx + ux * mu - uz * mv, cz: cz + uz * mu + ux * mv, a, ux, uz, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2 };
}
/** Oriented rectangle as a flat polygon. */
function rect(cx, cz, a, hu, hv) {
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const out = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(cx + ux * hu * su - uz * hv * sv, cz + uz * hu * su + ux * hv * sv);
  return out;
}
const findB = (re) => MAP.buildings.find((b) => b.name && re.test(b.name));
const findP = (re, k) => MAP.pois.find((p) => re.test(p.n) && (!k || p.k === k));

const WHITE = '#f3f0e9';
const MARBLE = '#ece8df';
const STEEL = '#9aa1a6';
const BRICK = '#a84a33';

export function buildLandmarks(world, scene) {
  const mats = {
    stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }),
    marble: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0, emissive: 0xffd9a8, emissiveIntensity: 0 }),
    steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.65 }),
    glow: world.mats.neonMat,
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
  const kits = [];
  const kit = () => {
    const k = new Kit();
    kits.push(k);
    return k;
  };
  howrahBridge(world, kit());
  vidyasagarSetu(world, kit());
  victoriaMemorial(world, kit());
  shaheedMinar(world, kit());
  howrahStation(world, kit(), scene);
  edenGardens(world, kit());
  stPauls(world, kit());
  nakhoda(world, kit());
  prinsep(world, kit());
  for (const spec of HERITAGE) {
    const b = findB(spec.re);
    if (b) heritage(world, kit(), b, spec, scene);
  }

  const byMat = {};
  for (const k of kits) for (const [m, list] of Object.entries(k.parts)) (byMat[m] ||= []).push(...list);
  for (const [m, list] of Object.entries(byMat)) {
    const mesh = new THREE.Mesh(merge(list), mats[m]);
    mesh.castShadow = m !== 'glow' && m !== 'lamp';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // Monuments are floodlit after dark; stadium lamps come on
  world.updaters.push((dt, t, night) => {
    mats.marble.emissiveIntensity = night * 0.22;
    mats.lamp.color.setScalar(lerp(0.8, 6, night));
  });
}

/* ---------- Howrah Bridge (Rabindra Setu): a cantilever truss with two 82 m towers ---------- */
function howrahBridge(world, K) {
  const deck = world.decks.filter((d) => d.river && /howrah|rabindra/i.test(d.name))[0] || world.decks.filter((d) => d.river && !/vidyasagar/i.test(d.name)).sort((a, b) => b.poly.len - a.poly.len)[0];
  if (!deck || !world.river) return;
  const P = deck.poly;
  const tmp = {};
  let sA = null;
  let sB = null;
  for (let s = 0; s <= P.len; s += 2) {
    P.at(s, tmp);
    if (inPoly(world.river, tmp.x, tmp.z)) {
      if (sA === null) sA = s;
      sB = s;
    }
  }
  if (sA === null) return;
  // Towers stand at the water's edge; the anchor arms reach back over the banks
  const tA = sA + 4;
  const tB = sB - 4;
  const span = tB - tA;
  const cant = span * 0.31;
  const anchor = span * 0.217;
  const s0 = Math.max(0, tA - anchor);
  const s1 = Math.min(P.len, tB + anchor);
  const off = deck.hw - 0.4;
  const topH = (s) => {
    if (s <= tA) return lerp(12, 74, (s - s0) / (tA - s0));
    if (s >= tB) return lerp(74, 12, (s - tB) / (s1 - tB));
    if (s <= tA + cant) return lerp(74, 24, (s - tA) / cant);
    if (s >= tB - cant) return lerp(24, 74, (s - (tB - cant)) / cant);
    const f = (s - (tA + cant)) / (span - 2 * cant);
    return 24 + Math.sin(f * Math.PI) * 6;
  };
  const at = (s, side, h) => {
    P.at(s, tmp);
    const base = deck.y(s);
    return [tmp.x + tmp.tz * off * side, base + h, tmp.z - tmp.tx * off * side];
  };
  // Panel points, including exact tower and cantilever-tip positions
  const marks = new Set([s0, s1, tA, tB, tA + cant, tB - cant]);
  const N = Math.round((s1 - s0) / 14);
  for (let i = 0; i <= N; i++) marks.add(s0 + ((s1 - s0) * i) / N);
  const S = [...marks].sort((a, b) => a - b).filter((s, i, arr) => i === 0 || s - arr[i - 1] > 3);
  for (const side of [1, -1]) {
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const h = topH(s);
      const bot = at(s, side, 0.6);
      const top = at(s, side, h);
      K.beam('steel', bot, top, 0.7, STEEL); // vertical
      if (i === S.length - 1) continue;
      const sn = S[i + 1];
      const hn = topH(sn);
      K.beam('steel', top, at(sn, side, hn), 1.1, STEEL); // top chord
      K.beam('steel', bot, at(sn, side, 0.6), 1.1, STEEL); // bottom chord
      // K-bracing: two diagonals meeting halfway up the next vertical
      K.beam('steel', bot, at(sn, side, hn * 0.5), 0.5, STEEL);
      K.beam('steel', top, at(sn, side, hn * 0.5), 0.5, STEEL);
      // LED strip along the top chord
      K.beam('glow', at(s, side, h + 0.7), at(sn, side, hn + 0.7), 0.18, side > 0 ? '#ffd9a0' : '#a8d8ff');
    }
  }
  // Lateral bracing overhead wherever the trusses are tall enough to clear traffic
  for (let i = 0; i < S.length; i++) {
    const h = topH(S[i]);
    if (h < 11) continue;
    K.beam('steel', at(S[i], 1, h), at(S[i], -1, h), 0.7, STEEL);
    if (h > 30) K.beam('steel', at(S[i], 1, h * 0.55), at(S[i], -1, h * 0.55), 0.6, STEEL);
    if (i < S.length - 1) {
      const hn = topH(S[i + 1]);
      if (hn > 11) K.beam('steel', at(S[i], 1, h), at(S[i + 1], -1, hn), 0.35, STEEL);
    }
  }
  // Towers: heavy legs from the river piers, portal frames, caissons in the water
  for (const t of [tA, tB]) {
    for (const side of [1, -1]) {
      const top = at(t, side, 82);
      const foot = at(t, side, 0);
      foot[1] = -4;
      K.beam('steel', foot, top, 2.4, '#8d9499');
      for (const h of [36, 58, 80]) K.beam('steel', at(t, 1, h), at(t, -1, h), 1.6, '#8d9499');
    }
    P.at(t, tmp);
    const yaw = Math.atan2(tmp.tx, tmp.tz);
    K.box('stone', 9, 8, off * 2 + 9, tmp.x, -3.5, tmp.z, '#7f776b', yaw + Math.PI / 2);
    world.addCircle(tmp.x + tmp.tz * off, tmp.z - tmp.tx * off, 3.5);
    world.addCircle(tmp.x - tmp.tz * off, tmp.z + tmp.tx * off, 3.5);
    (world.boatObstacles ||= []).push({ x: tmp.x, z: tmp.z, r: off + 4 });
  }
  // Footway railings along the deck
  for (const side of [1, -1]) {
    for (let s = s0; s < s1 - 6; s += 6) K.beam('steel', at(s, side * 1.04, 1.4), at(s + 6, side * 1.04, 1.4), 0.12, '#6d7276');
  }
}

/* ---------- Vidyasagar Setu: cable-stayed, 457 m main span, two H pylons, fan stays ---------- */
function vidyasagarSetu(world, K) {
  const deck = world.decks.find((d) => d.river && /vidyasagar/i.test(d.name));
  if (!deck || !world.river) return;
  const P = deck.poly;
  const tmp = {};
  let sA = null;
  let sB = null;
  for (let s = 0; s <= P.len; s += 2) {
    P.at(s, tmp);
    if (inPoly(world.river, tmp.x, tmp.z)) {
      if (sA === null) sA = s;
      sB = s;
    }
  }
  if (sA === null) return;
  const mid = (sA + sB) / 2;
  const MAIN = Math.min(457, (sB - sA) * 0.82);
  const tA = mid - MAIN / 2;
  const tB = mid + MAIN / 2;
  const SIDE = MAIN * 0.4; // the side spans
  const hw = deck.hw;
  const PY = 100; // pylon height above the deck
  const at = (s, side, h) => {
    P.at(s, tmp);
    return [tmp.x + tmp.tz * side, deck.y(s) + h, tmp.z - tmp.tx * side];
  };
  const grey = '#d6d8d6';
  const cable = '#efe6c8';
  // Box girder under the deck, from ramp to ramp over the river
  for (let s = Math.max(0, tA - SIDE - 40); s < Math.min(P.len, tB + SIDE + 40) - 8; s += 8) {
    const a = at(s, 0, -1.6);
    const b = at(s + 8, 0, -1.6);
    K.beam('stone', a, b, 3.2, '#8d918f');
    // edge girders and railings
    for (const side of [1, -1]) {
      K.beam('steel', at(s, side * (hw - 0.3), 0.6), at(s + 8, side * (hw - 0.3), 0.6), 0.25, '#b8bcbf');
      K.beam('steel', at(s, side * (hw - 0.3), -0.8), at(s + 8, side * (hw - 0.3), -0.8), 1.4, '#9da1a3');
    }
  }
  for (const t of [tA, tB]) {
    // two legs rising from caissons in the river, joined by cross-beams: an H
    for (const side of [1, -1]) {
      const foot = at(t, side * (hw + 2.5), 0);
      foot[1] = -4;
      const top = at(t, side * (hw - 2.5), PY);
      K.beam('stone', foot, top, 4.2, grey);
    }
    for (const h of [-3, PY * 0.45, PY - 6]) K.beam('stone', at(t, hw + 2.5 - (h + 4) / (PY + 4) * 5, h), at(t, -(hw + 2.5 - (h + 4) / (PY + 4) * 5), h), 3.2, grey);
    // aviation lights on top
    for (const side of [1, -1]) K.box('glow', 1, 1, 1, 0, 0, 0, '#ff2a2a').translate(...at(t, side * (hw - 2.5), PY + 1));
    P.at(t, tmp);
    K.box('stone', 14, 8, hw * 2 + 14, tmp.x, -3.5, tmp.z, '#7f776b', Math.atan2(tmp.tx, tmp.tz) + Math.PI / 2);
    (world.boatObstacles ||= []).push({ x: tmp.x, z: tmp.z, r: hw + 6 });
    // fans of stay cables in two planes, out over the main span and back over the side span
    const N = 13;
    for (const side of [1, -1]) {
      for (let i = 1; i <= N; i++) {
        const anchor = at(t, side * (hw - 2.5), PY - 4 - i * 2.4);
        const dist = (i / N) * (MAIN / 2 - 6);
        const inward = t === tA ? 1 : -1;
        K.beam('steel', anchor, at(t + inward * dist, side * (hw - 0.5), 0.8), 0.16, cable);
        const back = (i / N) * (SIDE - 6);
        K.beam('steel', at(t, side * (hw - 2.5), PY - 4 - i * 2.4), at(t - inward * back, side * (hw - 0.5), 0.8), 0.16, cable);
      }
    }
  }
  // LED strips along the cables' deck anchors (lit after dark)
  for (const side of [1, -1]) K.beam('glow', at(tA - SIDE, side * (hw - 0.4), 1.2), at(tB + SIDE, side * (hw - 0.4), 1.2), 0.14, '#ffe0a0');
}

/* ---------- A heritage building on its footprint, facing its street ---------- */
function heritage(world, K, b, spec, scene) {
  const f = frame(b.p);
  // which long side faces the nearest main road
  const q = world.graph.nearest(f.cx, f.cz, 200, (e) => e.c <= 4);
  let a = f.a;
  if (q) {
    const vx = q.x - f.cx;
    const vz = q.z - f.cz;
    const along = vx * f.ux + vz * f.uz;
    const across = -vx * f.uz + vz * f.ux;
    // local +z (across) should point at the road; turn the frame if the road is off the short end
    if (Math.abs(along) / Math.max(f.hu, 1) > Math.abs(across) / Math.max(f.hv, 1)) a += along > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (across < 0) a += Math.PI;
  }
  const swap = Math.abs(Math.sin(a - f.a)) > 0.5;
  const hu = swap ? f.hv : f.hu; // half width along the facade
  const hv = swap ? f.hu : f.hv; // half depth
  const { H, wall, trim } = spec;
  const k = 'stone';
  K.box(k, hu * 2, H, hv * 2, 0, H / 2, 0, wall);
  // plinth, string courses at every floor, cornice and a balustrade
  K.box(k, hu * 2 + 0.6, 1.2, hv * 2 + 0.6, 0, 0.6, 0, trim);
  const fh = (H - 1.5) / spec.floors;
  for (let i = 1; i < spec.floors; i++) K.box(k, hu * 2 + 0.3, 0.45, hv * 2 + 0.3, 0, 1.2 + fh * i, 0, trim);
  K.box(k, hu * 2 + 0.9, 0.8, hv * 2 + 0.9, 0, H - 0.2, 0, trim);
  if (!spec.stupa) {
    for (let x = -hu + 0.6; x <= hu - 0.6; x += 1.1) for (const z of [hv + 0.25, -hv - 0.25]) K.box(k, 0.22, 0.9, 0.22, x, H + 0.65, z, trim);
    for (const z of [hv + 0.25, -hv - 0.25]) K.box(k, hu * 2 + 0.5, 0.18, 0.4, 0, H + 1.15, z, trim);
  }
  // windows: tall arched recesses with shutters, front and back, on each floor
  for (let i = 0; i < spec.floors && !spec.stupa; i++) {
    const y = 1.2 + fh * i + fh * 0.5;
    for (let x = -hu + 2.5; x <= hu - 2.5; x += 3.6) {
      for (const z of [hv + 0.03, -hv - 0.03]) {
        K.box(k, 1.5, fh * 0.55, 0.12, x, y, z, '#2a2420');
        K.box(k, 1.9, 0.25, 0.2, x, y + fh * 0.32, z, trim);
      }
    }
  }
  // portico: columns, entablature and a pediment on the street front
  if (spec.portico) {
    const pw = Math.max(12, hu * 2 * spec.portico.w);
    const n = spec.portico.cols;
    const ch = H * 0.82;
    for (let i = 0; i < n; i++) {
      const x = -pw / 2 + (pw * i) / (n - 1);
      K.cyl(k, 0.55, 0.65, ch, x, ch / 2 + 1.2, hv + 3.2, trim, 14);
      K.box(k, 1.5, 0.5, 1.5, x, 1.45, hv + 3.2, trim);
    }
    K.box(k, pw + 2, 1.3, 4.6, 0, ch + 1.85, hv + 2.3, trim);
    K.add(k, new THREE.CylinderGeometry(0.01, (pw + 2) / 2, 4.4, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.55 * (spec.portico.doric ? 0.8 : 1), 1).translate(0, ch + 3.3, hv + 2.3), trim);
    K.box(k, pw + 2, 0.8, 6, 0, 0.4, hv + 3, trim);
    for (let i = 0; i < (spec.pediments || 1) - 1; i++) {
      const x = (i ? 1 : -1) * hu * 0.6;
      K.add(k, new THREE.CylinderGeometry(0.01, 6, 2.4, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.5, 1).translate(x, H + 1.6, hv + 0.4), trim);
    }
  }
  // a colonnade along the whole street front (the Indian Museum)
  if (spec.colonnade) {
    for (let x = -hu + 1.5; x <= hu - 1.5; x += 3.2) K.cyl(k, 0.45, 0.5, H - 2.5, x, (H - 2.5) / 2 + 1.2, hv + 2.6, trim, 12);
    K.box(k, hu * 2, 1, 4, 0, H - 0.8, hv + 2, trim);
  }
  // ground-floor shop arcade (New Market)
  if (spec.arcade) for (let x = -hu + 2; x <= hu - 2; x += 4) K.box(k, 2.8, 3.4, 0.15, x, 2.3, hv + 0.05, '#1e1a17');
  // statues along the parapet (Writers' Building)
  if (spec.statues) for (let x = -hu * 0.8; x <= hu * 0.8; x += hu * 0.4) {
    K.box(k, 1.4, 0.6, 1.4, x, H + 1.5, hv - 0.4, trim);
    K.cyl(k, 0.35, 0.45, 2.4, x, H + 3, hv - 0.4, '#5d5446', 10);
    K.add(k, new THREE.SphereGeometry(0.35, 10, 8).translate(x, H + 4.5, hv - 0.4), '#5d5446');
  }
  // a tower on the street front: clock faces and a pyramid roof (Hogg Market), or a plain tower
  if (spec.tower) {
    const th = spec.tower.h;
    const tw = 6;
    K.box(k, tw, th, tw, 0, th / 2, hv - tw / 2, wall);
    for (const y of [th * 0.45, th - 2]) K.box(k, tw + 0.6, 0.6, tw + 0.6, 0, y, hv - tw / 2, trim);
    K.pyramid(k, tw + 1.2, 6, 0, th, hv - tw / 2, '#5a5f62');
    if (spec.tower.clock) for (const [dx, dz, ry] of [[0, tw / 2 + 0.05, 0], [tw / 2 + 0.05, 0, Math.PI / 2], [-tw / 2 - 0.05, 0, Math.PI / 2]]) {
      const g = new THREE.CylinderGeometry(1.6, 1.6, 0.1, 24).rotateX(Math.PI / 2).rotateY(ry).translate(dx, th - 5, hv - tw / 2 + dz);
      K.add('lamp', g, '#fff6dc');
    }
  }
  // dome (the planetarium's is a Sanchi-stupa shape)
  if (spec.dome) {
    const r = Math.min(hu, hv) * spec.dome;
    K.cyl(k, r, r, 2, 0, H + 1, 0, trim, 32);
    K.dome(spec.stupa ? 'marble' : k, r, 0, H + 2, 0, '#f6f3ec', 0.85, 32);
    K.box(k, 2.4, 1.4, 2.4, 0, H + 2 + r * 0.85 + 0.7, 0, trim);
    K.cyl(k, 0.15, 0.15, 3, 0, H + 2 + r * 0.85 + 2.6, 0, '#c9a24a', 6);
  }
  for (const list of Object.values(K.parts)) for (const g of list) g.rotateY(-a).translate(f.cx, 0, f.cz);
  const col = polygon(rect(f.cx, f.cz, a, hu + 0.4, hv + (spec.portico || spec.colonnade ? 3.8 : 0.4)));
  world.addPoly(col);
  void scene;
}

/* ---------- Victoria Memorial: white Makrana marble, a central dome crowned by the Angel of Victory ---------- */
function victoriaMemorial(world, K) {
  const b = findB(/^victoria memorial$/i);
  const p = findP(/^victoria memorial( hall)?$/i, 'landmark');
  if (!b && !p) return;
  const f = b ? frame(b.p) : { cx: p.x, cz: p.z, a: 0 };
  // Real plan: 103 m by 69 m, the dome's top 56 m up. The long axis runs north-south.
  const a = f.a;
  const m = 'marble';
  K.box(m, 112, 2.4, 78, 0, 1.2, 0, '#e3ded4');
  K.box(m, 106, 1.2, 72, 0, 2.9, 0, '#e8e4db');
  K.box(m, 40, 18, 40, 0, 12.4, 0, MARBLE);
  for (const s of [-1, 1]) {
    K.box(m, 32, 15.5, 26, s * 35, 11.2, 0, MARBLE);
    K.box(m, 22, 15.5, 15, 0, 11.2, s * 27, MARBLE);
    // corner pavilions at the ends of the long wings, each with a chhatri dome
    for (const t of [-1, 1]) {
      K.box(m, 10, 21, 10, s * 47, 14, t * 10, MARBLE);
      K.cyl(m, 3.6, 3.6, 3, s * 47, 26, t * 10, MARBLE, 12);
      K.dome(m, 3.8, s * 47, 27.5, t * 10, '#f5f2ec', 1.1, 14);
      K.cyl(m, 0.25, 0.25, 2.2, s * 47, 32.5, t * 10, '#b8a36a', 6);
    }
    // cornice bands
    K.box(m, 33, 0.8, 27, s * 35, 19.2, 0, '#f6f3ee');
  }
  K.box(m, 41, 1, 41, 0, 21.8, 0, '#f6f3ee');
  // Four small domes round the drum
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
    K.cyl(m, 3.8, 3.8, 4, x, 24, z, MARBLE, 12);
    K.dome(m, 4, x, 26, z, '#f5f2ec', 1.1, 14);
  }
  // Drum, great dome, lantern and the bronze angel
  K.cyl(m, 13.5, 13.5, 9, 0, 26.5, 0, MARBLE, 32);
  K.box(m, 28, 0.6, 28, 0, 31.2, 0, '#f6f3ee');
  K.dome(m, 14.5, 0, 31, 0, '#f2efe8', 1.0, 32);
  K.cyl(m, 3.2, 3.6, 4.5, 0, 47.5, 0, MARBLE, 12);
  K.dome(m, 3.4, 0, 49.7, 0, '#f5f2ec', 1.2, 12);
  K.cyl('stone', 0.6, 0.9, 2.2, 0, 54.8, 0, '#3d3a32', 8);
  K.add('stone', new THREE.ConeGeometry(0.9, 3.2, 8).translate(0, 57.4, 0), '#3d3a32');
  K.box('stone', 3.2, 0.9, 0.25, 0, 58.2, 0, '#3d3a32', 0.3);
  // Columned porch on the north front
  for (let i = -3; i <= 3; i++) K.cyl(m, 0.75, 0.85, 12, i * 3.4, 9.6, -38, '#f6f3ee', 10);
  K.box(m, 26, 2.4, 6, 0, 16.8, -37.5, MARBLE);
  K.add(m, new THREE.CylinderGeometry(0.01, 13.5, 4, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 1, 0.4).translate(0, 19.6, -37.5), '#f6f3ee');
  K.place(f.cx, f.cz, a + Math.PI / 2);
  world.addPoly(polygon(rect(f.cx, f.cz, a + Math.PI / 2, 56, 39)));
}

/* ---------- Shaheed Minar (Ochterlony Monument), 48 m ---------- */
function shaheedMinar(world, K) {
  const p = findP(/^shaheed minar$/i, 'landmark');
  if (!p) return;
  const c = '#efe3c8';
  K.box('stone', 10, 1.2, 10, 0, 0.6, 0, '#d8ccb2');
  K.add('stone', new THREE.CylinderGeometry(3.6, 5.2, 6, 4, 1).rotateY(Math.PI / 4).translate(0, 4.2, 0), c);
  K.cyl('stone', 2.35, 3.0, 30, 0, 22.2, 0, c, 20);
  // fluting rings
  for (let y = 9; y < 37; y += 3.5) K.cyl('stone', 2.55 - (y - 9) * 0.02, 2.6 - (y - 9) * 0.02, 0.35, 0, y, 0, '#e2d4b6', 20);
  K.cyl('stone', 3.6, 3.0, 0.8, 0, 37.6, 0, c, 20);
  K.cyl('stone', 2.2, 2.2, 5, 0, 40.4, 0, c, 16);
  K.cyl('stone', 3.0, 2.6, 0.7, 0, 43.2, 0, c, 16);
  K.cyl('stone', 1.6, 1.6, 2, 0, 44.6, 0, c, 12);
  K.dome('stone', 1.7, 0, 45.5, 0, '#e9dcbd', 1.2, 14);
  K.cyl('stone', 0.06, 0.12, 2.4, 0, 48.2, 0, '#6b5d45', 6);
  K.place(p.x, p.z, 0);
  world.addCircle(p.x, p.z, 5);
}

/* ---------- Howrah Junction: the red-brick headhouse facing the river, and the concourse roof ---------- */
function howrahStation(world, K, scene) {
  const b = findB(/^howrah junction$/i);
  if (!b) return;
  const fp = polygon(b.p);
  const n = fp.n;
  // Runs of nearly straight edges round the outline
  let area2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area2 += fp.xs[j] * fp.zs[i] - fp.xs[i] * fp.zs[j];
  const sgn = area2 > 0 ? 1 : -1;
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = fp.xs[j] - fp.xs[i];
    const dz = fp.zs[j] - fp.zs[i];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const ang = Math.atan2(dz, dx);
    if (cur && Math.abs(Math.atan2(Math.sin(ang - cur.ang), Math.cos(ang - cur.ang))) < 0.15) {
      cur.x1 = fp.xs[j];
      cur.z1 = fp.zs[j];
      cur.len += len;
    } else {
      cur = { x0: fp.xs[i], z0: fp.zs[i], x1: fp.xs[j], z1: fp.zs[j], len, ang };
      runs.push(cur);
    }
  }
  // The facade: the longest run whose outside looks towards the river
  const q = {};
  let best = null;
  for (const r of runs) {
    const tx = (r.x1 - r.x0) / r.len;
    const tz = (r.z1 - r.z0) / r.len;
    const nx = tz * sgn;
    const nz = -tx * sgn;
    const mx = (r.x0 + r.x1) / 2;
    const mz = (r.z0 + r.z1) / 2;
    let face = 1;
    if (world.river) {
      nearestOnRing(world.river, mx, mz, q);
      face = ((q.x - mx) * nx + (q.z - mz) * nz) / (q.d || 1);
    }
    const score = r.len * (face > 0.4 ? 1 : 0.1);
    if (!best || score > best.score) best = { ...r, nx, nz, tx, tz, mx, mz, score };
  }
  const D = 30;
  const W = Math.min(best.len - 10, 330);
  const a = Math.atan2(best.nz, best.nx); // local +x = out of the facade
  const hc = { x: best.mx - best.nx * D / 2, z: best.mz - best.nz * D / 2 };
  world.station = { a, ux: best.nx, uz: best.nz, W, depth: D, headCentre: hc, footprint: b.p };
  const H = 19;
  const wallMat = 'stone';
  // Front and back walls with three entrance arcades each
  const gaps = [-W * 0.3, 0, W * 0.3];
  const gapW = 14;
  const segs = [];
  let v = -W / 2;
  for (const g of gaps) {
    segs.push([v, g - gapW / 2]);
    v = g + gapW / 2;
  }
  segs.push([v, W / 2]);
  for (const [v0, v1] of segs) {
    const len = v1 - v0;
    const mid = (v0 + v1) / 2;
    for (const side of [1, -1]) {
      const x = side * (D / 2 - 1.5);
      K.box(wallMat, 3, H, len, x, H / 2, mid, BRICK);
      for (const y of [5.5, 11.5, 17.5]) K.box(wallMat, 3.4, 0.6, len, x + side * 0.1, y, mid, '#efe8da');
      for (let w = v0 + 3; w < v1 - 2; w += 5) for (const y of [3, 9, 15]) K.box(wallMat, 0.4, 3.2, 2.2, side * (D / 2 + 0.05), y, w, '#2a2622');
    }
  }
  for (const g of gaps) {
    for (const side of [1, -1]) {
      K.box(wallMat, 3, H - 8, gapW, side * (D / 2 - 1.5), 8 + (H - 8) / 2, g, BRICK);
      K.box(wallMat, 3.2, 1.2, gapW, side * (D / 2 - 1.4), 8.2, g, '#efe8da');
    }
  }
  K.box(wallMat, D, 1, W, 0, H + 0.5, 0, '#5a3b30');
  K.box(wallMat, D, H, 3, 0, H / 2, W / 2 - 1.5, BRICK);
  K.box(wallMat, D, H, 3, 0, H / 2, -W / 2 + 1.5, BRICK);
  // Six towers along the front: the two clock towers with red-tile roofs, two with red
  // domes on arcaded drums, and the corner towers
  const towers = [-0.42, -0.25, -0.08, 0.08, 0.25, 0.42];
  const TILE = '#a8432f';
  const CREAM = '#efe3c6';
  towers.forEach((t, i) => {
    const z = t * W;
    const clock = i === 2 || i === 3;
    const domed = i === 1 || i === 4;
    const th = clock ? 36 : domed ? 30 : 27;
    K.box(wallMat, 9, th, 9, D / 2 - 3, th / 2, z, BRICK);
    for (const y of [th - 4, 12]) K.box(wallMat, 9.6, 0.8, 9.6, D / 2 - 3, y, z, CREAM);
    for (const y of [8, 15, 22]) K.box(wallMat, 0.4, 3, 2, D / 2 + 1.55, y, z, '#2a2622');
    if (domed) {
      K.cyl(wallMat, 3.6, 3.8, 4, D / 2 - 3, th + 2, z, CREAM, 12);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        K.box(wallMat, 0.3, 2.4, 1.2, D / 2 - 3 + Math.cos(ang) * 3.75, th + 1.8, z + Math.sin(ang) * 3.75, '#2a2622', -ang);
      }
      K.dome(wallMat, 3.9, D / 2 - 3, th + 4, z, '#b5402e', 1.15, 16);
      K.cyl(wallMat, 0.08, 0.18, 2.5, D / 2 - 3, th + 9.6, z, '#3a3a3a', 6);
    } else {
      K.pyramid(wallMat, 10.4, clock ? 7 : 5.5, D / 2 - 3, th, z, TILE);
    }
  });
  // Cream arch frames round the ground-floor arcade, and a balustrade along the roofline
  for (let v = -W / 2 + 6; v < W / 2 - 4; v += 7) {
    if (towers.some((t) => Math.abs(t * W - v) < 6)) continue;
    K.box(wallMat, 0.35, 0.6, 5.2, D / 2 + 0.05, 6.4, v, CREAM);
    for (const s of [-1, 1]) K.box(wallMat, 0.35, 6, 0.6, D / 2 + 0.05, 3, v + s * 2.6, CREAM);
  }
  K.box(wallMat, 0.6, 1.1, W, D / 2 - 0.3, H + 1.0, 0, CREAM);
  for (let v = -W / 2 + 1; v < W / 2; v += 1.2) K.box(wallMat, 0.25, 0.9, 0.25, D / 2 - 0.3, H + 0.45, v, CREAM);
  // Rooftop letters on a steel frame: হাওড়া · हावड़ा · HOWRAH
  for (const v of [-16, 0, 16]) K.box(wallMat, 0.25, 7, 0.25, D / 2 - 6, H + 3.5, v, '#3a3a3a');
  K.box(wallMat, 0.25, 0.25, 38, D / 2 - 6, H + 6.5, 0, '#3a3a3a');
  K.place(hc.x, hc.z, a);
  const toW = (lx, lz) => [hc.x + Math.cos(a) * lx - Math.sin(a) * lz, hc.z + Math.sin(a) * lx + Math.cos(a) * lz];
  // The rooftop sign
  {
    const c = document.createElement('canvas');
    c.width = 1400;
    c.height = 160;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 1400, 160);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#f4ece0';
    g.fillStyle = '#c4201f';
    g.font = 'bold 104px "Kohinoor Bangla", "Bangla MN", "Noto Sans Bengali", Arial';
    g.strokeText('হাওড়া', 220, 84);
    g.fillText('হাওড়া', 220, 84);
    g.font = 'bold 96px "Kohinoor Devanagari", "Noto Sans Devanagari", Arial';
    g.strokeText('हावड़ा', 680, 84);
    g.fillText('हावड़ा', 680, 84);
    g.font = 'bold 104px Arial';
    g.strokeText('HOWRAH', 1140, 86);
    g.fillText('HOWRAH', 1140, 86);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(38, 4.4), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, emissive: 0xff3020, emissiveMap: tex, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    const [sx, sz] = toW(D / 2 - 5.8, 0);
    sign.position.set(sx, H + 4.3, sz);
    sign.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
    scene.add(sign);
  }
  // Clock faces on the two central towers
  const clockTex = clockTexture();
  const clockMat = new THREE.MeshStandardMaterial({ map: clockTex, emissive: 0xfff2d0, emissiveMap: clockTex, emissiveIntensity: 0.4 });
  for (const i of [2, 3]) {
    const [x, z] = toW(D / 2 - 3 + 4.6, towers[i] * W);
    const c = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), clockMat);
    c.position.set(x, 28, z);
    c.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
    scene.add(c);
  }
  // Colliders: walls with the entrance gaps, solid ends and towers
  for (const lx of [D / 2 - 1.5, -D / 2 + 1.5]) {
    for (const [v0, v1] of segs) {
      const [ax, az] = toW(lx, v0);
      const [bx, bz] = toW(lx, v1);
      world.addWall(ax, az, bx, bz, 1.6);
    }
  }
  for (const lz of [W / 2 - 1.5, -W / 2 + 1.5]) {
    const [ax, az] = toW(-D / 2, lz);
    const [bx, bz] = toW(D / 2, lz);
    world.addWall(ax, az, bx, bz, 1.6);
  }
  for (const t of towers) {
    const [x, z] = toW(D / 2 - 3, t * W);
    world.addPoly(polygon(rect(x, z, a, 4.6, 4.6)));
  }
  // Concourse roof over the rest of the station, held up on columns
  const contour = [];
  for (let i = 0; i < b.p.length; i += 2) contour.push(new THREE.Vector2(b.p[i], b.p[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [];
  for (const [i, j, k] of tris) for (const m of [i, j, k]) pos.push(contour[m].x, 13, contour[m].y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const roof = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }));
  roof.castShadow = true;
  roof.receiveShadow = true;
  scene.add(roof);
  const hcPoly = polygon(rect(hc.x, hc.z, a, D / 2 + 1, W / 2 + 1));
  for (let x = fp.x0 + 10; x < fp.x1; x += 22) {
    for (let z = fp.z0 + 10; z < fp.z1; z += 22) {
      if (!inPoly(fp, x, z) || inPoly(hcPoly, x, z) || world.collideCircle(x, z, 2)) continue;
      K.cyl('steel', 0.35, 0.4, 13, x, 6.5, z, '#4a4f55', 8);
      world.addCircle(x, z, 0.4);
      // lights hung from the roof beside each column
      for (const o of [-5.5, 5.5]) world.addStationLamp(x + Math.cos(a) * o, 12.9, z + Math.sin(a) * o, Math.PI / 2 - a, 7, 0, 13);
    }
  }
}

function clockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f2e4';
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#2a2622';
  g.stroke();
  g.fillStyle = '#2a2622';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillRect(128 + Math.sin(a) * 100 - 4, 128 - Math.cos(a) * 100 - 10, 8, 20);
  }
  g.lineCap = 'round';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(128, 128);
  g.lineTo(128 + 55, 128 - 30);
  g.stroke();
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(128, 128);
  g.lineTo(128 - 20, 128 - 90);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- Eden Gardens: a bowl of stands round the oval, floodlight towers at the corners ---------- */
function edenGardens(world, K) {
  const g = MAP.green.find((x) => x.k === 'stadium' && /eden gardens/i.test(x.name || ''));
  if (!g) return;
  const f = frame(g.p);
  const A = f.hu;
  const B = f.hv;
  const SEG = 72;
  const ring = (k, ri, ro, y0, y1, hex) => {
    for (let i = 0; i < SEG; i++) {
      const t0 = (i / SEG) * Math.PI * 2;
      const t1 = ((i + 1) / SEG) * Math.PI * 2;
      const p = (t, r, y) => new THREE.Vector3(Math.cos(t) * A * r, y, Math.sin(t) * B * r);
      const a0 = p(t0, ri, y0);
      const a1 = p(t1, ri, y0);
      const b0 = p(t0, ro, y1);
      const b1 = p(t1, ro, y1);
      const geo = new THREE.BufferGeometry().setFromPoints([a0, a1, b1, a0, b1, b0]);
      geo.computeVertexNormals();
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      K.add(k, geo, hex);
      const back = new THREE.BufferGeometry().setFromPoints([a0, b1, a1, a0, b0, b1]);
      back.computeVertexNormals();
      back.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      K.add(k, back, hex);
    }
  };
  ring('stone', 0.66, 0.8, 1.5, 11, '#3f6fb0');
  ring('stone', 0.8, 0.93, 12, 24, '#d8d4cc');
  ring('stone', 0.86, 1.0, 29, 30.5, '#e9e7e2');
  // outer wall
  for (let i = 0; i < SEG; i++) {
    const t = ((i + 0.5) / SEG) * Math.PI * 2;
    const x = Math.cos(t) * A * 0.96;
    const z = Math.sin(t) * B * 0.96;
    const len = ((Math.PI * 2) / SEG) * Math.hypot(A * Math.sin(t), B * Math.cos(t)) * 0.96 + 0.4;
    K.box('stone', 0.8, 24, len, x, 12, z, '#c9c2b4', -Math.atan2(B * Math.cos(t), -A * Math.sin(t)) + Math.PI / 2);
    if (i % 4 === 0) K.cyl('steel', 0.3, 0.3, 6, Math.cos(t) * A * 0.95, 27, Math.sin(t) * B * 0.95, '#d8d8d8', 6);
  }
  // Floodlight towers
  for (const t of [0.6, 2.55, 3.75, 5.7]) {
    const x = Math.cos(t) * A * 1.08;
    const z = Math.sin(t) * B * 1.08;
    K.cyl('steel', 0.7, 1.2, 62, x, 31, z, '#c3c7cb', 8);
    K.box('steel', 8, 5, 1, x, 63, z, '#5d6266', -t + Math.PI / 2);
    K.box('lamp', 7.4, 4.4, 0.3, x - Math.cos(t) * 0.6, 63, z - Math.sin(t) * 0.6, '#ffffff', -t + Math.PI / 2);
    world.addCircle(f.cx + Math.cos(f.a) * x - Math.sin(f.a) * z, f.cz + Math.sin(f.a) * x + Math.cos(f.a) * z, 1.4);
  }
  K.place(f.cx, f.cz, f.a);
  world.addPoly(polygon(g.p));
}

/* ---------- St Paul's Cathedral: Indo-Gothic, with its central tower ---------- */
function stPauls(world, K) {
  const b = findB(/saint paul's anglican cathedral$/i);
  if (!b) return;
  const f = frame(b.p);
  const L = f.hu * 2;
  const W = Math.max(14, f.hv * 2);
  const c = '#ece6d6';
  K.box('stone', L, 15, W, 0, 7.5, 0, c);
  K.add('stone', new THREE.CylinderGeometry(0.01, W * 0.62, L, 3, 1).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 15 + W * 0.16, 0), '#7b7d80');
  // buttresses
  for (let x = -L / 2 + 3; x < L / 2; x += 6) for (const s of [-1, 1]) K.box('stone', 1.2, 12, 1.6, x, 6, s * (W / 2 + 0.6), '#e2dccb');
  // crossing tower with pinnacles
  const tx = L * 0.12;
  K.box('stone', 11, 50, 11, tx, 25, 0, c);
  K.box('stone', 12, 1, 12, tx, 40, 0, '#ddd6c4');
  for (const [x, z] of [[-5.2, -5.2], [5.2, -5.2], [-5.2, 5.2], [5.2, 5.2]]) {
    K.cyl('stone', 0.6, 0.8, 8, tx + x, 54, z, c, 8);
    K.add('stone', new THREE.ConeGeometry(0.8, 4, 8).translate(tx + x, 60, z), c);
  }
  for (const y of [22, 32, 44]) for (const s of [-1, 1]) K.box('stone', 0.3, 5, 2, tx + s * 5.6, y, 0, '#2a2622');
  // west front gable towers
  for (const s of [-1, 1]) {
    K.box('stone', 4, 22, 4, -L / 2 + 2, 11, s * (W / 2 - 2), c);
    K.add('stone', new THREE.ConeGeometry(2.4, 6, 8).translate(-L / 2 + 2, 25, s * (W / 2 - 2)), c);
  }
  K.place(f.cx, f.cz, f.a);
  world.addPoly(polygon(rect(f.cx, f.cz, f.a, L / 2, W / 2 + 1)));
}

/* ---------- Nakhoda Masjid: red stone, three domes and two tall minarets ---------- */
function nakhoda(world, K) {
  const b = findB(/^nakhoda mosque$/i);
  if (!b) return;
  const f = frame(b.p);
  const L = f.hu * 2;
  const W = f.hv * 2;
  const red = '#9e4430';
  K.box('stone', L, 17, W, 0, 8.5, 0, red);
  for (const y of [6, 12, 16.6]) K.box('stone', L + 0.4, 0.5, W + 0.4, 0, y, 0, '#efe2c8');
  for (let x = -L / 2 + 3; x < L / 2 - 2; x += 4) for (const y of [3, 9, 14]) for (const s of [-1, 1]) K.box('stone', 1.8, 2.8, 0.4, x, y, s * (W / 2 + 0.05), '#2c201a');
  // domes on drums
  for (const [x, r] of [[0, 7.5], [-L * 0.28, 4.8], [L * 0.28, 4.8]]) {
    K.cyl('stone', r * 0.85, r * 0.85, 3, x, 18.5, 0, '#efe2c8', 16);
    K.dome('stone', r, x, 20, 0, '#f2ead8', 1.35, 18);
    K.cyl('stone', 0.08, 0.2, 3, x, 20 + r * 1.35 + 1.4, 0, '#c9a24a', 6);
  }
  // two minarets on the street front
  const q = world.graph.nearest(f.cx, f.cz, 120);
  const side = q ? Math.sign(-(q.x - f.cx) * f.uz + (q.z - f.cz) * f.ux) || 1 : 1;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - 1.5);
    const z = side * (W / 2 - 1.5);
    K.cyl('stone', 1.6, 2, 40, x, 20, z, red, 12);
    for (const y of [17.5, 28, 38]) K.cyl('stone', 2.4, 2.4, 0.6, x, y, z, '#efe2c8', 12);
    K.dome('stone', 1.9, x, 40, z, '#f2ead8', 1.5, 12);
    K.cyl('stone', 0.05, 0.12, 2.6, x, 44.2, z, '#c9a24a', 6);
  }
  K.place(f.cx, f.cz, f.a);
  world.addPoly(polygon(rect(f.cx, f.cz, f.a, L / 2, W / 2)));
}

/* ---------- James Prinsep's memorial at Prinsep Ghat: a Palladian porch by the river ---------- */
function prinsep(world, K) {
  const p = findP(/prinsep memorial|princep memorial|james princep/i);
  if (!p) return;
  let a = 0;
  if (world.river) {
    const q = nearestOnRing(world.river, p.x, p.z, {});
    a = Math.atan2(q.z - p.z, q.x - p.x);
  }
  const c = '#f1ede4';
  K.box('stone', 16, 1.6, 12, 0, 0.8, 0, '#ddd6c8');
  for (const x of [-6, -2, 2, 6]) for (const z of [-4.2, 4.2]) K.cyl('stone', 0.55, 0.65, 8, x, 5.6, z, c, 12);
  for (const x of [-6, 6]) K.cyl('stone', 0.55, 0.65, 8, x, 5.6, 0, c, 12);
  K.box('stone', 15, 1.6, 10.6, 0, 10.4, 0, c);
  K.add('stone', new THREE.CylinderGeometry(0.01, 6.4, 15, 3, 1).rotateZ(Math.PI / 2).scale(1, 0.4, 1).translate(0, 11.8, 0), c);
  K.place(p.x, p.z, a);
  world.addPoly(polygon(rect(p.x, p.z, a, 8, 6)));
}
