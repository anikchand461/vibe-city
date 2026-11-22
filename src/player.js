import * as THREE from 'three';
import { Character, PLAYER_LOOK, playerMaterial } from './character.js';
import { LINES, conversation } from './lines.js';
import { TYPES } from './car.js';
import { Arsenal, SLOTS } from './weapons.js';
import { clamp, damp, dampAngle, lerp } from './utils.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
// Melee: when the blow lands (s), reach (m), damage and knockback
const MELEE = {
  jab: { at: 0.12, reach: 1.05, dmg: 16, push: 2.5 },
  cross: { at: 0.14, reach: 1.05, dmg: 22, push: 3 },
  kick: { at: 0.24, reach: 1.35, dmg: 38, push: 6 },
  swing: { at: 0.22, reach: 1.7, dmg: 48, push: 7 },
};
const COMBO = ['jab', 'cross', 'jab', 'kick'];
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

/** Distance from a point to the outside of a vehicle footprint (capsule). */
function edgeDist(px, pz, cx, cz, yaw, hl, hw) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const along = clamp((px - cx) * fx + (pz - cz) * fz, -(hl - hw), hl - hw);
  return Math.hypot(px - (cx + fx * along), pz - (cz + fz * along)) - hw;
}

/**
 * The player: an on-foot character who can fight, shoot and get into any vehicle.
 * mode: foot | entering | driving | exiting | riding (a passenger; see ride.js)
 */
export class Player {
  constructor(scene, world, game) {
    this.world = world;
    this.game = game; // { peds, traffic, vehicles, rail, hud, audio, combat, camera, adoptTrafficCar, gameplay }
    this.ch = new Character(scene, PLAYER_LOOK, playerMaterial());
    this.arsenal = new Arsenal(scene);
    this.pos = new THREE.Vector3();
    this.yaw = Math.PI;
    this.vy = 0;
    this.grounded = true;
    this.mode = 'foot';
    this.vehicle = null;
    this.anim = null;
    this.downT = 0;
    this.speed = 0;
    this.prompt = null;
    this.startDutyOnEnter = false;
    this.hp = 100;
    this.dead = false;
    this.deadT = 0;
    this.hurtT = 99;
    this.aiming = false;
    this.combatT = 0;
    this.melee = null;
    this.dryT = 0;
  }

