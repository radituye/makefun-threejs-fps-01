// Striker: one mover plus the shooter's state — vigor, plating, look
// direction, recoil and movement. Movement has acceleration and drag
// so stopping to aim pays: a moving striker is slower to settle, and the
// weapon cone (weapons.js) reads ground pace straight from here.
import { makeMover } from './body.js';

const STROLL = 5.4;
const DUCK_PACE = 2.6;
const SCOPE_PACE = 3.4;
const THRUST = 42;
const DRAG = 10;

export function makeAttacker(yard, sound) {
  const mover = makeMover(yard.solids, yard.starts.striker.x, yard.starts.striker.z);
  const striker = {
    spot: mover.state.spot,
    heading: yard.starts.striker.heading,
    tilt: 0,
    vigor: 100,
    plating: 0,
    up: true,
    ducked: false,
    scoping: false,
    kickTilt: 0,
    kickTurn: 0,
    pace: 0, // horizontal speed, for spread and footsteps
    stride: 0, // distance accumulator for footstep sounds
    eyeHeight: mover.state.eyeHeight, // mirrors the mover's eye height (1.62, 1.05 ducked)
  };
  let velX = 0;
  let velZ = 0;

  return {
    state: striker,
    mover,
    turn(dx, dy) {
      // Mouse right is negative heading (three.js YXZ, facing -z at heading 0).
      striker.heading -= dx * 0.0021;
      striker.tilt -= dy * 0.0021;
      const limit = 1.52;
      if (striker.tilt > limit) striker.tilt = limit;
      if (striker.tilt < -limit) striker.tilt = -limit;
    },
    kick(tiltKick, turnKick) {
      striker.kickTilt += tiltKick;
      striker.kickTurn += turnKick;
      striker.tilt += tiltKick;
      striker.heading += turnKick;
    },
    tick(dt, down, now) {
      if (!striker.up) return;
      // Recoil settles back toward zero.
      striker.kickTilt *= Math.max(0, 1 - dt * 7);
      striker.kickTurn *= Math.max(0, 1 - dt * 7);
      // Wish direction from keys, rotated by heading.
      let fx = 0;
      let fz = 0;
      if (down.has('KeyW')) fz -= 1;
      if (down.has('KeyS')) fz += 1;
      if (down.has('KeyA')) fx -= 1;
      if (down.has('KeyD')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len;
      fz /= len;
      const sin = Math.sin(striker.heading);
      const cos = Math.cos(striker.heading);
      // Camera-space wish (fx right, fz back) into world space:
      // right = (cos, -sin), forward = (-sin, -cos), so
      // world = right*fx - forward*fz.
      const wx = fx * cos + fz * sin;
      const wz = -fx * sin + fz * cos;
      const target = striker.ducked ? DUCK_PACE : (striker.scoping ? SCOPE_PACE : STROLL);
      const moving = fx !== 0 || fz !== 0;
      if (moving) {
        velX += wx * THRUST * dt;
        velZ += wz * THRUST * dt;
        const speed = Math.hypot(velX, velZ);
        if (speed > target) {
          velX = (velX / speed) * target;
          velZ = (velZ / speed) * target;
        }
      } else {
        const damp = Math.max(0, 1 - DRAG * dt);
        velX *= damp;
        velZ *= damp;
        if (Math.hypot(velX, velZ) < 0.05) { velX = 0; velZ = 0; }
      }
      const moved = mover.move(velX * dt, velZ * dt, dt);
      striker.pace = Math.hypot(velX, velZ);
      if (moved && mover.state.onFloor && striker.pace > 1) {
        striker.stride += striker.pace * dt;
        if (striker.stride > 2.2) {
          striker.stride = 0;
          sound.footstep(now);
        }
      }
    },
    duck(on) {
      if (!striker.up) return;
      striker.ducked = on;
      mover.duck(on);
      striker.eyeHeight = mover.state.eyeHeight;
    },
    scope(on) {
      striker.scoping = on && striker.up;
    },
    // Wounds: plating soaks 60% of the hit, up to what it holds.
    wound(amount) {
      if (!striker.up) return 0;
      let remaining = amount;
      if (striker.plating > 0) {
        const soaked = Math.min(striker.plating, amount * 0.6);
        striker.plating -= soaked;
        remaining = amount - soaked;
      }
      striker.vigor -= remaining;
      if (striker.vigor <= 0) {
        striker.vigor = 0;
        striker.up = false;
      }
      return amount;
    },
    mend(amount) {
      striker.vigor = Math.min(100, striker.vigor + amount);
    },
    redeploy() {
      striker.vigor = 100;
      striker.plating = 0;
      striker.up = true;
      striker.heading = yard.starts.striker.heading;
      striker.tilt = 0;
      striker.kickTilt = 0;
      striker.kickTurn = 0;
      striker.ducked = false;
      mover.duck(false);
      striker.eyeHeight = mover.state.eyeHeight;
      velX = 0;
      velZ = 0;
      mover.teleport(yard.starts.striker.x, yard.starts.striker.z);
    },
    paceNow() {
      return striker.pace;
    },
  };
}
