// Boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. Rounds flow shop -> live -> over -> next shop, and
// the match ends at 5 round wins or 9 rounds. ?shot=start|play|end with
// &seed=N sets up a deterministic frame for a capture, renders it twice,
// then freezes it and sets window.__shotReady. ?debug=1 exposes the
// window.__harbor handle the play-test drives; ?lowfx=1 drops shadows.
import * as THREE from 'three';
import { HARBOR, MIST } from './palette.js';
import { seededStream } from './rng.js';
import { raiseYard } from './world.js';
import { wireControls } from './input.js';
import { makeAttacker } from './player.js';
import { rackGuns, lobFrag, SHOP_KEYS, FRAG, PLATING } from './weapons.js';
import { fieldSquad } from './bots.js';
import { rigCharge, PLANT_SPAN } from './spike.js';
import { openLedger, ROUNDS_TO_WIN } from './economy.js';
import { stageEffects } from './fx.js';
import { buildReadout } from './hud.js';
import { buildSoundboard } from './audio.js';

const TICK = 1 / 60;
const BREAK_SPAN = 3.5;
const query = new URLSearchParams(window.location.search);
const capture = query.get('shot');
const probe = query.get('debug') === '1';
const softfx = query.get('lowfx') === '1';
const grain = Number.parseInt(query.get('seed') ?? '1', 10) || 1;
const chance = seededStream(grain);

const view = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
view.setPixelRatio(Math.min(window.devicePixelRatio, 2));
view.setSize(window.innerWidth, window.innerHeight);
view.shadowMap.enabled = !softfx;
view.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(view.domElement);

const stage = new THREE.Scene();
stage.background = new THREE.Color(HARBOR.night);
stage.fog = new THREE.Fog(new THREE.Color(HARBOR.night), MIST.close, MIST.distant);
const lens = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
stage.add(lens);

const sound = buildSoundboard();
const yard = raiseYard(stage, chance);
if (softfx) yard.softMode(true);
const controls = wireControls(view.domElement, onCapture);
const striker = makeAttacker(yard, sound);
const rack = rackGuns(sound);
const squad = fieldSquad(stage, yard, chance, sound);
const charge = rigCharge(sound);
const ledger = openLedger();
const effects = stageEffects(stage);
const readout = buildReadout();
const caster = new THREE.Raycaster();
caster.far = 90;
const ray = new THREE.Vector3();
const muzzleTip = new THREE.Vector3();
const farPoint = new THREE.Vector3();

const hero = striker.state;
const guardMeshes = [];
for (const g of squad.guards) guardMeshes.push(g.rig.chest, g.rig.skull);
const targets = yard.targets.concat(guardMeshes);

const match = {
  clock: 0,
  begun: false,
  held: false,
  breakAt: 0,
  settled: false,
  frags: [],
  zoomed: false,
  disarmer: null,
  downShown: false,
  drops: 0,
};

function placeCamera() {
  lens.position.set(hero.spot.x, hero.spot.y + hero.eyeHeight, hero.spot.z);
  lens.rotation.set(hero.tilt, hero.heading, 0, 'YXZ');
}

function facePoint(point) {
  const dx = point.x - hero.spot.x;
  const dy = point.y - (hero.spot.y + hero.eyeHeight);
  const dz = point.z - hero.spot.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  hero.heading = Math.atan2(-dx, -dz);
  hero.tilt = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  placeCamera();
}

function paintHud() {
  readout.showVigor(striker.state.vigor, striker.state.plating);
  const w = rack.inHandDef();
  readout.showAmmo(rack.state.clip[rack.state.inHand], rack.state.spare[rack.state.inHand], w.label);
  readout.showFunds(ledger.books.funds);
  readout.showClock(ledger.books.stageLeft, ledger.books.stage);
  readout.showTally(ledger.books.taken, ledger.books.ceded, ledger.books.roundNo);
  readout.showFuse(charge.isSet() ? charge.state.fuseLeft : null);
}

