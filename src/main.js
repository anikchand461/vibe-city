import * as THREE from 'three';
import { setAniso } from './textures.js';
import { World, BOUNDS, inTiles, lightConeMaterial } from './world.js';
import { DayCycle } from './sky.js';
import { Vehicle, setTrafficLights, collideVehicles, setCarLOD, carLOD, hooks } from './car.js';
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { LINES } from './lines.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { createPost } from './post.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Gameplay } from './gameplay.js';
import { Input } from './input.js';
import { Rail } from './rail.js';
import { Metro } from './metro.js';
import { Combat } from './combat.js';
import { weaponIcons } from './weapons.js';
import { Boat, RiverTraffic, buildGhats } from './boats.js';
import { MapView, routeLength } from './mapview.js';
import { Station } from './station.js';
import { AddaManager } from './adda.js';
import { Cricket } from './cricket.js';
import { Carrom } from './carrom.js';
import { Voices } from './voice.js';
import { Rides } from './ride.js';
import { Interiors, interiorTarget, setInteriorNight } from './interiors.js';
import { Boards } from './boards.js';
import { BusStand } from './busstand.js';
import { dressBus } from './busroutes.js';
import { inPoly, nearestOnRing } from './geo.js';
import * as T from './textures.js';
import { clamp, damp, dampAngle, lerp } from './utils.js';
import { splash } from './splash.js';
import { Progress } from './progress.js';
import { TaxiJobs } from './jobs.js';
import { Weather } from './weather.js';
import { WardrobeManager } from './wardrobe.js';
import { Newspaper } from './newspaper.js';
import { FestiveManager } from './festive.js';


/* ---------- Quality presets ---------- */
const PRESETS = {
  ultra: { pr: 2, minPr: 1, shadow: 4096, ao: true, peds: 44, traffic: 26, rain: 1 },
  high: { pr: 1.25, minPr: 0.75, shadow: 2048, ao: false, peds: 38, traffic: 24, rain: 0.8 },
  medium: { pr: 1, minPr: 0.6, shadow: 1024, ao: false, peds: 26, traffic: 18, rain: 0.55 },
  // Low: for older laptops and integrated graphics. No post-processing or sun shadows,
  // a shorter view into thicker haze, a river mirror that refreshes rarely, fewer people
  low: { pr: 0.75, minPr: 0.5, shadow: 512, noShadow: true, ao: false, noPost: true, far: 1500, fog: 1.6, reflectEvery: 10, peds: 16, traffic: 12, carNear: 28, treeNear: 120, treeFar: 1300, rain: 0.3 },
};
let quality = null;
try {
  quality = localStorage.getItem('nt_quality');
} catch {
  /* storage unavailable */
}
if (!PRESETS[quality]) quality = guessQuality();
/** First visit: integrated and mobile GPUs (or software rendering) start on Low. */
function guessQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : '';
    if (!gl || /swiftshader|llvmpipe|software|intel.*(hd|uhd)|mali|adreno|powervr/i.test(name)) return 'low';
  } catch {
    /* no WebGL info */
  }
  return 'high';
}
let preset = PRESETS[quality];

/* ---------- Renderer ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
let pixelRatio = Math.min(window.devicePixelRatio, preset.pr);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.getElementById('app').appendChild(renderer.domElement);
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 3200);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let world, day, fx, post, hud, gameplay, traffic, peds, player, rail, combat, metro, riverTraffic, mapView, station, adda, rides, boards, progress, jobs, weather, wardrobe, cricket, newspaper, festive, carrom;
const vehicles = [];
const audio = new AudioEngine();
const voices = new Voices(audio);

/* ---------- Sound settings (title screen and pause menu) ---------- */
function refreshSoundButtons() {
  document.querySelectorAll('.sound button').forEach((b) => {
    const k = b.dataset.s;
    const on = k === 'music' ? audio.radioOn : k === 'voices' ? voices.enabled : !audio.muted;
    b.classList.toggle('on', on);
    b.textContent = `${k === 'music' ? 'MUSIC' : k === 'voices' ? 'VOICES' : 'ALL SOUND'} ${on ? 'ON' : 'OFF'}`;
  });
}
document.querySelectorAll('.sound button').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const k = b.dataset.s;
    if (k === 'music') audio.setRadio(!audio.radioOn);
    else if (k === 'voices') voices.setEnabled(!voices.enabled);
    else {
      audio.setMuted(!audio.muted);
      voices.muted = audio.muted;
    }
    refreshSoundButtons();
  }),
);
refreshSoundButtons();

/* ---------- Time of day: real Kolkata clock, or always day / night ---------- */
const TIME_HOURS = { day: 12, night: 22 };
let timeMode = 'real';
try {
  timeMode = localStorage.getItem('nt_time') || 'real';
} catch {
  /* storage unavailable */
}
function applyTimeMode(m) {
  timeMode = TIME_HOURS[m] ? m : 'real';
  try {
    localStorage.setItem('nt_time', timeMode);
  } catch {
    /* storage unavailable */
  }
  document.querySelectorAll('.timeset button').forEach((b) => b.classList.toggle('on', b.dataset.t === timeMode));
  if (!day) return;
  day.fixed = timeMode !== 'real';
  if (day.fixed) day.time = TIME_HOURS[timeMode];
  else day.syncT = 0; // snap back to the wall clock on the next frame
}
document.querySelectorAll('.timeset button').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    applyTimeMode(b.dataset.t);
  }),
);
applyTimeMode(timeMode);

function refreshFestiveButtons() {
  const on = festive ? festive.enabled : false;
  document.querySelectorAll('.festiveset button').forEach((b) => {
    b.classList.toggle('on', (b.dataset.f === 'on') === on);
  });
}
document.querySelectorAll('.festiveset button').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (festive) {
      festive.setEnabled(b.dataset.f === 'on');
      refreshFestiveButtons();
    }
  }),
);
const input = new Input(renderer.domElement);
let state = 'loading';
let elapsed = 0;
let frameNo = 0;

/* ---------- Game context shared with the player controller ---------- */
const game = {
  vehicles,
  audio,
  camera,
  night: 0,
  partyOn: false,
  camYaw: 0,
  get player() {
    return player;
  },
  get rail() {
    return rail;
  },
  get combat() {
    return combat;
  },
  get fx() {
    return fx;
  },
  get peds() {
    return peds;
  },
  get traffic() {
    return traffic;
  },
  get hud() {
    return hud;
  },
  get gameplay() {
    return gameplay;
  },
  get station() {
    return station;
  },
  get rides() {
    return rides;
  },
  get input() {
    return input;
  },
  get metro() {
    return metro;
  },
  get progress() {
    return progress;
  },
  get jobs() {
    return jobs;
  },
  get cricket() {
    return cricket;
  },
  get carrom() {
    return carrom;
  },
  get adda() {
    return adda;
  },
  get wardrobe() {
    return wardrobe;
  },
  get newspaper() {
    return newspaper;
  },
  get festive() {
    return festive;
  },
  setWardrobe(open) {
    setWardrobe(open);
  },
  setNewspaper(open) {
    setNewspaper(open);
  },
  setPaused(p) {
    setPaused(p);
  },
  get day() {
    return day;
  },
  /** Ask the player for a destination on the map; cb(point | null). */
  pickDestination(text, cb) {
    pickCb = cb;
    mapView.setPick(text);
    setMap(true);
  },
  setWaypointQuiet(p) {
    setWaypoint(p, true);
  },
  clearWaypoint() {
    setWaypoint(null, true);
  },
  adoptTrafficCar(car, vel, angVel, released = false) {
    if (!released) traffic.release(car, player.focus);
    const v = new Vehicle(scene, world, fx, car.type, car.color, car.mesh);
    v.place(car.x, car.z, car.yaw, vel, car.y);
    // a route bus keeps its route, and where it had got to along it
    if (car.busRoute) Object.assign(v, { busRoute: car.busRoute, busBack: car.busBack, busLinks: car.busLinks, busI: car.busI });
    v.angVel = angVel || 0;
    vehicles.push(v);
    pruneVehicles();
    return v;
  },
  onEnterVehicle(v, passenger = false) {
    if (passenger) {
      cam.mode = 0;
      return;
    }
    attachHeadlights(v);
    if (v.rail) cam.mode = v.kind === 'metro' ? 2 : 0;
    if (v.rail && v.kind === 'metro') progress.event('driveMetro');
    hud.notify(v.label.toUpperCase(), v.rail ? 'W / S to drive along the line' : '', '#38f3ff');
  },
  onExitVehicle() {
    attachHeadlights(null);
  },
  shake(a) {
    cam.shake = Math.min(1, cam.shake + a);
  },
  recoil(a) {
    cam.pitch -= a;
    cam.recoil = Math.min(0.15, (cam.recoil || 0) + a * 0.6);
    cam.shake = Math.min(1, cam.shake + a * 0.6);
  },
  onPlayerDown() {
    cam.mode = 0;
  },
  respawnPlayer() {
    // Wake up on the nearest pavement, a little poorer
    const p = player.pos;
    const w = world.nearestSidewalk(p.x, p.z);
    player.revive(w.x, w.z, w.yaw);
    const fee = Math.min(gameplay.money, 100 + Math.floor(gameplay.money * 0.05));
    if (fee > 0) gameplay.addMoney(-fee, 'Hospital bill');
    hud.notify('BACK ON YOUR FEET', fee > 0 ? `Hospital bill -₹${fee}` : 'Take it easy', '#5dff9e');
  },
  endParty() {
    game.partyOn = false;
    peds.stopParty();
  },
};

