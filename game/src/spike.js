// Spike: the round objective. One plain string field, `mode`, carries the
// state — 'carried', 'planting', 'planted', 'defusing', 'detonated',
// 'defused' — and the timers live beside it, so a check can never read
// the state object as if it were the mode string. The carrier plants by
// holding E inside a site, standing still; the plant takes 3.5 s, the
// detonation timer runs 35 s, and a defender defuses in 5 s.
export const PLANT_TIME = 3.5;
export const DETONATE_TIME = 35;
export const DEFUSE_TIME = 5;

export function createSpike(audio) {
  const state = {
    mode: 'carried', // carried | planting | planted | defusing | detonated | defused
    site: null, // 'A' | 'B' once planted
    position: null, // {x, y, z} once planted
    plantProgress: 0,
    defuseProgress: 0,
    timer: 0, // counts down while planted
    carrierAlive: true,
  };

  return {
    state,
    reset() {
      state.mode = 'carried';
      state.site = null;
      state.position = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.timer = 0;
      state.carrierAlive = true;
    },
    // The carrier holds E inside a site, standing still. Returns true
    // while the plant channel is running.
    plantStep(dt, inSite, still, siteId, position) {
      if (state.mode !== 'carried' && state.mode !== 'planting') return false;
      if (!inSite || !still) {
        state.mode = 'carried';
        state.plantProgress = 0;
        return false;
      }
      state.mode = 'planting';
      state.plantProgress += dt;
      if (Math.floor(state.plantProgress * 4) !== Math.floor((state.plantProgress - dt) * 4)) {
        audio.beep(false);
      }
      if (state.plantProgress >= PLANT_TIME) {
        state.mode = 'planted';
        state.site = siteId;
        state.position = { x: position.x, y: position.y, z: position.z };
        state.timer = DETONATE_TIME;
        state.plantProgress = 0;
        audio.plantDone();
        return true;
      }
      return false;
    },
    // A defender holds E beside the planted spike. Returns true on defuse.
    defuseStep(dt, near, still) {
      if (state.mode !== 'planted' && state.mode !== 'defusing') return false;
      if (!near || !still) {
        if (state.mode === 'defusing') state.mode = 'planted';
        state.defuseProgress = 0;
        return false;
      }
      state.mode = 'defusing';
      state.defuseProgress += dt;
      if (Math.floor(state.defuseProgress * 2) !== Math.floor((state.defuseProgress - dt) * 2)) {
        audio.beep(false);
      }
      if (state.defuseProgress >= DEFUSE_TIME) {
        state.mode = 'defused';
        state.defuseProgress = 0;
        return true;
      }
      return false;
    },
    step(dt) {
      if (state.mode === 'planted' || state.mode === 'defusing') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.mode = 'detonated';
          state.timer = 0;
          audio.explosion();
          return 'detonated';
        }
      }
      return null;
    },
    isPlanted() {
      return state.mode === 'planted' || state.mode === 'defusing';
    },
  };
}