function closeRound(won, cause) {
  if (ledger.books.stage === 'over') return;
  const settled = ledger.settleRound(won, cause);
  match.breakAt = match.clock + BREAK_SPAN;
  readout.hideChannel();
  readout.showLens(false);
  match.zoomed = false;
  if (won) {
    sound.winFanfare();
    readout.showFlag('ROUND WON', cause.toUpperCase(), 3000);
  } else {
    sound.loseDirge();
    readout.showFlag('ROUND LOST', cause.toUpperCase(), 3000);
  }
  readout.feedLine(won ? `Round ${ledger.books.roundNo} — attackers take it (${cause})` : `Round ${ledger.books.roundNo} — defenders hold (${cause})`);
  if (settled) {
    match.settled = true;
    readout.showFlag(
      ledger.books.taken > ledger.books.ceded ? 'MATCH WON' : 'MATCH LOST',
      `${ledger.books.taken} — ${ledger.books.ceded} after ${ledger.books.roundNo} rounds`,
      6000,
    );
  }
  paintHud();
}

function openNextRound() {
  striker.redeploy();
  squad.redeploy();
  charge.clear();
  rack.freshRound(false);
  match.frags = [];
  match.disarmer = null;
  ledger.advanceRound();
  readout.clearFlag();
  readout.showShop(true);
  paintHud();
}

function openMatch() {
  ledger.books.roundNo = 0; // openNextRound advances it to 1
  ledger.books.taken = 0;
  ledger.books.ceded = 0;
  ledger.books.funds = 800;
  ledger.books.losingRun = 0;
  match.settled = false;
  match.drops = 0;
  openNextRound();
}

function fireShot() {
  if (!rack.canFire()) {
    if (rack.state.clip[rack.state.inHand] === 0) rack.clickEmpty();
    return false;
  }
  rack.discharge();
  const spread = rack.cone(striker.paceNow(), striker.state.ducked, match.zoomed);
  lens.getWorldDirection(ray);
  ray.x += (chance() * 2 - 1) * spread;
  ray.y += (chance() * 2 - 1) * spread;
  ray.z += (chance() * 2 - 1) * spread;
  ray.normalize();
  muzzleTip.copy(lens.position).addScaledVector(ray, 0.6);
  muzzleTip.y -= 0.22;
  stage.updateMatrixWorld(true);
  caster.set(lens.position, ray);
  const hits = caster.intersectObjects(targets, false);
  let end = null;
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;
    const ud = hit.object.userData;
    if (ud && typeof ud.guard === 'number') {
      const w = rack.inHandDef();
      const skull = ud.part === 'skull';
      const dmg = Math.round(w.hurt * (skull ? w.headX : 1));
      const killed = squad.wound(ud.guard, dmg, ud.part);
      readout.markHit(skull, capture ? 4000 : 90);
      sound.hitPing(skull);
      effects.shower(hit.point, killed ? 14 : 8);
      if (killed) {
        match.drops += 1;
        ledger.payKill();
        sound.killChime();
        readout.feedLine(`You dropped guard ${ud.guard + 1}${skull ? ' (headshot)' : ''} — +$300`);
      }
    } else {
      effects.shower(hit.point, 5);
    }
  } else {
    end = farPoint.copy(lens.position).addScaledVector(ray, 80);
  }
  effects.streak(muzzleTip, end);
  effects.flash(muzzleTip, lens);
  squad.hearBang(hero.spot.x, hero.spot.z);
  paintHud();
  return true;
}

function hurlFrag() {
  if (!rack.tossFrag()) return;
  lens.getWorldDirection(ray);
  const origin = {
    x: hero.spot.x + ray.x * 0.5,
    y: hero.spot.y + hero.eyeHeight - 0.1,
    z: hero.spot.z + ray.z * 0.5,
  };
  match.frags.push(lobFrag(origin, ray));
  squad.hearBang(hero.spot.x, hero.spot.z);
}

function burstFrag(g) {
  effects.detonate(g.spot);
  sound.blast();
  const r = FRAG.radius;
  for (const guard of squad.guards) {
    if (!guard.up) continue;
    const p = guard.mover.state.spot;
    const d = Math.hypot(p.x - g.spot.x, (p.y + 1 - g.spot.y), p.z - g.spot.z);
    if (d > r) continue;
    const dmg = Math.round(FRAG.hurt * (1 - (d / r) * 0.7));
    const killed = squad.wound(guard.id, dmg, 'chest');
    if (killed) {
      match.drops += 1;
      ledger.payKill();
      readout.feedLine(`Grenade dropped guard ${guard.id + 1} — +$300`);
    }
  }
  const pp = hero.spot;
  const pd = Math.hypot(pp.x - g.spot.x, (pp.y + 1 - g.spot.y), pp.z - g.spot.z);
  if (pd <= r && striker.state.up) {
    const dmg = Math.round(FRAG.hurt * (1 - (pd / r) * 0.7));
    striker.wound(dmg);
    readout.flashHurt();
    sound.hurtThud();
  }
  paintHud();
}

