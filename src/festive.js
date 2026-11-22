import * as THREE from 'three';
import { inPoly } from './geo.js';
import { lerp } from './utils.js';

/**
 * Durga Puja / Festive Mode Manager
 * Adds colourful fairy lights to Howrah Bridge and Park Street
 * and coordinates with Web Audio procedural dhak drums.
 */

const FESTIVE_KEY = 'kol_festive';

// Authentic festival fairy light palette
const FESTIVE_COLORS = [
  new THREE.Color('#ff9900'), // Saffron marigold
  new THREE.Color('#ffd700'), // Pure gold
  new THREE.Color('#ff1744'), // Kumkum crimson
  new THREE.Color('#00e676'), // Emerald green
  new THREE.Color('#00e5ff'), // Electric cyan
  new THREE.Color('#d500f9'), // Festive magenta
  new THREE.Color('#fff2db'), // Warm incandescent white
  new THREE.Color('#ff6d00'), // Amber glow
];

const VERT_SHADER = `
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aSize;
  varying vec3 vColor;
  varying float vTwinkle;
  varying float vFar;
  uniform float uTime;
  uniform float uNight;
  void main() {
    vColor = aColor;
    float tw = 0.5 + 0.5 * sin(uTime * 3.8 + aPhase);
    vTwinkle = tw;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float d = -mvPosition.z;
    // 0 close by (a sharp little bulb), 1 far off (a soft blur)
    vFar = smoothstep(12.0, 160.0, d);
    // the sprite holds the bulb and its halo; far ones get a little room to blur into
    float sz = aSize * (0.9 + 0.2 * tw) * (1.0 + vFar);
    gl_PointSize = clamp(sz * (150.0 / d), 1.5, 18.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG_SHADER = `
  varying vec3 vColor;
  varying float vTwinkle;
  varying float vFar;
  uniform float uNight;
  void main() {
    float r = length(gl_PointCoord - vec2(0.5)) * 2.0; // 0 centre, 1 edge
    if (r > 1.0) discard;
    // the bulb: a crisp disc up close, its edge softening with distance
    float edge = mix(0.05, 0.55, vFar);
    float bulb = 1.0 - smoothstep(0.42 - edge * 0.5, 0.42 + edge * 0.5, r);
    // a faint halo round it, no bigger than the sprite
    float halo = pow(1.0 - r, 2.2) * 0.38;
    // far bulbs dim so a street of them glows instead of piling up into white
    float fade = 1.0 - 0.7 * vFar;
    float intensity = (0.38 + 0.32 * uNight) * (0.75 + 0.25 * vTwinkle) * fade;
    vec3 col = mix(vColor, vec3(1.0, 0.97, 0.9), bulb * 0.2 * (1.0 - vFar));
    gl_FragColor = vec4(col, (bulb + halo) * intensity);
  }
