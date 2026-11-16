// Bots: five defenders. Each one is a body with a small state machine —
// patrol, hold, engage, converge, defuse — driven by sight, sound and
// the spike. Sight needs line of sight plus a field of view; a bot that
// spots the player waits out a distance-based reaction delay before it
// fires, and fires in bursts with distance- and speed-based error, so a
// fast-moving target at range is hard to hit. Gunfire within 28 m is
// heard and investigated. When the spike is planted exactly one bot
// becomes the defuser (sticky: it stays the defuser until it dies, walks
// off or the spike is gone) and the rest hold the site. Paths are
// recomputed only when the destination node changes — never every step,
// or the bot never arrives.
import * as THREE from 'three';
import { createBody, hasLineOfSight } from './body.js';
import { pick, range } from './rng.js';

const BOT_SPEED = 4.2;
const FOV_COS = Math.cos((100 / 2) * (Math.PI / 180)); // 100-degree field of view
const HEAR_RADIUS = 28;
const REACT_BASE = 0.35;
const REACT_PER_M = 0.012;
const REACT_MAX = 0.9;

function rayHitsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return false;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  return d2 <= r * r;
}

function rayHitsCapsule(ox, oy, oz, dx, dy, dz, px, py, pz, height, radius) {
  // Sample the vertical segment; the closest sample decides the hit.
  for (let i = 0; i <= 5; i += 1) {
    const y = py + (height * i) / 5;
    if (rayHitsSphere(ox, oy, oz, dx, dy, dz, px, y, pz, radius)) return true;
  }
  return false;
}