function tick(dt) {
  match.clock += dt;
  // Round clock.
  const clockEvent = ledger.tick(dt);
  if (clockEvent === 'live') {
    readout.showShop(false);
    readout.showFlag('ROUND LIVE', `First to ${ROUNDS_TO_WIN} — plant the charge`, 2000);
  }
  // Striker movement + weapon timers.
  striker.tick(dt, controls.keys.down, match.clock);
  rack.tick(dt);
  // Grenades.
  for (let i = match.frags.length - 1; i >= 0; i -= 1) {
    const g = match.frags[i];
    g.tick(dt);
    if (g.blown) {
      burstFrag(g);
      match.frags.splice(i, 1);
    }
  }
  // Charge detonation timer.
  const chargeEvent = charge.tick(dt);
  if (chargeEvent === 'blown') {
    const s = charge.state.spot;
    if (s) effects.detonate(s);
    closeRound(true, 'charge detonated');
  }
  // Guards run only while the round is live: the shop phase is freeze time
  // (no sensing, no shooting, no moving), and the round-over wait is a
  // ceasefire. Without this the guards gun the striker down at spawn
  // before the round even starts.
  match.disarmer = null;
  if (ledger.books.stage === 'live') {
    // The ctx is a fresh object each frame; the disarmer reports itself by
    // setting ctx.disarmer, so read it back after the tick.
    const ctx = {
      now: match.clock,
      heroSpot: hero.spot,
      heroUp: striker.state.up,
      heroDucked: striker.state.ducked,
      heroPace: striker.paceNow(),
      charge,
      onGuardHit(guard, part) {
        if (!striker.state.up) return;
        const dmg = part === 'skull' ? 40 : 20;
        striker.wound(dmg);
        readout.flashHurt();
        sound.hurtThud();
        readout.feedLine(`Guard ${guard.id + 1} hit you${part === 'skull' ? ' (headshot)' : ''}`);
        paintHud();
      },
    };
    squad.tick(dt, ctx);
    match.disarmer = ctx.disarmer || null;
  }
  // The disarmer channels the disarm while it stands by the charge.
  if (match.disarmer && charge.isSet()) {
    if (charge.defuseTick(dt, true, true)) {
      closeRound(false, 'charge disarmed');
    }
  }
  // Rigging: hold E inside a yard, standing still.
  if (ledger.books.stage === 'live' && striker.state.up && (charge.state.stage === 'held' || charge.state.stage === 'rigging')) {
    const still = striker.paceNow() < 0.5;
    const inA = yard.insideSite(hero.spot, yard.yards.A);
    const inB = yard.insideSite(hero.spot, yard.yards.B);
    if (controls.keys.down.has('KeyE') && (inA || inB)) {
      const yardId = inA ? 'A' : 'B';
      charge.plantTick(dt, true, still, yardId, hero.spot);
      readout.showChannel(`RIGGING — ${yard.yards[yardId].name}`, charge.state.plantMade / PLANT_SPAN);
    } else if (charge.state.stage === 'rigging') {
      charge.state.stage = 'held';
      charge.state.plantMade = 0;
      readout.hideChannel();
    }
  } else if (charge.state.stage === 'rigging') {
    charge.state.stage = 'held';
    charge.state.plantMade = 0;
    readout.hideChannel();
  }
  if (charge.state.stage !== 'rigging') readout.hideChannel();
  if (charge.state.stage === 'set' || charge.state.stage === 'disarming') {
    readout.showFuse(charge.state.fuseLeft);
  }
  // The striker went down while the charge is set: the round plays on
  // without them. Show the down overlay once; Continue spectates.
  if (!striker.state.up && ledger.books.stage === 'live' && charge.isSet() && !match.downShown) {
    match.downShown = true;
    readout.openPanel('dead');
  }
  if (striker.state.up) match.downShown = false;
  // --- Round-end checks, every tick, however the round was decided. ---
  if (ledger.books.stage === 'live') {
    if (squad.standingCount() === 0) closeRound(true, 'yard cleared');
    else if (!striker.state.up && !charge.isSet()) closeRound(false, 'you are down');
    else if (clockEvent === 'time' && !charge.isSet()) closeRound(false, 'time expired');
  }
  // --- Round-over wait, then the next round or the match end. ---
  if (ledger.books.stage === 'over' && match.clock >= match.breakAt) {
    if (match.settled) {
      readout.openPanel('match', `${ledger.books.taken} — ${ledger.books.ceded}`);
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      openNextRound();
    }
  }
  effects.tick(dt);
  yard.tick(dt);
  paintHud();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - prevNow) / 1000, 0.1);
  prevNow = now;
  if (match.held) {
    view.render(stage, lens);
    return;
  }
  if (match.begun) {
    const look = controls.drainLook();
    striker.turn(look.x, look.y);
    striker.duck(controls.keys.down.has('ControlLeft') || controls.keys.down.has('KeyC'));
    striker.scope(controls.keys.scopeHeld && rack.inHandDef().hasScope);
    // Scope: DMR + right mouse zooms the view. The scope sits at 30
    // degrees — narrow enough to steady a long shot, wide enough to
    // keep the yard's edges in view while scoped.
    const wantZoom = controls.keys.scopeHeld && rack.inHandDef().hasScope && striker.state.up;
    if (wantZoom !== match.zoomed) {
      match.zoomed = wantZoom;
      readout.showLens(wantZoom);
    }
    lens.fov += ((wantZoom ? 30 : 74) - lens.fov) * Math.min(1, dt * 12);
    lens.updateProjectionMatrix();
    // Firing. Semi-auto guns fire on the press itself (consume the
    // MouseDown), not on the held state: in a slow renderer the button
    // is already up by the time a frame runs, and gating on `triggerHeld`
    // would swallow the shot.
    const mouseDown = controls.takeTap('MouseDown');
    if (ledger.books.stage === 'live' && striker.state.up) {
      const w = rack.inHandDef();
      if (w.fullAuto) {
        if (controls.keys.triggerHeld && rack.canFire()) fireShot();
        else if (mouseDown && rack.state.clip[rack.state.inHand] === 0) rack.clickEmpty();
      } else if (mouseDown) {
        fireShot();
      }
    }
    if (controls.takeTap('KeyR')) rack.beginReload();
    if (controls.takeTap('KeyG') && ledger.books.stage === 'live') hurlFrag();
    // Shop keys, live only in the shop phase.
    if (ledger.books.stage === 'shop') {
      for (const [code, id] of Object.entries(SHOP_KEYS)) {
        if (!controls.takeTap(code)) continue;
        if (id === 'plating') {
          if (ledger.pay(PLATING.cost)) {
            striker.state.plating = Math.min(100, striker.state.plating + PLATING.amount);
            readout.feedLine(`Plating fitted (+${PLATING.amount} armour)`);
          }
        } else {
          const cost = rack.purchase(id, ledger.books.funds);
          if (cost > 0) ledger.pay(cost);
        }
        paintHud();
      }
    }
    // Weapon select 1-4 outside the shop phase.
    if (ledger.books.stage !== 'shop') {
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
        if (controls.takeTap(code)) rack.swapTo(SHOP_KEYS[code]);
      }
    }
    controls.clearTaps();
    // Fixed-step simulation.
    bank += dt;
    let ticks = 0;
    while (bank >= TICK && ticks < 5) {
      tick(TICK);
      bank -= TICK;
      ticks += 1;
    }
    if (bank > TICK * 5) bank = 0;
    placeCamera();
    // Crosshair spread follows the current weapon cone.
    const spreadPx = 4 + rack.cone(striker.paceNow(), striker.state.ducked, match.zoomed) * 900;
    readout.spreadSight(Math.round(spreadPx));
  }
  view.render(stage, lens);
}

