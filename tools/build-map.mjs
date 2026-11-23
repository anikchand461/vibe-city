/*
 * Builds the game map from OpenStreetMap exports.
 *
 *   node tools/build-map.mjs            (or: npm run build:map)
 *
 * Reads every map-data/*.osm file, merges them, projects lat/lon to metres
 * around a fixed origin (x = east, z = south, 1 unit = 1 m) and writes a
 * compact src/data/kolkata.json with roads, buildings, water, green areas,
 * rail, platforms, stations, metro, bus and ferry routes and named places.
 *
 * Map data © OpenStreetMap contributors, available under the ODbL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'map-data');
const OUT = path.join(ROOT, 'src', 'data', 'kolkata.json');

/* ---------- Parse ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const attr = (s, k) => {
  const m = s.match(new RegExp(`\\s${k}="([^"]*)"`));
  return m ? m[1] : null;
};
function tagsOf(body) {
  const t = {};
  for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[unesc(m[1])] = unesc(m[2]);
  return t;
}

const nodes = new Map(); // id -> { lat, lon, tags }
const ways = new Map(); // id -> { nds, tags }
const rels = new Map(); // id -> { members, tags }
const tiles = [];
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.osm')).sort();
if (!files.length) throw new Error(`No .osm files in ${SRC}`);
for (const f of files) {
  const xml = fs.readFileSync(path.join(SRC, f), 'utf8');
  const b = xml.match(/<bounds [^>]*>/);
  if (b) tiles.push(['minlat', 'minlon', 'maxlat', 'maxlon'].map((k) => +attr(b[0], k)));
  for (const m of xml.matchAll(/<node ([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = attr(' ' + m[1], 'id');
    if (nodes.has(id)) continue;
    nodes.set(id, { lat: +attr(' ' + m[1], 'lat'), lon: +attr(' ' + m[1], 'lon'), tags: m[3] ? tagsOf(m[3]) : null });
  }
  for (const m of xml.matchAll(/<way ([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const id = attr(' ' + m[1], 'id');
    if (ways.has(id)) continue;
    ways.set(id, { id, nds: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]), tags: tagsOf(m[2]) });
  }
  for (const m of xml.matchAll(/<relation ([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const id = attr(' ' + m[1], 'id');
    if (rels.has(id)) continue;
    const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"/g)].map((x) => ({ type: x[1], ref: x[2], role: x[3] }));
    rels.set(id, { id, members, tags: tagsOf(m[2]) });
  }
  console.log(`read ${f}`);
}
console.log(`${nodes.size} nodes, ${ways.size} ways, ${rels.size} relations from ${files.length} files`);

/* ---------- Projection ---------- */
// A fixed origin, so adding map tiles never shifts existing coordinates
const lat0 = 22.5662;
const lon0 = 88.35862;
const MY = 110574.3 + 1.15 * (lat0 - 22) * 10; // metres per degree of latitude (close enough at 22.5° N)
const MX = 111320 * Math.cos((lat0 * Math.PI) / 180);
const r1 = (v) => Math.round(v * 10) / 10;
const proj = (lat, lon) => [r1((lon - lon0) * MX), r1(-(lat - lat0) * MY)];
const tileRects = tiles.map(([a, b, c, d]) => {
  const [x0, z1] = proj(a, b);
  const [x1, z0] = proj(c, d);
  return [x0, z0, x1, z1];
});
const MARGIN = 150;
const inPlay = (x, z) => tileRects.some(([x0, z0, x1, z1]) => x > x0 - MARGIN && x < x1 + MARGIN && z > z0 - MARGIN && z < z1 + MARGIN);
const P = (id) => {
  const n = nodes.get(id);
  return n ? proj(n.lat, n.lon) : null;
};
const pts = (nds) => {
  const out = [];
  for (const id of nds) {
    const p = P(id);
    if (!p) return null;
    out.push(p);
  }
  return out;
};
const flat = (ps) => ps.flat();

/* ---------- Geometry helpers ---------- */
function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
function closeRing(ps) {
  const r = ps.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}
