// Arsenal: the four guns plus the frag grenade. Each gun is a plain
// definition — hurt, headshot multiplier, rate, magazine, spread and
// cost — and one shared state machine (fire, reload, switch). Spread
// grows with movement and with sustained fire, and shrinks when the
// shooter stops and crouches, so stopping to aim pays. The DMR's scope
// (right mouse) narrows spread and zooms the camera.
export const ARSENAL = {
  gull: {
    id: 'gull', label: 'Gull P9', family: 'pistol', cost: 300,
    hurt: 26, headX: 2.0, gap: 0.22, clip: 12, spare: 36,
    spreadCalm: 0.011, spreadStride: 0.030, spreadLeap: 0.02, fullAuto: false,
  },
  kestrel: {
    id: 'kestrel', label: 'Kestrel SMG', family: 'smg', cost: 1500,
    hurt: 22, headX: 2.0, gap: 0.09, clip: 28, spare: 84,
    spreadCalm: 0.016, spreadStride: 0.036, spreadLeap: 0.024, fullAuto: true,
  },
  tempest: {
    id: 'tempest', label: 'Tempest AR', family: 'rifle', cost: 2700,
    hurt: 30, headX: 2.0, gap: 0.11, clip: 25, spare: 75,
    spreadCalm: 0.008, spreadStride: 0.028, spreadLeap: 0.02, fullAuto: true,
  },
  longbow: {
    id: 'longbow', label: 'Longbow DMR', family: 'dmr', cost: 4200,
    hurt: 70, headX: 2.0, gap: 0.85, clip: 5, spare: 15,
    spreadCalm: 0.003, spreadStride: 0.02, spreadLeap: 0.016, fullAuto: false, hasScope: true,
  },
};
export const FRAG = { cost: 300, max: 2, hurt: 110, radius: 6.5, fuse: 1.6 };
export const PLATING = { cost: 650, amount: 50 };
export const SHOP_KEYS = { Digit1: 'gull', Digit2: 'kestrel', Digit3: 'tempest', Digit4: 'longbow', Digit5: 'frag', Digit6: 'plating' };

export function rackGuns(sound) {
  const rack = {
    inHand: 'gull',
    held: { gull: true },
    clip: { gull: 12 },
    spare: { gull: 36 },
    frags: 0,
    cool: 0,
    busy: false,
    reloadLeft: 0,
    heat: 0, // sustained-fire spread growth, decays when not firing
    roundsFired: 0,
  };
  const RELOAD_SPAN = 1.6;

  function lookup(id) {
    return ARSENAL[id];
  }

  return {
    state: rack,
    lookup,
    inHandDef() {
      return ARSENAL[rack.inHand];
    },
    // Funds-checked purchase; returns the cost paid or 0.
    purchase(id, funds) {
      if (id === 'frag') {
        if (rack.frags >= FRAG.max || funds < FRAG.cost) return 0;
        rack.frags += 1;
        return FRAG.cost;
      }
      if (id === 'plating') {
        if (funds < PLATING.cost) return 0;
        return PLATING.cost; // the caller tops the plating up
      }
      const w = ARSENAL[id];
      if (!w || funds < w.cost) return 0;
      if (!rack.held[id]) {
        rack.held[id] = true;
        rack.clip[id] = w.clip;
        rack.spare[id] = w.spare;
      } else {
        rack.spare[id] = Math.min(w.spare, rack.spare[id] + w.clip);
      }
      rack.inHand = id;
      return w.cost;
    },
    swapTo(id) {
      if (!rack.held[id] || rack.busy) return false;
      rack.inHand = id;
      return true;
    },
    canFire() {
      return rack.cool <= 0 && !rack.busy && rack.clip[rack.inHand] > 0;
    },
    // Spread in radians: base + movement + heat, halved while scoped.
    cone(pace, ducked, zoomed) {
      const w = ARSENAL[rack.inHand];
      let s = w.spreadCalm + rack.heat * 0.02;
      s += Math.min(1, pace / 5.4) * w.spreadStride;
      if (ducked) s *= 0.7;
      if (zoomed && w.hasScope) s *= 0.45;
      return s;
    },
    discharge() {
      if (!this.canFire()) return false;
      const w = ARSENAL[rack.inHand];
      rack.clip[rack.inHand] -= 1;
      rack.cool = w.gap;
      rack.heat = Math.min(1, rack.heat + (w.fullAuto ? 0.09 : 0.16));
      rack.roundsFired += 1;
      sound.gunshot(w.family);
      return true;
    },
    clickEmpty() {
      sound.emptyClick();
    },
    beginReload() {
      const w = ARSENAL[rack.inHand];
      if (rack.busy || rack.clip[rack.inHand] >= w.clip || rack.spare[rack.inHand] <= 0) return false;
      rack.busy = true;
      rack.reloadLeft = RELOAD_SPAN;
      sound.reloadClicks();
      return true;
    },
    tossFrag() {
      if (rack.frags <= 0) return false;
      rack.frags -= 1;
      sound.pinPull();
      return true;
    },
    tick(dt) {
      rack.cool = Math.max(0, rack.cool - dt);
      rack.heat = Math.max(0, rack.heat - dt * 0.9);
      if (rack.busy) {
        rack.reloadLeft -= dt;
        if (rack.reloadLeft <= 0) {
          const w = ARSENAL[rack.inHand];
          const need = w.clip - rack.clip[rack.inHand];
          const take = Math.min(need, rack.spare[rack.inHand]);
          rack.clip[rack.inHand] += take;
          rack.spare[rack.inHand] -= take;
          rack.busy = false;
        }
      }
    },
    freshRound(keepFrags) {
      // A new round: keep owned guns, refill the current magazine only
      // when the spare allows; grenades do not carry over.
      rack.busy = false;
      rack.cool = 0;
      rack.heat = 0;
      if (!keepFrags) rack.frags = 0;
    },
  };
}

// A thrown grenade: a point with velocity, gravity and a fuse. It bounces
// once off the floor (loses half its speed) and explodes at fuse end,
// damaging every body within radius with falloff. Pure data + tick; the
// renderer (fx.js) draws the tracer from the same state.
export function lobFrag(origin, direction, speed = 16) {
  return {
    spot: { x: origin.x, y: origin.y, z: origin.z },
    speed: { x: direction.x * speed, y: direction.y * speed + 2.5, z: direction.z * speed },
    fuse: FRAG.fuse,
    blown: false,
    bounced: false,
    tick(dt) {
      if (this.blown) return;
      this.fuse -= dt;
      this.speed.y -= 14 * dt;
      this.spot.x += this.speed.x * dt;
      this.spot.y += this.speed.y * dt;
      this.spot.z += this.speed.z * dt;
      if (this.spot.y <= 0.15 && !this.bounced) {
        this.spot.y = 0.15;
        this.speed.y = Math.abs(this.speed.y) * 0.45;
        this.speed.x *= 0.6;
        this.speed.z *= 0.6;
        this.bounced = true;
      }
      if (this.fuse <= 0) this.blown = true;
    },
  };
}
