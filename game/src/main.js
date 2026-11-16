// Boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. Rounds flow buy -> live -> over -> next buy, and
// the match ends at 5 round wins or 9 rounds. ?shot=start|play|end with
// &seed=N sets up a deterministic frame for a capture, renders it twice,
// then freezes it and sets window.__shotReady. ?debug=1 exposes the
// window.__tide handle the play-test drives; ?lowfx=1 drops shadows.
import * as THREE from 'three';
import { PALETTE, FOG } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, createGrenade, BUY_KEYS, GRENADE, ARMOR } from './weapons.js';
import { createBots } from './bots.js';
import { createSpike } from './spike.js';
import { createEconomy, WIN_ROUNDS } from './economy.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const ROUND_OVER_WAIT = 3.5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const debug = params.get('debug') === '1';
const lowfx = params.get('lowfx') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowfx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), FOG.near, FOG.far);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene, random);
if (lowfx) world.setLowFx(true);
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world, audio);
const weapons = createWeapons(audio);
const bots = createBots(scene, world, random, audio);
const spike = createSpike(audio);
const economy = createEconomy();
const fx = createFx(scene);
const hud = createHud();
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

const body = player.state;
const botHitMeshes = [];
for (const b of bots.bots) botHitMeshes.push(b.mesh.torso, b.mesh.head);
const shootables = world.shootables.concat(botHitMeshes);

const game = {
  time: 0,
  started: false,
  frozen: false,
  overAt: 0,
  matchDone: false,
  grenades: [],
  scoped: false,
  defuseBot: null,
  deadShown: false,
  kills: 0,
};

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function refreshHud() {
  hud.setHealth(player.state.health, player.state.armor);
  const w = weapons.currentDef();
  hud.setAmmo(weapons.state.mag[weapons.state.current], weapons.state.reserve[weapons.state.current], w.name);
  hud.setMoney(economy.state.money);
  hud.setTimer(economy.state.phaseTime, economy.state.phase);
  hud.setScore(economy.state.wins, economy.state.losses, economy.state.round);
  hud.setSpike(spike.isPlanted() ? spike.state.timer : null);
}

function endRound(won, reason) {
  if (economy.state.phase === 'over') return;
  const matchOver = economy.endRound(won, reason);
  game.overAt = game.time + ROUND_OVER_WAIT;
  hud.hidePlant();
  hud.setScope(false);
  game.scoped = false;
  if (won) {
    audio.roundWon();
    hud.banner('ROUND WON', reason.toUpperCase(), 3000);
  } else {
    audio.roundLost();
    hud.banner('ROUND LOST', reason.toUpperCase(), 3000);
  }
  hud.killfeed(won ? `Round ${economy.state.round} — attackers take it (${reason})` : `Round ${economy.state.round} — defenders hold (${reason})`);
  if (matchOver) {
    game.matchDone = true;
    hud.banner(
      economy.state.wins > economy.state.losses ? 'MATCH WON' : 'MATCH LOST',
      `${economy.state.wins} — ${economy.state.losses} after ${economy.state.round} rounds`,
      6000,
    );
  }
  refreshHud();
}

function startNextRound() {
  player.respawn();
  bots.reset();
  spike.reset();
  weapons.resetForRound(false);
  game.grenades = [];
  game.defuseBot = null;
  economy.nextRound();
  hud.hideBanner();
  hud.showBuy(true);
  refreshHud();
}

function startMatch() {
  economy.state.round = 0; // startNextRound advances it to 1
  economy.state.wins = 0;
  economy.state.losses = 0;
  economy.state.money = 800;
  economy.state.lossStreak = 0;
  game.matchDone = false;
  game.kills = 0;
  startNextRound();
}

