import * as THREE from 'three';
import { Character, POSE, randomLook } from './character.js';
import { MAP } from './geo.js';
import { frame } from './landmarks.js';
import { MAIDAN_GROUND } from './world.js';
import { clamp, damp, lerp, merge } from './utils.js';

/*
 * Cricket: a pick-up gully match on the Maidan, or a proper match at Eden Gardens.
 *
 * Pay to play (the stake at the Maidan, a ticket at Eden), win and take home the
 * prize. Toss, two innings, the chase. You bat (SPACE as the timing needle crosses
 * the green; the shot follows the line of the ball, W lofts it, A/D steer it, and
 * your partner calls the runs) and you bowl (SPACE to run in and again in the
 * green; WASD and 1-3 for line, length and pace / swing / spin if you want). The
 * rest of both sides are run by the game: bowlers, batters, fielders chasing,
 * catching and throwing to the keeper.
 *
 *  - Eden Gardens: the real laws (cut down to three overs a side) — wides and
 *    no-balls (with a free hit), LBW, caught, bowled, run out, fours and sixes,
 *    no bowler bowling two overs running, eleven a side and two umpires.
 *  - Maidan: gully rules — a taped tennis ball, six a side, two overs, three
 *    wickets, no LBW, no no-balls, and one-tip-one-hand: a one-handed catch
 *    after a single bounce is out.
 *
 * Everything is laid out in a "pitch frame": the pitch runs along z with the
 * batter's stumps at z = -HALF and the bowler's at z = +HALF; for the right-handed
 * batter the off side is -x and the leg side +x. Each venue's group carries that
 * frame into the world.
 */

const { arm, elbow, leg, knee } = POSE;

const HALF = 10.06; // stumps from the middle of the pitch
const CREASE = 8.84; // popping crease
const G = 9.81;
const BALL_R = 0.036;
const Z_HIT = -8.1; // where a well-timed shot meets the ball
const BAT_X = 0.05; // the batter's guard: middle-and-leg
const STUMP_X = 0.115;
const STUMP_H = 0.71;

export const RULES = {
  maidan: {
    title: 'Maidan Gully Cricket',
    short: 'GULLY',
    overs: 2,
    wickets: 3,
    side: 6,
    fee: 50,
    prize: 150,
    boundary: 30,
    lbw: false,
    noBalls: false,
    oneTip: true,
    wideOff: 1.1,
    wideLeg: 1.1,
    pace: [18, 22],
    spin: [14, 16],
    bounce: 0.66,
    batSpeed: 6.2,
    fieldSpeed: 5.6,
    throwSpeed: 18,
    aiTiming: 0.55,
    catchP: 0.5,
    timeScale: 0.72,
    forgive: 0.5,
    you: 'Para XI',
    them: ['Shyambazar Tigers', 'Gariahat Boys', 'Behala Blasters', 'Dum Dum Dynamos', 'Kalighat Kings', 'Bagbazar Bullets'],
  },
  eden: {
    title: 'Eden Gardens',
    short: 'EDEN',
    overs: 3,
    wickets: 10,
    side: 11,
    fee: 500,
    prize: 2000,
    boundary: 66,
    lbw: true,
    noBalls: true,
    oneTip: false,
    wideOff: 0.95,
    wideLeg: 0.42,
    pace: [25, 29],
    spin: [19, 21],
    bounce: 0.56,
    batSpeed: 6.6,
    fieldSpeed: 6.5,
    throwSpeed: 24,
    aiTiming: 0.5,
    catchP: 0.82,
    timeScale: 0.66,
    forgive: 0.6,
    you: 'Kolkata XI',
    them: ['Mumbai XI', 'Chennai XI', 'Delhi XI', 'Bengaluru XI', 'Hyderabad XI', 'Punjab XI', 'Rajasthan XI'],
  },
};

const OUR_NAMES = ['You', 'Rana', 'Bapi', 'Tublu', 'Montu', 'Pintu', 'Arnab', 'Riju', 'Sanju', 'Babai', 'Tatai'];
const THEIR_NAMES = ['Amit', 'Vikram', 'Karan', 'Imran', 'Siddharth', 'Neeraj', 'Kunal', 'Farhan', 'Joseph', 'Harish', 'Manav'];

// Where the fielding side stands (pitch frame), keeper and bowler first
const EDEN_FIELD = [
  ['keeper', 0.35, -HALF - 2.6],
  ['bowler', 1.4, HALF + 2.5],
  ['slip', -1.9, -HALF - 3.4],
  ['point', -22, -HALF + 1.5],
  ['cover', -25, 4],
  ['mid-off', -10, HALF + 2],
  ['mid-on', 10, HALF + 2],
  ['midwicket', 25, 3],
  ['square leg', 23, -HALF + 1],
  ['fine leg', 32, -HALF - 44],
  ['long on', 26, 52],
];
const GULLY_FIELD = [
  ['keeper', 0.3, -HALF - 2.2],
  ['bowler', 1.2, HALF + 2],
  ['cover', -14, -3],
  ['midwicket', 14, -3],
  ['long off', -9, 21],
  ['long on', 9, 21],
];

const SAY = {
  four: ['FOUR! Cracking shot!', 'Char! Shot dada!', 'Races away to the rope!', 'FOUR — piercing the gap!'],
  six: ['SIX! Into the stands!', 'Chhakka! Out of the ground!', 'Huge! That is massive!', 'Maximum!'],
  dot: ['Dot ball.', 'Well bowled.', 'No run.', 'Beaten!'],
  bowled: ['BOWLED HIM! Stumps everywhere!', 'Timber! Off stump cartwheeling!', 'Clean bowled!'],
  caught: ['CAUGHT! What a take!', 'Gone! Straight down his throat!', 'Taken! Great catch!'],
  lbw: ['LBW! The finger goes up!', 'Plumb in front!', 'Trapped in front!'],
  runout: ['RUN OUT! Short of the crease!', 'Direct throw — he is gone!', 'Run out! Terrible mix-up!'],
  oneTip: ['ONE TIP ONE HAND! Out!', 'One bounce, one hand — gone!'],
  edge: ['Edged!', 'Thick edge!', 'Off the outside edge!'],
  dropped: ['DROPPED! Put down!', 'Oh, he has spilled it!'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;

/* ---------- Models ---------- */
let MATS = null;
const TRAIL = 12; // ghost balls behind the ball in flight
function mats() {
  if (MATS) return MATS;
  MATS = {
    pitchEden: new THREE.MeshStandardMaterial({ color: 0xcdb882, roughness: 0.95 }),
    pitchGully: new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.7 }),
    stump: new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6 }),
    willow: new THREE.MeshStandardMaterial({ color: 0xdcbf86, roughness: 0.6 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.8 }),
    ballRed: new THREE.MeshStandardMaterial({ color: 0xb3121c, roughness: 0.35 }),
    ballTennis: new THREE.MeshStandardMaterial({ color: 0xd8ef3a, roughness: 0.8 }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    marker: new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.85, depthWrite: false }),
    pitchMark: new THREE.MeshBasicMaterial({ color: 0xff3fa4, transparent: true, opacity: 0.7, depthWrite: false }),
    hitRing: new THREE.MeshBasicMaterial({ color: 0x5dff9e, transparent: true, opacity: 0, depthWrite: false }),
    trail: Array.from({ length: TRAIL }, (_, i) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42 * (1 - i / TRAIL), depthWrite: false })),
    rope: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.9 }),
    brick: new THREE.MeshStandardMaterial({ color: 0x9c4a2e, roughness: 0.9 }),
    board: new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.6 }),
    screen: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9 }),
  };
  return MATS;
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
function outfieldTex() {
  return canvasTex(512, 512, (g, w, h) => {
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#3f8a3a' : '#4a9a42';
      g.fillRect(0, (i * h) / 16, w, h / 16 + 1);
    }
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,50,20' : '120,170,90'},0.12)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}
function signTex(lines, bg, fg) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach(([text, size], i) => {
      g.font = `bold ${size}px Arial`;
      g.fillText(text, w / 2, (h * (i + 1)) / (lines.length + 1));
    });
  });
}
function batMesh() {
  const M = mats();
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.04, 0.56).translate(0, 0, 0.58), M.willow);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.3, 8).rotateX(Math.PI / 2).translate(0, 0, 0.15), M.grip);
  blade.castShadow = true;
  g.add(blade, handle);
  return g;
}
/** Three stumps and two bails; the group sits on the ground at one end. */
function stumpSet() {
  const M = mats();
  const g = new THREE.Group();
  const stumps = [-STUMP_X, 0, STUMP_X].map((x) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, STUMP_H, 8).translate(0, STUMP_H / 2, 0), M.stump);
    m.position.x = x;
    m.castShadow = true;
    g.add(m);
    return m;
  });
  const bails = [-0.058, 0.058].map((x) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.015, 0.015), M.stump);
    m.position.set(x, STUMP_H + 0.008, 0);
    g.add(m);
    return m;
  });
  return { group: g, stumps, bails, flying: 0, bv: [] };
}

/* ---------- Poses ---------- */
// Batter, side-on and facing the off side (-x); u = swing progress, lift = backlift
function batPose(c) {
  return (P, T) => {
    const s = c.swing;
    leg(P, 'L', 0.18, 0.12);
    leg(P, 'R', -0.08, 0.12);
    knee(P, 'L', 0.35);
    knee(P, 'R', 0.3);
    P.hipsY = -0.05;
    P.spine[0] = 0.25;
    P.head[1] = 1.15;
    if (s < 0) {
      // stance, then the backlift as the bowler lets go
      const l = c.lift;
      P.chest[1] = lerp(0.2, -0.45, l);
      arm(P, 'L', lerp(0.55, 1.2, l), lerp(-0.25, 0.2, l));
      arm(P, 'R', lerp(0.5, 1.35, l), lerp(-0.1, 0.5, l));
      elbow(P, 'L', lerp(0.35, 0.9, l));
      elbow(P, 'R', lerp(0.5, 1.2, l));
      return;
    }
    const u = clamp(s, 0, 1);
    const loft = c.loft ? 1 : 0;
    P.chest[1] = lerp(-0.45, 0.9, u);
    P.spine[0] = 0.25 + Math.sin(u * Math.PI) * 0.15;
    leg(P, 'L', 0.18 + u * 0.25, 0.12);
    knee(P, 'L', 0.35 + u * 0.2);
    arm(P, 'L', lerp(1.2, 1.0 + loft * 1.4, u), lerp(0.2, -0.4, u));
    arm(P, 'R', lerp(1.35, 1.1 + loft * 1.5, u), lerp(0.5, -0.2, u));
    elbow(P, 'L', lerp(0.9, 0.2, Math.min(1, u * 1.6)));
    elbow(P, 'R', lerp(1.2, 0.3, Math.min(1, u * 1.6)));
    P.head[1] = lerp(1.15, 0.6, u);
  };
}
// Bowler's delivery stride: u runs 0..1 through the action, the ball leaves at ~0.62
function bowlPose(c) {
  return (P) => {
    const u = clamp(c.bowlU, 0, 1);
    leg(P, 'L', lerp(0.7, 0.35, u));
    knee(P, 'L', lerp(0.6, 0.15, u));
    leg(P, 'R', lerp(-0.35, 0.2, u));
    knee(P, 'R', lerp(0.4, 0.9, u));
    arm(P, 'R', lerp(-0.4, -5.6, u), 0.05);
    arm(P, 'L', lerp(2.7, 0.3, u), 0.15);
    elbow(P, 'R', 0.05);
    elbow(P, 'L', 0.3);
    P.chest[1] = lerp(-0.7, 0.45, u);
    P.spine[0] = lerp(-0.2, 0.55, u);
  };
}
function keepPose(P) {
  leg(P, 'L', 1.2, 0.35);
  leg(P, 'R', 1.2, 0.35);
  knee(P, 'L', 2.0);
  knee(P, 'R', 2.0);
  P.hipsY = -0.45;
  P.spine[0] = 0.35;
  arm(P, 'L', 1.1, 0.15);
  arm(P, 'R', 1.1, 0.15);
  elbow(P, 'L', 0.4);
  elbow(P, 'R', 0.4);
}
function readyPose(P) {
  leg(P, 'L', 0.25, 0.15);
  leg(P, 'R', 0.25, 0.15);
  knee(P, 'L', 0.55);
  knee(P, 'R', 0.55);
  P.hipsY = -0.1;
  P.spine[0] = 0.45;
  arm(P, 'L', 0.55, 0.1);
  arm(P, 'R', 0.55, 0.1);
  elbow(P, 'L', 0.25);
  elbow(P, 'R', 0.25);
}
function standPose(P) {
  arm(P, 'L', -0.25, 0.05);
  arm(P, 'R', -0.25, 0.05);
  elbow(P, 'L', 0.5);
  elbow(P, 'R', 0.5);
}
function throwPose(c) {
  return (P) => {
    const u = clamp(c.throwU, 0, 1);
    leg(P, 'L', 0.5);
    knee(P, 'L', 0.3);
    leg(P, 'R', -0.3);
    arm(P, 'R', lerp(-1.2, -4.6, u), 0.3);
    arm(P, 'L', lerp(1.6, 0.4, u), 0.2);
    elbow(P, 'R', lerp(1.2, 0.2, u));
    P.chest[1] = lerp(-0.8, 0.5, u);
    P.spine[0] = lerp(-0.1, 0.4, u);
  };
}
// Umpire's signals
function signalPose(c) {
  return (P, T) => {
    const s = c.signal;
    if (s === 'out') {
      arm(P, 'R', Math.PI, 0);
      elbow(P, 'R', 0);
      arm(P, 'L', -0.2, 0.05);
    } else if (s === 'four') {
      arm(P, 'R', 1.5, 0.3 + Math.sin(T * 9) * 0.8);
      elbow(P, 'R', 0.1);
    } else if (s === 'six') {
      arm(P, 'L', Math.PI, 0.15);
      arm(P, 'R', Math.PI, 0.15);
    } else if (s === 'wide') {
      arm(P, 'L', 0, 1.5);
      arm(P, 'R', 0, 1.5);
    } else if (s === 'noball') {
      arm(P, 'R', 0, 1.5);
      arm(P, 'L', -0.2, 0.05);
    } else standPose(P);
  };
}