/** Drop points closer than `d` to the previous one, and collinear points. */
function simplify(ring, d = 0.4) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < d) continue;
    out.push(p);
  }
  for (let i = out.length - 1; i >= 0 && out.length > 3; i--) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 0.02) out.splice(i, 1);
  }
  return out;
}
/** Join way node lists into rings (closed) and chains (open) for multipolygon relations. */
function assemble(wayList) {
  const segs = wayList.map((w) => w.nds.slice()).filter((s) => s.length > 1);
  const rings = [];
  const chains = [];
  while (segs.length) {
    let cur = segs.shift();
    let grew = true;
    while (cur[0] !== cur[cur.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = cur[cur.length - 1];
        const start = cur[0];
        if (s[0] === end) cur = cur.concat(s.slice(1));
        else if (s[s.length - 1] === end) cur = cur.concat(s.slice(0, -1).reverse());
        else if (s[s.length - 1] === start) cur = s.concat(cur.slice(1));
        else if (s[0] === start) cur = s.slice(1).reverse().concat(cur);
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    (cur[0] === cur[cur.length - 1] ? rings : chains).push(cur);
  }
  return { rings, chains };
}

/* ---------- Classification ---------- */
const ROAD_W = { motorway: 16, trunk: 16, primary: 14, secondary: 11, tertiary: 9, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6, unclassified: 7, residential: 6, living_street: 5, service: 4.5, road: 6, pedestrian: 5, footway: 2.4, path: 2, steps: 2.4, cycleway: 2.4, track: 3.5 };
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road']);
const CLASS = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 2, tertiary_link: 3, unclassified: 4, residential: 4, road: 4, living_street: 5, service: 5, pedestrian: 6, footway: 7, path: 7, steps: 7, cycleway: 7, track: 7 };
const GREEN = (t) =>
  ['park', 'garden', 'pitch', 'golf_course', 'recreation_ground', 'playground', 'common', 'dog_park', 'nature_reserve'].includes(t.leisure) ||
  ['grass', 'recreation_ground', 'meadow', 'village_green', 'forest', 'cemetery', 'orchard', 'allotments'].includes(t.landuse) ||
  ['wood', 'scrub', 'grassland', 'heath'].includes(t.natural);
const WATER = (t) => t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'dock';
const RAIL = new Set(['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge']);
const DEAD = (t) => t.disused || t['disused:railway'] || t.abandoned || t.railway === 'abandoned' || t.railway === 'disused' || t.railway === 'razed' || t.railway === 'construction' || t.highway === 'construction' || t.highway === 'proposed';

/* ---------- Shared node index (roads + rail keep their topology) ---------- */
const nodeIndex = new Map();
const nodeXZ = [];
function ni(id) {
  let i = nodeIndex.get(id);
  if (i === undefined) {
    const p = P(id);
    if (!p) return -1;
    i = nodeXZ.length / 2;
    nodeIndex.set(id, i);
    nodeXZ.push(p[0], p[1]);
  }
  return i;
}
const anyInPlay = (ps) => ps.some(([x, z]) => inPlay(x, z));

/* ---------- Height estimate for buildings without height tags ---------- */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
function buildingHeight(t, ar, id, cx, cz) {
  const num = (v) => {
    const f = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(f) ? f : null;
  };
  let h = num(t.height) ?? num(t['building:height']);
  if (h == null && t['building:levels'] != null) {
    const lv = num(t['building:levels']);
    if (lv != null) h = lv * 3.3 + (num(t['roof:levels']) || 0) * 2 + 1;
  }
  if (h != null) return Math.max(2.5, Math.min(h, 260));
  const r = hash(id);
  const b = t.building;
  if (b === 'roof' || b === 'canopy' || t.amenity === 'shelter') return 5;
  if (b === 'hut' || b === 'shed' || b === 'kiosk' || b === 'garage' || b === 'garages' || b === 'toilets' || b === 'cabin') return 3 + r * 1.5;
  if (b === 'temple' || b === 'shrine') return 6 + r * 8;
  if (b === 'mosque' || b === 'church' || b === 'cathedral') return 14 + r * 10;
  if (b === 'train_station') return 16;
  // The old core (north Kolkata, Barabazar) is dense and 3-5 storeys; the office districts round
  // B.B.D. Bagh, Chowringhee and Park Street run taller; big footprints are offices or blocks of flats.
  let lv = 2 + Math.floor(r * 3);
  if (ar > 250) lv += 1;
  if (ar > 700) lv += 1 + Math.floor(r * 2);
  if (ar > 1800) lv += 2 + Math.floor(r * 4);
  if (['commercial', 'office', 'apartments', 'hotel', 'retail'].includes(b) || t.office) lv += 2;
  const cbd = Math.hypot(cx - -60, cz - 260) < 700 || Math.hypot(cx - -150, cz - -430) < 450; // Chowringhee/Park St, BBD Bagh
  if (cbd && ar > 400) lv += 2 + Math.floor(r * 5);
  if (b === 'house' || b === 'detached' || b === 'residential' || b === 'terrace') lv = Math.min(lv, 4);
  return Math.min(lv, 30) * 3.3 + 0.6;
}
const KIND = (t) => {
  const b = t.building;
  if (t.amenity === 'place_of_worship' || ['temple', 'mosque', 'church', 'cathedral', 'shrine', 'chapel', 'religious'].includes(b)) return 'worship';
  if (b === 'train_station' || t.railway === 'station') return 'station';
  if (['commercial', 'office', 'retail', 'hotel', 'bank'].includes(b) || t.office || t.shop) return 'commercial';
  if (['government', 'civic', 'public', 'courthouse', 'museum', 'college', 'university', 'school', 'hospital'].includes(b) || t.historic || t.tourism === 'museum') return 'civic';
  if (['industrial', 'warehouse', 'factory', 'depot', 'transportation', 'hangar'].includes(b)) return 'industrial';
  if (['roof', 'canopy', 'shed', 'hut', 'kiosk', 'garage', 'garages', 'cabin', 'toilets'].includes(b)) return 'small';
  return 'residential';
};

/* ---------- Ways ---------- */
const roads = [];
const rails = [];
const buildings = [];
const water = [];
const green = [];
const platforms = [];
const piers = [];
const areas = []; // other ground cover: railway land, parking, plazas
const ferries = [];
const railIds = new Map(); // OSM way id -> index in rails
const roadWays = new Set(); // OSM ids of the drivable ways kept as roads
const relWays = new Set();
for (const r of rels.values()) if (r.tags.type === 'multipolygon') for (const m of r.members) if (m.type === 'way' && m.role === 'outer') relWays.add(m.ref);

function name(t) {
  return t['name:en'] || t.name || '';
}

for (const w of ways.values()) {
  const t = w.tags;
  if (DEAD(t)) continue;
  const ps = pts(w.nds);
  if (!ps || ps.length < 2 || !anyInPlay(ps)) continue;
  const closed = w.nds[0] === w.nds[w.nds.length - 1] && ps.length > 3;

  if (t.highway && ROAD_W[t.highway] !== undefined && t.area !== 'yes') {
    if (t.access === 'no' && !DRIVE.has(t.highway)) continue;
    const lanes = parseInt(t.lanes);
    let wd = ROAD_W[t.highway];
    if (lanes > 0 && DRIVE.has(t.highway)) wd = Math.max(wd * 0.7, Math.min(lanes * 3.3 + 1, 26));
    const ow = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
    const road = { n: w.nds.map(ni), c: CLASS[t.highway], w: r1(wd), h: t.highway };
    if (ow) road.o = ow;
    if (name(t)) road.name = name(t);
    if (t.bridge && t.bridge !== 'no') road.br = 1;
    if (t.tunnel && t.tunnel !== 'no') road.tn = 1;
    if (t.layer) road.l = parseInt(t.layer) || 0;
    if (t.service) road.sv = t.service;
    if (!DRIVE.has(t.highway)) road.foot = 1;
    else roadWays.add(w.id);
    roads.push(road);
    continue;
  }
  if (t.highway && t.area === 'yes' && closed) {
    areas.push({ k: 'plaza', p: flat(simplify(closeRing(ps))) });
    continue;
  }
  if (t.railway && RAIL.has(t.railway)) {
    const rl = { n: w.nds.map(ni), k: t.railway };
    if (name(t)) rl.name = name(t);
    if (t.service) rl.sv = t.service;
    if (t.usage) rl.u = t.usage;
    if (t.tunnel && t.tunnel !== 'no') rl.tn = 1;
    if (t.bridge && t.bridge !== 'no') rl.br = 1;
    if (t.layer) rl.l = parseInt(t.layer) || 0;
    railIds.set(w.id, rails.length);
    rails.push(rl);
    continue;
  }
  if (t.railway === 'platform' || t.public_transport === 'platform') {
    if (t.railway !== 'platform' && !(t.train === 'yes' || t.subway === 'yes' || t.railway)) continue;
    // the platform numbers: ref "6;7", or from a name like "Platform No. 1 & Platform No. 2" / "Sealdah 12-13"
    const nums = (t.ref || (/\d/.test(t.name || '') ? t.name : '')).match(/\d+/g);
    const ref = nums ? nums.map(Number).sort((a, b) => a - b).join(';') : undefined;
    platforms.push(closed ? { p: flat(simplify(closeRing(ps))), ref } : { l: flat(ps), ref });
    continue;
  }
  if (t.building && t.building !== 'no' && closed && !t['building:part']) {
    let ring = simplify(closeRing(ps));
    if (ring.length < 3) continue;
    const ar = area(ring);
    if (ar > 0) ring = ring.reverse(); // store clockwise in x/z (counter-clockwise seen from above with z south)
    const A = Math.abs(ar);
    if (A < 6) continue;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const b = { p: flat(ring), h: r1(buildingHeight(t, A, w.id, cx, cz)), k: KIND(t), id: +w.id };
    if (t.min_height || t['building:min_level']) b.y = r1(parseFloat(t.min_height) || parseFloat(t['building:min_level']) * 3.3 || 0);
    if (name(t)) b.name = name(t);
    if (t['building:colour']) b.col = t['building:colour'];
    buildings.push(b);
    continue;
  }
  if (closed && WATER(t)) {
    water.push({ p: flat(simplify(closeRing(ps), 1)), name: name(t) || undefined });
    continue;
  }
  if (closed && (GREEN(t) || t.leisure === 'stadium')) {
    green.push({ p: flat(simplify(closeRing(ps), 1)), k: t.leisure === 'stadium' ? 'stadium' : t.leisure === 'pitch' ? 'pitch' : 'park', name: name(t) || undefined });
    continue;
  }
  if (closed && (t.landuse === 'railway' || t.amenity === 'parking' || t.amenity === 'bus_station')) {
    areas.push({ k: t.landuse === 'railway' ? 'railway' : t.amenity, p: flat(simplify(closeRing(ps), 1)), name: name(t) || undefined });
    continue;
  }
  if (t.man_made === 'pier' || t.man_made === 'jetty' || (t.amenity === 'ferry_terminal' && closed)) {
    piers.push(closed ? { p: flat(simplify(closeRing(ps))) } : { l: flat(ps) });
    continue;
  }
  if (t.route === 'ferry') {
    ferries.push({ p: flat(ps), name: name(t) || undefined });
  }
}

/* ---------- Multipolygon relations (big buildings, parks, ponds) ---------- */
let river = null;
for (const r of rels.values()) {
  const t = r.tags;
  if (t.type !== 'multipolygon' || DEAD(t)) continue;
  const outer = r.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => ways.get(m.ref)).filter(Boolean);
  if (!outer.length) continue;
  const { rings, chains } = assemble(outer);
  const isRiver = t.water === 'river' || t.waterway === 'riverbank' || (t.natural === 'water' && /hooghly|hugli|ganga|bhagirathi/i.test(name(t)));
  if (isRiver && /hooghly|hugli|ganga|bhagirathi/i.test(name(t))) {
    // Only part of the river is downloaded: keep its banks as open chains, the game closes them
    const all = [...rings, ...chains].map((c) => pts(c)).filter((c) => c && c.length > 1);
    river = { name: name(t), banks: all.map((c) => flat(c)) };
    continue;
  }
  for (const ringIds of rings) {
    const ps = pts(ringIds);
    if (!ps || ps.length < 4 || !anyInPlay(ps)) continue;
    let ring = simplify(closeRing(ps));
    if (ring.length < 3) continue;
    const ar = area(ring);
    if (t.building && t.building !== 'no') {
      if (ar > 0) ring = ring.reverse();
      const A = Math.abs(ar);
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const b = { p: flat(ring), h: r1(buildingHeight(t, A, r.id, cx, cz)), k: KIND(t), id: -r.id };
      if (name(t)) b.name = name(t);
      buildings.push(b);
    } else if (WATER(t)) water.push({ p: flat(ring), name: name(t) || undefined });
    else if (GREEN(t) || t.leisure === 'stadium') green.push({ p: flat(ring), k: t.leisure === 'stadium' ? 'stadium' : 'park', name: name(t) || undefined });
  }
}

