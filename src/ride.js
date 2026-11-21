import * as THREE from 'three';
import { Character } from './character.js';
import { LINES, pick } from './lines.js';
import { MAP, Poly, offsetLine, routeLength } from './geo.js';
import { inTiles } from './world.js';
import { routePlan, nearestLink, planPath, busHeading } from './busroutes.js';
import { railSeats } from './interiors.js';
import { clamp, damp, dampAngle, etaText } from './utils.js';

/*
 * Riding as a passenger instead of driving.
 *
 * Hire (V) a taxi, an auto or a hand-pulled rickshaw: tell the driver where to
 * go (pick a place on the map), the driver takes you there along the streets,
 * and you pay the fare when you arrive. Board (V) a bus, a tram, a local train,
 * the Metro or a ferry launch: pay the fare and ride; get off (F) at a stop.
 */

/** Fares in rupees: flag-fall covers the first `incl` km, then per km. */
const FARES = {
  taxi: { base: 30, incl: 2, perKm: 15, speed: 14, label: 'taxi' },
  auto: { base: 20, incl: 1.5, perKm: 10, speed: 11, label: 'auto' },
  rickshaw: { base: 30, incl: 0.5, perKm: 25, speed: 2.6, label: 'rickshaw', max: 2500 },
};
const TICKETS = { bus: 10, tram: 7, train: 10, express: 120, metro: 20, launch: 6 };
const HIRE = new Set(['taxi', 'auto', 'rickshaw']);
export const fareFor = (type, metres) => {
  const f = FARES[type];
  const km = metres / 1000;
  return Math.round(f.base + Math.max(0, km - f.incl) * f.perKm);
};

/** Where the passenger sits, in the vehicle's local frame [x, z, seatY]. */
export function passengerSeat(v) {
  const d = v.def;
  if (d.pass) return d.pass;
  if (v.type === 'rickshaw') return [0, -0.3, 0.32];
  if (v.type === 'bus' || v.type === 'schoolbus') return [0.6, -1.5, d.seatY];
  if (v.boat) return [1.5, -3, d.free + 0.1];
  return [-(d.seatX || 0.38), (d.seatZ || 0) - 1.0, d.seatY];
}

export class Rides {
  constructor(game, scene, world) {
    this.game = game;
    this.scene = scene;
    this.world = world;
    this.ride = null;
    this.driver = null;
    this.tmp = {};
  }

  get active() {
    return !!this.ride;
  }

  /* ---------- What V does near the player ---------- */
  offer(player) {
    const g = this.game;
    const p = player.pos;
    if (player.underground) {
      const cs = this.nearConsist(p, 3.4);
      if (!cs) return null;
      // the fare was paid at the gate on the way in
      const paid = cs.kind === 'metro' && this.metroPass;
      return { text: paid ? `Board ${cs.label}` : `Board ${cs.label} · ₹${TICKETS[cs.kind]}`, act: () => this.boardRail(cs) };
    }
    // Rail: any car of a stopped train or tram
    const cs = this.nearConsist(p, 3.4);
    if (cs) return { text: `Board ${cs.label} · ₹${TICKETS[cs.kind]}`, act: () => this.boardRail(cs) };
    // Road vehicles and launches
    let best = null;
    let bd = 3.2;
    const consider = (o, x, z, type, def) => {
      const d = Math.hypot(x - p.x, z - p.z) - def.hw;
      if (d < bd) {
        bd = d;
        best = { o, type };
      }
    };
    for (const v of g.vehicles) {
      if (v.wrecked || v.driven) continue;
      if (v.boat) {
        // a launch is long: anywhere alongside it will do
        if (v.type === 'launch' && v.route && v.canBoard(p)) consider(v, p.x, p.z, 'launch', { hw: 0 });
        continue;
      }
      if (HIRE.has(v.type) || v.type === 'bus') consider(v, v.pos.x, v.pos.z, v.type, v.def);
    }
    for (const c of g.traffic.cars) if (HIRE.has(c.type) || c.type === 'bus') consider(c, c.x, c.z, c.type, c.def);
    if (!best) return null;
    const { o, type } = best;
    if (type === 'launch') return { text: `Board the ferry · ₹${TICKETS.launch}`, act: () => this.boardLaunch(o) };
    if (type === 'bus') {
      const route = o.busRoute;
      const via = route && routePlan(this.world.graph, route, o.busBack).via;
      return { text: route ? `Board bus ${route.no} to ${busHeading(route, o.busBack)}${via ? ` via ${via}` : ''} · ₹${TICKETS.bus}` : `Board the bus · ₹${TICKETS.bus}`, act: () => this.hire(o, 'bus') };
    }
    const name = { taxi: 'taxi', auto: 'auto', rickshaw: 'rickshaw' }[type];
    return { text: `Hire the ${name} · ₹${FARES[type].base}+`, act: () => this.hire(o, type) };
  }