export function createBots(scene, world, random, audio) {
  const bots = [];
  const geoBox = new THREE.BoxGeometry(1, 1, 1);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4552, roughness: 0.8, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.9, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 1.6 });

  function buildMesh(id) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(geoBox, bodyMat);
    torso.scale.set(0.56, 0.72, 0.32);
    torso.position.y = 1.05;
    torso.userData = { bot: id, part: 'body' };
    const head = new THREE.Mesh(geoBox, darkMat);
    head.scale.set(0.34, 0.32, 0.32);
    head.position.y = 1.58;
    head.userData = { bot: id, part: 'head' };
    const visor = new THREE.Mesh(geoBox, visorMat);
    visor.scale.set(0.26, 0.07, 0.05);
    visor.position.set(0, 1.6, 0.17);
    const legL = new THREE.Mesh(geoBox, darkMat);
    legL.scale.set(0.2, 0.62, 0.24);
    legL.position.set(-0.15, 0.31, 0);
    const legR = new THREE.Mesh(geoBox, darkMat);
    legR.scale.set(0.2, 0.62, 0.24);
    legR.position.set(0.15, 0.31, 0);
    const gun = new THREE.Mesh(geoBox, darkMat);
    gun.scale.set(0.09, 0.09, 0.7);
    gun.position.set(0.28, 1.15, 0.3);
    group.add(torso, head, visor, legL, legR, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    scene.add(group);
    return { group, torso, head };
  }

  const holdSpots = [9, 10, 11, 12, 13, 14, 16, 17, 20, 21, 22];
  for (let i = 0; i < 5; i += 1) {
    const spawn = world.spawns.defenders[i];
    const body = createBody(world.colliders, spawn.x, spawn.z);
    const mesh = buildMesh(i);
    mesh.group.position.set(spawn.x, 0, spawn.z);
    bots.push({
      id: i,
      body,
      mesh,
      health: 100,
      alive: true,
      mode: 'hold',
      facing: Math.PI, // face south, toward the attackers
      node: world.nearestNode(spawn.x, spawn.z).id,
      path: [],
      pathIndex: 0,
      pathTarget: -1,
      pathFrom: -1, // node the current path was computed from; recompute if it moved
      holdNode: pick(random, holdSpots),
      holdUntil: 0,
      seePlayer: false,
      reactAt: 0,
      lastSeen: null,
      lastSeenAt: -100,
      burstLeft: 0,
      fireAt: 0,
      investigateNode: -1,
      defuser: false,
      strafeDir: 1,
      strafeUntil: 0,
      errorScale: 1, // test hook: set to 0 for perfect aim
    });
  }

  function setPath(bot, targetNode) {
    // Recompute when the target changes OR the bot has moved to a different
    // node since the path was computed (it strafed while engaging, so its
    // stored node is stale and the old path no longer starts near it).
    if (bot.pathTarget === targetNode && bot.pathFrom === bot.node) return;
    bot.pathTarget = targetNode;
    bot.pathFrom = bot.node;
    bot.path = world.findPath(bot.node, targetNode);
    bot.pathIndex = 0;
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const target = world.nodes[bot.path[bot.pathIndex]];
    const p = bot.body.state.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      bot.pathIndex += 1;
      bot.node = target.id;
      return bot.pathIndex >= bot.path.length;
    }
    const step = Math.min(dist, speed * dt);
    const nx = (dx / dist) * step;
    const nz = (dz / dist) * step;
    bot.body.move(nx, nz, dt);
    bot.facing = Math.atan2(-dx, -dz);
    return false;
  }

  function canSee(bot, playerPos, playerAlive) {
    if (!playerAlive) return false;
    const p = bot.body.state.position;
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) return false;
    // Field of view around the bot's facing.
    const fx = -Math.sin(bot.facing);
    const fz = -Math.cos(bot.facing);
    if ((dx * fx + dz * fz) / (dist || 1) < FOV_COS) return false;
    const eyeY = p.y + 1.5;
    const chestY = playerPos.y + 1.25;
    return hasLineOfSight(p.x, eyeY, p.z, playerPos.x, chestY, playerPos.z, world.colliders);
  }

  // One bot shot at the player: a ray from the bot's eye toward the
  // player's chest with angular error. Returns 'head' | 'body' | null.
  function botShot(bot, playerPos, playerCrouched, playerSpeed) {
    const p = bot.body.state.position;
    const ox = p.x;
    const oy = p.y + 1.5;
    const oz = p.z;
    const chestY = playerPos.y + (playerCrouched ? 0.85 : 1.25);
    let dx = playerPos.x - ox;
    let dy = chestY - oy;
    let dz = playerPos.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const dist = len;
    const err = (0.045 + dist * 0.0012 + playerSpeed * 0.006) * bot.errorScale;
    const a = range(random, -err, err);
    const b = range(random, -err, err);
    // Perturb in the plane perpendicular to the shot.
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    dx += (ux / ul) * a;
    dy += b;
    dz += (uz / ul) * a;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;
    const headY = playerPos.y + (playerCrouched ? 1.0 : 1.62);
    if (rayHitsSphere(ox, oy, oz, dx, dy, dz, playerPos.x, headY, playerPos.z, 0.24)) return 'head';
    if (rayHitsCapsule(ox, oy, oz, dx, dy, dz, playerPos.x, playerPos.y, playerPos.z, playerCrouched ? 1.1 : 1.7, 0.45)) return 'body';
    return null;
  }

  return {
    bots,
    aliveCount() {
      let n = 0;
      for (const b of bots) if (b.alive) n += 1;
      return n;
    },
    damage(id, amount, part) {
      const bot = bots[id];
      if (!bot || !bot.alive) return false;
      bot.health -= amount;
      if (bot.health <= 0) {
        bot.health = 0;
        bot.alive = false;
        bot.defuser = false;
        bot.mesh.group.rotation.z = Math.PI / 2;
        bot.mesh.group.position.y = 0.25;
      }
      return !bot.alive;
    },
    hearShot(x, z) {
      for (const bot of bots) {
        if (!bot.alive || bot.seePlayer) continue;
        const p = bot.body.state.position;
        if (Math.hypot(x - p.x, z - p.z) > HEAR_RADIUS) continue;
        bot.investigateNode = world.nearestNode(x, z).id;
      }
    },
    reset() {
      bots.forEach((bot, i) => {
        const spawn = world.spawns.defenders[i];
        bot.health = 100;
        bot.alive = true;
        bot.mode = 'hold';
        bot.facing = Math.PI;
        bot.path = [];
        bot.pathIndex = 0;
        bot.pathTarget = -1;
        bot.pathFrom = -1;
        bot.holdNode = pick(random, holdSpots);
        bot.holdUntil = 0;
        bot.seePlayer = false;
        bot.lastSeen = null;
        bot.investigateNode = -1;
        bot.defuser = false;
        bot.burstLeft = 0;
        bot.body.teleport(spawn.x, spawn.z);
        bot.node = world.nearestNode(spawn.x, spawn.z).id;
        bot.mesh.group.rotation.z = 0;
        bot.mesh.group.position.set(spawn.x, 0, spawn.z);
      });
    },
    step(dt, ctx) {
      const now = ctx.time;
      const spikePlanted = ctx.spike.isPlanted();
      // Pick the defuser once, while the spike is planted: the first
      // living bot nearest the spike keeps the job until it dies.
      if (spikePlanted && !bots.some((b) => b.defuser && b.alive)) {
        let best = null;
        let bestD = Infinity;
        for (const b of bots) {
          if (!b.alive) continue;
          const p = b.body.state.position;
          const d = Math.hypot(p.x - ctx.spike.state.position.x, p.z - ctx.spike.state.position.z);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best) best.defuser = true;
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        const p = bot.body.state.position;
        // --- Senses ---
        const sees = canSee(bot, ctx.playerPos, ctx.playerAlive);
        if (sees) {
          if (!bot.seePlayer) {
            const dist = Math.hypot(ctx.playerPos.x - p.x, ctx.playerPos.z - p.z);
            bot.reactAt = now + Math.min(REACT_MAX, REACT_BASE + dist * REACT_PER_M);
          }
          bot.seePlayer = true;
          bot.lastSeen = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          bot.lastSeenAt = now;
        } else if (bot.seePlayer && now - bot.lastSeenAt > 1.2) {
          bot.seePlayer = false;
        }
        // --- Mode ---
        // Seeing the player always wins: the reaction delay gates firing,
        // not the turn to face the threat.
        if (bot.seePlayer) bot.mode = 'engage';
        else if (bot.defuser && spikePlanted) bot.mode = 'defuse';
        else if (spikePlanted) bot.mode = 'converge';
        else if (bot.investigateNode >= 0) bot.mode = 'investigate';
        else if (bot.mode === 'engage' || bot.mode === 'converge' || bot.mode === 'defuse' || bot.mode === 'investigate') bot.mode = 'hold';

        // --- Movement ---
        if (bot.mode === 'engage') {
          // Face the player and strafe; never walk into the open.
          const dx = ctx.playerPos.x - p.x;
          const dz = ctx.playerPos.z - p.z;
          bot.facing = Math.atan2(-dx, -dz);
          if (now > bot.strafeUntil) {
            bot.strafeDir = random() < 0.5 ? -1 : 1;
            bot.strafeUntil = now + range(random, 0.7, 1.6);
          }
          const sx = Math.cos(bot.facing) * bot.strafeDir;
          const sz = -Math.sin(bot.facing) * bot.strafeDir;
          bot.body.move(sx * BOT_SPEED * 0.45 * dt, sz * BOT_SPEED * 0.45 * dt, dt);
        } else if (bot.mode === 'defuse') {
          const s = ctx.spike.state.position;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d > 1.2) {
            setPath(bot, world.nearestNode(s.x, s.z).id);
            moveAlongPath(bot, dt, BOT_SPEED);
          } else {
            bot.facing = Math.atan2(-(s.x - p.x), -(s.z - p.z));
            ctx.defuseBot = bot;
          }
        } else if (bot.mode === 'converge') {
          const s = ctx.spike.state.position;
          const node = world.nearestNode(s.x, s.z).id;
          setPath(bot, node);
          if (moveAlongPath(bot, dt, BOT_SPEED)) {
            // Arrived: hold a little off the spike and cover.
            bot.mode = 'hold';
            bot.holdUntil = now + 3;
          }
        } else if (bot.mode === 'investigate') {
          setPath(bot, bot.investigateNode);
          if (moveAlongPath(bot, dt, BOT_SPEED)) {
            bot.investigateNode = -1;
            bot.holdUntil = now + range(random, 2, 5);
          }
        } else {
          // Hold / patrol: sit at the hold node, then pick a new one.
          if (now >= bot.holdUntil) {
            if (bot.node !== bot.holdNode) {
              setPath(bot, bot.holdNode);
              moveAlongPath(bot, dt, BOT_SPEED * 0.8);
            } else {
              bot.holdNode = pick(random, holdSpots);
              bot.holdUntil = now + range(random, 3, 7);
            }
          }
        }

        // --- Firing ---
        if (bot.mode === 'engage' && bot.seePlayer && now >= bot.reactAt) {
          if (bot.burstLeft <= 0 && now >= bot.fireAt) {
            bot.burstLeft = 3 + Math.floor(random() * 3);
            bot.fireAt = now;
          }
          if (bot.burstLeft > 0 && now >= bot.fireAt) {
            bot.burstLeft -= 1;
            bot.fireAt = now + 0.16;
            if (bot.burstLeft === 0) bot.fireAt = now + range(random, 0.5, 0.9);
            const hit = botShot(bot, ctx.playerPos, ctx.playerCrouched, ctx.playerSpeed);
            audio.enemyShot();
            if (hit) ctx.onBotHit(bot, hit);
          }
        }
        // --- Mesh follows the body ---
        bot.mesh.group.position.set(p.x, p.y, p.z);
        bot.mesh.group.rotation.y = bot.facing;
      }
    },
  };
}
