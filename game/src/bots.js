// Squad: five guards. Each one is a mover with a small state machine —
// post, fight, rally, disarm, check — driven by sight, sound and the
// charge. Sight needs a clear line plus a field of view; a guard that
// spots the striker waits out a distance-based reaction delay before it
// fires, and fires in bursts with distance- and pace-based error, so a
// fast-moving target at range is hard to hit. Gunfire within 28 m is
// heard and investigated. When the charge is set exactly one guard
// becomes the disarmer (sticky: it keeps the job until it dies, walks
// off or the charge is gone) and the rest hold the yard. Routes are
// recomputed only when the destination knot changes — never every tick,
// or the guard never arrives.
import * as THREE from 'three';
import { makeMover, clearSight } from './body.js';
import { chooseOne, spanBetween } from './rng.js';

const PATROL_PACE = 4.2;
const VIEW_COS = Math.cos((100 / 2) * (Math.PI / 180)); // 100-degree field of view
const EARSHOT = 28;
const REACT_FLOOR = 0.35;
const REACT_PER_STEP = 0.012;
const REACT_CEIL = 0.9;

function rayMeetsBall(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return false;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  return d2 <= r * r;
}

function rayMeetsTube(ox, oy, oz, dx, dy, dz, px, py, pz, height, radius) {
  // Sample the vertical segment; the closest sample decides the hit.
  for (let i = 0; i <= 5; i += 1) {
    const y = py + (height * i) / 5;
    if (rayMeetsBall(ox, oy, oz, dx, dy, dz, px, y, pz, radius)) return true;
  }
  return false;
}

