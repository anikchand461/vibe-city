import * as THREE from 'three';
import { METRO_DEPTH, PLATFORM_H, SIDEWALK_H, inTiles } from './world.js';
import { Consist, Track, railMats, signTexture, KINDS } from './rail.js';
import { MAP, nodeXZ, Poly, inPoly } from './geo.js';
import { merge, clamp, lerp } from './utils.js';

/*
 * Kolkata Metro: the Blue Line under Chowringhee and Central Avenue, and the
 * Green Line from Howrah under the Hooghly to Esplanade and Sealdah, on their
 * real routes. Each station is a tiled hall lined up with the track, as most of
 * Kolkata's underground stations are: one island platform with a track either
 * side, a concourse above it with the ticket counter and fare gates, and a
 * stairway up to the street; tunnels follow the line between them.
 *
 * Below street level the player moves through "rooms": oriented boxes with a
 * floor and a ceiling. Anywhere outside every room is solid ground. Rooms can
 * stack (the concourse over the platform): only those at your height count.
 */

const HALL_H = 6.5;
const TUNNEL_H = 5.5;
const HALL_HL = 48; // half length of a station hall: a four-car train fits
const PLAT0 = 1.9; // platform edge, from the track centre
const STAIR_HW = 1.3;
const TRACK_GAP = 4.6; // Up and Down tracks, centre to centre, between stations
const ISLAND_W = 10; // the island platform between the two tracks
const STATION_GAP = 2 * PLAT0 + ISLAND_W; // the tracks spread apart round it
const SPREAD = 60; // over this far either side of a station hall
const EDGE = 3; // track centre to the hall's outer wall
const CONC_H = 3.6; // concourse floor to ceiling
// Along a station (u, from the hall's centre towards its street stairway): the stairs from the
// island up to the concourse, the fare gates, and the end of the concourse where the street stairs start
const PS_A = -14;
const PS_B = -3;
const GATE_U = 8;
const CU1 = 23;
// Esplanade: the Blue and Green Lines' paid concourses joined by a passage underground
const INTERCHANGE = /^esplanade$/i;
const IX_U = 2.5; // where the passage leaves each concourse, between the stairs down and the gates
const IX_HW = 1.75;
const IX_H = 3.2;
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

/** Red station sign over a street entrance, as at Esplanade's Green Line entrance, with its gate number. */
function portalSignTexture(name, gate) {
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
  // the gate number in a white box on the right
  const right = gate ? 112 : 0;
  if (gate) {
    g.fillRect(512 - right + 4, 16, right - 20, 96);
    g.fillStyle = '#b8312a';
    g.font = 'bold 22px Arial';
    g.fillText('GATE', 512 - right / 2 - 4, 40);
    g.font = 'bold 50px Arial';
    g.fillText(String(gate), 512 - right / 2 - 4, 84, right - 30);
    g.fillStyle = '#f8f2e6';
  }
  const mid = (512 - right) / 2;
  g.font = `bold 46px ${FONT_BN}`;
  g.fillText(`${bn(name)} মেট্রো`, mid, 44, 480 - right);
  g.font = 'bold 32px Arial';
  g.fillText(`${name.toUpperCase()} METRO`, mid, 96, 480 - right);
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

/** Which way to which platform, hung where you step onto the island: [no, towards] for the left and right sides. */
function platformsTexture(left, right, css) {
  return canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = '#14181d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = css;
    g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#e8eef2';
    g.fillRect(w / 2 - 2, 18, 4, h - 50);
    g.textBaseline = 'middle';
    for (const [side, [no, towards]] of [[-1, left], [1, right]]) {
      const x0 = side < 0 ? 24 : w / 2 + 24;
      const x1 = side < 0 ? w / 2 - 24 : w - 24;
      // arrow on the outer edge
      g.save();
      g.translate(side < 0 ? x0 + 34 : x1 - 34, 80);
      g.rotate(side < 0 ? Math.PI : 0);
      g.beginPath();
      g.moveTo(-30, -11);
      g.lineTo(6, -11);
      g.lineTo(6, -30);
      g.lineTo(34, 0);
      g.lineTo(6, 30);
      g.lineTo(6, 11);
      g.lineTo(-30, 11);
      g.closePath();
      g.fill();
      g.restore();
      g.textAlign = side < 0 ? 'left' : 'right';
      const tx = side < 0 ? x0 + 84 : x1 - 84;
      g.font = 'bold 44px Arial';
      g.fillText(`Platform ${no}`, tx, 58, 330);
      g.font = '600 30px Arial';
      g.fillText(towards ? `Towards ${towards}` : 'Arrivals only', tx, 112, 330);
      g.font = `bold 26px ${FONT_BN}`;
      g.fillText(`প্ল্যাটফর্ম ${'০১২৩৪৫৬৭৮৯'[no]}`, tx, 150, 330);
    }
  });
}