  /**
   * Metro fare gates at the foot of the stairs. Going in, the player chooses: tap the card
   * (the fare comes off now) and the flaps open, or don't ride and they stay shut.
   * Coming out from the platform, they open by themselves.
   */
  gateOffer(player) {
    const g = this.game;
    if (!player.underground || !g.metro) {
      // back up in the street: the card's tap has run out
      this.metroPass = false;
      this.declined = null;
      return null;
    }
    const near = g.metro.gateNear(player.pos.x, player.pos.z);
    if (!near) {
      this.declined = null;
      return null;
    }
    const gate = near.g;
    if (near.way === 'out' || this.metroPass) {
      g.metro.openGate(gate, 1.5);
      return null;
    }
    if (this.declined === gate) return null;
    const fare = TICKETS.metro;
    return {
      text: `Ride the Metro · ₹${fare}`,
      text2: "Don't ride",
      ride: () => {
        if (g.gameplay.money < fare) {
          g.hud.notify('NOT ENOUGH MONEY', `The fare is ₹${fare} · the gate stays shut`, '#ff5f6d');
          this.declined = gate;
          return;
        }
        this.pay(fare, 'Metro fare · card tapped at the gate');
        this.metroPass = true;
        g.metro.openGate(gate, 2.5);
      },
      skip: () => {
        this.declined = gate;
        g.hud.notify('GATE STAYS SHUT', 'Head back up the stairs to the street', '#ffd36b');
      },
    };
  }