function shoot() {
  if (!weapons.ready()) {
    if (weapons.state.mag[weapons.state.current] === 0) weapons.dryFire();
    return false;
  }
  weapons.fire();
  const spread = weapons.spread(player.groundSpeed(), player.state.crouched, game.scoped);
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  muzzle.y -= 0.22;
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hits = raycaster.intersectObjects(shootables, false);
  let end = null;
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;
    const ud = hit.object.userData;
    if (ud && typeof ud.bot === 'number') {
      const w = weapons.currentDef();
      const head = ud.part === 'head';
      const dmg = Math.round(w.damage * (head ? w.headMult : 1));
      const killed = bots.damage(ud.bot, dmg, ud.part);
      hud.hitMarker(head, shot ? 4000 : 90);
      audio.hit(head);
      fx.sparks(hit.point, killed ? 14 : 8);
      if (killed) {
        game.kills += 1;
        economy.addKillReward();
        audio.kill();
        hud.killfeed(`You dropped defender ${ud.bot + 1}${head ? ' (headshot)' : ''} — +$300`);
      }
    } else {
      fx.sparks(hit.point, 5);
    }
  } else {
    end = hitPoint.copy(camera.position).addScaledVector(direction, 80);
  }
  fx.tracer(muzzle, end);
  fx.muzzle(muzzle, camera);
  bots.hearShot(body.position.x, body.position.z);
  refreshHud();
  return true;
}

function throwGrenade() {
  if (!weapons.throwGrenade()) return;
  camera.getWorldDirection(direction);
  const origin = {
    x: body.position.x + direction.x * 0.5,
    y: body.position.y + body.eye - 0.1,
    z: body.position.z + direction.z * 0.5,
  };
  game.grenades.push(createGrenade(origin, direction));
  bots.hearShot(body.position.x, body.position.z);
}

function explodeGrenade(g) {
  fx.explosion(g.position);
  audio.explosion();
  const r = GRENADE.radius;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const p = bot.body.state.position;
    const d = Math.hypot(p.x - g.position.x, (p.y + 1 - g.position.y), p.z - g.position.z);
    if (d > r) continue;
    const dmg = Math.round(GRENADE.damage * (1 - (d / r) * 0.7));
    const killed = bots.damage(bot.id, dmg, 'body');
    if (killed) {
      game.kills += 1;
      economy.addKillReward();
      hud.killfeed(`Grenade dropped defender ${bot.id + 1} — +$300`);
    }
  }
  const pp = body.position;
  const pd = Math.hypot(pp.x - g.position.x, (pp.y + 1 - g.position.y), pp.z - g.position.z);
  if (pd <= r && player.state.alive) {
    const dmg = Math.round(GRENADE.damage * (1 - (pd / r) * 0.7));
    player.damage(dmg);
    hud.damageFlash();
    audio.hurt();
  }
  refreshHud();
}

