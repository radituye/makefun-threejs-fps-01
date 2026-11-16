// Weapons: the four guns plus the frag grenade. Each gun is a plain
// definition — damage, headshot multiplier, rate, magazine, spread and
// price — and one shared state machine (fire, reload, switch). Spread
// grows with movement and with sustained fire, and shrinks when the
// shooter stops and crouches, so stopping to aim pays. The DMR's scope
// (right mouse) narrows spread and zooms the camera.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Gull P9', kind: 'pistol', price: 300,
    damage: 26, headMult: 2.0, interval: 0.22, mag: 12, reserve: 36,
    spreadBase: 0.011, spreadMove: 0.030, spreadAir: 0.02, auto: false,
  },
  smg: {
    id: 'smg', name: 'Kestrel SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 2.0, interval: 0.09, mag: 28, reserve: 84,
    spreadBase: 0.016, spreadMove: 0.036, spreadAir: 0.024, auto: true,
  },
  rifle: {
    id: 'rifle', name: 'Tempest AR', kind: 'rifle', price: 2700,
    damage: 30, headMult: 2.0, interval: 0.11, mag: 25, reserve: 75,
    spreadBase: 0.008, spreadMove: 0.028, spreadAir: 0.02, auto: true,
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', kind: 'dmr', price: 4200,
    damage: 70, headMult: 2.0, interval: 0.85, mag: 5, reserve: 15,
    spreadBase: 0.003, spreadMove: 0.02, spreadAir: 0.016, auto: false, scoped: true,
  },
};
export const GRENADE = { price: 300, max: 2, damage: 110, radius: 6.5, fuse: 1.6 };
export const ARMOR = { price: 650, amount: 50 };
export const BUY_KEYS = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'rifle', Digit4: 'dmr', Digit5: 'grenade', Digit6: 'armor' };

export function createWeapons(audio) {
  const state = {
    current: 'pistol',
    owned: { pistol: true },
    mag: { pistol: 12 },
    reserve: { pistol: 36 },
    grenades: 0,
    cooldown: 0,
    reloading: false,
    reloadAt: 0,
    heat: 0, // sustained-fire spread growth, decays when not firing
    shotsFired: 0,
  };
  const RELOAD_TIME = 1.6;

  function def(id) {
    return WEAPONS[id];
  }

  return {
    state,
    def,
    currentDef() {
      return WEAPONS[state.current];
    },
    // Money-checked purchase; returns the price paid or 0.
    buy(id, money) {
      if (id === 'grenade') {
        if (state.grenades >= GRENADE.max || money < GRENADE.price) return 0;
        state.grenades += 1;
        return GRENADE.price;
      }
      if (id === 'armor') {
        if (money < ARMOR.price) return 0;
        return ARMOR.price; // the caller tops the armour up
      }
      const w = WEAPONS[id];
      if (!w || money < w.price) return 0;
      if (!state.owned[id]) {
        state.owned[id] = true;
        state.mag[id] = w.mag;
        state.reserve[id] = w.reserve;
      } else {
        state.reserve[id] = Math.min(w.reserve, state.reserve[id] + w.mag);
      }
      state.current = id;
      return w.price;
    },
    select(id) {
      if (!state.owned[id] || state.reloading) return false;
      state.current = id;
      return true;
    },
    ready() {
      return state.cooldown <= 0 && !state.reloading && state.mag[state.current] > 0;
    },
    // Spread in radians: base + movement + heat, halved while scoped.
    spread(moveSpeed, crouched, scoped) {
      const w = WEAPONS[state.current];
      let s = w.spreadBase + state.heat * 0.02;
      s += Math.min(1, moveSpeed / 5.4) * w.spreadMove;
      if (crouched) s *= 0.7;
      if (scoped && w.scoped) s *= 0.45;
      return s;
    },
    fire() {
      if (!this.ready()) return false;
      const w = WEAPONS[state.current];
      state.mag[state.current] -= 1;
      state.cooldown = w.interval;
      state.heat = Math.min(1, state.heat + (w.auto ? 0.09 : 0.16));
      state.shotsFired += 1;
      audio.shot(w.kind);
      return true;
    },
    dryFire() {
      audio.dryClick();
    },
    startReload() {
      const w = WEAPONS[state.current];
      if (state.reloading || state.mag[state.current] >= w.mag || state.reserve[state.current] <= 0) return false;
      state.reloading = true;
      state.reloadAt = RELOAD_TIME;
      audio.reload();
      return true;
    },
    throwGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      audio.grenade();
      return true;
    },
    step(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.heat = Math.max(0, state.heat - dt * 0.9);
      if (state.reloading) {
        state.reloadAt -= dt;
        if (state.reloadAt <= 0) {
          const w = WEAPONS[state.current];
          const need = w.mag - state.mag[state.current];
          const take = Math.min(need, state.reserve[state.current]);
          state.mag[state.current] += take;
          state.reserve[state.current] -= take;
          state.reloading = false;
        }
      }
    },
    resetForRound(keepGrenades) {
      // A new round: keep owned guns, refill the current magazine only
      // when the reserve allows; grenades do not carry over.
      state.reloading = false;
      state.cooldown = 0;
      state.heat = 0;
      if (!keepGrenades) state.grenades = 0;
    },
  };
}

// A thrown grenade: a point with velocity, gravity and a fuse. It bounces
// once off the floor (loses half its speed) and explodes at fuse end,
// damaging every body within radius with falloff. Pure data + step; the
// renderer (fx.js) draws the tracer from the same state.
export function createGrenade(origin, direction, speed = 16) {
  return {
    position: { x: origin.x, y: origin.y, z: origin.z },
    velocity: { x: direction.x * speed, y: direction.y * speed + 2.5, z: direction.z * speed },
    fuse: GRENADE.fuse,
    exploded: false,
    bounced: false,
    step(dt) {
      if (this.exploded) return;
      this.fuse -= dt;
      this.velocity.y -= 14 * dt;
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;
      if (this.position.y <= 0.15 && !this.bounced) {
        this.position.y = 0.15;
        this.velocity.y = Math.abs(this.velocity.y) * 0.45;
        this.velocity.x *= 0.6;
        this.velocity.z *= 0.6;
        this.bounced = true;
      }
      if (this.fuse <= 0) this.exploded = true;
    },
  };
}
