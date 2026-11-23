import * as THREE from 'three';
import { METRO_DEPTH, PLATFORM_H, SIDEWALK_H, inTiles } from './world.js';
import { Consist, Track, railMats, signTexture, KINDS } from './rail.js';
import { MAP, nodeXZ, Poly, inPoly } from './geo.js';
import { merge, clamp } from './utils.js';

/*
 * Kolkata Metro: the Blue Line under Chowringhee and Central Avenue, and the
 * Green Line from Howrah under the Hooghly to Esplanade and Sealdah, on their
 * real routes. Each station is a tiled hall lined up with the track, with a
 * stairway up to the street; tunnels follow the line between them.
 *
 * Below street level the player moves through "rooms": oriented boxes with a
 * floor and a ceiling. Anywhere outside every room is solid ground.
 */

const HALL_H = 6.5;
const TUNNEL_H = 5.5;
const HALL_HL = 48; // half length of a station hall: a four-car train fits
const PLAT0 = 1.9; // platform edge, from the track centre
const PLAT1 = 9; // back wall
const STAIR_V = 6; // stair centre line, from the track centre
const STAIR_HW = 1.3;
const STAIR_RUN = 22;
const TRACK_GAP = 4.6; // Up and Down tracks, centre to centre
const LINES = [
  { re: /blue line/i, name: 'Blue Line', color: 0x1f4fbf, css: '#2f6fe0', depth: METRO_DEPTH, trains: 6 },
  { re: /green line/i, name: 'Green Line', color: 0x1f9e4a, css: '#2fbf5a', depth: METRO_DEPTH - 14, trains: 4 },
];
/** Station names in Bengali, for the signs. */
const BN = {
  'howrah maidan': 'হাওড়া ময়দান',
  howrah: 'হাওড়া',
  mahakaran: 'মহাকরণ',
  esplanade: 'এসপ্ল্যানেড',
  sealdah: 'শিয়ালদহ',
  'park street': 'পার্ক স্ট্রিট',
  maidan: 'ময়দান',
  'rabindra sadan': 'রবীন্দ্র সদন',
  'chandni chowk': 'চাঁদনি চক',
  central: 'সেন্ট্রাল',
  'mahatma gandhi road': 'মহাত্মা গান্ধী রোড',
  'girish park': 'গিরিশ পার্ক',
  'shobhabazar sutanuti': 'শোভাবাজার সুতানুটি',
};
const bn = (n) => BN[n.toLowerCase()] || n;
const FONT_BN = '"Kohinoor Bangla", "Bangla MN", "Noto Sans Bengali", Arial';
const PSD_V = PLAT0 + 0.15; // Green Line platform screen doors, from the track centre
const PSD_H = 2.2;
const PSD_W = 0.7; // one leaf; a doorway is two

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Green exit sign with an arrow (dir: 1 = right, -1 = left, 0 = up). */
function exitTexture(dir) {
  return canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#0e7a3a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = `bold 54px ${FONT_BN}`;
    g.fillText('বাহির', 190, 56);
    g.font = 'bold 48px Arial';
    g.fillText('WAY OUT', 190, 114);
    // arrow
    g.save();
    g.translate(410, 80);
    g.rotate(dir > 0 ? 0 : dir < 0 ? Math.PI : -Math.PI / 2);
    g.beginPath();
    g.moveTo(-44, -14);
    g.lineTo(8, -14);
    g.lineTo(8, -38);
    g.lineTo(48, 0);
    g.lineTo(8, 38);
    g.lineTo(8, 14);
    g.lineTo(-44, 14);
    g.closePath();
    g.fill();
    g.restore();
  });
}
/** Lit posters for the platform walls: Metro notices and made-up local ads. */
const POSTERS = [
  (g, w, h) => {
    g.fillStyle = '#f3c623';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1b1b';
    g.font = `bold 60px ${FONT_BN}`;
    g.fillText('হলুদ রেখা পার করবেন না', w / 2, 120, w - 60);
    g.font = 'bold 54px Arial';
    g.fillText('DO NOT CROSS THE', w / 2, 230);
    g.fillText('YELLOW LINE', w / 2, 300);
    g.font = '600 30px Arial';
    g.fillText('Stand behind the line till the train stops', w / 2, 380, w - 60);
  },
  (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#1f4fb0');
    gr.addColorStop(1, '#0d2a66');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = 'bold 64px Arial';
    g.fillText('METRO SMART CARD', w / 2, 110, w - 60);
    g.font = `bold 46px ${FONT_BN}`;
    g.fillText('কাউন্টারে রিচার্জ করুন', w / 2, 200, w - 60);
    g.fillStyle = '#f3c623';
    g.fillRect(w / 2 - 170, 260, 340, 140);
    g.fillStyle = '#0d2a66';
    g.font = 'bold 44px Arial';
    g.fillText('TAP · GO', w / 2, 334);
  },
  (g, w, h) => {
    g.fillStyle = '#b8312a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3dc';
    g.font = `bold 84px ${FONT_BN}`;
    g.fillText('শারদ উৎসব', w / 2, 140, w - 60);
    g.font = 'bold 44px Arial';
    g.fillText('PUJO SPECIAL SERVICES', w / 2, 240, w - 60);
    g.font = '600 32px Arial';
    g.fillText('Trains every 5 min · late night till 2 am', w / 2, 320, w - 60);
    g.fillText('Kolkata Metro wishes you Shubho Bijoya', w / 2, 380, w - 60);
  },
  (g, w, h) => {
    g.fillStyle = '#f7efe0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a3b12';
    g.font = `bold 70px ${FONT_BN}`;
    g.fillText('মায়ের হাতের মিষ্টি', w / 2, 120, w - 60);
    g.font = 'bold 50px Arial';
    g.fillText('GOPAL MISHTI BHANDAR', w / 2, 220, w - 60);
    g.font = '600 32px Arial';
    g.fillText('Roshogolla · Sandesh · Mishti Doi', w / 2, 300, w - 60);
    g.fillText('Fresh every morning · Shyambazar', w / 2, 360, w - 60);
  },
  (g, w, h) => {
    g.fillStyle = '#123a2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8f5e9';
    g.font = 'bold 58px Arial';
    g.fillText('KEEP YOUR METRO CLEAN', w / 2, 120, w - 60);
    g.font = `bold 48px ${FONT_BN}`;
    g.fillText('মেট্রো পরিষ্কার রাখুন', w / 2, 210, w - 60);
    g.font = '600 32px Arial';
    g.fillText('No spitting · No smoking · No littering', w / 2, 300, w - 60);
    g.fillText('Fine up to ₹500', w / 2, 360, w - 60);
  },
];
let POSTER_MATS = null;
function posterMats() {
  if (POSTER_MATS) return POSTER_MATS;
  POSTER_MATS = POSTERS.map((draw) => {
    const t = canvasTex(768, 440, (g, w, h) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      draw(g, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 10;
      g.strokeRect(0, 0, w, h);
    });
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.45, roughness: 0.4 });
  });
  return POSTER_MATS;
}
function counterTexture() {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#1f4fb0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 40px ${FONT_BN}`;
    g.fillText('টিকিট কাউন্টার', w / 2, 40, w - 30);
    g.font = 'bold 36px Arial';
    g.fillText('TICKET COUNTER · TOKENS · CARDS', w / 2, 94, w - 30);
  });
}