function step(dt) {
  game.time += dt;
  // Round clock.
  const clock = economy.step(dt);
  if (clock === 'live') {
    hud.showBuy(false);
    hud.banner('ROUND LIVE', `First to ${WIN_ROUNDS} — plant the spike`, 2000);
  }
  // Player movement + weapon timers.
  player.step(dt, input.state.keys, game.time);
  weapons.step(dt);
  // Grenades.
  for (let i = game.grenades.length - 1; i >= 0; i -= 1) {
    const g = game.grenades[i];
    g.step(dt);
    if (g.exploded) {
      explodeGrenade(g);
      game.grenades.splice(i, 1);
    }
  }
  // Spike detonation timer.
  const spikeEvent = spike.step(dt);
  if (spikeEvent === 'detonated') {
    const s = spike.state.position;
    if (s) fx.explosion(s);
    endRound(true, 'spike detonated');
  }
  // Bots run only while the round is live: the buy phase is freeze time
  // (no sensing, no shooting, no moving), and the round-over wait is a
  // ceasefire. Without this the defenders gun the player down at spawn
  // before the round even starts.
  game.defuseBot = null;
  if (economy.state.phase === 'live') {
    // The ctx is a fresh object each frame; the defuser reports itself by
    // setting ctx.defuseBot, so read it back after the step.
    const ctx = {
      time: game.time,
      playerPos: body.position,
      playerAlive: player.state.alive,
      playerCrouched: player.state.crouched,
      playerSpeed: player.groundSpeed(),
      spike,
      onBotHit(bot, part) {
        if (!player.state.alive) return;
        const dmg = part === 'head' ? 40 : 20;
        player.damage(dmg);
        hud.damageFlash();
        audio.hurt();
        hud.killfeed(`Defender ${bot.id + 1} hit you${part === 'head' ? ' (headshot)' : ''}`);
        refreshHud();
      },
    };
    bots.step(dt, ctx);
    game.defuseBot = ctx.defuseBot || null;
  }
  // The defuser channels the defuse while it stands by the spike.
  if (game.defuseBot && spike.isPlanted()) {
    if (spike.defuseStep(dt, true, true)) {
      endRound(false, 'spike defused');
    }
  }
  // Planting: hold E inside a site, standing still.
  if (economy.state.phase === 'live' && player.state.alive && (spike.state.mode === 'carried' || spike.state.mode === 'planting')) {
    const still = player.groundSpeed() < 0.5;
    const inA = world.inSite(body.position, world.sites.A);
    const inB = world.inSite(body.position, world.sites.B);
    if (input.state.keys.has('KeyE') && (inA || inB)) {
      const siteId = inA ? 'A' : 'B';
      spike.plantStep(dt, true, still, siteId, body.position);
      hud.showPlant(`PLANTING — ${world.sites[siteId].name}`, spike.state.plantProgress / 3.5);
    } else if (spike.state.mode === 'planting') {
      spike.state.mode = 'carried';
      spike.state.plantProgress = 0;
      hud.hidePlant();
    }
  } else if (spike.state.mode === 'planting') {
    spike.state.mode = 'carried';
    spike.state.plantProgress = 0;
    hud.hidePlant();
  }
  if (spike.state.mode !== 'planting') hud.hidePlant();
  if (spike.state.mode === 'planted' || spike.state.mode === 'defusing') {
    hud.setSpike(spike.state.timer);
  }
  // The player went down while the spike is planted: the round plays on
  // without them. Show the down overlay once; Continue spectates.
  if (!player.state.alive && economy.state.phase === 'live' && spike.isPlanted() && !game.deadShown) {
    game.deadShown = true;
    hud.showOverlay('dead');
  }
  if (player.state.alive) game.deadShown = false;
  // --- Round-end checks, every step, however the round was decided. ---
  if (economy.state.phase === 'live') {
    if (bots.aliveCount() === 0) endRound(true, 'yard cleared');
    else if (!player.state.alive && !spike.isPlanted()) endRound(false, 'you are down');
    else if (clock === 'time' && !spike.isPlanted()) endRound(false, 'time expired');
  }
  // --- Round-over wait, then the next round or the match end. ---
  if (economy.state.phase === 'over' && game.time >= game.overAt) {
    if (game.matchDone) {
      hud.showOverlay('match', `${economy.state.wins} — ${economy.state.losses}`);
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      startNextRound();
    }
  }
  fx.step(dt);
  world.update(dt);
  refreshHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (game.frozen) {
    renderer.render(scene, camera);
    return;
  }
  if (game.started) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.setCrouch(input.state.keys.has('ControlLeft') || input.state.keys.has('KeyC'));
    player.setAim(input.state.aiming && weapons.currentDef().scoped);
    // Scope: DMR + right mouse zooms the view.
    const wantScope = player.state.aiming && weapons.currentDef().scoped && player.state.alive;
    if (wantScope !== game.scoped) {
      game.scoped = wantScope;
      hud.setScope(wantScope);
    }
    camera.fov += ((wantScope ? 28 : 74) - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
    // Firing. Semi-auto weapons fire on the press itself (consume the
    // MouseDown), not on the held state: in a slow renderer the button
    // is already up by the time a frame runs, and gating on `firing`
    // would swallow the shot.
    const mouseDown = input.consume('MouseDown');
    if (economy.state.phase === 'live' && player.state.alive) {
      const w = weapons.currentDef();
      if (w.auto) {
        if (input.state.firing && weapons.ready()) shoot();
        else if (mouseDown && weapons.state.mag[weapons.state.current] === 0) weapons.dryFire();
      } else if (mouseDown) {
        shoot();
      }
    }
    if (input.consume('KeyR')) weapons.startReload();
    if (input.consume('KeyG') && economy.state.phase === 'live') throwGrenade();
    // Buy keys, live only in the buy phase.
    if (economy.state.phase === 'buy') {
      for (const [code, id] of Object.entries(BUY_KEYS)) {
        if (!input.consume(code)) continue;
        if (id === 'armor') {
          if (economy.spend(ARMOR.price)) {
            player.state.armor = Math.min(100, player.state.armor + ARMOR.amount);
            hud.killfeed(`Plating fitted (+${ARMOR.amount} armour)`);
          }
        } else {
          const price = weapons.buy(id, economy.state.money);
          if (price > 0) economy.spend(price);
        }
        refreshHud();
      }
    }
    // Weapon select 1-4 outside the buy phase.
    if (economy.state.phase !== 'buy') {
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
        if (input.consume(code)) weapons.select(BUY_KEYS[code]);
      }
    }
    input.drainPressed();
    // Fixed-step simulation.
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // Crosshair spread follows the current weapon spread.
    const spreadPx = 4 + weapons.spread(player.groundSpeed(), player.state.crouched, game.scoped) * 900;
    hud.setCrosshairSpread(Math.round(spreadPx));
  }
  renderer.render(scene, camera);
}