  nearConsist(p, r) {
    for (const cs of this.game.rail.consists) {
      // the Metro only while its doors are open
      if (!cs.boardable || cs.driven || Math.abs(cs.pos.y - p.y) > 4) continue;
      for (const c of cs.cars) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const along = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
        const side = Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw));
        if (Math.abs(along) < cs.K.L / 2 && side < cs.K.hw + r) return cs;
      }
    }
    return null;
  }

  pay(amount, to) {
    const gp = this.game.gameplay;
    const paid = Math.min(amount, gp.money);
    if (paid > 0) gp.addMoney(-paid);
    this.game.audio.beep(true);
    this.game.hud.notify(paid >= amount ? `PAID ₹${paid}` : `PAID ₹${paid} OF ₹${amount}`, to, '#ffd36b');
    return paid >= amount;
  }

  /* ---------- Road: taxi, auto, rickshaw, bus ---------- */
  hire(target, type) {
    const g = this.game;
    const v = target.mesh ? g.adoptTrafficCar(target, new THREE.Vector2(0, 0), 0) : target;
    v.vel.set(0, 0);
    v.angVel = 0;
    v.asleep = true;
    v.keep = true;
    const pl = g.player;
    this.ride = { kind: type, v, state: type === 'bus' ? 'go' : 'ask', dist: 0, stopT: 0, stuck: 0, ghost: 0, last: v.pos.clone(), speed: 0 };
    pl.board(v, passengerSeat(v));
    // A driver at the wheel (the rickshaw's puller is part of the model)
    if (type !== 'rickshaw') this.seatDriver(v);
    const who = this.driver || pl.ch;
    if (type === 'bus') {
      this.pay(TICKETS.bus, 'Bus fare to the conductor');
      g.hud.say(who, pick(LINES.conductor), 2.2);
      // a route bus runs the streets its route really takes, to the terminus on its board
      const pts = v.busRoute ? this.busPath(v) : null;
      if (pts && pts.length > 2) {
        const plan = routePlan(this.world.graph, v.busRoute, v.busBack);
        const end = pts[pts.length - 1];
        this.follow(pts);
        this.ride.final = true;
        this.ride.state = 'go';
        this.ride.terminus = plan.terminus;
        g.setWaypointQuiet({ x: end[0], z: end[1] });
        const { left, eta } = this.remaining();
        g.hud.notify(`BUS ${v.busRoute.no} TO ${busHeading(v.busRoute, v.busBack)}`, `${plan.via ? `Via ${plan.via} · ` : ''}Last stop ${(left / 1000).toFixed(1)} km · about ${etaText(eta)} · F to get off at the next stop`, '#38f3ff');
      } else {
        this.wander();
        g.hud.notify('ON THE BUS', 'F to get off at the next stop', '#38f3ff');
      }
      return;
    }
    g.hud.say(this.voiceOf(v), pick(LINES.whereTo), 2.4);
    // Pick the destination on the map
    g.pickDestination(`Where to? Search a place or click the map · ${type === 'taxi' ? 'Taxi' : type === 'auto' ? 'Auto' : 'Rickshaw'}: ₹${FARES[type].base} + ₹${FARES[type].perKm}/km`, (dest) => {
      if (!this.ride || this.ride.v !== v) return;
      if (!dest) {
        this.leave(false);
        return;
      }
      this.setDestination(dest);
    });
  }

  setDestination(dest) {
    const r = this.ride;
    const g = this.game;
    const v = r.v;
    const speaker = this.voiceOf(v);
    if (!inTiles(dest.x, dest.z, 30)) {
      g.hud.say(speaker, pick(LINES.tooFar), 2.4);
      g.hud.notify('OUTSIDE THE MAPPED CITY', 'Pick somewhere inside the map', '#ffd36b');
      this.repick();
      return;
    }
    const pts = this.world.graph.route(v.pos.x, v.pos.z, dest.x, dest.z);
    const len = routeLength(pts);
    const F = FARES[r.kind];
    if (pts.length < 3 || (F.max && len > F.max)) {
      g.hud.say(speaker, pick(LINES.tooFar), 2.4);
      if (F.max) g.hud.notify('TOO FAR FOR A RICKSHAW', `Rickshaws go up to ${(F.max / 1000).toFixed(1)} km · take a taxi or an auto`, '#ffd36b');
      this.repick();
      return;
    }
    this.follow(pts);
    r.state = 'go';
    r.quote = fareFor(r.kind, len);
    r.dest = dest;
    g.hud.say(speaker, pick(LINES.going), 2.2);
    g.hud.notify(`${(len / 1000).toFixed(1)} KM · ABOUT ₹${r.quote}`, 'Sit back · F to get off early', '#38f3ff');
    g.setWaypointQuiet(dest);
  }
  repick() {
    const r = this.ride;
    setTimeout(() => {
      if (this.ride === r && r.state === 'ask')
        this.game.pickDestination('Somewhere else? Search a place or click the map', (d) => {
          if (this.ride !== r) return;
          if (!d) this.leave(false);
          else this.setDestination(d);
        });
    }, 1200);
  }

  /** Drive along a street route, keeping to the left lane. */
  follow(pts) {
    const r = this.ride;
    const flat = pts.flat();
    // a lane to the left of the centre line (India keeps left), except on the rickshaw's lanes
    const lane = r.kind === 'rickshaw' ? 2.4 : r.kind === 'bus' ? 2.6 : 2.0;
    const path = new Poly(offsetLine(flat, lane));
    r.path = path;
    r.s = path.project(r.v.pos.x, r.v.pos.z).s;
    r.nextStop = r.kind === 'bus' ? r.s + 420 : Infinity;
  }

  /**
   * The rest of a route bus's run: from the street of its route it is on (or, waiting at a
   * terminus, the nearest one, by road), to the end of the route.
   */
  busPath(v) {
    const graph = this.world.graph;
    const plan = routePlan(graph, v.busRoute, v.busBack);
    if (!plan.links.length) return null;
    let i = v.busI;
    let d = 0;
    if (i === undefined || !plan.links[i] || plan.links[i] !== v.busLinks?.[i]) ({ i, d } = nearestLink(plan, v.pos.x, v.pos.z));
    const pts = planPath(plan, i);
    if (d > 15) {
      // off the route's streets (in the terminus): drive onto it first
      const join = graph.route(v.pos.x, v.pos.z, pts[0][0], pts[0][1]);
      return [...join.slice(0, -1), ...pts];
    }
    return pts;
  }

  /**
   * What's left of a road ride, for the GPS line on the map and the distance and time on the
   * HUD: { pts, left, eta } (metres, seconds), or null when there's no route to show.
   */
  remaining() {
    const r = this.ride;
    if (!r || !r.path || r.state === 'ask' || r.state === 'arrived') return null;
    const P = r.path;
    const pts = [[r.v.pos.x, r.v.pos.z]];
    for (let i = 0; i < P.n; i++) if (P.cum[i] > r.s) pts.push([P.x[i], P.z[i]]);
    const left = Math.max(0, P.len - r.s);
    let eta;
    if (r.kind === 'bus') {
      // a city bus averages ~8 m/s between stops, and waits at each one on the way
      const stops = r.nextStop < P.len ? 1 + Math.floor((P.len - r.nextStop) / 420) : 0;
      eta = left / 8 + stops * 9 + (r.state === 'stopped' ? Math.max(0, r.stopT) : 0);
    } else eta = left / (FARES[r.kind].speed * 0.7);
    return { pts, left, eta };
  }

  /** The bus keeps going: a main-road destination a couple of kilometres away. */
  wander() {
    const r = this.ride;
    const g = this.game;
    const v = r.v;
    const edges = this.world.graph.edgesNear(v.pos.x, v.pos.z, 3000).filter((e) => e.c <= 2 && e.len > 60 && inTiles(e.pts[0], e.pts[1]));
    for (let tries = 0; tries < 20; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      if (!e) break;
      const q = e.poly.at(e.len / 2, {});
      const d = Math.hypot(q.x - v.pos.x, q.z - v.pos.z);
      if (d < 1200) continue;
      const pts = this.world.graph.route(v.pos.x, v.pos.z, q.x, q.z);
      if (pts.length < 3) continue;
      this.follow(pts);
      r.state = 'go';
      return;
    }
    r.state = 'arrived';
  }

  /** Who speaks for a vehicle: its driver, or (rickshaw) the puller at the front. */
  voiceOf(v) {
    if (this.driver) return this.driver;
    if (!v.car.speaker) {
      const head = new THREE.Object3D();
      head.position.set(0, 1.65, v.type === 'rickshaw' ? 2.35 : v.def.seatZ || 0);
      v.car.root.add(head);
      v.car.speaker = { mesh: v.car.root, look: { female: false }, bones: { head } };
    }
    return v.car.speaker;
  }

  seatDriver(v) {
    const look = { female: false, skin: '#8a5a3c', shirt: v.type === 'taxi' ? '#d8d2c0' : v.type === 'bus' ? '#3a5a8a' : '#e8e4d8', pants: '#3d3b39', shoes: '#1a1612', hair: '#120d0a', longSleeve: true, scale: 1 };
    this.driver = new Character(this.scene, look);
    this.driver.mode = 'sit';
    this.driver.acc = 0;
  }
  removeDriver() {
    if (!this.driver) return;
    this.scene.remove(this.driver.mesh);
    this.driver.mesh.geometry.dispose();
    this.driver = null;
  }

  /* ---------- Rail and ferry ---------- */
  boardRail(cs) {
    const g = this.game;
    const pl = g.player;
    // the car the player is standing by
    let ci = 0;
    let bd = Infinity;
    cs.cars.forEach((c, i) => {
      const d = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
      // a car with seats (not the Rajdhani's locomotive)
      if (d < bd && railSeats(cs, i).length) {
        bd = d;
        ci = i;
      }
    });
    let along = clamp((pl.pos.x - cs.cars[ci].x) * Math.sin(cs.cars[ci].yaw) + (pl.pos.z - cs.cars[ci].z) * Math.cos(cs.cars[ci].yaw), -cs.K.L / 2 + 2, cs.K.L / 2 - 2);
    // sit down in the seat nearest where you got on
    let seat = null;
    for (const s of railSeats(cs, ci)) if (!seat || Math.abs(s.z - along) < Math.abs(seat.z - along)) seat = s;
    if (seat) along = seat.z;
    // the Metro is paid for at the gate: the card's tap covers one trip
    if (cs.kind === 'metro' && this.metroPass) this.metroPass = false;
    else this.pay(TICKETS[cs.kind], `${cs.label} ticket`);
    if (g.progress) g.progress.event(cs.kind);
    if (cs.kind === 'train' || cs.kind === 'express') g.station.ticketT = Math.max(g.station.ticketT, 600);
    this.ride = { kind: 'rail', cs, ci, along, seat, wasState: cs.state, lastStop: null };
    pl.board(cs, null);
    g.hud.notify(`ON THE ${cs.label.toUpperCase()}`, 'F to get off when it stops', '#38f3ff');
  }

  boardLaunch(b) {
    const g = this.game;
    this.pay(TICKETS.launch, 'Ferry ticket');
    if (g.progress) g.progress.event('ferry');
    this.ride = { kind: 'launch', v: b };
    g.player.board(b, passengerSeat(b));
    g.hud.notify('ON THE FERRY', 'F to get off when it docks', '#38f3ff');
  }

  /* ---------- Getting off ---------- */
  requestStop() {
    const r = this.ride;
    const g = this.game;
    if (!r) return;
    if (r.kind === 'rail') {
      if (!r.cs.boardable) {
        if (r.cs.speed < 0.6 && r.cs.doors) g.hud.notify('WAIT FOR THE DOORS', 'They open at the platform', '#ffd36b');
        else g.hud.notify('WAIT FOR THE NEXT STOP', 'Get off when the train stops', '#ffd36b');
        return;
      }
      this.leaveRail();
      return;
    }
    if (r.kind === 'launch') {
      const spot = r.v.speed < 2 ? r.v.landingSpot() : null;
      if (!spot) {
        g.hud.notify('WAIT TILL IT DOCKS', 'Get off at the jetty', '#ffd36b');
        return;
      }
      this.game.player.unboard(spot.x, spot.z);
      this.ride = null;
      return;
    }
    if (r.state === 'go') {
      // pull over here
      r.state = 'stopping';
      r.early = true;
      g.hud.say(this.voiceOf(r.v), pick(LINES.stopHere), 2);
      return;
    }
    if (r.state === 'ask' || r.state === 'arrived' || r.state === 'stopped') this.leave(r.state !== 'ask');
  }

  /** Off a road vehicle, paying for the distance covered. */
  leave(payNow) {
    const r = this.ride;
    const g = this.game;
    const v = r.v;
    if (payNow && r.kind !== 'bus') {
      // the quoted fare for the whole trip; the meter for an early stop
      const fare = r.quote && !r.early ? Math.max(r.quote, fareFor(r.kind, r.dist)) : fareFor(r.kind, r.dist);
      const full = this.pay(fare, `To the ${FARES[r.kind].label} driver`);
      const who = this.voiceOf(v);
      setTimeout(() => g.hud.say(who, pick(full ? LINES.thanks : LINES.shortChange), 2.2), 900);
    }
    // step out on the kerb side (left)
    const off = v.def.hw + 0.9;
    let door = v.local(off, -0.3);
    if (this.world.collideCircle(door.x, door.z, 0.4)) door = v.local(-off, -0.3);
    g.player.unboard(door.x, door.z);
    v.asleep = false;
    v.vel.set(0, 0);
    // the driver stays a moment, then the vehicle is free to take
    setTimeout(() => this.removeDriver(), payNow ? 3500 : 300);
    this.ride = null;
    g.clearWaypoint();
  }

  leaveRail() {
    const r = this.ride;
    const cs = r.cs;
    const g = this.game;
    const c = cs.cars[r.ci];
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    const W = this.world;
    const y = cs.K.y + 1;
    let spot = null;
    for (const side of [1, -1]) {
      const x = c.x + fx * r.along + fz * (cs.K.hw + 1.1) * side;
      const z = c.z + fz * r.along - fx * (cs.K.hw + 1.1) * side;
      const gy = W.groundAt(x, z, y - 1);
      const platform = gy > cs.K.y + 0.4;
      const free = !W.collideAt(x, z, 0.35, gy + 0.1);
      const score = (platform ? 2 : 0) + (free ? 1 : 0);
      if (!spot || score > spot.score) spot = { x, z, score };
    }
    g.player.unboard(spot.x, spot.z);
    this.ride = null;
  }

  /* ---------- Every frame ---------- */
  update(dt, T, input) {
    const r = this.ride;
    const g = this.game;
    if (!r) return;
    const pl = g.player;
    if (input.hit('KeyF')) this.requestStop();
    if (!this.ride) return;
    if (r.kind === 'rail') {
      const cs = r.cs;
      const c = cs.cars[r.ci];
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const s = r.seat;
      if (s) pl.seatAt(c.x + fz * s.x + fx * s.z, cs.K.y + s.y - 0.85, c.z - fx * s.x + fz * s.z, c.yaw + s.face, T, dt);
      else pl.seatAt(c.x + fx * r.along + fz * 0.7, cs.K.y + cs.K.floor + 0.45, c.z + fz * r.along - fx * 0.7, c.yaw + Math.PI / 2, T, dt);
      // announce the stop
      // (a Metro reversing in its siding beyond the last station isn't a stop)
      if (cs.state === 'dwell' && r.wasState !== 'dwell' && (!cs.sideAt || cs.sideAt(cs.s) !== null)) {
        const name = this.stationName(cs);
        if (name) g.hud.notify(name.toUpperCase(), 'F to get off here', cs.kind === 'metro' ? '#2f6fe0' : '#f4c51c');
      }
      r.wasState = cs.state;
      return;
    }
    if (r.kind === 'launch') {
      const b = r.v;
      const [px, pz, py] = passengerSeat(b);
      const q = b.local(px, pz);
      pl.seatAt(q.x, b.pos.y + py, q.z, b.yaw, T, dt);
      return;
    }
    // hold T to hurry the trip along
    this.drive(input.keys.has('KeyT') ? dt * 4 : dt);
    const v = r.v;
    const [px, pz, py] = passengerSeat(v);
    const q = v.local(px, pz);
    pl.seatAt(q.x, v.pos.y + py, q.z, v.yaw, T, dt);
    if (this.driver) {
      const d = v.def;
      const s = v.local(d.seatX, d.seatZ);
      const m = this.driver.mesh;
      m.position.set(s.x, v.pos.y + d.seatY, s.z);
      m.rotation.set(0, v.yaw, 0);
      this.driver.steer = v.steer / 0.5;
      this.driver.acc += dt;
      if (this.driver.acc > 1 / 30) {
        this.driver.update(this.driver.acc, T);
        this.driver.acc = 0;
      }
    }
  }

  stationName(cs) {
    const p = cs.pos;
    if (cs.kind === 'metro') {
      let best = null;
      for (const s of this.game.metro.stations) {
        const d = Math.hypot(s.frame.cx - p.x, s.frame.cz - p.z);
        if (d < 160 && (!best || d < best.d)) best = { d, n: s.name };
      }
      return best && best.n;
    }
    let best = null;
    for (const s of MAP.stations) {
      if (s.k !== 'rail') continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < 400 && (!best || d < best.d)) best = { d, n: s.n.replace(/ junction/i, '') };
    }
    if (best) return best.n;
    if (cs.kind === 'tram') {
      let t = null;
      for (const s of this.game.rail.tramStops) {
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < 120 && (!t || d < t.d)) t = { d, n: s.name };
      }
      return t && `${t.n} tram stop`;
    }
    return null;
  }

  /** The chauffeur: follow the path at a sensible speed, giving way to anything ahead. */
  drive(dt) {
    const r = this.ride;
    const g = this.game;
    const v = r.v;
    const q = this.tmp;
    if (r.state === 'ask' || r.state === 'arrived' || r.state === 'stopped' || !r.path) {
      r.speed = damp(r.speed, 0, 5, dt);
      this.place(v, dt, 0);
      if (r.state === 'stopped' && r.kind === 'bus') {
        r.stopT -= dt;
        if (r.stopT <= 0) {
          r.state = 'go';
          r.nextStop = r.s + 420;
        }
      }
      return;
    }
    const P = r.path;
    const F = FARES[r.kind];
    let vmax = F ? F.speed : 10;
    // slow for corners: how much the path turns over the next stretch
    P.at(r.s, q);
    const ax = q.tx;
    const az = q.tz;
    const look = clamp(r.speed * 1.8, 8, 30);
    P.at(Math.min(P.len, r.s + look), q);
    const turn = 1 - (ax * q.tx + az * q.tz);
    vmax = Math.min(vmax, 3.5 + (1 - clamp(turn * 1.6, 0, 1)) * (vmax - 3.5));
    // stop at the end, or where asked, or at the next bus stop
    const left = P.len - r.s;
    if (r.state === 'stopping') vmax = Math.min(vmax, Math.max(0, r.speed - 6 * dt));
    vmax = Math.min(vmax, Math.sqrt(2 * 3 * Math.max(0, left - 1)));
    if (r.kind === 'bus') vmax = Math.min(vmax, Math.sqrt(2 * 2.5 * Math.max(0, r.nextStop - r.s)) + 0.2);
    // give way to traffic, parked vehicles and people in the lane
    r.ghost -= dt;
    let block = 99;
    let pedSlow = 99;
    if (r.ghost <= 0) {
      const fx = Math.sin(v.yaw);
      const fz = Math.cos(v.yaw);
      const check = (x, z, hl, why) => {
        const dx = x - v.pos.x;
        const dz = z - v.pos.z;
        const ahead = dx * fx + dz * fz - v.def.hl - hl;
        if (ahead < -1 || ahead > 16) return;
        if (Math.abs(dx * fz - dz * fx) < v.def.hw + 1.2 && ahead < block) {
          block = ahead;
          r.why = why;
        }
      };
      for (const c of g.traffic.cars) check(c.x, c.z, c.def.hl, 'car');
      // pulling out of a rank, the parked cars round it don't count
      for (const o of g.vehicles) if (o !== v && !o.boat && !(o.asleep && r.dist < 60)) check(o.pos.x, o.pos.z, o.def.hl, 'vehicle');
      // people step out of the way of a slow-moving car; the driver just eases off
      for (const n of g.peds.list) {
        if (n.state === 'dead' || n.state === 'down') continue;
        const dx = n.x - v.pos.x;
        const dz = n.z - v.pos.z;
        const ahead = dx * fx + dz * fz - v.def.hl;
        const lat = dx * fz - dz * fx;
        if (ahead < -0.5 || ahead > 9 || Math.abs(lat) > v.def.hw + 1) continue;
        const side = lat >= 0 ? 1 : -1;
        n.x += fz * side * 2.2 * dt;
        n.z -= fx * side * 2.2 * dt;
        pedSlow = Math.min(pedSlow, 1.5 + ahead * 0.5);
      }
      for (const o of g.rail.obstacles()) check(o.pos.x, o.pos.z, o.def.hl, 'tram');
    }
    if (block < 16) vmax = Math.min(vmax, Math.max(0, (block - 2) * 0.9));
    vmax = Math.min(vmax, pedSlow);
    const accel = r.kind === 'rickshaw' ? 1.2 : r.kind === 'bus' ? 1.6 : 2.6;
    r.speed = r.speed < vmax ? Math.min(vmax, r.speed + accel * dt) : Math.max(vmax, r.speed - 7 * dt);
    // stuck behind something: honk, complain, then squeeze past
    if (r.speed < 0.3 && block < 16) {
      r.stuck += dt;
      if (r.stuck > 2 && !r.honked) {
        r.honked = true;
        if (r.kind === 'rickshaw') g.audio.rickshawBell();
        else g.audio.honk(3);
        if (Math.random() < 0.5) g.hud.say(this.voiceOf(v), pick(LINES.jam), 2);
      }
      if (r.stuck > 3.5) {
        r.ghost = 6;
        r.stuck = 0;
        r.honked = false;
      }
    } else r.stuck = 0;
    r.s = Math.min(P.len, r.s + r.speed * dt);
    r.dist += r.speed * dt;
    this.place(v, dt, r.speed);
    // arrivals
    if (r.state === 'stopping' && r.speed < 0.2) {
      r.state = 'arrived';
      this.leave(true);
      return;
    }
    if (r.kind === 'bus') {
      if (r.s >= r.nextStop - 0.5 && r.speed < 0.3) {
        r.state = 'stopped';
        r.stopT = 7;
        g.hud.say(this.driver || g.player.ch, pick(LINES.busStop), 2);
        g.audio.beep(false);
      }
      if (left < 2 && r.speed < 0.3) {
        if (r.final) {
          // the last stop: everybody off
          r.state = 'arrived';
          if (r.terminus || !v.busRoute) g.hud.notify('LAST STOP', v.busRoute ? busHeading(v.busRoute, v.busBack) : '', '#ffd36b');
          else g.hud.notify('EDGE OF THE MAPPED CITY', `Bus ${v.busRoute.no} runs on to ${busHeading(v.busRoute, v.busBack)} · everybody off`, '#ffd36b');
          g.hud.say(this.driver || g.player.ch, pick(LINES.busStop), 2);
          setTimeout(() => {
            if (this.ride === r) this.leave(false);
          }, 1500);
        } else this.wander();
      }
      return;
    }
    if (left < 2 && r.speed < 0.3) {
      r.state = 'arrived';
      g.hud.say(this.voiceOf(v), pick(LINES.arrived), 2.4);
      setTimeout(() => {
        if (this.ride === r) this.leave(true);
      }, 1800);
    }
  }

  /** Put the vehicle on the path at the ride's position. */
  place(v, dt, speed) {
    const r = this.ride;
    const q = this.tmp;
    if (r.path) {
      r.path.at(r.s, q);
      v.pos.x = q.x;
      v.pos.z = q.z;
      const yaw = Math.atan2(q.tx, q.tz);
      const prev = v.yaw;
      v.yaw = dampAngle(v.yaw, yaw, 8, dt);
      v.steer = clamp(-((v.yaw - prev) / Math.max(dt, 1e-3)) * 0.25, -0.5, 0.5);
    }
    v.pos.y = damp(v.pos.y, this.world.groundAt(v.pos.x, v.pos.z, v.pos.y), 12, dt);
    v.vel.set(Math.sin(v.yaw) * speed, Math.cos(v.yaw) * speed);
    v.vf = speed;
    v.speed = speed;
    v.rpm = clamp(0.2 + speed / Math.max(4, v.def.top), 0, 1);
    v.braking = speed < r.lastSpeed - 0.01;
    r.lastSpeed = speed;
    v.applyVisuals(dt, this.game.night);
  }
}
