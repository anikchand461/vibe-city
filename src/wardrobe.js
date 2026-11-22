import * as THREE from 'three';
import { paint, merge } from './utils.js';
import { OUTFITS } from './character.js';
import { drawDressPreview } from './dresspreview.js';

/*
 * Wardrobe & Outfit Customizer (New Market / College Street)
 * Allows players to visit historic Kolkata tailoring hubs and spend earned ₹
 * to equip authentic Kolkata attire:
 *  - Classic Kurta-Pajama & Dhoti
 *  - Kolkata Yellow Taxi Driver Khaki Uniform
 *  - Mohun Bagan AC Football Jersey (Maroon & Green)
 *  - East Bengal FC Football Jersey (Red & Gold)
 *  - College Street Scholar (Black Nehru Waistcoat & Punjabi)
 *  - Vibe City Tropical Default
 *
 * Zero-load compliance: Re-draws the in-memory 512x256 canvas atlas and
 * updates vertex properties. 0 external meshes or textures.
 */

export const WARDROBE_SHOPS = [
  {
    id: 'new_market',
    name: 'New Market Heritage Clothiers',
    bengali: 'নিউ মার্কেট ক্লথ স্টোর',
    x: -582,
    z: 672,
    yaw: 0,
    desc: 'Historic Hogg Market Victorian tailors, silk kurtas & Kolkata taxi uniforms',
    theme: '#a8432f',
  },
  {
    id: 'college_street',
    name: 'College Street Khadi & Sports Tailors',
    bengali: 'কলেজ স্ট্রিট খাদি ও স্পোর্টস টেলার্স',
    x: 528,
    z: -1078,
    yaw: -Math.PI / 4,
    desc: 'Boi Para book district tailors, Mohun Bagan vs East Bengal derby jerseys & khadi kurtas',
    theme: '#2e7d32',
  },
];

const box = (w, h, d, x, y, z, hex) => {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex);
};

const cyl = (rt, rb, h, x, y, z, hex, seg = 8) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex);
};

export class WardrobeManager {
  constructor(scene, world, hud, audio, game) {
    this.scene = scene;
    this.world = world;
    this.hud = hud;
    this.audio = audio;
    this.game = game;
    this.active = false;
    this.shops = [];
    this.player = null;
    this.gameplay = null;
    this.el = null;
    this.unlocked = this.loadUnlocked();
  }

  loadUnlocked() {
    try {
      const saved = JSON.parse(localStorage.getItem('vibe_city_wardrobe_unlocked'));
      if (Array.isArray(saved)) {
        if (!saved.includes('default')) saved.push('default');
        return saved;
      }
    } catch {}
    return ['default'];
  }

  saveUnlocked() {
    try {
      localStorage.setItem('vibe_city_wardrobe_unlocked', JSON.stringify(this.unlocked));
    } catch {}
  }

  isUnlocked(id) {
    return id === 'default' || this.unlocked.includes(id);
  }