let accumulator = 0;
let lastTime = performance.now();

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
  } else if (game.started && !game.matchDone && economy.state.phase !== 'over') {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.matchDone) {
    startMatch();
    game.started = true;
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  if (!game.started) {
    game.started = true;
    startMatch();
  }
  hud.hideOverlay();
  input.requestLock();
});

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  game.started = true;
  if (name === 'start') {
    body.yaw = 0.35;
    body.pitch = 0.02;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.showOverlay('start');
    paintTwiceThenReady();
    return;
  }
  // play / end: jump straight into a live round.
  startMatch();
  economy.startLive();
  hud.showBuy(false);
  if (name === 'play') {
    // body.position is a plain {x,y,z} (not a Vector3): teleport instead.
    player.body.teleport(0, 8);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    // Buy the rifle, then fire at the nearest bot. The rifle costs more
    // than the $800 start, so grant the funds first (shot setup only).
    economy.state.money = 3000;
    economy.spend(weapons.buy('rifle', economy.state.money));
    const bot = bots.bots.find((b) => b.alive);
    if (bot) {
      const p = bot.body.state.position;
      aimAt(new THREE.Vector3(p.x, p.y + 1.3, p.z));
      for (let i = 0; i < 3; i += 1) {
        shoot();
        settle(8);
      }
    }
    settle(12);
    hud.setHealth(player.state.health, player.state.armor);
    paintTwiceThenReady();
    return;
  }
  // end: plant, detonate, show the win banner.
  player.body.teleport(16, -6);
  body.yaw = Math.PI * 0.75;
  settle(10);
  spike.state.mode = 'planted';
  spike.state.site = 'A';
  spike.state.position = { x: 16, y: 0, z: -6 };
  spike.state.timer = 0.5;
  settle(40);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      game.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Test handle: the play-test drives the sim through this and reads state.
window.__tide = {
  game,
  player,
  bots,
  economy,
  weapons,
  spike,
  world,
  hud,
  advance(seconds) {
    const steps = Math.min(60 * 180, Math.round(seconds * 60));
    settle(steps);
    syncCamera();
    renderer.render(scene, camera);
  },
  start() {
    if (!game.started) {
      game.started = true;
      startMatch();
    }
  },
  teleport(x, z) {
    player.body.teleport(x, z);
    syncCamera();
  },
  aimAtBot(i) {
    const bot = bots.bots[i];
    if (!bot) return false;
    const p = bot.body.state.position;
    aimAt(new THREE.Vector3(p.x, p.y + 1.3, p.z));
    return true;
  },
  setBotError(i, scale) {
    if (bots.bots[i]) bots.bots[i].errorScale = scale;
  },
  shoot,
  // Debug probe: run the same ray the shot uses and report the first hit.
  probeShot() {
    camera.getWorldDirection(direction);
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, direction);
    const hits = raycaster.intersectObjects(shootables, false);
    if (hits.length === 0) return { hits: 0 };
    const h = hits[0];
    return {
      hits: hits.length,
      dist: Number(h.distance.toFixed(3)),
      point: [Number(h.point.x.toFixed(2)), Number(h.point.y.toFixed(2)), Number(h.point.z.toFixed(2))],
      userData: h.object.userData || null,
    };
  },
  forcePlant(siteId) {
    const site = world.sites[siteId];
    spike.state.mode = 'planted';
    spike.state.site = siteId;
    spike.state.position = { x: site.center.x, y: 0, z: site.center.z };
    spike.state.timer = 35;
  },
};

syncCamera();
refreshHud();
hud.setBuyAfford(800, {});
if (shot) runShot(shot);
else requestAnimationFrame(frame);