/* ---------- Stations, stops and named places ---------- */
const stations = [];
const pois = [];
const seenPoi = new Set();
function addPoi(n, x, z, k, extra) {
  const key = `${n}|${k}|${Math.round(x / 40)}|${Math.round(z / 40)}`;
  if (seenPoi.has(key)) return;
  seenPoi.add(key);
  pois.push({ n, x, z, k, ...extra });
}
const centroid = (ps) => [r1(ps.reduce((s, p) => s + p[0], 0) / ps.length), r1(ps.reduce((s, p) => s + p[1], 0) / ps.length)];
function poiKind(t) {
  if (t.railway === 'station' || t.railway === 'halt' || t.public_transport === 'station') return t.station === 'subway' || t.subway === 'yes' ? 'metro' : 'station';
  if (t.amenity === 'ferry_terminal' || /\bghat\b/i.test(t.name || '')) return 'ghat';
  if (t.amenity === 'bus_station') return 'bus';
  if (t.leisure === 'stadium') return 'stadium';
  if (t.historic || t.tourism === 'attraction' || t.tourism === 'museum' || t.man_made === 'tower' || t.memorial) return 'landmark';
  if (t.amenity === 'place_of_worship') return 'worship';
  if (t.amenity === 'marketplace' || t.shop === 'mall') return 'market';
  if (t.tourism === 'hotel') return 'hotel';
  if (['restaurant', 'cafe', 'fast_food'].includes(t.amenity)) return 'food';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'college' || t.amenity === 'university') return 'college';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.place && ['suburb', 'neighbourhood', 'quarter'].includes(t.place)) return 'area';
  return null;
}
for (const [id, nd] of nodes) {
  const t = nd.tags;
  if (!t) continue;
  const [x, z] = proj(nd.lat, nd.lon);
  if (!inPlay(x, z)) continue;
  if (t.railway === 'station' || t.railway === 'halt' || (t.public_transport === 'station' && (t.train === 'yes' || t.subway === 'yes'))) {
    const n = name(t);
    if (n) stations.push({ n, x, z, k: t.station === 'subway' || t.subway === 'yes' ? 'metro' : 'rail', id: +id });
  }
  const n = name(t);
  if (!n) continue;
  const k = poiKind(t);
  if (k) addPoi(n, x, z, k);
}
for (const w of ways.values()) {
  const t = w.tags;
  const n = name(t);
  if (!n) continue;
  const k = poiKind(t) || (t.building && (t.historic || t.tourism) ? 'landmark' : null);
  if (!k) continue;
  const ps = pts(w.nds);
  if (!ps || !anyInPlay(ps)) continue;
  const [x, z] = centroid(closeRing(ps));
  addPoi(n, x, z, k);
}
for (const r of rels.values()) {
  const t = r.tags;
  const n = name(t);
  if (!n || t.type !== 'multipolygon') continue;
  const k = poiKind(t) || (t.building && (t.historic || t.tourism) ? 'landmark' : null);
  if (!k) continue;
  const outer = r.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => ways.get(m.ref)).filter(Boolean);
  const all = outer.flatMap((w) => pts(w.nds) || []);
  if (!all.length || !anyInPlay(all)) continue;
  const [x, z] = centroid(all);
  addPoi(n, x, z, k);
}

