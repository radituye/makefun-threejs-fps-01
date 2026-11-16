// Mover: one axis-aligned body moving through the yard's solids. The
// body is a vertical capsule approximated as a box (girth r, stature h);
// movement is resolved one axis at a time, so sliding along a wall falls
// out of the code instead of needing a special case. The standing surface
// is the intersecting solid with the HIGHEST top — never the first one
// found — so a body on a raised deck is not pinned to the ground that
// happens to touch the same probe.
export function makeMover(solids, x, z, options = {}) {
  const girth = options.girth ?? 0.42;
  const stature = options.stature ?? 1.78;
  const mover = {
    spot: { x, y: 0, z },
    speed: { x: 0, y: 0, z: 0 },
    eyeHeight: options.eyeHeight ?? 1.62,
    ducked: false,
    onFloor: true,
    girth,
    stature,
  };

  // The solid whose top is highest among those intersecting the body's
  // footprint at (x, z) while the body stands at height y. Null over open
  // ground (y = 0).
  function floorUnder(x, z, y) {
    let best = null;
    for (let i = 0; i < solids.length; i += 1) {
      const c = solids[i];
      if (x + girth <= c.minX || x - girth >= c.maxX) continue;
      if (z + girth <= c.minZ || z - girth >= c.maxZ) continue;
      // Only solids the body can stand on: top near or below the feet.
      if (c.maxY > y + 0.6) continue;
      if (best === null || c.maxY > best.maxY) best = c;
    }
    return best;
  }

  function blockedBy(x, z, y, h) {
    for (let i = 0; i < solids.length; i += 1) {
      const c = solids[i];
      if (x + girth <= c.minX || x - girth >= c.maxX) continue;
      if (z + girth <= c.minZ || z - girth >= c.maxZ) continue;
      // A solid blocks the body only when it reaches into the body's
      // vertical span and the body is not already standing on top of it.
      if (c.maxY <= y + 0.05) continue;
      if (c.minY >= y + h) continue;
      return true;
    }
    return false;
  }

  // Step-up: when a horizontal move is blocked, the body may climb onto
  // the blocking surface when its top is at most 0.55 above the feet and
  // the space above it at the target spot is free. This is what lets a
  // body walk up the walkway's ramps (0.3 m rises) instead of bouncing off.
  function tryClimb(x, z, y, h) {
    let top = null;
    for (let i = 0; i < solids.length; i += 1) {
      const c = solids[i];
      if (x + girth <= c.minX || x - girth >= c.maxX) continue;
      if (z + girth <= c.minZ || z - girth >= c.maxZ) continue;
      if (c.maxY <= y + 0.05 || c.maxY > y + 0.55) continue;
      if (c.minY >= y + h) continue;
      if (top === null || c.maxY > top) top = c.maxY;
    }
    if (top === null) return null;
    if (blockedBy(x, z, top, h)) return null;
    return top;
  }

  return {
    state: mover,
    floorUnder,
    blockedBy,
    // Move by (dx, dz) with gravity; returns true when the body moved.
    move(dx, dz, dt) {
      const p = mover.spot;
      const tall = mover.ducked ? stature * 0.62 : stature;
      // X axis, then Z axis; a move blocked by a low ledge climbs it.
      if (dx !== 0) {
        if (!blockedBy(p.x + dx, p.z, p.y, tall)) p.x += dx;
        else {
          const top = tryClimb(p.x + dx, p.z, p.y, tall);
          if (top !== null) { p.x += dx; p.y = top; mover.speed.y = 0; }
        }
      }
      if (dz !== 0) {
        if (!blockedBy(p.x, p.z + dz, p.y, tall)) p.z += dz;
        else {
          const top = tryClimb(p.x, p.z + dz, p.y, tall);
          if (top !== null) { p.z += dz; p.y = top; mover.speed.y = 0; }
        }
      }
      // Gravity and landing.
      mover.speed.y -= 22 * dt;
      p.y += mover.speed.y * dt;
      const ground = floorUnder(p.x, p.z, p.y + 0.05);
      const groundY = ground ? ground.maxY : 0;
      if (p.y <= groundY) {
        p.y = groundY;
        mover.speed.y = 0;
        mover.onFloor = true;
      } else {
        mover.onFloor = false;
      }
      return dx !== 0 || dz !== 0;
    },
    duck(on) {
      mover.ducked = on;
      mover.eyeHeight = on ? 1.05 : (options.eyeHeight ?? 1.62);
    },
    teleport(x, z) {
      mover.spot.x = x;
      mover.spot.z = z;
      const ground = floorUnder(x, z, 0.05);
      mover.spot.y = ground ? ground.maxY : 0;
      mover.speed.x = 0;
      mover.speed.y = 0;
      mover.speed.z = 0;
    },
  };
}

// Segment (a -> b) against one AABB. Returns the hit fraction t in [0, 1]
// or -1 when the segment misses. Used for line-of-sight checks.
export function rayClipsBox(ax, ay, az, bx, by, bz, c) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let tMin = 0;
  let tMax = 1;
  const axes = [
    [ax, dx, c.minX, c.maxX],
    [ay, dy, c.minY, c.maxY],
    [az, dz, c.minZ, c.maxZ],
  ];
  for (let i = 0; i < 3; i += 1) {
    const [o, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
    } else {
      let t0 = (lo - o) / d;
      let t1 = (hi - o) / d;
      if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      if (t0 > tMin) tMin = t0;
      if (t1 < tMax) tMax = t1;
      if (tMin > tMax) return -1;
    }
  }
  return tMin;
}

// True when nothing solid stands between the two points. Solids whose
// top is at or below both endpoints' feet are ignored (low curbs do not
// block sight), and neither endpoint's own solid blocks the ray.
export function clearSight(ax, ay, az, bx, by, bz, solids) {
  for (let i = 0; i < solids.length; i += 1) {
    const c = solids[i];
    if (c.maxY <= Math.min(ay, by) + 0.05) continue;
    if (rayClipsBox(ax, ay, az, bx, by, bz, c) >= 0) return false;
  }
  return true;
}