function pruneVehicles() {
  while (vehicles.length > 16) {
    let far = null;
    let fd = 120;
    for (const v of vehicles) {
      if (v === player.vehicle || v.keep) continue;
      const d = Math.hypot(v.pos.x - player.focus.x, v.pos.z - player.focus.z);
      if (d > fd) {
        fd = d;
        far = v;
      }
    }
    if (!far) break;
    scene.remove(far.car.root);
    vehicles.splice(vehicles.indexOf(far), 1);
  }
}

/* ---------- Headlight rig (moves to whatever the player drives) ---------- */
const headlights = new THREE.Group();
const spots = [];
const beamMat = lightConeMaterial(new THREE.Color(1.0, 0.92, 0.78));
for (const x of [0.62, -0.62]) {
  const sp = new THREE.SpotLight(0xfff0d8, 0, 90, 0.48, 0.55, 1.4);
  sp.position.set(x, 0.75, 2.3);
  sp.target.position.set(x * 1.5, 0, 22);
  headlights.add(sp, sp.target);
  spots.push(sp);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 2.6, 15, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 7.5), beamMat);
  cone.position.set(x, 0.74, 2.42);
  cone.rotation.x = 0.06;
  cone.renderOrder = 4;
  headlights.add(cone);
}
function attachHeadlights(v) {
  headlights.removeFromParent();
  if (!v) return;
  // The rig is laid out for a car; shift it to this vehicle's lamps
  // A rail vehicle driven from its rear cab carries the lights on its back end
  const flip = v.rail && v.cab < 0;
  headlights.position.set(0, v.def.headY - 0.75, (flip ? -1 : 1) * (v.def.headZ - 2.36));
  headlights.rotation.y = flip ? Math.PI : 0;
  v.car.root.add(headlights);
}

/* ---------- Camera rig ---------- */
const titleFocus = new THREE.Vector3();
const cam = { mode: 0, yaw: Math.PI, pitch: 0.18, look: 0, lookPitch: 0, lookTimer: 0, shake: 0, fov: 62, pos: new THREE.Vector3(), init: false };
const CAR_CAMS = [
  { dist: 7.4, height: 2.5, look: 1.2 },
  { dist: 12, height: 4.2, look: 1.4 },
  { dist: 0, height: 1.22, look: 0 },
];

/* ---------- Vehicle interiors ---------- */
const interiors = new Interiors();
let firstPersonWas = false;
/** In the inside view (C), show the cabin you're sitting in and hide your own body. */
function updateInterior(dt) {
  const p = player;
  const v = p.vehicle;
  const fp = state === 'play' && p.driving && !!v && cam.mode === 2 && !(v.rail && !p.passenger);
  let target = null;
  if (fp) target = v.rail ? (rides.ride && rides.ride.kind === 'rail' ? interiorTarget(v, rides.ride.ci) : null) : interiorTarget(v);
  interiors.update(dt, target);
  if (fp !== firstPersonWas) p.ch.mesh.visible = !fp;
  firstPersonWas = fp;
}

function updateCamera(dt) {
  if (state === 'title') {
    // Circle Howrah Bridge, with the city behind it
    const a = elapsed * 0.03;
    const c = titleFocus;
    camera.position.set(c.x + Math.cos(a) * 520, 140 + Math.sin(elapsed * 0.1) * 20, c.z + Math.sin(a) * 520);
    camera.lookAt(c.x, 30, c.z);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  if (cricket && cricket.active && cricket.camera(camera, dt)) return;
  if (carrom && carrom.active && carrom.camera(camera, dt)) return;
  if (adda && adda.active) {
    camera.position.copy(adda.camPos);
    camera.lookAt(adda.camLook);
    camera.fov = damp(camera.fov, 56, 4, dt);
    camera.updateProjectionMatrix();
    return;
  }
  // Zoomed views turn the mouse down so aiming stays precise
  const sens = camera.fov / 60;
  const mdx = input.mouse.dx * sens;
  const mdy = input.mouse.dy * sens;
  const p = player;
  let targetFov = 60;
  let fovK = 3;
  cam.recoil = Math.max(0, (cam.recoil || 0) - dt * 0.6);
  if (!p.driving && p.scoped) {
    // Sniper scope: look straight out of the player's eyes
    cam.yaw -= mdx * 0.0026;
    cam.pitch = clamp(cam.pitch + mdy * 0.0022, -0.9, 1.1);
    const head = p.ch.bones.head.getWorldPosition(cam.pos);
    const cp = Math.cos(cam.pitch);
    camera.position.set(head.x, head.y + 0.08, head.z);
    camera.lookAt(head.x + Math.sin(cam.yaw) * cp * 10, head.y + 0.08 - Math.sin(cam.pitch) * 10, head.z + Math.cos(cam.yaw) * cp * 10);
    targetFov = 11;
    fovK = 14;
  } else if (!p.driving) {
    // Third-person orbit around the character; tighter over the shoulder when aiming
    cam.yaw -= mdx * 0.0026;
    cam.pitch = clamp(cam.pitch + mdy * 0.0022, p.aiming ? -0.9 : -0.45, 1.1);
    const sprint = p.speed > 5;
    const combatView = p.aiming || p.combatT > 0;
    const dist = p.aiming ? 2.1 : combatView && p.arsenal.def.kind === 'gun' ? 3.3 : (sprint ? 4.9 : 4.3) * (cam.mode === 1 ? 1.5 : 1);
    const tx = p.pos.x;
    const ty = p.pos.y + (p.aiming ? 1.62 : 1.55);
    const tz = p.pos.z;
    const fx = Math.sin(cam.yaw);
    const fz = Math.cos(cam.yaw);
    const cp = Math.cos(cam.pitch);
    // over-the-shoulder offset to the right
    const sh = p.aiming ? 0.62 : 0.45;
    const sx = -fz * sh;
    const sz = fx * sh;
    let cx = tx - fx * cp * dist + sx;
    let cz = tz - fz * cp * dist + sz;
    const py = p.pos.y;
    const hit = world.raycastAt(tx, tz, cx, cz, py);
    if (hit < 1) {
      const f = Math.max(0.1, hit - 0.05);
      cx = tx + (cx - tx) * f;
      cz = tz + (cz - tz) * f;
    }
    // keep the lens out of poles, palms and walls
    for (let i = 0; i < 2; i++) {
      const push = world.collideAt(cx, cz, 0.45, py);
      if (!push) break;
      cx += push.px;
      cz += push.pz;
    }
    let cy = Math.max(ty + Math.sin(cam.pitch) * dist, world.groundAt(cx, cz, py) + 0.3);
    if (p.underground) cy = Math.min(cy, metro.ceilingAt(cx, cz, py) - 0.35);
    if (!cam.init) cam.pos.set(cx, cy, cz);
    const ck = p.aiming ? 30 : 20;
    cam.pos.set(damp(cam.pos.x, cx, ck, dt), damp(cam.pos.y, cy, ck, dt), damp(cam.pos.z, cz, ck, dt));
    camera.position.copy(cam.pos);
    camera.lookAt(tx + sx, ty, tz + sz);
    targetFov = p.aiming ? 44 : sprint ? 66 : 60;
    if (p.aiming) fovK = 12;
  } else {
    const v = p.vehicle;
    if (mdx || mdy) {
      cam.look -= mdx * 0.004;
      cam.lookPitch = clamp(cam.lookPitch + mdy * 0.003, -0.3, 0.6);
      cam.lookTimer = 1.6;
    }
    cam.lookTimer -= dt;
    if (cam.lookTimer <= 0) {
      cam.look = damp(cam.look, 0, 3, dt);
      cam.lookPitch = damp(cam.lookPitch, 0, 3, dt);
    }
    let heading = v.yaw;
    const firstPerson = cam.mode === 2 && !(v.rail && !p.passenger);
    if (firstPerson && p.passenger) {
      // inside: look the way your seat faces
      heading = p.yaw;
    } else if (p.passenger) {
      // riding: look the way it's going, even when a tram or train runs cab-end backwards;
      // stopped, keep looking that way rather than swinging round to the nose
      if (cam.rideV !== v) {
        cam.rideV = v;
        cam.rideYaw = null;
      }
      if (Math.hypot(v.vel.x, v.vel.y) > 1) cam.rideYaw = Math.atan2(v.vel.x, v.vel.y);
      if (cam.rideYaw != null) heading = cam.rideYaw;
    } else if (v.speed > 3 && v.vf > -1) heading = dampAngle(v.yaw, Math.atan2(v.vel.x, v.vel.y), 1, 0.35);
    cam.yaw = dampAngle(cam.yaw, heading, 5, dt);
    const m = CAR_CAMS[cam.mode];
    if (firstPerson) {
      // From your own seat, inside the cabin: the driver's eyes, or a passenger's
      camera.position.set(p.pos.x + Math.sin(p.yaw) * 0.12, p.pos.y + 1.62, p.pos.z + Math.cos(p.yaw) * 0.12);
      const ly = cam.yaw + cam.look;
      camera.lookAt(camera.position.x + Math.sin(ly) * 20, camera.position.y - 0.4 - cam.lookPitch * 10, camera.position.z + Math.cos(ly) * 20);
    } else if (cam.mode === 2) {
      // Driving a train, tram or Metro: ride up front just past the windscreen
      const eye = v.local(0, v.def.hl + 0.4);
      camera.position.set(eye.x, v.pos.y + m.height + (v.def.seatY + 0.42) + 0.3, eye.z);
      const ly = cam.yaw + cam.look;
      camera.lookAt(camera.position.x + Math.sin(ly) * 20, camera.position.y - 0.4 - cam.lookPitch * 10, camera.position.z + Math.cos(ly) * 20);
    } else {
      const yaw = cam.yaw + cam.look;
      const dist = m.dist + clamp(v.speed / 60, 0, 1) * 1.6 + v.def.camDist;
      const height = m.height + cam.lookPitch * 6 + v.def.camH;
      let tx = v.pos.x - Math.sin(yaw) * dist;
      let tz = v.pos.z - Math.cos(yaw) * dist;
      const hit = world.raycastAt(v.pos.x, v.pos.z, tx, tz, v.pos.y);
      if (hit < 1) {
        const f = Math.max(0.2, hit - 0.08);
        tx = v.pos.x + (tx - v.pos.x) * f;
        tz = v.pos.z + (tz - v.pos.z) * f;
      }
      let ty = Math.max(v.pos.y + height, world.groundAt(tx, tz, v.pos.y) + 0.8);
      if (v.pos.y < -2.5) ty = Math.min(ty, metro.ceilingAt(tx, tz, v.pos.y) - 0.4);
      cam.pos.set(damp(cam.pos.x, tx, 14, dt), damp(cam.pos.y, ty, 8, dt), damp(cam.pos.z, tz, 14, dt));
      camera.position.copy(cam.pos);
      const ahead = p.passenger ? cam.yaw : v.yaw;
      camera.lookAt(v.pos.x + Math.sin(ahead) * 2, v.pos.y + m.look, v.pos.z + Math.cos(ahead) * 2);
    }
    targetFov = 60 + clamp(v.speed / 70, 0, 1) * 16 + (v.nitroOn ? 8 : 0);
  }
  cam.init = true;
  cam.shake = Math.max(cam.shake - dt * 2.5, 0);
  if (cam.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * cam.shake;
    camera.position.y += (Math.random() - 0.5) * cam.shake;
  }
  cam.fov = damp(cam.fov, targetFov, fovK, dt);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

/* ---------- Resize & quality ---------- */
function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (post) post.setSize(innerWidth, innerHeight, pixelRatio);
  if (fx) fx.setScale(innerHeight * pixelRatio);
}
addEventListener('resize', resize);

function applyQuality(q) {
  quality = q;
  preset = PRESETS[q];
  try {
    localStorage.setItem('nt_quality', q);
  } catch {
    /* storage unavailable */
  }
  document.querySelectorAll('button[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
  pixelRatio = Math.min(window.devicePixelRatio, preset.pr);
  if (day) {
    const sh = day.sun.shadow;
    sh.mapSize.set(preset.shadow, preset.shadow);
    if (sh.map) {
      sh.map.dispose();
      sh.map = null;
    }
    day.sun.castShadow = !preset.noShadow;
    day.fogScale = preset.fog || 1;
  }
  camera.far = preset.far || 3200;
  camera.updateProjectionMatrix();
  carLOD.near = preset.carNear || 70;
  if (world) {
    world.treeNear = preset.treeNear || 230;
    world.treeFar = preset.treeFar || 1900;
    if (world.flora) world.updateFlora(camera.position.x, camera.position.z, true);
  }
  if (post) post.gtao.enabled = preset.ao;
  resize();
}
document.querySelectorAll('button[data-q]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    applyQuality(b.dataset.q);
  }),
);