/* ---------- Metro and tram routes ---------- */
const routes = [];
for (const r of rels.values()) {
  const t = r.tags;
  if (!['subway', 'tram', 'light_rail'].includes(t.route)) continue;
  const stops = [];
  for (const m of r.members) {
    if (m.type !== 'node' || !/stop/.test(m.role)) continue;
    const nd = nodes.get(m.ref);
    if (!nd) continue;
    const [x, z] = proj(nd.lat, nd.lon);
    stops.push({ n: name(nd.tags || {}), x, z });
  }
  const railRefs = r.members.filter((m) => m.type === 'way' && railIds.has(m.ref)).map((m) => railIds.get(m.ref));
  routes.push({ k: t.route, name: name(t), ref: t.ref || '', color: t.colour || '', stops, rails: railRefs });
}

/* ---------- Bus routes: the streets each numbered route really runs along ---------- */
// The member ways of each route relation, in order, joined into runs of road nodes. Where one
// way runs on past the junction the next one leaves from, the run is cut back to that junction;
// where the next way doesn't touch the run at all (a gap in the data, or the route leaving the
// map), a new run starts. The game strings the runs onto its street graph.
const busRoutes = [];
for (const r of rels.values()) {
  const t = r.tags;
  if (t.route !== 'bus' || !t.ref || !t.from || !t.to) continue;
  const members = r.members.filter((m) => m.type === 'way' && !/platform/.test(m.role)).map((m) => (roadWays.has(m.ref) ? ways.get(m.ref).nds : null));
  const runs = [];
  let cur = null;
  let fresh = false; // cur is still a single way, so it may be the wrong way round
  members.forEach((nds, k) => {
    if (!nds || nds[0] === nds[nds.length - 1]) {
      // missing, or a roundabout (which way round the bus goes is up to the street graph)
      if (cur) runs.push(cur);
      cur = null;
      return;
    }
    if (!cur) {
      cur = nds.slice();
      fresh = true;
      return;
    }
    const join = (run) => {
      // the latest node of the run that this way touches, preferring the way's ends
      for (let i = run.length - 1; i >= Math.max(0, run.length - 400); i--) {
        const j = nds.indexOf(run[i]);
        if (j >= 0) return { i, j };
      }
      return null;
    };
    let hit = join(cur);
    if (fresh && (!hit || (hit.i !== cur.length - 1 && (nds[0] === cur[0] || nds[nds.length - 1] === cur[0])))) {
      cur.reverse();
      hit = join(cur);
    }
    fresh = false;
    if (!hit) {
      runs.push(cur);
      cur = nds.slice();
      fresh = true;
      return;
    }
    // which way along this way: towards the end that the next member touches, else the longer side
    const next = members[k + 1];
    const toEnd = nds.slice(hit.j);
    const toStart = nds.slice(0, hit.j + 1).reverse();
    let part;
    if (hit.j === 0) part = toEnd;
    else if (hit.j === nds.length - 1) part = toStart;
    else if (next && next.includes(nds[nds.length - 1])) part = toEnd;
    else if (next && next.includes(nds[0])) part = toStart;
    else part = toEnd.length >= toStart.length ? toEnd : toStart;
    cur = cur.slice(0, hit.i + 1).concat(part.slice(1));
  });
  if (cur) runs.push(cur);
  const p = runs.map((run) => run.map((id) => nodeIndex.get(id)).filter((i) => i !== undefined)).filter((run) => run.length > 1);
  if (!p.length) continue;
  const route = { ref: t.ref.trim(), from: t.from.trim(), to: t.to.trim(), p };
  if (t.network || t.operator) route.net = t.network || t.operator;
  busRoutes.push(route);
}

