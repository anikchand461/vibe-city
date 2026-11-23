export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, horn: false };
    this.mouse = { dx: 0, dy: 0, down: false };
    this.locked = false;
    this.wheelOpen = false;
    this.wheelVec = { x: 0, y: 0 };
    this.wheelPick = null;
    this.onWheel = null; // (open, vec, kind) => label | null
    this.wheelKind = null; // 'weapon' (hold Tab) | 'gesture' (hold G)
    this.scroll = 0;
    this.wheelSteps = 0;

    addEventListener('keydown', (e) => {
      // typing in a text box (the map search) isn't game input
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.code === 'Enter' && !document.getElementById('where-to')?.classList.contains('hidden')) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'KeyG' && this.wheelOpen) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Backspace'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // Mouse buttons are tracked like keys: 'Mouse0' (left), 'Mouse2' (right)
    addEventListener('mousedown', (e) => {
      this.mouse.down = true;
      const code = 'Mouse' + e.button;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    });
    addEventListener('mouseup', (e) => {
      this.keys.delete('Mouse' + e.button);
      this.mouse.down = this.keys.has('Mouse0') || this.keys.has('Mouse2');
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => (this.scroll += e.deltaY), { passive: true });
    addEventListener('mousemove', (e) => {
      if (this.wheelOpen) {
        this.wheelVec.x += e.movementX;
        this.wheelVec.y += e.movementY;
        const l = Math.hypot(this.wheelVec.x, this.wheelVec.y);
        if (l > 120) {
          this.wheelVec.x *= 120 / l;
          this.wheelVec.y *= 120 / l;
        }
        return;
      }
      if (this.locked || this.mouse.down) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  lock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {
        /* pointer lock unavailable */
      }
    }
  }

  poll() {
    const k = this.keys;
    const s = this.state;
    // Mouse wheel: one weapon step per notch
    this.wheelSteps = 0;
    if (Math.abs(this.scroll) >= 40) {
      this.wheelSteps = Math.sign(this.scroll);
      this.scroll = 0;
    }
    s.throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    s.brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    s.steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    s.handbrake = k.has('Space');
    s.nitro = k.has('ShiftLeft') || k.has('ShiftRight');
    s.horn = k.has('KeyH');

    // Radial wheels: hold Tab (weapons) or G (gestures), move the mouse, release to pick
    if (!this.wheelOpen) {
      const kind = k.has('Tab') ? 'weapon' : k.has('KeyG') ? 'gesture' : null;
      if (kind) {
        this.wheelOpen = true;
        this.wheelKind = kind;
        this.wheelVec = { x: 0, y: 0 };
      }
    }
    if (this.wheelOpen) {
      const held = k.has(this.wheelKind === 'weapon' ? 'Tab' : 'KeyG');
      const sel = this.onWheel ? this.onWheel(held, this.wheelVec, this.wheelKind) : null;
      if (!held) {
        this.wheelOpen = false;
        if (sel) this.wheelPick = { kind: this.wheelKind, sel };
        this.wheelKind = null;
      }
    }

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) s.steer = ax;
      const rt = gp.buttons[7]?.value || 0;
      const lt = gp.buttons[6]?.value || 0;
      if (rt > 0.05) s.throttle = rt;
      if (lt > 0.05) s.brake = lt;
      if (gp.buttons[0]?.pressed) s.handbrake = true;
      if (gp.buttons[1]?.pressed || gp.buttons[5]?.pressed) s.nitro = true;
      const rx = gp.axes[2] || 0;
      const ry = gp.axes[3] || 0;
      if (Math.abs(rx) > 0.15) this.mouse.dx += rx * 14;
      if (Math.abs(ry) > 0.15) this.mouse.dy += ry * 10;
      const edge = (i, code) => {
        const p = !!gp.buttons[i]?.pressed;
        if (p && !this['_gp' + i]) this.pressed.add(code);
        this['_gp' + i] = p;
      };
      edge(3, 'KeyF');
      edge(2, 'KeyE');
      edge(4, 'KeyC');
      // Triggers fire / aim while on foot
      if ((gp.buttons[7]?.value || 0) > 0.5) k.add('Mouse0');
      else if (this._gpFire) k.delete('Mouse0');
      if ((gp.buttons[6]?.value || 0) > 0.5) k.add('Mouse2');
      else if (this._gpAim) k.delete('Mouse2');
      if ((gp.buttons[7]?.value || 0) > 0.5 && !this._gpFire) this.pressed.add('Mouse0');
      this._gpFire = (gp.buttons[7]?.value || 0) > 0.5;
      this._gpAim = (gp.buttons[6]?.value || 0) > 0.5;
      const dpad = (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
      if (dpad && !this._gpDpad) this.wheelSteps = dpad;
      this._gpDpad = dpad;
    }
    return s;
  }

  hit(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }
}
