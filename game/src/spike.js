// Charge: the round objective. One plain string field, `stage`, carries
// the state — 'held', 'rigging', 'set', 'disarming', 'blown', 'cleared' —
// and the timers live beside it, so a check can never read the state
// object as if it were the stage string. The carrier rigs it by holding
// E inside a yard, standing still; the rig takes 3.5 s, the detonation
// timer runs 35 s, and a guard disarms it in 5 s.
export const PLANT_SPAN = 3.5;
export const FUSE_SPAN = 35;
export const DEFUSE_SPAN = 5;

export function rigCharge(sound) {
  const charge = {
    stage: 'held', // held | rigging | set | disarming | blown | cleared
    yard: null, // 'A' | 'B' once set
    spot: null, // {x, y, z} once set
    plantMade: 0,
    defuseMade: 0,
    fuseLeft: 0, // counts down while set
    carrierUp: true,
  };

  return {
    state: charge,
    clear() {
      charge.stage = 'held';
      charge.yard = null;
      charge.spot = null;
      charge.plantMade = 0;
      charge.defuseMade = 0;
      charge.fuseLeft = 0;
      charge.carrierUp = true;
    },
    // The carrier holds E inside a yard, standing still. Returns true
    // while the rig channel is running.
    plantTick(dt, inYard, still, yardId, spot) {
      if (charge.stage !== 'held' && charge.stage !== 'rigging') return false;
      if (!inYard || !still) {
        charge.stage = 'held';
        charge.plantMade = 0;
        return false;
      }
      charge.stage = 'rigging';
      charge.plantMade += dt;
      if (Math.floor(charge.plantMade * 4) !== Math.floor((charge.plantMade - dt) * 4)) {
        sound.chirp(false);
      }
      if (charge.plantMade >= PLANT_SPAN) {
        charge.stage = 'set';
        charge.yard = yardId;
        charge.spot = { x: spot.x, y: spot.y, z: spot.z };
        charge.fuseLeft = FUSE_SPAN;
        charge.plantMade = 0;
        sound.plantChime();
        return true;
      }
      return false;
    },
    // A guard holds E beside the set charge. Returns true on disarm.
    defuseTick(dt, near, still) {
      if (charge.stage !== 'set' && charge.stage !== 'disarming') return false;
      if (!near || !still) {
        if (charge.stage === 'disarming') charge.stage = 'set';
        charge.defuseMade = 0;
        return false;
      }
      charge.stage = 'disarming';
      charge.defuseMade += dt;
      if (Math.floor(charge.defuseMade * 2) !== Math.floor((charge.defuseMade - dt) * 2)) {
        sound.chirp(false);
      }
      if (charge.defuseMade >= DEFUSE_SPAN) {
        charge.stage = 'cleared';
        charge.defuseMade = 0;
        return true;
      }
      return false;
    },
    tick(dt) {
      if (charge.stage === 'set' || charge.stage === 'disarming') {
        charge.fuseLeft -= dt;
        if (charge.fuseLeft <= 0) {
          charge.stage = 'blown';
          charge.fuseLeft = 0;
          sound.blast();
          return 'blown';
        }
      }
      return null;
    },
    isSet() {
      return charge.stage === 'set' || charge.stage === 'disarming';
    },
  };
}