let bank = 0;
let prevNow = performance.now();

function onCapture(locked) {
  if (capture) return;
  if (locked) {
    readout.closePanel();
  } else if (match.begun && !match.settled && ledger.books.stage !== 'over') {
    readout.openPanel('paused');
  }
}

readout.onStart(() => {
  if (capture) return;
  sound.wake();
  if (match.settled) {
    openMatch();
    match.begun = true;
    readout.closePanel();
    controls.capturePointer();
    return;
  }
  if (!match.begun) {
    match.begun = true;
    openMatch();
  }
  readout.closePanel();
  controls.capturePointer();
});

function runTicks(steps) {
  for (let index = 0; index < steps; index += 1) tick(TICK);
}

function stageCapture(name) {
  readout.closePanel();
  readout.showShop(false);
  match.begun = true;
  if (name === 'start') {
    hero.heading = 0.35;
    hero.tilt = 0.02;
    runTicks(20);
    facePoint(new THREE.Vector3(0, 1.6, -8));
    readout.openPanel('start');
    renderTwice();
    return;
  }
  // play / end: jump straight into a live round.
  openMatch();
  ledger.openRound();
  readout.showShop(false);
  if (name === 'play') {
    striker.mover.teleport(0, 8);
    hero.heading = 0;
    hero.tilt = 0;
    runTicks(20);
    // Buy the Tempest AR, then fire at the nearest guard. The rifle costs
    // more than the $800 start, so grant the funds first (capture setup only).
    ledger.books.funds = 3000;
    ledger.pay(rack.purchase('tempest', ledger.books.funds));
    const guard = squad.guards.find((g) => g.up);
    if (guard) {
      const p = guard.mover.state.spot;
      facePoint(new THREE.Vector3(p.x, p.y + 1.3, p.z));
      for (let i = 0; i < 3; i += 1) {
        fireShot();
        runTicks(8);
      }
    }
    runTicks(12);
    readout.showVigor(striker.state.vigor, striker.state.plating);
    renderTwice();
    return;
  }
  // end: rig, detonate, show the win banner.
  striker.mover.teleport(16, -6);
  hero.heading = Math.PI * 0.75;
  runTicks(10);
  charge.state.stage = 'set';
  charge.state.yard = 'A';
  charge.state.spot = { x: 16, y: 0, z: -6 };
  charge.state.fuseLeft = 0.5;
  runTicks(40);
  renderTwice();
}

