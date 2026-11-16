// Effects: tracers, muzzle flash, explosion and hit sparks. Everything is
// pooled and reused — no new objects in the hot loops — and every effect
// is driven from the same fixed-step state the sim writes, so a replay
// of the sim reproduces the same frames.
import * as THREE from 'three';
import { HARBOR } from './palette.js';

const TRACER_POOL = 24;
const SPARK_POOL = 40;

export function stageEffects(scene) {
  const streaks = [];
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const streakGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mesh = new THREE.Mesh(streakGeo, streakMat);
    mesh.visible = false;
    scene.add(mesh);
    streaks.push({ mesh, left: 0 });
  }
  let streakNext = 0;

  const embers = [];
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const emberGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const mesh = new THREE.Mesh(emberGeo, emberMat);
    mesh.visible = false;
    scene.add(mesh);
    embers.push({ mesh, left: 0, vx: 0, vy: 0, vz: 0 });
  }
  let emberNext = 0;

  // Muzzle flash: one light + one quad at the camera, shown briefly.
  const flashLamp = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  scene.add(flashLamp);
  const flashCard = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }),
  );
  scene.add(flashCard);
  let flashLeft = 0;

  // Explosion: an expanding emissive sphere + light, driven by life.
  const blastBall = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0 }),
  );
  blastBall.visible = false;
  scene.add(blastBall);
  const blastLamp = new THREE.PointLight(0xff7a2a, 0, 30, 1.5);
  scene.add(blastLamp);
  let blastLeft = 0;

  function launchTracer(from, to) {
    const t = streaks[streakNext];
    streakNext = (streakNext + 1) % TRACER_POOL;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(to.x, to.y, to.z);
    t.mesh.visible = true;
    t.left = 0.07;
  }

  function burstSparks(at, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const s = embers[emberNext];
      emberNext = (emberNext + 1) % SPARK_POOL;
      s.mesh.position.set(at.x, at.y, at.z);
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      s.vx = Math.cos(a) * Math.cos(b) * speed;
      s.vy = Math.abs(Math.sin(b)) * speed + 1;
      s.vz = Math.sin(a) * Math.cos(b) * speed;
      s.mesh.visible = true;
      s.left = 0.35 + Math.random() * 0.25;
    }
  }

  return {
    streak(from, to) {
      launchTracer(from, to);
    },
    flash(at, lens) {
      flashLamp.position.copy(at);
      flashLamp.intensity = 14;
      flashLeft = 0.05;
      flashCard.position.copy(at);
      flashCard.lookAt(lens.position);
      flashCard.material.opacity = 0.85;
    },
    shower(at, count = 8) {
      burstSparks(at, count, 3.5);
    },
    detonate(at) {
      blastBall.position.set(at.x, at.y + 0.4, at.z);
      blastBall.visible = true;
      blastBall.scale.set(0.5, 0.5, 0.5);
      blastBall.material.opacity = 0.9;
      blastLamp.position.set(at.x, at.y + 1, at.z);
      blastLamp.intensity = 60;
      blastLeft = 0.6;
      burstSparks(at, 24, 7);
    },
    tick(dt) {
      for (const t of streaks) {
        if (t.left <= 0) continue;
        t.left -= dt;
        if (t.left <= 0) t.mesh.visible = false;
      }
      for (const s of embers) {
        if (s.left <= 0) continue;
        s.left -= dt;
        s.vy -= 9 * dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        if (s.mesh.position.y < 0.05) { s.mesh.position.y = 0.05; s.vy *= -0.4; }
        if (s.left <= 0) s.mesh.visible = false;
      }
      if (flashLeft > 0) {
        flashLeft -= dt;
        if (flashLeft <= 0) {
          flashLamp.intensity = 0;
          flashCard.material.opacity = 0;
        }
      }
      if (blastLeft > 0) {
        blastLeft -= dt;
        const k = 1 - blastLeft / 0.6;
        blastBall.scale.set(0.5 + k * 6, 0.5 + k * 6, 0.5 + k * 6);
        blastBall.material.opacity = Math.max(0, 0.9 * (1 - k));
        blastLamp.intensity = Math.max(0, 60 * (1 - k));
        if (blastLeft <= 0) blastBall.visible = false;
      }
    },
  };
}
