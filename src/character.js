import * as THREE from 'three';
import { clamp, damp, lerp } from './utils.js';

/*
 * Procedural humanoid: rigid body parts skinned to a bone hierarchy, merged into
 * ONE SkinnedMesh per character (one draw call). Animation is fully procedural:
 * locomotion cycles + keyframe-free gesture functions blended with damping.
 */

// name, parent index, local offset in bind pose
const DEF = [
  ['root', -1, 0, 0, 0],
  ['hips', 0, 0, 0.95, 0],
  ['spine', 1, 0, 0.1, 0],
  ['chest', 2, 0, 0.22, 0],
  ['neck', 3, 0, 0.25, 0],
  ['head', 4, 0, 0.08, 0],
  ['shL', 3, 0.19, 0.19, 0],
  ['elL', 6, 0, -0.29, 0],
  ['haL', 7, 0, -0.25, 0],
  ['shR', 3, -0.19, 0.19, 0],
  ['elR', 9, 0, -0.29, 0],
  ['haR', 10, 0, -0.25, 0],
  ['hipL', 1, 0.1, -0.06, 0],
  ['knL', 12, 0, -0.43, 0],
  ['ftL', 13, 0, -0.41, 0],
  ['hipR', 1, -0.1, -0.06, 0],
  ['knR', 15, 0, -0.43, 0],
  ['ftR', 16, 0, -0.41, 0],
];
const NAMES = DEF.map((d) => d[0]);
const IDX = Object.fromEntries(NAMES.map((n, i) => [n, i]));

