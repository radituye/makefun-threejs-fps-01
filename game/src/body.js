// Body: one axis-aligned body moving through the world's colliders. The
// body is a vertical capsule approximated as a box (radius r, height h);
// movement is resolved one axis at a time, so sliding along a wall falls
// out of the code instead of needing a special case. The standing surface
// is the intersecting collider with the HIGHEST top — never the first one
// found — so a body on a raised deck is not pinned to the ground that
// happens to touch the same probe.
export function createBody(colliders, x, z, options = {}) {
  const radius = options.radius ?? 0.42;
  const height = options.height ?? 1.78;
  const state = {
    position: { x, y: 0, z },
    velocity: { x: 0, y: 0, z: 0 },
    eye: options.eye ?? 1.62,
    crouched: false,
    grounded: true,
    radius,
    height,
  };

  // The collider whose top is highest among those intersecting the body's
  // footprint at (x, z) while the body stands at height y. Null over open
  // ground (y = 0).
  function groundAt(x, z, y) {
    let best = null;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (x + radius <= c.minX || x - radius >= c.maxX) continue;
      if (z + radius <= c.minZ || z - radius >= c.maxZ) continue;
      // Only colliders the body can stand on: top near or below the feet.
      if (c.maxY > y + 0.6) continue;
      if (best === null || c.maxY > best.maxY) best = c;
    }
    return best;
  }

  function blockedAt(x, z, y, h) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (x + radius <= c.minX || x - radius >= c.maxX) continue;
      if (z + radius <= c.minZ || z - radius >= c.maxZ) continue;
      // A collider blocks the body only when it reaches into the body's
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
  function tryStepUp(x, z, y, h) {
    let top = null;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (x + radius <= c.minX || x - radius >= c.maxX) continue;
      if (z + radius <= c.minZ || z - radius >= c.maxZ) continue;
      if (c.maxY <= y + 0.05 || c.maxY > y + 0.55) continue;
      if (c.minY >= y + h) continue;
      if (top === null || c.maxY > top) top = c.maxY;
    }
    if (top === null) return null;
    if (blockedAt(x, z, top, h)) return null;
    return top;
  }

  return {
    state,
    groundAt,
    blockedAt,
    // Move by (dx, dz) with gravity; returns true when the body moved.
    move(dx, dz, dt) {
      const p = state.position;
      const h = state.crouched ? height * 0.62 : height;
      // X axis, then Z axis; a move blocked by a low ledge climbs it.
      if (dx !== 0) {
        if (!blockedAt(p.x + dx, p.z, p.y, h)) p.x += dx;
        else {
          const top = tryStepUp(p.x + dx, p.z, p.y, h);
          if (top !== null) { p.x += dx; p.y = top; state.velocity.y = 0; }
        }
      }
      if (dz !== 0) {
        if (!blockedAt(p.x, p.z + dz, p.y, h)) p.z += dz;
        else {
          const top = tryStepUp(p.x, p.z + dz, p.y, h);
          if (top !== null) { p.z += dz; p.y = top; state.velocity.y = 0; }
        }
      }
      // Gravity and landing.
      state.velocity.y -= 22 * dt;
      p.y += state.velocity.y * dt;
      const ground = groundAt(p.x, p.z, p.y + 0.05);
      const groundY = ground ? ground.maxY : 0;
      if (p.y <= groundY) {
        p.y = groundY;
        state.velocity.y = 0;
        state.grounded = true;
      } else {
        state.grounded = false;
      }
      return dx !== 0 || dz !== 0;
    },
    setCrouch(on) {
      state.crouched = on;
      state.eye = on ? 1.05 : (options.eye ?? 1.62);
    },
    teleport(x, z) {
      state.position.x = x;
      state.position.z = z;
      const ground = groundAt(x, z, 0.05);
      state.position.y = ground ? ground.maxY : 0;
      state.velocity.x = 0;
      state.velocity.y = 0;
      state.velocity.z = 0;
    },
  };
}

// Segment (a -> b) against one AABB. Returns the hit fraction t in [0, 1]
// or -1 when the segment misses. Used for line-of-sight checks.
export function segmentHitsBox(ax, ay, az, bx, by, bz, c) {
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

// True when nothing solid stands between the two points. Colliders whose
// top is at or below both endpoints' feet are ignored (low curbs do not
// block sight), and neither endpoint's own collider blocks the ray.
export function hasLineOfSight(ax, ay, az, bx, by, bz, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c.maxY <= Math.min(ay, by) + 0.05) continue;
    if (segmentHitsBox(ax, ay, az, bx, by, bz, c) >= 0) return false;
  }
  return true;
}