function renderTwice() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    placeCamera();
    view.render(stage, lens);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      match.held = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  lens.aspect = window.innerWidth / window.innerHeight;
  lens.updateProjectionMatrix();
  view.setSize(window.innerWidth, window.innerHeight);
});

// Test handle: the play-test drives the sim through this and reads state.
window.__harbor = {
  match,
  striker,
  squad,
  ledger,
  rack,
  charge,
  yard,
  readout,
  fastForward(seconds) {
    const ticks = Math.min(60 * 180, Math.round(seconds * 60));
    runTicks(ticks);
    placeCamera();
    view.render(stage, lens);
  },
  begin() {
    if (!match.begun) {
      match.begun = true;
      openMatch();
    }
  },
  jumpTo(x, z) {
    striker.mover.teleport(x, z);
    placeCamera();
  },
  faceGuard(i) {
    const guard = squad.guards[i];
    if (!guard) return false;
    const p = guard.mover.state.spot;
    facePoint(new THREE.Vector3(p.x, p.y + 1.3, p.z));
    return true;
  },
  setGuardAim(i, scale) {
    if (squad.guards[i]) squad.guards[i].aimError = scale;
  },
  fire: fireShot,
  // Debug probe: run the same ray the shot uses and report the first hit.
  traceShot() {
    lens.getWorldDirection(ray);
    stage.updateMatrixWorld(true);
    caster.set(lens.position, ray);
    const hits = caster.intersectObjects(targets, false);
    if (hits.length === 0) return { hits: 0 };
    const h = hits[0];
    return {
      hits: hits.length,
      dist: Number(h.distance.toFixed(3)),
      point: [Number(h.point.x.toFixed(2)), Number(h.point.y.toFixed(2)), Number(h.point.z.toFixed(2))],
      userData: h.object.userData || null,
    };
  },
  rigSite(yardId) {
    const yardDef = yard.yards[yardId];
    charge.state.stage = 'set';
    charge.state.yard = yardId;
    charge.state.spot = { x: yardDef.heart.x, y: 0, z: yardDef.heart.z };
    charge.state.fuseLeft = 35;
  },
};

placeCamera();
paintHud();
readout.greyPoor(800);
if (capture) stageCapture(capture);
else requestAnimationFrame(loop);
