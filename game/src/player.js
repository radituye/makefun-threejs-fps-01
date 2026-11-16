// Player: one body plus the shooter's state — health, armour, look
// direction, recoil and movement. Movement has acceleration and friction
// so stopping to aim pays: a moving player is slower to settle, and the
// weapon spread (weapons.js) reads ground speed straight from here.
import { createBody } from './body.js';

const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const AIM_SPEED = 3.4;
const ACCEL = 42;
const FRICTION = 10;

export function createPlayer(world, audio) {
  const body = createBody(world.colliders, world.spawns.attacker.x, world.spawns.attacker.z);
  const state = {
    position: body.state.position,
    yaw: world.spawns.attacker.yaw,
    pitch: 0,
    health: 100,
    armor: 0,
    alive: true,
    crouched: false,
    aiming: false,
    recoilPitch: 0,
    recoilYaw: 0,
    moveSpeed: 0, // horizontal speed, for spread and footsteps
    stepped: 0, // distance accumulator for footstep sounds
    eye: body.state.eye, // mirrors the body's eye height (1.62, 1.05 crouched)
  };
  let vx = 0;
  let vz = 0;

  return {
    state,
    body,
    look(dx, dy) {
      // Mouse right is negative yaw (three.js YXZ, facing -z at yaw 0).
      state.yaw -= dx * 0.0021;
      state.pitch -= dy * 0.0021;
      const limit = 1.52;
      if (state.pitch > limit) state.pitch = limit;
      if (state.pitch < -limit) state.pitch = -limit;
    },
    recoil(pitchKick, yawKick) {
      state.recoilPitch += pitchKick;
      state.recoilYaw += yawKick;
      state.pitch += pitchKick;
      state.yaw += yawKick;
    },
    step(dt, keys, now) {
      if (!state.alive) return;
      // Recoil settles back toward zero.
      state.recoilPitch *= Math.max(0, 1 - dt * 7);
      state.recoilYaw *= Math.max(0, 1 - dt * 7);
      // Wish direction from keys, rotated by yaw.
      let fx = 0;
      let fz = 0;
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len;
      fz /= len;
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      // Camera-space wish (fx right, fz back) into world space:
      // right = (cos, -sin), forward = (-sin, -cos), so
      // world = right*fx - forward*fz.
      const wx = fx * cos + fz * sin;
      const wz = -fx * sin + fz * cos;
      const target = state.crouched ? CROUCH_SPEED : (state.aiming ? AIM_SPEED : WALK_SPEED);
      const moving = fx !== 0 || fz !== 0;
      if (moving) {
        vx += wx * ACCEL * dt;
        vz += wz * ACCEL * dt;
        const speed = Math.hypot(vx, vz);
        if (speed > target) {
          vx = (vx / speed) * target;
          vz = (vz / speed) * target;
        }
      } else {
        const damp = Math.max(0, 1 - FRICTION * dt);
        vx *= damp;
        vz *= damp;
        if (Math.hypot(vx, vz) < 0.05) { vx = 0; vz = 0; }
      }
      const moved = body.move(vx * dt, vz * dt, dt);
      state.moveSpeed = Math.hypot(vx, vz);
      if (moved && body.state.grounded && state.moveSpeed > 1) {
        state.stepped += state.moveSpeed * dt;
        if (state.stepped > 2.2) {
          state.stepped = 0;
          audio.step(now);
        }
      }
    },
    setCrouch(on) {
      if (!state.alive) return;
      state.crouched = on;
      body.setCrouch(on);
      state.eye = body.state.eye;
    },
    setAim(on) {
      state.aiming = on && state.alive;
    },
    // Damage: armour absorbs 60% of the hit, up to what it holds.
    damage(amount) {
      if (!state.alive) return 0;
      let remaining = amount;
      if (state.armor > 0) {
        const absorbed = Math.min(state.armor, amount * 0.6);
        state.armor -= absorbed;
        remaining = amount - absorbed;
      }
      state.health -= remaining;
      if (state.health <= 0) {
        state.health = 0;
        state.alive = false;
      }
      return amount;
    },
    heal(amount) {
      state.health = Math.min(100, state.health + amount);
    },
    respawn() {
      state.health = 100;
      state.armor = 0;
      state.alive = true;
      state.yaw = world.spawns.attacker.yaw;
      state.pitch = 0;
      state.recoilPitch = 0;
      state.recoilYaw = 0;
      state.crouched = false;
      body.setCrouch(false);
      state.eye = body.state.eye;
      vx = 0;
      vz = 0;
      body.teleport(world.spawns.attacker.x, world.spawns.attacker.z);
    },
    groundSpeed() {
      return state.moveSpeed;
    },
  };
}