/* ---------- Print textures (atlas: left half = print, right half = plain white) ---------- */
function printAtlas(base, flowers, leaf) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.save();
  g.beginPath();
  g.rect(0, 0, 256, 256);
  g.clip();
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const a = rnd() * Math.PI;
    g.fillStyle = leaf;
    g.save();
    g.translate(x + 10, y + 8);
    g.rotate(a);
    g.beginPath();
    g.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  for (let i = 0; i < 22; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 9 + rnd() * 9;
    g.fillStyle = flowers[i % flowers.length];
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 + i;
      g.beginPath();
      g.ellipse(x + Math.cos(pa) * r * 0.7, y + Math.sin(pa) * r * 0.7, r * 0.62, r * 0.4, pa, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#fff3b0';
    g.beginPath();
    g.arc(x, y, r * 0.25, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let NPC_MAT = null;
function npcMaterial() {
  if (!NPC_MAT) {
    NPC_MAT = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: printAtlas('#ffffff', ['#9a9a9a', '#c8c8c8', '#7a7a7a'], '#b4b4b4'),
      roughness: 0.68,
    });
  }
  return NPC_MAT;
}
export const OUTFITS = {
  default: {
    id: 'default',
    name: 'Vibe City Tropical',
    bengali: 'রেট্রো প্রিন্ট শার্ট',
    desc: 'Signature cyan floral print shirt, white chinos, and boat loafers',
    price: 0,
    swatch: 'linear-gradient(135deg, #1fb5b0, #ff4f9a)',
    icon: '🌴',
    look: {
      female: false,
      skin: '#c98e6a',
      shirt: '#ffffff',
      print: true,
      pants: '#f4f2ec',
      shoes: '#d9c3a1',
      hair: '#2a1c14',
      longHair: false,
      skirt: false,
      glasses: true,
      shorts: false,
      longSleeve: false,
      scale: 1.02,
      player: true,
    },
    drawAtlas(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#1fb5b0';
      g.fillRect(0, 0, 256, 256);
      let s = 7;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      g.save();
      g.beginPath();
      g.rect(0, 0, 256, 256);
      g.clip();
      for (let i = 0; i < 26; i++) {
        const x = rnd() * 256;
        const y = rnd() * 256;
        const a = rnd() * Math.PI;
        g.fillStyle = '#0d6f62';
        g.save();
        g.translate(x + 10, y + 8);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      const flowers = ['#ff4f9a', '#ffd166', '#ff8a5b', '#ffffff'];
      for (let i = 0; i < 22; i++) {
        const x = rnd() * 256;
        const y = rnd() * 256;
        const r = 9 + rnd() * 9;
        g.fillStyle = flowers[i % flowers.length];
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * Math.PI * 2 + i;
          g.beginPath();
          g.ellipse(x + Math.cos(pa) * r * 0.7, y + Math.sin(pa) * r * 0.7, r * 0.62, r * 0.4, pa, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#fff3b0';
        g.beginPath();
        g.arc(x, y, r * 0.25, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },
  },

  kurta_dhoti: {
    id: 'kurta_dhoti',
    name: 'Classic Kurta & Dhoti',
    bengali: 'ধুতি-পাঞ্জাবি ও নাগরা',
    desc: 'Crisp ivory silk Bengali Panjabi with gold Kantha embroidery, pleated dhoti & leather sandals',
    price: 150,
    swatch: 'linear-gradient(135deg, #fdfbf7, #d4af37)',
    icon: '✨',
    look: {
      female: false,
      skin: '#c98e6a',
      shirt: '#ffffff',
      print: true,
      pants: '#f5f2e9',
      shoes: '#6a3e1f',
      hair: '#2a1c14',
      longHair: false,
      skirt: false,
      glasses: false,
      shorts: false,
      longSleeve: true,
      scale: 1.02,
      player: true,
    },
    drawAtlas(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#fdfbf7';
      g.fillRect(0, 0, 256, 256);

      g.strokeStyle = '#eee5d3';
      g.lineWidth = 0.8;
      for (let x = 6; x < 256; x += 10) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, 256);
        g.stroke();
      }

      g.fillStyle = '#f7eedd';
      g.fillRect(122, 60, 12, 185);
      g.strokeStyle = '#d4af37';
      g.lineWidth = 1.5;
      g.strokeRect(122, 60, 12, 185);

      for (const by of [90, 125, 160, 195, 230]) {
        g.fillStyle = '#c99a2c';
        g.beginPath();
        g.arc(128, by, 3.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#8c6815';
        g.stroke();
      }

      for (const side of [-1, 1]) {
        const kx = 128 + side * 28;
        for (const ky of [130, 180]) {
          g.save();
          g.translate(kx, ky);
          g.fillStyle = '#e8d5a7';
          g.strokeStyle = '#c99a2c';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(0, 12);
          g.bezierCurveTo(side * 14, 10, side * 14, -8, 0, -12);
          g.bezierCurveTo(side * -6, -6, side * -6, 8, 0, 12);
          g.fill();
          g.stroke();
          g.restore();
        }
      }

      g.fillStyle = '#f3e5c8';
      g.fillRect(0, 240, 256, 16);
      g.strokeStyle = '#c99a2c';
      g.lineWidth = 1.5;
      g.strokeRect(0, 240, 256, 16);
      g.fillStyle = '#c99a2c';
      for (let cx = 10; cx < 256; cx += 18) {
        g.beginPath();
        g.arc(cx, 248, 2, 0, Math.PI * 2);
        g.fill();
      }
    },
  },

  taxi_khaki: {
    id: 'taxi_khaki',
    name: 'Kolkata Yellow Taxi Khaki',
    bengali: 'হলুদ ট্যাক্সি ড্রাইভার খাকি',
    desc: 'Official cabbie safari uniform with KOL-TAXI brass badge, button flaps & dark work shoes',
    price: 200,
    swatch: 'linear-gradient(135deg, #c3a270, #f4c51c)',
    icon: '🚕',
    look: {
      female: false,
      skin: '#c98e6a',
      shirt: '#ffffff',
      print: true,
      pants: '#a88752',
      shoes: '#1e1e1e',
      hair: '#2a1c14',
      longHair: false,
      skirt: false,
      glasses: true,
      shorts: false,
      longSleeve: false,
      scale: 1.02,
      player: true,
    },
    drawAtlas(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#c3a270';
      g.fillRect(0, 0, 256, 256);

      g.strokeStyle = '#b5935b';
      g.lineWidth = 1;
      for (let y = 8; y < 256; y += 12) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(256, y);
        g.stroke();
      }

      g.fillStyle = '#b5935b';
      g.fillRect(122, 10, 12, 236);
      g.strokeStyle = '#8d6e3f';
      g.strokeRect(122, 10, 12, 236);
      for (const by of [40, 90, 140, 190]) {
        g.fillStyle = '#4a3219';
        g.beginPath();
        g.arc(128, by, 4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#d4af37';
        g.beginPath();
        g.arc(128, by, 1.5, 0, Math.PI * 2);
        g.fill();
      }

      g.fillStyle = '#b5935b';
      g.fillRect(72, 110, 42, 48);
      g.strokeStyle = '#8d6e3f';
      g.strokeRect(72, 110, 42, 48);
      g.fillStyle = '#a88752';
      g.beginPath();
      g.moveTo(70, 158);
      g.lineTo(116, 158);
      g.lineTo(116, 172);
      g.lineTo(93, 180);
      g.lineTo(70, 172);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#4a3219';
      g.beginPath();
      g.arc(93, 170, 3, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = '#d4af37';
      g.fillRect(74, 188, 38, 14);
      g.strokeStyle = '#634718';
      g.strokeRect(74, 188, 38, 14);
      g.fillStyle = '#1a1a1a';
      g.font = 'bold 8px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('KOL-TAXI', 93, 195);

      g.fillStyle = '#b5935b';
      g.fillRect(142, 110, 42, 48);
      g.strokeStyle = '#8d6e3f';
      g.strokeRect(142, 110, 42, 48);
      g.fillStyle = '#a88752';
      g.beginPath();
      g.moveTo(140, 158);
      g.lineTo(186, 158);
      g.lineTo(186, 172);
      g.lineTo(163, 180);
      g.lineTo(140, 172);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#4a3219';
      g.beginPath();
      g.arc(163, 170, 3, 0, Math.PI * 2);
      g.fill();

      for (const ex of [45, 200]) {
        g.fillStyle = '#a88752';
        g.fillRect(ex, 232, 14, 24);
        g.fillStyle = '#d4af37';
        g.beginPath();
        g.arc(ex + 7, 244, 3, 0, Math.PI * 2);
        g.fill();
      }
    },
  },

  mohun_bagan: {
    id: 'mohun_bagan',
    name: 'Mohun Bagan AC (Maroon & Green)',
    bengali: 'মোহনবাগান (মেরুন ও সবুজ)',
    desc: 'The National Club of India: iconic maroon & green vertical stripes, sailing boat crest & No. 10',
    price: 250,
    swatch: 'linear-gradient(135deg, #781428, #006a3b)',
    icon: '⚽',
    look: {
      female: false,
      skin: '#c98e6a',
      shirt: '#ffffff',
      print: true,
      pants: '#ffffff',
      shoes: '#111111',
      hair: '#2a1c14',
      longHair: false,
      skirt: false,
      glasses: false,
      shorts: true,
      longSleeve: false,
      scale: 1.02,
      player: true,
    },
    drawAtlas(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 256);
      const stripeW = 32;
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 === 0 ? '#006a3b' : '#781428';
        g.fillRect(i * stripeW, 0, stripeW, 256);
      }
      g.strokeStyle = '#ffd700';
      g.lineWidth = 1.5;
      for (let i = 1; i < 8; i++) {
        g.beginPath();
        g.moveTo(i * stripeW, 0);
        g.lineTo(i * stripeW, 256);
        g.stroke();
      }
      g.fillStyle = '#ffffff';
      g.fillRect(0, 242, 256, 14);
      g.fillStyle = '#781428';
      g.fillRect(0, 248, 256, 4);

      g.save();
      g.translate(96, 160);
      g.fillStyle = '#ffd700';
      g.beginPath();
      g.arc(0, 0, 22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#781428';
      g.beginPath();
      g.arc(0, 0, 19, -Math.PI / 2, Math.PI / 2);
      g.fill();
      g.fillStyle = '#006a3b';
      g.beginPath();
      g.arc(0, 0, 19, Math.PI / 2, -Math.PI / 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(-2, 10);
      g.lineTo(-2, -10);
      g.lineTo(11, 2);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffd700';
      g.beginPath();
      g.ellipse(0, 8, 12, 4, 0, 0, Math.PI);
      g.fill();
      g.restore();

      g.fillStyle = '#ffd700';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeText('10', 160, 160);
      g.fillText('10', 160, 160);

      g.font = 'bold 36px sans-serif';
      g.strokeText('10', 20, 150);
      g.fillText('10', 20, 150);
      g.strokeText('10', 236, 150);
      g.fillText('10', 236, 150);
    },
  },

  east_bengal: {
    id: 'east_bengal',
    name: 'East Bengal FC (Red & Gold)',
    bengali: 'ইস্টবেঙ্গল (লাল ও হলুদ)',
    desc: 'Red & golden-yellow brigade: historic flaming torch mashal crest, athletic shorts & No. 7',
    price: 250,
    swatch: 'linear-gradient(135deg, #c41528, #ffcc00)',
    icon: '🔥',
    look: {
      female: false,
      skin: '#c98e6a',
      shirt: '#ffffff',
      print: true,
      pants: '#1a1a1a',
      shoes: '#c41528',
      hair: '#2a1c14',
      longHair: false,
      skirt: false,
      glasses: false,
      shorts: true,
      longSleeve: false,
      scale: 1.02,
      player: true,
    },
    drawAtlas(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#c41528';
      g.fillRect(0, 0, 128, 256);
      g.fillStyle = '#ffcc00';
      g.fillRect(128, 0, 128, 256);

      g.fillStyle = '#ff6d00';
      g.beginPath();
      g.moveTo(110, 0);
      g.lineTo(146, 256);
      g.lineTo(136, 256);
      g.lineTo(100, 0);
      g.closePath();
      g.fill();

      g.fillStyle = '#1a1a1a';
      g.fillRect(0, 244, 256, 12);
      g.fillStyle = '#ffcc00';
      g.fillRect(0, 250, 128, 6);
      g.fillStyle = '#c41528';
      g.fillRect(128, 250, 128, 6);

      g.save();
      g.translate(86, 160);
      g.fillStyle = '#0f172a';
      g.beginPath();
      g.moveTo(-18, -18);
      g.lineTo(18, -18);
      g.lineTo(18, 8);
      g.quadraticCurveTo(18, 22, 0, 26);
      g.quadraticCurveTo(-18, 22, -18, 8);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffd700';
      g.lineWidth = 2;
      g.stroke();

      g.fillStyle = '#ffd700';
      g.fillRect(-3, 2, 6, 16);
      g.fillRect(-6, 2, 12, 4);

      g.fillStyle = '#c41528';
      g.beginPath();
      g.moveTo(-8, 2);
      g.lineTo(-12, -8);
      g.lineTo(-4, -6);
      g.lineTo(0, -16);
      g.lineTo(4, -6);
      g.lineTo(12, -8);
      g.lineTo(8, 2);
      g.closePath();
      g.fill();

      g.fillStyle = '#ffcc00';
      g.beginPath();
      g.moveTo(-5, 0);
      g.lineTo(-7, -6);
      g.lineTo(-2, -4);
      g.lineTo(0, -11);
      g.lineTo(2, -4);
      g.lineTo(7, -6);
      g.lineTo(5, 0);
      g.closePath();
      g.fill();
      g.restore();

      g.fillStyle = '#c41528';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeText('7', 170, 160);
      g.fillText('7', 170, 160);

      g.fillStyle = '#ffffff';
      g.strokeText('7', 20, 150);
      g.fillText('7', 20, 150);
      g.strokeText('7', 236, 150);
      g.fillText('7', 236, 150);
    },
  },

  scholar: {
    id: 'scholar',
    name: 'College Street Scholar',
    bengali: 'কলেজ স্ট্রিট বুদ্ধিজীবী',
    desc: 'Intellectual black Nehru waistcoat over pure white punjabi, dhoti, pen pocket & horn-rimmed frames',
    price: 180,
    swatch: 'linear-gradient(135deg, #1c1c1f, #fdfbf7)',
    icon: '📖',
    look: {
      female: false,
      skin: '#c98e6a',
      shirt: '#ffffff',
      print: true,
      pants: '#f4f1ea',
      shoes: '#5c3a21',
      hair: '#2a1c14',
      longHair: false,
      skirt: false,
      glasses: true,
      shorts: false,
      longSleeve: false,
      scale: 1.02,
      player: true,
    },
    drawAtlas(g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#fafafa';
      g.fillRect(0, 0, 256, 256);

      g.fillStyle = '#1c1c1f';
      g.fillRect(8, 0, 240, 236);

      g.strokeStyle = '#2d2d30';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(128, 0);
      g.lineTo(128, 236);
      g.stroke();

      for (const by of [30, 75, 120, 165, 210]) {
        g.fillStyle = '#3a3a3e';
        g.beginPath();
        g.arc(128, by, 4, 0, Math.PI * 2);
        g.fill();
      }

      g.fillStyle = '#262629';
      g.fillRect(78, 160, 36, 6);
      g.fillStyle = '#d4af37';
      g.fillRect(92, 163, 4, 16);
      g.beginPath();
      g.arc(94, 179, 3, 0, Math.PI * 2);
      g.fill();

      for (const px of [68, 152]) {
        g.fillStyle = '#262629';
        g.fillRect(px, 55, 36, 5);
      }

      g.fillStyle = '#ffffff';
      g.fillRect(0, 236, 256, 20);
      g.fillStyle = '#1c1c1f';
      g.fillRect(0, 248, 256, 8);
    },
  },
};

export function playerMaterial(outfitId) {
  const savedId = outfitId || (typeof localStorage !== 'undefined' ? localStorage.getItem('vibe_city_outfit') : null) || 'default';
  const outfit = OUTFITS[savedId] || OUTFITS.default;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  outfit.drawAtlas(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: t,
    roughness: 0.7,
  });
}

/* ---------- Look randomiser ---------- */
// Kolkata crowds: South Asian skin tones, mostly black hair, whites, pastels and kurta colours
const SKINS = ['#d8ab86', '#c99a74', '#b9875f', '#a8764f', '#9a6948', '#8a5a3c', '#7a4b31', '#c08c64'];
const SHIRTS = ['#ffffff', '#f5f1e6', '#ffffff', '#cfe3f2', '#e8d9a8', '#f2c14e', '#d9534f', '#2e6da4', '#8e44ad', '#e67e22', '#3c8d5a', '#d4a5a5', '#2d2d33', '#f4e1c1'];
const PANTS = ['#f2f0ea', '#d8c7a3', '#2b2f38', '#3d4f6b', '#3d3b39', '#e9dcc0', '#1f2a44', '#6b5a48'];
const HAIR = ['#120d0a', '#1a1310', '#1f1611', '#2a1d14', '#120d0a', '#3b2618', '#8a8a86'];

export function randomLook(rng = Math.random) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const female = rng() < 0.45;
  return {
    female,
    skin: pick(SKINS),
    shirt: pick(SHIRTS),
    print: rng() < 0.35,
    pants: pick(PANTS),
    shoes: pick(['#1c1c1c', '#f0f0f0', '#7a5230', '#d9c3a1']),
    hair: pick(HAIR),
    longHair: female ? rng() < 0.92 : rng() < 0.04,
    skirt: female && rng() < 0.7,
    shorts: rng() < 0.08,
    longSleeve: rng() < 0.35,
    eyes: pick(['#3b2a1e', '#2f4f7a', '#3f6b3a', '#5a3a1e']),
    glasses: rng() < 0.35,
    scale: female ? 0.93 + rng() * 0.06 : 0.97 + rng() * 0.08,
  };
}

export const PLAYER_LOOK = {
  female: false,
  skin: '#c98e6a',
  shirt: '#ffffff',
  print: true,
  pants: '#f4f2ec',
  shoes: '#d9c3a1',
  hair: '#2a1c14',
  longHair: false,
  skirt: false,
  glasses: true,
  shorts: false,
  longSleeve: false,
  scale: 1.02,
  player: true,
};

/* ---------- Geometry ---------- */
// Joint heights in the bind pose (metres)
const J = { hip: 0.89, knee: 0.46, ankle: 0.07, waist: 1.05, chest: 1.24, neck: 1.52, head: 1.6, sh: 1.44, elbow: 1.17, wrist: 0.92 };

// Skin weights: blend between consecutive bones of a chain around each joint height.
const chain = (bones, joints, r) => (y) => {
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    if (y > j + r) return [[IDX[bones[i]], 1]];
    if (y >= j - r) {
      const wl = (j + r - y) / (2 * r);
      return [[IDX[bones[i]], 1 - wl], [IDX[bones[i + 1]], wl]];
    }
  }
  return [[IDX[bones[bones.length - 1]], 1]];
};
const rigid = (bone) => () => [[IDX[bone], 1]];

const V2 = (r, y) => new THREE.Vector2(r, y);
function lathe(points, seg) {
  return new THREE.LatheGeometry(points.map(([r, y]) => V2(r, y)), seg);
}

function buildGeometry(look) {
  const hi = !!look.player;
  const S = hi ? 22 : 14; // radial segments
  const parts = [];
  // colour: hex or fn(y) ; print: bool or fn(y)
  const P = (geo, weights, color, print = false) => parts.push({ geo, weights, color, print });
  const sph = (r, x, y, z, sx = 1, sy = 1, sz = 1, ws = S, hs = Math.round(S * 0.7)) => new THREE.SphereGeometry(r, ws, hs).scale(sx, sy, sz).translate(x, y, z);
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cap = (r, len, x, y, z) => new THREE.CapsuleGeometry(r, len, 3, 8).translate(x, y, z);
  const { skin, shirt, pants, shoes, hair, female } = look;
  const sw = female ? 0.9 : 1;
  const lowerLeg = look.skirt || look.shorts ? skin : pants;
  const lip = new THREE.Color(skin).lerp(new THREE.Color('#b0505a'), 0.45);

  /* Torso: one smooth lathed shape — pants below the waist, shirt above */
  const torsoPts = female
    ? [[0.001, 0.84], [0.11, 0.86], [0.15, 0.9], [0.168, 0.97], [0.15, 1.04], [0.125, 1.1], [0.128, 1.17], [0.15, 1.26], [0.158, 1.33], [0.16, 1.39], [0.15, 1.44], [0.11, 1.49], [0.055, 1.52]]
    : [[0.001, 0.84], [0.115, 0.86], [0.15, 0.9], [0.16, 0.97], [0.152, 1.04], [0.14, 1.1], [0.145, 1.17], [0.165, 1.26], [0.18, 1.33], [0.186, 1.39], [0.175, 1.44], [0.125, 1.49], [0.06, 1.53]];
  const torso = lathe(torsoPts, S + 4).scale(1.16 * sw, 1, 0.72);
  const shirtTop = look.skirt ? 0.84 : 1.035;
  P(torso, chain(['hips', 'spine', 'chest'], [J.waist, J.chest], 0.07), (y) => (y < shirtTop ? pants : shirt), (y) => look.print && y >= shirtTop);
  // Belt + buckle, collar, buttons, open neckline
  if (!look.skirt) {
    P(new THREE.TorusGeometry(0.155, 0.014, 6, S + 4).rotateX(Math.PI / 2).scale(1.16 * sw, 1, 0.74).translate(0, 1.035, 0), rigid('hips'), '#2e2118');
    P(box(0.045, 0.03, 0.012, 0, 1.035, 0.115), rigid('hips'), '#d8b25a');
  }
  if (look.skirt) P(lathe([[0.27, 0.6], [0.24, 0.7], [0.19, 0.84], [0.16, 0.95]], S + 4).scale(1.1, 1, 0.8), rigid('hips'), shirt);
  P(new THREE.TorusGeometry(0.07, 0.016, 6, S, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(Math.PI * 0.8).scale(1.1, 1, 1).translate(0, 1.5, 0.01), rigid('chest'), shirt);
  P(sph(0.055, 0, 1.445, 0.104, 1, 1.5, 0.32), rigid('chest'), skin);
  for (const by of [1.37, 1.29, 1.21, 1.13]) P(sph(0.007, 0, by, 0.128 - (1.37 - by) * 0.05, 1, 1, 0.5, 6, 4), rigid('chest'), '#f5f1e6');

  /* Neck & head */
  P(lathe([[0.058, 1.49], [0.052, 1.54], [0.05, 1.6], [0.055, 1.64]], S), chain(['chest', 'neck', 'head'], [J.neck, J.head], 0.03), skin);
  const H = 'head';
  P(sph(0.104, 0, 1.712, -0.005, 0.86, 1.05, 1), rigid(H), skin); // cranium
  P(sph(0.078, 0, 1.648, 0.024, 0.95, 0.78, 1), rigid(H), skin); // jaw
  P(sph(0.028, 0, 1.612, 0.07, 1.1, 0.8, 0.9, 10, 8), rigid(H), skin); // chin
  P(new THREE.ConeGeometry(0.017, 0.045, 8).rotateX(Math.PI / 2 + 0.35).translate(0, 1.686, 0.1), rigid(H), skin); // nose
  P(sph(0.021, 0, 1.643, 0.092, 1.45, 0.42, 0.55, 10, 6), rigid(H), lip); // lips
  for (const s of [1, -1]) {
    P(sph(0.026, 0.094 * s, 1.698, -0.002, 0.42, 1, 0.75, 8, 6), rigid(H), skin); // ears
    if (!look.glasses) {
      P(sph(0.0155, 0.034 * s, 1.716, 0.085, 1, 0.8, 0.6, 10, 8), rigid(H), '#f4f1ec'); // sclera
      P(sph(0.009, 0.034 * s, 1.716, 0.094, 1, 1, 0.4, 8, 6), rigid(H), look.eyes || '#3b2a1e'); // iris
    }
    P(box(0.042, 0.009, 0.012, 0.036 * s, 1.742, 0.092).rotateZ(-0.12 * s), rigid(H), hair); // brows
  }
  // Hair
  P(new THREE.SphereGeometry(0.112, S, 12, 0, Math.PI * 2, 0, Math.PI * (look.longHair ? 0.62 : 0.52)).scale(0.9, 1.06, 1.04).translate(0, 1.71, -0.012), rigid(H), hair);
  if (look.longHair) P(cap(0.1, 0.24, 0, 1.58, -0.055).scale(1.08, 1, 0.62), rigid(H), hair);
  else P(sph(0.1, 0, 1.69, -0.03, 0.88, 0.75, 0.9, S, 10), rigid(H), hair); // back of head
  if (look.glasses) {
    for (const s of [1, -1]) P(box(0.072, 0.042, 0.012, 0.038 * s, 1.716, 0.098), rigid(H), '#08080a');
    P(box(0.03, 0.01, 0.01, 0, 1.722, 0.1), rigid(H), '#c9a64a');
    for (const s of [1, -1]) P(box(0.008, 0.012, 0.11, 0.092 * s, 1.722, 0.045), rigid(H), '#c9a64a');
  }

  /* Arms */
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const x = 0.19 * s * sw;
    const armW = chain(['chest', 'sh' + side, 'el' + side, 'ha' + side], [1.47, J.elbow, J.wrist], 0.045);
    P(sph(0.066, x, 1.435, 0, 1, 0.95, 1.05), (y) => [[IDX.chest, 0.35], [IDX['sh' + side], 0.65]], shirt, look.print);
    const upper = lathe([[0.043, 1.15], [0.047, 1.2], [0.053, 1.29], [0.056, 1.36], [0.055, 1.42], [0.04, 1.48]], S).translate(x, 0, 0);
    P(upper, armW, (y) => (y > (look.longSleeve ? 0 : 1.31) ? shirt : skin), (y) => look.print && y > 1.31);
    if (!look.longSleeve) P(lathe([[0.062, 1.3], [0.064, 1.33], [0.063, 1.4]], S).translate(x, 0, 0), armW, shirt, look.print);
    P(lathe([[0.029, 0.9], [0.032, 0.94], [0.04, 1.02], [0.045, 1.09], [0.045, 1.15], [0.043, 1.19]], S).translate(x, 0, 0), armW, look.longSleeve ? shirt : skin);
    if (side === 'L') P(new THREE.TorusGeometry(0.034, 0.008, 6, 14).rotateX(Math.PI / 2).translate(x, 0.945, 0), armW, '#c9a64a');
    // Hand: palm, four fingers, thumb (palm faces the thigh)
    const HB = rigid('ha' + side);
    P(box(0.028, 0.08, 0.072, x, 0.875, 0.004), HB, skin);
    for (let f = 0; f < 4; f++) P(cap(0.0085, 0.045 - Math.abs(f - 1.5) * 0.006, x, 0.81, -0.026 + f * 0.017).rotateX(0.1), HB, skin);
    P(cap(0.01, 0.035, x - 0.008 * s, 0.86, 0.045).rotateX(-0.3).translate(0, 0.25 * 0.86 * 0.0, 0), HB, skin);

    /* Legs */
    const lx = 0.095 * s;
    const legW = chain(['hips', 'hip' + side, 'kn' + side, 'ft' + side], [0.9, J.knee, J.ankle], 0.05);
    P(lathe([[0.058, 0.44], [0.066, 0.52], [0.078, 0.66], [0.085, 0.78], [0.088, 0.86], [0.08, 0.93]], S).translate(lx, 0, 0), legW, look.skirt ? skin : pants);
    const shortsHem = look.shorts ? 0.5 : -1;
    P(lathe([[0.038, 0.07], [0.042, 0.12], [0.055, 0.25], [0.058, 0.33], [0.052, 0.42], [0.058, 0.49]], S).translate(lx, 0, 0), legW, (y) => (y < shortsHem || look.skirt || look.shorts ? skin : pants));
    if (look.shorts) P(lathe([[0.082, 0.5], [0.09, 0.6]], S).translate(lx, 0, 0), legW, pants);
    // Shoe: sole + rounded upper
    const FB = rigid('ft' + side);
    P(box(0.092, 0.028, 0.255, lx, 0.014, 0.045), FB, '#1a1a1a');
    P(sph(0.052, lx, 0.055, 0.05, 0.92, 0.62, 2.1), FB, shoes);
    P(lathe([[0.045, 0.06], [0.048, 0.11]], 12).translate(lx, 0, -0.005), FB, shoes);
  }

  /* Merge — indexed, with up to two bone weights per vertex */
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const si = [];
  const swt = [];
  const index = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo;
    const a = g.attributes;
    const base = pos.length / 3;
    const colorFn = typeof p.color === 'function' ? p.color : null;
    const printFn = typeof p.print === 'function' ? p.print : null;
    if (!colorFn) c.set(p.color);
    for (let i = 0; i < a.position.count; i++) {
      const x = a.position.getX(i);
      const y = a.position.getY(i);
      const z = a.position.getZ(i);
      pos.push(x, y, z);
      nor.push(a.normal.getX(i), a.normal.getY(i), a.normal.getZ(i));
      const printed = printFn ? printFn(y) : p.print;
      if (printed && a.uv) uv.push(a.uv.getX(i) * 0.48 + 0.01, a.uv.getY(i) * 0.96 + 0.02);
      else uv.push(0.75, 0.5);
      if (colorFn) c.set(colorFn(y));
      col.push(c.r, c.g, c.b);
      const w = p.weights(y);
      si.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0);
      swt.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(g.index.getX(i) + base);
    else for (let i = 0; i < a.position.count; i++) index.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(swt, 4));
  geo.setIndex(index);
  return geo;
}

/* ---------- Pose helpers ---------- */
function zeroPose(P) {
  for (const n of NAMES) {
    const b = P[n] || (P[n] = [0, 0, 0]);
    b[0] = b[1] = b[2] = 0;
  }
  P.hipsY = 0;
  return P;
}
// f = raise forward, o = raise outward, t = twist outward (all mirrored for the right side)
const arm = (P, side, f, o = 0, t = 0) => {
  const s = side === 'L' ? 1 : -1;
  const b = P['sh' + side];
  b[0] = -f;
  b[1] = t * s;
  b[2] = o * s;
};
const elbow = (P, side, bend, up = 0) => {
  const s = side === 'L' ? 1 : -1;
  const b = P['el' + side];
  b[0] = -bend;
  b[2] = up * s;
};
const leg = (P, side, f, o = 0) => {
  const s = side === 'L' ? 1 : -1;
  P['hip' + side][0] = -f;
  P['hip' + side][2] = o * s;
};
const knee = (P, side, b) => {
  P['kn' + side][0] = b;
};
/** Pose helpers for mini-games that drive a character with their own poses (mode 'pose', poseFn). */
export const POSE = { arm, elbow, leg, knee };

/**
 * Gait cycle. phase runs 0..2π per stride (two steps); the left thigh is fully
 * forward at π/2. Walking keeps a foot on the ground with a soft knee at heel
 * strike; running adds a flight phase, a deep swing-leg tuck, pumping arms and
 * forward lean. turn (rad/s) leans the body into corners.
 */
function locomotion(P, T, phase, v, turn = 0) {
  const w = clamp(v / 1.2, 0, 1); // moving at all
  const r = clamp((v - 2.4) / 3.2, 0, 1); // walk -> run blend
  const rs = r * r * (3 - 2 * r);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const hip = lerp(0.36, 0.72, rs) * w;
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    const ss = s * sg; // > 0: this thigh ahead
    const cs = c * sg; // > 0: this leg swinging forward
    // Thigh: runners kick the leg further forward than back
    const th = ss * hip + (ss > 0 ? ss * 0.12 * rs : 0) * w;
    leg(P, side, th, 0.02);
    // Knee: small give after heel strike, big fold through the swing
    const load = Math.max(0, ss) * Math.max(0, -cs) * lerp(0.35, 0.6, rs);
    const swing = Math.pow(Math.max(0, cs), lerp(1.6, 1.1, rs)) * lerp(1.0, 2.05, rs);
    const kb = w * (0.06 + load + swing + rs * 0.25);
    knee(P, side, kb);
    // Ankle: toes up at heel strike, roll through, push off with the toes, clear in swing
    const flat = th - kb;
    const push = Math.max(0, -ss) * Math.max(0, -cs) * lerp(0.35, 0.55, rs);
    const heel = Math.max(0, ss) * Math.max(0, cs * -1 + 0.4) * 0.12;
    P['ft' + side][0] = w * (flat * 0.85 + push - heel - (cs > 0 ? 0.12 : 0));
  }
  // Arms swing against the legs; elbows fold as the pace picks up
  const as = lerp(0.3, 0.75, rs) * w;
  for (const [side, sg] of [['L', -1], ['R', 1]]) {
    const ss = s * sg;
    arm(P, side, ss * as + rs * 0.15, 0.07 + rs * 0.06, rs * 0.25);
    elbow(P, side, lerp(0.18, 1.55, rs) * w + Math.max(0, ss) * lerp(0.25, 0.35, rs) * w + 0.08);
  }
  // Torso: forward lean with speed, pelvis twists with the legs, chest counters it
  P.spine[0] = 0.03 + 0.18 * rs * w;
  P.chest[0] = 0.04 * rs * w;
  P.hips[1] = -s * lerp(0.12, 0.16, rs) * w;
  P.chest[1] = s * lerp(0.16, 0.22, rs) * w;
  P.hips[2] = c * 0.045 * w * (1 - rs);
  P.chest[2] = -c * 0.03 * w * (1 - rs);
  // Lean into turns
  const lean = clamp(-turn * v * 0.028, -0.3, 0.3);
  P.hips[2] += lean;
  P.chest[2] += lean * 0.3;
  // Head stays level and looks ahead
  P.head[0] = -(P.spine[0] + P.chest[0]) * 0.75;
  P.head[1] = -(P.hips[1] + P.chest[1]) * 0.8;
  P.neck[2] = -lean * 0.4;
  // Body bob: highest at mid-stance when walking, in flight when running
  const bob = Math.cos(2 * phase);
  P.hipsY = w * (lerp(0.022 * bob - 0.018, -0.03 * bob - 0.07, rs));
  // Idle: breathing, a slow weight shift and the occasional glance around
  const idle = 1 - w;
  if (idle > 0) {
    const sway = Math.sin(T * 0.55);
    P.chest[0] += Math.sin(T * 1.6) * 0.02 * idle;
    P.hips[2] += sway * 0.035 * idle;
    P.chest[2] -= sway * 0.025 * idle;
    leg(P, 'L', P.hipL[0] * -1, 0.02 + Math.max(0, sway) * 0.05 * idle);
    knee(P, 'R', P.knR[0] + Math.max(0, sway) * 0.12 * idle);
    knee(P, 'L', P.knL[0] + Math.max(0, -sway) * 0.12 * idle);
    P.head[1] += (Math.sin(T * 0.37) * 0.25 + Math.sin(T * 0.13) * 0.2) * idle;
    for (const side of ['L', 'R']) {
      const b = P['sh' + side];
      if (Math.abs(b[2]) < 0.09) b[2] = (side === 'L' ? 1 : -1) * (0.07 + Math.sin(T * 1.6) * 0.01 * idle);
    }
    elbow(P, 'L', Math.max(P.elL[0] * -1, 0.15 * idle));
    elbow(P, 'R', Math.max(P.elR[0] * -1, 0.15 * idle));
  }
}