let perfT = 0;
let perfFrames = 0;
let perfLow = 0;
let perfHigh = 0;
let perfHold = 0;
/**
 * Adaptive resolution. Changing it reallocates every render target, which shows as a
 * flash, so it only moves after a sustained slowdown (or a long smooth spell) and
 * never more than once every ten seconds.
 */
function adaptQuality(dt) {
  perfT += dt;
  perfFrames++;
  perfHold -= dt;
  if (perfT < 2) return;
  const fps = perfFrames / perfT;
  perfT = 0;
  perfFrames = 0;
  perfLow = fps < 30 ? perfLow + 1 : 0;
  perfHigh = fps > 58 ? perfHigh + 1 : 0;
  if (perfHold > 0) return;
  const cap = Math.min(window.devicePixelRatio, preset.pr);
  let next = pixelRatio;
  if (perfLow >= 3) next = Math.max(preset.minPr, pixelRatio - 0.25);
  else if (perfHigh >= 5) next = Math.min(cap, pixelRatio + 0.25);
  if (Math.abs(next - pixelRatio) > 0.01) {
    pixelRatio = next;
    perfLow = perfHigh = 0;
    perfHold = 10;
    resize();
  }
}

/* ---------- Boot ---------- */
async function boot() {
  const setLoading = (p, t) => {
    document.querySelector('#loading .fill').style.width = `${p * 100}%`;
    document.querySelector('#loading .text').textContent = t;
    splash.progress(p, t);
  };
  setLoading(0.1, 'Paving the streets');
  await frame();
  world = new World(scene);
  rail = new Rail(scene, world, null);
  metro = new Metro(scene, world, null);
  rail.consists.push(...metro.trains);
  boards = new Boards(scene, world, rail, metro);
  const bridge = world.decks.find((d) => d.river);
  if (bridge) {
    const q = bridge.poly.at(bridge.poly.len / 2, {});
    titleFocus.set(q.x, 0, q.z);
  }
  setLoading(0.45, 'Painting the sky');
  await frame();
  day = new DayCycle(scene, renderer);
  // always Kolkata's live weather; DAY / NIGHT only change the time of day
  weather = new Weather(scene, 8000, 'live');
  // ?t=HOUR overrides the real clock (for testing a time of day)
  const startHour = parseFloat(new URLSearchParams(location.search).get('t'));
  if (!Number.isNaN(startHour)) {
    day.time = startHour % 24;
    day.fixed = true;
  } else applyTimeMode(timeMode);
  fx = new Effects(scene);
  rail.fx = fx;
  for (const c of rail.consists) c.fx = fx;
  hud = new HUD(world);
  hud.voice = voices;
  station = new Station(scene, world, hud, rail);
  station.game = game;
  adda = new AddaManager(scene, world, hud, audio);
  cricket = new Cricket(game, scene, world, hud, audio);
  carrom = new Carrom(game, scene, world, hud, audio);
  carrom.init();
  rides = new Rides(game, scene, world);
  const sp = station.spawn || [(BOUNDS.x0 + BOUNDS.x1) / 2, (BOUNDS.z0 + BOUNDS.z1) / 2];
  world.spawn = { x: sp[0], z: sp[1] };
  setLoading(0.6, 'Fuelling the taxis');
  await frame();
  traffic = new Traffic(scene, world, fx, preset.traffic);
  traffic.onRelease = (car, vel, ang) => game.adoptTrafficCar(car, vel, ang, true);
  traffic.honk = (car) => {
    const f = player.focus;
    const dx = car.x - f.x;
    const dz = car.z - f.z;
    const e = camera.matrixWorld.elements;
    const l = Math.hypot(dx, dz) || 1;
    audio.honk(l, car.type, (dx * e[0] + dz * e[2]) / l);
  };
  // Parked rides: buses at Howrah bus stand, the taxi rank, and a few more nearby
  const parked = [...station.parked];
  const extras = [['rickshaw', 0x2b4a8a], ['ambassador', 0xf4f4f0], ['bike', 0x18181d], ['rickshaw', 0xffffff], ['ambassador', 0x1d1f24], ['bike', 0xc8382c], ['pickup', 0x9c2b23], ['van', 0xf2f2f2]];
  const near = world.graph.edgesNear(world.spawn.x, world.spawn.z, 400).filter((e) => e.c <= 4 && e.len > 30 && !e.br);
  for (const [type, color] of extras) {
    for (let tries = 0; tries < 20; tries++) {
      const e = near[Math.floor(Math.random() * near.length)];
      if (!e) break;
      const q = e.poly.at(e.len * (0.3 + Math.random() * 0.4), {});
      const off = e.w / 2 - 1.3;
      const x = q.x + q.tz * off;
      const z = q.z - q.tx * off;
      if (world.collideCircle(x, z, 1.4) || parked.some((o) => Math.hypot(o[2] - x, o[3] - z) < 7)) continue;
      parked.push([type, color, x, z, Math.atan2(q.tx, q.tz)]);
      break;
    }
  }
  for (const [type, color, x, z, yaw, run] of parked) {
    const v = new Vehicle(scene, world, fx, type, color);
    v.place(x, z, yaw);
    v.keep = true;
    if (run) {
      // a bus waiting at its terminus, with that route's boards
      dressBus(v.car.body, world.graph, run.route);
      v.busRoute = run.route;
      v.busBack = run.back;
    }
    vehicles.push(v);
  }
  // Dharmatala: buses waiting at the Esplanade terminus
  const busStand = new BusStand(scene, world);
  busStand.spawn((type, color, x, z, yaw) => {
    const v = new Vehicle(scene, world, fx, type, color);
    v.place(x, z, yaw);
    v.keep = true;
    vehicles.push(v);
    return v;
  }, world.graph);
  // every station's lights, collected from the platforms, stalls and shelters above
  world.buildStationLamps();
  // On the Hooghly: launches working the ferry routes, country boats at the ghats
  const docks = buildGhats(world, scene);
  const launchCols = [0x1f4f8a, 0x2f8a4a, 0xc8382c, 0xd99a22];
  docks.forEach((d, i) => {
    const b = new Boat(scene, world, fx, 'launch', launchCols[i % launchCols.length]);
    let [x, z] = d.pts[0];
    const [nx, nz] = d.pts[1];
    // start clear of the jetty and the bank, a little way along the route
    const yaw = Math.atan2(nx - x, nz - z);
    for (let k = 0; k < 20 && b.def.offs.some((o) => b.collideShore(x + Math.sin(yaw) * o, z + Math.cos(yaw) * o, b.def.rad)); k++) {
      x += Math.sin(yaw) * 3;
      z += Math.cos(yaw) * 3;
    }
    b.place(x, z, yaw);
    // berths: where a launch ties up at each end, bow to the pontoon
    b.route = { pts: d.pts, i: 1, dir: 1, wait: 2 + i * 4, berths: d.ends.map((e) => ({ x: e.dock[0], z: e.dock[1], yaw: e.yaw + Math.PI })) };
    vehicles.push(b);
    // a couple of noukas and fishing trawlers tied up beside each jetty, speedboats at the main ghats
    for (const [k, end] of d.ends.entries()) {
      const kinds = k === 0 && i === 0 ? ['nouka', 'trawler', 'speedboat', 'jetski'] : k === 1 && i === 0 ? ['nouka', 'trawler'] : i === 1 ? ['nouka', 'trawler'] : ['nouka'];
      kinds.forEach((type, j) => {
        const side = j % 2 ? -1 : 1;
        const along = 10 + j * 9;
        const x = end.x + end.ux * along - end.uz * (9 + j * 3) * side;
        const z = end.z + end.uz * along + end.ux * (9 + j * 3) * side;
        if (!world.river || !inPoly(world.river, x, z) || nearestOnRing(world.river, x, z, {}).d < 4) return;
        const boatCol = type === 'trawler' ? [0x2d5a44, 0xc85a2b, 0x1f4f8a][j % 3] : [0xc9a43a, 0xff3fa4, 0x38f3ff][j % 3];
        const boat = new Boat(scene, world, fx, type, boatCol);
        boat.place(x, z, end.yaw);
        vehicles.push(boat);
      });
    }
  });
  riverTraffic = new RiverTraffic(scene, world);
  setLoading(0.75, 'Waking up the locals');
  await frame();
  player = new Player(scene, world, game);
  // On Howrah Station's forecourt, facing the river and the bridge
  player.spawn(world.spawn.x, world.spawn.z, station.frameA !== undefined ? Math.atan2(Math.cos(station.frameA), Math.sin(station.frameA)) : 0);
  if (import.meta.env.DEV) window.__kol = { get wardrobe() { return wardrobe; }, get weather() { return weather; }, get jobs() { return jobs; }, get progress() { return progress; }, get boards() { return boards; }, THREE, voices, hud, get post() { return post; }, get peds() { return peds; }, get gameplay() { return gameplay; }, get mapViewRef() { return mapView; }, get rides() { return rides; }, get mapView() { return mapView; }, renderer, scene, camera, world, rail, metro, station, vehicles, game, cam, day, get player() { return player; }, get traffic() { return traffic; } };
  peds = new Peds(scene, world, hud, audio, preset.peds);
  peds.spawnAll(player.pos);
  gameplay = new Gameplay(scene, world, hud, audio);
  wardrobe = new WardrobeManager(scene, world, hud, audio, game);
  wardrobe.buildStalls();
  wardrobe.initUI(player, gameplay);
  newspaper = new Newspaper(game);
  newspaper.initUI();
  festive = new FestiveManager(game, scene, world);
  festive.init();
  refreshFestiveButtons();
  progress = new Progress(hud, audio);
  jobs = new TaxiJobs(game, scene, world, progress);
  combat = new Combat(scene, world, fx, audio, game);
  hooks.explode = (x, y, z, size, v) => combat.explode(x, y, z, size, v);
  hooks.burning = (v) => {
    if (v === player.vehicle && player.driving) hud.notify('ON FIRE!', 'Press F to get out', '#ff5f6d');
  };
  post = createPost(renderer, scene, camera);
  applyQuality(quality);
  hideFromReflections();
  setLoading(0.9, 'Compiling shaders');
  await frame();
  day.update(0, player.pos, camera.position);
  day.bakeEnv(day.sunDir.y);
  updateCamera(0);
  renderer.compile(scene, camera);
  setLoading(1, 'Ready');
  hud.ready();
  hud.setWeaponIcons(weaponIcons());
  // Railways, trams and metro lines on the map
  {
    const r = rail.mapLayers();
    const pts = (t) => t.x.filter((_, i) => i % 10 === 0).map((x, i) => [x, t.z[i * 10]]);
    for (const l of metro.lines) r.lines.push({ pts: pts(l.track), color: l.color, width: 4, dash: [7, 5] });
    for (const st of metro.stations) r.stations.push({ x: st.x, z: st.z, color: st.color, label: 'M' });
    // every gate down from the street, numbered
    for (const e of metro.entrances) if (e.x !== metro.stations.find((st) => st.name === e.name && st.line === e.line)?.x) r.stations.push({ x: e.x, z: e.z, color: e.color, label: 'M', name: e.gate ? `Gate ${e.gate}` : e.name, small: true });
    for (const t of rail.tramStops) r.stations.push({ x: t.x, z: t.z, color: '#3f86d8', label: 'T', name: t.name, small: true });
    hud.drawTransit(r.lines, r.stations);
  }
  mapView = new MapView(hud);
  mapView.game = game;
  mapView.onWaypoint = setWaypoint;
  mapView.onFastTravel = (target) => {
    if (gameplay.money < 20) {
      hud.notify('INSUFFICIENT FARE', 'Metro & Ferry fast-travel costs ₹20', '#ff5f6d');
      audio.beep(false);
      return;
    }
    gameplay.addMoney(-20, target.kind === 'metro' ? 'Metro fast-travel' : 'Ferry fast-travel');
    if (target.kind === 'metro') {
      audio.metroChime(0);
    } else {
      audio.honk(0, 'boat');
    }
    setMap(false);
    hud.fadeTransition(0.8, () => {
      if (player.mode === 'driving' && player.vehicle) {
        player.vehicle.setDriven(false);
        player.vehicle.locked = false;
        player.vehicle = null;
      }
      player.mode = 'foot';
      const gy = world.height(target.x, target.z);
      player.pos.set(target.x, gy + 0.1, target.z);
      player.yaw = 0;
      player.vy = 0;
      player.ch.mode = 'move';
      player.ch.mesh.position.copy(player.pos);
      player.ch.mesh.rotation.set(0, 0, 0);
      updateCamera(0);
      hud.notify(
        target.kind === 'metro' ? `🚇 METRO: ${target.name.toUpperCase()}` : `⛴️ FERRY: ${target.name.toUpperCase()}`,
        'Fast-travelled for ₹20 · Arrived safely',
        '#5dff9e'
      );
      if (progress) {
        progress.event(target.kind === 'metro' ? 'metro' : 'ferry');
        progress.event('fastTravel');
      }
    });
  };
  mapView.addPlaces([
    ...metro.stations.map((st) => ({ n: `${st.name} Metro (${st.line})`, x: st.x, z: st.z, k: 'metro', tier: 1 })),
    ...metro.entrances.filter((e) => e.gate).map((e) => ({ n: `${e.name} Metro Gate ${e.gate}`, x: e.x, z: e.z, k: 'metro', tier: 3 })),
    ...rail.tramStops.map((t) => ({ n: `${t.name} Tram Stop`, x: t.x, z: t.z, k: 'tram', tier: 3 })),
    { n: 'New Market Heritage Clothiers (Wardrobe)', x: -582, z: 672, k: 'shop', tier: 2 },
    { n: 'College Street Khadi & Sports Tailors (Wardrobe)', x: 528, z: -1078, k: 'shop', tier: 2 },
  ]);
  input.onWheel = (open, vec, kind) => {
    const can = state === 'play' && player.mode === 'foot' && !player.dead;
    if (kind === 'weapon') {
      const sel = hud.weaponWheel(open && can, vec, player.arsenal);
      if (!open) hud.closeWeaponWheel();
      return can ? sel : null;
    }
    return hud.wheel(open && can, vec);
  };
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
  splash.done();
}