/* ---------- Cricket ---------- */
export class Cricket {
  constructor(game, scene, world, hud, audio) {
    this.game = game;
    this.scene = scene;
    this.world = world;
    this.hud = hud;
    this.audio = audio;
    this.active = false;
    this.venues = {};
    for (const kind of ['maidan', 'eden']) {
      const V = this.buildVenue(kind);
      if (V) this.venues[kind] = V;
    }
    this.light = new THREE.HemisphereLight(0xffffff, 0x3a5a32, 0);
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.buildHud();
  }

  /* ---------- Venues ---------- */
  buildVenue(kind) {
    const R = RULES[kind];
    const M = mats();
    const V = { kind, R };
    if (kind === 'eden') {
      const g = MAP.green.find((x) => x.k === 'stadium' && /eden gardens/i.test(x.name || ''));
      if (!g) return null;
      const f = frame(g.p);
      const along = f.hu >= f.hv ? [Math.cos(f.a), Math.sin(f.a)] : [-Math.sin(f.a), Math.cos(f.a)];
      V.x = f.cx;
      V.z = f.cz;
      V.yaw = Math.atan2(along[0], along[1]);
      V.grass = Math.min(f.hu, f.hv) * 0.66;
      // the ticket window: on the road nearest the ground, a few steps towards it
      const q = this.world.graph.nearest(f.cx, f.cz, 500);
      if (q) {
        const d = Math.hypot(f.cx - q.x, f.cz - q.z) || 1;
        V.entry = { x: q.x + ((f.cx - q.x) / d) * 7, z: q.z + ((f.cz - q.z) / d) * 7, r: 5 };
      } else V.entry = { x: f.cx + Math.max(f.hu, f.hv) + 8, z: f.cz, r: 6 };
    } else {
      V.x = MAIDAN_GROUND.x;
      V.z = MAIDAN_GROUND.z;
      V.yaw = 0.35;
      V.entry = { x: V.x, z: V.z, r: 18 };
    }
    V.y = this.world.height(V.x, V.z);
    V.root = new THREE.Group();
    V.root.position.set(V.x, V.y, V.z);
    V.root.rotation.y = V.yaw;
    this.scene.add(V.root);
    const add = (geo, mat, shadow = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      V.root.add(m);
      return m;
    };
    const eden = kind === 'eden';
    if (eden) {
      const grass = new THREE.MeshStandardMaterial({ map: outfieldTex(), roughness: 0.95 });
      add(new THREE.CircleGeometry(V.grass, 72).rotateX(-Math.PI / 2).translate(0, 0.03, 0), grass);
    }
    add(new THREE.BoxGeometry(3.05, 0.02, 22.4).translate(0, 0.045, 0), eden ? M.pitchEden : M.pitchGully);
    if (!eden) add(new THREE.CircleGeometry(4, 20).rotateX(-Math.PI / 2).translate(0, 0.035, -HALF - 1), M.pitchGully);
    // creases
    const lines = [];
    for (const s of [1, -1]) {
      lines.push(new THREE.BoxGeometry(3.66, 0.006, 0.05).translate(0, 0.058, s * CREASE));
      lines.push(new THREE.BoxGeometry(2.64, 0.006, 0.05).translate(0, 0.058, s * HALF));
      for (const x of [1.32, -1.32]) lines.push(new THREE.BoxGeometry(0.05, 0.006, 2.4).translate(x, 0.058, s * (CREASE + 0.6)));
    }
    if (eden) {
      // the 30-yard circle, the rope, advertising boards and sight screens
      for (let a = 0; a < Math.PI * 2; a += 0.075) lines.push(new THREE.BoxGeometry(0.5, 0.01, 0.12).rotateY(-a).translate(Math.sin(a) * 27.4, 0.045, Math.cos(a) * 27.4));
      add(new THREE.TorusGeometry(R.boundary, 0.09, 4, 160).rotateX(Math.PI / 2).translate(0, 0.1, 0), M.rope);
      const boards = signTex([['VIBE CITY KOLKATA', 64], ['EDEN GARDENS', 44]], '#1b1440', '#ffd36b');
      const bm = new THREE.MeshStandardMaterial({ map: boards, emissiveMap: boards, emissive: 0xffffff, emissiveIntensity: 0.5 });
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const r = R.boundary + 4;
        const b = add(new THREE.PlaneGeometry(9.5, 1.1), bm);
        b.position.set(Math.sin(a) * r, 0.6, Math.cos(a) * r);
        b.rotation.y = a + Math.PI;
      }
      for (const s of [1, -1]) {
        const sc = add(new THREE.BoxGeometry(14, 7, 0.4), M.screen);
        sc.position.set(0, 3.5, s * (R.boundary + 7));
      }
    } else {
      // stones and bricks for a boundary, a crate for a seat, the stake board
      const st = [];
      for (let a = 0; a < Math.PI * 2; a += 0.17) st.push(new THREE.BoxGeometry(0.25, 0.15, 0.2).rotateY(a * 3).translate(Math.sin(a) * R.boundary, 0.08, Math.cos(a) * R.boundary));
      add(merge(st), M.stone);
      add(merge([new THREE.BoxGeometry(0.24, 0.08, 0.12).translate(5, 0.04, -HALF - 3), new THREE.BoxGeometry(0.24, 0.08, 0.12).translate(5, 0.12, -HALF - 3), new THREE.BoxGeometry(0.24, 0.08, 0.12).translate(5.3, 0.04, -HALF - 3.1)]), M.brick);
      const sign = signTex([['পাড়া ক্রিকেট', 54], ['GULLY CRICKET · ₹50 STAKE', 34], ['WIN ₹150 · Press E', 30]], '#f4efe2', '#b3261e');
      const sm = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.7 });
      const b = add(new THREE.PlaneGeometry(2.4, 1.2), sm);
      b.position.set(-6, 1.6, -HALF - 4);
      b.rotation.y = Math.PI * 0.85;
      const back = add(new THREE.PlaneGeometry(2.4, 1.2).rotateY(Math.PI), M.board);
      back.position.copy(b.position);
      back.rotation.y = b.rotation.y;
      add(merge([new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6).translate(-1.15, 1.1, 0), new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6).translate(1.15, 1.1, 0)]).rotateY(Math.PI * 0.85).translate(-6, 0, -HALF - 4.02), M.grip);
    }
    add(merge(lines), M.white);
    // the stumps at each end
    V.stumps = {};
    for (const s of [1, -1]) {
      const set = stumpSet();
      set.group.position.set(0, 0.05, s * HALF);
      V.root.add(set.group);
      V.stumps[s] = set;
    }
    if (eden) {
      // the ticket window outside the stadium
      const sign = signTex([['EDEN GARDENS', 60], ['PLAY A MATCH · ₹500', 40], ['WIN ₹2,000 · Press E', 34]], '#1b1440', '#ffd36b');
      const booth = new THREE.Group();
      booth.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 1.6).translate(0, 1.3, 0), M.screen));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.4 }));
      face.position.set(0, 1.9, 0.81);
      booth.add(face, new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 2).translate(0, 2.68, 0), M.board));
      const ex = V.entry.x;
      const ez = V.entry.z;
      booth.position.set(ex, this.world.height(ex, ez), ez);
      booth.rotation.y = Math.atan2(V.x - ex, V.z - ez) + Math.PI;
      // stand the booth a step back so the window faces the street
      booth.position.x += Math.sin(booth.rotation.y + Math.PI) * 1.2;
      booth.position.z += Math.cos(booth.rotation.y + Math.PI) * 1.2;
      this.scene.add(booth);
      this.world.addCircle(booth.position.x, booth.position.z, 1.3);
    }
    V.root.updateMatrixWorld(true);
    return V;
  }

  /** Map markers for both grounds. */
  blips() {
    return Object.values(this.venues).map((V) => ({ x: V.entry.x, z: V.entry.z, color: '#7dffb0', r: 7, label: '🏏' }));
  }

  /** On foot near a ground: offer a game. */
  near(pos) {
    if (this.active) return null;
    for (const V of Object.values(this.venues)) {
      if (Math.hypot(pos.x - V.entry.x, pos.z - V.entry.z) < V.entry.r) {
        const R = V.R;
        return { text: `${V.kind === 'eden' ? 'Play at Eden Gardens' : 'Join the gully cricket'} · ₹${R.fee} to play, win ₹${R.prize.toLocaleString('en-IN')}`, act: () => this.start(V.kind) };
      }
    }
    return null;
  }

  /* ---------- Pitch frame helpers ---------- */
  toWorld(x, y, z, out = this.tmp) {
    return this.V.root.localToWorld(out.set(x, y, z));
  }
  toLocal(v, out = this.tmp2) {
    return this.V.root.worldToLocal(out.copy(v));
  }

  /* ---------- Starting and leaving ---------- */
  start(kind) {
    const g = this.game;
    const V = this.venues[kind];
    const R = V.R;
    const pl = g.player;
    if (this.active || pl.mode !== 'foot' || pl.dead) return;
    if (g.gameplay.money < R.fee) {
      this.hud.notify('NOT ENOUGH MONEY', `You need ₹${R.fee} to play`, '#ff5f6d');
      return;
    }
    g.gameplay.addMoney(-R.fee);
    this.V = V;
    this.R = R;
    this.active = true;
    this.back = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z, yaw: pl.yaw };
    pl.mode = 'cricket';
    pl.aiming = false;
    pl.prompt = null;
    pl.arsenal.hideAll();
    pl.ch.stopEmote();
    pl.ch.hold = null;
    if (document.pointerLockElement) document.exitPointerLock();
    V.root.add(pl.ch.mesh);
    this.scene.add(this.light);
    const opp = pick(R.them);
    const kit = kind === 'eden' ? [{ shirt: '#5b2c86', pants: '#3a1d58', shoes: '#f2f2f2' }, { shirt: '#1f5fbf', pants: '#163f7c', shoes: '#f2f2f2' }] : [null, null];
    const team = (names, side, k) =>
      names.slice(0, R.side).map((name, i) => ({ name, side, look: { ...randomLook(), female: false, longHair: false, skirt: false, glasses: false, print: false, longSleeve: false, shorts: kind === 'maidan' && Math.random() < 0.5, ...(k || {}), scale: kind === 'maidan' ? 0.86 + Math.random() * 0.1 : 1 }, you: side === 0 && i === 0, runs: 0, balls: 0, out: null, bBalls: 0, bRuns: 0, bWkts: 0, pace: i >= R.side - 3 ? 'pace' : i >= R.side - 5 ? 'spin' : 'pace' }));
    this.teams = [
      { name: R.you, short: R.you.slice(0, 3).toUpperCase(), players: team(OUR_NAMES, 0, kit[0]) },
      { name: opp, short: opp.slice(0, 3).toUpperCase(), players: team(THEIR_NAMES, 1, kit[1]) },
    ];
    this.cast = [];
    this.umpires = [];
    this.inns = [];
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 12, 8), kind === 'eden' ? mats().ballRed : mats().ballTennis);
    this.ball.castShadow = true;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12).rotateX(-Math.PI / 2), mats().shadow);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.2, 20).rotateX(-Math.PI / 2), mats().marker);
    this.pitchMark = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.13, 16).rotateX(-Math.PI / 2), mats().pitchMark);
    // where a well-timed shot meets the ball: lights up as the ball arrives
    this.hitRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 28).rotateX(-Math.PI / 2), mats().hitRing);
    this.hitRing.position.set(BAT_X - 0.15, 0.065, Z_HIT);
    const ghost = new THREE.SphereGeometry(BALL_R * 0.9, 8, 6);
    this.trail = mats().trail.map((m, i) => {
      const t = new THREE.Mesh(ghost, m);
      t.scale.setScalar(1 - (i / TRAIL) * 0.6);
      t.visible = false;
      return t;
    });
    this.trailPts = this.trail.map(() => new THREE.Vector3());
    V.root.add(this.ball, this.shadow, this.marker, this.pitchMark, this.hitRing, ...this.trail);
    this.ball.visible = this.shadow.visible = this.marker.visible = this.pitchMark.visible = this.hitRing.visible = false;
    if (kind === 'eden') {
      for (const [x, z, role] of [[-1.1, HALF + 2.4, 'end'], [24, -HALF + 1.5, 'leg']]) {
        const u = this.spawn({ female: false, skin: '#8a5a3c', shirt: '#f4f4f0', pants: '#202022', shoes: '#1a1612', hair: '#cfcfcf', longSleeve: true, scale: 1 });
        u.role = role;
        u.signal = null;
        u.pose = signalPose(u);
        this.place(u, x, z, role === 'end' ? Math.PI : -Math.PI / 2);
        this.umpires.push(u);
      }
    }
    this.phase = 'toss';
    this.phaseT = 0;
    this.inn = null;
    this.updateScore();
    this.camMode = 'wide';
    this.tossCall = null;
    this.el.root.classList.remove('hidden');
    this.hud.el.hud.classList.add('hidden');
    this.modal(
      `${R.title.toUpperCase()}`,
      `<b>${this.teams[0].name}</b> vs <b>${this.teams[1].name}</b><br>${R.overs} overs a side · ${R.wickets} wickets${R.oneTip ? ' · gully rules: one-tip-one-hand, no LBW' : ' · full laws: LBW, wides, no-balls and free hits'}<br><br>The coin's in the air — call it!`,
      [['H', 'Heads', () => this.toss('heads')], ['T', 'Tails', () => this.toss('tails')]],
    );
    this.crowd(0.25, 2.5);
  }

  /** Leave the ground; the stake stays spent unless the match was won or tied. */
  stop() {
    if (!this.active) return;
    const g = this.game;
    const pl = g.player;
    for (const c of this.cast) if (!c.you) this.despawn(c);
    for (const u of this.umpires) this.despawn(u);
    for (const b of this.cast.filter((c) => c.bat)) b.bat.removeFromParent();
    this.cast = [];
    this.umpires = [];
    this.ball.removeFromParent();
    this.shadow.removeFromParent();
    this.marker.removeFromParent();
    this.pitchMark.removeFromParent();
    this.hitRing.removeFromParent();
    this.hitRing.geometry.dispose();
    for (const t of this.trail) t.removeFromParent();
    this.trail[0].geometry.dispose();
    this.scene.remove(this.light);
    for (const s of [1, -1]) this.resetStumps(this.V.stumps[s]);
    this.scene.add(pl.ch.mesh);
    pl.ch.mode = 'move';
    pl.ch.poseFn = null;
    pl.ch.mesh.visible = true;
    pl.mode = 'foot';
    const e = this.V.entry;
    const yaw = Math.atan2(this.V.x - e.x, this.V.z - e.z) + Math.PI;
    pl.pos.set(e.x + Math.sin(yaw) * 2, this.world.height(e.x, e.z), e.z + Math.cos(yaw) * 2);
    pl.yaw = yaw;
    pl.ch.mesh.position.copy(pl.pos);
    pl.ch.mesh.rotation.set(0, yaw, 0);
    this.active = false;
    this.el.root.classList.add('hidden');
    this.el.modal.classList.add('hidden');
    this.hud.el.hud.classList.remove('hidden');
  }

  /* ---------- People ---------- */
  spawn(look) {
    const ch = new Character(this.scene, look);
    this.V.root.add(ch.mesh);
    const c = { ch, x: 0, z: 0, yaw: 0, tx: null, tz: null, speed: 0, pose: standPose, swing: -1, lift: 0, bowlU: 0, throwU: 0 };
    return c;
  }
  despawn(c) {
    if (c.bat) c.bat.removeFromParent();
    c.ch.mesh.removeFromParent();
    c.ch.mesh.geometry.dispose();
  }
  /** A cricketer on the field for player p (you are the player's own character). */
  member(p) {
    if (p.you) {
      const pl = this.game.player;
      const c = { ch: pl.ch, x: 0, z: 0, yaw: 0, tx: null, tz: null, speed: 0, pose: standPose, swing: -1, lift: 0, bowlU: 0, throwU: 0, you: true };
      pl.ch.mesh.visible = true;
      c.p = p;
      return c;
    }
    const c = this.spawn(p.look);
    c.p = p;
    return c;
  }
  place(c, x, z, yaw) {
    c.x = x;
    c.z = z;
    c.yaw = yaw;
    c.tx = c.tz = null;
    c.speed = 0;
  }
  moveTo(c, x, z, speed) {
    c.tx = x;
    c.tz = z;
    c.runSpeed = speed;
  }
  holdBat(c) {
    if (!c.bat) {
      c.bat = batMesh();
      this.V.root.add(c.bat);
    }
  }

  /* ---------- Toss and innings ---------- */
  toss(call) {
    const side = Math.random() < 0.5 ? 'heads' : 'tails';
    const youWin = side === call;
    if (youWin) {
      this.modal('YOU WON THE TOSS', `It's ${side}. What will you do?`, [['1', 'Bat first', () => this.beginMatch(0)], ['2', 'Bowl first', () => this.beginMatch(1)]]);
    } else {
      const bat = Math.random() < 0.5 ? 1 : 0;
      this.modal('TOSS LOST', `It's ${side}. ${this.teams[1].name} won the toss and chose to ${bat === 1 ? 'bat' : 'bowl'}.`, [['SPACE', 'Play', () => this.beginMatch(bat === 1 ? 1 : 0)]]);
    }
  }
  /** first: which team bats first (0 = yours). */
  beginMatch(first) {
    this.closeModal();
    this.inns = [];
    this.startInnings(first);
  }
  startInnings(bat) {
    for (const c of this.cast) {
      if (!c.you) this.despawn(c);
      else if (c.bat) c.bat.removeFromParent();
    }
    this.cast = [];
    const R = this.R;
    const field = 1 - bat;
    const target = this.inns.length ? this.inns[0].runs + 1 : null;
    const inn = { bat, field, runs: 0, wkts: 0, balls: 0, extras: 0, over: [], freeHit: false, target, next: 2, striker: 0, nonStriker: 1, bowlers: [], overNo: 0 };
    this.inn = inn;
    this.inns.push(inn);
    const T = this.teams;
    // fielding side: everyone, keeper is the second player; two (or three) bowlers take turns
    const fp = T[field].players;
    const ids = fp.map((_, i) => i);
    inn.keeper = 1;
    inn.bowlers = field === 0 ? [0, fp.length - 1] : [fp.length - 1, fp.length - 2, fp.length - 3].slice(0, R.overs > 2 ? 3 : 2);
    inn.fielders = ids.map((i) => this.member(fp[i]));
    for (const c of inn.fielders) this.cast.push(c);
    // the two batters
    const bp = T[bat].players;
    inn.batters = [this.member(bp[0]), this.member(bp[1])];
    for (const c of inn.batters) {
      this.holdBat(c);
      this.cast.push(c);
    }
    inn.ends = [-1, 1]; // batter i's end: -1 = the striker's end, +1 = the bowler's
    this.humanBats = bat === 0;
    const msg = target ? `${T[bat].name} need ${target} to win off ${R.overs * 6} balls` : `${T[bat].name} bat first`;
    this.banner(this.humanBats ? 'YOU ARE BATTING' : 'YOU ARE BOWLING', msg, 2.4);
    this.setupBall(true);
  }
  get bowlerIdx() {
    const inn = this.inn;
    return inn.bowlers[inn.overNo % inn.bowlers.length];
  }

  /* ---------- One ball ---------- */
  setupBall(newOver = false) {
    const inn = this.inn;
    const R = this.R;
    const FIELD = this.V.kind === 'eden' ? EDEN_FIELD : GULLY_FIELD;
    const fl = inn.fielders;
    const bIdx = this.bowlerIdx;
    // keeper and bowler to their marks, the rest round the field
    const order = [inn.keeper, bIdx, ...fl.map((_, i) => i).filter((i) => i !== inn.keeper && i !== bIdx)];
    order.forEach((i, k) => {
      const c = fl[i];
      const [, x, z] = FIELD[Math.min(k, FIELD.length - 1)];
      const s = Math.hypot(x, z) > R.boundary - 4 ? (R.boundary - 4) / Math.hypot(x, z) : 1;
      this.place(c, x * s, z * s, Math.atan2(-x, -HALF - z));
      c.role = k === 0 ? 'keeper' : k === 1 ? 'bowler' : 'field';
      c.pose = c.role === 'keeper' ? keepPose : readyPose;
      c.held = false;
      c.tried = false;
    });
    this.keeper = fl[inn.keeper];
    this.bowler = fl[bIdx];
    this.keeper.yaw = 0;
    // the bowler walks back to the top of the run-up
    const runup = this.V.kind === 'eden' ? 13 : 7;
    this.place(this.bowler, 0.7, HALF + runup, Math.PI);
    this.bowler.pose = standPose;
    // striker on guard, non-striker backing up
    const [a, b] = inn.batters;
    const st = inn.ends[0] === -1 ? a : b;
    const ns = st === a ? b : a;
    inn.st = st;
    inn.ns = ns;
    this.place(st, BAT_X + 0.25, -HALF + 1.0, -Math.PI / 2);
    st.swing = -1;
    st.lift = 0;
    st.pose = batPose(st);
    this.place(ns, -1.2, CREASE + 0.5, Math.PI);
    ns.pose = standPose;
    for (const u of this.umpires) u.signal = null;
    for (const s of [1, -1]) this.resetStumps(this.V.stumps[s]);
    this.ball.visible = this.shadow.visible = this.pitchMark.visible = this.hitRing.visible = false;
    this.el.meter.classList.add('hidden');
    this.el.mlabel.textContent = '';
    this.d = null;
    this.shot = null;
    this.live = null;
    this.run = null;
    this.camMode = 'broadcast';
    if (this.humanBats) {
      this.phase = 'ready';
      this.phaseT = newOver ? 1.6 : 1.1;
      this.marker.visible = false;
    } else {
      this.phase = 'aim';
      this.phaseT = 0;
      if (!this.aimAt) this.aimAt = { x: -0.15, z: -4.8, type: 'pace' };
      this.marker.visible = true;
    }
    this.updateScore();
  }

  /** The delivery: from the release point to a pitching spot, swinging in the air and turning off the pitch. */
  makeDelivery(type, px, pz, speedK = 1) {
    const R = this.R;
    const pace = type !== 'spin';
    const [s0, s1] = pace ? R.pace : R.spin;
    const speed = lerp(s0, s1, Math.random()) * speedK;
    const d = { type, speed, e: R.bounce * (pace ? 1 : 0.92), keep: pace ? 0.9 : 0.82, swing: 0, turn: 0 };
    if (type === 'swing') d.swing = -(1.2 + Math.random() * 1.8); // away towards the slips
    else if (type === 'pace') d.swing = (Math.random() - 0.5) * 1.2;
    else d.turn = 0.9 + Math.random() * 0.9; // off-spin, into the right-hander
    const p0 = new THREE.Vector3(0.45, 2.15, HALF - 0.6);
    const T1 = Math.hypot(px - p0.x, pz - p0.z) / speed;
    const v0 = new THREE.Vector3((px - p0.x - 0.5 * d.swing * T1 * T1) / T1, (BALL_R - p0.y + 0.5 * G * T1 * T1) / T1, (pz - p0.z) / T1);
    // fly it now and keep the path: it decides the timing window, the wide, the pad and the stumps
    const step = 1 / 240;
    const path = [];
    const p = p0.clone();
    const v = v0.clone();
    let bounced = false;
    let t = 0;
    while (t < 3 && p.z > -HALF - 4) {
      if (!bounced) v.x += d.swing * step;
      v.y -= G * step;
      p.addScaledVector(v, step);
      if (p.y <= BALL_R) {
        p.y = BALL_R;
        if (!bounced) {
          bounced = true;
          d.pitch = { x: p.x, z: p.z };
          v.x = v.x * d.keep + d.turn;
          v.z *= d.keep;
          v.y = -v.y * d.e;
        } else v.y = Math.abs(v.y) * 0.5;
      }
      t += step;
      path.push(p.x, p.y, p.z);
    }
    d.path = path;
    d.step = step;
    d.dur = t;
    d.at = (zc) => {
      for (let i = 0; i < path.length; i += 3) if (path[i + 2] <= zc) return { t: (i / 3) * step, x: path[i], y: path[i + 1], z: path[i + 2] };
      return null;
    };
    d.crease = d.at(-CREASE);
    d.hit = d.at(Z_HIT);
    d.pad = d.at(-HALF + 1.2);
    d.stumps = d.at(-HALF);
    return d;
  }
  ballAt(d, t, out) {
    const i = Math.min(d.path.length / 3 - 1, Math.max(0, Math.floor(t / d.step)));
    return out.set(d.path[i * 3], d.path[i * 3 + 1], d.path[i * 3 + 2]);
  }

  /** The other side's bowler picks a ball. */
  aiDelivery() {
    const R = this.R;
    const spin = this.inn && this.teams[this.inn.field].players[this.bowlerIdx].pace === 'spin';
    const type = spin ? 'spin' : Math.random() < 0.35 ? 'swing' : 'pace';
    const r = Math.random();
    const len = spin ? (r < 0.2 ? -6.6 : r < 0.85 ? -5.4 : -3.8) : r < 0.1 ? -8.4 : r < 0.32 ? -6.6 : r < 0.78 ? -4.8 : r < 0.95 ? -2.8 : -1.2;
    const err = this.V.kind === 'eden' ? 0.14 : 0.22;
    const line = (type === 'swing' ? 0.2 : spin ? -0.35 : -0.12) + gauss() * err * 1.6;
    const d = this.makeDelivery(type, line, len + gauss() * err * 2.5);
    d.noBall = R.noBalls && Math.random() < 0.03;
    return d;
  }

  /* ---------- Frame ---------- */
  update(dt, T, input) {
    if (!this.active) return;
    const pl = this.game.player;
    pl.prompt = null;
    this.input = input;
    if (input.hit('KeyX')) {
      if (this.quitArm > 0) {
        this.hud.notify('MATCH ABANDONED', `Your ₹${this.R.fee} stays with the organisers`, '#ffd36b');
        this.stop();
        return;
      }
      this.quitArm = 2.5;
      this.banner('LEAVE THE MATCH?', 'Press X again to walk off (you lose the stake)', 2.4);
    }
    this.quitArm = Math.max(0, (this.quitArm || 0) - dt);
    // modal buttons by key
    if (this.buttons) {
      for (const [key, , fn] of this.buttons) {
        const code = key === 'SPACE' ? 'Space' : /^\d$/.test(key) ? 'Digit' + key : 'Key' + key;
        if (input.hit(code)) {
          fn();
          if (this.active) this.animate(dt, T);
          return;
        }
      }
    }
    const game = this.phase;
    if (game === 'ready') this.tickReady(dt);
    else if (game === 'aim') this.tickAim(dt);
    else if (game === 'runup') this.tickRunup(dt);
    else if (game === 'flight') this.tickFlight(dt);
    else if (game === 'live') this.tickLive(dt);
    else if (game === 'dead') this.tickDead(dt);
    else if (game === 'break') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.closeModal();
        this.startInnings(1 - this.inns[0].bat);
      }
    }
    this.animate(dt, T);
    this.light.intensity = this.game.night * (this.V.kind === 'eden' ? 1.4 : 0.6);
    // keep the world loaded round the ground
    const w = this.toWorld(0, 0, 0);
    pl.pos.set(w.x, w.y, w.z);
  }

  tickReady(dt) {
    this.phaseT -= dt;
    if (this.phaseT > 0) return;
    this.d = this.aiDelivery();
    this.beginRunup();
  }

  /** You bowl: SPACE runs in at once; WASD and 1-3 change line, length and type first if you like. */
  tickAim(dt) {
    const k = this.input.keys;
    const a = this.aimAt;
    if (k.has('KeyA')) a.x -= dt * 0.9;
    if (k.has('KeyD')) a.x += dt * 0.9;
    if (k.has('KeyW')) a.z += dt * 3.5;
    if (k.has('KeyS')) a.z -= dt * 3.5;
    a.x = clamp(a.x, -1.2, 1.0);
    a.z = clamp(a.z, -8.6, -0.5);
    if (this.input.hit('Digit1')) a.type = 'pace';
    if (this.input.hit('Digit2')) a.type = 'swing';
    if (this.input.hit('Digit3')) a.type = 'spin';
    this.marker.position.set(a.x, 0.06, a.z);
    this.help(`<kbd>SPACE</kbd> bowl &nbsp;·&nbsp; <b>${a.type.toUpperCase()}</b>, ${lengthName(a.z)} <span class="ck-dim">· <kbd>WASD</kbd> aim · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> pace / swing / spin</span>`);
    if (this.input.hit('Space')) {
      this.meter = { v: 0, hit: null };
      this.beginRunup();
    }
  }

  beginRunup() {
    this.phase = 'runup';
    this.phaseT = 0;
    const c = this.bowler;
    const runup = this.V.kind === 'eden' ? 13 : 7;
    this.place(c, 0.7, HALF + runup, Math.PI);
    this.moveTo(c, 0.55, HALF + 0.3, this.V.kind === 'eden' ? 7 : 5);
    c.runTime = runup / (this.V.kind === 'eden' ? 7 : 5);
    this.inn.st.lift = 0;
    if (this.humanBats) {
      this.help('<kbd>SPACE</kbd> as the needle hits the <b class="ck-g">green</b> <span class="ck-dim">· hold <kbd>W</kbd> to loft · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>S</kbd> block</span>');
      this.el.meter.classList.add('hidden');
    } else {
      this.help('<kbd>SPACE</kbd> in the <b class="ck-g">green</b> to bowl it on the spot');
      this.setMeter(0.72, 0.95, this.R.noBalls ? 1.0 : null, 'RELEASE');
      this.el.meter.classList.remove('hidden');
    }
  }

  /** The timing bar: v runs 0 to 1.15 across it; green from a to b, red (no-ball / too late) past red. */
  setMeter(a, b, red, label) {
    const at = (v) => `${clamp(v / 1.15, 0, 1) * 100}%`;
    this.el.zone.style.left = at(a);
    this.el.zone.style.width = `calc(${at(b)} - ${at(a)})`;
    this.el.red.style.display = red === null ? 'none' : '';
    if (red !== null) this.el.red.style.left = at(red);
    this.el.mlabel.textContent = label;
    this.el.needle.classList.remove('done');
  }
  setNeedle(v, hot) {
    this.el.needle.style.left = `${clamp(v / 1.15, 0, 1) * 100}%`;
    this.el.meter.classList.toggle('hot', !!hot);
  }

  tickRunup(dt) {
    const c = this.bowler;
    this.phaseT += dt;
    if (!this.humanBats) {
      const m = this.meter;
      m.v = this.phaseT / c.runTime;
      if (m.hit === null) this.setNeedle(m.v, m.v >= 0.72 && m.v <= 0.95);
      if (m.hit === null && this.input.hit('Space')) m.hit = m.v;
    }
    if (c.tx !== null) return;
    // at the crease: the delivery stride
    if (c.pose !== c.bowlPose) {
      c.bowlPose = c.pose = bowlPose(c);
      c.bowlU = 0;
      if (!this.humanBats) {
        // your ball: where you aimed, as true as your timing
        // no press at all is just an ordinary ball, never a no-ball
        const m = this.meter;
        const v = m.hit;
        const off = v === null ? 0.12 : v >= 0.72 && v <= 0.95 ? 0 : v < 0.72 ? 0.72 - v : v - 0.95;
        const err = 0.05 + off * 1.3;
        const a = this.aimAt;
        this.d = this.makeDelivery(a.type, a.x + gauss() * err, a.z + gauss() * err * 2, off === 0 ? 1.05 : 1);
        this.d.noBall = this.R.noBalls && v !== null && v > 1.0;
        this.el.meter.classList.add('hidden');
        if (this.d.noBall) this.flash('OVERSTEPPED!', 0.9, '#ff6b6b');
        else this.flash(off === 0 ? 'PERFECT RELEASE' : off < 0.15 ? 'GOOD BALL' : 'LOOSE', 0.9, off === 0 ? '#ffd23f' : off < 0.15 ? '#5dff9e' : '#ffb36b');
      }
    }
    c.bowlU += dt / 0.55;
    if (c.bowlU >= 0.62) this.release();
  }

  release() {
    const d = this.d;
    this.phase = 'flight';
    this.phaseT = 0;
    this.ball.visible = this.shadow.visible = true;
    this.marker.visible = false;
    this.flightT = 0;
    this.inn.st.lift = 0;
    // the pitching spot flashes up a moment before the ball lands
    this.pitchMark.position.set(d.pitch ? d.pitch.x : 0, 0.06, d.pitch ? d.pitch.z : 0);
    this.swingAt = null;
    this.trailReset = true;
    this.ai = this.humanBats ? null : this.aiShot(d);
    // your timing bar: the needle reaches the middle of the green as the ball reaches the sweet spot
    this.bat = null;
    if (this.humanBats && d.hit) {
      const f = this.R.forgive;
      const early = d.at(Z_HIT + 1.1 / f);
      const late = d.at(Z_HIT - 0.95 / f);
      // the bar covers only the last half second, so the green is wide enough to read
      const k = 0.85 / clamp(d.hit.t, 0.3, 0.5);
      const v = (t) => 0.85 - (d.hit.t - t) * k;
      this.bat = { v, a: early ? v(early.t) : 0.75, b: late ? v(late.t) : 0.95 };
      this.setMeter(this.bat.a, this.bat.b, this.bat.b, 'TIMING');
      this.setNeedle(0);
      this.el.meter.classList.remove('hidden');
      this.hitRing.visible = true;
    }
    this.moveTo(this.bowler, 0.9, HALF - 3.5, 3);
  }

  /** The ball on its way down: you play your shot, or the AI plays theirs. */
  tickFlight(dt) {
    const d = this.d;
    const st = this.inn.st;
    const ts = this.humanBats ? this.R.timeScale : 1;
    this.flightT += dt * ts;
    const t = this.flightT;
    const b = this.ballAt(d, t, this.ball.position);
    this.pitchMark.visible = d.pitch && t > 0.15 && b.z > d.pitch.z - 1.5;
    st.lift = clamp(t / 0.35, 0, 1);
    const k = this.input.keys;
    let play = null;
    if (this.humanBats) {
      const bt = this.bat;
      if (bt && this.swingAt === null) {
        const v = bt.v(t);
        this.setNeedle(v, v >= bt.a && v <= bt.b);
        this.hitRing.material.opacity = v >= bt.a && v <= bt.b ? 0.95 : clamp((v - 0.45) / (bt.a - 0.45), 0, 1) * 0.35;
      }
      if (this.swingAt === null && this.input.hit('Space')) {
        this.swingAt = t;
        const raw = b.z - Z_HIT;
        play = { dir: k.has('KeyA') ? -1 : k.has('KeyD') ? 1 : this.autoDir(d), loft: k.has('KeyW'), defend: k.has('KeyS'), errM: raw * this.R.forgive, you: true };
        st.loft = play.loft;
        st.swing = 0;
        if (raw > 3.6) play.miss = true; // far too early
        if (bt) this.el.needle.classList.add('done');
      }
    } else if (this.ai && !this.ai.done && (this.ai.leave ? false : b.z <= Z_HIT + this.ai.errM)) {
      this.ai.done = true;
      play = { ...this.ai, errM: b.z - Z_HIT };
      st.loft = play.loft;
      st.swing = 0;
    }
    if (play && !play.miss) {
      const reach = Math.abs(b.x - BAT_X) < (play.you ? 1.5 : 1.25) && b.y < 2.1;
      const res = reach ? this.playShot(play, b) : null;
      if (res) return this.goLive(res);
    }
    // past the bat: the pad, the stumps, or the keeper's gloves
    if (t >= d.dur || b.z <= -HALF - 2.2) this.missed(play);
  }

  /** No direction held: play with the line, pull the short ball, drive the full one straight. */
  autoDir(d) {
    const h = d.hit || d.crease;
    if (!h) return 0;
    if (d.pitch && d.pitch.z > -3.6 && h.y > 0.8) return 1;
    return h.x < -0.18 ? -1 : h.x > 0.28 ? 1 : 0;
  }

  /** Turn a shot into a ball going somewhere (or null for a miss). */
  playShot(play, b) {
    const R = this.R;
    let e = play.errM; // > 0 early, < 0 late (metres of ball travel)
    const lateEdge = play.defend ? -0.9 : -0.6;
    if (e > 2.2 || e < -1.25) return null;
    let q;
    let theta;
    let speed;
    let elev;
    let kind = 'hit';
    const base = play.dir < 0 ? -1.15 : play.dir > 0 ? 1.0 : (Math.random() - 0.5) * 0.35;
    if (e < lateEdge) {
      // late: off the outside edge, behind square on the off side
      kind = 'edge';
      theta = -Math.PI + 0.25 + Math.random() * 0.5;
      speed = 11 + Math.random() * 8;
      elev = 0.12 + Math.random() * 0.25;
      q = 0.2;
    } else if (e > 1.2) {
      // far too early: a leading edge or top edge that loops up
      kind = 'mistimed';
      theta = base + (Math.random() - 0.3) * 1.2;
      speed = 9 + Math.random() * 7;
      elev = 0.75 + Math.random() * 0.4;
      q = 0.15;
    } else {
      q = e >= 0 ? 1 - Math.max(0, e - 0.3) / 1.2 : 1 - Math.max(0, -e - 0.3) / 0.9;
      q = clamp(q, 0.1, 1);
      // early drags it round to leg, late pushes it to off; the line plays its part
      theta = base + e * 0.42 + clamp(b.x, -1, 1) * 0.5;
      if (play.defend) {
        speed = 3 + q * 3;
        elev = 0.02;
      } else if (play.loft) {
        speed = 19 + q * 15;
        elev = 0.62 - q * 0.22 + Math.max(0, e - 0.3) * 0.2;
      } else {
        speed = 14 + q * 15;
        elev = 0.05 + Math.random() * 0.06;
      }
    }
    const v = new THREE.Vector3(Math.sin(theta) * Math.cos(elev), Math.sin(elev), Math.cos(theta) * Math.cos(elev)).multiplyScalar(speed);
    this.shot = { theta };
    const p = new THREE.Vector3(b.x, Math.max(0.25, Math.min(b.y, 1.3)), b.z);
    this.thock(kind === 'hit' ? 0.3 + q * 0.5 : 0.25);
    if (q > 0.9 && kind === 'hit' && !play.defend) this.flash('PERFECT!', 0.8, '#ffd23f');
    else if (kind === 'hit' && e > 0.6) this.flash('A BIT EARLY', 0.6, '#ffb36b');
    else if (kind === 'hit' && e < -0.3) this.flash('A BIT LATE', 0.6, '#ffb36b');
    else if (kind !== 'hit' && play.you) this.flash(kind === 'edge' ? 'TOO LATE — EDGED' : 'TOO EARLY', 0.7, '#ff6b6b');
    if (kind === 'edge') this.say(pick(SAY.edge));
    return { p, v, kind, q, defend: play.defend };
  }

  /** The ball beat the bat (or wasn't played): bowled, LBW, wide, or the keeper takes it. */
  missed(play) {
    const d = this.d;
    const R = this.R;
    const inn = this.inn;
    const offered = !!play || this.swingAt !== null || !!(this.ai && this.ai.done);
    const s = d.stumps;
    const hits = s && Math.abs(s.x) < STUMP_X + BALL_R + 0.02 && s.y < STUMP_H + BALL_R;
    const pad = d.pad && d.pad.x > BAT_X - 0.17 && d.pad.x < BAT_X + 0.22 && d.pad.y < 0.85;
    const res = { runs: 0, extras: 0, legal: true };
    if (d.noBall) {
      res.noBall = true;
    }
    const c = d.crease;
    const wide = !offered && c && (c.x < -R.wideOff || c.x > R.wideLeg || c.y > 1.75);
    if (pad) {
      // ball into the pads: is it out?
      const pitchedOutsideLeg = d.pitch && d.pitch.x > STUMP_X + 0.02;
      const inLine = Math.abs(d.pad.x) <= STUMP_X + 0.03;
      const outsideOffNoShot = d.pad.x < -STUMP_X && !offered;
      if (R.lbw && hits && !pitchedOutsideLeg && (inLine || outsideOffNoShot) && !inn.freeHit && !res.noBall) res.out = 'lbw';
      else if (R.lbw && hits) this.say(pitchedOutsideLeg ? 'Big appeal… not out, pitched outside leg.' : 'Huge appeal… not out!');
      else this.say('Into the pads.');
    } else if (hits) {
      if (!inn.freeHit && !res.noBall) res.out = 'bowled';
      this.knockStumps(-1, d.stumps);
    } else if (wide) {
      res.wide = true;
    } else this.say(pick(SAY.dot));
    this.endBall(res);
  }

  /* ---------- The ball in the field ---------- */
  goLive(shot) {
    this.phase = 'live';
    this.phaseT = 0;
    this.pitchMark.visible = this.hitRing.visible = false;
    this.el.meter.classList.add('hidden');
    this.live = { p: shot.p, v: shot.v, bounces: 0, held: null, holdT: 0, thrown: null, kind: shot.kind, runsDone: 0, boundary: null, edge: shot.kind === 'edge' };
    this.ball.position.copy(shot.p);
    this.run = { going: false, queued: 0, back: false, done: 0, t: 0 };
    this.camMode = shot.v.length() > 12 && !shot.defend ? 'follow' : 'broadcast';
    // fielders read it: who gets there first
    this.planChase();
    // the batters judge the run themselves; batting, you can push for more or hold them back
    this.aiRun();
    if (!this.humanBats) this.help('Your fielders chase it down and throw it in');
    else this.help('Running is automatic <span class="ck-dim">· <kbd>SPACE</kbd> push for another · <kbd>S</kbd> stay put</span>');
    this.inn.st.swing = Math.max(this.inn.st.swing, 0);
  }

  /** Predict the ball's path and send the nearest fielders after it. */
  planChase() {
    const L = this.live;
    const p = L.p.clone();
    const v = L.v.clone();
    const R = this.R;
    const pts = [];
    let bounced = 0;
    for (let t = 0; t < 7; t += 1 / 30) {
      this.stepBall(p, v, 1 / 30, () => bounced++);
      pts.push([t, p.x, p.y, p.z]);
      if (Math.hypot(p.x, p.z) > R.boundary + 2) break;
    }
    L.pts = pts;
    const chasers = [];
    for (const c of this.inn.fielders) {
      if (c === this.bowler && L.v.z < 0) continue;
      let best = null;
      for (const [t, x, y, z] of pts) {
        if (y > 2.6) continue;
        const dist = Math.hypot(x - c.x, z - c.z);
        // someone right in its path gets a hand to it without a moment to react
        const need = dist / R.fieldSpeed + (dist < 2 ? 0 : 0.5);
        if (need <= t && Math.hypot(x, z) < R.boundary) {
          best = { t, x, z, cut: true };
          break;
        }
      }
      if (!best) {
        const [t, x, , z] = pts[pts.length - 1];
        best = { t: t + Math.hypot(x - c.x, z - c.z) / R.fieldSpeed, x, z };
      }
      chasers.push({ c, ...best });
    }
    chasers.sort((a, b) => a.t - b.t);
    L.chasers = chasers.slice(0, 2);
    for (const [i, h] of L.chasers.entries()) {
      this.moveTo(h.c, h.x, h.z, R.fieldSpeed * (i ? 0.8 : 1));
      h.c.chasing = true;
    }
    L.backT = chasers[0] ? chasers[0].t : 3;
    // keeper and bowler cover the stumps
    this.moveTo(this.keeper, 0.3, -HALF - 0.6, 5);
    if (!L.chasers.some((h) => h.c === this.bowler)) this.moveTo(this.bowler, 0.6, HALF + 0.6, 5);
  }

  stepBall(p, v, dt, onBounce) {
    v.y -= G * dt;
    p.addScaledVector(v, dt);
    if (p.y <= BALL_R) {
      p.y = BALL_R;
      if (v.y < -1.5) {
        v.y = -v.y * 0.42;
        v.x *= 0.78;
        v.z *= 0.78;
        onBounce && onBounce();
      } else {
        v.y = 0;
        const h = Math.hypot(v.x, v.z);
        const k = h > 0 ? Math.max(0, h - (this.V.kind === 'eden' ? 3.2 : 2.6) * dt) / h : 0;
        v.x *= k;
        v.z *= k;
      }
    }
  }

  tickLive(dt) {
    const L = this.live;
    const R = this.R;
    const inn = this.inn;
    this.phaseT += dt;
    const ball = this.ball.position;
    if (L.held) {
      // in a fielder's hands: throw it in to the end in danger
      const c = L.held;
      ball.set(c.x + 0.2, 1.1, c.z);
      L.holdT += dt;
      if (!L.throwEnd) {
        L.throwEnd = this.dangerEnd();
        c.pose = c.throwPose = throwPose(c);
        c.throwU = 0;
        c.yaw = Math.atan2(0 - c.x, L.throwEnd * HALF - c.z);
      }
      c.throwU += dt / 0.35;
      if (L.holdT > 0.6 && (this.run.going || this.run.queued || L.holdT > 1.0)) {
        const tx = 0.3;
        const tz = L.throwEnd * (HALF + 0.4);
        const dist = Math.hypot(tx - ball.x, tz - ball.z);
        const tt = dist / R.throwSpeed;
        L.v.set((tx - ball.x) / tt, (1.0 - ball.y) / tt + 0.5 * G * tt, (tz - ball.z) / tt);
        L.p.copy(ball);
        L.thrown = { end: L.throwEnd, t: tt };
        L.held = null;
        c.pose = readyPose;
      }
      if (L.holdT > 1.4 && !this.run.going) return this.endBall(this.completed());
    } else {
      L.p.copy(ball);
      const before = L.p.y > BALL_R + 0.01;
      this.stepBall(L.p, L.v, dt, () => L.bounces++);
      ball.copy(L.p);
      if (L.thrown) {
        // the throw comes in: at the stumps, is anyone short?
        const tz = L.thrown.end * HALF;
        if (Math.abs(ball.z - tz) < 1.4 && Math.abs(ball.x) < 1.5) {
          const out = this.runOutCheck(L.thrown.end);
          if (out !== null) {
            this.knockStumps(L.thrown.end);
            return this.endBall({ ...this.completed(), out: 'runout', who: out });
          }
          return this.endBall(this.completed());
        }
      } else {
        // over the rope?
        if (Math.hypot(ball.x, ball.z) > R.boundary) {
          L.boundary = L.bounces === 0 && before ? 6 : 4;
          return this.endBall({ ...this.completed(), boundary: L.boundary });
        }
        // catches and pick-ups
        for (const c of inn.fielders) {
          const dx = ball.x - c.x;
          const dz = ball.z - c.z;
          const reach = c.role === 'keeper' ? 1.4 : 1.15;
          if (dx * dx + dz * dz > reach * reach || ball.y > 2.5) continue;
          if (L.bounces === 0 && ball.y > 0.15 && !c.tried) {
            c.tried = true;
            const sp = L.v.length();
            let p = R.catchP - (sp > 24 ? 0.25 : sp > 18 ? 0.1 : 0) - (Math.hypot(dx, dz) > 0.8 ? 0.15 : 0);
            if (c.role === 'keeper') p += 0.05;
            if (Math.random() < p) {
              if (inn.freeHit || (this.d && this.d.noBall)) {
                this.say('Caught… but it is a free hit!');
              } else return this.endBall({ ...this.completed(), out: 'caught', by: c });
            } else {
              this.say(pick(SAY.dropped));
              L.v.multiplyScalar(0.25);
              L.v.y = 1.5;
              continue;
            }
          }
          if (R.oneTip && L.bounces === 1 && ball.y > 0.2 && ball.y < 1.6 && !c.tried) {
            c.tried = true;
            if (Math.random() < 0.4) return this.endBall({ ...this.completed(), out: 'oneTip', by: c });
          }
          if (ball.y < 1.0 && L.v.length() < 26) {
            if (L.v.length() > 18 && Math.random() < 0.08) {
              L.v.multiplyScalar(0.3); // misfield
              this.say('Misfield!');
              continue;
            }
            L.held = c;
            L.holdT = 0;
            L.throwEnd = null;
            L.v.set(0, 0, 0);
            c.tx = c.tz = null;
            for (const h of L.chasers) h.c.chasing = false;
            this.aiSendBack(c);
            break;
          }
        }
        // the chaser follows the ball once it gets past where they were heading
        for (const [i, h] of (L.chasers || []).entries()) {
          if (!h.c.chasing) continue;
          if (this.phaseT > h.t - 0.2 || L.v.length() < 4) this.moveTo(h.c, ball.x, ball.z, R.fieldSpeed * (i ? 0.85 : 1));
        }
      }
    }
    this.tickRun(dt);
  }

  /* ---------- Running between the wickets ---------- */
  tickRun(dt) {
    const r = this.run;
    const inn = this.inn;
    const R = this.R;
    if (this.humanBats) {
      if (this.input.hit('Space')) {
        if (!r.going) this.startRun();
        else r.queued = Math.min(r.queued + 1, 3);
      }
      if (this.input.hit('KeyS')) {
        r.hold = true;
        r.queued = 0;
        if (r.going && !r.back) {
          r.back = true;
          for (const c of inn.batters) this.moveTo(c, c.fromX, c.fromZ, R.batSpeed);
        }
      }
    }
    if (!r.going) return;
    const arrived = inn.batters.every((c) => c.tx === null);
    if (!arrived) return;
    r.going = false;
    if (r.back) {
      r.back = false;
      return;
    }
    // a run completed: the ends swap
    r.done++;
    inn.ends = [-inn.ends[0], -inn.ends[1]];
    if (r.queued > 0) {
      r.queued--;
      this.startRun();
    } else if (!r.hold) this.aiRun();
  }
  startRun() {
    const inn = this.inn;
    const R = this.R;
    this.run.going = true;
    inn.batters.forEach((c, i) => {
      const to = -inn.ends[i];
      c.fromX = c.x;
      c.fromZ = c.z;
      this.moveTo(c, i === 0 ? 1.1 : -1.1, to * (CREASE + 0.6), R.batSpeed);
    });
  }
  /** Runs completed so far on this ball. */
  completed() {
    return { runs: this.run ? this.run.done : 0 };
  }
  /** The end where a batter would be caught short, judged by who has further to go. */
  dangerEnd() {
    const inn = this.inn;
    let end = -1;
    let worst = -Infinity;
    inn.batters.forEach((c, i) => {
      const goingTo = this.run.going ? -inn.ends[i] : inn.ends[i];
      const left = Math.abs(goingTo * CREASE - c.z);
      if (left > worst) {
        worst = left;
        end = goingTo;
      }
    });
    return end;
  }
  /** At the stumps at `end`, the batter heading there who hasn't made the crease. */
  runOutCheck(end) {
    const inn = this.inn;
    if (!this.run.going) return null;
    let who = null;
    inn.batters.forEach((c, i) => {
      const goingTo = this.run.back ? inn.ends[i] : -inn.ends[i];
      if (goingTo !== end) return;
      if (end * c.z < CREASE - 0.05) who = i;
    });
    return who;
  }
  /** The other side's batters judge a run against the fielder and the throw. */
  aiRun() {
    const L = this.live;
    const R = this.R;
    const inn = this.inn;
    const runT = (2 * CREASE) / R.batSpeed;
    const ball = this.ball.position;
    let backT;
    // never set off with the throw already on its way in
    if (L.thrown) return;
    if (L.held) {
      const c = L.held;
      backT = Math.max(0, 0.6 - L.holdT) + Math.min(Math.hypot(c.x, c.z - HALF), Math.hypot(c.x, c.z + HALF)) / R.throwSpeed;
    } else {
      const h = L.chasers && L.chasers[0];
      const fieldT = h ? Math.max(0, h.t - this.phaseT) : 3;
      const throwD = h ? Math.min(Math.hypot(h.x, h.z - HALF), Math.hypot(h.x, h.z + HALF)) : 20;
      backT = fieldT + 0.6 + throwD / R.throwSpeed;
    }
    // nobody cuts it off before the rope: run while it races away
    const h0 = L.chasers && L.chasers[0];
    const heading4 = !L.held && !(h0 && h0.cut) && L.pts && Math.hypot(L.pts[L.pts.length - 1][1], L.pts[L.pts.length - 1][3]) > R.boundary - 3;
    const chase = inn.target ? (inn.target - inn.runs) / Math.max(1, R.overs * 6 - inn.balls) : 1;
    // a ball stopped near the pitch is picked up quicker than it looks: only a sharp single
    const close = h0 && Math.hypot(h0.x, h0.z) < 9 ? 0.5 : 0;
    const margin = (this.V.kind === 'eden' ? 0.3 : 0.08) + close - clamp(chase - 1.2, 0, 1) * 0.3;
    if ((heading4 && this.run.done < 2) || backT > runT + margin) {
      if (Math.hypot(ball.x, ball.z + HALF) < 5 && !L.held && L.v.length() < 3) return;
      this.startRun();
    }
  }

  /** The ball's been picked up: a batter not yet halfway, who'd lose the race with the throw, is sent back. */
  aiSendBack(c) {
    const r = this.run;
    const inn = this.inn;
    const R = this.R;
    if (!r.going || r.back) return;
    let left = 0;
    inn.batters.forEach((b, i) => (left = Math.max(left, Math.abs(-inn.ends[i] * CREASE - b.z))));
    const end = this.dangerEnd();
    const throwT = 0.6 + Math.hypot(c.x, c.z - end * HALF) / R.throwSpeed;
    if (left > CREASE && left / R.batSpeed > throwT - 0.2) {
      r.back = true;
      r.queued = 0;
      for (const b of inn.batters) this.moveTo(b, b.fromX, b.fromZ, R.batSpeed);
      this.say('No! Go back!');
    }
  }

  /* ---------- AI batting ---------- */
  aiShot(d) {
    const R = this.R;
    const inn = this.inn;
    const h = d.hit || d.crease;
    if (!h) return { leave: true };
    const onStumps = d.stumps && Math.abs(d.stumps.x) < STUMP_X + 0.05 && d.stumps.y < STUMP_H + 0.05;
    const need = inn.target ? (inn.target - inn.runs) / Math.max(1, R.overs * 6 - inn.balls) : 1.4;
    const aggr = clamp(0.45 + (need - 1.2) * 0.25, 0.15, 0.95);
    const short = d.pitch && d.pitch.z > -3.6;
    const full = d.pitch && d.pitch.z < -6.4;
    const wideish = Math.abs(h.x - BAT_X) > 0.8;
    // how hard the ball is to play: good length on the stumps, movement, the bowler's release
    const hard = (onStumps ? 0.25 : 0) + (!short && !full ? 0.2 : 0) + (d.type === 'spin' ? 0.12 : d.type === 'swing' ? 0.15 : 0);
    const sigma = R.aiTiming * (0.75 + hard);
    if (wideish && !onStumps && Math.random() < 0.65) return { leave: true };
    let s;
    if (short && h.y > 0.9) s = { dir: 1, loft: Math.random() < 0.35 + aggr * 0.4 };
    else if (full) s = { dir: h.x < -0.25 ? -1 : h.x > 0.3 ? 1 : 0, loft: Math.random() < aggr * 0.55 };
    else if (Math.random() < 0.4 - aggr * 0.35) s = { dir: 0, defend: true };
    else s = { dir: h.x < -0.1 ? -1 : 1, loft: Math.random() < aggr * 0.3 };
    s.errM = gauss() * sigma + 0.1;
    return s;
  }

  /* ---------- The ball is dead ---------- */
  endBall(res) {
    const inn = this.inn;
    const R = this.R;
    const d = this.d;
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    this.phaseT = 2.4;
    this.el.meter.classList.add('hidden');
    for (const c of this.cast) {
      c.chasing = false;
      if (c.tx !== null && !(this.live && inn.batters.includes(c))) c.tx = c.tz = null;
    }
    const bowler = this.teams[inn.field].players[this.bowlerIdx];
    const st = inn.st.p;
    let runs = res.runs || 0;
    if (res.boundary) runs = Math.max(runs, res.boundary);
    const noBall = d && d.noBall;
    const wide = res.wide;
    const extras = (noBall ? 1 : 0) + (wide ? 1 : 0);
    const legal = !noBall && !wide;
    inn.runs += runs + extras;
    inn.extras += extras;
    if (legal) {
      inn.balls++;
      st.balls++;
      bowler.bBalls++;
    }
    if (!wide) st.runs += runs;
    bowler.bRuns += runs + extras;
    let sym = runs ? String(runs) : '•';
    let title = '';
    let sub = '';
    if (res.out) {
      const outIdx = res.who !== undefined ? res.who : inn.batters.indexOf(inn.st);
      const outC = inn.batters[outIdx];
      inn.wkts++;
      if (res.out !== 'runout') bowler.bWkts++;
      outC.p.out = res.out;
      sym = 'W';
      title = res.out === 'bowled' ? 'BOWLED!' : res.out === 'lbw' ? 'LBW!' : res.out === 'caught' ? 'CAUGHT!' : res.out === 'oneTip' ? 'ONE TIP ONE HAND!' : 'RUN OUT!';
      sub = `${outC.p.name} ${outC.p.runs} (${outC.p.balls}) · ${pick(SAY[res.out])}`;
      this.signal('out');
      this.cheer(this.inn.fielders);
      this.crowd(this.humanBats ? 0.25 : 0.6, 2.4);
      this.outIdx = outIdx;
    } else if (res.boundary === 6) {
      title = 'SIX!';
      sub = pick(SAY.six);
      this.signal('six');
      this.cheer([inn.st]);
      this.crowd(this.humanBats ? 0.7 : 0.3, 3);
    } else if (res.boundary === 4) {
      title = 'FOUR!';
      sub = pick(SAY.four);
      this.signal('four');
      this.cheer([inn.st]);
      this.crowd(this.humanBats ? 0.55 : 0.25, 2.5);
    } else if (wide) {
      sym = 'Wd';
      title = 'WIDE';
      sub = '+1 to the total, and one more ball';
      this.signal('wide');
    } else if (runs) {
      title = runs === 1 ? 'SINGLE' : `${runs} RUNS`;
      sub = runs > 1 ? 'Good running between the wickets' : 'Rotates the strike';
    }
    if (noBall) {
      sym = runs ? `${runs}Nb` : 'Nb';
      title = title ? `NO BALL · ${title}` : 'NO BALL';
      sub = 'Overstepped! Free hit coming up';
      this.signal('noball');
    }
    if (inn.freeHit && legal) inn.freeHit = false;
    if (noBall) inn.freeHit = true;
    inn.over.push(sym);
    if (title) this.banner(title, sub, 2.2);
    // odd runs swap the ends (already swapped as they ran); new batter where the old one fell
    this.result = res;
    this.updateScore();
  }

  tickDead(dt) {
    this.phaseT -= dt;
    if (this.phaseT > 0) return;
    const inn = this.inn;
    const R = this.R;
    // a new batter for the one who's out
    if (this.result && this.result.out) {
      const i = this.outIdx;
      const old = inn.batters[i];
      const bp = this.teams[inn.bat].players;
      if (inn.wkts < Math.min(R.wickets, bp.length - 1) && inn.next < bp.length) {
        if (old.you) {
          old.ch.mesh.visible = false;
          if (old.bat) old.bat.removeFromParent();
        } else this.despawn(old);
        this.cast = this.cast.filter((c) => c !== old);
        const nb = this.member(bp[inn.next++]);
        this.holdBat(nb);
        nb.bat.visible = true;
        inn.batters[i] = nb;
        this.cast.push(nb);
      }
    }
    this.result = null;
    // the over's done?
    const overDone = inn.balls > 0 && inn.balls % 6 === 0 && inn.over.filter((s) => !/^(Wd|Nb|\dNb)$/.test(s)).length >= 6;
    if (this.inningsOver()) return this.endInnings();
    if (overDone) {
      inn.overNo++;
      inn.over = [];
      inn.ends = [-inn.ends[0], -inn.ends[1]];
      this.banner('END OF OVER', `${this.teams[inn.bat].short} ${inn.runs}/${inn.wkts}`, 1.6);
    }
    this.setupBall(overDone);
  }
  inningsOver() {
    const inn = this.inn;
    const R = this.R;
    const bp = this.teams[inn.bat].players;
    if (inn.target && inn.runs >= inn.target) return true;
    if (inn.wkts >= Math.min(R.wickets, bp.length - 1)) return true;
    return inn.balls >= R.overs * 6;
  }
  endInnings() {
    const inn = this.inn;
    if (this.inns.length === 1) {
      const T = this.teams;
      this.phase = 'break';
      this.phaseT = 6;
      this.camMode = 'wide';
      this.modal('INNINGS BREAK', `${T[inn.bat].name} made <b>${inn.runs}/${inn.wkts}</b> in ${overs(inn.balls)} overs.<br>${T[1 - inn.bat].name} need <b>${inn.runs + 1}</b> to win.`, [['SPACE', 'Next innings', () => (this.phaseT = 0)]]);
      return;
    }
    this.finish();
  }
  finish() {
    const [a, b] = this.inns;
    const g = this.game;
    const R = this.R;
    const T = this.teams;
    this.phase = 'over';
    this.camMode = 'wide';
    const ours = a.bat === 0 ? a : b;
    const theirs = a.bat === 0 ? b : a;
    let title;
    let body;
    if (ours.runs === theirs.runs) {
      title = 'MATCH TIED!';
      body = `Both sides on ${ours.runs}. Your ₹${R.fee} is returned.`;
      g.gameplay.addMoney(R.fee);
    } else if (ours.runs > theirs.runs) {
      const by = b.bat === 0 ? `by ${Math.min(R.wickets, T[0].players.length - 1) - b.wkts} wicket${Math.min(R.wickets, T[0].players.length - 1) - b.wkts === 1 ? '' : 's'}` : `by ${ours.runs - theirs.runs} runs`;
      title = `${T[0].name.toUpperCase()} WIN!`;
      body = `Won ${by}. Prize money: <b style="color:#5dff9e">+₹${R.prize.toLocaleString('en-IN')}</b>`;
      g.gameplay.addMoney(R.prize);
      if (g.progress) g.progress.event(this.V.kind === 'eden' ? 'edenHero' : 'gullyChamp');
      this.crowd(0.8, 3.5);
      this.cheer(this.cast.filter((c) => c.p && c.p.side === 0));
    } else {
      const by = b.bat === 1 ? `by ${Math.min(R.wickets, T[1].players.length - 1) - b.wkts} wickets` : `by ${theirs.runs - ours.runs} runs`;
      title = `${T[1].name.toUpperCase()} WIN`;
      body = `Lost ${by}. Better luck next time — the stake is gone.`;
    }
    const top = [...T[0].players, ...T[1].players].sort((p, q) => q.runs - p.runs)[0];
    const bowl = [...T[0].players, ...T[1].players].filter((p) => p.bBalls).sort((p, q) => q.bWkts - p.bWkts || p.bRuns - q.bRuns)[0];
    body += `<br><br>${T[ours.bat].short} ${ours.runs}/${ours.wkts} (${overs(ours.balls)}) · ${T[theirs.bat].short} ${theirs.runs}/${theirs.wkts} (${overs(theirs.balls)})`;
    if (top) body += `<br>Top score: ${top.name} ${top.runs} (${top.balls})`;
    if (bowl) body += ` · Best bowling: ${bowl.name} ${bowl.bWkts}/${bowl.bRuns}`;
    this.modal(title, body, [['E', 'Leave the ground', () => this.stop()], ['SPACE', 'Leave', () => this.stop()]]);
  }

  /* ---------- Stumps ---------- */
  knockStumps(end, at) {
    const s = this.V.stumps[end];
    s.flying = 1.2;
    s.bv = s.bails.map((b, i) => new THREE.Vector3((i ? 1 : -1) * (1 + Math.random()), 3 + Math.random() * 2, -end * (2 + Math.random() * 2)));
    s.stumps.forEach((m, i) => {
      m.rotation.x = -end * (0.4 + Math.random() * 0.5) * (i === 1 || !at ? 1 : 0.6);
      m.rotation.z = (i - 1) * 0.25;
    });
    this.clatter();
  }
  resetStumps(s) {
    s.flying = 0;
    s.stumps.forEach((m) => m.rotation.set(0, 0, 0));
    s.bails.forEach((b, i) => {
      b.position.set(i ? 0.058 : -0.058, STUMP_H + 0.008, 0);
      b.rotation.set(0, 0, 0);
    });
  }

  /* ---------- Animation ---------- */
  animate(dt, T) {
    for (const c of this.cast) this.animateOne(c, dt, T);
    for (const u of this.umpires) this.animateOne(u, dt, T);
    for (const s of [1, -1]) {
      const st = this.V.stumps[s];
      if (st.flying > 0) {
        st.flying -= dt;
        st.bails.forEach((b, i) => {
          const v = st.bv[i];
          v.y -= G * dt;
          b.position.addScaledVector(v, dt);
          if (b.position.y < 0.01) {
            b.position.y = 0.01;
            v.set(0, 0, 0);
          }
          b.rotation.x += dt * 12;
        });
      }
    }
    // ball shadow
    if (this.ball.visible) this.shadow.position.set(this.ball.position.x, 0.055, this.ball.position.z);
    // the trail: ghost balls along the last few frames of flight
    const moving = this.ball.visible && (this.phase === 'flight' || (this.phase === 'live' && this.live && !this.live.held));
    const pts = this.trailPts;
    if (this.trailReset || !moving) for (const q of pts) q.copy(this.ball.position);
    this.trailReset = false;
    for (let i = pts.length - 1; i > 0; i--) pts[i].copy(pts[i - 1]);
    pts[0].copy(this.ball.position);
    this.trail.forEach((t, i) => {
      t.visible = moving && i > 0;
      t.position.copy(pts[i]);
    });
    if (this.hitRing.visible) this.hitRing.scale.setScalar(1 + Math.sin(T * 9) * 0.04);
    // bats in hands
    for (const c of this.cast) if (c.bat && c.ch.mesh.visible) this.placeBat(c);
    if (this.phase === 'live' || this.phase === 'dead') for (const c of this.cast) if (c.swing >= 0) c.swing = Math.min(1, c.swing + dt * 4);
    if (this.phase === 'flight') {
      const st = this.inn.st;
      if (st.swing >= 0) st.swing = Math.min(1, st.swing + dt * 4.5);
    }
  }
  animateOne(c, dt, T) {
    const ch = c.ch;
    if (c.bowlPose && c.pose === c.bowlPose && this.phase !== 'runup') {
      c.bowlU += dt / 0.55;
      if (c.bowlU >= 1) c.pose = readyPose;
    }
    if (c.tx !== null && c.tx !== undefined) {
      const dx = c.tx - c.x;
      const dz = c.tz - c.z;
      const d = Math.hypot(dx, dz);
      const sp = c.runSpeed || 6;
      if (d < sp * dt + 0.05) {
        c.x = c.tx;
        c.z = c.tz;
        c.tx = c.tz = null;
        c.speed = 0;
      } else {
        c.x += (dx / d) * sp * dt;
        c.z += (dz / d) * sp * dt;
        c.yaw = Math.atan2(dx, dz);
        c.speed = sp;
      }
    } else c.speed = damp(c.speed, 0, 8, dt);
    const moving = c.speed > 0.3;
    if (moving && !(c === this.bowler && c.pose === c.bowlPose)) {
      ch.mode = 'move';
      ch.speed = c.speed;
      // batters keep the bat in hand as they run
      if (c.bat) ch.hold = { kind: 'bat' };
    } else if (ch.emote) {
      ch.mode = 'move';
      ch.speed = 0;
    } else {
      ch.mode = 'pose';
      ch.poseFn = c.pose;
      ch.poseK = c.pose === c.bowlPose || c.pose === c.throwPose ? 22 : 12;
    }
    if (c.bat && !moving) ch.hold = null;
    ch.mesh.position.set(c.x, 0, c.z);
    ch.mesh.rotation.set(0, c.yaw, 0);
    ch.update(dt, T);
  }
  /** The bat sits in the batter's hands and points where the stroke has got to. */
  placeBat(c) {
    const ch = c.ch;
    ch.mesh.updateMatrixWorld(true);
    const hR = ch.bones.haR.getWorldPosition(this.tmp);
    const hL = ch.bones.haL.getWorldPosition(this.tmp2);
    const h = hR.add(hL).multiplyScalar(0.5);
    const p = this.V.root.worldToLocal(h);
    c.bat.position.copy(p);
    let dir;
    const moving = c.speed > 0.3;
    if (moving) dir = [Math.sin(c.yaw) * 0.7, -0.6, Math.cos(c.yaw) * 0.7];
    else if (c.pose && c.swing < 0 && c === this.inn.st) {
      // stance → backlift
      const l = c.lift;
      dir = [lerp(0.1, 0.1, l), lerp(-1, 0.75, l), lerp(-0.2, -0.65, l)];
    } else if (c.swing >= 0) {
      const u = c.swing;
      const th = this.shot ? this.shot.theta : 0;
      const loft = c.loft;
      const a = [0.1, 0.75, -0.65];
      const b = [Math.sin(th) * 0.3, -0.9, 0.35];
      const e = loft ? [Math.sin(th) * 0.4, 0.85, Math.cos(th) * 0.4] : [Math.sin(th) * 0.8, 0.15, Math.cos(th) * 0.8];
      dir = u < 0.45 ? mix(a, b, u / 0.45) : mix(b, e, (u - 0.45) / 0.55);
    } else dir = [0.1, -1, 0.1];
    const v = this.tmp.set(dir[0], dir[1], dir[2]).normalize();
    c.bat.up.set(-1, 0, 0);
    c.bat.lookAt(this.V.root.localToWorld(this.tmp2.copy(c.bat.position).add(v)));
  }
  signal(kind) {
    const u = this.umpires[0];
    if (u) u.signal = kind;
  }
  cheer(list) {
    for (const c of list) if (c && c.ch) c.ch.play('cheer');
  }

  /* ---------- Camera ---------- */
  camera(camera, dt) {
    if (!this.active) return false;
    let pos;
    let look;
    let fov = 38;
    if (this.camMode === 'wide' || this.phase === 'toss' || this.phase === 'over' || this.phase === 'break') {
      const a = performance.now() * 0.00006;
      const r = this.V.kind === 'eden' ? 55 : 26;
      pos = [Math.sin(a) * r, this.V.kind === 'eden' ? 22 : 9, Math.cos(a) * r];
      look = [0, 1, 0];
      fov = 50;
    } else if (this.camMode === 'follow' && this.live) {
      const b = this.ball.position;
      pos = [b.x * 0.4, 16 + Math.hypot(b.x, b.z) * 0.12, -HALF - 20 + b.z * 0.35];
      look = [b.x, Math.min(b.y, 6), b.z];
      fov = 48;
    } else {
      // the TV view, from high behind the bowler
      pos = [0, 5.4, HALF + 22];
      look = [0, 0.9, -HALF + 1.5];
      fov = 26;
    }
    const k = this.camMode === 'follow' ? 4 : 6;
    const P = this.camPos;
    const L = this.camLook;
    const wp = this.toWorld(pos[0], pos[1], pos[2], new THREE.Vector3());
    const wl = this.toWorld(look[0], look[1], look[2], new THREE.Vector3());
    if (!this.camInit || this.camModeWas !== this.camMode) {
      if (!this.camInit || this.camMode === 'broadcast') {
        P.copy(wp);
        L.copy(wl);
      }
      this.camInit = true;
      this.camModeWas = this.camMode;
    }
    P.lerp(wp, 1 - Math.exp(-k * dt));
    L.lerp(wl, 1 - Math.exp(-k * 1.5 * dt));
    camera.position.copy(P);
    camera.lookAt(L);
    camera.fov = damp(camera.fov, fov, 5, dt);
    camera.updateProjectionMatrix();
    return true;
  }

  /* ---------- Sound ---------- */
  thock(vol) {
    const a = this.audio;
    if (!a || !a.ctx) return;
    const t = a.ctx.currentTime;
    a.burst(t, { type: 'bandpass', freq: this.V.kind === 'eden' ? 1500 : 900, q: 1.4, vol: vol * 0.5, dur: 0.07 });
    a.tone(this.V.kind === 'eden' ? 820 : 520, 0.06, 'triangle', vol * 0.25);
  }
  clatter() {
    const a = this.audio;
    if (!a || !a.ctx) return;
    const t = a.ctx.currentTime;
    for (const d of [0, 0.05, 0.11]) a.burst(t + d, { type: 'highpass', freq: 2400, vol: 0.18, dur: 0.06 });
  }
  /** A roar from the stands (a murmur on the Maidan). */
  crowd(vol, dur) {
    const a = this.audio;
    if (!a || !a.ctx || !a.noise) return;
    const ctx = a.ctx;
    const src = ctx.createBufferSource();
    src.buffer = a.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = this.V.kind === 'eden' ? 700 : 1100;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const v = vol * (this.V.kind === 'eden' ? 0.35 : 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  /* ---------- Scoreboard and messages ---------- */
  buildHud() {
    const root = document.createElement('div');
    root.id = 'cricket';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="ck-bug"><div class="ck-score"></div><div class="ck-chase"></div><div class="ck-over"></div><div class="ck-who"></div></div>
      <div class="ck-banner hidden"><div class="ck-title"></div><div class="ck-sub"></div></div>
      <div class="ck-flash hidden"></div>
      <div class="ck-say"></div>
      <div class="ck-meter hidden"><div class="ck-z"></div><div class="ck-red"></div><div class="ck-needle"></div><div class="ck-mlabel"></div></div>
      <div class="ck-help"></div>
      <div class="ck-quit"><kbd>X</kbd> leave the match</div>
      <div class="ck-modal hidden"><h2></h2><p></p><div class="ck-buttons"></div></div>`;
    document.body.appendChild(root);
    if (!document.getElementById('cricket-style')) {
      const css = document.createElement('style');
      css.id = 'cricket-style';
      css.textContent = CRICKET_CSS;
      document.head.appendChild(css);
    }
    const q = (s) => root.querySelector(s);
    this.el = { root, bug: q('.ck-bug'), score: q('.ck-score'), chase: q('.ck-chase'), over: q('.ck-over'), who: q('.ck-who'), banner: q('.ck-banner'), title: q('.ck-title'), sub: q('.ck-sub'), flash: q('.ck-flash'), say: q('.ck-say'), meter: q('.ck-meter'), needle: q('.ck-needle'), zone: q('.ck-z'), red: q('.ck-red'), mlabel: q('.ck-mlabel'), help: q('.ck-help'), modal: q('.ck-modal') };
  }
  updateScore() {
    const inn = this.inn;
    this.el.bug.classList.toggle('hidden', !inn);
    if (!inn) return;
    const T = this.teams;
    const R = this.R;
    this.el.score.innerHTML = `<b>${T[inn.bat].short}</b> ${inn.runs}/${inn.wkts} <span>(${overs(inn.balls)}/${R.overs})</span>${inn.freeHit ? ' <em>FREE HIT</em>' : ''}`;
    this.el.chase.textContent = inn.target ? `Target ${inn.target} · need ${Math.max(0, inn.target - inn.runs)} off ${R.overs * 6 - inn.balls}` : `v ${T[inn.field].name} · ${R.title}`;
    this.el.over.innerHTML = inn.over.map((s) => `<i class="${s === 'W' ? 'w' : s === '4' || s === '6' ? 'b' : ''}">${s}</i>`).join('');
    const st = inn.st && inn.st.p;
    const ns = inn.ns && inn.ns.p;
    const bw = T[inn.field].players[this.bowlerIdx];
    this.el.who.innerHTML = st ? `🏏 <b>${st.name}</b> ${st.runs} (${st.balls}) · ${ns.name} ${ns.runs} (${ns.balls})<br>⚾ ${bw.name} ${overs(bw.bBalls)}-${bw.bRuns}-${bw.bWkts}` : '';
  }
  banner(title, sub, dur) {
    this.el.title.textContent = title;
    this.el.sub.textContent = sub || '';
    this.el.banner.classList.remove('hidden');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => this.el.banner.classList.add('hidden'), dur * 1000);
  }
  flash(text, dur, color = '') {
    const f = this.el.flash;
    f.textContent = text;
    f.style.color = color;
    f.classList.remove('hidden');
    // restart the pop-in
    f.classList.remove('pop');
    void f.offsetWidth;
    f.classList.add('pop');
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => this.el.flash.classList.add('hidden'), dur * 1000);
  }
  say(text) {
    this.el.say.textContent = text;
    clearTimeout(this.sayT);
    this.sayT = setTimeout(() => (this.el.say.textContent = ''), 2600);
  }
  help(html) {
    if (this.helpWas !== html) this.el.help.innerHTML = html;
    this.helpWas = html;
  }
  modal(title, body, buttons) {
    const m = this.el.modal;
    m.querySelector('h2').textContent = title;
    m.querySelector('p').innerHTML = body;
    const box = m.querySelector('.ck-buttons');
    box.innerHTML = '';
    for (const [key, label, fn] of buttons) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${key}</kbd> ${label}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      box.appendChild(b);
    }
    this.buttons = buttons;
    m.classList.remove('hidden');
    this.help('');
  }
  closeModal() {
    this.el.modal.classList.add('hidden');
    this.buttons = null;
  }
}

// The parts of the look that belong to the new controls (the rest is in style.css)
const CRICKET_CSS = `
#cricket .ck-meter { width: 380px; height: 20px; bottom: 140px; overflow: visible; border-radius: 10px; border: 2px solid rgba(255,255,255,0.75);
  background: linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.16)), rgba(11,13,20,0.82); box-shadow: 0 6px 24px rgba(0,0,0,0.45); }