/** Red station sign over a street entrance, as at Esplanade's Green Line entrance. */
function portalSignTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b8312a';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#f4ece0';
  g.lineWidth = 6;
  g.strokeRect(4, 4, 504, 120);
  g.fillStyle = '#f8f2e6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold 46px ${FONT_BN}`;
  g.fillText(`${bn(name)} মেট্রো`, 256, 44, 480);
  g.font = 'bold 32px Arial';
  g.fillText(`${name.toUpperCase()} METRO`, 256, 96, 480);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Blue hanging board listing the stations ahead, as on the Blue Line's platforms. */
function routeBoardTexture(ahead, towards) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#1f4fb0';
  g.fillRect(0, 0, 1024, 320);
  g.fillStyle = '#e8eefc';
  g.fillRect(680, 0, 6, 320);
  g.textBaseline = 'middle';
  const list = ahead.slice(0, 7);
  list.forEach((n, i) => {
    const y = 34 + i * 40;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(24, y, 6, 0, Math.PI * 2);
    g.fill();
    g.font = `bold 26px ${FONT_BN}`;
    g.fillText(bn(n), 42, y, 300);
    g.font = 'bold 24px Arial';
    g.fillText(n.toUpperCase(), 360, y, 310);
  });
  g.font = `bold 34px ${FONT_BN}`;
  g.fillText(`${bn(towards)} যাইবার গাড়ী`, 700, 110, 310);
  g.font = 'bold 30px Arial';
  g.fillText('TRAIN TOWARDS', 700, 180, 310);
  g.fillText(towards.toUpperCase(), 700, 222, 310);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Box from local (u, y, v) extents, in a frame with origin (cx, cz) and axis (ux, uz). */
function slab(list, fr, u0, u1, y0, y1, v0, v1) {
  const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0);
  g.translate((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  g.rotateY(-Math.atan2(fr.uz, fr.ux));
  g.translate(fr.cx, 0, fr.cz);
  list.push(g);
  return g;
}
const toWorld = (fr, u, v) => [fr.cx + fr.ux * u - fr.uz * v, fr.cz + fr.uz * u + fr.ux * v];

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c4b8';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 236 + Math.floor(Math.random() * 14);
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x * 64 + 2, y * 32 + 2, 60, 28);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
/** Triplanar-ish UVs in world metres so tiles stay square on any wall. */
function worldUV(g, scale) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
    const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u / scale, v / scale);
  }
  return g;
}

/** The longest connected run through a route's tunnel ways. */
function routePath(route) {
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const ri of route.rails) {
    const r = MAP.rails[ri];
    for (let i = 1; i < r.n.length; i++) {
      link(r.n[i - 1], r.n[i]);
      link(r.n[i], r.n[i - 1]);
    }
  }
  let best = null;
  for (const [start, nb] of adj) {
    if (nb.length !== 1) continue;
    const out = [start];
    const seen = new Set(out);
    let cur = start;
    let len = 0;
    for (;;) {
      const next = adj.get(cur).find((n) => !seen.has(n));
      if (next === undefined) break;
      const [ax, az] = nodeXZ(cur);
      const [bx, bz] = nodeXZ(next);
      len += Math.hypot(bx - ax, bz - az);
      out.push(next);
      seen.add(next);
      cur = next;
    }
    if (!best || len > best.len) best = { nodes: out, len };
  }
  return best;
}