/** Low quality draws straight to the screen (the renderer still tone-maps); the rest go through the post chain. */
function render(dt) {
  if (preset.noPost) renderer.render(scene, camera);
  else post.composer.render(dt);
}

let reflectFrame = 0;
/** Characters, traffic and particles are skipped in the ocean's reflection pass for speed. */
function hideFromReflections() {
  const water = world.water;
  const orig = water.onBeforeRender;
  water.onBeforeRender = (...args) => {
    // Ultra's AO pass re-renders the scene with an override material: refreshing the mirror
    // then would fill it with normals and make it flicker against the real reflection
    if (scene.overrideMaterial) return;
    const hidden = [];
    const hide = (o) => {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    };
    for (const n of peds.list) hide(n.ch.mesh);
    for (const c of traffic.cars) hide(c.mesh.root);
    for (const cs of rail.consists) for (const c of cs.cars) hide(c.root);
    hide(combat.tracers.lines);
    hide(day.flareAnchor);
    hide(fx.smokeP.points);
    hide(weather.rain);
    hide(headlights);
    // The river mirror re-renders the scene: only near the river, above ground, and every third frame
    reflectFrame = (reflectFrame + 1) % (preset.reflectEvery || 3);
    const c = camera.position;
    const nearRiver = c.y > -2 && riverDist < 500;
    if (reflectFrame !== 0 || !nearRiver) {
      for (const o of hidden) o.visible = true;
      return;
    }
    for (const m of world.reflectSkip) hide(m);
    orig(...args);
    for (const o of hidden) o.visible = true;
  };
}