/** Esplanade's interchange signs: the way through to the other line, or (inside the passage) this line's platforms. */
function interchangeTexture(line, css, here) {
  return canvasTex(768, 160, (g, w, h) => {
    g.fillStyle = '#14181d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = css;
    g.fillRect(0, 0, 22, h);
    g.beginPath();
    g.arc(78, h / 2, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 50px Arial';
    g.fillText('M', 78, h / 2 + 3);
    g.textAlign = 'left';
    g.font = 'bold 44px Arial';
    g.fillText(here ? `${line} · Platforms` : `Interchange · ${line}`, 138, 58, w - 160);
    g.font = `bold 32px ${FONT_BN}`;
    const bnLine = /blue/i.test(line) ? 'ব্লু লাইন' : 'গ্রিন লাইন';
    g.fillText(here ? `${bnLine} · প্ল্যাটফর্ম` : `ইন্টারচেঞ্জ · ${bnLine}`, 138, 114, w - 160);
  });
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
    const dirSigns = [];
    const interchange = [];
    const ixSigns = [];
    this.psd = [];
    this.gates = []; // fare gates across each station's concourse
    this.blocks = []; // solid boxes below ground: stair walls, columns, gate cabinets, counters
    this.platforms = []; // one per direction per station, for the next-train displays

    /*
     * The real street gates (railway=subway_entrance), each matched to the nearest stop of a
     * Metro line within a few hundred metres: Park Street Gate 1, 2, 3...
     */
    const gates = [];
    {
      const stops = [];
      for (const L of LINES) {
        for (const r of MAP.routes.filter((q) => q.k === 'subway' && L.re.test(q.name))) {
          for (const s of r.stops) if (s.n) stops.push({ line: L.name, station: s.n.replace(/\s*\(line \d\)/i, '').replace(/\s*\(.*?\)/, ''), x: s.x, z: s.z });
        }
      }
      for (const g of MAP.metroGates || []) {
        let best = null;
        for (const s of stops) {
          const d = Math.hypot(s.x - g.x, s.z - g.z);
          if (d < 320 && (!best || d < best.d)) best = { d, s };
        }
        if (!best) continue;
        const m = g.n.match(/gate\s*(\w+)/i);
        gates.push({ x: g.x, z: g.z, line: best.s.line, station: best.s.station, label: g.ref || (m ? m[1] : '') });
      }
    }
    const stationRecs = []; // each station's concourse, for the entrances built once every line is in

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
      const TS = STATION_GAP;
      const HW = TS / 2 + EDGE; // a station hall's half width
      const IW = TS / 2 - PLAT0; // the island's half width
      const pf = D + PLATFORM_H;
      const top = D + HALL_H;
      const Cf = top + 0.5; // concourse floor, just over the hall's ceiling
      const Cc = Cf + CONC_H;
      const RUN_S = clamp(-Cf * 1.15, 10, 24); // street stairs
      /*
       * A station's own frame: origin on the island's centre line, u along the hall towards its
       * street stairway (du picks which end), w across. The Down track goes on side -ls of the
       * line, so the island's centre is TS/2 that way.
       */
      const stationFrame = (o, ls, du) => {
        const F = frameAt(o.s);
        const [cx, cz] = toWorld(F, 0, (-ls * TS) / 2);
        return { F, cx, cz, ux: F.ux * du, uz: F.uz * du, ls, du };
      };
      // Street stairs want clear pavement: not in a building or the river, nor over another line's rooms
      const stairBad = (SF) => {
        let bad = 0;
        for (let u = CU1 - 2; u <= CU1 + RUN_S + 4; u += 3) {
          const [x, z] = toWorld(SF, u, 0);
          if (world.collideCircle(x, z, STAIR_HW + 0.6) || world.overWater(x, z)) bad++;
          if (this.rooms.some((r) => this.inner(r, x, z).d > -3)) bad += 3;
        }
        return bad;
      };
      let LS = 1;
      {
        const cost = (ls) => st.reduce((sum, o) => sum + Math.min(stairBad(stationFrame(o, ls, 1)), stairBad(stationFrame(o, ls, -1))), 0);
        if (cost(-1) < cost(1)) LS = -1;
      }
      for (const o of st) {
        // the concourse's free end (+u) faces the station's street gates, if the map has them
        o.gates = gates.filter((g) => g.line === L.name && g.station === o.name);
        if (o.gates.length) {
          const F = frameAt(o.s);
          o.du = o.gates.reduce((sum, g) => sum + (g.x - F.cx) * F.ux + (g.z - F.cz) * F.uz, 0) >= 0 ? 1 : -1;
        } else o.du = stairBad(stationFrame(o, LS, -1)) < stairBad(stationFrame(o, LS, 1)) ? -1 : 1;
      }
      const MK = KINDS.metro;
      const span = (MK.cars - 1) * (MK.L + MK.gap);
      const Y1 = st[0].s - HALL_HL - 10;
      const Y0 = Y1 - 60;
      const X0 = st[st.length - 1].s + HALL_HL + 10;
      const X1 = X0 + 60;
      const smooth = (t) => t * t * (3 - 2 * t);
      const downAt = (s) => (s <= Y0 || s >= X1 ? 0 : s < Y1 ? smooth((s - Y0) / (Y1 - Y0)) : s > X0 ? smooth((X1 - s) / (X1 - X0)) : 1);
      // the tracks spread apart through each station, round its island platform
      const spreadAt = (s) => {
        let k = 0;
        for (const o of st) {
          const d = Math.abs(s - o.s) - HALL_HL - 1;
          k = Math.max(k, d <= 0 ? 1 : d >= SPREAD ? 0 : smooth(1 - d / SPREAD));
        }
        return k;
      };
      const laneAt = (s, bound) => (bound === 'down' ? -LS * downAt(s) * (T + (TS - T) * spreadAt(s)) : 0);
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
      for (let s = 2; s < track.len - 2; s += STEP) {
        const e = Math.min(track.len - 2, s + STEP);
        if (inHall((s + e) / 2)) continue;
        const oa = laneAt(s, 'down');
        const ob = laneAt(e, 'down');
        const vlo = Math.min(0, oa, ob) - EDGE;
        const vhi = Math.max(0, oa, ob) + EDGE;
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
          for (const v of [0, (oa + ob) / 2]) {
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
      for (let s = Y0; s < X1 - 0.5; s += 4) {
        const e = Math.min(X1, s + 4);
        railSeg(lanePt(s, laneAt(s, 'down'), a), lanePt(e, laneAt(e, 'down'), b));
      }
      // Buffer stops at both tunnel ends (past the crossovers there's only the one track)
      for (const s of [1, track.len - 1]) {
        track.at(s, a);
        const fr = { cx: a.x, cz: a.z, ux: a.tx / (Math.hypot(a.tx, a.tz) || 1), uz: a.tz / (Math.hypot(a.tx, a.tz) || 1) };
        slab(conc, fr, -0.4, 0.4, D, D + TUNNEL_H, -EDGE - 0.4, EDGE + 0.4);
        slab(yellow, fr, s > 1 ? -1.6 : 1, s > 1 ? -1 : 1.6, D, D + 1.1, -1.3, 1.3);
      }

      /*
       * ---- Stations: an island platform between the two tracks; stairs from the middle of it up
       * to a concourse with the ticket counter and fare gates; from there, stairs up to the street.
       * You pay once at the gates, then go down and stand on whichever side your train leaves from.
       */
      const names = st.map((q) => q.name);
      const SW = STAIR_HW;
      const ord = (p, q) => (p < q ? [p, q] : [q, p]);
      for (const o of st) {
        const SF = stationFrame(o, LS, o.du);
        let rec = null; // this station's concourse, for its entrances
        const F = SF.F;
        const sl = (list, u0, u1, y0, y1, w0, w1) => slab(list, SF, u0, u1, y0, y1, w0, w1);
        const P = (u, w) => toWorld(SF, u, w);
        const blk = (u0, u1, w0, w1, y0, y1) => this.blocks.push({ F: SF, u0, u1, w0, w1, y0, y1 });
        const room = (u0, u1, w0, w1, r) => {
          const uc = (u0 + u1) / 2;
          const [cx, cz] = P(uc, 0);
          // a flight of stairs: [floor at a, floor at b, a, b], kept in the room's own u
          if (r.slope) r.slope = [r.slope[0], r.slope[1], r.slope[2] - uc, r.slope[3] - uc];
          this.rooms.push({ cx, cz, ux: SF.ux, uz: SF.uz, hl: (u1 - u0) / 2, hw: (w1 - w0) / 2, cv: (w0 + w1) / 2, ...r });
        };
        const faceU = (k) => Math.atan2(SF.ux * k, SF.uz * k); // facing along u * k
        const faceW = (k) => Math.atan2(-SF.uz * k, SF.ux * k); // facing along w * k
        const u0 = -HALL_HL;
        const u1 = HALL_HL;
        let pk = this.stations.length * 7;

        /* The hall: track bed, outer walls, and the ceiling (open over the stairs to the concourse) */
        sl(flo, u0, u1, D - 0.4, D, -HW, HW);
        sl(conc, u0, u1, top, top + 0.4, -HW, -SW - 0.25);
        sl(conc, u0, u1, top, top + 0.4, SW + 0.25, HW);
        sl(conc, u0, PS_A, top, top + 0.4, -SW - 0.25, SW + 0.25);
        sl(conc, PS_B, u1, top, top + 0.4, -SW - 0.25, SW + 0.25);
        for (const e of [1, -1]) sl(tile, u0, u1, D, top, ...ord(e * HW, e * (HW + 0.3)));
        // end walls over the tunnel mouths
        for (const u of [u0 - 0.3, u1]) sl(tile, u, u + 0.3, D + TUNNEL_H, top, -HW - 0.3, HW + 0.3);
        // lamps over both tracks
        for (let u = u0 + 4; u < u1 - 2; u += 8) for (const e of [1, -1]) sl(lamps, u - 1.6, u + 1.6, top - 0.1, top - 0.04, (e * TS) / 2 - 0.15, (e * TS) / 2 + 0.15);
        room(u0, u1, -HW, HW, { floor: D, ceil: top });

        /* The island platform */
        sl(flo, u0 + 2, u1 - 2, D, pf, -IW, IW);
        for (const e of [1, -1]) sl(yellow, u0 + 2, u1 - 2, pf, pf + 0.01, ...ord(e * IW, e * (IW - 0.35)));
        for (let u = u0 + 4; u < u1 - 2; u += 8) for (const e of [1, -1]) sl(lamps, u - 1.6, u + 1.6, top - 0.1, top - 0.04, e * 2.6 - 0.15, e * 2.6 + 0.15);
        // columns down the middle, clear of the stairs
        for (let u = u0 + 6; u < u1 - 4; u += 9) {
          if (u > PS_A - 1.5 && u < PS_B + 1.5) continue;
          sl(tile, u - 0.3, u + 0.3, pf, top, -0.3, 0.3);
          blk(u - 0.3, u + 0.3, -0.3, 0.3, pf, top);
        }
        room(u0 + 2, u1 - 2, -IW, IW, { floor: pf, ceil: top });

        /* Each side of the island: its own track, direction and platform number */
        const idx = names.indexOf(o.name);
        const sides = {};
        // Platform 1 is northbound on the Blue Line (Dakshineswar) and eastbound on the Green (Sector V);
        // the Green Line's stations run west along the line, so its Up side is Platform 2
        const upNo = /green/i.test(L.name) ? 2 : 1;
        for (const [bound, no] of [['up', upNo], ['down', 3 - upNo]]) {
          // the Up track is on side +ls*du of the island (w), the Down track opposite
          const e = (bound === 'up' ? 1 : -1) * LS * o.du;
          const lvW = (lv) => e * (TS / 2 - lv); // w of a point lv out from this side's track
          const pl = (list, a0, a1, y0, y1, l0, l1) => sl(list, a0, a1, y0, y1, ...ord(lvW(l0), lvW(l1)));
          const ahead = bound === 'up' ? names.slice(idx + 1) : names.slice(0, idx).reverse();
          sides[e] = [no, ahead.length ? ahead[ahead.length - 1] : null];
          // the far wall across the track: the line's colour band, posters and the station's name
          sl(band, u0, u1, pf + 2.1, pf + 2.5, ...ord(e * (HW - 0.02), e * (HW - 0.005)));
          const toIsland = faceW(-e);
          for (let u = u0 + 10.5; u < u1 - 4; u += 18) posters.push({ p: P(u, e * (HW - 0.03)), y: pf + 1.9, yaw: toIsland, k: pk++ });
          for (const u of [-28, 0, 28]) {
            const [x, z] = P(u, e * (HW - 0.03));
            nameSigns.push({ x, z, y: pf + 3.5, yaw: toIsland, name: o.name, line: L.name });
          }
          // Green Line: full-height platform screen doors along this edge, lined up with the train's doors
          if (/green/i.test(L.name)) {
            const openings = [];
            for (let i = 0; i < MK.cars; i++) for (const f of [-0.36, -0.12, 0.12, 0.36]) openings.push(span / 2 - i * (MK.L + MK.gap) + f * MK.L);
            // the train stops in the hall's own u; the station frame may run the other way
            for (let i = 0; i < openings.length; i++) openings[i] *= o.du;
            openings.sort((x, y) => x - y);
            const leaves = { 1: [], [-1]: [] };
            let u = u0 + 2;
            for (const du of [...openings, u1 - 2 + PSD_W]) {
              const end = Math.min(du - PSD_W, u1 - 2);
              if (end > u + 0.05) pl(psdGlass, u, end, pf, pf + PSD_H, PSD_V - 0.02, PSD_V + 0.02);
              pl(darkG, end - 0.06, end, pf, pf + PSD_H, PSD_V - 0.035, PSD_V + 0.035);
              if (du <= u1 - 2) {
                pl(darkG, du + PSD_W, du + PSD_W + 0.06, pf, pf + PSD_H, PSD_V - 0.035, PSD_V + 0.035);
                for (const dir of [1, -1]) {
                  const a0 = dir > 0 ? du : du - PSD_W;
                  leaves[dir].push(slab([], SF, a0, a0 + PSD_W, pf, pf + PSD_H - 0.02, ...ord(lvW(PSD_V + 0.04), lvW(PSD_V + 0.07))));
                }
              }
              u = du + PSD_W + 0.06;
            }
            pl(darkG, u0 + 2, u1 - 2, pf + PSD_H, pf + PSD_H + 0.35, PSD_V - 0.08, PSD_V + 0.08);
            pl(band, u0 + 2, u1 - 2, pf + PSD_H + 0.12, pf + PSD_H + 0.24, PSD_V - 0.09, PSD_V - 0.081);
            pl(band, u0 + 2, u1 - 2, pf + PSD_H + 0.12, pf + PSD_H + 0.24, PSD_V + 0.081, PSD_V + 0.09);
            this.psd.push({ o, line: L.name, F: SF, e, bound, openings, leaves, u0: u0 + 2, u1: u1 - 2, meshes: [], open: 0, y: pf });
          }
          // Blue boards listing the stations ahead from this side
          if (ahead.length) {
            for (const [uu, k] of [[-20, -1], [20, 1]]) {
              const [bx2, bz2] = P(uu, lvW(3.2));
              boards.push({ x: bx2, z: bz2, y: top - 1.3, yaw: faceU(k), ahead, towards: ahead[ahead.length - 1] });
            }
          }
          // Next-train displays (drawn by boards.js)
          this.platforms.push({ o, line: L.name, bound, no, color: L.css, D, terminus: !ahead.length, displays: [-27, 25].map((u) => {
            const [x, z] = P(u, lvW(4.6));
            return { x, z, y: top - 1.75, yaw: faceU(1) };
          }), F: SF, e, y: pf });
        }

        /* Stairs from the middle of the island up to the concourse (rising along +u) */
        {
          const steps = 20;
          const run = (PS_B - PS_A) / steps;
          for (let k = 0; k < steps; k++) {
            const su = PS_A + k * run;
            const yTop = pf + ((k + 1) / steps) * (Cf - pf);
            sl(flo, su, su + run, pf, yTop, -SW, SW);
            sl(yellow, su + run - 0.06, su + run, yTop, yTop + 0.005, -SW, SW);
          }
          for (const e of [1, -1]) {
            sl(tile, PS_A, PS_B, pf, Cc, ...ord(e * SW, e * (SW + 0.25)));
            blk(PS_A, PS_B, ...ord(e * SW, e * (SW + 0.25)), pf, Cc);
          }
          sl(conc, PS_A, PS_B, Cc, Cc + 0.4, -SW - 0.25, SW + 0.25);
          // the high end, seen from the platform, is a solid pier under the edge of the concourse
          sl(tile, PS_B, PS_B + 1.05, pf, top, -SW - 0.25, SW + 0.25);
          blk(PS_B - 0.4, PS_B + 1.05, -SW - 0.25, SW + 0.25, pf, Cf - 1);
          // the stairs' room runs a metre on under the concourse floor, so there's no seam between them
          room(PS_A, PS_B + 1, -SW, SW, { floor: pf, ceil: Cc, slope: [pf, Cf, PS_A, PS_B] });
          // At the foot of the stairs: which side is which
          const [x, z] = P(PS_A - 3, 0);
          dirSigns.push({ x, z, y: top - 1.2, yaw: faceU(1), left: sides[1], right: sides[-1], color: L.css });
          sl(darkG, PS_A - 3.02, PS_A - 2.98, top - 0.7, top, -0.9, -0.86);
          sl(darkG, PS_A - 3.02, PS_A - 2.98, top - 0.7, top, 0.86, 0.9);
        }

        /* The concourse: paid side by the stairs down, the fare gates, the ticket counter on the free side */
        {
          const CW = IW;
          sl(flo, PS_B, CU1, top + 0.4, Cf, -CW, CW);
          /*
           * The side walls and the far end wall wait until every line is built: they get doorways
           * to the passages from the street gates (and, at Esplanade, to the other line).
           */
          const doors = { 1: [], [-1]: [], end: false };
          const walls = () => {
            for (const e of [1, -1]) {
              const gaps = doors[e].slice().sort((p, q) => p - q);
              let a0 = PS_B - 0.3;
              for (const g of [...gaps, null]) {
                const a1 = g === null ? CU1 + 0.3 : g - IX_HW;
                if (a1 > a0) {
                  sl(tile, a0, a1, Cf, Cc, ...ord(e * CW, e * (CW + 0.3)));
                  sl(band, Math.max(a0, PS_B), Math.min(a1, CU1), Cf + 2.1, Cf + 2.5, ...ord(e * (CW - 0.02), e * (CW - 0.005)));
                }
                if (g !== null) {
                  sl(tile, g - IX_HW, g + IX_HW, Cf + IX_H, Cc, ...ord(e * CW, e * (CW + 0.3)));
                  a0 = g + IX_HW;
                }
              }
              // the end by the stairs down is open to them; the far end, to a passage if one starts there
              sl(tile, PS_B - 0.3, PS_B, Cf, Cc, ...ord(e * (SW + 0.25), e * CW));
              sl(tile, CU1, CU1 + 0.3, Cf, Cc, ...ord(e * (doors.end ? IX_HW : 0), e * CW));
            }
            if (doors.end) sl(tile, CU1, CU1 + 0.3, Cf + IX_H, Cc, -IX_HW, IX_HW);
          };
          rec = { o, SF, Cf, Cc, CW, line: L.name, css: L.css, doors, walls, run: RUN_S, first: null };
          stationRecs.push(rec);
          if (INTERCHANGE.test(o.name)) interchange.push(rec);
          sl(conc, PS_B - 0.3, CU1 + 0.3, Cc, Cc + 0.4, -CW - 0.3, CW + 0.3);
          for (let u = PS_B + 3; u < CU1 - 1; u += 6) for (const e of [1, -1]) sl(lamps, u - 1.6, u + 1.6, Cc - 0.1, Cc - 0.04, e * 2.5 - 0.15, e * 2.5 + 0.15);
          room(PS_B, CU1, -CW, CW, { floor: Cf, ceil: Cc });
          // which side is which, at the top of the stairs down
          {
            const [x, z] = P(PS_B + 2, 0);
            dirSigns.push({ x, z, y: Cc - 0.8, yaw: faceU(1), left: sides[1], right: sides[-1], color: L.css });
          }
          // way out, for those coming up from the platform
          {
            const [x, z] = P(PS_B + 5, 0);
            exits.push({ x, z, y: Cc - 0.8, yaw: faceU(-1) });
          }
          // Smart-card fare gates across the middle, railings either side of them
          const uG = GATE_U;
          for (const w of [-SW + 0.12, 0, SW - 0.12]) {
            sl(steelG, uG - 0.6, uG + 0.6, Cf, Cf + 1.0, w - 0.13, w + 0.13);
            sl(darkG, uG - 0.62, uG + 0.62, Cf + 1.0, Cf + 1.05, w - 0.15, w + 0.15);
            sl(gateLamps, uG + 0.48, uG + 0.6, Cf + 0.9, Cf + 1.0, w - 0.08, w + 0.08);
            blk(uG - 0.6, uG + 0.6, w - 0.13, w + 0.13, Cf, Cf + 2.4); // (no vaulting the fare line)
          }
          for (const e of [1, -1]) {
            sl(steelG, uG - 0.05, uG + 0.05, Cf, Cf + 1.05, ...ord(e * SW, e * CW));
            blk(uG - 0.05, uG + 0.05, ...ord(e * SW, e * CW), Cf, Cf + 2.4);
          }
          const gate = { name: o.name, line: L.name, F: SF, uG, wA: -SW + 0.25, wB: SW - 0.25, y: Cf, open: 0, openT: 0, leaves: { 1: [], [-1]: [] }, meshes: [], dv: [-SF.uz, SF.ux] };
          for (const [g0, g1] of [[-SW + 0.25, -0.13], [0.13, SW - 0.25]]) {
            const mid = (g0 + g1) / 2;
            sl(gate.leaves[-1], uG - 0.03, uG + 0.03, Cf + 0.4, Cf + 1.0, g0, mid - 0.01);
            sl(gate.leaves[1], uG - 0.03, uG + 0.03, Cf + 0.4, Cf + 1.0, mid + 0.01, g1);
            gate.leafW = mid - g0;
          }
          this.gates.push(gate);
          // Ticket counter against the side wall, on the free side of the gates
          const cu0 = uG + 3;
          const cu1 = uG + 7.2;
          sl(steelG, cu0, cu1, Cf, Cf + 1.1, CW - 1.1, CW);
          sl(darkG, cu0 - 0.05, cu1 + 0.05, Cf + 1.1, Cf + 1.16, CW - 1.2, CW);
          sl(psdGlass, cu0, cu1, Cf + 1.16, Cf + 2.4, CW - 1.08, CW - 1.04);
          sl(darkG, cu0 - 0.1, cu1 + 0.1, Cf + 2.4, Cf + 2.55, CW - 1.2, CW);
          blk(cu0, cu1, CW - 1.2, CW, Cf, Cf + 2.6);
          counters.push({ p: P((cu0 + cu1) / 2, CW - 1.22), y: Cf + 2.95, yaw: faceW(-1) });
        }

        /* Way-out signs on the island, for anyone walking towards the stairs */
        for (const [u, k] of [[u0 + 10, -1], [u1 - 10, 1]]) {
          const [x, z] = P(u, 0);
          exits.push({ x, z, y: top - 1.1, yaw: faceU(k) });
          sl(darkG, u - 0.02, u + 0.02, top - 0.75, top, -0.9, -0.86);
          sl(darkG, u - 0.02, u + 0.02, top - 0.75, top, 0.86, 0.9);
        }

        rec.station = { name: o.name, line: L.name, x: 0, z: 0, color: L.css, frame: F, side: LS, D, T: TS };
        this.stations.push(rec.station);
      }

      /* ---- Trains: several on each line, evenly spaced, Up and Down ---- */
      const R0 = Math.max(span + MK.L / 2 + 1, Y0 - 5 - MK.L / 2);
      const R1 = Math.min(track.len - MK.L / 2 - 1, X1 + 5 + span + MK.L / 2);
      const line = { name: L.name, color: L.css, track, stations: st, trains: [], R0, R1, span, cycle: 1 };
      const sideFor = (cs) => (lead) => {
        const c = lead - cs.span / 2;
        const o = st.find((q) => Math.abs(q.s - c) < 8);
        // car-local x: the island lies between the tracks, at +LS from the Up train and -LS from the Down
        return o ? (cs.bound === 'up' ? LS : -LS) : null;
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

    /*
     * ---- Passages under the street: tiled, lit, IX_HW either side of a path of points, with a
     * floor that follows hAt(distance along). Each bend gets a round landing. Its side walls open
     * where other passages branch off (gaps: { s along, side }), for its first `open` metres (where
     * it leaves a concourse or another passage) and its last `openEnd`.
     */
    const passage = (path, hAt, { gaps = [], open = 0, openEnd = 0 } = {}) => {
      // (a point repeated would make a bend with no way out)
      const pts = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 0.05);
      const segs = [];
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        segs.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, s0: total, len, trim: { start: { 1: 0, [-1]: 0 }, end: { 1: 0, [-1]: 0 } } });
        total += len;
      }
      /*
       * At a bend the straight walls stop where they meet the landing's round wall (and, on the
       * inside of a sharp turn, where they meet each other), so neither leg's wall juts into the other.
       */
      const R = IX_HW + 0.3;
      const half = Math.asin(Math.min(1, (IX_HW + 0.05) / R));
      {
        const wc = IX_HW + 0.15; // a wall's middle, out from the passage's
        const rw = R + 0.15;
        const dOut = Math.sqrt(Math.max(0, rw * rw - wc * wc));
        for (let j = 0; j < segs.length - 1; j++) {
          const a = segs[j];
          const b = segs[j + 1];
          const cross = a.ux * b.uz - a.uz * b.ux;
          const dot = a.ux * b.ux + a.uz * b.uz;
          if (dot > 0.9995) continue;
          const alpha = Math.acos(clamp(-dot, -1, 1)); // the angle between the way in and the way out
          const inner = cross >= 0 ? 1 : -1; // the side it turns towards
          const dIn = alpha > half * 2 ? dOut : wc / Math.tan(alpha / 2);
          a.trim.end[inner] = dIn;
          a.trim.end[-inner] = dOut;
          b.trim.start[inner] = dIn;
          b.trim.start[-inner] = dOut;
        }
      }
      for (const sg of segs) {
        let s = 0;
        while (s < sg.len - 0.01) {
          const y0 = hAt(sg.s0 + s);
          // short pieces where the floor climbs (a flight of stairs), longer where it's flat
          const e = Math.min(sg.len, s + (Math.abs(hAt(sg.s0 + s + 2) - y0) > 0.01 || Math.abs(hAt(sg.s0 + s + 0.7) - y0) > 0.01 ? 0.7 : 2));
          const l = e - s;
          const y1 = hAt(sg.s0 + e);
          const fr = { cx: sg.ax + sg.ux * (s + l / 2), cz: sg.az + sg.uz * (s + l / 2), ux: sg.ux, uz: sg.uz };
          const yLo = Math.min(y0, y1);
          const yHi = Math.max(y0, y1);
          slab(flo, fr, -l / 2 - 0.02, l / 2 + 0.02, yLo - 0.4, yHi, -IX_HW, IX_HW);
          if (yHi > yLo + 0.01) slab(yellow, fr, (y1 > y0 ? 1 : -1) * (l / 2 - 0.03) - 0.03, (y1 > y0 ? 1 : -1) * (l / 2 - 0.03) + 0.03, yHi, yHi + 0.005, -IX_HW, IX_HW);
          for (const k of [1, -1]) {
            // this piece's stretch of wall (along the whole path), less any openings on this side
            const w0 = Math.max(sg.s0 + s, sg.s0 + sg.trim.start[k]);
            const w1 = Math.min(sg.s0 + e, sg.s0 + sg.len - sg.trim.end[k]);
            let parts = w1 - w0 > 0.05 ? [[w0, w1]] : [];
            const holes = gaps.filter((q) => q.side === k).map((q) => [q.s - (q.h || IX_HW), q.s + (q.h || IX_HW)]);
            if (open > 0) holes.push([-1, open]);
            if (openEnd > 0) holes.push([total - openEnd, total + 1]);
            for (const [h0, h1] of holes) parts = parts.flatMap(([a0, a1]) => (h1 <= a0 || h0 >= a1 ? [[a0, a1]] : [[a0, h0], [h1, a1]].filter(([p0, p1]) => p1 - p0 > 0.05)));
            const mid = sg.s0 + s + l / 2;
            for (const [a0, a1] of parts) slab(tile, fr, a0 - mid, a1 - mid, yLo - 0.4, yHi + IX_H, ...(k > 0 ? [IX_HW, IX_HW + 0.3] : [-IX_HW - 0.3, -IX_HW]));
          }
          slab(conc, fr, -l / 2 - 0.3, l / 2 + 0.3, yHi + IX_H, yHi + IX_H + 0.4, -IX_HW - 0.3, IX_HW + 0.3);
          if (Math.floor((sg.s0 + e) / 6) > Math.floor((sg.s0 + s) / 6)) slab(lamps, fr, -0.3, 0.3, yHi + IX_H - 0.08, yHi + IX_H - 0.02, -0.9, 0.9);
          this.rooms.push({ ...fr, hl: l / 2 + 0.6, hw: IX_HW, cv: 0, floor: yLo, ceil: yHi + IX_H, head: IX_H, slope: [y0, y1, -l / 2, l / 2] });
          s = e;
        }
      }
      // the bends: a round landing, walled except where the passage comes in and goes out
      const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      for (let i = 1; i < pts.length - 1; i++) {
        const [cx, cz] = pts[i];
        const along = segs.find((sg) => Math.hypot(sg.ax - cx, sg.az - cz) < 0.01);
        if (!along) continue;
        const y = hAt(along.s0);
        const back = Math.atan2(pts[i - 1][0] - cx, pts[i - 1][1] - cz);
        const fwd = Math.atan2(pts[i + 1][0] - cx, pts[i + 1][1] - cz);
        for (const [a, b] of [[back, fwd], [fwd, back]]) {
          const len = norm(b - a) - half * 2;
          if (len <= 0.05) continue;
          // in short straight pieces (solid both ways, unlike an open cylinder seen from inside)
          const n = Math.max(2, Math.ceil(len / 0.35));
          const chord = 2 * (R + 0.15) * Math.sin(len / n / 2) + 0.08;
          for (let q = 0; q < n; q++) {
            const t = a + half + ((q + 0.5) / n) * len;
            const fr = { cx: cx + Math.sin(t) * (R + 0.15), cz: cz + Math.cos(t) * (R + 0.15), ux: Math.cos(t), uz: -Math.sin(t) };
            slab(tile, fr, -chord / 2, chord / 2, y - 0.4, y + IX_H, -0.15, 0.15);
          }
        }
        flo.push(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.4, 16).translate(cx, y - 0.2, cz));
        conc.push(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.4, 16).translate(cx, y + IX_H + 0.2, cz));
        this.rooms.push({ cx, cz, ux: 1, uz: 0, hl: IX_HW, hw: IX_HW, cv: 0, floor: y, ceil: y + IX_H });
      }
    };

    /*
     * ---- A stairway from the street down to a passage: bottom at (bx, bz), rising along (dx, dz)
     * for `run` metres from hBot to the pavement, with railings, a canopy, the station's sign
     * (and gate number) and the glowing M on its pole.
     */
    const streetStairs = (bx, bz, dx, dz, run, hBot, name, gate, css) => {
      const fr = { cx: bx, cz: bz, ux: dx, uz: dz };
      const sl = (list, u0, u1, y0, y1, w0, w1) => slab(list, fr, u0, u1, y0, y1, w0, w1);
      const P = (u, w) => toWorld(fr, u, w);
      const SW = STAIR_HW;
      const hTop = SIDEWALK_H;
      const steps = 30;
      const step = run / steps;
      for (let k = 0; k < steps; k++) {
        const su = k * step;
        const yTop = hBot + ((k + 1) / steps) * (hTop - hBot);
        sl(flo, su, su + step, hBot, yTop, -SW, SW);
        sl(yellow, su + step - 0.06, su + step, yTop, yTop + 0.005, -SW, SW);
      }
      for (const e of [1, -1]) sl(tile, -0.6, run, hBot - 0.4, hTop + 1.0, ...(e > 0 ? [SW, SW + 0.25] : [-SW - 0.25, -SW]));
      sl(tile, -0.6, -0.3, hBot + IX_H, hTop + 1.0, -SW - 0.25, SW + 0.25);
      const [scx, scz] = P(run / 2, 0);
      world.addRamp(scx, scz, dx, dz, run / 2, SW, hBot, hTop);
      world.addHole(scx, scz, dx, dz, run / 2 + 0.02, SW + 0.02);
      {
        const [rx, rz] = P((run - 1.5) / 2, 0);
        this.rooms.push({ cx: rx, cz: rz, ux: dx, uz: dz, hl: (run + 1.5) / 2 + 1.5, hw: SW, cv: 0, floor: hBot, ceil: 60, stair: true });
      }
      // Street level: railings round the opening, the canopy and the Metro sign
      for (const w of [-SW - 0.15, SW + 0.15]) {
        const [ax, az] = P(-0.3, w);
        const [ex, ez] = P(run, w);
        world.addWall(ax, az, ex, ez, 0.15);
        sl(darkG, -0.4, run, hTop + 0.95, hTop + 1.05, w - 0.04, w + 0.04);
        for (let u = 0; u <= run; u += 2) sl(darkG, u - 0.03, u + 0.03, hTop, hTop + 1.0, w - 0.03, w + 0.03);
        for (const u of [run - 0.2, run - 7]) sl(darkG, u - 0.06, u + 0.06, hTop, hTop + 3.2, w - 0.06, w + 0.06);
      }
      {
        const [ax, az] = P(-0.3, -SW - 0.15);
        const [ex, ez] = P(-0.3, SW + 0.15);
        world.addWall(ax, az, ex, ez, 0.15);
      }
      const p0 = run - 9;
      const p1 = run + 1.2;
      for (const w of [-SW - 0.75, SW + 0.75]) {
        sl(portal, p0, p1, hTop, hTop + 4.4, w - 0.3, w + 0.3);
        const [ax, az] = P(p0, w);
        const [ex, ez] = P(p1, w);
        world.addWall(ax, az, ex, ez, 0.35);
      }
      sl(portal, p0 - 0.4, p1 + 0.4, hTop + 4.4, hTop + 5.0, -SW - 1.2, SW + 1.2);
      sl(portal, p0 - 0.3, p0, hTop + 1.0, hTop + 4.4, -SW - 0.45, SW + 0.45);
      const [sx, sz] = P(run + 1.6, SW + 1.4);
      darkG.push(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8).translate(sx, hTop + 1.7, sz));
      world.addCircle(sx, sz, 0.15);
      const [qx, qz] = P(p1 + 0.45, 0);
      portals.push({ name, gate, x: qx, z: qz, y: hTop + 4.7, yaw: Math.atan2(dx, dz) });
      signs.push({ x: sx, z: sz, y: hTop + 3.8, color: css });
      return { sx, sz, top: P(run, 0) };
    };

    /*
     * ---- Esplanade: the interchange passage between the two lines' paid concourses, so you
     * change lines without going out through the gates. It leaves each concourse by the side
     * facing the other station and runs across between them, on their real positions; a
     * flight of stairs near the Green Line end climbs from its deeper concourse to the Blue's.
     */
    if (interchange.length === 2) {
      const [lo, hi] = interchange[0].Cf < interchange[1].Cf ? interchange : [interchange[1], interchange[0]];
      const ends = [lo, hi].map((c) => {
        const F = c.SF;
        const other = c === lo ? hi : lo;
        const [ox, oz] = toWorld(other.SF, IX_U, 0);
        const [mx, mz] = toWorld(F, IX_U, 0);
        const s = -(ox - mx) * F.uz + (oz - mz) * F.ux >= 0 ? 1 : -1;
        c.doors[s].push(IX_U);
        // a sign in the concourse pointing through the doorway to the other line
        const [sx, sz] = toWorld(F, IX_U, s * (c.CW - 1.5));
        ixSigns.push({ x: sx, z: sz, y: c.Cc - 0.6, yaw: Math.atan2(F.uz * s, -F.ux * s), to: other.line, css: other.css });
        return { c, s, mouth: toWorld(F, IX_U, s * (c.CW - 0.6)), out: toWorld(F, IX_U, s * (STATION_GAP / 2 + EDGE + 3)) };
      });
      const pts = [ends[0].mouth, ends[0].out, ends[1].out, ends[1].mouth];
      this.interchangePath = pts;
      // flat at the Green level, the stairs (rising 1 in 2), then flat at the Blue level
      const S1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) + 8;
      const S2 = S1 + (hi.Cf - lo.Cf) * 2;
      passage(pts, (s) => lerp(lo.Cf, hi.Cf, clamp((s - S1) / (S2 - S1), 0, 1)), { open: 0.6, openEnd: 0.6 });
      // inside the passage, at each end: which line's platforms are through there
      for (const [i, j, c] of [[0, 1, lo], [3, 2, hi]]) {
        const dx = pts[j][0] - pts[i][0];
        const dz = pts[j][1] - pts[i][1];
        const l = Math.hypot(dx, dz);
        ixSigns.push({ x: pts[i][0] + (dx / l) * 2.2, z: pts[i][1] + (dz / l) * 2.2, y: c.Cf + IX_H - 0.45, yaw: Math.atan2(dx, dz), to: c.line, css: c.css, here: true });
      }
    }
    /*
     * ---- Entrances: from each of a station's real gates, a stairway down and a passage under the
     * street to a doorway in the free side of its concourse (the far end, or the side walls clear of
     * the ticket counter). Each doorway takes one gate, the nearest pairs first; a station the map
     * has no gates for gets one stairway straight off the end of its concourse.
     */
    this.entrances = [];
    for (const rec of stationRecs) {
      const { SF, Cf, CW, run, doors, o } = rec;
      const out = STATION_GAP / 2 + EDGE + 3; // clear of the hall's side walls
      const openings = [
        { end: true, mouth: [CU1 - 0.6, 0], elbow: [CU1 + 3, 0], dir: [1, 0] },
        ...[[17.5, 1], [21.2, 1], [10.5, -1], [15, -1], [19.5, -1]].map(([u, e]) => ({ u, e, mouth: [u, e * (CW - 0.6)], elbow: [u, e * out], dir: [0, e] })),
      ];
      const local = (x, z) => {
        const dx = x - SF.cx;
        const dz = z - SF.cz;
        return [dx * SF.ux + dz * SF.uz, -dx * SF.uz + dz * SF.ux];
      };
      // a passage mustn't cut back across the concourse or the stairs down from it
      const crossesStation = (a, b) => {
        for (let t = 0.05; t <= 1; t += 0.05) {
          const u = a[0] + (b[0] - a[0]) * t;
          const w = a[1] + (b[1] - a[1]) * t;
          if (u > PS_A - 2 && u < CU1 + 1.5 && Math.abs(w) < CW + 1.5) return true;
        }
        return false;
      };
      const gl = o.gates.length ? o.gates.map((g) => ({ ...g, l: local(g.x, g.z) })) : [{ label: '', l: [CU1 + 3 + run + 2, 0] }];
      const W = (p) => toWorld(SF, p[0], p[1]);
      const len2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
      const segDist = (p, a, b) => {
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
      };
      /*
       * The station's passages and stairs are planned first, in station coordinates, then built:
       * each gate (nearest first) gets a doorway of its own if its way there stays clear of the
       * passages already planned, or else a branch off the nearest of them, as real subways do.
       */
      const plan = []; // { pts, gaps, open, stair: { top, dir } }
      // at Esplanade the interchange passage is already there: keep right out of it (no crossing)
      if (this.interchangePath && INTERCHANGE.test(o.name)) plan.push({ pts: this.interchangePath.map(([x, z]) => local(x, z)), ix: true });
      const PASS = IX_HW * 2 + 0.6; // two passages side by side, walls and all
      /*
       * Is a point (station coords) in a planned passage or stairway? (`skip`: a passage to ignore
       * near `at`.) A route heading across a passage (`dir`) may cross it: that becomes a junction.
       */
      const planned = (p, skip, at, dir) => {
        for (const q of plan) {
          for (let i = 0; i < q.pts.length - 1; i++) {
            if (q === skip && len2(p, at) < PASS + 1) continue;
            if (segDist(p, q.pts[i], q.pts[i + 1]) >= PASS) continue;
            if (q.ix) return true;
            const sl = len2(q.pts[i], q.pts[i + 1]) || 1;
            if (dir && Math.abs((dir[0] * (q.pts[i + 1][0] - q.pts[i][0]) + dir[1] * (q.pts[i + 1][1] - q.pts[i][1])) / sl) < 0.9) continue;
            return true;
          }
          if (!q.stair) continue;
          const { top, dir: sd } = q.stair;
          const along = (top[0] - p[0]) * sd[0] + (top[1] - p[1]) * sd[1];
          const across = Math.abs(-(top[0] - p[0]) * sd[1] + (top[1] - p[1]) * sd[0]);
          if (along > -2.5 && along < run + 0.6 && across < STAIR_HW + 1.2) return true;
        }
        return false;
      };
      // does a route (from its i-th point on) run into anything planned?
      const routeClashes = (pts, from, skip, at) => {
        for (let i = from; i < pts.length - 1; i++) {
          const L = len2(pts[i], pts[i + 1]);
          const n = Math.ceil(L);
          const dir = [(pts[i + 1][0] - pts[i][0]) / (L || 1), (pts[i + 1][1] - pts[i][1]) / (L || 1)];
          for (let k = 0; k <= n; k++) if (planned([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n], skip, at, dir)) return true;
        }
        return false;
      };
      // How much of a stairway (top at `top`, rising along `dir`) would be in a building, the river,
      // the station, another station's entrance or this one's plan: real gates sit against
      // buildings, so the stairs turn to suit. The lead from `from` to its foot is checked too.
      const inEntrance = (x, z) => this.rooms.some((r) => (r.stair || r.head) && Math.abs(x - r.cx) < r.hl + r.hw + 2 && Math.abs(z - r.cz) < r.hl + r.hw + 2 && this.inner(r, x, z).d > -1.2);
      const stairBlocked = (top, dir, from, skip, own = []) => {
        let bad = 0;
        const foot = [top[0] - dir[0] * run, top[1] - dir[1] * run];
        for (let t = -2.5; t <= run; t += 1) {
          for (const w of [-STAIR_HW - 0.4, 0, STAIR_HW + 0.4]) {
            const p = [top[0] - dir[0] * t - dir[1] * w, top[1] - dir[1] * t + dir[0] * w];
            const [x, z] = W(p);
            if (world.collideCircle(x, z, 0.3) || world.overWater(x, z)) bad++;
            // not over the concourse or the stairs down from it (their floors are too near the stairs')
            else if (p[0] > PS_A - 2 && p[0] < CU1 + 1.5 && Math.abs(p[1]) < CW + 1.5) bad++;
            else if (inEntrance(x, z) || planned(p, skip, from)) bad += 4;
            // nor over the very passage that leads to its foot
            else if (len2(p, foot) > PASS && own.some((a, i) => i < own.length - 1 && segDist(p, a, own[i + 1]) < PASS)) bad += 4;
          }
        }
        const bottom = [top[0] - dir[0] * run, top[1] - dir[1] * run];
        // the passage to its foot mustn't cut across the concourse or into other passages, nor the stairs fold back over it
        const lead = len2(from, bottom);
        if (lead > 1 && crossesStation(from, bottom)) bad += 50;
        if (lead > 1 && ((bottom[0] - from[0]) * dir[0] + (bottom[1] - from[1]) * dir[1]) / lead < -0.2) bad += 50;
        if (lead > 1 && routeClashes([from, bottom], 0, skip, from)) bad += 20;
        const n = Math.ceil(lead / 1.5);
        for (let i = 1; i < n; i++) {
          const [x, z] = W([from[0] + ((bottom[0] - from[0]) * i) / n, from[1] + ((bottom[1] - from[1]) * i) / n]);
          if (this.rooms.some((r) => r.stair && Math.abs(x - r.cx) < r.hl + r.hw + 2 && Math.abs(z - r.cz) < r.hl + r.hw + 2 && this.inner(r, x, z).d > -1.2)) bad += 3;
        }
        return bad;
      };
      const freeOps = new Set(openings);
      for (const g of [...gl].sort((p, q) => len2(p.l, [10, 0]) - len2(q.l, [10, 0]))) {
        // the ways in: a free doorway (straight, or along the outside of the hall first), or a branch
        const ways = [];
        const fallback = [];
        for (const op of freeOps) {
          for (const via of op.end ? [[]] : [[], [[clamp(g.l[0], -HALL_HL, HALL_HL), op.elbow[1]]]]) {
            const last = via.length ? via[0] : op.elbow;
            if (via.length && len2(last, op.elbow) < 3) continue;
            if ((via.length && crossesStation(op.elbow, last)) || (len2(last, g.l) > run + 3 && crossesStation(last, g.l))) continue;
            const pre = [op.mouth, op.elbow, ...via];
            const w = { op, pre, last, d: len2(op.elbow, last) + len2(last, g.l) + (via.length ? 6 : 0) };
            // (one that runs into another passage is only for when there's no other way)
            if (routeClashes([...pre, g.l], 1)) fallback.push(w);
            else ways.push(w);
          }
        }
        for (const q of plan) {
          if (q.ix) continue;
          // off the straight middle of a planned passage (clear of its bends and its ends)
          for (let i = 1; i < q.pts.length - 1; i++) {
            const a = q.pts[i];
            const b = q.pts[i + 1];
            const L2 = len2(a, b);
            if (L2 < PASS * 2 + 2) continue;
            // from the point nearest the gate, or further back so it can peel away at an angle
            // (clear of the bends, of where its stairs start, and of other branches off it)
            const lo = (PASS + 1) / L2;
            const hi = 1 - (i === q.pts.length - 2 ? PASS + 3 : PASS + 1) / L2;
            if (hi <= lo) continue;
            const tNear = clamp(((g.l[0] - a[0]) * (b[0] - a[0]) + (g.l[1] - a[1]) * (b[1] - a[1])) / (L2 * L2), lo, hi);
            // (a gate further on the same way: step out to one side first, then run alongside)
            const nrm = [-(b[1] - a[1]) / L2, (b[0] - a[0]) / L2];
            for (const t of [tNear, 0.2, 0.4, 0.6, 0.8].map((v) => clamp(v, lo, hi))) {
              const J = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
              if ((q.joins || []).some((p) => len2(p, J) < PASS * 2)) continue;
              for (const off of [0, PASS + 2.5, -(PASS + 2.5)]) {
                const K = [J[0] + nrm[0] * off, J[1] + nrm[1] * off];
                if (len2(K, g.l) > run + 3 && crossesStation(K, g.l)) continue;
                if (off && (crossesStation(J, K) || routeClashes([J, K], 0, q, J) || routeClashes([K, g.l], 0))) continue;
                if (!off && routeClashes([J, g.l], 0, q, J)) continue;
                ways.push({ parent: q, seg: i, J, pre: off ? [J, K] : [J], last: K, d: len2(J, K) + len2(K, g.l) + 4 });
              }
            }
          }
        }
        if (!ways.length) ways.push(...fallback);
        if (!ways.length) continue;
        ways.sort((p, q) => p.d - q.d);
        const way = ways[0];
        const { last } = way;
        /*
         * The stairs come up at the gate, carrying on the passage's way where that's clear, else
         * turned as little as will do. A gate right by where the passage gets to has its stairs
         * start there instead, coming up a stair's length away.
         */
        const far = len2(last, g.l) > run + 3;
        const base = far || !way.op || way.pre.length > 2 ? Math.atan2(g.l[1] - last[1], g.l[0] - last[0]) : Math.atan2(way.op.dir[1], way.op.dir[0]);
        let best = null;
        // the mapped point often sits on a building's outline: if the stairs don't fit there, the
        // nearest bit of clear pavement (within twenty metres) will do
        search: for (const [r, fromEnd] of [...(far ? [] : [[0, true]]), [0, false], [3, false], [6, false], [9, false], [12, false], [16, false], [20, false]]) {
          for (let k = 0; k < (r ? 8 : 1); k++) {
            const at = [g.l[0] + Math.cos((k * Math.PI) / 4) * r, g.l[1] + Math.sin((k * Math.PI) / 4) * r];
            const b0 = fromEnd ? base : Math.atan2(at[1] - last[1], at[0] - last[0]);
            for (const turn of fromEnd ? [0, 0.5, -0.5, 1, -1, 1.57, -1.57] : [0, 0.5, -0.5, 1, -1, 1.57, -1.57, 2.2, -2.2, 3.14]) {
              const dr = [Math.cos(b0 + turn), Math.sin(b0 + turn)];
              const top = fromEnd ? [last[0] + dr[0] * run, last[1] + dr[1] * run] : at;
              const bad = stairBlocked(top, dr, last, way.parent, way.pre.slice(1)) + r * 0.2;
              if (!best || bad < best.bad) best = { bad, dr, top };
              if (bad < 0.01 + r * 0.2) break search;
            }
          }
        }
        const dir = best.dr;
        const bottom = [best.top[0] - dir[0] * run, best.top[1] - dir[1] * run];
        // tail: from where this passage starts, the rest of the way back to a concourse doorway
        const tail = way.op ? [] : [...way.parent.pts.slice(0, way.seg + 1).reverse(), ...way.parent.tail];
        const entry = { g, pts: [...way.pre, bottom], gaps: [], open: way.op ? 0.6 : 0, stair: { top: best.top, dir }, fit: best.bad, op: way.op, tail, parentOf: way.parent };
        if (way.op) {
          freeOps.delete(way.op);
          if (way.op.end) doors.end = true;
          else doors[way.op.e].push(way.op.u);
        } else {
          // open the parent's wall where this one leaves it, and this one's walls inside the parent
          const q = way.parent;
          let sAlong = 0;
          for (let i = 0; i < way.seg; i++) sAlong += len2(q.pts[i], q.pts[i + 1]);
          sAlong += len2(q.pts[way.seg], way.J);
          const a = q.pts[way.seg];
          const b = q.pts[way.seg + 1];
          // which side it leaves by, and at what angle: a slanting branch cuts a longer opening,
          // shifted the way it heads, and its own walls start once it's clear of the parent
          const next = way.pre[1] || bottom;
          const L = len2(a, b);
          const pd = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
          const bl = len2(way.J, next) || 1;
          const bd = [(next[0] - way.J[0]) / bl, (next[1] - way.J[1]) / bl];
          const cr = pd[0] * bd[1] - pd[1] * bd[0];
          const side = cr >= 0 ? 1 : -1;
          const sin = Math.max(0.3, Math.abs(cr));
          const cos = pd[0] * bd[0] + pd[1] * bd[1];
          // where the branch's walls (either side, outer faces) cross the parent's wall line, along the parent
          const wo = IX_HW + 0.3;
          const at = [];
          for (const k of [1, -1]) for (const Lw of [IX_HW, wo]) at.push((Lw * cos - k * wo) / sin);
          const g0 = Math.min(...at) - 0.1;
          const g1 = Math.max(...at) + 0.1;
          q.gaps.push({ s: sAlong + (g0 + g1) / 2, side, h: (g1 - g0) / 2 });
          (q.joins ||= []).push(way.J);
          // ...and the branch's own walls start once both are clear of the parent
          entry.open = (wo + wo * Math.abs(cos)) / sin + 0.1;
        }
        plan.push(entry);
      }
      // where passages cross, a junction: both walls open, as wide as the other passage cuts across
      const along = (q, i, P) => {
        let d = 0;
        for (let k = 0; k < i; k++) d += len2(q.pts[k], q.pts[k + 1]);
        return d + len2(q.pts[i], P);
      };
      for (let qa = 0; qa < plan.length; qa++) {
        for (let qb = qa + 1; qb < plan.length; qb++) {
          const A = plan[qa];
          const B = plan[qb];
          if (A.ix || B.ix) continue;
          for (let i = 0; i < A.pts.length - 1; i++) {
            for (let j = 0; j < B.pts.length - 1; j++) {
              const [a0, a1, b0, b1] = [A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]];
              const r = [a1[0] - a0[0], a1[1] - a0[1]];
              const q2 = [b1[0] - b0[0], b1[1] - b0[1]];
              const den = r[0] * q2[1] - r[1] * q2[0];
              if (Math.abs(den) < 1e-6) continue;
              const t = ((b0[0] - a0[0]) * q2[1] - (b0[1] - a0[1]) * q2[0]) / den;
              const v = ((b0[0] - a0[0]) * r[1] - (b0[1] - a0[1]) * r[0]) / den;
              if (t <= 0 || t >= 1 || v <= 0 || v >= 1) continue;
              const X = [a0[0] + r[0] * t, a0[1] + r[1] * t];
              // (a branch meeting its own parent is already open there)
              if ((B.parentOf === A || A.parentOf === B) && (len2(X, B.pts[0]) < PASS || len2(X, A.pts[0]) < PASS)) continue;
              const sin = Math.max(0.3, Math.abs(den) / (len2(a0, a1) * len2(b0, b1)));
              const cos = Math.abs(r[0] * q2[0] + r[1] * q2[1]) / (len2(a0, a1) * len2(b0, b1));
              // the other passage's walls cross this one's wall lines over this much either way
              const h = (IX_HW * cos + IX_HW + 0.3) / sin + 0.1;
              for (const side of [1, -1]) {
                A.gaps.push({ s: along(A, i, X), side, h });
                B.gaps.push({ s: along(B, j, X), side, h });
              }
            }
          }
        }
      }
      // ...and built
      for (const q of plan) {
        if (q.ix) continue;
        passage(q.pts.map(W), () => Cf, { gaps: q.gaps, open: q.open });
        const wd = [SF.ux * q.stair.dir[0] - SF.uz * q.stair.dir[1], SF.uz * q.stair.dir[0] + SF.ux * q.stair.dir[1]];
        const bottom = q.pts[q.pts.length - 1];
        const [bx, bz] = W(bottom);
        const st = streetStairs(bx, bz, wd[0], wd[1], run, Cf, o.name, q.g.label, rec.css);
        // path: street, foot of the stairs, and back along the passages to the concourse doorway
        this.entrances.push({ name: o.name, line: rec.line, gate: q.g.label, x: st.sx, z: st.sz, color: rec.css, fit: q.fit, branch: !q.op, own: q.pts.length, path: [st.top, ...q.pts.map(W).reverse(), ...q.tail.map(W)] });
        // the station's own marker: its lowest-numbered gate
        if (!rec.first || String(q.g.label).localeCompare(String(rec.first.label), undefined, { numeric: true }) < 0) rec.first = { label: q.g.label, x: st.sx, z: st.sz };
      }
      rec.station.x = rec.first.x;
      rec.station.z = rec.first.z;
    }

    // every concourse's walls, now that their doorways are known
    for (const rec of stationRecs) rec.walls();

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
      const tex = portalSignTexture(p.name, p.gate);
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
    for (const d of ixSigns) {
      const tex = interchangeTexture(d.to, d.css, d.here);
      const sw = d.here ? 2.2 : 3.4; // smaller inside the passage
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.21), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }));
      sign.position.set(d.x, d.y, d.z);
      sign.rotation.y = d.yaw;
      scene.add(sign);
      this.statics.push(sign);
      const back = new THREE.Mesh(sign.geometry, M.dark);
      back.position.copy(sign.position);
      back.rotation.y = d.yaw + Math.PI;
      scene.add(back);
      this.statics.push(back);
    }
    for (const d of dirSigns) {
      const tex = platformsTexture(d.left, d.right, d.color);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.86), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }));
      sign.position.set(d.x, d.y, d.z);
      sign.rotation.y = d.yaw;
      scene.add(sign);
      this.statics.push(sign);
      const back = new THREE.Mesh(sign.geometry, M.dark);
      back.position.copy(sign.position);
      back.rotation.y = d.yaw + Math.PI;
      scene.add(back);
      this.statics.push(back);
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
    // Fare gate flaps: one mesh per gate and sliding direction
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
  /** The platform someone at (x, y, z) is standing on, if any: the side of the island they're nearer. */
  platformAt(x, y, z) {
    for (const pf of this.platforms) {
      if (Math.abs(y - pf.y) > 2) continue;
      const q = this.local(pf.F, x, z, HALL_HL + 12);
      if (!q) continue;
      const lv = STATION_GAP / 2 - pf.e * q.w; // out from this side's track
      if (Math.abs(q.u) < HALL_HL && lv > 0.5 && lv <= STATION_GAP / 2 + 0.01) return pf;
    }
    return null;
  }

  /** A point in a station frame (u along, w across), or null if it's well away. */
  local(F, x, z, near) {
    const dx = x - F.cx;
    const dz = z - F.cz;
    if (Math.abs(dx) > near || Math.abs(dz) > near) return null;
    return { u: dx * F.ux + dz * F.uz, w: -dx * F.uz + dz * F.ux };
  }
  /** Local coordinates of a point in a room, and how far inside it is (negative = outside). */
  inner(r, x, z) {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const u = dx * r.ux + dz * r.uz;
    const v = -dx * r.uz + dz * r.ux - (r.cv || 0);
    return { u, v, d: Math.min(r.hl - Math.abs(u), r.hw - Math.abs(v)) };
  }
  /** Does a room count for someone standing at height y? (Rooms stack: the concourse is over the platform.) */
  holds(r, y, x, z) {
    if (y === undefined) return true;
    // a passage's stairs: judged by the floor where you are, not the whole flight
    if (r.head) {
      const f = this.roomFloor(r, x, z);
      return y >= f - 1.5 && y <= f + r.head - 0.8;
    }
    return y >= r.floor - 1.5 && y <= r.ceil - 0.8;
  }
  roomCeil(r, x, z) {
    return r.head ? this.roomFloor(r, x, z) + r.head : r.ceil;
  }
  /** The floor of a room under a point: flat, or a flight of stairs rising along the room. */
  roomFloor(r, x, z) {
    if (!r.slope) return r.floor;
    const u = (x - r.cx) * r.ux + (z - r.cz) * r.uz;
    const [y0, y1, a, b] = r.slope;
    return lerp(y0, y1, clamp((u - a) / (b - a), 0, 1));
  }
  /** The rooms round a point at height y; all of them if none is at that height. */
  roomsAt(x, z, y, pad = 12) {
    const near = this.rooms.filter((r) => Math.abs(x - r.cx) <= r.hl + r.hw + pad && Math.abs(z - r.cz) <= r.hl + r.hw + pad);
    if (y === undefined) return near;
    const level = near.filter((r) => this.holds(r, y, x, z));
    return level.length ? level : near;
  }
  floorAt(x, z, y) {
    let h = null;
    for (const r of this.roomsAt(x, z, y)) {
      if (this.inner(r, x, z).d < 0) continue;
      const f = this.roomFloor(r, x, z);
      if (h === null || f > h) h = f;
    }
    return h;
  }
  ceilingAt(x, z, y) {
    let c = null;
    for (const r of this.roomsAt(x, z, y)) {
      if (this.inner(r, x, z).d < 0) continue;
      const rc = this.roomCeil(r, x, z);
      if (c === null || rc > c) c = rc;
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
  inside(x, z, y) {
    return this.floorAt(x, z, y) !== null;
  }

  /**
   * Keep a circle inside the rooms at its height, clear of solid things and closed gates and screen
   * doors. Every push counts, each from where the last left it: taking only the first let you slide
   * along a gate cabinet straight through the closed flaps beside it.
   */
  collideCircle(x, z, r, y) {
    let px = 0;
    let pz = 0;
    const add = (p) => {
      if (!p) return;
      px += p.px;
      pz += p.pz;
    };
    add(this.collideRooms(x, z, r, y));
    for (const b of this.blocks) {
      if (y !== undefined && !(y < b.y1 - 0.3 && y + 1.7 > b.y0)) continue;
      const q = this.local(b.F, x + px, z + pz, HALL_HL + 40);
      if (!q || q.u < b.u0 - r || q.u > b.u1 + r || q.w < b.w0 - r || q.w > b.w1 + r) continue;
      // out across the nearest face
      const pushes = [[b.u0 - r - q.u, 0], [b.u1 + r - q.u, 0], [0, b.w0 - r - q.w], [0, b.w1 + r - q.w]];
      let best = pushes[0];
      for (const p of pushes) if (Math.abs(p[0] + p[1]) < Math.abs(best[0] + best[1])) best = p;
      add(this.framePush(b.F, best[0], best[1]));
    }
    for (const g of this.gates) {
      if (y !== undefined && Math.abs(y - g.y) > 1.5) continue;
      const q = this.local(g.F, x + px, z + pz, HALL_HL + 40);
      // the flaps, unless they're open
      if (!q || g.open >= 0.8 || q.w <= g.wA || q.w >= g.wB || Math.abs(q.u - g.uG) >= r) continue;
      const d = q.u - g.uG;
      add(this.framePush(g.F, (d >= 0 ? 1 : -1) * (r - Math.abs(d)), 0));
    }
    for (const p of this.psd) {
      if (y !== undefined && Math.abs(y - p.y) > 2) continue;
      const q = this.local(p.F, x + px, z + pz, HALL_HL + 12);
      if (!q) continue;
      const gap = STATION_GAP / 2 - p.e * q.w - PSD_V;
      if (q.u < p.u0 - r || q.u > p.u1 + r || Math.abs(gap) >= r) continue;
      if (p.open > 0.8 && p.openings.some((du) => Math.abs(q.u - du) < PSD_W - 0.2)) continue;
      // push back to whichever side of the doors you're on
      add(this.framePush(p.F, 0, -p.e * (gap >= 0 ? 1 : -1) * (r - Math.abs(gap))));
    }
    // and the walls once more, so nothing shoves you out through one
    add(this.collideRooms(x + px, z + pz, r, y));
    if (!px && !pz) return null;
    const l = Math.hypot(px, pz);
    return { px, pz, nx: px / l, nz: pz / l };
  }
  /** A push given in a station frame's (u, w), in world terms. */
  framePush(F, du, dw) {
    const px = F.ux * du - F.uz * dw;
    const pz = F.uz * du + F.ux * dw;
    const l = Math.hypot(px, pz) || 1;
    return { px, pz, nx: px / l, nz: pz / l };
  }
  /** The fare gate in front of someone: 'in' on the street side (pay to go through), 'out' on the platform side. */
  gateNear(x, z, y) {
    for (const g of this.gates) {
      if (y !== undefined && Math.abs(y - g.y) > 1.5) continue;
      const q = this.local(g.F, x, z, HALL_HL + 40);
      if (!q || q.w <= g.wA || q.w >= g.wB) continue;
      if (q.u > g.uG && q.u < g.uG + 2.2) return { g, way: 'in' };
      if (q.u < g.uG && q.u > g.uG - 1.6) return { g, way: 'out' };
    }
    return null;
  }
  openGate(g, t = 2) {
    g.openT = Math.max(g.openT, t);
  }

  collideRooms(x, z, r, y) {
    let best = null;
    for (const room of this.roomsAt(x, z, y)) {
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
  raycast(ax, az, bx, bz, y) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(len / 0.4));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.inside(ax + (bx - ax) * t, az + (bz - az) * t, y)) return Math.max(0, t - 1 / n);
    }
    return 1;
  }
  raycastHit(ax, az, bx, bz, y) {
    const t = this.raycast(ax, az, bx, bz, y);
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