/* ---------- Gestures ---------- */
export const EMOTES = {
  wave: {
    dur: 2.4,
    fn(P, t) {
      arm(P, 'R', 0.25, 1.45);
      elbow(P, 'R', 0.15, 1.25 + Math.sin(t * 9) * 0.38);
      P.head[2] = -0.1;
      P.chest[1] = -0.1;
    },
  },
  dance: {
    dur: 9999,
    loop: true,
    fn(P, t) {
      const b = t * 2.2;
      const sw = Math.sin(b * Math.PI);
      const bounce = Math.abs(sw);
      P.hipsY = -0.07 + bounce * 0.05;
      P.hips[2] = sw * 0.12;
      P.hips[1] = Math.sin(b * Math.PI * 0.5) * 0.25;
      P.chest[2] = -sw * 0.12;
      P.head[2] = sw * 0.14;
      P.head[0] = bounce * 0.1;
      leg(P, 'L', 0.22, 0.08);
      leg(P, 'R', 0.22, 0.08);
      knee(P, 'L', 0.35 + bounce * 0.25 * (sw > 0 ? 1.4 : 0.6));
      knee(P, 'R', 0.35 + bounce * 0.25 * (sw < 0 ? 1.4 : 0.6));
      const seq = Math.floor(b / 4) % 4;
      if (seq === 0 || seq === 1) {
        const up = seq === 0 ? 'R' : 'L';
        const dn = seq === 0 ? 'L' : 'R';
        const hit = Math.floor(b) % 2 === 0;
        arm(P, up, hit ? 0.3 : 0.9, hit ? 2.5 : 0.4, 0);
        elbow(P, up, 0.05);
        arm(P, dn, -0.2, 0.55);
        elbow(P, dn, 1.7);
      } else if (seq === 2) {
        for (const [side, ph] of [['L', 0], ['R', Math.PI]]) {
          arm(P, side, 0.9 + Math.sin(b * Math.PI * 2 + ph) * 0.3, 0.2);
          elbow(P, side, 1.8 + Math.cos(b * Math.PI * 2 + ph) * 0.3);
        }
      } else {
        arm(P, 'L', 0.2, 2.6 + sw * 0.25);
        arm(P, 'R', 0.2, 2.6 - sw * 0.25);
        elbow(P, 'L', 0.2, 0.3);
        elbow(P, 'R', 0.2, 0.3);
      }
    },
  },
  point: {
    dur: 1.8,
    fn(P) {
      arm(P, 'R', 1.5, 0.15);
      elbow(P, 'R', 0.05);
      P.chest[1] = -0.2;
      P.head[1] = -0.1;
      arm(P, 'L', 0, 0.12);
    },
  },
  thumbsUp: {
    dur: 1.9,
    fn(P, t) {
      arm(P, 'R', 0.55, 0.3);
      elbow(P, 'R', 1.55);
      P.haR[1] = -0.6;
      P.head[0] = Math.sin(t * 8) * 0.12;
      P.chest[0] = -0.06;
    },
  },
  cheer: {
    dur: 2.6,
    fn(P, t) {
      arm(P, 'L', 0.15, 2.75 + Math.sin(t * 10) * 0.15);
      arm(P, 'R', 0.15, 2.75 - Math.sin(t * 10) * 0.15);
      elbow(P, 'L', 0.25);
      elbow(P, 'R', 0.25);
      const j = Math.max(0, Math.sin(t * 6));
      P.hipsY = j * 0.14 - 0.03;
      knee(P, 'L', 0.2 + (1 - j) * 0.3);
      knee(P, 'R', 0.2 + (1 - j) * 0.3);
      leg(P, 'L', 0.1 + (1 - j) * 0.15);
      leg(P, 'R', 0.1 + (1 - j) * 0.15);
      P.head[0] = -0.25;
    },
  },
  shrug: {
    dur: 1.7,
    fn(P) {
      for (const side of ['L', 'R']) {
        arm(P, side, 0.3, 0.32, 0.75);
        elbow(P, side, 1.55);
      }
      P.head[2] = 0.22;
      P.chest[0] = -0.06;
      P.hipsY = 0.01;
    },
  },
  flex: {
    dur: 2.2,
    fn(P, t) {
      const sh = Math.sin(t * 22) * 0.03;
      for (const side of ['L', 'R']) {
        arm(P, side, 0.05, 1.45 + sh);
        elbow(P, side, 0.05, 1.95);
      }
      P.chest[0] = -0.12;
      P.head[0] = -0.12;
      leg(P, 'L', 0, 0.12);
      leg(P, 'R', 0, 0.12);
    },
  },
  laugh: {
    dur: 2.2,
    fn(P, t) {
      P.spine[0] = -0.16 + Math.sin(t * 14) * 0.04;
      P.head[0] = -0.3 + Math.sin(t * 14) * 0.05;
      for (const side of ['L', 'R']) {
        arm(P, side, 0.35, 0.1, -0.4);
        elbow(P, side, 1.7);
      }
    },
  },
  talk: {
    dur: 2.2,
    fn(P, t) {
      arm(P, 'R', 0.45 + Math.sin(t * 3) * 0.2, 0.15, 0.3);
      elbow(P, 'R', 1.35 + Math.sin(t * 4.2) * 0.35);
      arm(P, 'L', 0.25 + Math.cos(t * 2.4) * 0.15, 0.12, 0.3);
      elbow(P, 'L', 1.1 + Math.cos(t * 3.1) * 0.3);
      P.head[1] = Math.sin(t * 2) * 0.15;
      P.head[0] = Math.sin(t * 5) * 0.05;
    },
  },
  phone: {
    dur: 9999,
    loop: true,
    fn(P, t) {
      arm(P, 'R', 0.35, 0.45, -0.3);
      elbow(P, 'R', 2.5);
      P.head[2] = -0.15;
      P.head[1] = Math.sin(t * 0.7) * 0.2;
      arm(P, 'L', 0.1, 0.4);
      elbow(P, 'L', 1.6);
    },
  },
  hit: {
    dur: 0.45,
    fn(P, t) {
      const k = Math.sin(Math.min(1, t / 0.45) * Math.PI);
      P.spine[0] = -0.3 * k;
      P.head[0] = -0.45 * k;
      P.chest[1] = 0.25 * k;
      arm(P, 'L', 0.2, 0.5 * k);
      arm(P, 'R', 0.3, 0.6 * k);
      knee(P, 'L', 0.3 * k);
      P.hipsY = -0.05 * k;
    },
  },
  cower: {
    dur: 1.6,
    fn(P) {
      leg(P, 'L', 0.7);
      leg(P, 'R', 0.7);
      knee(P, 'L', 1.1);
      knee(P, 'R', 1.1);
      P.hipsY = -0.25;
      P.spine[0] = 0.45;
      for (const side of ['L', 'R']) {
        arm(P, side, 1.6, 0.3);
        elbow(P, side, 2.0);
      }
      P.head[0] = 0.3;
    },
  },
};
export const EMOTE_LIST = ['wave', 'dance', 'point', 'thumbsUp', 'cheer', 'shrug', 'flex', 'laugh'];
export const EMOTE_LABELS = { wave: 'Wave', dance: 'Dance', point: 'Point', thumbsUp: 'Thumbs Up', cheer: 'Cheer', shrug: 'Shrug', flex: 'Flex', laugh: 'Laugh' };

