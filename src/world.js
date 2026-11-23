import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import * as T from './textures.js';
import { merge, clamp, lerp, smoothstep } from './utils.js';
import { MAP, Grid, polygon, inPoly, nearestOnRing, polyArea, rayPoly, Poly, offsetLine, RoadGraph, walkPath, nodeXZ } from './geo.js';
import { buildLandmarks, adjustBuildings, LANDMARK_FOOTPRINTS } from './landmarks.js';

/*
 * Kolkata, built from OpenStreetMap data (src/data/kolkata.json, made by
 * tools/build-map.mjs). 1 unit = 1 m, x east, z south. The river Hooghly runs
 * down the west side with Howrah beyond it; everything outside the downloaded
 * tiles is low-detail skyline.
 */

export const WATER_Y = -1.6;
export const SIDEWALK_H = 0;
export const METRO_DEPTH = -12;
export const PLATFORM_H = 1.05;
const BANK_DEPTH = WATER_Y - 2.5;
const CHUNK = 700;
const MAX_HOLES = 48; // a stairwell for each Metro gate

/** Bounds of all downloaded tiles. */
export const TILES = MAP.tiles;
export const BOUNDS = {
  x0: Math.min(...TILES.map((t) => t[0])),
  z0: Math.min(...TILES.map((t) => t[1])),
  x1: Math.max(...TILES.map((t) => t[2])),
  z1: Math.max(...TILES.map((t) => t[3])),
};
export const inTiles = (x, z, m = 0) => TILES.some(([x0, z0, x1, z1]) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m);

const hash = (n) => {
  let h = Math.imul(n | 0, 2654435761) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/* ---------- Geometry accumulator ---------- */
export class Buf {
  constructor(color = false) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = color ? [] : null;
    this.idx = [];
  }
  get n() {
    return this.pos.length / 3;
  }
  v(x, y, z, nx, ny, nz, u, w, c) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    if (this.col) this.col.push(c.r, c.g, c.b);
  }
  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Flat strip along a polyline. uv: 'world' (x/scale, z/scale) or 'along' (u across, v = metres / scale). */