`;

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 0.001) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export class FestiveManager {
  constructor(game, scene, world) {
    this.game = game;
    this.scene = scene;
    this.world = world;
    this.enabled = false;
    this.group = new THREE.Group();
    this.group.name = 'festive_decorations';
    this.group.visible = false;
    this.material = null;
    this.time = 0;
    this.built = false;

    try {
      this.enabled = localStorage.getItem(FESTIVE_KEY) === '1';
    } catch {
      this.enabled = false;
    }
  }

  init() {
    this.buildFairyLights();
    this.scene.add(this.group);
    this.setEnabled(this.enabled, false);
  }

  setEnabled(on, notify = true) {
    this.enabled = !!on;
    try {
      localStorage.setItem(FESTIVE_KEY, this.enabled ? '1' : '0');
    } catch {
      /* storage unavailable */
    }

    this.group.visible = this.enabled;

    if (this.game && this.game.hud && notify) {
      this.game.hud.notify(
        this.enabled ? '🪔 DURGA PUJA MODE ON' : 'FESTIVE MODE OFF',
        this.enabled ? 'Howrah Bridge & Park Street illuminated · Dhak drums playing' : 'City returned to standard lighting',
        this.enabled ? '#ffd700' : '#8899aa'
      );
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  buildFairyLights() {
    if (this.built) return;
    this.built = true;

    const bulbPositions = [];
    const bulbColors = [];
    const bulbPhases = [];
    const bulbSizes = [];
    const wirePositions = [];

    const addBulb = (x, y, z, color, phase, size = 20) => {
      bulbPositions.push(x, y, z);
      bulbColors.push(color.r, color.g, color.b);
      bulbPhases.push(phase);
      bulbSizes.push(size);
    };

    const addWire = (p0, p1) => {
      wirePositions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
    };

    // Helper: catenary swag generator
    const addSwag = (p0, p1, numBulbs = 8, droop = 0.7, size = 20) => {
      let prev = p0;
      for (let i = 1; i <= numBulbs; i++) {
        const u = i / (numBulbs + 1);
        const x = lerp(p0[0], p1[0], u);
        const z = lerp(p0[2], p1[2], u);
        const sag = 4.0 * droop * u * (1.0 - u);
        const y = lerp(p0[1], p1[1], u) - sag;
        const cur = [x, y, z];
        const col = FESTIVE_COLORS[(bulbPositions.length / 3) % FESTIVE_COLORS.length];
        const phase = (u * 6.28 + Math.random() * 2.0) % 6.28;
        addBulb(x, y, z, col, phase, size);
        addWire(prev, cur);
        prev = cur;
      }
      addWire(prev, p1);
    };

    // 1. Howrah Bridge Festive Illumination
    const deck = this.world.decks.find((d) => d.river && /howrah|rabindra/i.test(d.name)) ||
      this.world.decks.find((d) => d.river && !/vidyasagar/i.test(d.name));

    if (deck && this.world.river) {
      const P = deck.poly;
      const tmp = {};
      let sA = null;
      let sB = null;
      for (let s = 0; s <= P.len; s += 2) {
        P.at(s, tmp);
        if (inPoly(this.world.river, tmp.x, tmp.z)) {
          if (sA === null) sA = s;
          sB = s;
        }
      }

      if (sA !== null) {
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

        // Top chords and cantilever festoons
        const stepS = 18;
        for (const side of [1, -1]) {
          let lastTop = at(s0, side, topH(s0));
          for (let s = s0 + stepS; s <= s1; s += stepS) {
            const curTop = at(s, side, topH(s));
            addSwag(lastTop, curTop, 7, 1.2, 22);

            // Vertical fairy light string down from upper chord
            const bot = at(s, side, 1.5);
            addSwag(curTop, bot, 8, 0.4, 18);
            lastTop = curTop;
          }

          // Deck footway railing lights (running full length across the river)
          for (let s = s0; s < s1 - 8; s += 8) {
            const pA = at(s, side * 1.05, 1.4);
            const pB = at(s + 8, side * 1.05, 1.4);
            addSwag(pA, pB, 4, 0.25, 17);
          }
        }

        // Overhead cross-swags spanning across the road carriageway
        for (let s = s0 + 20; s < s1 - 20; s += 24) {
          const h = Math.min(topH(s), 26);
          const leftP = at(s, 1, h);
          const rightP = at(s, -1, h);
          addSwag(leftP, rightP, 11, 1.5, 24);

          // Hanging drops in the center of the cross-swag
          P.at(s, tmp);
          const midY = (leftP[1] + rightP[1]) * 0.5 - 1.5;
          const dropP0 = [tmp.x, midY, tmp.z];
          const dropP1 = [tmp.x, midY - 3.5, tmp.z];
          addSwag(dropP0, dropP1, 4, 0.1, 20);
        }

        // Tower illuminations at tA and tB
        for (const t of [tA, tB]) {
          for (const h of [22, 38, 56, 76]) {
            const tLeft = at(t, 1, h);
            const tRight = at(t, -1, h);
            addSwag(tLeft, tRight, 10, 0.6, 26);
          }
        }
      }
    }

    // 2. Park Street Festive Street Canopy
    const parkStreetEdges = this.world.graph.edges.filter((e) =>
      /park street|mother teresa/i.test(e.name || '')
    );

    const tmpNode = {};
    const processedSpans = [];

    if (parkStreetEdges.length > 0) {
      for (const e of parkStreetEdges) {
        if (e.len < 16) continue;
        const stepLen = 20;
        for (let s = 10; s < e.len - 10; s += stepLen) {
          e.poly.at(s, tmpNode);
          const off = e.w * 0.5 + 1.2;
          const xL = tmpNode.x + tmpNode.tz * off;
          const zL = tmpNode.z - tmpNode.tx * off;
          const xR = tmpNode.x - tmpNode.tz * off;
          const zR = tmpNode.z + tmpNode.tx * off;
          const yL = this.world.height(xL, zL) + 7.2;
          const yR = this.world.height(xR, zR) + 7.2;

          processedSpans.push({ pL: [xL, yL, zL], pR: [xR, yR, zR], mid: [tmpNode.x, (yL + yR) * 0.5, tmpNode.z] });
        }
      }
    }

    // Fallback if specific edge names were split
    if (processedSpans.length < 10) {
      const PS_WAYPOINTS = [
        [-888, 1209], [-750, 1340], [-620, 1470], [-520, 1590],
        [-425, 1757], [-300, 1870], [-150, 1980], [0, 2070],
        [160, 2150], [320, 2240], [500, 2350], [740, 2520]
      ];
      for (let i = 0; i < PS_WAYPOINTS.length - 1; i++) {
        const [x0, z0] = PS_WAYPOINTS[i];
        const [x1, z1] = PS_WAYPOINTS[i + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const off = 8.5;
        const y0 = this.world.height(x0, z0) + 7.2;
        processedSpans.push({
          pL: [x0 + nx * off, y0, z0 + nz * off],
          pR: [x0 - nx * off, y0, z0 - nz * off],
          mid: [x0, y0, z0]
        });
      }
    }

    // Build Park Street street-spanning zig-zag swags & light curtains
    for (let i = 0; i < processedSpans.length; i++) {
      const cur = processedSpans[i];
      // Overhead cross-street swag
      addSwag(cur.pL, cur.pR, 10, 0.8, 22);

      // Hanging vertical drops ("jhulanta light curtains")
      for (let k = 1; k <= 3; k++) {
        const u = k / 4;
        const hx = lerp(cur.pL[0], cur.pR[0], u);
        const hz = lerp(cur.pL[2], cur.pR[2], u);
        const hy = lerp(cur.pL[1], cur.pR[1], u) - 4.0 * 0.8 * u * (1 - u);
        const dropLen = 2.0 + (k % 2) * 1.5;
        addSwag([hx, hy, hz], [hx, hy - dropLen, hz], 4, 0.1, 18);
      }

      // Longitudinal side-swags connecting poles along the pavements
      if (i < processedSpans.length - 1) {
        const next = processedSpans[i + 1];
        addSwag(cur.pL, next.pL, 6, 0.6, 18);
        addSwag(cur.pR, next.pR, 6, 0.6, 18);
      }

      // Toran / Festival entrance arch at Chowringhee & Allen Park
      if (i === 0 || i === 4) {
        const archTopL = [cur.pL[0], cur.pL[1] + 2.5, cur.pL[2]];
        const archTopR = [cur.pR[0], cur.pR[1] + 2.5, cur.pR[2]];
        addSwag(archTopL, archTopR, 14, 1.2, 28);
        addWire(cur.pL, archTopL);
        addWire(cur.pR, archTopR);
      }
    }

    // Assemble single THREE.Points mesh
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbPositions, 3));
    pointGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(bulbColors, 3));
    pointGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(bulbPhases, 1));
    pointGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(bulbSizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNight: { value: 0 },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const pointsMesh = new THREE.Points(pointGeo, this.material);
    pointsMesh.frustumCulled = false;

    // Assemble connecting wire line segments
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x3d2c1c,
      transparent: true,
      opacity: 0.35,
    });
    const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    wireMesh.frustumCulled = false;

    this.group.add(wireMesh);
    this.group.add(pointsMesh);
  }

  update(dt, playerPos, night) {
    if (!this.enabled) {
      if (this.game && this.game.audio && this.game.audio.updateDhak) {
        this.game.audio.updateDhak(dt, 9999, false);
      }
      return;
    }

    this.time += dt;
    if (this.material) {
      this.material.uniforms.uTime.value = this.time;
      this.material.uniforms.uNight.value = Math.max(0, Math.min(1, night || 0));
    }

    // Distance to nearest festive hub: Howrah Bridge (-1210, -1760) or Park Street
    if (playerPos && this.game && this.game.audio && this.game.audio.updateDhak) {
      const distBridge = Math.hypot(playerPos.x - (-1210), playerPos.z - (-1760));
      const distParkStreet = distToSegment(playerPos.x, playerPos.z, -880, 1220, 600, 2450);
      const minDist = Math.min(distBridge, distParkStreet);

      this.game.audio.updateDhak(dt, minDist, true);
    }
  }
}
