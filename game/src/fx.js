// FX: tracers, muzzle flash, explosion and hit sparks. Everything is
// pooled and reused — no new objects in the hot loops — and every effect
// is driven from the same fixed-step state the sim writes, so a replay
// of the sim reproduces the same frames.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 40;

export function createFx(scene) {
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  const sparks = [];
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  let sparkNext = 0;

  // Muzzle flash: one light + one quad at the camera, shown briefly.
  const flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  scene.add(flashLight);
  const flashQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }),
  );
  scene.add(flashQuad);
  let flashLife = 0;

  // Explosion: an expanding emissive sphere + light, driven by life.
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0 }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff7a2a, 0, 30, 1.5);
  scene.add(boomLight);
  let boomLife = 0;

  function spawnTracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % MAX_TRACERS;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(to.x, to.y, to.z);
    t.mesh.visible = true;
    t.life = 0.07;
  }

  function spawnSparks(at, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const s = sparks[sparkNext];
      sparkNext = (sparkNext + 1) % MAX_SPARKS;
      s.mesh.position.set(at.x, at.y, at.z);
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      s.vx = Math.cos(a) * Math.cos(b) * speed;
      s.vy = Math.abs(Math.sin(b)) * speed + 1;
      s.vz = Math.sin(a) * Math.cos(b) * speed;
      s.mesh.visible = true;
      s.life = 0.35 + Math.random() * 0.25;
    }
  }

  return {
    tracer(from, to) {
      spawnTracer(from, to);
    },
    muzzle(at, camera) {
      flashLight.position.copy(at);
      flashLight.intensity = 14;
      flashLife = 0.05;
      flashQuad.position.copy(at);
      flashQuad.lookAt(camera.position);
      flashQuad.material.opacity = 0.85;
    },
    sparks(at, count = 8) {
      spawnSparks(at, count, 3.5);
    },
    explosion(at) {
      boom.position.set(at.x, at.y + 0.4, at.z);
      boom.visible = true;
      boom.scale.set(0.5, 0.5, 0.5);
      boom.material.opacity = 0.9;
      boomLight.position.set(at.x, at.y + 1, at.z);
      boomLight.intensity = 60;
      boomLife = 0.6;
      spawnSparks(at, 24, 7);
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.vy -= 9 * dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        if (s.mesh.position.y < 0.05) { s.mesh.position.y = 0.05; s.vy *= -0.4; }
        if (s.life <= 0) s.mesh.visible = false;
      }
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) {
          flashLight.intensity = 0;
          flashQuad.material.opacity = 0;
        }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const k = 1 - boomLife / 0.6;
        boom.scale.set(0.5 + k * 6, 0.5 + k * 6, 0.5 + k * 6);
        boom.material.opacity = Math.max(0, 0.9 * (1 - k));
        boomLight.intensity = Math.max(0, 60 * (1 - k));
        if (boomLife <= 0) boom.visible = false;
      }
    },
  };
}