export function ribbon(buf, pts, w, y, { uv = 'world', scale = 6, yAt = null } = {}) {
  if (pts.length < 4) return;
  const L = offsetLine(pts, w / 2);
  const R = offsetLine(pts, -w / 2);
  const base = buf.n;
  let cum = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    if (i) cum += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const yy = yAt ? yAt(pts[i * 2], pts[i * 2 + 1], cum) + y : y;
    if (uv === 'world') {
      buf.v(L[i * 2], yy, L[i * 2 + 1], 0, 1, 0, L[i * 2] / scale, L[i * 2 + 1] / scale);
      buf.v(R[i * 2], yy, R[i * 2 + 1], 0, 1, 0, R[i * 2] / scale, R[i * 2 + 1] / scale);
    } else {
      buf.v(L[i * 2], yy, L[i * 2 + 1], 0, 1, 0, 0, cum / scale);
      buf.v(R[i * 2], yy, R[i * 2 + 1], 0, 1, 0, 1, cum / scale);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    buf.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** Flat polygon at height y with world UVs. */
export function flatPoly(buf, flat, y, scale = 8) {
  const contour = [];
  for (let i = 0; i < flat.length; i += 2) contour.push(new THREE.Vector2(flat[i], flat[i + 1]));
  if (contour.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const base = buf.n;
  for (const p of contour) buf.v(p.x, y, p.y, 0, 1, 0, p.x / scale, p.y / scale);
  for (const [a, b, c] of tris) {
    const A = contour[a];
    const B = contour[b];
    const C = contour[c];
    const up = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
    if (up) buf.idx.push(base + a, base + b, base + c);
    else buf.idx.push(base + a, base + c, base + b);
  }
}

/* ---------- Kolkata palette (vertex colours tint near-white textures) ---------- */
const C = (h) => new THREE.Color(h);
const PALETTE = {
  ochre: C('#e3bf72'),
  yellow: C('#e8cf86'),
  pink: C('#dca394'),
  salmon: C('#d98f74'),
  cream: C('#ece0c2'),
  white: C('#f1eee6'),
  green: C('#b3cfae'),
  sky: C('#b3c9db'),
  brick: C('#b25a40'),
  terra: C('#c98563'),
  grey: C('#b9b4aa'),
  dark: C('#8f8a82'),
  blueGrey: C('#a5b0b8'),
};
const RES_TONES = ['ochre', 'ochre', 'yellow', 'pink', 'salmon', 'cream', 'cream', 'white', 'white', 'green', 'sky', 'terra'];
const NAMED_TONES = [
  [/writers'? build/i, 'brick'],
  [/howrah (junction|station)|railway station/i, 'brick'],
  [/general post office|gpo/i, 'white'],
  [/high court/i, 'brick'],
  [/indian museum/i, 'salmon'],
  [/town hall/i, 'cream'],
  [/st\.? ?paul|cathedral/i, 'white'],
  [/nakhoda/i, 'brick'],
  [/raj bhavan/i, 'white'],
  [/marble palace/i, 'white'],
  [/thakur ?bari|tagore/i, 'brick'],
  [/eastern railway|fairlie/i, 'brick'],
];

/* =========================================================
   World
   ========================================================= */
/** Open ground on the Maidan kept clear of trees: the gully cricket pitch (cricket.js). */
export const MAIDAN_GROUND = { x: -1396, z: 1843, r: 42 };

export class World {
  constructor(scene) {
    this.scene = scene;
    this.grid = new Grid(24);
    this.updaters = [];
    this.pickupSpots = [];
    this.pads = new Grid(40);
    this.ramps = [];
    this.under = null; // underground layer (metro) — see groundAt()
    this.time = { value: 0 };
    this.decks = [];
    this.reflectSkip = [];
    this.stationLamps = []; // tube lights at platforms, stalls and shelters: see addStationLamp()
    this.waterGrid = new Grid(80);
    this.openings = [];
    this.graph = new RoadGraph(MAP.roads);
    this.holeA = Array.from({ length: MAX_HOLES }, () => new THREE.Vector4(1e6, 1e6, 1, 0));
    this.holeB = Array.from({ length: MAX_HOLES }, () => new THREE.Vector2(0, 0));
    this.holeCount = { value: 0 };
    this.build();
  }

  /* ---------------- Colliders ---------------- */
  addBox(x0, x1, z0, z1, tall = true) {
    const o = { t: 0, x0, x1, z0, z1, tall };
    this.grid.insert(o, x0, x1, z0, z1);
  }
  addCircle(x, z, r) {
    const o = { t: 1, x, z, r };
    this.grid.insert(o, x - r, x + r, z - r, z + r);
  }
  /** Solid polygon (a building). */
  addPoly(p, tall = true) {
    const o = { t: 2, p, tall };
    this.grid.insert(o, p.x0, p.x1, p.z0, p.z1);
    return o;
  }
  /** Thick line: river banks, railings. bank = true lets openings (jetties) through. */
  addWall(ax, az, bx, bz, r = 0.3, bank = false) {
    const o = { t: 3, ax, az, bx, bz, r, bank, tall: false };
    this.grid.insert(o, Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.min(az, bz) - r, Math.max(az, bz) + r);
  }
  /** An area where bank walls don't apply (a jetty reaching into the river). */
  addOpening(p) {
    this.openings.push(p);
  }

  /** Push a circle out of all static colliders. Returns null or push vector + normal. */
  collideCircle(x, z, r) {
    let px = 0;
    let pz = 0;
    let hit = false;
    const q = this._q || (this._q = {});
    this.grid.query(x - r, x + r, z - r, z + r, (o) => {
      const cx = x + px;
      const cz = z + pz;
      if (o.t === 0) {
        const qx = clamp(cx, o.x0, o.x1);
        const qz = clamp(cz, o.z0, o.z1);
        const dx = cx - qx;
        const dz = cz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          px += (dx / d) * (r - d);
          pz += (dz / d) * (r - d);
        } else {
          const l = cx - o.x0;
          const rr = o.x1 - cx;
          const t = cz - o.z0;
          const b = o.z1 - cz;
          const m = Math.min(l, rr, t, b);
          if (m === l) px -= l + r;
          else if (m === rr) px += rr + r;
          else if (m === t) pz -= t + r;
          else pz += b + r;
        }
        hit = true;
      } else if (o.t === 1) {
        const dx = cx - o.x;
        const dz = cz - o.z;
        const rr = r + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-9) return;
        const d = Math.sqrt(d2);
        px += (dx / d) * (rr - d);
        pz += (dz / d) * (rr - d);
        hit = true;
      } else if (o.t === 2) {
        const p = o.p;
        if (cx < p.x0 - r || cx > p.x1 + r || cz < p.z0 - r || cz > p.z1 + r) return;
        const inside = inPoly(p, cx, cz);
        nearestOnRing(p, cx, cz, q);
        if (!inside && q.d >= r) return;
        let dx = cx - q.x;
        let dz = cz - q.z;
        const d = q.d || 1e-6;
        if (inside) {
          px += (-dx / d) * (d + r);
          pz += (-dz / d) * (d + r);
        } else {
          px += (dx / d) * (r - d);
          pz += (dz / d) * (r - d);
        }
        hit = true;
      } else {
        const dx = o.bx - o.ax;
        const dz = o.bz - o.az;
        const t = clamp(((cx - o.ax) * dx + (cz - o.az) * dz) / (dx * dx + dz * dz || 1e-9), 0, 1);
        const qx = o.ax + dx * t;
        const qz = o.az + dz * t;
        const ex = cx - qx;
        const ez = cz - qz;
        const rr = r + o.r;
        const d2 = ex * ex + ez * ez;
        if (d2 >= rr * rr || d2 < 1e-9) return;
        if (o.bank && this.openings.some((p) => inPoly(p, cx, cz))) return;
        const d = Math.sqrt(d2);
        px += (ex / d) * (rr - d);
        pz += (ez / d) * (rr - d);
        hit = true;
      }
    });
    // Edge of the mapped area
    const cx = x + px;
    const cz = z + pz;
    if (!inTiles(cx, cz, 30)) {
      let best = null;
      for (const [x0, z0, x1, z1] of TILES) {
        const qx = clamp(cx, x0 - 29, x1 + 29);
        const qz = clamp(cz, z0 - 29, z1 + 29);
        const d = Math.hypot(cx - qx, cz - qz);
        if (!best || d < best.d) best = { d, qx, qz };
      }
      px += best.qx - cx;
      pz += best.qz - cz;
      hit = true;
    }
    if (!hit) return null;
    const l = Math.hypot(px, pz) || 1;
    return { px, pz, nx: px / l, nz: pz / l };
  }

  /** 2D segment vs tall colliders; returns fraction [0..1] of the first hit. */
  raycast(ax, az, bx, bz) {
    const h = this.raycastHit(ax, az, bx, bz, false);
    return h ? h.t : 1;
  }

  /**
   * Bullet ray in 2D against buildings, tall boxes and poles/trunks. Returns the first hit as
   * { t (fraction of the segment), nx, nz } or null.
   */
  raycastHit(ax, az, bx, bz, circles = true) {
    let best = 1;
    let nx = 0;
    let nz = 0;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    this.grid.query(Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz), (o) => {
      if (o.t === 1) {
        if (!circles) return;
        const fx = ax - o.x;
        const fz = az - o.z;
        const b = fx * dx + fz * dz;
        const c = fx * fx + fz * fz - o.r * o.r;
        const disc = b * b - len2 * c;
        if (disc < 0 || c < 0) return;
        const t = (-b - Math.sqrt(disc)) / len2;
        if (t >= 0 && t < best) {
          best = t;
          const hx = ax + dx * t - o.x;
          const hz = az + dz * t - o.z;
          const l = Math.hypot(hx, hz) || 1;
          nx = hx / l;
          nz = hz / l;
        }
        return;
      }
      if (!o.tall) return;
      if (o.t === 2) {
        const h = rayPoly(o.p, ax, az, bx, bz, best);
        if (h) {
          best = h.t;
          nx = h.nx;
          nz = h.nz;
        }
        return;
      }
      let t0 = 0;
      let t1 = 1;
      let ax0 = 0;
      for (const [p, d, lo, hi, axis] of [[ax, dx, o.x0, o.x1, 0], [az, dz, o.z0, o.z1, 1]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) return;
        } else {
          let ta = (lo - p) / d;
          let tb = (hi - p) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          if (ta > t0) {
            t0 = ta;
            ax0 = axis;
          }
          t1 = Math.min(t1, tb);
          if (t0 > t1) return;
        }
      }
      if (t0 > 0 && t0 < best) {
        best = t0;
        nx = ax0 === 0 ? -Math.sign(dx) : 0;
        nz = ax0 === 1 ? -Math.sign(dz) : 0;
      }
    });
    return best < 1 ? { t: best, nx, nz } : null;
  }

  /* ---------------- Heights ---------------- */
  /** Raised walkable area (station platforms, jetties): a flat polygon [x, z, ...] at height h. */
  addPad(flat, h) {
    const p = polygon(flat);
    p.h = h;
    this.pads.insert(p, p.x0, p.x1, p.z0, p.z1);
    return p;
  }
  /** A stairway: an oriented box (centre, unit axis pointing uphill, half length/width) from hBot to hTop. */
  addRamp(cx, cz, ux, uz, hl, hw, hBot, hTop) {
    this.ramps.push({ cx, cz, ux, uz, hl, hw, hBot, hTop });
  }
  rampAt(x, z) {
    for (const r of this.ramps) {
      const dx = x - r.cx;
      const dz = z - r.cz;
      const u = dx * r.ux + dz * r.uz;
      const v = -dx * r.uz + dz * r.ux;
      if (Math.abs(u) < r.hl && Math.abs(v) < r.hw) return lerp(r.hBot, r.hTop, (u + r.hl) / (2 * r.hl));
    }
    return null;
  }
  /** Cut an opening in the street surface (a metro stairwell). */
  addHole(cx, cz, ux, uz, hl, hw) {
    const i = this.holeCount.value;
    if (i >= MAX_HOLES) return;
    this.holeA[i].set(cx, cz, ux, uz);
    this.holeB[i].set(hl, hw);
    this.holeCount.value = i + 1;
  }

  /** Bridge deck height under a point, or null. */
  deckAt(x, z) {
    for (const d of this.decks) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      const p = d.poly.project(x, z);
      if (p.d < d.hw) return d.y(p.s);
    }
    return null;
  }
  /** Open water at ground level: the river or a pond, not a bridge deck or a jetty above it. */
  isWet(x, z) {
    return this.deckAt(x, z) === null && this.height(x, z) <= 0.15 && (this.overWater(x, z) || (!!this.river && inPoly(this.river, x, z)));
  }
  overWater(x, z) {
    let w = false;
    this.waterGrid.query(x, x, z, z, (p) => {
      if (!w && inPoly(p, x, z)) w = true;
    });
    return w;
  }

  /** Ground under a point for something at height y: decks, stairs, and underground floors below street level. */
  groundAt(x, z, y) {
    // a street stairway, unless you're well below it (on the platform under a station's stairs)
    const r = this.rampAt(x, z);
    if (r !== null && !(y < r - 2.5)) return r;
    if (y < -2.5 && this.under) {
      const h = this.under.floorAt(x, z, y);
      if (h !== null) return h;
    }
    const d = this.deckAt(x, z);
    if (d !== null && (y > d - 1.8 || this.overWater(x, z))) return d;
    return this.height(x, z);
  }
  /** Collisions for something at height y (street colliders above ground, metro walls below). */
  collideAt(x, z, r, y) {
    if (y < -2.5 && this.under) return this.under.collideCircle(x, z, r, y);
    // On a bridge deck over the river or a canal/pond, the deck's own railings keep you on
    if (this.deckAt(x, z) !== null && (y > 2.5 || this.overWater(x, z))) return this.collideDeck(x, z, r);
    return this.collideCircle(x, z, r);
  }
  raycastAt(ax, az, bx, bz, y) {
    if (y < -2.5 && this.under) return this.under.raycast(ax, az, bx, bz, y);
    if (y > 2.5 && this.deckAt(ax, az) !== null) return 1;
    return this.raycast(ax, az, bx, bz);
  }
  /** Keep something on a bridge deck between its railings. */
  collideDeck(x, z, r) {
    for (const d of this.decks) {
      const p = d.poly.project(x, z);
      if (p.d > d.hw + 2) continue;
      const lim = d.hw - 0.6 - r;
      if (p.d <= lim) return null;
      const q = d.poly.at(p.s, {});
      const dx = x - q.x;
      const dz = z - q.z;
      const l = Math.hypot(dx, dz) || 1;
      const push = lim - p.d;
      return { px: (dx / l) * push, pz: (dz / l) * push, nx: -dx / l, nz: -dz / l };
    }
    return null;
  }

  /** 0 = dry, 1 = soaked. */
  setWet(w) {
    if (Math.abs(w - this.wet) < 0.01) return;
    this.wet = w;
    for (const { m, rough, color } of this.wetMats) {
      m.roughness = rough * (1 - 0.62 * w);
      m.color.copy(color).multiplyScalar(1 - 0.32 * w);
    }
  }

  height(x, z) {
    const r = this.rampAt(x, z);
    if (r !== null) return r;
    let h = 0;
    this.pads.query(x, x, z, z, (p) => {
      if (p.h > h && inPoly(p, x, z)) h = p.h;
    });
    return h;
  }

  /** Nearest open spot on a pavement beside a road, for respawns. */
  nearestSidewalk(x, z) {
    const n = this.graph.nearest(x, z, 600, (e) => e.c <= 4 && !e.br);
    if (!n) return { x, z, yaw: 0 };
    for (const side of [1, -1]) {
      const off = n.e.w / 2 + 1.2;
      const px = n.x + n.tz * off * side;
      const pz = n.z - n.tx * off * side;
      if (!this.collideCircle(px, pz, 0.5)) return { x: px, z: pz, yaw: Math.atan2(n.tx, n.tz) };
    }
    return { x: n.x, z: n.z, yaw: Math.atan2(n.tx, n.tz) };
  }

  /* ---------------------------------------------------- */
  build() {
    const scene = this.scene;
    const before = new Set(scene.children);
    const rng = T.makeRng(2026);
    this.rng = rng;
    const graph = this.graph;

    /* ---- Materials ---- */
    const plain = T.asphalt(false);
    // Dark asphalt that reads clearly against the paler ground and pavements
    const roadMat = new THREE.MeshStandardMaterial({ map: plain.map, roughnessMap: plain.rough, roughness: 1, metalness: 0, color: 0x7d7b78, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const kerbMat = new THREE.MeshStandardMaterial({ map: T.kerb(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ map: T.sidewalk(), roughness: 0.9, color: 0xe6e0d4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const footMat = sidewalkMat.clone();
    footMat.polygonOffsetFactor = footMat.polygonOffsetUnits = -2.5;
    const dashMat = new THREE.MeshStandardMaterial({ map: T.laneDash(), transparent: true, alphaTest: 0.3, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const grassTex = T.grass();
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const dirtTex = T.dirt();
    const groundMat = new THREE.MeshStandardMaterial({ map: dirtTex, color: 0xc2b394, roughness: 1 });
    const areaMat = new THREE.MeshStandardMaterial({ map: dirtTex, color: 0xa79e8e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const bankMat = new THREE.MeshStandardMaterial({ map: T.sidewalk(), color: 0x8a7e6c, roughness: 1, side: THREE.DoubleSide });
    const propsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
    const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    this.mats = { roadMat, interMat: roadMat, neonMat, redMat, propsMat };
    // roads and pavements darken and shine when wet
    this.wetMats = [roadMat, sidewalkMat].map((m) => ({ m, rough: m.roughness, color: m.color.clone() }));
    this.wet = 0;

    const facadeDefs = {
      calcuttaG: ['calcutta', { wall: '#f4f1ea', shutter: '#2f6b4a', lit: 0.45 }],
      calcuttaB: ['calcutta', { wall: '#f4f1ea', shutter: '#6b4a2f', lit: 0.45 }],
      calcuttaU: ['calcutta', { wall: '#f4f1ea', shutter: '#3e5f84', lit: 0.45 }],
      concrete: ['concrete', { wall: '#efece6', lit: 0.5 }],
      flats: ['residential', { wall: '#f2efe9', lit: 0.5 }],
      glass: ['glass', { frame: '#1c2633', slab: '#2a3442', glassA: '#8fb0cc', glassB: '#4b6a88', lit: 0.35 }],
    };
    this.facadeMats = {};
    let seed = 100;
    for (const [k, [kind, o]] of Object.entries(facadeDefs)) {
      const t = T.facade(kind, o, seed++);
      this.facadeMats[k] = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.05,
        roughnessMap: t.rm,
        metalnessMap: t.rm,
        roughness: 1,
        metalness: 1,
        vertexColors: k !== 'glass',
      });
    }
    const shop = T.storefront();
    this.shopMat = new THREE.MeshStandardMaterial({ map: shop.map, emissiveMap: shop.emissive, emissive: 0xffffff, emissiveIntensity: 0.4, roughnessMap: shop.rm, metalnessMap: shop.rm, roughness: 1, metalness: 1 });
    this.roofMat = new THREE.MeshStandardMaterial({ map: T.roof(), vertexColors: true, roughness: 0.95 });

    /* ---- Water: the Hooghly and every pond, tank and canal ---- */
    const waterPolys = [];
    if (MAP.river) {
      const ring = this.riverRing(MAP.river.banks);
      if (ring) {
        const p = polygon(ring);
        p.river = true;
        this.river = p;
        waterPolys.push(p);
      }
    }
    for (const w of MAP.water) {
      const p = polygon(w.p);
      if (Math.abs(polyArea(p)) < 30) continue;
      // Pieces of the river mapped separately are already covered
      if (this.river && inPoly(this.river, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2)) continue;
      waterPolys.push(p);
    }
    for (const p of waterPolys) this.waterGrid.insert(p, p.x0, p.x1, p.z0, p.z1);
    this.waterPolys = waterPolys;

    // A mask the street surfaces use to leave the water uncovered
    const MB = { x0: BOUNDS.x0 - 1600, z0: BOUNDS.z0 - 1600, x1: BOUNDS.x1 + 1600, z1: BOUNDS.z1 + 1600 };
    const MS = 4096;
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mg = mc.getContext('2d');
    mg.fillStyle = '#000';
    mg.fillRect(0, 0, MS, MS);
    mg.fillStyle = '#fff';
    const mx = (x) => ((x - MB.x0) / (MB.x1 - MB.x0)) * MS;
    const mz = (z) => ((z - MB.z0) / (MB.z1 - MB.z0)) * MS;
    for (const p of waterPolys) {
      mg.beginPath();
      for (let i = 0; i < p.n; i++) (i ? mg.lineTo : mg.moveTo).call(mg, mx(p.xs[i]), mz(p.zs[i]));
      mg.closePath();
      mg.fill();
    }
    const maskTex = new THREE.CanvasTexture(mc);
    maskTex.flipY = false;
    maskTex.colorSpace = THREE.NoColorSpace;
    const surface = {
      uMask: { value: maskTex },
      uMaskRect: { value: new THREE.Vector4(MB.x0, MB.z0, 1 / (MB.x1 - MB.x0), 1 / (MB.z1 - MB.z0)) },
      uHoleA: { value: this.holeA },
      uHoleB: { value: this.holeB },
      uHoles: this.holeCount,
    };
    // Ground, roads and pavements skip water and stairwell openings
    const cut = (mat) => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, surface);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        sh.fragmentShader = sh.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying vec2 vWXZ;
            uniform sampler2D uMask;
            uniform vec4 uMaskRect;
            uniform vec4 uHoleA[${MAX_HOLES}];
            uniform vec2 uHoleB[${MAX_HOLES}];
            uniform int uHoles;`,
          )
          .replace(
            'void main() {',
            `void main() {
            vec2 muv = (vWXZ - uMaskRect.xy) * uMaskRect.zw;
            if (texture2D(uMask, muv).r > 0.5) discard;
            for (int i = 0; i < ${MAX_HOLES}; i++) {
              if (i >= uHoles) break;
              vec2 d = vWXZ - uHoleA[i].xy;
              float u = dot(d, uHoleA[i].zw);
              float v = dot(d, vec2(-uHoleA[i].w, uHoleA[i].z));
              if (abs(u) < uHoleB[i].x && abs(v) < uHoleB[i].y) discard;
            }`,
          );
      };
      mat.customProgramCacheKey = () => 'cut';
    };
    for (const m of [groundMat, roadMat, sidewalkMat, footMat, grassMat, areaMat, dashMat, kerbMat, edgeMat]) cut(m);
    this.roadMats = { kerbMat, edgeMat };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MB.x1 - MB.x0, MB.z1 - MB.z0, 1, 1), groundMat);
    ground.geometry.rotateX(-Math.PI / 2);
    {
      const uv = ground.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (MB.x1 - MB.x0)) / 14, (uv.getY(i) * (MB.z1 - MB.z0)) / 14);
    }
    // The bare ground sits a little lower than paths and roads so distant layers never z-fight
    ground.position.set((MB.x0 + MB.x1) / 2, -0.12, (MB.z0 + MB.z1) / 2);
    ground.receiveShadow = true;
    scene.add(ground);

    const water = new Water(this.waterGeometry(waterPolys), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: T.waterNormals(),
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: 0x3a3a22,
      distortionScale: 2.2,
      fog: true,
    });
    // A silty river reflects far less than open sea: lower the base reflectance
    water.material.fragmentShader = water.material.fragmentShader.replace('float rf0 = 0.3;', 'float rf0 = 0.06;');
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.material.uniforms.size.value = 1.6;
    scene.add(water);
    this.water = water;

    /* ---- Bridges: decks over the river, and their gaps in the bank walls ---- */
    {
      const ptmp = {};
      for (const r of MAP.roads) {
        if (r.br) continue;
        const pts = r.n.flatMap(nodeXZ);
        if (pts.length < 4) continue;
        const poly = new Poly(pts);
        let wetMeters = 0;
        for (let s = 0; s <= poly.len; s += 2) {
          poly.at(s, ptmp);
          if (this.overWater(ptmp.x, ptmp.z) && !(this.river && inPoly(this.river, ptmp.x, ptmp.z))) wetMeters += 2;
        }
        if (wetMeters >= 6) {
          r.br = 1;
          for (const e of this.graph.edges) {
            if (e.poly.project(poly.x[0], poly.z[0]).d < 1 && e.poly.project(poly.x[poly.n - 1], poly.z[poly.n - 1]).d < 1) {
              e.br = true;
            }
          }
        }
      }
    }
    const bridgeRoads = MAP.roads.filter((r) => r.br);
    this.buildDecks(bridgeRoads);
    const nearBridge = (x, z) =>
      this.decks.some((d) => {
        if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) return false;
        return d.poly.project(x, z).d < d.hw + 0.5;
      });

    // Stone embankments down to the water, and colliders along their tops
    const bank = new Buf();
    for (const p of waterPolys) {
      for (let i = 0, j = p.n - 1; i < p.n; j = i++) {
        const ax = p.xs[j];
        const az = p.zs[j];
        const bx = p.xs[i];
        const bz = p.zs[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const base = bank.n;
        const nx = (bz - az) / len;
        const nz = -(bx - ax) / len;
        bank.v(ax, 0.05, az, nx, 0, nz, 0, 0);
        bank.v(bx, 0.05, bz, nx, 0, nz, len / 4, 0);
        bank.v(bx, BANK_DEPTH, bz, nx, 0, nz, len / 4, 1);
        bank.v(ax, BANK_DEPTH, az, nx, 0, nz, 0, 1);
        bank.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        const mxp = (ax + bx) / 2;
        const mzp = (az + bz) / 2;
        if (inTiles(mxp, mzp, 200) && !nearBridge(mxp, mzp)) this.addWall(ax, az, bx, bz, 0.35, true);
      }
    }
    {
      const m = new THREE.Mesh(bank.geometry(), bankMat);
      m.receiveShadow = true;
      scene.add(m);
    }

    /* ---- Parks, the Maidan, stadium grounds, plazas and railway land ---- */
    const greenBuf = new Buf();
    const areaBuf = new Buf();
    for (const g of MAP.green) flatPoly(greenBuf, g.p, -0.06, 8);
    for (const a of MAP.areas) flatPoly(areaBuf, a.p, -0.08, 10);
    for (const [buf, mat] of [[greenBuf, grassMat], [areaBuf, areaMat]]) {
      const g = buf.geometry();
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      scene.add(m);
    }
    this.greens = MAP.green.map((g) => ({ ...polygon(g.p), k: g.k, name: g.name }));

    /* ---- Roads ---- */
    this.buildRoads(roadMat, sidewalkMat, footMat, dashMat);

    /* ---- Landmarks (custom models replace their OSM footprints) ---- */
    const landmarkSkip = new Set();
    for (const b of MAP.buildings) if (b.name && LANDMARK_FOOTPRINTS.some((re) => re.test(b.name))) landmarkSkip.add(b);

    /* ---- Buildings ---- */
    adjustBuildings(MAP.buildings);
    this.buildBuildings(landmarkSkip, rng);
    buildLandmarks(this, scene);

    /* ---- Trees, street lights, distant skyline ---- */
    this.buildTrees(rng);
    this.buildLights(rng);
    this.buildHawkers(rng);
    this.buildSkyline(rng);

    /* ---- Pickup spots on pavements beside roads ---- */
    const tmp = {};
    for (const e of graph.edges) {
      if (e.c > 4 || e.len < 40 || e.br || !inTiles(e.pts[0], e.pts[1])) continue;
      if (rng() > 0.12) continue;
      e.poly.at(e.len * rng.range(0.2, 0.8), tmp);
      const side = rng() < 0.5 ? 1 : -1;
      const off = e.w / 2 + 0.9;
      const x = tmp.x + tmp.tz * off * side;
      const z = tmp.z - tmp.tx * off * side;
      if (!this.collideCircle(x, z, 0.8) && !this.overWater(x, z)) this.pickupSpots.push([x, 0, z]);
    }

    /* ---- Walking paths ---- */
    this.buildWalkPaths();

    // Static geometry never moves: skip per-frame matrix recomputation
    for (const o of scene.children) {
      if (before.has(o) || o.userData.dynamic) continue;
      o.updateMatrixWorld(true);
      o.traverse((c) => (c.matrixAutoUpdate = false));
    }
  }

  /** Close the river's bank chains into one polygon. */
  riverRing(banks) {
    const chains = banks.map((b) => b.slice());
    if (!chains.length) return null;
    // Greedily join chains end to end (nearest endpoints first)
    let ring = chains.shift();
    while (chains.length) {
      const ex = ring[ring.length - 2];
      const ez = ring[ring.length - 1];
      let best = null;
      chains.forEach((c, i) => {
        const ds = Math.hypot(c[0] - ex, c[1] - ez);
        const de = Math.hypot(c[c.length - 2] - ex, c[c.length - 1] - ez);
        if (!best || Math.min(ds, de) < best.d) best = { i, d: Math.min(ds, de), rev: de < ds };
      });
      let c = chains.splice(best.i, 1)[0];
      if (best.rev) {
        const r = [];
        for (let k = c.length - 2; k >= 0; k -= 2) r.push(c[k], c[k + 1]);
        c = r;
      }
      ring = ring.concat(c);
    }
    return ring;
  }

  waterGeometry(polys) {
    const shapes = polys.map((p) => {
      const pts = [];
      for (let i = 0; i < p.n; i++) pts.push(new THREE.Vector2(p.xs[i], -p.zs[i]));
      return new THREE.Shape(pts);
    });
    return new THREE.ShapeGeometry(shapes, 1);
  }

  /** Bridges over the river get a raised deck; over ponds and canals they stay near street level. */
  buildDecks(bridgeRoads) {
    // Join bridge ways that share end nodes into continuous decks
    const chains = [];
    const used = new Set();
    for (const r of bridgeRoads) {
      if (used.has(r)) continue;
      used.add(r);
      let ids = r.n.slice();
      let w = r.w;
      let grew = true;
      while (grew) {
        grew = false;
        for (const o of bridgeRoads) {
          if (used.has(o)) continue;
          const a = o.n[0];
          const b = o.n[o.n.length - 1];
          if (a === ids[ids.length - 1]) ids = ids.concat(o.n.slice(1));
          else if (b === ids[0]) ids = o.n.slice(0, -1).concat(ids);
          else continue;
          used.add(o);
          w = Math.max(w, o.w);
          grew = true;
        }
      }
      chains.push({ ids, w, name: r.name || '' });
    }
    for (const c of chains) {
      const pts = c.ids.flatMap(nodeXZ);
      const poly = new Poly(pts);
      let wet = 0;
      const tmp = {};
      for (let s = 0; s < poly.len; s += 5) {
        poly.at(s, tmp);
        if (this.river && inPoly(this.river, tmp.x, tmp.z)) wet += 5;
      }
      const overRiver = wet > 60;
      let pond = false;
      for (let s = 0; s <= poly.len && !pond; s += 2) {
        poly.at(s, tmp);
        if (this.overWater(tmp.x, tmp.z)) pond = true;
      }
      const overPond = !overRiver && pond;
      if (!overRiver && !overPond) continue;
      // Vidyasagar Setu's deck rides ~26 m over the river on long approach ramps
      const setu = overRiver && /vidyasagar/i.test(c.name);
      const H = setu ? 26 : overRiver ? 7.5 : 0.35;
      const R = setu ? Math.min(420, poly.len / 3) : overRiver ? Math.min(110, poly.len / 3) : Math.min(8, poly.len / 3);
      const L = poly.len;
      const b = poly.bounds();
      const deck = { poly, pts, hw: c.w / 2 + 1.6, H, river: overRiver, name: c.name, x0: b.x0 - 20, x1: b.x1 + 20, z0: b.z0 - 20, z1: b.z1 + 20, y: (s) => H * smoothstep(0, R, s) * smoothstep(0, R, L - s) };
      this.decks.push(deck);
    }
  }

  buildRoads(roadMat, sidewalkMat, footMat, dashMat) {
    const roadBuf = new Buf();
    const sideBuf = new Buf();
    const footBuf = new Buf();
    const dashBuf = new Buf();
    const kerbBuf = new Buf();
    const edgeBuf = new Buf();
    const deckRoad = new Buf();
    const tmp = {};
    // Roads on bridges follow the deck's height
    const deckFor = (pts) => {
      for (const d of this.decks) {
        let hits = 0;
        for (let i = 0; i < pts.length; i += 2) if (d.poly.project(pts[i], pts[i + 1]).d < d.hw) hits++;
        if (hits >= pts.length / 2 - 1 && hits > 0) return d;
      }
      return null;
    };
    const order = [...MAP.roads].sort((a, b) => b.c - a.c);
    for (const r of order) {
      const pts = r.n.flatMap(nodeXZ);
      if (pts.length < 4) continue;
      const deck = r.br ? deckFor(pts) : null;
      const yAt = deck ? (x, z) => deck.y(deck.poly.project(x, z).s) : null;
      if (r.foot) {
        if (r.h === 'steps' || r.tn) continue;
        ribbon(deck ? deckRoad : footBuf, pts, r.w, deck ? 0.05 : -0.015, { scale: 3, yAt });
        continue;
      }
      if (r.tn) continue;
      const y = 0.0 + (5 - Math.min(r.c, 5)) * 0.008;
      ribbon(deck ? deckRoad : roadBuf, pts, r.w, deck ? 0.06 : y, { scale: 7, yAt });
      // Pavements along proper streets (not service lanes or bridges)
      if (!deck && r.c <= 4 && r.sv === undefined) ribbon(sideBuf, pts, r.w + (r.c <= 2 ? 5 : 3.2), -0.035, { scale: 3 });
      // Dashed centre line on two-way main roads
      if (r.c <= 3 && !r.o && r.w >= 7) ribbon(deck ? deckRoad : dashBuf, pts, 0.16, deck ? 0.07 : y + 0.015, { uv: 'along', scale: 6, yAt });
    }
    // Painted kerbs and white edge lines, street by street, stopping short of each junction
    const G = this.graph;
    const q = {};
    for (const e of G.edges) {
      if (e.c > 4 || e.br || e.w < 5 || !inTiles(e.pts[0], e.pts[1], 50)) continue;
      const trim = (node) => {
        const links = G.allLinks(node);
        if (links.length <= 2) return 0;
        let w = 0;
        for (const { e: o } of links) if (o !== e) w = Math.max(w, o.w);
        return w / 2 + 1.2;
      };
      const t0 = trim(e.a);
      const t1 = trim(e.b);
      if (e.len - t0 - t1 < 3) continue;
      const P = e.poly;
      const sub = [];
      P.at(t0, q);
      sub.push(q.x, q.z);
      for (let i = 1; i < P.n - 1; i++) if (P.cum[i] > t0 && P.cum[i] < e.len - t1) sub.push(P.x[i], P.z[i]);
      P.at(e.len - t1, q);
      sub.push(q.x, q.z);
      const y = 0.02 + (5 - Math.min(e.c, 5)) * 0.008;
      for (const side of [1, -1]) ribbon(kerbBuf, offsetLine(sub, side * (e.w / 2 + 0.12)), 0.3, y + 0.02, { uv: 'along', scale: 1.0 });
      if (e.c <= 2 && e.w >= 9) for (const side of [1, -1]) ribbon(edgeBuf, offsetLine(sub, side * (e.w / 2 - 0.55)), 0.13, y + 0.012, { uv: 'along', scale: 4 });
    }
    void tmp;
    for (const [buf, mat] of [[sideBuf, sidewalkMat], [footBuf, footMat], [roadBuf, roadMat], [dashBuf, dashMat], [kerbBuf, this.roadMats.kerbMat], [edgeBuf, this.roadMats.edgeMat]]) {
      const g = buf.geometry();
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    const dg = deckRoad.geometry();
    if (dg) {
      const dm = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: roadMat.map, color: 0xa9a49c, roughness: 1, side: THREE.DoubleSide }));
      dm.receiveShadow = true;
      dm.castShadow = true;
      this.scene.add(dm);
    }
  }

  buildBuildings(skip, rng) {
    // Coarse raster of where the main roads run, so buildings facing them get shop fronts
    const RS = 12;
    const shopCells = new Set();
    const key = (ix, iz) => ix * 100000 + iz;
    const tmp = {};
    for (const e of this.graph.edges) {
      if (e.c > 3) continue;
      for (let s = 0; s <= e.len; s += 6) {
        e.poly.at(s, tmp);
        const r = e.w / 2 + 14;
        for (let ix = Math.floor((tmp.x - r) / RS); ix <= Math.floor((tmp.x + r) / RS); ix++) for (let iz = Math.floor((tmp.z - r) / RS); iz <= Math.floor((tmp.z + r) / RS); iz++) shopCells.add(key(ix, iz));
      }
    }
    const chunks = new Map();
    const bucket = (x, z, k) => {
      const ck = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let c = chunks.get(ck);
      if (!c) chunks.set(ck, (c = {}));
      return (c[k] ||= new Buf(k !== 'shop'));
    };
    const tanks = [];
    const white = new THREE.Color(1, 1, 1);
    const roofCol = new THREE.Color();
    const wallCol = new THREE.Color();
    this.buildingPolys = [];
    for (const b of MAP.buildings) {
      if (skip.has(b)) continue;
      const p = polygon(b.p);
      const n = p.n;
      if (n < 3) continue;
      const ar = polyArea(p);
      const A = Math.abs(ar);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < n; i++) {
        cx += p.xs[i];
        cz += p.zs[i];
      }
      cx /= n;
      cz /= n;
      const r = hash(b.id);
      const h = b.h;
      const y0 = b.y || 0;
      // Style and colour
      let style;
      let tone;
      if (b.k === 'small') {
        style = 'concrete';
        tone = r < 0.5 ? 'dark' : 'grey';
      } else if (b.k === 'industrial') {
        style = 'concrete';
        tone = r < 0.5 ? 'dark' : 'blueGrey';
      } else if (b.k === 'commercial' && h > 45) {
        style = r < 0.5 ? 'glass' : 'concrete';
        tone = 'grey';
      } else if (b.k === 'commercial' || h > 30) {
        style = r < 0.45 ? 'concrete' : r < 0.7 ? 'flats' : 'calcuttaG';
        tone = r < 0.3 ? 'grey' : r < 0.55 ? 'cream' : r < 0.75 ? 'white' : 'ochre';
      } else if (b.k === 'civic') {
        style = 'calcuttaG';
        tone = r < 0.35 ? 'brick' : r < 0.7 ? 'cream' : 'white';
      } else if (b.k === 'worship') {
        style = 'calcuttaB';
        tone = r < 0.6 ? 'white' : 'cream';
      } else if (b.k === 'station') {
        style = 'calcuttaG';
        tone = 'brick';
      } else {
        style = r < 0.45 ? 'calcuttaG' : r < 0.75 ? 'calcuttaB' : r < 0.88 ? 'calcuttaU' : 'flats';
        tone = RES_TONES[Math.floor(hash(b.id + 7) * RES_TONES.length)];
      }
      if (b.name) for (const [re, t] of NAMED_TONES) if (re.test(b.name)) tone = t;
      if (b.col && /^#?[0-9a-f]{6}$|^[a-z]+$/i.test(b.col)) {
        try {
          wallCol.set(b.col.startsWith('#') || /^[a-z]+$/i.test(b.col) ? b.col : '#' + b.col);
        } catch {
          wallCol.copy(PALETTE[tone]);
        }
      } else wallCol.copy(PALETTE[tone]);
      // Weathering: every wall a little different
      wallCol.multiplyScalar(0.86 + hash(b.id + 3) * 0.2);

      const ix = Math.floor(cx / RS);
      const iz = Math.floor(cz / RS);
      const shops = b.k !== 'small' && b.k !== 'industrial' && b.k !== 'worship' && h > 7 && (b.k === 'commercial' || shopCells.has(key(ix, iz))) && y0 === 0;
      const wallBase = shops ? 4 : y0;
      const fb = bucket(cx, cz, style);
      const sb = shops ? bucket(cx, cz, 'shop') : null;
      const uOff = Math.floor(r * 8) / 8;
      let per = 0;
      // Outward normal side depends on the ring's winding
      const sgn = ar > 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p.xs[i];
        const az = p.zs[i];
        const bx = p.xs[j];
        const bz = p.zs[j];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = (dz / len) * sgn;
        const nz = (-dx / len) * sgn;
        // CCW order (a, b, top-b) faces (-dz, dx); flip when the outside is the other way
        const flip = nx * -dz + nz * dx < 0;
        const quad = (buf, ya, yb, u0, u1, v0, v1, col) => {
          const base = buf.n;
          buf.v(ax, ya, az, nx, 0, nz, u0, v0, col);
          buf.v(bx, ya, bz, nx, 0, nz, u1, v0, col);
          buf.v(bx, yb, bz, nx, 0, nz, u1, v1, col);
          buf.v(ax, yb, az, nx, 0, nz, u0, v1, col);
          if (flip) buf.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
          else buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        if (sb) quad(sb, 0, 4, per / 24 + r, (per + len) / 24 + r, 0, 1, white);
        quad(fb, wallBase, h, per / 32 + uOff, (per + len) / 32 + uOff, (wallBase - y0) / 28, (h - y0) / 28, wallCol);
        per += len;
      }
      // Flat roof
      roofCol.setScalar(0.55 + hash(b.id + 11) * 0.35);
      const rb = bucket(cx, cz, 'roof');
      const contour = [];
      for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p.xs[i], p.zs[i]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const base = rb.n;
      for (const v of contour) rb.v(v.x, h, v.y, 0, 1, 0, v.x / 10, v.y / 10, roofCol);
      for (const [a, bb, c] of tris) {
        const A2 = contour[a];
        const B2 = contour[bb];
        const C2 = contour[c];
        const up = (B2.y - A2.y) * (C2.x - A2.x) - (B2.x - A2.x) * (C2.y - A2.y) > 0;
        if (up) rb.idx.push(base + a, base + bb, base + c);
        else rb.idx.push(base + a, base + c, base + bb);
      }
      // Black water tanks on Kolkata rooftops
      if (b.k !== 'small' && A > 50 && hash(b.id + 19) < 0.45 && h < 60) {
        const k = A > 400 ? 2 : 1;
        for (let t = 0; t < k; t++) {
          const tx = cx + (hash(b.id + 23 + t) - 0.5) * Math.sqrt(A) * 0.35;
          const tz = cz + (hash(b.id + 29 + t) - 0.5) * Math.sqrt(A) * 0.35;
          if (inPoly(p, tx, tz)) tanks.push([tx, h, tz, 0.8 + hash(b.id + 31 + t) * 0.5]);
        }
      }
      this.addPoly(p, y0 < 3 && (b.k !== 'small' || h > 3));
      this.buildingPolys.push(p);
    }
    void rng;
    for (const c of chunks.values()) {
      for (const [k, buf] of Object.entries(c)) {
        const g = buf.geometry();
        if (!g) continue;
        const mat = k === 'shop' ? this.shopMat : k === 'roof' ? this.roofMat : this.facadeMats[k];
        const m = new THREE.Mesh(g, mat);
        m.castShadow = k !== 'roof';
        m.receiveShadow = true;
        this.scene.add(m);
      }
    }
    // Rooftop water tanks: instanced per 250 m cell, shown only near the camera
    if (tanks.length) {
      const tg = new THREE.CylinderGeometry(0.75, 0.75, 1.5, 8).translate(0, 0.75, 0);
      const tmat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.55 });
      const cells = new Map();
      for (const t of tanks) {
        const k = `${Math.floor(t[0] / 250)},${Math.floor(t[2] / 250)}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(t);
      }
      const m4 = new THREE.Matrix4();
      this.tankCells = [];
      for (const list of cells.values()) {
        const tm = new THREE.InstancedMesh(tg, tmat, list.length);
        let cx = 0;
        let cz = 0;
        list.forEach(([x, y, z, s], i) => {
          tm.setMatrixAt(i, m4.makeScale(s, s, s).setPosition(x, y, z));
          cx += x;
          cz += z;
        });
        tm.computeBoundingSphere();
        tm.userData.dynamic = true;
        this.scene.add(tm);
        this.reflectSkip.push(tm);
        this.tankCells.push({ group: tm, x: cx / list.length, z: cz / list.length });
      }
    }
  }

  /** Banyan and rain trees in parks and along streets, coconut palms here and there. */
  buildTrees(rng) {
    const trees = [];
    const palms = [];
    const blocked = (x, z, r) => {
      if (this.collideCircle(x, z, r) || this.overWater(x, z)) return true;
      if (Math.hypot(x - MAIDAN_GROUND.x, z - MAIDAN_GROUND.z) < MAIDAN_GROUND.r) return true;
      const n = this.graph.nearest(x, z, 30);
      return n && n.d < n.e.w / 2 + 1.2;
    };
    for (const g of this.greens) {
      if (g.k === 'pitch' || g.k === 'stadium') continue;
      const A = Math.abs(polyArea(g));
      const count = Math.min(900, Math.floor(A / (g.name && /maidan/i.test(g.name) ? 900 : 320)));
      for (let k = 0, tries = 0; k < count && tries < count * 4; tries++) {
        const x = rng.range(g.x0, g.x1);
        const z = rng.range(g.z0, g.z1);
        if (!inPoly(g, x, z) || blocked(x, z, 1.5)) continue;
        (rng() < 0.12 ? palms : trees).push([x, z, rng.range(0.75, 1.35), rng() * 6.28]);
        k++;
      }
    }
    // Street trees along the edges of roads
    const tmp = {};
    for (const e of this.graph.edges) {
      if (e.c > 4 || e.len < 20 || e.br) continue;
      for (let s = rng.range(4, 20); s < e.len; s += rng.range(14, 40)) {
        if (rng() < 0.55) continue;
        e.poly.at(s, tmp);
        const side = rng() < 0.5 ? 1 : -1;
        const off = e.w / 2 + 1.6;
        const x = tmp.x + tmp.tz * off * side;
        const z = tmp.z - tmp.tx * off * side;
        if (!inTiles(x, z) || blocked(x, z, 1.0)) continue;
        trees.push([x, z, rng.range(0.6, 1.1), rng() * 6.28]);
      }
    }
    for (const [x, z] of trees) this.addCircle(x, z, 0.45);
    for (const [x, z] of palms) this.addCircle(x, z, 0.4);

    // Broadleaf tree: trunk and a lumpy crown
    const trunk = new THREE.CylinderGeometry(0.28, 0.45, 5, 7).translate(0, 2.5, 0);
    const lumps = [];
    for (const [ox, oy, oz, s] of [[0, 6.8, 0, 3.4], [1.9, 6.0, 0.6, 2.5], [-1.7, 6.2, -0.8, 2.6], [0.4, 7.9, -1.4, 2.2], [-0.6, 5.7, 1.8, 2.3]]) {
      const g = new THREE.IcosahedronGeometry(s, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + Math.sin(p.getX(i) * 3.1 + p.getY(i) * 1.7) * 0.12;
        p.setXYZ(i, p.getX(i) * k + ox, p.getY(i) * k * 0.8 + oy, p.getZ(i) * k + oz);
      }
      g.computeVertexNormals();
      lumps.push(g);
    }
    const crown = merge(lumps);
    // Far away: one low-poly blob on a thin trunk (fog hides the difference)
    const crownLo = new THREE.IcosahedronGeometry(3.6, 0).scale(1.15, 0.85, 1.15).translate(0, 6.6, 0);
    const trunkLo = new THREE.CylinderGeometry(0.3, 0.42, 5, 4).translate(0, 2.5, 0);
    const barkMat = new THREE.MeshStandardMaterial({ map: T.trunk(), color: 0x8a7a68, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    this.leafMat = leafMat;

    // Coconut palms (the old palm model)
    const palmGeo = palmGeometries();
    const leafTex = T.leaf();
    const time = this.time;
    const frondMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
    frondMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
        #else
          float ph = 0.0;
        #endif
        float sw = max(0.0, position.y - 7.0);
        transformed.x += sin(uTime * 1.3 + ph) * 0.06 * sw;
        transformed.z += cos(uTime * 1.1 + ph) * 0.05 * sw;`,
      );
    };
    const palmTrunkMat = new THREE.MeshStandardMaterial({ map: T.trunk(), roughness: 0.95 });

    // Every tree's transform and colour, kept for the level-of-detail sort
    const all = [...trees.map((t) => [...t, 0]), ...palms.map((t) => [...t, 1])];
    const n = all.length;
    this.flora = { xs: new Float32Array(n), zs: new Float32Array(n), mats: new Float32Array(n * 16), cols: new Float32Array(n * 3), palm: new Uint8Array(n), n, lastX: 1e9, lastZ: 1e9 };
    const F = this.flora;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    all.forEach(([x, z, s, ry, palm], i) => {
      e.set(0, ry, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, palm ? s : s * rng.range(0.85, 1.15), s));
      m4.toArray(F.mats, i * 16);
      F.xs[i] = x;
      F.zs[i] = z;
      F.palm[i] = palm;
      col.setHSL(palm ? rng.range(0.24, 0.3) : rng.range(0.22, 0.3), rng.range(0.35, 0.55), rng.range(0.2, 0.3));
      col.toArray(F.cols, i * 3);
    });
    // Near: full trees and palms that cast shadows. Far: the simple versions, no shadows.
    const NEAR_MAX = 2500;
    const mk = (geo, mat, count, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.count = 0;
      m.castShadow = shadow;
      m.receiveShadow = shadow;
      m.frustumCulled = false;
      m.userData.dynamic = true;
      this.scene.add(m);
      return m;
    };
    F.near = { trunk: mk(trunk, barkMat, NEAR_MAX, true), crown: mk(crown, leafMat, NEAR_MAX, true), pTrunk: mk(palmGeo.trunk, palmTrunkMat, NEAR_MAX, true), pFronds: mk(palmGeo.fronds, frondMat, NEAR_MAX, true) };
    F.near.pFronds.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.45 });
    F.far = { trunk: mk(trunkLo, barkMat, n, false), crown: mk(crownLo, leafMat, n, false) };
    F.near.crown.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NEAR_MAX * 3), 3);
    F.far.crown.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    F.nearMax = NEAR_MAX;
    // too fine to matter in a rippling reflection
    this.reflectSkip.push(F.near.trunk, F.near.crown, F.near.pTrunk, F.near.pFronds, F.far.trunk, F.far.crown);
    this.updateFlora(0, 0, true);
  }

  /** Re-sort trees into full-detail (near the camera) and simple (far) sets when the camera moves. */
  updateFlora(cx, cz, force = false) {
    const F = this.flora;
    if (!F) return;
    if (!force && Math.hypot(cx - F.lastX, cz - F.lastZ) < 30) return;
    F.lastX = cx;
    F.lastZ = cz;
    const NEAR = (this.treeNear || 230) ** 2;
    const FAR = (this.treeFar || 1900) ** 2;
    const N = F.near;
    const L = F.far;
    let nt = 0;
    let np = 0;
    let nf = 0;
    const put = (mesh, k, i) => mesh.instanceMatrix.array.set(F.mats.subarray(i * 16, i * 16 + 16), k * 16);
    for (let i = 0; i < F.n; i++) {
      const dx = F.xs[i] - cx;
      const dz = F.zs[i] - cz;
      const d = dx * dx + dz * dz;
      if (d > FAR) continue;
      if (d < NEAR && (F.palm[i] ? np : nt) < F.nearMax) {
        if (F.palm[i]) {
          put(N.pTrunk, np, i);
          put(N.pFronds, np, i);
          np++;
        } else {
          put(N.trunk, nt, i);
          put(N.crown, nt, i);
          N.crown.instanceColor.array.set(F.cols.subarray(i * 3, i * 3 + 3), nt * 3);
          nt++;
        }
      } else {
        put(L.trunk, nf, i);
        put(L.crown, nf, i);
        L.crown.instanceColor.array.set(F.cols.subarray(i * 3, i * 3 + 3), nf * 3);
        nf++;
      }
    }
    N.trunk.count = N.crown.count = nt;
    N.pTrunk.count = N.pFronds.count = np;
    L.trunk.count = L.crown.count = nf;
    for (const m of [N.trunk, N.crown, N.pTrunk, N.pFronds, L.trunk, L.crown]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Street lights along the main roads, facing the carriageway. */
  buildLights(rng) {
    const lights = [];
    const tmp = {};
    for (const e of this.graph.edges) {
      if (e.c > 2 || e.len < 25 || !inTiles(e.pts[0], e.pts[1], 50)) continue;
      const deck = e.br ? this.deckAt(e.pts[0], e.pts[1]) : null;
      // One lamp every ~70 m, alternating sides, at the back of the pavement
      let side = rng() < 0.5 ? 1 : -1;
      for (let s = 15 + rng.range(0, 25); s < e.len - 8; s += 70) {
        e.poly.at(s, tmp);
        side = -side;
        const off = e.w / 2 + (e.c <= 2 ? 2.1 : 1.4);
        const x = tmp.x + tmp.tz * off * side;
        const z = tmp.z - tmp.tx * off * side;
        const onDeck = this.deckAt(x, z);
        if (onDeck === null && (this.overWater(x, z) || this.collideCircle(x, z, 0.6))) continue;
        // the arm reaches back over the road
        lights.push([x, onDeck ?? 0, z, Math.atan2(-tmp.tz * side, tmp.tx * side)]);
        if (onDeck === null) this.addCircle(x, z, 0.15);
      }
      void deck;
    }
    const pole = merge([
      new THREE.CylinderGeometry(0.09, 0.14, 7.6, 8).translate(0, 3.8, 0),
      new THREE.CylinderGeometry(0.26, 0.3, 0.5, 8).translate(0, 0.25, 0),
      new THREE.BoxGeometry(0.1, 0.1, 2.4).translate(0, 7.5, 1.15),
    ]);
    const head = new THREE.BoxGeometry(0.42, 0.14, 0.85).translate(0, 7.42, 2.3);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4a3c, metalness: 0.6, roughness: 0.5 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const poolMat = new THREE.MeshBasicMaterial({ map: T.glow(), color: 0xffa860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const poolGeo = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2);
    const poles = new THREE.InstancedMesh(pole, poleMat, lights.length);
    const heads = new THREE.InstancedMesh(head, headMat, lights.length);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, lights.length);
    const coneGeo = new THREE.CylinderGeometry(0.25, 3.4, 7.2, 20, 1, true).translate(0, 3.75, 2.3);
    this.coneMat = lightConeMaterial(new THREE.Color(1.0, 0.68, 0.38));
    const cones = new THREE.InstancedMesh(coneGeo, this.coneMat, lights.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    lights.forEach(([x, y, z, ry], i) => {
      q.setFromAxisAngle(Y, ry);
      m4.compose(new THREE.Vector3(x, y, z), q, one);
      poles.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
      cones.setMatrixAt(i, m4);
      m4.makeTranslation(x + Math.sin(ry) * 2.3, y + 0.06, z + Math.cos(ry) * 2.3);
      pools.setMatrixAt(i, m4);
    });
    poles.castShadow = true;
    pools.renderOrder = 2;
    cones.renderOrder = 4;
    for (const m of [poles, heads, pools, cones]) {
      m.computeBoundingSphere();
      this.scene.add(m);
    }
    this.reflectSkip.push(pools, cones);
    this.lampHeadMat = headMat;
    this.poolMat = poolMat;
  }

  /**
   * A tube light under a station roof (along its local z after `yaw`), with a pool of
   * light on the floor below. Collected here and built once by buildStationLamps().
   */
  addStationLamp(x, y, z, yaw, len, floorY, pool) {
    this.stationLamps.push({ x, y, z, yaw, len, floorY, pool });
  }

  /** Platforms, stalls and shelters light up after dark: bright tubes, cool white pools. */
  buildStationLamps() {
    const L = this.stationLamps;
    if (!L.length) return;
    const tubes = [];
    const pools = [];
    for (const { x, y, z, yaw, len, floorY, pool } of L) {
      tubes.push(new THREE.BoxGeometry(0.14, 0.07, len).rotateY(yaw).translate(x, y, z));
      pools.push(new THREE.PlaneGeometry(pool, pool * 1.4).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, floorY + 0.03, z));
    }
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const poolMat = new THREE.MeshBasicMaterial({ map: T.glow(), color: 0xe4eeff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const tubeMesh = new THREE.Mesh(merge(tubes), tubeMat);
    const poolMesh = new THREE.Mesh(merge(pools), poolMat);
    poolMesh.renderOrder = 2;
    for (const m of [tubeMesh, poolMesh]) {
      this.scene.add(m);
      m.updateMatrixWorld(true);
      m.matrixAutoUpdate = false;
    }
    this.reflectSkip.push(poolMesh);
    // dim grey tubes by day, bloom-bright at night
    this.updaters.push((dt, t, night) => {
      tubeMat.color.setRGB(lerp(0.8, 2.6, night), lerp(0.82, 2.75, night), lerp(0.85, 3, night));
      poolMat.opacity = night * 0.5;
      poolMesh.visible = night > 0.02;
    });
    L.length = 0;
  }

  /** Hawkers' stalls under tarpaulins along the main-road pavements: thick round Esplanade, New Market and the stations. */
  buildHawkers(rng) {
    const hubs = [];
    for (const p of MAP.pois) if (/^(esplanade|dharmatala|new market|bara ?bazar|sealdah|howrah junction|college street|gariahat)/i.test(p.n)) hubs.push([p.x, p.z]);
    for (const s of MAP.stations) hubs.push([s.x, s.z]);
    const busy = (x, z) => hubs.reduce((m, [hx, hz]) => Math.max(m, 1 - Math.hypot(hx - x, hz - z) / 700), 0);
    const stalls = [];
    const tmp = {};
    for (const e of this.graph.edges) {
      if (e.c > 3 || e.br || e.len < 30 || !inTiles(e.pts[0], e.pts[1])) continue;
      for (let s = 8; s < e.len - 8; s += 4.2) {
        e.poly.at(s, tmp);
        const p = 0.04 + busy(tmp.x, tmp.z) * 0.55;
        if (rng() > p) {
          s += 6;
          continue;
        }
        const side = rng() < 0.5 ? 1 : -1;
        const off = e.w / 2 + (e.c <= 2 ? 2.4 : 1.8);
        const x = tmp.x + tmp.tz * off * side;
        const z = tmp.z - tmp.tx * off * side;
        if (this.overWater(x, z) || this.collideCircle(x, z, 1.1)) continue;
        // facing the street
        stalls.push([x, z, Math.atan2(-tmp.tz * side, tmp.tx * side), rng()]);
        this.addCircle(x, z, 0.9);
      }
    }
    if (!stalls.length) return;
    // table with goods, two poles, and the sloping tarp (its colour per stall)
    const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const frame = merge([box(1.8, 0.75, 1.0, 0, 0.42, 0), box(0.05, 2.3, 0.05, 1.0, 1.15, -0.6), box(0.05, 2.3, 0.05, -1.0, 1.15, -0.6)]);
    const goods = merge([box(1.4, 0.3, 0.7, 0, 0.95, 0), box(0.5, 0.3, 0.4, 0.3, 1.25, -0.1)]);
    const tarp = new THREE.PlaneGeometry(2.4, 1.9).rotateX(-Math.PI / 2 + 0.22).translate(0, 2.1, 0.15);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
    const goodsMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const tarpMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
    // the blue, orange, yellow and green plastic sheets every Kolkata pavement knows
    const tarps = ['#1f5fbf', '#2b6fd6', '#e8742a', '#e8c21b', '#2f8a4a', '#c8382c', '#1f5fbf', '#f2f0ea'];
    const wares = ['#e8c97a', '#c0392b', '#f2c14e', '#3c8d2f', '#ffffff', '#d98a1f', '#8e44ad', '#2e6da4'];
    // one small set of meshes per 250 m cell, so far-off cells can be switched off
    const cells = new Map();
    for (const st of stalls) {
      const k = `${Math.floor(st[0] / 250)},${Math.floor(st[1] / 250)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(st);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);
    this.stallCells = [];
    for (const list of cells.values()) {
      const group = new THREE.Group();
      const fM = new THREE.InstancedMesh(frame, frameMat, list.length);
      const gM = new THREE.InstancedMesh(goods, goodsMat, list.length);
      const tM = new THREE.InstancedMesh(tarp, tarpMat, list.length);
      let cx = 0;
      let cz = 0;
      list.forEach(([x, z, yaw, r], i) => {
        cx += x;
        cz += z;
        q.setFromAxisAngle(Y, yaw);
        m4.compose(new THREE.Vector3(x, 0, z), q, one);
        fM.setMatrixAt(i, m4);
        gM.setMatrixAt(i, m4);
        tM.setMatrixAt(i, m4);
        tM.setColorAt(i, col.set(tarps[Math.floor(r * tarps.length)]));
        gM.setColorAt(i, col.set(wares[Math.floor(r * 97) % wares.length]));
      });
      tM.castShadow = true;
      for (const m of [fM, gM, tM]) {
        m.receiveShadow = true;
        m.computeBoundingSphere();
        group.add(m);
        this.reflectSkip.push(m);
      }
      group.userData.dynamic = true;
      this.scene.add(group);
      this.stallCells.push({ group, x: cx / list.length, z: cz / list.length });
    }
  }

  /** Low-detail blocks beyond the mapped tiles so the city doesn't end at a cliff. */
  buildSkyline(rng) {
    const boxes = [];
    const R = 1300;
    const S = 42;
    for (let x = BOUNDS.x0 - R; x < BOUNDS.x1 + R; x += S) {
      for (let z = BOUNDS.z0 - R; z < BOUNDS.z1 + R; z += S) {
        const px = x + rng.range(-8, 8);
        const pz = z + rng.range(-8, 8);
        if (inTiles(px, pz, 25)) continue;
        if (this.river && inPoly(this.river, px, pz)) continue;
        if (this.overWater(px, pz) || rng() < 0.25) continue;
        const near = TILES.some(([x0, z0, x1, z1]) => px > x0 - R && px < x1 + R && pz > z0 - R && pz < z1 + R);
        if (!near) continue;
        boxes.push([px, pz, rng.range(10, 24), rng.range(10, 24), rng() < 0.1 ? rng.range(25, 50) : rng.range(8, 20), rng.range(0, 1.2)]);
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), boxes.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);
    const tones = Object.values(PALETTE);
    boxes.forEach(([x, z, w, d, h, ry], i) => {
      q.setFromAxisAngle(Y, ry);
      m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, d));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, col.copy(tones[i % tones.length]).multiplyScalar(0.75));
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.reflectSkip.push(mesh);
  }

  /** Pavements either side of streets, and footpaths, as walkable paths. */
  buildWalkPaths() {
    this.walkPaths = [];
    this.walkGrid = new Grid(100);
    const add = (pts) => {
      const wp = walkPath(pts);
      if (wp.poly.len < 20) return;
      const mid = wp.poly.at(wp.poly.len / 2, {});
      wp.cx = mid.x;
      wp.cz = mid.z;
      this.walkPaths.push(wp);
      this.walkGrid.insert(wp, mid.x, mid.x, mid.z, mid.z);
    };
    for (const e of this.graph.edges) {
      if (e.c > 5 || e.br || e.len < 20 || !inTiles(e.pts[0], e.pts[1])) continue;
      const off = e.w / 2 + (e.c <= 2 ? 1.6 : 1.1);
      add(offsetLine(e.pts, off));
      add(offsetLine(e.pts, -off));
    }
    for (const r of MAP.roads) {
      if (!r.foot || r.br || r.tn || r.h === 'steps') continue;
      add(r.n.flatMap(nodeXZ));
    }
  }

  /** Walking paths whose middle lies between minD and maxD of a point. */
  pathsNear(x, z, minD, maxD) {
    const out = [];
    this.walkGrid.query(x - maxD, x + maxD, z - maxD, z + maxD, (p) => {
      const d = Math.hypot(p.cx - x, p.cz - z);
      if (d >= minD && d <= maxD) out.push(p);
    });
    return out;
  }

  update(dt, t, night, sunDir, camPos = null) {
    this.time.value = t;
    if (camPos) {
      this.updateFlora(camPos.x, camPos.z);
      // hawkers' stalls only near the camera
      if (this.stallCells) for (const c of this.stallCells) c.group.visible = Math.abs(c.x - camPos.x) < 420 && Math.abs(c.z - camPos.z) < 420;
      if (this.tankCells) for (const c of this.tankCells) c.group.visible = Math.abs(c.x - camPos.x) < 520 && Math.abs(c.z - camPos.z) < 520;
    }
    for (const m of Object.values(this.facadeMats)) m.emissiveIntensity = lerp(0.04, 0.8, night);
    this.shopMat.emissiveIntensity = lerp(0.35, 1.4, night);
    this.mats.neonMat.color.setScalar(lerp(1.3, 3, night));
    const blink = Math.sin(t * 3) > 0.55 ? 1 : 0.15;
    this.mats.redMat.color.setRGB(blink * lerp(2, 9, night), 0.05, 0.05);
    this.lampHeadMat.color.setRGB(lerp(0.75, 5, night), lerp(0.75, 3.8, night), lerp(0.72, 2.4, night));
    this.poolMat.opacity = night * 0.4;
    this.coneMat.uniforms.uIntensity.value = night * 0.13;
    this.mats.roadMat.roughness = lerp(1, 0.6, night);
    for (const f of this.updaters) f(dt, t, night);
    const wu = this.water.material.uniforms;
    wu.time.value = t * 0.35;
    wu.sunDirection.value.copy(sunDir);
    // The Hooghly is silty: olive-brown by day, near black at night, with a dimmer moon glint
    wu.waterColor.value.setRGB(lerp(0.36, 0.025, night), lerp(0.3, 0.025, night), lerp(0.18, 0.022, night));
    wu.sunColor.value.setScalar(lerp(0.9, 0.12, night));
  }
}

/* ---------- Palm tree template ---------- */
function palmGeometries() {
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 3, 0), new THREE.Vector3(0.8, 6, 0), new THREE.Vector3(1.5, 8.6, 0)]);
  const TUB = 20;
  const RAD = 7;
  const trunk = new THREE.TubeGeometry(curve, TUB, 0.26, RAD, false);
  const pos = trunk.attributes.position;
  const uv = trunk.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (RAD + 1)) / TUB;
    const c = curve.getPointAt(t);
    const k = 1.2 - 0.55 * t;
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
    const u0 = uv.getX(i);
    uv.setXY(i, uv.getY(i), u0 * 6);
  }
  trunk.computeVertexNormals();
  const top = curve.getPointAt(1);
  const fronds = [];
  const r = T.makeRng(7);
  const COUNT = 11;
  for (let f = 0; f < COUNT; f++) {
    const g = new THREE.PlaneGeometry(1.6, 4.8, 1, 8);
    const p = g.attributes.position;
    const az = (f / COUNT) * Math.PI * 2 + r.range(-0.2, 0.2);
    const tilt = r.range(0.15, 0.6);
    const droop = r.range(1.8, 2.6);
    for (let i = 0; i < p.count; i++) {
      const across = p.getX(i);
      const s = (p.getY(i) + 2.4) / 4.8;
      const L = s * 4.8;
      const fwd = L * Math.cos(tilt);
      const up = L * Math.sin(tilt) - droop * s * s - Math.abs(across) * 0.35;
      const x = across * Math.cos(az) + fwd * Math.sin(az);
      const z = -across * Math.sin(az) + fwd * Math.cos(az);
      p.setXYZ(i, top.x + x, top.y + up, top.z + z);
    }
    g.computeVertexNormals();
    fronds.push(g);
  }
  return { trunk, fronds: merge(fronds) };
}

/** Additive view-dependent cone used for fake volumetric light shafts. */
export function lightConeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uIntensity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        #ifdef USE_INSTANCING
          mat4 m = modelMatrix * instanceMatrix;
        #else
          mat4 m = modelMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vN = normalize(mat3(m) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vH = uv.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float a = f * pow(vH, 1.5) * uIntensity;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