export function fieldSquad(scene, yard, chance, sound) {
  const guards = [];
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const kitMat = new THREE.MeshStandardMaterial({ color: 0x3a4552, roughness: 0.8, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.9, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 1.6 });

  function assembleGuard(id) {
    const group = new THREE.Group();
    const chest = new THREE.Mesh(cubeGeo, kitMat);
    chest.scale.set(0.56, 0.72, 0.32);
    chest.position.y = 1.05;
    chest.userData = { guard: id, part: 'chest' };
    const skull = new THREE.Mesh(cubeGeo, darkMat);
    skull.scale.set(0.34, 0.32, 0.32);
    skull.position.y = 1.58;
    skull.userData = { guard: id, part: 'skull' };
    const visor = new THREE.Mesh(cubeGeo, visorMat);
    visor.scale.set(0.26, 0.07, 0.05);
    visor.position.set(0, 1.6, 0.17);
    const legL = new THREE.Mesh(cubeGeo, darkMat);
    legL.scale.set(0.2, 0.62, 0.24);
    legL.position.set(-0.15, 0.31, 0);
    const legR = new THREE.Mesh(cubeGeo, darkMat);
    legR.scale.set(0.2, 0.62, 0.24);
    legR.position.set(0.15, 0.31, 0);
    const gun = new THREE.Mesh(cubeGeo, darkMat);
    gun.scale.set(0.09, 0.09, 0.7);
    gun.position.set(0.28, 1.15, 0.3);
    group.add(chest, skull, visor, legL, legR, gun);
    group.traverse((piece) => { if (piece.isMesh) piece.castShadow = true; });
    scene.add(group);
    return { group, chest, skull };
  }

  const postNodes = [9, 10, 11, 12, 13, 14, 16, 17, 20, 21, 22];
  for (let i = 0; i < 5; i += 1) {
    const start = yard.starts.guards[i];
    const mover = makeMover(yard.solids, start.x, start.z);
    const rig = assembleGuard(i);
    rig.group.position.set(start.x, 0, start.z);
    guards.push({
      id: i,
      mover,
      rig,
      vigor: 100,
      up: true,
      stance: 'post',
      bearing: Math.PI, // face south, toward the attackers
      nodeId: yard.closestNode(start.x, start.z).id,
      route: [],
      routeAt: 0,
      routeGoal: -1,
      routeStart: -1, // knot the current route was charted from; re-chart if it moved
      postNode: chooseOne(chance, postNodes),
      postUntil: 0,
      seesHero: false,
      fireAfter: 0,
      lastSpot: null,
      lastSpotAt: -100,
      shotsLeft: 0,
      nextShotAt: 0,
      checkNode: -1,
      isDefuser: false,
      strafeWay: 1,
      strafeTill: 0,
      aimError: 1, // test hook: set to 0 for perfect aim
    });
  }

  function chartRoute(guard, targetNode) {
    // Re-chart when the target changes OR the guard has moved to a
    // different knot since the route was charted (it strafed while
    // fighting, so its stored knot is stale and the old route no longer
    // starts near it).
    if (guard.routeGoal === targetNode && guard.routeStart === guard.nodeId) return;
    guard.routeGoal = targetNode;
    guard.routeStart = guard.nodeId;
    guard.route = yard.chartPath(guard.nodeId, targetNode);
    guard.routeAt = 0;
  }

  function walkRoute(guard, dt, pace) {
    if (guard.routeAt >= guard.route.length) return true;
    const target = yard.waypoints[guard.route[guard.routeAt]];
    const p = guard.mover.state.spot;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      guard.routeAt += 1;
      guard.nodeId = target.id;
      return guard.routeAt >= guard.route.length;
    }
    const stride = Math.min(dist, pace * dt);
    const nx = (dx / dist) * stride;
    const nz = (dz / dist) * stride;
    guard.mover.move(nx, nz, dt);
    guard.bearing = Math.atan2(-dx, -dz);
    return false;
  }

  function spots(guard, heroSpot, heroUp) {
    if (!heroUp) return false;
    const p = guard.mover.state.spot;
    const dx = heroSpot.x - p.x;
    const dz = heroSpot.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) return false;
    // Field of view around the guard's bearing.
    const fx = -Math.sin(guard.bearing);
    const fz = -Math.cos(guard.bearing);
    if ((dx * fx + dz * fz) / (dist || 1) < VIEW_COS) return false;
    const eyeY = p.y + 1.5;
    const chestY = heroSpot.y + 1.25;
    return clearSight(p.x, eyeY, p.z, heroSpot.x, chestY, heroSpot.z, yard.solids);
  }

  // One guard shot at the striker: a ray from the guard's eye toward the
  // striker's chest with angular error. Returns 'skull' | 'chest' | null.
  function takeShot(guard, heroSpot, heroDucked, heroPace) {
    const p = guard.mover.state.spot;
    const ox = p.x;
    const oy = p.y + 1.5;
    const oz = p.z;
    const chestY = heroSpot.y + (heroDucked ? 0.85 : 1.25);
    let dx = heroSpot.x - ox;
    let dy = chestY - oy;
    let dz = heroSpot.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const dist = len;
    const err = (0.045 + dist * 0.0012 + heroPace * 0.006) * guard.aimError;
    const a = spanBetween(chance, -err, err);
    const b = spanBetween(chance, -err, err);
    // Perturb in the plane perpendicular to the shot.
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    dx += (ux / ul) * a;
    dy += b;
    dz += (uz / ul) * a;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;
    const skullY = heroSpot.y + (heroDucked ? 1.0 : 1.62);
    if (rayMeetsBall(ox, oy, oz, dx, dy, dz, heroSpot.x, skullY, heroSpot.z, 0.24)) return 'skull';
    if (rayMeetsTube(ox, oy, oz, dx, dy, dz, heroSpot.x, heroSpot.y, heroSpot.z, heroDucked ? 1.1 : 1.7, 0.45)) return 'chest';
    return null;
  }

  return {
    guards,
    standingCount() {
      let n = 0;
      for (const g of guards) if (g.up) n += 1;
      return n;
    },
    wound(id, amount, part) {
      const guard = guards[id];
      if (!guard || !guard.up) return false;
      guard.vigor -= amount;
      if (guard.vigor <= 0) {
        guard.vigor = 0;
        guard.up = false;
        guard.isDefuser = false;
        guard.rig.group.rotation.z = Math.PI / 2;
        guard.rig.group.position.y = 0.25;
      }
      return !guard.up;
    },
    hearBang(x, z) {
      for (const guard of guards) {
        if (!guard.up || guard.seesHero) continue;
        const p = guard.mover.state.spot;
        if (Math.hypot(x - p.x, z - p.z) > EARSHOT) continue;
        guard.checkNode = yard.closestNode(x, z).id;
      }
    },
    redeploy() {
      guards.forEach((guard, i) => {
        const start = yard.starts.guards[i];
        guard.vigor = 100;
        guard.up = true;
        guard.stance = 'post';
        guard.bearing = Math.PI;
        guard.route = [];
        guard.routeAt = 0;
        guard.routeGoal = -1;
        guard.routeStart = -1;
        guard.postNode = chooseOne(chance, postNodes);
        guard.postUntil = 0;
        guard.seesHero = false;
        guard.lastSpot = null;
        guard.checkNode = -1;
        guard.isDefuser = false;
        guard.shotsLeft = 0;
        guard.mover.teleport(start.x, start.z);
        guard.nodeId = yard.closestNode(start.x, start.z).id;
        guard.rig.group.rotation.z = 0;
        guard.rig.group.position.set(start.x, 0, start.z);
      });
    },
    tick(dt, ctx) {
      const now = ctx.now;
      const chargeSet = ctx.charge.isSet();
      // Pick the disarmer once, while the charge is set: the first
      // living guard nearest the charge keeps the job until it dies.
      if (chargeSet && !guards.some((g) => g.isDefuser && g.up)) {
        let best = null;
        let bestD = Infinity;
        for (const g of guards) {
          if (!g.up) continue;
          const p = g.mover.state.spot;
          const d = Math.hypot(p.x - ctx.charge.state.spot.x, p.z - ctx.charge.state.spot.z);
          if (d < bestD) { bestD = d; best = g; }
        }
        if (best) best.isDefuser = true;
      }
      for (const guard of guards) {
        if (!guard.up) continue;
        const p = guard.mover.state.spot;
        // --- Senses ---
        const sees = spots(guard, ctx.heroSpot, ctx.heroUp);
        if (sees) {
          if (!guard.seesHero) {
            const dist = Math.hypot(ctx.heroSpot.x - p.x, ctx.heroSpot.z - p.z);
            guard.fireAfter = now + Math.min(REACT_CEIL, REACT_FLOOR + dist * REACT_PER_STEP);
          }
          guard.seesHero = true;
          guard.lastSpot = { x: ctx.heroSpot.x, z: ctx.heroSpot.z };
          guard.lastSpotAt = now;
        } else if (guard.seesHero && now - guard.lastSpotAt > 1.2) {
          guard.seesHero = false;
        }
        // --- Stance ---
        // Seeing the striker always wins: the reaction delay gates firing,
        // not the turn to face the threat.
        if (guard.seesHero) guard.stance = 'fight';
        else if (guard.isDefuser && chargeSet) guard.stance = 'disarm';
        else if (chargeSet) guard.stance = 'rally';
        else if (guard.checkNode >= 0) guard.stance = 'check';
        else if (guard.stance === 'fight' || guard.stance === 'rally' || guard.stance === 'disarm' || guard.stance === 'check') guard.stance = 'post';

        // --- Movement ---
        if (guard.stance === 'fight') {
          // Face the striker and strafe; never walk into the open.
          const dx = ctx.heroSpot.x - p.x;
          const dz = ctx.heroSpot.z - p.z;
          guard.bearing = Math.atan2(-dx, -dz);
          if (now > guard.strafeTill) {
            guard.strafeWay = chance() < 0.5 ? -1 : 1;
            guard.strafeTill = now + spanBetween(chance, 0.7, 1.6);
          }
          const sx = Math.cos(guard.bearing) * guard.strafeWay;
          const sz = -Math.sin(guard.bearing) * guard.strafeWay;
          guard.mover.move(sx * PATROL_PACE * 0.45 * dt, sz * PATROL_PACE * 0.45 * dt, dt);
        } else if (guard.stance === 'disarm') {
          const s = ctx.charge.state.spot;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d > 1.2) {
            chartRoute(guard, yard.closestNode(s.x, s.z).id);
            walkRoute(guard, dt, PATROL_PACE);
          } else {
            guard.bearing = Math.atan2(-(s.x - p.x), -(s.z - p.z));
            ctx.disarmer = guard;
          }
        } else if (guard.stance === 'rally') {
          const s = ctx.charge.state.spot;
          const knot = yard.closestNode(s.x, s.z).id;
          chartRoute(guard, knot);
          if (walkRoute(guard, dt, PATROL_PACE)) {
            // Arrived: hold a little off the charge and cover.
            guard.stance = 'post';
            guard.postUntil = now + 3;
          }
        } else if (guard.stance === 'check') {
          chartRoute(guard, guard.checkNode);
          if (walkRoute(guard, dt, PATROL_PACE)) {
            guard.checkNode = -1;
            guard.postUntil = now + spanBetween(chance, 2, 5);
          }
        } else {
          // Post / patrol: sit at the post knot, then pick a new one.
          if (now >= guard.postUntil) {
            if (guard.nodeId !== guard.postNode) {
              chartRoute(guard, guard.postNode);
              walkRoute(guard, dt, PATROL_PACE * 0.8);
            } else {
              guard.postNode = chooseOne(chance, postNodes);
              guard.postUntil = now + spanBetween(chance, 3, 7);
            }
          }
        }

        // --- Firing ---
        if (guard.stance === 'fight' && guard.seesHero && now >= guard.fireAfter) {
          if (guard.shotsLeft <= 0 && now >= guard.nextShotAt) {
            guard.shotsLeft = 3 + Math.floor(chance() * 3);
            guard.nextShotAt = now;
          }
          if (guard.shotsLeft > 0 && now >= guard.nextShotAt) {
            guard.shotsLeft -= 1;
            guard.nextShotAt = now + 0.16;
            if (guard.shotsLeft === 0) guard.nextShotAt = now + spanBetween(chance, 0.5, 0.9);
            const hit = takeShot(guard, ctx.heroSpot, ctx.heroDucked, ctx.heroPace);
            sound.distantShot();
            if (hit) ctx.onGuardHit(guard, hit);
          }
        }
        // --- Rig follows the mover ---
        guard.rig.group.position.set(p.x, p.y, p.z);
        guard.rig.group.rotation.y = guard.bearing;
      }
    },
  };
}