  buildStalls() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });

    for (const shop of WARDROBE_SHOPS) {
      const y = this.world.height(shop.x, shop.z);
      const parts = [];

      // 1. Hardwood tailor counter
      parts.push(box(2.4, 0.88, 0.85, 0, 0.44, 0, '#5a3825'));
      parts.push(box(2.5, 0.06, 0.95, 0, 0.89, 0, '#6d452e')); // tabletop trim

      // Cloth rolls on counter
      const clothRoll = cyl(0.1, 0.1, 0.65, -0.65, 0.98, 0, shop.theme, 8);
      clothRoll.rotateZ(Math.PI / 2);
      parts.push(clothRoll);
      const clothRoll2 = cyl(0.09, 0.09, 0.65, -0.65, 1.12, 0, '#d4af37', 8);
      clothRoll2.rotateZ(Math.PI / 2);
      parts.push(clothRoll2);

      // Tailor scissors and measuring tape
      parts.push(cyl(0.08, 0.08, 0.04, 0.2, 0.94, 0.1, '#ffd700', 8)); // measuring tape
      parts.push(box(0.16, 0.02, 0.06, 0.5, 0.93, -0.1, '#e2e8f0')); // steel shears

      // 2. Corner canopy posts
      for (const sx of [-1.2, 1.2]) {
        for (const sz of [-0.6, 0.6]) {
          parts.push(cyl(0.035, 0.035, 2.7, sx, 1.35, sz, '#37474f', 6));
        }
      }

      // 3. Striped shop canopy awning
      const canopy = new THREE.BoxGeometry(2.8, 0.08, 1.8).rotateX(0.1);
      canopy.translate(0, 2.7, 0.1);
      canopy.deleteAttribute('uv');
      parts.push(paint(canopy, shop.theme));
      // Scalloped front valance
      parts.push(box(2.82, 0.22, 0.04, 0, 2.58, 0.98, '#ffffff'));
      parts.push(box(2.82, 0.08, 0.05, 0, 2.52, 0.98, shop.theme));

      // 4. Garment clothes rack with hanging attire miniatures
      parts.push(cyl(0.03, 0.03, 1.7, 1.6, 0.85, 0, '#475569', 6)); // rack post
      parts.push(box(1.1, 0.04, 0.04, 1.6, 1.7, 0, '#475569')); // top bar
      // Hung garment miniatures
      parts.push(box(0.3, 0.6, 0.06, 1.35, 1.35, 0, '#781428')); // maroon jersey
      parts.push(box(0.3, 0.6, 0.06, 1.6, 1.35, 0, '#c41528')); // red/gold jersey
      parts.push(box(0.3, 0.7, 0.06, 1.85, 1.3, 0, '#fdfbf7')); // ivory kurta

      // 5. Overhead Store Signboard
      parts.push(box(1.9, 0.45, 0.08, 0, 2.95, 0.85, '#1e293b'));
      parts.push(box(1.96, 0.49, 0.06, 0, 2.95, 0.84, '#d4af37')); // gold frame
      parts.push(box(1.7, 0.35, 0.02, 0, 2.95, 0.9, '#ffd700')); // glowing gold face

      const geom = merge(parts);
      if (geom) {
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(shop.x, y, shop.z);
        mesh.rotation.y = shop.yaw;
        mesh.castShadow = true;
        this.scene.add(mesh);
      }

      // Add wall obstacle so player doesn't walk right through the counter
      const cos = Math.cos(shop.yaw);
      const sin = Math.sin(shop.yaw);
      const hx = 1.3 * cos;
      const hz = 1.3 * sin;
      this.world.addWall(shop.x - hx, shop.z + hz, shop.x + hx, shop.z - hz, 0.9);

      this.shops.push({ ...shop, y });
    }
  }

  /** The shops, for the map when you're nearby. */
  pois() {
    return this.shops.map((s) => ({ x: s.x, z: s.z, icon: '👕', name: 'Wardrobe', color: '#ff7ad9' }));
  }

  near(pos) {
    for (const shop of this.shops) {
      const d = Math.hypot(pos.x - shop.x, pos.z - shop.z);
      if (d < 2.8) {
        return {
          text: `Wardrobe · ${shop.name}`,
          act: () => this.open(shop),
        };
      }
    }
    return null;
  }

  initUI(player, gameplay) {
    this.player = player;
    this.gameplay = gameplay;
    this.el = document.getElementById('wardrobe-modal');
    if (!this.el) return;

    const closeBtn = document.getElementById('wardrobe-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Backdrop click
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    // Pause menu button if present
    const pauseWardrobeBtn = document.getElementById('pause-wardrobe');
    if (pauseWardrobeBtn) {
      pauseWardrobeBtn.addEventListener('click', () => {
        if (this.game && this.game.setPaused) this.game.setPaused(false);
        this.open();
      });
    }

    this.renderCards();
  }

  renderCards() {
    const listEl = document.getElementById('wardrobe-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    const currentId = (this.player && this.player.ch && this.player.ch.outfitId) || 'default';
    const currentMoney = (this.gameplay && this.gameplay.money) || 0;

    for (const outfit of Object.values(OUTFITS)) {
      const card = document.createElement('div');
      card.className = `wardrobe-card ${currentId === outfit.id ? 'equipped' : ''}`;

      const owned = this.isUnlocked(outfit.id);
      const canAfford = currentMoney >= outfit.price;

      card.innerHTML = `
        <div class="wc-preview-wrap">
          <canvas class="wc-preview-canvas" width="260" height="240"></canvas>
          <div class="wc-tag ${currentId === outfit.id ? 'tag-equipped' : owned ? 'tag-owned' : ''}">
            ${currentId === outfit.id ? 'EQUIPPED' : outfit.price === 0 ? 'FREE' : owned ? 'OWNED' : `₹${outfit.price}`}
          </div>
        </div>
        <div class="wc-info">
          <div class="wc-title">${outfit.name}</div>
          <div class="wc-bengali">${outfit.bengali}</div>
          <div class="wc-desc">${outfit.desc}</div>
        </div>
        <div class="wc-actions">
          <div class="wc-price">${outfit.price === 0 ? 'FREE' : owned ? 'OWNED' : `₹${outfit.price}`}</div>
          <button class="wc-btn ${currentId === outfit.id ? 'btn-active' : owned ? 'btn-equip' : canAfford ? 'btn-buy' : 'btn-disabled'}">
            ${currentId === outfit.id ? 'EQUIPPED' : owned ? 'EQUIP' : `BUY ₹${outfit.price}`}
          </button>
        </div>
      `;

      const canvas = card.querySelector('.wc-preview-canvas');
      if (canvas) {
        drawDressPreview(canvas, outfit);
      }

      const btn = card.querySelector('.wc-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentId === outfit.id) return;
        if (owned) {
          this.equip(outfit.id);
        } else {
          this.buy(outfit.id);
        }
      });

      listEl.appendChild(card);
    }

    const balEl = document.getElementById('wardrobe-balance');
    if (balEl) balEl.textContent = `₹${Math.round(currentMoney).toLocaleString('en-IN')}`;
  }

  open(shop = null) {
    if (this.active) return;
    this.active = true;
    if (this.game && this.game.setWardrobe) {
      this.game.setWardrobe(true);
    }
    if (this.el) {
      this.el.classList.remove('hidden');
      const titleEl = document.getElementById('wardrobe-shop-title');
      if (titleEl) {
        titleEl.textContent = shop ? shop.name : 'Kolkata Wardrobe & Outfits';
      }
    }
    this.renderCards();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    if (this.el) this.el.classList.add('hidden');
    if (this.game && this.game.setWardrobe) {
      this.game.setWardrobe(false);
    }
  }

  buy(outfitId) {
    const outfit = OUTFITS[outfitId];
    if (!outfit) return;

    if (!this.gameplay || this.gameplay.money < outfit.price) {
      this.hud.notify('NOT ENOUGH MONEY', `Need ₹${outfit.price} for ${outfit.name}`, '#ff5f6d');
      if (this.audio) this.audio.beep(false);
      return;
    }

    this.gameplay.addMoney(-outfit.price);
    if (!this.unlocked.includes(outfitId)) {
      this.unlocked.push(outfitId);
      this.saveUnlocked();
    }

    this.equip(outfitId, true);
    if (this.audio) this.audio.beep(true);
    if (this.game && this.game.progress) {
      this.game.progress.event('fashionista');
    }
    this.hud.notify('NEW OUTFIT BOUGHT!', `${outfit.name} · ₹${outfit.price}`, '#5dff9e');
  }

  equip(outfitId, isPurchase = false) {
    const outfit = OUTFITS[outfitId];
    if (!outfit || !this.player || !this.player.ch) return;

    this.player.ch.setOutfit(outfit.id);
    if (!isPurchase) {
      this.hud.notify('OUTFIT EQUIPPED', outfit.name, '#ffd36b');
      if (this.audio) this.audio.beep(true);
      if (this.game && this.game.progress) {
        this.game.progress.event('fashionista');
      }
    }
    this.renderCards();
  }
}