/* =========================================================
   Character
   ========================================================= */
export class Character {
  constructor(scene, look, material) {
    if (look && look.player) {
      const savedId = typeof localStorage !== 'undefined' ? localStorage.getItem('vibe_city_outfit') : null;
      if (savedId && OUTFITS[savedId]) {
        look = { ...look, ...OUTFITS[savedId].look, outfitId: savedId };
      }
    }
    const geo = buildGeometry(look);
    const mat = material || npcMaterial();
    const bones = DEF.map(([name, , x, y, z]) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      return b;
    });
    DEF.forEach(([, p], i) => {
      if (p >= 0) bones[p].add(bones[i]);
    });
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.scale.setScalar(look.scale || 1);
    this.mesh = mesh;
    this.bones = Object.fromEntries(NAMES.map((n, i) => [n, bones[i]]));
    this.look = look;
    this.outfitId = (look && look.outfitId) || 'default';
    scene.add(mesh);

    this.speed = 0;
    this.phase = 0;
    this.mode = 'move'; // move | air | sit | ride | down | pose (poseFn(P, T) sets the pose)
    this.poseFn = null;
    this.emote = null;
    this.emoteT = 0;
    this.atk = null; // jab | cross | kick | swing
    this.atkT = -1;
    this.hold = null; // { kind: pistol | rifle | bat, raised, pitch }
    this.steer = 0;
    this.turn = 0; // yaw rate, for leaning into corners
    this.P = zeroPose({});
    this.hipsY = 0;
  }

  setOutfit(outfitId) {
    const outfit = typeof outfitId === 'string' ? OUTFITS[outfitId] : outfitId;
    if (!outfit) return;
    this.outfitId = outfit.id;
    const canvas = this.mesh.material && this.mesh.material.map && this.mesh.material.map.image;
    if (canvas && canvas.getContext) {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 512, 256);
      outfit.drawAtlas(g);
      this.mesh.material.map.needsUpdate = true;
    }
    const newLook = { ...this.look, ...outfit.look, outfitId: outfit.id };
    const newGeo = buildGeometry(newLook);
    this.mesh.geometry.dispose();
    this.mesh.geometry = newGeo;
    this.mesh.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    this.look = newLook;
    try {
      localStorage.setItem('vibe_city_outfit', outfit.id);
    } catch {}
  }

  play(name) {
    if (this.emote === name && EMOTES[name].loop) return;
    this.emote = name;
    this.emoteT = 0;
  }
  stopEmote() {
    this.emote = null;
  }
  punch() {
    return this.attack('jab');
  }
  attack(kind) {
    if (this.atkT >= 0) return false;
    this.atk = kind;
    this.atkT = 0;
    this.emote = null;
    return true;
  }
  get attacking() {
    return this.atkT >= 0;
  }
  get busy() {
    return !!this.emote || this.atkT >= 0;
  }

  update(dt, T) {
    const P = zeroPose(this.P);
    let k = 11;
    if (this.mode === 'sit') {
      leg(P, 'L', 1.45, 0.08);
      leg(P, 'R', 1.45, 0.08);
      knee(P, 'L', 1.35);
      knee(P, 'R', 1.35);
      P.spine[0] = -0.12;
      P.chest[2] = -this.steer * 0.1;
      for (const side of ['L', 'R']) {
        arm(P, side, 1.05 + (side === 'L' ? this.steer : -this.steer) * 0.2, 0.12);
        elbow(P, side, 0.65);
      }
      P.head[1] = -this.steer * 0.25;
    } else if (this.mode === 'ride') {
      // Motorbike: knees tucked against the tank, leaning on the bars
      leg(P, 'L', 1.1, 0.22);
      leg(P, 'R', 1.1, 0.22);
      knee(P, 'L', 1.75);
      knee(P, 'R', 1.75);
      P.ftL[0] = -0.4;
      P.ftR[0] = -0.4;
      P.spine[0] = 0.4;
      P.chest[0] = 0.1;
      P.head[0] = -0.45;
      for (const side of ['L', 'R']) {
        arm(P, side, 1.05 + (side === 'L' ? this.steer : -this.steer) * 0.15, 0.32);
        elbow(P, side, 0.55);
      }
    } else if (this.mode === 'down') {
      P.hips[0] = -1.5;
      P.hipsY = -0.8;
      arm(P, 'L', 0.3, 1.0);
      arm(P, 'R', -0.2, 0.8);
      elbow(P, 'L', 0.6);
      knee(P, 'L', 0.5);
      leg(P, 'L', 0.35);
      P.head[0] = -0.3;
      P.head[1] = 0.5;
      k = 7;
    } else if (this.mode === 'pose') {
      if (this.poseFn) this.poseFn(P, T);
      k = this.poseK || 14;
    } else if (this.mode === 'air') {
      leg(P, 'L', 0.55);
      leg(P, 'R', 0.15);
      knee(P, 'L', 1.1);
      knee(P, 'R', 0.6);
      arm(P, 'L', 0.4, 0.7);
      arm(P, 'R', -0.2, 0.7);
      elbow(P, 'L', 0.8);
      elbow(P, 'R', 0.5);
      k = 14;
    } else {
      // Stride length grows from ~1.4 m walking to ~2.9 m sprinting
      this.phase += (dt * this.speed * Math.PI * 2) / lerp(1.4, 2.9, clamp((this.speed - 2.4) / 4.5, 0, 1));
      locomotion(P, T, this.phase, this.speed, this.turn);
      if (this.emote) {
        const e = EMOTES[this.emote];
        this.emoteT += dt;
        e.fn(P, this.emoteT, T);
        if (!e.loop && this.emoteT > e.dur) this.emote = null;
      }
    }
    if (this.mode === 'move' || this.mode === 'air') this.holdPose(P);
    if (this.atkT >= 0) {
      k = 26;
      if (this.attackPose(P, this.atk, this.atkT)) this.atkT = -1;
      else this.atkT += dt;
    }

    // Blend toward target
    const b = this.bones;
    for (const n of NAMES) {
      const r = b[n].rotation;
      const tp = P[n];
      r.x = damp(r.x, tp[0], k, dt);
      r.y = damp(r.y, tp[1], k, dt);
      r.z = damp(r.z, tp[2], k, dt);
    }
    this.hipsY = damp(this.hipsY, P.hipsY, k, dt);
    b.hips.position.y = 0.95 + this.hipsY;
  }

  /** Upper-body pose for whatever is in the hands. */
  holdPose(P) {
    const h = this.hold;
    if (!h || this.atkT >= 0) return;
    const p = clamp(h.pitch || 0, -1, 1);
    if (h.kind === 'pistol') {
      if (h.raised) {
        arm(P, 'R', 1.5 + p, -0.08);
        elbow(P, 'R', 0.05);
        arm(P, 'L', 1.42 + p, -0.42);
        elbow(P, 'L', 0.4);
        P.chest[1] = 0.12;
        P.head[0] = -p * 0.4;
      } else {
        arm(P, 'R', 0.3, 0.1);
        elbow(P, 'R', 0.45);
      }
    } else if (h.kind === 'rifle') {
      if (h.raised) {
        arm(P, 'R', 1.0 + p, 0.35);
        elbow(P, 'R', 1.3);
        arm(P, 'L', 1.35 + p, -0.5);
        elbow(P, 'L', 0.45);
        P.chest[1] = -0.25;
        P.head[1] = 0.25;
        P.head[0] = -p * 0.4;
      } else {
        arm(P, 'R', 0.5, 0.2);
        elbow(P, 'R', 1.3);
        arm(P, 'L', 0.8, -0.45);
        elbow(P, 'L', 1.4);
        P.chest[1] = -0.1;
      }
    } else if (h.kind === 'bat') {
      // resting on the right shoulder
      arm(P, 'R', 0.35, 0.25);
      elbow(P, 'R', 2.1);
    } else if (h.kind === 'fists' && h.raised) {
      // fighting guard
      arm(P, 'L', 0.9, 0.2);
      elbow(P, 'L', 2.1);
      arm(P, 'R', 0.75, 0.25);
      elbow(P, 'R', 2.2);
      P.chest[1] = -0.15;
    }
  }

  /** Strike animations. Returns true when finished. */
  attackPose(P, kind, t) {
    const guard = (side) => {
      arm(P, side, 0.9, 0.2);
      elbow(P, side, 2.1);
    };
    if (kind === 'jab' || kind === 'cross') {
      const S = kind === 'jab' ? 'R' : 'L';
      const O = kind === 'jab' ? 'L' : 'R';
      const tw = kind === 'jab' ? 1 : -1;
      guard(O);
      if (t < 0.1) {
        arm(P, S, 0.6, 0.25);
        elbow(P, S, 2.2);
        P.chest[1] = -0.3 * tw;
      } else if (t < 0.26) {
        arm(P, S, 1.55, 0.35);
        elbow(P, S, 0.05);
        P.chest[1] = 0.45 * tw;
        P.spine[0] = 0.12;
        leg(P, S === 'R' ? 'L' : 'R', 0.25);
      } else {
        arm(P, S, 0.8, 0.2);
        elbow(P, S, 2.0);
      }
      return t > 0.42;
    }
    if (kind === 'kick') {
      guard('L');
      guard('R');
      if (t < 0.16) {
        leg(P, 'R', 1.2);
        knee(P, 'R', 1.7);
        P.spine[0] = -0.1;
      } else if (t < 0.38) {
        leg(P, 'R', 1.5);
        knee(P, 'R', 0.08);
        P.ftR[0] = 0.3;
        P.spine[0] = -0.3;
        P.hipsY = -0.04;
        knee(P, 'L', 0.2);
      } else {
        leg(P, 'R', 0.6);
        knee(P, 'R', 1.0);
      }
      return t > 0.62;
    }
    if (kind === 'swing') {
      // two-handed horizontal swing, right to left
      if (t < 0.18) {
        P.chest[1] = -0.85;
        arm(P, 'R', 1.0, 0.7);
        elbow(P, 'R', 1.6);
        arm(P, 'L', 1.1, -0.1);
        elbow(P, 'L', 1.4);
      } else if (t < 0.34) {
        P.chest[1] = 0.75;
        arm(P, 'R', 1.45, -0.1);
        elbow(P, 'R', 0.3);
        arm(P, 'L', 1.45, -0.5);
        elbow(P, 'L', 0.35);
        P.spine[0] = 0.12;
      } else {
        P.chest[1] = 0.95;
        arm(P, 'R', 1.0, -0.2);
        elbow(P, 'R', 0.9);
        arm(P, 'L', 1.0, -0.5);
        elbow(P, 'L', 0.9);
      }
      return t > 0.62;
    }
    return true;
  }

  get handR() {
    return this.bones.haR.getWorldPosition(new THREE.Vector3());
  }
  get headPos() {
    return this.bones.head.getWorldPosition(new THREE.Vector3());
  }
}