/* ---------- Region-wide context (tools/fetch-region.mjs): railways and places ---------- */
const region = { rails: [], places: [] };
function dp(ps, eps) {
  // Douglas-Peucker simplification
  if (ps.length < 3) return ps;
  const keep = new Uint8Array(ps.length);
  keep[0] = keep[ps.length - 1] = 1;
  const stack = [[0, ps.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = ps[a];
    const [bx, bz] = ps[b];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - ps[i][1]) - (ax - ps[i][0]) * (bz - az)) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > eps) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return ps.filter((_, i) => keep[i]);
}
const rrFile = path.join(SRC, 'region-rails.json');
if (fs.existsSync(rrFile)) {
  for (const e of JSON.parse(fs.readFileSync(rrFile, 'utf8')).elements) {
    if (!e.geometry || DEAD(e.tags || {})) continue;
    const t = e.tags || {};
    if (t.railway === 'rail' && (t.usage === 'industrial' || t.usage === 'military')) continue;
    const ps = dp(e.geometry.map((g) => proj(g.lat, g.lon)), 8);
    if (ps.length < 2) continue;
    const r = { k: t.railway, p: flat(ps) };
    if (name(t)) r.name = name(t);
    if (t.colour) r.c = t.colour;
    if (t.tunnel && t.tunnel !== 'no') r.tn = 1;
    region.rails.push(r);
  }
}
const rpFile = path.join(SRC, 'region-places.json');
if (fs.existsSync(rpFile)) {
  const seen = new Set();
  for (const e of JSON.parse(fs.readFileSync(rpFile, 'utf8')).elements) {
    const t = e.tags || {};
    const n = name(t);
    if (!n) continue;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    const [x, z] = proj(lat, lon);
    let k = poiKind(t);
    if (t.place) k = ['city', 'town'].includes(t.place) ? 'town' : 'area';
    else if (t.station === 'subway' || t.subway === 'yes') k = 'metro';
    else if (t.railway === 'station' || t.railway === 'halt') k = 'station';
    else if (t.aeroway === 'aerodrome') k = 'airport';
    else if (t.man_made === 'bridge') k = 'landmark';
    else if (t.shop === 'mall') k = 'market';
    else if (t.amenity === 'cinema' || t.amenity === 'theatre') k = 'culture';
    else if (t.amenity === 'library') k = 'culture';
    else if (!k) k = t.tourism ? 'landmark' : t.leisure ? 'park' : 'landmark';
    const key = `${n}|${k}|${Math.round(x / 150)}|${Math.round(z / 150)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    region.places.push({ n, x, z, k });
  }
}

/* ---------- Trim the node table to what roads and rail use ---------- */
/* ---------- Metro entrances: the numbered gates down from the street ---------- */
const metroGates = [];
for (const n of nodes.values()) {
  if (!n.tags || n.tags.railway !== 'subway_entrance') continue;
  const [x, z] = proj(n.lat, n.lon);
  if (!inPlay(x, z)) continue;
  metroGates.push({ n: n.tags.name || '', ref: n.tags.ref || '', x, z });
}
metroGates.sort((a, b) => a.x - b.x || a.z - b.z);

const out = {
  attribution: 'Map data © OpenStreetMap contributors, ODbL',
  origin: [lat0, lon0],
  tiles: tileRects,
  nodes: nodeXZ,
  roads,
  rails,
  buildings,
  water,
  river,
  green,
  areas,
  platforms,
  piers,
  ferries,
  stations,
  routes,
  busRoutes,
  pois,
  metroGates,
  region,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${(json.length / 1e6).toFixed(1)} MB`);
console.log(
  Object.entries(out)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k} ${k === 'nodes' ? v.length / 2 : v.length}`)
    .join(', '),
);
console.log(`bus routes: ${busRoutes.length}, ${busRoutes.reduce((s, r) => s + r.p.length, 0)} runs`);
console.log(`region: ${region.rails.length} rail lines, ${region.places.length} places`);
console.log(`river banks: ${river ? river.banks.map((b) => b.length / 2).join(', ') : 'none'}`);
console.log('routes:', routes.map((r) => `${r.k} ${r.name} [${r.stops.map((s) => s.n).join(' > ')}] rails ${r.rails.length}`).join('\n  '));