function startGame() {
  if (state !== 'title') return;
  audio.init();
  state = 'play';
  hud.start();
  input.lock();
  guardHistory();
  cam.yaw = player.yaw;
  setTimeout(() => hud.notify('WELCOME TO VIBE CITY KOLKATA', 'Howrah Station · walk up to any vehicle and press F', '#ff3fa4'), 900);
  setTimeout(() => hud.notify('CITY OF JOY', 'Buy a ticket (E) before the platforms · M for the map', '#ffd36b'), 4600);
}
document.getElementById('play').addEventListener('click', startGame);
renderer.domElement.addEventListener('click', () => {
  if (state === 'play') input.lock();
});
document.getElementById('pause').addEventListener('click', () => setPaused(false));
// the GitHub link opens in a new tab; don't let the click also resume the game
document.querySelectorAll('.gh-link').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));

/* ---------- Back button: ask before leaving the city ---------- */
// startGame() adds a history entry (it needs the click or key press to count), so the
// browser's Back first lands back on this page and we ask; only LEAVE really goes back.
const leaveEl = document.getElementById('leave');
let leaveOpen = false;
let leaving = false;
let leaveFrom = 'play';
function guardHistory() {
  if (!history.state || !history.state.kol) history.pushState({ kol: true }, '');
}
function showLeave(open) {
  leaveOpen = open;
  leaveEl.classList.toggle('hidden', !open);
}
window.addEventListener('popstate', () => {
  if (leaving || leaveOpen || state === 'loading' || state === 'title') return;
  leaveFrom = state;
  if (document.pointerLockElement) document.exitPointerLock();
  setPaused(true);
  showLeave(true);
  document.getElementById('leave-stay').focus();
});
function stay() {
  showLeave(false);
  guardHistory();
  // back to how it was: playing again, or still paused / on the map
  if (leaveFrom === 'play') setPaused(false);
}
document.getElementById('leave-stay').addEventListener('click', stay);
document.getElementById('leave-go').addEventListener('click', () => {
  leaving = true;
  history.back();
  // nothing to go back to (the game was the first page in this tab): stay, paused
  setTimeout(() => {
    leaving = false;
    showLeave(false);
    guardHistory();
  }, 700);
});
window.addEventListener('keydown', (e) => {
  if (leaveOpen && e.code === 'Escape') stay();
});
// Reload or close mid-game: the browser's own "Leave site?" prompt
window.addEventListener('beforeunload', (e) => {
  if (leaving || state === 'loading' || state === 'title') return;
  e.preventDefault();
  e.returnValue = '';
});
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && wasLocked && state === 'play' && !(rides && rides.selection)) setPaused(true);
  wasLocked = locked;
});
/** Which way the player's vehicle is going: riding, the way it's travelling (the camera's); else its nose. */
function vehicleHeading(v) {
  return player.passenger && cam.rideV === v && cam.rideYaw != null ? cam.rideYaw : v.yaw;
}

/* ---------- Map, waypoint and GPS route ---------- */
let waypoint = null;
let route = null;
let routeT = 0;
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(1.4, 1.4, 160, 16, 1, true).translate(0, 80, 0),
  new THREE.MeshBasicMaterial({ map: T.beam(), color: new THREE.Color(3, 0.4, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
);
beacon.visible = false;
scene.add(beacon);
let pickCb = null;
function setWaypoint(p, quiet = false) {
  // Choosing where a hired taxi, auto or rickshaw should go
  if (pickCb && !quiet) {
    const cb = pickCb;
    pickCb = null;
    mapView.setPick(null);
    setMap(false);
    cb(p);
    return;
  }
  waypoint = p;
  if (p && !quiet && !inTiles(p.x, p.z, 30)) hud.notify('OUTSIDE THE PLAYABLE MAP', 'The arrow points the way · export that area to play there', '#ffd36b');
  route = null;
  routeT = 0;
  beacon.visible = !!p;
  if (p) {
    beacon.position.set(p.x, world.height(p.x, p.z), p.z);
    audio.beep(true);
  }
}
function updateRoute(dt) {
  if (!waypoint) {
    hud.route = null;
    hud.waypoint(null);
    return;
  }
  const f = player.focus;
  // riding: the line follows the way the bus or driver is actually going, with the time it'll take
  const ride = rides.remaining();
  if (ride) {
    route = ride.pts;
    hud.route = route;
    hud.waypoint(ride.left, ride.eta, rides.ride.kind === 'bus' && rides.ride.final ? 'LAST STOP' : '');
    return;
  }
  // a taxi job's waypoint stays until the job moves on
  if (!waypoint.job && Math.hypot(f.x - waypoint.x, f.z - waypoint.z) < 12) {
    hud.notify('ARRIVED', 'Waypoint reached', '#ff3fa4');
    setWaypoint(null);
    hud.route = null;
    hud.waypoint(null);
    return;
  }
  routeT -= dt;
  if (!route || routeT <= 0) {
    route = world.graph.route(f.x, f.z, waypoint.x, waypoint.z);
    routeT = 0.5;
  }
  route[0] = [f.x, f.z];
  hud.route = route;
  hud.waypoint(routeLength(route));
}
let mapPois = [];
function setMap(open) {
  if (open && state !== 'play') return;
  if (!open && state !== 'map') return;
  state = open ? 'map' : 'play';
  if (!open && pickCb) {
    // closed without choosing: the ride is off
    const cb = pickCb;
    pickCb = null;
    mapView.setPick(null);
    setTimeout(() => cb(null), 0);
  }
  mapView.show(open, player.focus);
  // at a station or a market, open close in so its stalls and shops can be told apart
  mapPois = open ? localPois() : [];
  if (open && mapPois.some((p) => Math.hypot(p.x - player.focus.x, p.z - player.focus.z) < 150)) mapView.scale = Math.max(mapView.scale, 2.4);
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    if (audio.ctx) audio.ctx.suspend();
  } else {
    input.scroll = 0;
    input.keys.clear();
    if (audio.ctx) audio.ctx.resume();
    input.lock();
  }
}

function setPaused(p) {
  if (p && state !== 'play') return;
  if (!p && state !== 'pause') return;
  state = p ? 'pause' : 'play';
  if (p) {
    document.querySelector('#pause .progress-panel').innerHTML = progress.html();
    refreshFestiveButtons();
  }
  hud.setPaused(p);
  if (audio.ctx) p ? audio.ctx.suspend() : audio.ctx.resume();
  if (!p) input.lock();
}

function setWardrobe(open) {
  if (open && state !== 'play' && state !== 'pause') return;
  if (!open && state !== 'wardrobe') return;
  if (open && state === 'pause') {
    setPaused(false);
  }
  state = open ? 'wardrobe' : 'play';
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    if (audio.ctx) audio.ctx.suspend();
    if (wardrobe && !wardrobe.active) wardrobe.open();
  } else {
    input.keys.clear();
    input.scroll = 0;
    if (audio.ctx) audio.ctx.resume();
    if (wardrobe && wardrobe.active) wardrobe.close();
    input.lock();
  }
}

function setNewspaper(open) {
  if (open && state !== 'play' && state !== 'pause') return;
  if (!open && state !== 'newspaper') return;
  if (open && state === 'pause') {
    setPaused(false);
  }
  state = open ? 'newspaper' : 'play';
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    if (audio.ctx) audio.ctx.suspend();
    if (newspaper && !newspaper.active) newspaper.open();
  } else {
    input.keys.clear();
    input.scroll = 0;
    if (audio.ctx) audio.ctx.resume();
    if (newspaper && newspaper.active) newspaper.close();
    input.lock();
  }
}

/* ---------- Photo Mode ---------- */
const photoCam = {
  yaw: 0,
  pitch: 0.15,
  dist: 5,
  height: 1.4,
  fov: 60,
  filter: 'none',
  grid: false,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function setPhoto(open) {
  if (open && state !== 'play') return;
  if (!open && state !== 'photo') return;
  state = open ? 'photo' : 'play';
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    photoCam.yaw = cam.yaw;
    photoCam.pitch = 0.15;
    photoCam.dist = player.driving ? 7 : 4.5;
    photoCam.height = 1.4;
    photoCam.fov = 60;
    photoCam.filter = 'none';
    photoCam.grid = false;
    const fovEl = document.getElementById('photo-fov');
    if (fovEl) fovEl.value = 60;
    const fovVal = document.getElementById('photo-fov-val');
    if (fovVal) fovVal.textContent = '60°';
    const hEl = document.getElementById('photo-height');
    if (hEl) hEl.value = 1.4;
    const hVal = document.getElementById('photo-height-val');
    if (hVal) hVal.textContent = '1.4m';
    const distEl = document.getElementById('photo-dist');
    if (distEl) distEl.value = photoCam.dist;
    const distVal = document.getElementById('photo-dist-val');
    if (distVal) distVal.textContent = `${photoCam.dist}m`;
    document.getElementById('photo-grid')?.classList.add('hidden');
    document.querySelectorAll('.photo-filters button').forEach((b) => b.classList.toggle('active', b.dataset.filter === 'none'));
    if (audio.ctx) audio.ctx.suspend();
  } else {
    input.keys.clear();
    input.scroll = 0;
    if (audio.ctx) audio.ctx.resume();
    input.lock();
  }
  hud.setPhoto(open);
}