#cricket .ck-meter .ck-z, #cricket .ck-meter .ck-red { position: absolute; top: 0; bottom: 0; }
#cricket .ck-meter .ck-z { border-radius: 6px; background: linear-gradient(180deg, #8dffbf, #1fc46a); box-shadow: 0 0 12px rgba(93,255,158,0.55); }
#cricket .ck-meter .ck-red { right: 0; border-radius: 0 8px 8px 0; background: linear-gradient(180deg, #ff8a8a, #c62828); opacity: 0.85; }
#cricket .ck-meter .ck-needle { top: -5px; bottom: -5px; width: 5px; margin-left: -2.5px; border-radius: 3px; transition: background 0.1s; }
#cricket .ck-meter.hot .ck-needle { background: #ffe14d; box-shadow: 0 0 14px #ffe14d, 0 0 4px #fff; }
#cricket .ck-meter .ck-needle.done { opacity: 0.5; }
#cricket .ck-meter .ck-mlabel { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); text-align: center; font: 15px 'Bebas Neue', sans-serif; letter-spacing: 3px; opacity: 0.85; text-shadow: 0 1px 4px #000; }
#cricket .ck-help { border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px); }
#cricket .ck-help .ck-dim { opacity: 0.6; font-weight: 500; }
#cricket .ck-help .ck-g { color: #5dff9e; }
#cricket .ck-flash { font-size: 40px; }
#cricket .ck-flash.pop { animation: ck-pop 0.35s cubic-bezier(.2,1.6,.4,1); }
#cricket .ck-banner:not(.hidden) { animation: ck-rise 0.45s ease-out; }
@keyframes ck-pop { from { transform: translateX(-50%) scale(0.5); opacity: 0; } to { transform: translateX(-50%) scale(1); opacity: 1; } }
@keyframes ck-rise { from { transform: translateX(-50%) translateY(24px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
@media (max-width: 560px) { #cricket .ck-meter { width: 82vw; } }
`;

function overs(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}
function lengthName(z) {
  return z < -7.8 ? 'yorker' : z < -6 ? 'full' : z < -4 ? 'good length' : z < -2.2 ? 'short' : 'bouncer';
}
function mix(a, b, t) {
  t = clamp(t, 0, 1);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