export class Metro {
  constructor(scene, world, fx) {
    this.world = world;
    this.rooms = [];
    this.stations = [];
    this.trains = [];
    this.lines = [];
    const M = railMats();
    const tiles = new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.35, metalness: 0.05, envMapIntensity: 0.6 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.95, envMapIntensity: 0.4 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.5 });
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.5, 2.3) });
    const tile = [];
    const conc = [];
    const flo = [];
    const lamps = [];
    const yellow = [];
    const darkG = [];
    const rails = [];
    const bored = [];
    const blueLamps = [];
    const portal = [];
    const boards = [];
    const bands = new Map();
    const signs = [];
    const portals = [];
    const steelG = [];
    const gateLamps = [];
    const psdGlass = [];
    const counters = [];
    const exits = [];
    const posters = [];
    const nameSigns = [];
    this.psd = [];
    this.gates = []; // fare gates at the foot of each stairway
    this.platforms = []; // one per direction per station, for the next-train displays

    for (const L of LINES) {
      const route = MAP.routes.filter((r) => r.k === 'subway' && L.re.test(r.name)).sort((a, b) => b.rails.length - a.rails.length)[0];
      if (!route) continue;
      const D = L.depth;
      // Track: the mapped tunnel ways, or a chain through the stations if they're missing
      const stops = route.stops.filter((s) => s.n && inTiles(s.x, s.z, 200));
      const rp = routePath(route);
      let pts = rp && rp.len > 600 ? rp.nodes.map(nodeXZ) : stops.map((s) => [s.x, s.z]);
      // Trim to the mapped area plus a run-out
      const keep = pts.map(([x, z]) => inTiles(x, z, 250));
      const first = keep.indexOf(true);
      const last = keep.lastIndexOf(true);
      if (first < 0 || last - first < 2) continue;
      pts = pts.slice(first, last + 1);
      // Run the tunnel on past each end so a terminus gets a full hall (and overrun)
      const runout = (a, b) => {
        const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        return [a[0] + ((a[0] - b[0]) / l) * 320, a[1] + ((a[1] - b[1]) / l) * 320];
      };
      pts = [runout(pts[0], pts[1]), ...pts, runout(pts[pts.length - 1], pts[pts.length - 2])];
      const track = new Track(pts, 25);
      const poly = new Poly(pts.flat());
      const D0 = D;
      const color = L.color;
      if (!bands.has(color)) bands.set(color, []);
      const band = bands.get(color);
      // Stations along the line, by distance along the track
      const st = [];
      for (const s of stops) {
        const p = poly.project(s.x, s.z);
        if (p.d > 90 || p.s < HALL_HL + 20 || p.s > poly.len - HALL_HL - 20) continue;
        if (st.some((o) => Math.abs(o.s - p.s) < HALL_HL * 2.4)) continue;
        st.push({ name: s.n.replace(/\s*\(line \d\)/i, '').replace(/\s*\(.*?\)/, ''), s: track.nearest(s.x, s.z) });
      }
      st.sort((a, b) => a.s - b.s);
      const q = {};
      const frameAt = (s) => {
        const a = track.at(s - HALL_HL, {});
        const b = track.at(s + HALL_HL, {});
        const c = track.at(s, q);
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return { cx: c.x, cz: c.z, ux: (b.x - a.x) / l, uz: (b.z - a.z) / l };
      };

      if (st.length < 2) continue;
      /*
       * Two tracks: Up (on the line itself, trains running towards +s) and Down beside it.
       * Past each end station a crossover joins them; trains run through it into a short
       * siding, reverse out of sight and come back on the other track.
       */
      const T = TRACK_GAP;
      // The Down track goes on whichever side leaves both platforms' stairways under clear street
      const stairBad = (fr, v) => {
        let bad = 0;
        for (let u = -2; u <= STAIR_RUN + 2; u += 4) {
          const [x, z] = toWorld(fr, u - STAIR_RUN / 2 + 8, v);
          if (world.collideCircle(x, z, STAIR_HW + 0.6) || world.overWater(x, z)) bad++;
        }
        return bad;
      };
      let pos = 0;
      let neg = 0;
      for (const o of st) {
        const fr = frameAt(o.s);
        pos += stairBad(fr, STAIR_V) + stairBad(fr, -(T + STAIR_V));
        neg += stairBad(fr, -STAIR_V) + stairBad(fr, T + STAIR_V);
      }
      const LS = pos <= neg ? 1 : -1;
      const dvW = -T * LS; // the Down track's offset across the line (world v)
      const MK = KINDS.metro;
      const span = (MK.cars - 1) * (MK.L + MK.gap);
      const Y1 = st[0].s - HALL_HL - 10;
      const Y0 = Y1 - 60;
      const X0 = st[st.length - 1].s + HALL_HL + 10;
      const X1 = X0 + 60;
      const smooth = (t) => t * t * (3 - 2 * t);
      const downAt = (s) => (s <= Y0 || s >= X1 ? 0 : s < Y1 ? smooth((s - Y0) / (Y1 - Y0)) : s > X0 ? smooth((X1 - s) / (X1 - X0)) : 1);
      const laneAt = (s, bound) => (bound === 'down' ? downAt(s) * dvW : 0);
      const lanePt = (s, off, out) => {
        track.at(s, out);
        const l = Math.hypot(out.tx, out.tz) || 1;
        out.x -= (out.tz / l) * off;
        out.z += (out.tx / l) * off;
        return out;
      };

      /* ---- Tunnels between stations (pieces every 8 m), wide enough for both tracks ---- */
      const inHall = (s) => st.some((o) => Math.abs(o.s - s) < HALL_HL);
      const a = {};
      const b = {};
      const STEP = 8;
      const vlo = Math.min(0, dvW) - 3;
      const vhi = Math.max(0, dvW) + 3;
      for (let s = 2; s < track.len - 2; s += STEP) {
        const e = Math.min(track.len - 2, s + STEP);
        if (inHall((s + e) / 2)) continue;
        track.at(s, a);
        track.at(e, b);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.1) continue;
        const fr = { cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len };
        const h = len / 2 + 0.25;
        const wet = !!world.river && inPoly(world.river, fr.cx, fr.cz);
        slab(conc, fr, -h, h, D - 0.4, D, vlo, vhi);
        if (wet) {
          // Under the Hooghly: one big bored tube round both tracks, lit blue-white
          const R = (vhi - vlo) / 2 + 0.6;
          const vc = (vlo + vhi) / 2;
          const tube = new THREE.CylinderGeometry(R, R, h * 2, 26, 1, true).rotateZ(Math.PI / 2).translate(0, D + 2.3, vc);
          tube.rotateY(-Math.atan2(fr.uz, fr.ux)).translate(fr.cx, 0, fr.cz);
          bored.push(tube);
          const rib = new THREE.TorusGeometry(R - 0.08, 0.09, 6, 26).rotateY(Math.PI / 2).translate(0, D + 2.3, vc);
          rib.rotateY(-Math.atan2(fr.uz, fr.ux)).translate(fr.cx, 0, fr.cz);
          darkG.push(rib);
          for (const v of [0, dvW]) {
            slab(blueLamps, fr, -0.6, 0.6, D + 5.2, D + 5.3, v - 1.4, v - 1.3);
            slab(blueLamps, fr, -0.6, 0.6, D + 5.2, D + 5.3, v + 1.3, v + 1.4);
          }
        } else {
          slab(conc, fr, -h, h, D + TUNNEL_H, D + TUNNEL_H + 0.4, vlo - 0.4, vhi + 0.4);
          slab(conc, fr, -h, h, D, D + TUNNEL_H, vlo - 0.4, vlo);
          slab(conc, fr, -h, h, D, D + TUNNEL_H, vhi, vhi + 0.4);
          slab(lamps, fr, -0.3, 0.3, D + 3.6, D + 3.72, vlo + 0.02, vlo + 0.1);
          slab(lamps, fr, -0.3, 0.3, D + 3.6, D + 3.72, vhi - 0.1, vhi - 0.02);
        }
        this.rooms.push({ ...fr, hl: h, hw: (vhi - vlo) / 2, cv: (vlo + vhi) / 2, floor: D, ceil: D + TUNNEL_H, river: wet });
      }
      // Rails: the Up track the whole way, the Down track between the crossovers
      const railSeg = (p, q) => {
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        if (len < 0.1) return;
        const fr = { cx: (p.x + q.x) / 2, cz: (p.z + q.z) / 2, ux: (q.x - p.x) / len, uz: (q.z - p.z) / len };
        slab(rails, fr, -len / 2 - 0.02, len / 2 + 0.02, D, D + 0.12, 0.68, 0.755);
        slab(rails, fr, -len / 2 - 0.02, len / 2 + 0.02, D, D + 0.12, -0.755, -0.68);
        slab(rails, fr, -len / 2 - 0.02, len / 2 + 0.02, D, D + 0.1, 1.19, 1.31);
      };
      for (let s = 0; s < track.len - 0.5; s += 10) railSeg(track.at(s, a), track.at(Math.min(track.len, s + 10), b));
      for (let s = Y0; s < X1 - 0.5; s += s < Y1 || s >= X0 ? 4 : 10) {
        const e = Math.min(X1, s + (s < Y1 || s >= X0 ? 4 : 10));
        railSeg(lanePt(s, laneAt(s, 'down'), a), lanePt(e, laneAt(e, 'down'), b));
      }
      // Buffer stops at both tunnel ends
      for (const s of [1, track.len - 1]) {
        track.at(s, a);
        const fr = { cx: a.x, cz: a.z, ux: a.tx / (Math.hypot(a.tx, a.tz) || 1), uz: a.tz / (Math.hypot(a.tx, a.tz) || 1) };
        slab(conc, fr, -0.4, 0.4, D, D + TUNNEL_H, vlo - 0.4, vhi + 0.4);
        slab(yellow, fr, s > 1 ? -1.6 : 1, s > 1 ? -1 : 1.6, D, D + 1.1, -1.3, 1.3);
      }

      /* ---- Station halls: a platform for each direction, either side of the two tracks ---- */
      const names = st.map((q) => q.name);
      for (const o of st) {
        const F = frameAt(o.s);
        const side = LS;
        // mirrored hall coordinates: Up track at v = 0 with its platform at +v, Down track at -T
        const V = (v) => v * side;
        const vr = (v0, v1) => (side > 0 ? [v0, v1] : [-v1, -v0]);
        const sl = (list, u0, u1, y0, y1, v0, v1) => slab(list, F, u0, u1, y0, y1, ...vr(v0, v1));
        const faceU = Math.atan2(F.ux, F.uz);
        const faceV = (k) => Math.atan2(-F.uz * k, F.ux * k); // facing along world v * k
        const top = D + HALL_H;
        const u0 = -HALL_HL;
        const u1 = HALL_HL;
        const pf = D + PLATFORM_H;
        const sU0 = 8 - STAIR_RUN / 2 - STAIR_RUN / 2 + 2;
        const sU1 = sU0 + STAIR_RUN;
        const vMin = -T - PLAT1;
        const vMax = PLAT1;
        sl(flo, u0, u1, D - 0.4, D, vMin, vMax);
        // ceiling, open over each stairway
        let vc = vMin - 0.4;
        for (const [h0, h1] of [[-T - STAIR_V - STAIR_HW, -T - STAIR_V + STAIR_HW], [STAIR_V - STAIR_HW, STAIR_V + STAIR_HW]]) {
          sl(conc, u0, u1, top, top + 0.4, vc, h0);
          sl(conc, u0, sU0, top, top + 0.4, h0, h1);
          sl(conc, sU1, u1, top, top + 0.4, h0, h1);
          vc = h1;
        }
        sl(conc, u0, u1, top, top + 0.4, vc, vMax + 0.4);
        // end walls round the tunnel mouth
        for (const u of [u0 - 0.3, u1]) {
          sl(tile, u, u + 0.3, D, top, 3, vMax);
          sl(tile, u, u + 0.3, D, top, vMin, -T - 3);
          sl(tile, u, u + 0.3, D + TUNNEL_H, top, -T - 3, 3);
        }
        // columns down the middle between the tracks; lamps over both
        for (let u = u0 + 6; u < u1 - 4; u += 9) sl(tile, u - 0.25, u + 0.25, D, top, -T / 2 - 0.25, -T / 2 + 0.25);
        for (let u = u0 + 4; u < u1 - 2; u += 8) {
          sl(lamps, u - 1.6, u + 1.6, top - 0.1, top - 0.04, -0.15, 0.15);
          sl(lamps, u - 1.6, u + 1.6, top - 0.1, top - 0.04, -T - 0.15, -T + 0.15);
        }
        this.rooms.push({ ...F, hl: HALL_HL, hw: (vMax - vMin) / 2, cv: V((vMax + vMin) / 2), floor: D, ceil: top });
        let first = null;
        let pk = this.stations.length * 7;
        for (const [vt, sg, bound, pfNo] of [[0, 1, 'up', 1], [-T, -1, 'down', 2]]) {
          // platform coordinates: lv runs out from this platform's track
          const m = (lv) => vt + sg * lv;
          const pr = (a0, a1) => (m(a0) < m(a1) ? [m(a0), m(a1)] : [m(a1), m(a0)]);
          const pl = (list, a0, a1, y0, y1, l0, l1) => sl(list, a0, a1, y0, y1, ...pr(l0, l1));
          const P = (u, lv) => toWorld(F, u, V(m(lv)));
          const toTrack = faceV(-side * sg); // facing from the back wall towards the tracks
          pl(flo, u0 + 2, u1 - 2, D, pf, PLAT0, PLAT1);
          pl(yellow, u0 + 2, u1 - 2, pf, pf + 0.01, PLAT0, PLAT0 + 0.35);
          pl(tile, u0, u1, pf, top, PLAT1, PLAT1 + 0.3);
          pl(band, u0, u1, pf + 2.1, pf + 2.5, PLAT1 - 0.02, PLAT1 - 0.005);
          for (let u = u0 + 4; u < u1 - 2; u += 8) {
            if (u > sU0 - 1 && u < sU1 + 1) continue;
            pl(lamps, u - 1.6, u + 1.6, top - 0.1, top - 0.04, 5.25, 5.55);
          }
          for (let u = u0 + 6; u < u1 - 4; u += 9) {
            if (u > sU0 - 2 && u < sU1 + 2) continue;
            pl(tile, u - 0.3, u + 0.3, pf, top, 3.3, 3.9);
            pl(darkG, u + 3.4, u + 5.6, pf + 0.4, pf + 0.5, PLAT1 - 0.7, PLAT1 - 0.2);
          }
          this.rooms.push({ ...F, hl: HALL_HL - 2, hw: (PLAT1 - PLAT0) / 2, cv: V(m((PLAT1 + PLAT0) / 2)), floor: pf, ceil: top, pillars: true });
          // Stairway: steps from the platform up to the street
          const sV0 = STAIR_V - STAIR_HW;
          const sV1 = STAIR_V + STAIR_HW;
          const steps = 30;
          const run = STAIR_RUN / steps;
          const hTop = SIDEWALK_H;
          const hBot = pf;
          for (let k = 0; k < steps; k++) {
            const su = sU0 + k * run;
            const yTop = hBot + ((k + 1) / steps) * (hTop - hBot);
            pl(flo, su, su + run, hBot, yTop, sV0, sV1);
            pl(yellow, su + run - 0.06, su + run, yTop, yTop + 0.005, sV0, sV1);
          }
          for (const [w0, w1] of [[sV0 - 0.25, sV0], [sV1, sV1 + 0.25]]) pl(tile, sU0, sU1, hBot, hTop + 1.0, w0, w1);
          pl(tile, sU0 - 0.25, sU0, top, hTop + 1.0, sV0 - 0.25, sV1 + 0.25);
          const sc = P((sU0 + sU1) / 2, STAIR_V);
          world.addRamp(sc[0], sc[1], F.ux, F.uz, STAIR_RUN / 2, STAIR_HW, hBot, hTop);
          world.addHole(sc[0], sc[1], F.ux, F.uz, STAIR_RUN / 2 + 0.02, STAIR_HW + 0.02);
          this.rooms.push({ ...F, cx: sc[0], cz: sc[1], hl: STAIR_RUN / 2 + 1.5, hw: STAIR_HW, floor: hBot, ceil: 60, stair: true });
          // Street level: railings round the opening, the portal and the Metro sign
          for (const v of [sV0 - 0.15, sV1 + 0.15]) {
            const [ax, az] = P(sU0 - 0.3, v);
            const [bx, bz] = P(sU1, v);
            world.addWall(ax, az, bx, bz, 0.15);
            pl(darkG, sU0 - 0.4, sU1, hTop + 0.95, hTop + 1.05, v - 0.04, v + 0.04);
            for (let u = sU0; u <= sU1; u += 2) pl(darkG, u - 0.03, u + 0.03, hTop, hTop + 1.0, v - 0.03, v + 0.03);
            for (const u of [sU1 - 0.2, sU1 - 7]) pl(darkG, u - 0.06, u + 0.06, hTop, hTop + 3.2, v - 0.06, v + 0.06);
          }
          {
            const [ax, az] = P(sU0 - 0.3, sV0 - 0.15);
            const [bx, bz] = P(sU0 - 0.3, sV1 + 0.15);
            world.addWall(ax, az, bx, bz, 0.15);
          }
          const p0 = sU1 - 9;
          const p1 = sU1 + 1.2;
          for (const v of [sV0 - 0.75, sV1 + 0.75]) {
            pl(portal, p0, p1, hTop, hTop + 4.4, v - 0.3, v + 0.3);
            const [ax, az] = P(p0, v);
            const [bx, bz] = P(p1, v);
            world.addWall(ax, az, bx, bz, 0.35);
          }
          pl(portal, p0 - 0.4, p1 + 0.4, hTop + 4.4, hTop + 5.0, sV0 - 1.2, sV1 + 1.2);
          pl(portal, p0 - 0.3, p0, hTop + 1.0, hTop + 4.4, sV0 - 0.45, sV1 + 0.45);
          const [sx, sz] = P(sU1 + 1.6, sV1 + 1.4);
          darkG.push(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8).translate(sx, hTop + 1.7, sz));
          world.addCircle(sx, sz, 0.15);
          const [qx, qz] = P(p1 + 0.45, STAIR_V);
          portals.push({ name: o.name, x: qx, z: qz, y: hTop + 4.7, yaw: faceU });
          signs.push({ x: sx, z: sz, y: hTop + 3.8, color: L.css });
          if (!first) first = { sx, sz };
          // Smart-card fare gates across the foot of the stairs
          for (const v of [sV0 + 0.12, STAIR_V, sV1 - 0.12]) {
            pl(steelG, sU0 - 1.7, sU0 - 0.5, pf, pf + 1.0, v - 0.13, v + 0.13);
            pl(darkG, sU0 - 1.72, sU0 - 0.48, pf + 1.0, pf + 1.05, v - 0.15, v + 0.15);
            pl(gateLamps, sU0 - 0.62, sU0 - 0.5, pf + 0.9, pf + 1.0, v - 0.08, v + 0.08);
          }
          // The flaps between the cabinets, and low side panels: the stairway is walled in down to
          // the gates, so the only way between the street and the platform is through them
          {
            const gate = { name: o.name, line: L.name, F, side, vt, sg, uG: sU0 - 1.1, uA: sU0 - 1.75, uB: sU1, wA: sV0 - 0.25, wB: sV1 + 0.25, open: 0, openT: 0, leaves: { 1: [], [-1]: [] }, meshes: [] };
            const [ax, az] = P(0, 0);
            const [bx, bz] = P(0, 1);
            gate.dv = [bx - ax, bz - az];
            for (const [g0, g1] of [[sV0 + 0.25, STAIR_V - 0.13], [STAIR_V + 0.13, sV1 - 0.25]]) {
              const mid = (g0 + g1) / 2;
              pl(gate.leaves[-1], gate.uG - 0.03, gate.uG + 0.03, pf + 0.4, pf + 1.0, g0, mid - 0.01);
              pl(gate.leaves[1], gate.uG - 0.03, gate.uG + 0.03, pf + 0.4, pf + 1.0, mid + 0.01, g1);
              gate.leafW = mid - g0;
            }
            for (const w of [gate.wA, gate.wB]) pl(steelG, gate.uA, sU0, pf, pf + 1.05, w - 0.04, w + 0.04);
            this.gates.push(gate);
          }
          // Ticket counter against the back wall beside the gates
          const cu0 = sU0 - 6.4;
          const cu1 = sU0 - 2.2;
          pl(steelG, cu0, cu1, pf, pf + 1.1, PLAT1 - 1.1, PLAT1);
          pl(darkG, cu0 - 0.05, cu1 + 0.05, pf + 1.1, pf + 1.16, PLAT1 - 1.2, PLAT1);
          pl(psdGlass, cu0, cu1, pf + 1.16, pf + 2.4, PLAT1 - 1.08, PLAT1 - 1.04);
          pl(darkG, cu0 - 0.1, cu1 + 0.1, pf + 2.4, pf + 2.55, PLAT1 - 1.2, PLAT1);
          counters.push({ p: P((cu0 + cu1) / 2, PLAT1 - 1.22), y: pf + 2.95, yaw: toTrack });
          // Way-out signs across the platform, read facing the stairs
          for (const u of [u0 + 10, sU0 - 4, u1 - 10]) {
            const [x, z] = P(u, STAIR_V);
            exits.push({ x, z, y: top - 1.1, yaw: u < (sU0 + sU1) / 2 ? faceU + Math.PI : faceU });
            pl(darkG, u - 0.02, u + 0.02, top - 0.75, top, STAIR_V - 0.9, STAIR_V - 0.86);
            pl(darkG, u - 0.02, u + 0.02, top - 0.75, top, STAIR_V + 0.86, STAIR_V + 0.9);
          }
          // Posters and the station name on the back wall (seen from the trains and across the tracks)
          for (let u = u0 + 10.5; u < u1 - 4; u += 18) {
            if (u > sU0 - 8 && u < sU1 + 2) continue;
            posters.push({ p: P(u, PLAT1 - 0.03), y: pf + 1.9, yaw: toTrack, k: pk++ });
          }
          for (const u of [-28, 0, 28]) {
            const [x, z] = P(u, PLAT1 - 0.03);
            nameSigns.push({ x, z, y: pf + 3.5, yaw: toTrack, name: o.name, line: L.name });
          }
          // Green Line: full-height platform screen doors, lined up with the train's doors
          if (/green/i.test(L.name)) {
            const openings = [];
            for (let i = 0; i < MK.cars; i++) for (const f of [-0.36, -0.12, 0.12, 0.36]) openings.push(span / 2 - i * (MK.L + MK.gap) + f * MK.L);
            openings.sort((x, y) => x - y);
            const leaves = { 1: [], [-1]: [] };
            let u = u0 + 2;
            for (const du of [...openings, u1 - 2 + PSD_W]) {
              const e = Math.min(du - PSD_W, u1 - 2);
              if (e > u + 0.05) pl(psdGlass, u, e, pf, pf + PSD_H, PSD_V - 0.02, PSD_V + 0.02);
              pl(darkG, e - 0.06, e, pf, pf + PSD_H, PSD_V - 0.035, PSD_V + 0.035);
              if (du <= u1 - 2) {
                pl(darkG, du + PSD_W, du + PSD_W + 0.06, pf, pf + PSD_H, PSD_V - 0.035, PSD_V + 0.035);
                for (const dir of [1, -1]) {
                  const a0 = dir > 0 ? du : du - PSD_W;
                  leaves[dir].push(slab([], F, a0, a0 + PSD_W, pf, pf + PSD_H - 0.02, ...vr(...pr(PSD_V + 0.04, PSD_V + 0.07))));
                }
              }
              u = du + PSD_W + 0.06;
            }
            pl(darkG, u0 + 2, u1 - 2, pf + PSD_H, pf + PSD_H + 0.35, PSD_V - 0.08, PSD_V + 0.08);
            pl(band, u0 + 2, u1 - 2, pf + PSD_H + 0.12, pf + PSD_H + 0.24, PSD_V - 0.09, PSD_V - 0.081);
            pl(band, u0 + 2, u1 - 2, pf + PSD_H + 0.12, pf + PSD_H + 0.24, PSD_V + 0.081, PSD_V + 0.09);
            this.psd.push({ o, line: L.name, F, side, vt, sg, bound, openings, leaves, u0: u0 + 2, u1: u1 - 2, meshes: [], open: 0 });
          }
          // Blue boards listing the stations ahead in this platform's direction
          const idx = names.indexOf(o.name);
          const ahead = bound === 'up' ? names.slice(idx + 1) : names.slice(0, idx).reverse();
          if (ahead.length) {
            for (const [uu, yaw] of [[-20, faceU + Math.PI], [20, faceU]]) {
              const [bx2, bz2] = P(uu, 5.6);
              boards.push({ x: bx2, z: bz2, y: top - 1.3, yaw, ahead, towards: ahead[ahead.length - 1] });
            }
          }
          // Next-train displays (drawn by boards.js)
          this.platforms.push({ o, line: L.name, bound, no: pfNo, color: L.css, D, terminus: !ahead.length, displays: [-27, 25].map((u) => {
            const [x, z] = P(u, 4.6);
            return { x, z, y: top - 1.75, yaw: faceU };
          }), frame: F, side, vt, sg });
        }
        this.stations.push({ name: o.name, line: L.name, x: first.sx, z: first.sz, color: L.css, frame: F, side, D, T });
      }

      /* ---- Trains: several on each line, evenly spaced, Up and Down ---- */
      const R0 = Math.max(span + MK.L / 2 + 1, Y0 - 5 - MK.L / 2);
      const R1 = Math.min(track.len - MK.L / 2 - 1, X1 + 5 + span + MK.L / 2);
      const line = { name: L.name, color: L.css, track, stations: st, trains: [], R0, R1, span, cycle: 1 };
      const sideFor = (cs) => (lead) => {
        const c = lead - cs.span / 2;
        const o = st.find((q) => Math.abs(q.s - c) < 8);
        // car-local x: the Up platform lies at -LS, the Down platform at +LS
        return o ? (cs.bound === 'up' ? -LS : LS) : null;
      };
      for (let k = 0; k < L.trains; k++) {
        const cs = new Consist(scene, track, 'metro', [], fx, color);
        cs.metroLine = L.name;
        cs.K = { ...KINDS.metro, y: D0 + 0.12 };
        cs.laneAt = laneAt;
        cs.xover = { Y0, Y1, X0, X1 };
        cs.sideAt = sideFor(cs);
        cs.setStops([R0, ...st.map((o) => o.s + span / 2), R1]);
        cs.termDwell = 8;
        line.trains.push(cs);
        this.trains.push(cs);
      }
      // One trip round the loop to time it, then each train starts that far apart in time
      const reset = (cs) => {
        Object.assign(cs, { s: R0, dir: 1, bound: 'up', v: 0, state: 'dwell', dwell: 0.5, lastStop: R0, doorPlan: null, doorT: 0, doorWant: false, peers: null });
      };
      {
        // ...recording where it is when, for the next-train displays
        const cs = line.trains[0];
        reset(cs);
        let t = 0;
        let went = false;
        const pos = [];
        const time = [];
        for (let i = 0; i < 40000; i++) {
          cs.update(0.1, null, 0, null);
          t += 0.1;
          pos.push(this.loopPos(line, cs.s, cs.bound));
          time.push(t);
          if (cs.bound === 'down') went = true;
          else if (went) break;
        }
        line.cycle = t;
        line.profile = { pos: Float32Array.from(pos), time: Float32Array.from(time) };
      }
      line.trains.forEach((cs, k) => {
        reset(cs);
        const n = Math.round((k * line.cycle) / line.trains.length / 0.1);
        for (let i = 0; i < n; i++) cs.update(0.1, null, 0, null);
      });
      for (const cs of line.trains) {
        cs.peers = line.trains;
        cs.place();
      }
      for (const p of this.psd) if (p.line === L.name) p.trains = line.trains;
      for (const p of this.platforms) if (p.line === L.name) p.lineRef = line;
      this.lines.push(line);
    }

    const meshes = [
      [merge(tile.map((g) => worldUV(g, 1.2))), tiles],
      [merge(conc), concrete],
      [merge(flo), floorMat],
      [merge(lamps), this.lampMat],
      [merge(yellow), M.yellow],
      [merge(darkG), M.dark],
      [merge(rails), M.steel],
    ];
    for (const [color, list] of bands) meshes.push([merge(list), new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 })]);
    if (bored.length) meshes.push([merge(bored), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.85, side: THREE.DoubleSide })]);
    if (blueLamps.length) meshes.push([merge(blueLamps), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.9, 3.2) })]);
    if (steelG.length) meshes.push([merge(steelG), M.silver]);
    if (gateLamps.length) meshes.push([merge(gateLamps), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 0.8) })]);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc3cf, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.2, depthWrite: false });
    if (psdGlass.length) meshes.push([merge(psdGlass), glassMat]);
    const portalGeo = portal.length ? merge(portal) : null;
    if (portalGeo) meshes.push([portalGeo, new THREE.MeshStandardMaterial({ color: 0x6f7173, roughness: 0.8 })]);
    this.statics = [];
    for (const [g, m] of meshes) {
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      if (g === portalGeo) mesh.userData.surface = true;
      mesh.castShadow = m !== this.lampMat;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.statics.push(mesh);
    }
    // Station names on the platforms' back walls, and the glowing Metro sign at each entrance
    const nameMats = new Map();
    for (const ns of nameSigns) {
      const key = ns.name + ns.line;
      if (!nameMats.has(key)) {
        const tex = signTexture(ns.name.toUpperCase(), `KOLKATA METRO · ${ns.line.toUpperCase()}`);
        nameMats.set(key, new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), nameMats.get(key));
      sign.position.set(ns.x, ns.y, ns.z);
      sign.rotation.y = ns.yaw;
      scene.add(sign);
      this.statics.push(sign);
    }
    const mSigns = new Map();
    for (const sg of signs) {
      if (!mSigns.has(sg.color)) {
        const mTex = mSignTexture(sg.color);
        mSigns.set(sg.color, new THREE.MeshStandardMaterial({ map: mTex, emissive: 0xffffff, emissiveMap: mTex, emissiveIntensity: 1.5 }));
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), mSigns.get(sg.color));
      m.position.set(sg.x, sg.y, sg.z);
      m.userData.surface = true;
      scene.add(m);
      this.statics.push(m);
    }
    for (const p of portals) {
      const tex = portalSignTexture(p.name);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
      sign.position.set(p.x, p.y, p.z);
      sign.rotation.y = p.yaw;
      sign.userData.surface = true;
      scene.add(sign);
      this.statics.push(sign);
    }
    for (const b of boards) {
      const tex = routeBoardTexture(b.ahead, b.towards);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.5), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5 }));
      board.position.set(b.x, b.y, b.z);
      board.rotation.y = b.yaw;
      scene.add(board);
      this.statics.push(board);
    }
    // Way-out signs (a dark back on each), posters and the ticket counter sign
    const plane = (w, h, mat, x, y, z, yaw) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      scene.add(m);
      this.statics.push(m);
      return m;
    };
    const exitTex = exitTexture(0);
    const exitMat = new THREE.MeshStandardMaterial({ map: exitTex, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 0.8 });
    for (const e of exits) {
      plane(2, 0.62, exitMat, e.x, e.y, e.z, e.yaw);
      plane(2, 0.62, M.dark, e.x, e.y, e.z, e.yaw + Math.PI);
    }
    const pm = posterMats();
    for (const p of posters) plane(2.4, 1.4, pm[p.k % pm.length], p.p[0], p.y, p.p[1], p.yaw);
    if (counters.length) {
      const ct = counterTexture();
      const cm = new THREE.MeshStandardMaterial({ map: ct, emissive: 0xffffff, emissiveMap: ct, emissiveIntensity: 0.5 });
      for (const c of counters) plane(3.6, 0.9, cm, c.p[0], c.y, c.p[1], c.yaw);
    }
    // Platform screen door leaves: one mesh per station and sliding direction
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xc9dde2, transparent: true, opacity: 0.42, roughness: 0.08, metalness: 0.35, depthWrite: false });
    for (const p of this.psd) {
      for (const dir of [1, -1]) {
        if (!p.leaves[dir].length) continue;
        const mesh = new THREE.Mesh(merge(p.leaves[dir]), leafMat);
        mesh.userData.moving = true;
        scene.add(mesh);
        this.statics.push(mesh);
        p.meshes.push({ mesh, dir });
      }
      delete p.leaves;
    }
    // Fare gate flaps: one mesh per stairway and sliding direction
    const flapMat = new THREE.MeshStandardMaterial({ color: 0xd8323a, transparent: true, opacity: 0.85, roughness: 0.3 });
    for (const g of this.gates) {
      for (const dir of [1, -1]) {
        const mesh = new THREE.Mesh(merge(g.leaves[dir]), flapMat);
        mesh.userData.moving = true;
        scene.add(mesh);
        this.statics.push(mesh);
        g.meshes.push({ mesh, dir });
      }
      delete g.leaves;
    }
    for (const m of this.statics) {
      m.updateMatrixWorld(true);
      if (!m.userData.moving) m.matrixAutoUpdate = false;
    }
    this.train = this.trains[0];
    world.under = this;
  }

  /** Distance round the line's loop: out on the Up track, back on the Down. */
  loopPos(L, s, bound) {
    return bound === 'up' ? s - L.R0 : L.R1 - L.R0 + (L.R1 - s);
  }
  /** When (s into the loop) a train first reaches loop position p, or last leaves it. */
  profileTime(L, p, last = false) {
    const { pos, time } = L.profile;
    let lo = 0;
    let hi = pos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + (last ? 1 : 0)) >> 1;
      if (last ? pos[mid] <= p + 0.01 : pos[mid] < p) last ? (lo = mid) : (lo = mid + 1);
      else last ? (hi = mid - 1) : (hi = mid);
    }
    return time[lo];
  }
  /** Seconds until each train of the line reaches platform `pf` (soonest first), from the timed trip. */
  nextTrains(pf) {
    const L = pf.lineRef;
    if (!L || !L.profile) return [];
    const target = this.profileTime(L, this.loopPos(L, pf.o.s + L.span / 2, pf.bound));
    const out = [];
    for (const cs of L.trains) {
      if (cs.driven) continue;
      const p = this.loopPos(L, cs.s, cs.bound);
      const here = cs.state === 'dwell' && cs.bound === pf.bound && Math.abs(cs.s - L.span / 2 - pf.o.s) < 3;
      // a train standing somewhere is as far through its trip as its departure, less the wait
      const now = cs.state === 'dwell' ? this.profileTime(L, p, true) - Math.max(0, cs.dwell) : this.profileTime(L, p);
      out.push({ cs, here, t: here ? 0 : (((target - now) % L.cycle) + L.cycle) % L.cycle });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  /** The platform someone at (x, y, z) is standing on, if any. */
  platformAt(x, y, z) {
    for (const pf of this.platforms) {
      const F = pf.frame;
      if (Math.abs(y - (pf.D + PLATFORM_H)) > 2) continue;
      const dx = x - F.cx;
      const dz = z - F.cz;
      const u = dx * F.ux + dz * F.uz;
      const lv = ((-dx * F.uz + dz * F.ux) * pf.side - pf.vt) * pf.sg;
      if (Math.abs(u) < HALL_HL && lv > 0.5 && lv < PLAT1 + 0.5) return pf;
    }
    return null;
  }

  /** Local coordinates of a point in a room, and how far inside it is (negative = outside). */
  inner(r, x, z) {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const u = dx * r.ux + dz * r.uz;
    const v = -dx * r.uz + dz * r.ux - (r.cv || 0);
    return { u, v, d: Math.min(r.hl - Math.abs(u), r.hw - Math.abs(v)) };
  }
  floorAt(x, z) {
    let h = null;
    for (const r of this.rooms) {
      if (Math.abs(x - r.cx) > r.hl + r.hw + 12 || Math.abs(z - r.cz) > r.hl + r.hw + 12) continue;
      if (this.inner(r, x, z).d >= 0 && (h === null || r.floor > h)) h = r.floor;
    }
    return h;
  }
  ceilingAt(x, z) {
    let c = null;
    for (const r of this.rooms) {
      if (Math.abs(x - r.cx) > r.hl + r.hw + 12 || Math.abs(z - r.cz) > r.hl + r.hw + 12) continue;
      if (this.inner(r, x, z).d >= 0 && (c === null || r.ceil > c)) c = r.ceil;
    }
    return c ?? METRO_DEPTH + TUNNEL_H;
  }
  /** In the stretch of tunnel under the Hooghly? */
  underRiver(x, z) {
    for (const r of this.rooms) {
      if (!r.river || Math.abs(x - r.cx) > r.hl + 4 || Math.abs(z - r.cz) > r.hl + 4) continue;
      if (this.inner(r, x, z).d >= 0) return true;
    }
    return false;
  }
  /** Is this point inside the metro (below street level)? */
  inside(x, z) {
    return this.floorAt(x, z) !== null;
  }

  /** Keep a circle inside the union of rooms (and behind closed platform screen doors). */
  collideCircle(x, z, r) {
    const room = this.collideRooms(x, z, r);
    if (room) return room;
    for (const g of this.gates) {
      const q = this.gateLocal(g, x, z);
      if (!q) continue;
      const { u, lv } = q;
      // the stairway's side walls, from the gates up to the street
      if (u > g.uA - r && u < g.uB) {
        for (const w of [g.wA, g.wB]) {
          const d = lv - w;
          if (Math.abs(d) < r) return this.gatePush(g, 0, (d >= 0 ? 1 : -1) * (r - Math.abs(d)));
        }
      }
      // the gate itself, unless its flaps are open
      if (g.open < 0.8 && lv > g.wA && lv < g.wB && Math.abs(u - g.uG) < r) {
        const d = u - g.uG;
        return this.gatePush(g, (d >= 0 ? 1 : -1) * (r - Math.abs(d)), 0);
      }
    }
    for (const p of this.psd) {
      const dx = x - p.F.cx;
      const dz = z - p.F.cz;
      if (Math.abs(dx) > HALL_HL + 12 || Math.abs(dz) > HALL_HL + 12) continue;
      const u = dx * p.F.ux + dz * p.F.uz;
      const gap = ((-dx * p.F.uz + dz * p.F.ux) * p.side - p.vt) * p.sg - PSD_V;
      if (u < p.u0 - r || u > p.u1 + r || Math.abs(gap) >= r) continue;
      if (p.open > 0.8 && p.openings.some((du) => Math.abs(u - du) < PSD_W - 0.2)) continue;
      // push back to whichever side of the doors you're on
      const lv = (gap >= 0 ? 1 : -1) * (r - Math.abs(gap)) * p.side * p.sg;
      const px = -p.F.uz * lv;
      const pz = p.F.ux * lv;
      const l = Math.hypot(px, pz) || 1;
      return { px, pz, nx: px / l, nz: pz / l };
    }
    return null;
  }
  /** A point in a gate's stairway coordinates: u along the hall, lv out from the track. */
  gateLocal(g, x, z) {
    const dx = x - g.F.cx;
    const dz = z - g.F.cz;
    if (Math.abs(dx) > HALL_HL + 12 || Math.abs(dz) > HALL_HL + 12) return null;
    const u = dx * g.F.ux + dz * g.F.uz;
    const lv = ((-dx * g.F.uz + dz * g.F.ux) * g.side - g.vt) * g.sg;
    if (u < g.uA - 1 || u > g.uB + 1 || lv < g.wA - 1 || lv > g.wB + 1) return null;
    return { u, lv };
  }
  gatePush(g, du, dlv) {
    const px = g.F.ux * du + g.dv[0] * dlv;
    const pz = g.F.uz * du + g.dv[1] * dlv;
    const l = Math.hypot(px, pz) || 1;
    return { px, pz, nx: px / l, nz: pz / l };
  }
  /** The fare gate in front of the player: 'in' on the stairs side (pay to go through), 'out' on the platform side. */
  gateNear(x, z) {
    for (const g of this.gates) {
      const q = this.gateLocal(g, x, z);
      if (!q || q.lv <= g.wA || q.lv >= g.wB) continue;
      if (q.u > g.uG && q.u < g.uG + 2.2) return { g, way: 'in' };
      if (q.u < g.uG && q.u > g.uG - 1.6) return { g, way: 'out' };
    }
    return null;
  }
  openGate(g, t = 2) {
    g.openT = Math.max(g.openT, t);
  }

  collideRooms(x, z, r) {
    let best = null;
    for (const room of this.rooms) {
      if (Math.abs(x - room.cx) > room.hl + room.hw + 12 || Math.abs(z - room.cz) > room.hl + room.hw + 12) continue;
      const q = this.inner(room, x, z);
      if (!best || q.d > best.q.d) best = { room, q };
    }
    if (!best || best.q.d >= r) return null;
    const { room, q } = best;
    // Push back across the nearest wall of the best room
    const pu = room.hl - Math.abs(q.u);
    const pv = room.hw - Math.abs(q.v);
    let lu = 0;
    let lv = 0;
    if (pu < pv) lu = -Math.sign(q.u) * (r - pu);
    else lv = -Math.sign(q.v) * (r - pv);
    const px = room.ux * lu - room.uz * lv;
    const pz = room.uz * lu + room.ux * lv;
    const l = Math.hypot(px, pz) || 1;
    return { px, pz, nx: px / l, nz: pz / l };
  }

  /** 2D segment vs walls; fraction of the first point outside every room (1 = clear). */
  raycast(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(len / 0.4));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.inside(ax + (bx - ax) * t, az + (bz - az) * t)) return Math.max(0, t - 1 / n);
    }
    return 1;
  }
  raycastHit(ax, az, bx, bz) {
    const t = this.raycast(ax, az, bx, bz);
    if (t >= 1) return null;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return { t, nx: -(bx - ax) / l, nz: -(bz - az) / l };
  }

  update(night, dt = 1 / 60) {
    this.lampMat.color.setScalar(2.2 + night * 0.6);
    // Fare gate flaps fold back into the cabinets while a gate is open
    for (const g of this.gates) {
      g.openT = Math.max(0, g.openT - dt);
      const want = g.openT > 0 ? 1 : 0;
      if (want === g.open) continue;
      g.open = want > g.open ? Math.min(1, g.open + dt * 4) : Math.max(0, g.open - dt * 4);
      for (const { mesh, dir } of g.meshes) mesh.position.set(g.dv[0] * dir * g.leafW * g.open, 0, g.dv[1] * dir * g.leafW * g.open);
    }
    // Screen doors follow the train's doors while it stands at the platform
    for (const p of this.psd) {
      let open = 0;
      for (const cs of p.trains || []) if (cs.bound === p.bound && cs.speed < 0.3 && Math.abs(cs.s - cs.span / 2 - p.o.s) < 3) open = Math.max(open, cs.doorT);
      if (open === p.open) continue;
      p.open = open;
      for (const { mesh, dir } of p.meshes) mesh.position.set(p.F.ux * dir * PSD_W * open, 0, p.F.uz * dir * PSD_W * open);
    }
  }
}

function mSignTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 84px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('M', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
void clamp;