function updatePhotoCamera(dt) {
  const p = player;
  const focus = p.focus;
  const cp = Math.cos(photoCam.pitch);
  const cx = focus.x - Math.sin(photoCam.yaw) * cp * photoCam.dist;
  const cz = focus.z - Math.cos(photoCam.yaw) * cp * photoCam.dist;
  const cy = focus.y + photoCam.height + Math.sin(photoCam.pitch) * photoCam.dist;
  const minGround = world.groundAt(cx, cz, focus.y) + 0.3;
  camera.position.set(cx, Math.max(cy, minGround), cz);
  camera.lookAt(focus.x, focus.y + photoCam.height * 0.7, focus.z);
  camera.fov = photoCam.fov;
  camera.updateProjectionMatrix();
}

function capturePhoto() {
  if (state !== 'photo') return;
  audio.shutter();

  const topEl = document.querySelector('.photo-top');
  const ctrlEl = document.querySelector('.photo-controls');
  if (topEl) topEl.style.visibility = 'hidden';
  if (ctrlEl) ctrlEl.style.visibility = 'hidden';
  const grid = document.getElementById('photo-grid');
  const wasGrid = grid && !grid.classList.contains('hidden');
  if (grid) grid.classList.add('hidden');

  renderer.shadowMap.needsUpdate = true;
  if (post && post.composer) post.composer.render(0);
  else renderer.render(scene, camera);

  try {
    const srcCanvas = renderer.domElement;
    const off = document.createElement('canvas');
    off.width = srcCanvas.width;
    off.height = srcCanvas.height;
    const ctx = off.getContext('2d');

    if (photoCam.filter === 'vintage') {
      ctx.filter = 'sepia(0.6) contrast(1.15) brightness(1.05) saturate(1.1)';
    } else if (photoCam.filter === 'monsoon') {
      ctx.filter = 'contrast(1.2) hue-rotate(165deg) saturate(0.85)';
    } else if (photoCam.filter === 'amber') {
      ctx.filter = 'sepia(0.3) saturate(1.7) contrast(1.12) brightness(1.04)';
    } else if (photoCam.filter === 'noir') {
      ctx.filter = 'grayscale(1) contrast(1.35) brightness(0.95)';
    } else {
      ctx.filter = 'none';
    }

    ctx.drawImage(srcCanvas, 0, 0);

    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 24px "Bebas Neue", "Rajdhani", sans-serif';
    ctx.fillText('VIBE CITY KOLKATA', 32, off.height - 32);

    const link = document.createElement('a');
    const d = new Date();
    const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    link.download = `VibeCity_Kolkata_${ts}.png`;
    link.href = off.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Failed to capture photo:', err);
  }

  if (topEl) topEl.style.visibility = '';
  if (ctrlEl) ctrlEl.style.visibility = '';
  if (wasGrid && grid) grid.classList.remove('hidden');

  const flash = document.getElementById('shutter-flash');
  if (flash) {
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 250);
  }

  progress.photoTaken();
  hud.notify('📸 PHOTO CAPTURED', 'Saved to your Downloads', '#5dff9e');
}

// Photo mode listeners
document.getElementById('btn-photo')?.addEventListener('click', () => setPhoto(true));
document.getElementById('photo-exit')?.addEventListener('click', () => setPhoto(false));
document.getElementById('photo-fov')?.addEventListener('input', (e) => {
  photoCam.fov = parseFloat(e.target.value);
  const val = document.getElementById('photo-fov-val');
  if (val) val.textContent = `${Math.round(photoCam.fov)}°`;
});
document.getElementById('photo-height')?.addEventListener('input', (e) => {
  photoCam.height = parseFloat(e.target.value);
  const val = document.getElementById('photo-height-val');
  if (val) val.textContent = `${photoCam.height.toFixed(1)}m`;
});
document.getElementById('photo-dist')?.addEventListener('input', (e) => {
  photoCam.dist = parseFloat(e.target.value);
  const val = document.getElementById('photo-dist-val');
  if (val) val.textContent = `${photoCam.dist.toFixed(1)}m`;
});
document.querySelectorAll('.photo-filters button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.photo-filters button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    photoCam.filter = b.dataset.filter;
  });
});
document.getElementById('photo-grid-btn')?.addEventListener('click', () => {
  photoCam.grid = !photoCam.grid;
  document.getElementById('photo-grid')?.classList.toggle('hidden', !photoCam.grid);
});
document.getElementById('photo-snap')?.addEventListener('click', capturePhoto);

const photoEl = document.getElementById('photo-mode');
photoEl?.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.photo-controls') || e.target.closest('.photo-top')) return;
  photoCam.dragging = true;
  photoCam.lastX = e.clientX;
  photoCam.lastY = e.clientY;
  try { photoEl.setPointerCapture(e.pointerId); } catch {}
});
photoEl?.addEventListener('pointermove', (e) => {
  if (!photoCam.dragging) return;
  const dx = e.clientX - photoCam.lastX;
  const dy = e.clientY - photoCam.lastY;
  photoCam.lastX = e.clientX;
  photoCam.lastY = e.clientY;
  photoCam.yaw -= dx * 0.005;
  photoCam.pitch = clamp(photoCam.pitch + dy * 0.004, -0.6, 1.2);
});
photoEl?.addEventListener('pointerup', (e) => {
  photoCam.dragging = false;
  try { photoEl.releasePointerCapture(e.pointerId); } catch {}
});
photoEl?.addEventListener('wheel', (e) => {
  if (e.target.closest('.photo-controls')) return;
  photoCam.dist = clamp(photoCam.dist + e.deltaY * 0.015, 1.5, 30);
  const distSlider = document.getElementById('photo-dist');
  if (distSlider) {
    distSlider.value = photoCam.dist;
    const val = document.getElementById('photo-dist-val');
    if (val) val.textContent = `${photoCam.dist.toFixed(1)}m`;
  }
}, { passive: true });

/* ---------- Aim assist ---------- */
const _ad = new THREE.Vector3();
let aimTarget = false;
/** Light magnetism toward a person near the crosshair, and a red crosshair over one. */
function aimHelp(dt) {
  aimTarget = false;
  const p = player;
  if (p.mode !== 'foot' || p.dead || player.arsenal.def.kind !== 'gun') return;
  camera.getWorldDirection(_ad);
  const o = camera.position;
  const w = player.arsenal.def;
  let best = null;
  let bestA = p.scoped ? 0.012 : 0.05;
  for (const n of peds.list) {
    if (n.state === 'dead' || !n.ch.mesh.visible) continue;
    const tx = n.x - o.x;
    const ty = n.y + 1.25 - o.y;
    const tz = n.z - o.z;
    const d = Math.hypot(tx, ty, tz);
    if (d < 2 || d > w.range) continue;
    const a = Math.acos(Math.min(1, (tx * _ad.x + ty * _ad.y + tz * _ad.z) / d));
    if (a < bestA) {
      bestA = a;
      best = { n, tx, ty, tz, d };
    }
  }
  if (!best) return;
  const hit = combat.raycast(o, _ad, best.d + 2, { minT: 1 });
  aimTarget = hit.type === 'ped';
  if (!p.aiming) return;
  // Ease the view toward the target's chest; hostile people pull harder
  const hostile = best.n.state === 'shoot' || best.n.state === 'fight';
  const k = (hostile ? 4 : 2) * (p.scoped ? 0.4 : 1) * dt;
  const wantYaw = Math.atan2(best.tx, best.tz);
  const wantPitch = -Math.atan2(best.ty, Math.hypot(best.tx, best.tz));
  const curYaw = Math.atan2(_ad.x, _ad.z);
  cam.yaw += Math.atan2(Math.sin(wantYaw - curYaw), Math.cos(wantYaw - curYaw)) * k;
  cam.pitch += (wantPitch - Math.asin(-_ad.y)) * k;
}