  /** Ground height at a point for the layer the player is on (street or metro). */
  ground(x, z) {
    return this.world.groundAt(x, z, this.pos.y);
  }
  get underground() {
    return this.pos.y < -2.5;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.world.height(x, z), z);
    this.yaw = yaw;
  }

  /** The point the world should follow (camera, streaming, minimap). */
  get focus() {
    return this.vehicle && this.mode !== 'foot' ? this.vehicle.pos : this.pos;
  }
  /** In a vehicle, at the wheel or as a passenger (camera, HUD, sound follow it). */
  get driving() {
    return this.mode === 'driving' || this.mode === 'riding';
  }
  get passenger() {
    return this.mode === 'riding';
  }

  /** Sit in a vehicle as a passenger. */
  board(v) {
    this.vehicle = v;
    this.mode = 'riding';
    this.aiming = false;
    this.ch.stopEmote();
    this.ch.hold = null;
    this.arsenal.hideAll();
    this.ch.mode = 'sit';
    this.game.onEnterVehicle(v, true);
  }
  /** Step off onto the ground at (x, z). */
  unboard(x, z) {
    const v = this.vehicle;
    this.vehicle = null;
    this.mode = 'foot';
    this.ch.mode = 'move';
    this.vy = 0;
    this.pos.set(x, this.world.groundAt(x, z, this.pos.y - 0.5), z);
    if (v) this.yaw = v.yaw;
    this.ch.mesh.rotation.set(0, this.yaw, 0);
    this.game.onExitVehicle(v);
  }
  /** Keep the seated passenger at a world position. */
  seatAt(x, y, z, yaw, T, dt) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.ch.mode = 'sit';
    this.ch.speed = 0;
    this.ch.mesh.position.copy(this.pos);
    this.ch.mesh.rotation.set(0, yaw, 0);
    this.ch.update(dt, T);
  }
  get scoped() {
    return this.aiming && !!this.arsenal.def.scope;
  }

  /* ---------- Health ---------- */
  hurt(amount, fromX, fromZ) {
    if (this.dead || amount <= 0) return;
    this.hp -= amount;
    this.hurtT = 0;
    const g = this.game;
    g.hud.damage(Math.atan2(fromX - this.focus.x, fromZ - this.focus.z) - (g.camYaw ?? this.yaw), amount);
    if (amount > 3) g.audio.hurt();
    if (this.hp <= 0) this.die();
  }

  die() {
    const g = this.game;
    this.hp = 0;
    this.dead = true;
    this.deadT = 5;
    this.aiming = false;
    if (this.vehicle && this.mode !== 'foot') this.leaveVehicleNow(this.vehicle);
    this.mode = 'foot';
    this.ch.mode = 'down';
    this.ch.hold = null;
    this.ch.stopEmote();
    this.arsenal.hideAll();
    g.hud.notify('KNOCKED OUT', 'Patching you up…', '#ff5f6d');
    g.onPlayerDown();
  }

  /** Thrown clear when the vehicle you're in explodes. */
  blastOut(v) {
    this.leaveVehicleNow(v);
    this.mode = 'foot';
    this.hurt(999, v.pos.x, v.pos.z);
  }

  leaveVehicleNow(v) {
    v.setDriven(false);
    v.locked = false;
    this.game.onExitVehicle(v);
    const door = v.local(v.def.hw + 1.2, v.def.seatZ);
    this.pos.set(door.x, this.ground(door.x, door.z), door.z);
    this.vehicle = null;
    this.ch.mesh.rotation.set(0, this.yaw, 0);
  }

  revive(x, z, yaw) {
    this.dead = false;
    this.hp = 100;
    this.hurtT = 99;
    this.downT = 0;
    this.mode = 'foot';
    this.vehicle = null;
    this.ch.mode = 'move';
    this.spawn(x, z, yaw);
  }

  /* ---------- Vehicles ---------- */
  findVehicle() {
    const g = this.game;
    let best = null;
    let bd = 1.6;
    const px = this.pos.x;
    const pz = this.pos.z;
    const under = this.underground;
    for (const v of g.vehicles) {
      if (under || v.wrecked || v.fuse > 0) continue;
      if (v.boat && !v.canBoard(this.pos)) continue;
      // Boats sit off the pier edge, so they can be boarded from a little further away
      const d = edgeDist(px, pz, v.pos.x, v.pos.z, v.yaw, v.def.hl, v.def.hw) - (v.boat ? 1 : 0);
      if (d < bd) {
        bd = d;
        best = { v };
      }
    }
    for (const t of g.traffic.cars) {
      if (under) break;
      const d = edgeDist(px, pz, t.x, t.z, t.yaw, t.def.hl, t.def.hw);
      if (d < bd) {
        bd = d;
        best = { traffic: t };
      }
    }
    // Rail: board at either driver's cab while it's (nearly) stopped
    for (const cs of g.rail.consists) {
      if (cs.speed > 1.5 || Math.abs(cs.pos.y - this.pos.y) > 4) continue;
      const c = cs.cabNear(px, pz);
      const d = c.d - cs.def.hw;
      if (d < bd + 0.6) {
        bd = d;
        best = { v: cs, cab: c.cab };
      }
    }
    return best;
  }

  enter(target, duty = false) {
    const g = this.game;
    let v = target.v;
    let jacked = false;
    if (target.traffic) {
      v = g.adoptTrafficCar(target.traffic, new THREE.Vector2(0, 0), 0);
      jacked = true;
    }
    if (g.vehicles.some((o) => o !== v && o.driven)) return;
    this.startDutyOnEnter = duty;
    if (target.cab) v.setCab(target.cab);
    // Pick the closer door, walk there, then climb in
    const d = v.def;
    const sideL = v.local(d.hw + 0.45, d.seatZ);
    const sideR = v.local(-(d.hw + 0.45), d.seatZ);
    const dl = Math.hypot(sideL.x - this.pos.x, sideL.z - this.pos.z);
    const dr = Math.hypot(sideR.x - this.pos.x, sideR.z - this.pos.z);
    const door = dl <= dr ? sideL : sideR;
    this.vehicle = v;
    v.asleep = false;
    v.locked = true;
    this.mode = 'entering';
    this.aiming = false;
    this.ch.stopEmote();
    this.ch.hold = null;
    this.arsenal.hideAll();
    // Boats: step straight aboard from the pier or the water's edge
    this.anim = { t: 0, phase: v.boat ? 'in' : 'walk', door, jacked, side: dl <= dr ? 1 : -1, from: this.pos.clone() };
  }

  exit() {
    const v = this.vehicle;
    if (v.boat) {
      const spot = v.speed < 4 ? v.landingSpot() : null;
      if (!spot) {
        this.game.hud.notify('NOWHERE TO STEP OFF', 'Slow down beside a ghat jetty or the bank', '#ffd36b');
        return;
      }
      v.setDriven(false);
      v.locked = false;
      this.game.onExitVehicle(v);
      this.mode = 'exiting';
      this.anim = { t: 0, door: spot, bail: false, startYaw: v.yaw };
      return;
    }
    const bail = v.speed > 9;
    v.setDriven(false);
    v.locked = false;
    this.game.onExitVehicle(v);
    const off = v.def.hw + 0.6;
    let door = v.local(off, v.def.seatZ);
    if (this.world.collideAt(door.x, door.z, 0.4, this.pos.y)) door = v.local(-off, v.def.seatZ);
    this.mode = 'exiting';
    this.anim = { t: 0, door, bail, startYaw: v.yaw };
    if (bail) this.game.hud.notify('BAILED OUT!', '', '#ff5f6d');
  }

  /* ---------- Update ---------- */
  update(dt, T, inp, input, camYaw) {
    const g = this.game;
    this.prompt = null;
    this.arsenal.update(dt);
    this.hurtT += dt;
    if (!this.dead && this.hurtT > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + 8 * dt);
    if (this.dead) {
      this.deadT -= dt;
      this.ch.mode = 'down';
      this.ch.mesh.position.copy(this.pos);
      this.ch.update(dt, T);
      if (this.deadT <= 0) g.respawnPlayer();
      return;
    }
    if (this.mode === 'riding') {
      g.rides.update(dt, T, input);
      return;
    }
    if (this.mode === 'adda') {
      if (g.adda) g.adda.update(dt, T, g, input);
      return;
    }
    if (this.mode === 'cricket') {
      if (g.cricket) g.cricket.update(dt, T, input);
      return;
    }
    if (this.mode === 'driving') {
      const v = this.vehicle;
      v.update(dt, inp, g.night);
      this.seatCharacter(v);
      this.ch.steer = v.steer / 0.6;
      if (input.hit('KeyF')) this.exit();
      this.ch.update(dt, T);

      const isCourier = v.type === 'bike' || v.type === 'rickshaw' || v.type === 'van';
      const isTaxi = v.type === 'taxi' || v.type === 'auto';
      const jobsOn = g.jobs && g.jobs.on;
      if (isCourier) {
        this.prompt = { key: 'F', text: 'Exit', key2: 'B', text2: jobsOn ? 'Off Duty' : 'Courier Delivery' };
      } else if (isTaxi) {
        this.prompt = { key: 'F', text: 'Exit', key2: 'B', text2: jobsOn ? 'Off Duty' : 'Taxi Duty' };
      } else {
        this.prompt = { key: 'F', text: 'Exit' };
      }
      return;
    }
    if (this.mode === 'entering') {
      this.updateEntering(dt, T);
      return;
    }
    if (this.mode === 'exiting') {
      this.updateExiting(dt, T);
      return;
    }
    this.updateFoot(dt, T, inp, input, camYaw);
  }

  seatCharacter(v) {
    const d = v.def;
    const p = v.local(d.seatX, d.seatZ);
    this.pos.set(p.x, v.pos.y + (v.hy || 0) + d.seatY, p.z);
    this.yaw = v.yaw;
    this.ch.mode = d.lean ? 'ride' : 'sit';
    const m = this.ch.mesh;
    m.position.copy(this.pos);
    m.rotation.set(v.pitch, v.yaw, d.lean ? v.roll : 0, 'YXZ');
  }

  updateEntering(dt, T) {
    const g = this.game;
    const a = this.anim;
    const v = this.vehicle;
    a.t += dt;
    if (a.phase === 'walk') {
      const dx = a.door.x - this.pos.x;
      const dz = a.door.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25 || a.t > 2.2) {
        a.phase = 'in';
        a.t = 0;
        a.from = this.pos.clone();
        if (a.jacked) {
          const ped = this.game.peds.spawnEjected(a.door.x, a.door.z, v.yaw + (a.side > 0 ? 0 : Math.PI), this.pos);
          if (ped) this.game.hud.notify('CAR JACKED', v.label, '#ff9a3c');
        }
      } else {
        const sp = Math.min(4.5, d / dt);
        this.pos.x += (dx / d) * sp * dt;
        this.pos.z += (dz / d) * sp * dt;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt);
        this.ch.speed = damp(this.ch.speed, 4.5, 10, dt);
        this.pos.y = this.ground(this.pos.x, this.pos.z);
      }
      this.ch.mesh.position.copy(this.pos);
      this.ch.mesh.rotation.set(0, this.yaw, 0);
      this.ch.update(dt, T);
      return;
    }
    // climb in
    const k = clamp(a.t / 0.55, 0, 1);
    const seat = v.local(v.def.seatX, v.def.seatZ);
    this.pos.set(lerp(a.from.x, seat.x, k), lerp(a.from.y, v.pos.y + v.def.seatY, k), lerp(a.from.z, seat.z, k));
    this.yaw = dampAngle(this.yaw, v.yaw, 14, dt);
    this.ch.speed = 0;
    if (k > 0.3) this.ch.mode = v.def.lean ? 'ride' : 'sit';
    this.ch.mesh.position.copy(this.pos);
    this.ch.mesh.rotation.set(0, this.yaw, 0);
    this.ch.update(dt, T);
    if (k >= 1) {
      this.mode = 'driving';
      v.locked = false;
      v.setDriven(true);
      g.onEnterVehicle(v);
      if (this.startDutyOnEnter && g.jobs && !g.jobs.on && g.jobs.eligible(v)) g.jobs.start(v);
      this.startDutyOnEnter = false;
    }
  }

  updateExiting(dt, T) {
    const a = this.anim;
    const v = this.vehicle;
    a.t += dt;
    if (!v.rail) v.update(dt, NO_INPUT, this.game.night);
    if (a.bail) {
      // dive out and tumble
      if (a.t < 0.05) {
        const dir = v.local(v.def.hw + 1, 0);
        this.pos.set(dir.x, v.pos.y, dir.z);
        this.bailVel = new THREE.Vector2(v.vel.x * 0.5 + Math.cos(v.yaw) * 4, v.vel.y * 0.5 - Math.sin(v.yaw) * 4);
        this.ch.mode = 'down';
        this.hurt(Math.max(0, v.speed - 9) * 2, v.pos.x, v.pos.z);
      }
      this.bailVel.multiplyScalar(Math.exp(-2.5 * dt));
      this.pos.x += this.bailVel.x * dt;
      this.pos.z += this.bailVel.y * dt;
      const hit = this.world.collideAt(this.pos.x, this.pos.z, 0.4, this.pos.y);
      if (hit) {
        this.pos.x += hit.px;
        this.pos.z += hit.pz;
      }
      this.pos.y = this.ground(this.pos.x, this.pos.z);
      this.ch.mesh.position.copy(this.pos);
      this.ch.mesh.rotation.set(0, this.yaw, 0);
      this.ch.update(dt, T);
      if (a.t > 1.6) this.finishExit();
      return;
    }
    const k = clamp(a.t / 0.5, 0, 1);
    const seat = v.local(v.def.seatX, v.def.seatZ);
    const gy = this.ground(a.door.x, a.door.z);
    this.pos.set(lerp(seat.x, a.door.x, k), lerp(v.pos.y + v.def.seatY, gy, k), lerp(seat.z, a.door.z, k));
    if (k > 0.4) this.ch.mode = 'move';
    this.ch.mesh.position.copy(this.pos);
    this.ch.mesh.rotation.set(0, this.yaw, 0);
    this.ch.update(dt, T);
    if (k >= 1) this.finishExit();
  }

  finishExit() {
    this.mode = 'foot';
    this.ch.mode = 'move';
    this.vehicle = null;
    this.vy = 0;
  }

  updateFoot(dt, T, inp, input, camYaw) {
    const g = this.game;
    const ch = this.ch;
    const ars = this.arsenal;
    // Knocked down by a car or a blast?
    if (this.downT > 0) {
      this.downT -= dt;
      this.aiming = false;
      ch.hold = null;
      this.knockVel.multiplyScalar(Math.exp(-3 * dt));
      this.pos.x += this.knockVel.x * dt;
      this.pos.z += this.knockVel.y * dt;
      const hit = this.world.collideAt(this.pos.x, this.pos.z, 0.4, this.pos.y);
      if (hit) {
        this.pos.x += hit.px;
        this.pos.z += hit.pz;
      }
      this.pos.y = this.ground(this.pos.x, this.pos.z);
      if (this.downT <= 0) ch.mode = 'move';
      ch.mesh.position.copy(this.pos);
      ch.update(dt, T);
      this.placeWeapon(T);
      return;
    }

    /* ---- Weapon select: 1-7, mouse wheel ---- */
    let switched = false;
    for (let i = 0; i < SLOTS.length; i++) if (input.hit('Digit' + (i + 1))) switched = ars.select(SLOTS[i]) || switched;
    if (input.wheelSteps) switched = ars.cycle(input.wheelSteps) || switched;
    if (switched) {
      g.audio.tone(520, 0.05, 'square', 0.04);
      this.combatT = 0;
    }
    const w = ars.def;
    const gun = w.kind === 'gun';
    const k = input.keys;
    this.aiming = gun && k.has('Mouse2') && this.grounded;
    const guard = w.hold === 'fists' && k.has('Mouse2');
    if (this.aiming || guard) this.combatT = Math.max(this.combatT, 0.3);
    this.combatT -= dt;
    const strafe = this.combatT > 0 && w.hold !== 'bat';

    /* ---- Movement relative to camera ---- */
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sprint = inp.nitro && !this.aiming;
    let mx = Math.sin(camYaw) * fwd - Math.cos(camYaw) * str;
    let mz = Math.cos(camYaw) * fwd + Math.sin(camYaw) * str;
    const ml = Math.hypot(mx, mz);
    const busy = ch.attacking;
    let target = 0;
    if (ml > 0.01 && !busy) {
      mx /= ml;
      mz /= ml;
      target = this.aiming ? 2.2 : strafe ? 3.4 : sprint ? 7.2 : this.walking ? 1.7 : 4.4;
      if (!strafe) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 12, dt);
      if (ch.emote) ch.stopEmote();
      if (g.partyOn) g.endParty();
    }
    if (strafe) this.yaw = dampAngle(this.yaw, camYaw, 20, dt);
    if (input.hit('KeyX')) {
      this.walking = !this.walking;
      g.hud.notify(this.walking ? 'WALKING' : 'JOGGING', 'X to switch', '#ffffff');
    }
    // Yaw rate drives the lean into corners
    const yawRate = Math.atan2(Math.sin(this.yaw - (this.prevYaw ?? this.yaw)), Math.cos(this.yaw - (this.prevYaw ?? this.yaw))) / Math.max(dt, 1e-3);
    this.prevYaw = this.yaw;
    ch.turn = damp(ch.turn, clamp(yawRate, -4, 4), 6, dt);
    this.speed = damp(this.speed, target, target > this.speed ? 8 : 12, dt);
    // While strafing the body faces the camera but moves where the keys say
    const mvx = strafe && ml > 0.01 ? mx : Math.sin(this.yaw);
    const mvz = strafe && ml > 0.01 ? mz : Math.cos(this.yaw);
    this.pos.x += mvx * this.speed * dt;
    this.pos.z += mvz * this.speed * dt;

    // Collisions: world, vehicles, traffic
    const hit = this.world.collideAt(this.pos.x, this.pos.z, 0.35, this.pos.y);
    if (hit) {
      this.pos.x += hit.px;
      this.pos.z += hit.pz;
    }
    for (const v of g.vehicles) {
      if (this.underground) break;
      if (v.speed > 5 && this.pushFromVehicle(v.pos.x, v.pos.z, v.yaw, v.def, true)) {
        this.knockDown(v.vel.x * 0.8, v.vel.y * 0.8);
        this.hurt(v.speed * 2.2 * Math.sqrt(v.def.mass), v.pos.x, v.pos.z);
      }
      this.pushFromVehicle(v.pos.x, v.pos.z, v.yaw, v.def);
    }
    for (const c of g.traffic.cars) {
      if (this.underground) break;
      const hitCar = this.pushFromVehicle(c.x, c.z, c.yaw, c.def);
      if (hitCar && c.speed > 5) {
        this.knockDown(c.vel.x * 0.8, c.vel.y * 0.8);
        this.hurt(c.speed * 2.2 * Math.sqrt(c.def.mass), c.x, c.z);
      }
    }

    // Jump & gravity
    const ground = this.ground(this.pos.x, this.pos.z);
    if (this.grounded && input.hit('Space') && !busy) {
      this.vy = 5.2;
      this.grounded = false;
      ch.stopEmote();
    }
    if (!this.grounded) {
      this.vy -= 15 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.grounded = true;
        this.vy = 0;
      }
    } else {
      this.pos.y = damp(this.pos.y, ground, 20, dt);
    }
    ch.mode = this.grounded ? 'move' : 'air';
    ch.speed = this.speed;

    // Interactions
    const nearCar = this.findVehicle();
    const nearPed = this.underground ? null : g.peds.nearest(this.pos.x, this.pos.z, 3.2, (n) => n.state !== 'down' && n.state !== 'dead' && n.state !== 'fight' && n.state !== 'shoot');
    // Stalls, Adda spots, Wardrobe shops, and ticket windows come before chatting
    const spot = !this.underground && g.station ? g.station.near(this.pos) : null;
    const addaSpot = !this.underground && g.adda ? g.adda.near(this.pos) : null;
    const wardrobeSpot = !this.underground && g.wardrobe ? g.wardrobe.near(this.pos) : null;
    const cricketSpot = !this.underground && g.cricket ? g.cricket.near(this.pos) : null;
    // V: ride as a passenger (hire a taxi, auto or rickshaw; board a bus, train, tram, metro or ferry)
    const ride = !this.aiming && g.rides ? g.rides.offer(this) : null;
    // Metro fare gate: ride (pay and go through) or don't (it stays shut)
    const fare = !this.aiming && g.rides ? g.rides.gateOffer(this) : null;
    if (fare) {
      this.prompt = { key: 'V', text: fare.text, key2: 'E', text2: fare.text2 };
      if (input.hit('KeyV')) fare.ride();
      else if (input.hit('KeyE')) fare.skip();
    } else if (nearCar && !this.aiming) {
      let text;
      if (nearCar.v && nearCar.v.rail) text = `Drive ${nearCar.v.label}`;
      else if (nearCar.v) text = `Drive ${nearCar.v.label}`;
      else text = `Steal ${TYPES[nearCar.traffic.type].label}`;

      const vType = nearCar.v ? nearCar.v.type : nearCar.traffic ? nearCar.traffic.type : null;
      const isCourier = vType === 'bike' || vType === 'rickshaw' || vType === 'van';
      const isTaxi = vType === 'taxi' || vType === 'auto';

      if (ride) {
        if (isCourier) {
          this.prompt = { key: 'F', text, key2: 'V', text2: ride.text, key3: 'B', text3: 'Delivery' };
        } else if (isTaxi) {
          this.prompt = { key: 'F', text, key2: 'V', text2: ride.text, key3: 'B', text3: 'Taxi Duty' };
        } else {
          this.prompt = { key: 'F', text, key2: 'V', text2: ride.text };
        }
      } else {
        if (isCourier) {
          this.prompt = { key: 'F', text, key2: 'B', text2: 'Courier Delivery' };
        } else if (isTaxi) {
          this.prompt = { key: 'F', text, key2: 'B', text2: 'Taxi Duty' };
        } else {
          this.prompt = { key: 'F', text };
        }
      }
    } else if (ride) {
      this.prompt = { key: 'V', text: ride.text };
    } else if (spot) {
      this.prompt = { key: 'E', text: spot.text };
    } else if (addaSpot) {
      this.prompt = { key: 'E', text: addaSpot.text };
    } else if (wardrobeSpot) {
      this.prompt = { key: 'E', text: wardrobeSpot.text };
    } else if (cricketSpot) {
      this.prompt = { key: 'E', text: cricketSpot.text };
    } else if (nearPed && !gun) {
      this.prompt = { key: 'E', text: 'Talk', key2: 'G', text2: 'Gesture' };
    }
    if (fare) {
      // the gate's choice has the keys
    } else if (input.hit('KeyV') && ride) {
      ride.act();
      return;
    }
    if (input.hit('KeyF') && nearCar && !this.aiming) {
      this.enter(nearCar);
      return;
    } else if (input.hit('KeyB') && nearCar && !this.aiming) {
      const vType = nearCar.v ? nearCar.v.type : nearCar.traffic ? nearCar.traffic.type : null;
      if (vType === 'bike' || vType === 'rickshaw' || vType === 'van' || vType === 'taxi' || vType === 'auto') {
        this.enter(nearCar, true);
        return;
      }
    } else if (input.hit('KeyE') && spot) {
      spot.act();
    } else if (input.hit('KeyE') && addaSpot) {
      addaSpot.act(this);
    } else if (input.hit('KeyE') && wardrobeSpot) {
      wardrobeSpot.act(this);
    } else if (input.hit('KeyE') && cricketSpot) {
      cricketSpot.act(this);
      return;
    } else if (input.hit('KeyE') && nearPed && !gun) {
      this.talkTo(nearPed);
    }

    /* ---- Attack ---- */
    if (input.hit('KeyR') && ars.startReload()) g.audio.reload();
    const tapped = input.hit('Mouse0') || input.hit('KeyJ');
    const held = k.has('Mouse0') || k.has('KeyJ');
    if (gun) {
      const a = ars.clip;
      const trigger = w.auto ? held : tapped;
      this.dryT -= dt;
      if (trigger && ars.reloadT <= 0 && ars.cool <= 0) {
        if (a.mag > 0) this.fire(w);
        else if (ars.startReload()) g.audio.reload();
        else if (this.dryT <= 0) {
          g.audio.dryFire();
          g.hud.notify('OUT OF AMMO', 'Find an ammo crate', '#ffd36b');
          this.dryT = 1.5;
        }
      }
    } else if (tapped && !busy && this.grounded) {
      this.strike(w);
    }
    if (this.melee) {
      this.melee.t -= dt;
      if (this.melee.t <= 0) {
        this.resolveMelee(this.melee.kind, w);
        this.melee = null;
      }
    }

    // Radial wheels: Tab picks a weapon, G a gesture
    if (input.wheelPick) {
      const { kind, sel } = input.wheelPick;
      if (kind === 'weapon' && ars.select(sel)) g.audio.tone(520, 0.05, 'square', 0.04);
      else if (kind === 'gesture' && !gun) this.gesture(sel);
      input.wheelPick = null;
    }

    // Pose for what's in hand
    const cam = g.camera;
    cam.getWorldDirection(_dir);
    ch.hold = { kind: w.hold, raised: this.aiming || guard || (gun && this.combatT > 0), pitch: Math.asin(clamp(_dir.y, -1, 1)) };

    ch.mesh.position.copy(this.pos);
    ch.mesh.rotation.set(0, this.yaw, 0);
    ch.mesh.visible = !this.scoped;
    ch.update(dt, T);
    this.placeWeapon(T);
  }

  fire(w) {
    const g = this.game;
    const ars = this.arsenal;
    ars.clip.mag--;
    ars.cool = w.rate;
    this.combatT = 1.6;
    // Snap to the camera so the shot leaves the barrel facing the crosshair
    this.yaw = g.camYaw;
    this.ch.mesh.rotation.set(0, this.yaw, 0);
    const mesh = ars.mesh;
    this.ch.hold = { kind: w.hold, raised: true, pitch: 0 };
    this.placeWeapon(0, true);
    const muzzle = mesh.localToWorld(mesh.userData.muzzle.clone());
    const res = g.combat.playerFire(w, g.camera, muzzle, this);
    if (res) g.hud.hitmark(res === 'kill');
    g.recoil(w.recoil * (this.aiming ? 0.6 : 1));
  }

  strike(w) {
    const ars = this.arsenal;
    let kind;
    if (w.hold === 'bat') kind = 'swing';
    else {
      kind = COMBO[ars.combo % COMBO.length];
      ars.combo++;
      ars.comboT = 0.9;
    }
    // Lock on to someone right in front
    const t = this.game.peds.nearest(this.pos.x + Math.sin(this.yaw) * 1.2, this.pos.z + Math.cos(this.yaw) * 1.2, 2.2, (n) => n.state !== 'dead');
    if (t) this.yaw = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    if (!this.ch.attack(kind)) return;
    this.speed = 0;
    this.combatT = Math.max(this.combatT, 0.8);
    this.melee = { kind, t: MELEE[kind].at };
    this.game.audio.swing();
  }

  resolveMelee(kind, w) {
    const g = this.game;
    const M = MELEE[kind];
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const hx = this.pos.x + fx * M.reach * 0.75;
    const hz = this.pos.z + fz * M.reach * 0.75;
    const n = this.underground ? null : g.peds.nearest(hx, hz, M.reach * 0.75, (p) => p.state !== 'dead');
    if (n) {
      const dmg = w.hold === 'bat' ? w.dmg : M.dmg;
      const killed = g.peds.damage(n, dmg, fx * M.push, fz * M.push, this.pos, 'melee');
      g.audio.hitFlesh(kind === 'kick' || kind === 'swing');
      g.audio.impact(kind === 'swing' ? 5 : 3);
      if (kind === 'swing') g.fx.blood(n.x, n.y + 1.5, n.z, fx, fz, 0.6);
      g.peds.panic(n.x, n.z, 14);
      g.hud.hitmark(killed);
      if (kind === 'kick' || kind === 'swing') g.shake(0.15);
      return;
    }
    if (w.hold === 'bat') {
      // Bat on bodywork
      for (const v of g.vehicles) {
        if (edgeDist(hx, hz, v.pos.x, v.pos.z, v.yaw, v.def.hl, v.def.hw) < 0.4) {
          v.damage(5);
          g.fx.sparks(hx, this.pos.y + 1, hz, 3);
          g.audio.metalHit(0);
          return;
        }
      }
    }
  }

  /** Put the held weapon in the right hand and point it. */
  placeWeapon(T, raisedNow = false) {
    const ars = this.arsenal;
    const mesh = ars.mesh;
    for (const m of Object.values(ars.meshes)) if (m !== mesh) m.visible = false;
    if (!mesh) return;
    const show = this.mode === 'foot' && !this.dead && !this.scoped;
    mesh.visible = show;
    if (!show) return;
    const hand = this.ch.bones.haR;
    hand.updateWorldMatrix(true, false);
    hand.localToWorld(mesh.position.set(0, -0.07, 0.03));
    const w = ars.def;
    const yaw = this.yaw;
    const p = mesh.position;
    if (w.hold === 'bat') {
      let a;
      let up;
      const t = this.ch.atkT;
      if (this.ch.attacking && this.ch.atk === 'swing') {
        a = t < 0.18 ? -2.3 : t < 0.34 ? lerp(-1.7, 1.3, (t - 0.18) / 0.16) : 1.5;
        up = t < 0.18 ? 0.6 : 0.1;
      } else {
        a = Math.PI;
        up = 1.6;
      }
      mesh.lookAt(p.x + Math.sin(yaw + a), p.y + up, p.z + Math.cos(yaw + a));
      return;
    }
    const raised = raisedNow || this.aiming || this.combatT > 0;
    if (raised) {
      const cam = this.game.camera;
      cam.getWorldDirection(_dir);
      _aim.copy(cam.position).addScaledVector(_dir, 60);
      mesh.lookAt(_aim);
    } else if (w.hold === 'pistol') {
      mesh.lookAt(p.x + Math.sin(yaw) * 0.35, p.y - 1, p.z + Math.cos(yaw) * 0.35);
    } else {
      mesh.lookAt(p.x + Math.sin(yaw + 0.7), p.y - 0.35, p.z + Math.cos(yaw + 0.7));
    }
  }

  pushFromVehicle(cx, cz, yaw, def, test = false) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let hit = false;
    const r = def.rad + 0.35;
    for (const o of def.offs) {
      const dx = this.pos.x - (cx + fx * o);
      const dz = this.pos.z - (cz + fz * o);
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        if (!test) {
          this.pos.x += (dx / d) * (r - d);
          this.pos.z += (dz / d) * (r - d);
        }
        hit = true;
      }
    }
    return hit;
  }

  knockDown(vx, vz) {
    if (this.downT > 0 || this.dead) return;
    this.downT = 2.2;
    this.knockVel = new THREE.Vector2(vx, vz);
    this.ch.mode = 'down';
    this.ch.stopEmote();
    this.game.audio.impact(6);
    this.game.hud.notify('OUCH!', 'Watch the traffic', '#ff5f6d');
  }

  talkTo(n) {
    const g = this.game;
    this.yaw = Math.atan2(n.x - this.pos.x, n.z - this.pos.z);
    this.ch.play('talk');
    // ask something, and get an answer that fits (now and then a kind soul tips you)
    const tip = Math.random() < 0.12;
    const convo = conversation(tip);
    g.hud.say(this.ch, convo.q, 1.8);
    if (g.peds.talk(n, this.pos, convo) && tip) {
      const amt = 20 + Math.floor(Math.random() * 6) * 10;
      setTimeout(() => g.gameplay.addMoney(amt, `TIP +₹${amt}`), 4400);
    }
  }

  gesture(name) {
    const g = this.game;
    if (this.mode !== 'foot' || this.downT > 0 || this.dead) return;
    this.speed = 0;
    this.ch.play(name);
    if (name === 'dance') {
      const n = g.peds.danceParty(this.pos.x, this.pos.z, 14);
      g.partyOn = true;
      if (n > 0) g.hud.notify('DANCE PARTY!', `${n} ${n === 1 ? 'person joins' : 'people join'} in`, '#ff3fa4');
      return;
    }
    const near = g.peds.nearest(this.pos.x, this.pos.z, 9, (p) => p.state !== 'down' && p.state !== 'flee' && p.state !== 'dead');
    if (near) {
      const facing = Math.cos(Math.atan2(near.x - this.pos.x, near.z - this.pos.z) - this.yaw) > 0.2;
      if (facing || name === 'cheer') g.peds.react(near, name, this.pos);
    }
    if (name === 'point' && near) g.hud.say(this.ch, pick(['Hey, you!', 'Over there!', 'You!']), 1.4);
  }
}