/* ---------- Main loop ---------- */
let last = 0;
// Stalls, shops and benches round where you are: only this neighbourhood's, never the whole city
const LOCAL_R = 250;
function localPois() {
  const f = player.focus;
  const out = [];
  for (const sys of [station, wardrobe, adda]) {
    if (!sys || !sys.pois) continue;
    for (const p of sys.pois()) if (Math.abs(p.x - f.x) < LOCAL_R && Math.abs(p.z - f.z) < LOCAL_R) out.push({ ...p, r: 9, label: p.icon, poi: true });
  }
  return out;
}
const blipsFn = () => {
  const b = gameplay.blips();
  b.push(...jobs.blips());
  if (cricket) b.push(...cricket.blips());
  if (carrom) b.push(...carrom.blips());
  if (!player.underground) b.push(...localPois());
  if (waypoint) b.push({ x: waypoint.x, z: waypoint.z, color: '#ff3fa4', r: 9, always: true, label: '★' });
  return b;
};
const movingVehicles = [];
const obstacles = [];
const footObstacle = { pos: null, isPed: true };
const pedObstacles = [];
let nitroWas = false;
let underRiver = false;
let riverNear = 0;
let riverDist = 0;
let metroShown = true;
let metroInfoT = 0;
let wetness = 0;
let wxHudT = 0;
let greetT = 3;
let hornT = 6;
const vehicleSoundKind = (v) => (v.rail ? v.kind : v.boat ? 'boat' : v.type);
let hornWas = false;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  // Cap at ~60 fps: high-refresh displays would otherwise double CPU/GPU work
  if (now - last < (state === 'title' ? 32 : 15.5)) return;
  let dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  frameNo++;
  // Dev only: a free camera for looking at the city from anywhere
  if (import.meta.env.DEV && window.__kol && window.__kol.freeCam) {
    const c = window.__kol.freeCam;
    camera.position.set(...c.p);
    camera.lookAt(...c.t);
    camera.fov = c.fov || 60;
    camera.updateProjectionMatrix();
    elapsed += dt;
    day.update(dt, { x: c.t[0], y: 0, z: c.t[2] }, camera.position);
    world.update(dt, elapsed, day.night, day.sunDir, camera.position);
    renderer.shadowMap.needsUpdate = true;
    post.composer.render(dt);
    return;
  }

  if (state === 'title' && input.hit('Enter')) startGame();
  if (!leaveOpen && !(rides && rides.selection) && (state === 'play' || state === 'pause') && input.hit('Escape')) {
    if (!input.locked || state === 'pause') setPaused(state === 'play');
  }
  if (!leaveOpen && state === 'play' && input.hit('KeyP')) {
    setPhoto(true);
  } else if (!leaveOpen && state === 'photo' && (input.hit('KeyP') || input.hit('Escape'))) {
    setPhoto(false);
  }
  if (state === 'photo' && input.hit('Space')) {
    capturePhoto();
  }
  if (!leaveOpen && state === 'play' && input.hit('KeyO')) {
    setWardrobe(true);
  } else if (!leaveOpen && state === 'wardrobe' && (input.hit('KeyO') || input.hit('Escape'))) {
    setWardrobe(false);
  }
  if (!leaveOpen && state === 'newspaper' && input.hit('Escape')) {
    setNewspaper(false);
  }
  if ((state === 'play' && input.hit('KeyM')) || (state === 'map' && (input.hit('KeyM') || input.hit('Escape')))) setMap(state === 'play');
  if (state === 'map') {
    if (waypoint && !route) route = world.graph.route(player.focus.x, player.focus.z, waypoint.x, waypoint.z);
    mapView.draw(player, [...gameplay.blips(), ...(cricket ? cricket.blips() : []), ...(carrom ? carrom.blips() : []), ...(player.underground ? [] : mapPois)], waypoint, route, player.vehicle && player.mode !== 'foot' ? vehicleHeading(player.vehicle) : player.yaw);
    input.endFrame();
    return;
  }
  if (state === 'wardrobe') {
    if (post && post.composer) post.composer.render(0);
    else renderer.render(scene, camera);
    input.endFrame();
    return;
  }
  if (state === 'newspaper') {
    if (post && post.composer) post.composer.render(0);
    else renderer.render(scene, camera);
    input.endFrame();
    return;
  }
  if (state === 'pause') {
    input.endFrame();
    return;
  }
  if (state === 'photo') {
    updatePhotoCamera(dt);
    renderer.shadowMap.needsUpdate = true;
    if (post && post.composer) post.composer.render(0);
    else renderer.render(scene, camera);
    input.endFrame();
    return;
  }
  const inp = input.poll();
  // Time slows while the weapon wheel is open
  if (state === 'play' && input.wheelOpen && input.wheelKind === 'weapon' && player.mode === 'foot') dt *= 0.25;
  elapsed += dt;
  game.night = day.night;

  if (state === 'play') {
    if (input.hit('KeyC')) cam.mode = (cam.mode + 1) % (player.driving ? 3 : 2);
    if (input.hit('KeyN')) {
      audio.setMuted(!audio.muted);
      voices.muted = audio.muted;
      hud.notify(audio.muted ? 'SOUND OFF' : 'SOUND ON', 'N to toggle', '#b45bff');
      refreshSoundButtons();
    }
    if (input.hit('KeyQ')) {
      const on = audio.toggleRadio();
      if (on) {
        const st = audio.currentStation;
        hud.notify(`📻 ${st.name.toUpperCase()} · ${st.dial}`, st.desc, st.color);
      } else {
        hud.notify('📻 RADIO OFF', '[ or ] to tune in', '#b45bff');
      }
      refreshSoundButtons();
    }
    if (input.hit('BracketRight')) {
      const st = audio.nextStation();
      hud.notify(`📻 ${st.name.toUpperCase()} · ${st.dial}`, st.desc, st.color);
      refreshSoundButtons();
    }
    if (input.hit('BracketLeft')) {
      const st = audio.prevStation();
      hud.notify(`📻 ${st.name.toUpperCase()} · ${st.dial}`, st.desc, st.color);
      refreshSoundButtons();
    }
    if (input.hit('KeyR') && player.mode === 'driving' && !player.vehicle.rail) resetToRoad(player.vehicle);
    const wasDriving = player.driving;
    game.camYaw = cam.yaw;
    player.update(dt, elapsed, inp, input, cam.yaw);
    jobs.update(dt, elapsed, input);
    progress.update(dt, player.focus);
    aimHelp(dt);
    if (player.driving && !wasDriving && cam.mode > 2) cam.mode = 0;
    if (!player.driving && cam.mode > 1) cam.mode = 0;
    // Horn scares nearby people
    const horn = player.mode === 'driving' && inp.horn;
    audio.horn(horn, player.driving ? vehicleSoundKind(player.vehicle) : null);
    if (horn && !hornWas) {
      const v = player.vehicle;
      for (const n of peds.list) {
        const d = Math.hypot(n.x - v.pos.x, n.z - v.pos.z);
        if (d < 12 && n.state !== 'down' && Math.random() < 0.6) {
          n.ch.play('cower');
          if (Math.random() < 0.5) peds.say(n, LINES.honk[Math.floor(Math.random() * LINES.honk.length)], 1.8);
        }
      }
    }
    hornWas = horn;
    // Now and then someone you pass says hello
    greetT -= dt;
    if (greetT <= 0 && player.mode === 'foot' && !player.underground) {
      greetT = 1;
      const n = peds.nearest(player.pos.x, player.pos.z, 4, (q) => q.state === 'walk');
      if (n && Math.random() < 0.3) {
        peds.face(n, player.pos.x, player.pos.z);
        peds.say(n, LINES.greet[Math.floor(Math.random() * LINES.greet.length)], 2);
        greetT = 6;
      }
    }
    if (player.driving) {
      if (player.vehicle.nitroOn && !nitroWas) audio.whoosh();
      nitroWas = player.vehicle.nitroOn;
    }
  }

  // Free vehicles (parked / knocked loose)
  for (const v of vehicles) {
    if (v === player.vehicle && (player.mode === 'driving' || player.mode === 'exiting')) continue;
    v.update(dt, null, day.night);
  }
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      if (a.asleep && b.asleep) continue;
      if (!!a.boat !== !!b.boat) continue;
      const hit = collideVehicles(a, b);
      if (hit > 3 && (a === player.vehicle || b === player.vehicle)) a.impact = b.impact = Math.max(a.impact, hit);
    }
  }
  const focus = player.focus;
  rail.update(dt, day.night, { player, peds, vehicles, traffic, game, audio });
  obstacles.length = 0;
  for (const v of vehicles) obstacles.push(v);
  for (const o of rail.obstacles()) obstacles.push(o);
  if (player.mode === 'foot') {
    footObstacle.pos = player.pos;
    obstacles.push(footObstacle);
  }
  let pi = 0;
  for (const n of peds.list) {
    if (n.state !== 'down' && n.state !== 'flee') continue;
    const o = pedObstacles[pi] || (pedObstacles[pi] = { pos: { x: 0, z: 0 }, isPed: true });
    o.pos.x = n.x;
    o.pos.z = n.z;
    obstacles.push(o);
    pi++;
  }
  traffic.update(dt, focus, obstacles, camera.position);
  movingVehicles.length = 0;
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];
    // boats and road traffic never touch (launches dock right beside the riverside roads)
    if ((!v.asleep || v.driven) && !v.boat) traffic.collideVehicle(v, focus);
    if (!v.asleep && v.speed > 3) movingVehicles.push(v);
    setCarLOD(v.car, Math.hypot(v.pos.x - camera.position.x, v.pos.z - camera.position.z));
  }

  const pv = player.driving ? player.vehicle : null;
  if (pv && pv.impact > 3) {
    cam.shake = Math.min(0.6, cam.shake + pv.impact * 0.03);
    audio.impact(pv.impact);
  }
  peds.update(dt, elapsed, {
    focus,
    foot: player.mode === 'foot' && !player.underground ? player.pos : null,
    vehicles: movingVehicles,
    camPos: camera.position,
    frame: frameNo,
    player,
    combat,
  });
  if (state === 'play') gameplay.update(dt, elapsed, player);

  fx.update(dt);
  combat.update(dt);
  if (state === 'play') updateRoute(dt);
  beacon.material.opacity = 0.5 + Math.sin(elapsed * 3) * 0.15;
  fx.smokeP.mat.uniforms.uColor.value.setScalar(lerp(0.85, 0.12, day.night));
  // Kolkata's weather right now: rain, cloud, haze, thunder; roads stay wet a while after
  day.flash = weather.update(dt, elapsed, camera, { underground: camera.position.y < -2, quality: preset.rain || 0.8, audio });
  day.wx = weather.now;
  wetness += ((weather.now.rain > 0.12 ? 1 : 0) - wetness) * (1 - Math.exp(-dt / (weather.now.rain > 0.12 ? 40 : 300)));
  world.setWet(wetness);
  wxHudT -= dt;
  if (wxHudT <= 0) {
    wxHudT = 1;
    const w = weather.summary;
    const el = document.getElementById('wx');
    const txt = weather.mode === 'live' && w.text ? `${w.icon} ${w.text}` : '';
    if (el.textContent !== txt) el.textContent = txt;
  }
  if (adda) adda.ambient(dt, elapsed, player.focus, player.underground);
  const dayDt = adda && adda.active ? dt * 12 : dt;
  day.update(dayDt, focus, camera.position);
  world.update(dt, elapsed, day.night, day.sunDir, camera.position);
  if (festive) festive.update(dt, player.pos, day.night);
  metro.update(day.night, dt);
  boards.update(dt, camera, day.time);
  // Distance culling: rail cars and parked vehicles past the haze aren't drawn;
  // the underground metro only when you're down there or at an entrance
  if (frameNo % 10 === 0) {
    const c = camera.position;
    let nearPortal = c.y < -1.5;
    if (!nearPortal) for (const st of metro.stations) if (Math.abs(st.x - c.x) < 150 && Math.abs(st.z - c.z) < 150) nearPortal = true;
    if (nearPortal !== metroShown) {
      metroShown = nearPortal;
      for (const m of metro.statics) if (!m.userData.surface) m.visible = nearPortal;
    }
    for (const cs of rail.consists) {
      for (const car of cs.cars) car.root.visible = cs.K.under ? nearPortal && Math.hypot(car.x - c.x, car.z - c.z) < 400 : Math.hypot(car.x - c.x, car.z - c.z) < 650;
    }
    for (const v of vehicles) if (v !== player.vehicle && !v.boat) v.car.root.visible = Math.hypot(v.pos.x - c.x, v.pos.z - c.z) < 450;
  }
  // Standing on a Metro platform: when the next trains come in
  metroInfoT -= dt;
  if (metroInfoT <= 0) {
    metroInfoT = 0.5;
    const el = document.getElementById('metroinfo');
    const pf = state === 'play' && player.mode === 'foot' && player.underground ? metro.platformAt(player.pos.x, player.pos.y, player.pos.z) : null;
    el.classList.toggle('hidden', !pf);
    if (pf) {
      const L = pf.lineRef;
      const fmt = (r) => (r.here ? '<span class="soon">ON PLATFORM</span>' : r.t < 45 ? '<span class="soon">ARRIVING</span>' : `${Math.floor(r.t / 60)}:${String(Math.round(r.t) % 60).padStart(2, '0')}`);
      const next = pf.terminus ? [] : metro.nextTrains(pf);
      el.style.setProperty('--line', pf.color);
      el.innerHTML = pf.terminus
        ? `<b>${pf.o.name.toUpperCase()} · PLATFORM ${pf.no}</b> · Terminus: trains leave from platform ${pf.no === 1 ? 2 : 1}`
        : `<b>PLATFORM ${pf.no} · TOWARDS ${(L.dest && L.dest[pf.bound]) || ''}</b> · Next ${next[0] ? fmt(next[0]) : '—'} · then ${next[1] ? fmt(next[1]) : '—'}`;
    }
  }
  // India's first underwater metro: tell the player when they pass beneath the Hooghly
  {
    const f = player.focus;
    const under = f.y < -5 && metro.underRiver(f.x, f.z);
    if (under && !underRiver && state === 'play') {
      hud.notify('UNDER THE HOOGHLY', "India's first underwater metro · 30 m below the river", '#2fbf5a');
      if (player.mode !== 'foot') progress.event('underRiver');
    }
    underRiver = under;
  }
  riverTraffic.update(dt, elapsed);
  station.update(dt, elapsed, { player, camPos: camera.position, audio });
  setTrafficLights(day.night);
  setInteriorNight(day.night);
  for (const s of spots) s.intensity = day.night * 260;
  beamMat.uniforms.uIntensity.value = day.night * 0.35;
  updateInterior(dt);
  updateCamera(dt);
  hud.prompt(state === 'play' ? player.prompt : null);
  {
    const ars = player.arsenal;
    const w = ars.def;
    const clip = ars.clip;
    const onFoot = player.mode === 'foot' && !player.dead && state === 'play';
    hud.combat({
      name: w.name.toUpperCase(),
      gun: w.kind === 'gun',
      mag: clip ? clip.mag : 0,
      reserve: clip ? clip.reserve : 0,
      reloading: ars.reloadT > 0,
      cross: onFoot && w.kind === 'gun' && !player.scoped,
      dot: !(player.aiming || player.combatT > 0),
      target: aimTarget,
      aiming: player.aiming,
      scoped: onFoot && player.scoped,
      spread: (player.aiming ? w.aim : w.spread) || 0,
      hp: player.hp,
      dead: player.dead,
    });
  }
  const mm = pv ? { pos: pv.pos, yaw: vehicleHeading(pv), speed: pv.speed } : { pos: player.pos, yaw: cam.yaw, speed: player.speed };
  hud.update(dt, mm, day.hours, blipsFn, pv, camera);
  audio.update({
    rpm: pv ? pv.rpm : 0.2,
    throttle: pv && state === 'play' ? inp.throttle : 0,
    speed: pv ? pv.speed : 0,
    skid: pv ? pv.skid : 0,
    nitro: pv ? pv.nitroOn : false,
    engineOn: !!pv,
    pitch: pv && pv.def.engine ? pv.def.engine : 1,
    kind: pv ? vehicleSoundKind(pv) : null,
  });
  // The city around you: traffic, people, the river
  {
    const f = player.focus;
    let cars = 0;
    for (const c of traffic.cars) if (Math.abs(c.x - f.x) < 120 && Math.abs(c.z - f.z) < 120) cars++;
    let people = 0;
    for (const n of peds.list) if (n.state !== 'dead' && Math.abs(n.x - f.x) < 35 && Math.abs(n.z - f.z) < 35) people++;
    if (frameNo % 15 === 0) {
      const d = world.river ? nearestOnRing(world.river, f.x, f.z, {}).d : 999;
      riverNear = Math.max(0, 1 - d / 120);
      riverDist = d;
    }
    // Now and then a horn from a real vehicle nearby (never out of nowhere)
    hornT -= dt;
    if (hornT <= 0) {
      hornT = 4 + Math.random() * 8;
      const near = traffic.cars.filter((c) => c.mesh.root.visible && Math.hypot(c.x - f.x, c.z - f.z) < 90 && c.type !== 'rickshaw');
      if (near.length && f.y > -3) traffic.honk(near[Math.floor(Math.random() * near.length)]);
    }
    audio.ambient(dt, { traffic: cars, people, river: riverNear, night: day.night, underground: f.y < -3 });
  }

  // Post FX
  const g = post.grade.uniforms;
  const spd = pv ? pv.speed : 0;
  g.uTime.value = elapsed % 100;
  g.uNight.value = day.night;
  g.uBlur.value = pv && pv.nitroOn ? 1.6 : clamp((spd - 35) / 40, 0, 1) * 0.6;
  g.uAberration.value = 0.0012 + (pv && pv.nitroOn ? 0.004 : 0) + cam.shake * 0.01;
  // The midday sky is very bright in linear HDR: keep bloom for real light sources only
  const sunHigh = clamp(day.sunDir.y / 0.4, 0, 1);
  post.bloom.strength = lerp(lerp(0.4, 0.22, sunHigh), 0.6, day.night);
  post.bloom.threshold = lerp(lerp(1.0, 5.0, sunHigh), 0.85, day.night);

  // Shadows follow at half rate: nobody notices, the GPU does
  if (frameNo % 2 === 0) renderer.shadowMap.needsUpdate = true;
  render(dt);
  input.endFrame();
  adaptQuality(dt);
}

function resetToRoad(v) {
  if (v.boat) {
    // back out into open water
    const r = world.river;
    if (r) {
      const q = nearestOnRing(r, v.pos.x, v.pos.z, {});
      const inside = inPoly(r, v.pos.x, v.pos.z);
      const dx = (v.pos.x - q.x) / (q.d || 1);
      const dz = (v.pos.z - q.z) / (q.d || 1);
      const k = inside ? 20 : -20;
      v.place(q.x + dx * k, q.z + dz * k, v.yaw);
    }
    hud.notify('RESET', '', '#ffffff');
    return;
  }
  // nearest road, in the left-hand lane
  const n = world.graph.nearest(v.pos.x, v.pos.z, 500, (e) => !e.br);
  if (n) {
    const off = Math.min(n.e.w / 4, 3);
    v.place(n.x + n.tz * off, n.z - n.tx * off, Math.atan2(n.tx, n.tz));
  }
  hud.notify('RESET', '', '#ffffff');
}

boot().catch((e) => {
  console.error(e);
  document.querySelector('#loading .text').textContent = `Error: ${e.message}`;
  splash.error(`Error: ${e.message}`);
});
