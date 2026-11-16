// World: the TIDELOCK freight terminal. A 46 x 36 m night yard at a
// container port: water to the south, a raised walkway along the north
// edge, site A (Crane Bay) under a gantry crane in the east, site B
// (Warehouse) inside a roofed shed in the west, and container stacks
// shaping three lanes between them. Every solid thing is one entry in
// `colliders`; the meshes are built from the same list, so what you see
// is what blocks you. The waypoint graph is computed from the colliders,
// so a node can never sit inside a box.
import * as THREE from 'three';
import { PALETTE, FOG, LIGHT } from './palette.js';
import { segmentHitsBox } from './body.js';

const BOUNDS = { minX: -23, maxX: 23, minZ: -18, maxZ: 18 };

// Box helper: {x, z, w, d, y0, y1, kind} -> collider + mesh spec.
function box(x, z, w, d, y0, y1, kind) {
  return {
    minX: x - w / 2, maxX: x + w / 2,
    minY: y0, maxY: y1,
    minZ: z - d / 2, maxZ: z + d / 2,
    kind,
  };
}

export function createWorld(scene, random) {
  const colliders = [];
  const meshes = [];
  const shootables = [];
  const lamps = [];

  // ---- Perimeter: north wall, west wall, east wall, south fence ----
  colliders.push(box(0, -18.4, 48, 1, 0, 3.2, 'wall'));
  colliders.push(box(-23.4, 0, 1, 38, 0, 3.2, 'wall'));
  colliders.push(box(23.4, 0, 1, 38, 0, 3.2, 'wall'));
  colliders.push(box(0, 14.4, 48, 0.6, 0, 1.4, 'wall')); // fence above the quay

  // ---- North walkway deck (y 0.9) with step ramps at x = -10 and x = 10 ----
  colliders.push(box(0, -16.75, 28, 2.5, 0, 0.9, 'deck'));
  for (const rx of [-10, 10]) {
    colliders.push(box(rx, -14.6, 2.4, 0.8, 0, 0.3, 'step'));
    colliders.push(box(rx, -15.2, 2.4, 0.8, 0, 0.6, 'step'));
  }

  // ---- Site A: Crane Bay (east). Gantry crane legs + beam, containers. ----
  colliders.push(box(15.5, -9, 1.2, 6, 0, 7.5, 'crane'));
  colliders.push(box(21, -9, 1.2, 6, 0, 7.5, 'crane'));
  colliders.push(box(18.25, -9, 7, 1.2, 6.8, 7.6, 'crane')); // top beam
  colliders.push(box(18, -13, 6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(19, -6, 4, 2.6, 0, 2.6, 'container')); // south stack, leaves a 3 m entry gap at x 14..17
  colliders.push(box(21, -13, 2.6, 2.6, 0, 5.2, 'container')); // stacked pair

  // ---- Site B: Warehouse (west). Shed walls with two door gaps, roof. ----
  colliders.push(box(-22.5, -9, 1, 10, 0, 4.5, 'shed')); // west wall
  colliders.push(box(-18, -14.2, 9, 1, 0, 4.5, 'shed')); // north wall
  colliders.push(box(-21, -3.8, 3, 1, 0, 4.5, 'shed')); // south wall, west half
  colliders.push(box(-15.5, -3.8, 2, 1, 0, 4.5, 'shed')); // south wall, east half
  colliders.push(box(-14.2, -12, 1, 4, 0, 4.5, 'shed')); // east wall, north half
  colliders.push(box(-14.2, -6, 1, 4, 0, 4.5, 'shed')); // east wall, south half
  colliders.push(box(-18, -9, 9, 10, 4.5, 4.9, 'roof')); // roof slab
  colliders.push(box(-20, -11, 2.6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(-16.5, -6, 2.6, 2.6, 0, 2.6, 'container'));

  // ---- Mid container stacks: three lanes (west / centre / east). ----
  colliders.push(box(-8, 2, 6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(8, 2, 6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(-8, -8, 6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(8, -8, 6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(-12, 8, 6, 2.6, 0, 5.2, 'container')); // stacked
  colliders.push(box(12, 8, 6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(-16, 6, 2.6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(16, 6, 2.6, 2.6, 0, 2.6, 'container'));
  colliders.push(box(0, -4, 2.6, 2.6, 0, 2.6, 'container')); // mid plug
  colliders.push(box(-4, 11, 2.6, 2.6, 0, 1.2, 'crate'));
  colliders.push(box(5, 12, 2.6, 2.6, 0, 1.2, 'crate'));
  colliders.push(box(-13, -2, 1.2, 1.2, 0, 1.2, 'crate'));
  colliders.push(box(13, -2, 1.2, 1.2, 0, 1.2, 'crate'));
  colliders.push(box(0, 8, 2.6, 2.6, 0, 2.6, 'container')); // mid plug: blocks the central sightline to spawn

  // ---- Waypoints: every node is placed in open floor and checked below. ----
  const nodeDefs = [
    [0, 12.5], // 0 attacker spawn
    [0, 10], // 1 south mid
    [-6, 6], // 2 west mid low
    [6, 6], // 3 east mid low
    [0, 0], // 4 centre
    [-6, -3], // 5 west mid high
    [6, -3], // 6 east mid high
    [-12, -6], // 7 west lane
    [12, -6], // 8 east lane
    [-18, -9], // 9 site B centre
    [18, -9], // 10 site A centre
    [-18, -12], // 11 site B north
    [18, -10.5], // 12 site A north
    [-19.5, -6], // 13 site B south
    [16, -5], // 14 site A south
    [0, -12], // 15 north mid
    [-12, -12], // 16 north-west
    [12, -12], // 17 north-east
    [-6, -13], // 18 walkway west approach
    [6, -13], // 19 walkway east approach
    [-12, -16.5], // 20 walkway west
    [0, -16.5], // 21 walkway centre
    [12, -16.5], // 22 walkway east
    [-10, -13.5], // 23 west ramp foot
    [10, -13.5], // 24 east ramp foot
    [0, -13], // 25 defender spawn
    [-2, 13], // 26 south-west approach
    [2, 13], // 27 south-east approach
    [-12, -9], // 28 east door approach (site B)
    [-18, -1], // 29 south door approach (site B)
  ];
  const nodes = nodeDefs.map(([x, z], id) => ({ id, x, z }));
  // A node must be free: the body's standing space above the highest
  // walkable surface under the node (up to 1.2 m, reachable by the ramps)
  // must hold no collider. A node ON the walkway deck is fine — the deck
  // is the surface it stands on, not an obstacle inside it.
  for (const n of nodes) {
    let surface = 0;
    for (const c of colliders) {
      const overlap = n.x + 0.5 > c.minX && n.x - 0.5 < c.maxX && n.z + 0.5 > c.minZ && n.z - 0.5 < c.maxZ;
      if (overlap && c.maxY <= 1.2 && c.maxY > surface) surface = c.maxY;
    }
    for (const c of colliders) {
      const overlap = n.x + 0.5 > c.minX && n.x - 0.5 < c.maxX && n.z + 0.5 > c.minZ && n.z - 0.5 < c.maxZ;
      if (!overlap) continue;
      if (c.maxY <= surface + 0.05) continue; // the surface itself
      if (c.minY >= surface + 1.78) continue; // above the head
      throw new Error(`waypoint ${n.id} (${n.x}, ${n.z}) sits inside a ${c.kind} collider`);
    }
  }
  // Levels: 1 = on the walkway deck, 0 = yard floor. Edges only join
  // nodes of the same level, except the two ramp pairs (23 <-> 20 and
  // 24 <-> 22), so no path ever asks a body to walk straight up the
  // deck's side instead of up its ramp.
  const nodeLevel = new Map();
  for (const n of nodes) nodeLevel.set(n.id, (n.z < -15 && Math.abs(n.x) <= 14) ? 1 : 0);
  const rampLinks = new Set(['23-20', '20-23', '24-22', '22-24']);
  // Edges: pairs within 14 m with a clear sightline at 1.2 m height.
  const edges = new Map();
  function edgeBlocked(a, b) {
    if (nodeLevel.get(a.id) !== nodeLevel.get(b.id) && !rampLinks.has(`${a.id}-${b.id}`)) return true;
    for (const c of colliders) {
      if (c.maxY <= 1.0) continue;
      if (segmentHitsBox(a.x, 1.2, a.z, b.x, 1.2, b.z, c) >= 0) return true;
    }
    return false;
  }
  for (const a of nodes) {
    const list = [];
    for (const b of nodes) {
      if (a.id === b.id) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 14) continue;
      if (edgeBlocked(a, b)) continue;
      list.push({ to: b.id, dist: d });
    }
    edges.set(a.id, list);
  }

  function nearestNode(x, z) {
    let best = nodes[0];
    let bestD = Infinity;
    for (const n of nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // BFS over the graph. Returns an array of node ids from `from` to `to`.
  function findPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const prev = new Map([[fromId, -1]]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const e of edges.get(cur) || []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, cur);
        if (e.to === toId) {
          const path = [toId];
          let at = toId;
          while (prev.get(at) !== -1) { at = prev.get(at); path.unshift(at); }
          return path;
        }
        queue.push(e.to);
      }
    }
    return [fromId];
  }

  const sites = {
    A: { id: 'A', name: 'Crane Bay', center: { x: 18, z: -9 }, rect: { minX: 14, maxX: 22, minZ: -14, maxZ: -4 } },
    B: { id: 'B', name: 'Warehouse', center: { x: -18, z: -9 }, rect: { minX: -22, maxX: -14, minZ: -14, maxZ: -4 } },
  };
  const spawns = {
    attacker: { x: 0, z: 12.5, yaw: 0 },
    defenders: [
      { x: -4, z: -13 }, { x: -2, z: -12 }, { x: 0, z: -13 }, { x: 2, z: -12 }, { x: 4, z: -13 },
    ],
  };

  // ---- Rendering ---------------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map();
  function materialFor(color) {
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.25 }));
    }
    return materials.get(color);
  }
  const kindColor = {
    wall: PALETTE.concrete, container: 0x8a3b2e, deck: PALETTE.steel,
    step: PALETTE.steel, crate: 0x6b5a3a, crane: 0x4a3a2e, shed: PALETTE.concrete,
    roof: PALETTE.darkSteel,
  };
  let containerIndex = 0;
  for (const c of colliders) {
    const w = c.maxX - c.minX;
    const h = c.maxY - c.minY;
    const d = c.maxZ - c.minZ;
    let color = kindColor[c.kind] ?? PALETTE.concrete;
    if (c.kind === 'container') {
      color = PALETTE.containers[containerIndex % PALETTE.containers.length];
      containerIndex += 1;
    }
    const mesh = new THREE.Mesh(boxGeo, materialFor(color));
    mesh.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
    mesh.scale.set(w, h, d);
    mesh.castShadow = h > 1.5;
    mesh.receiveShadow = true;
    mesh.userData.collider = c;
    scene.add(mesh);
    meshes.push(mesh);
    if (c.kind === 'container' || c.kind === 'wall' || c.kind === 'shed' || c.kind === 'crate') {
      shootables.push(mesh);
    }
  }

  // Yard floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 38),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.95, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  floor.receiveShadow = true;
  scene.add(floor);
  meshes.push(floor);

  // Painted lane lines on the floor (thin dark-light strips).
  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.asphaltLine });
  for (const [x, z, w, d] of [[0, 0, 0.18, 30], [-8, 0, 0.18, 26], [8, 0, 0.18, 26], [0, 12, 24, 0.18]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.01, z);
    scene.add(line);
    meshes.push(line);
  }

  // Water south of the quay: a dark plane with a slow shimmer.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 6),
    new THREE.MeshStandardMaterial({ color: 0x0d1b26, roughness: 0.25, metalness: 0.7 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, 17);
  scene.add(water);
  meshes.push(water);

  // Site marker lights: cyan beacons over each site.
  for (const site of Object.values(sites)) {
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: PALETTE.signal, emissive: PALETTE.signal, emissiveIntensity: 2.2 }),
    );
    beacon.position.set(site.center.x, 5.4, site.center.z);
    scene.add(beacon);
    meshes.push(beacon);
  }

  // Lamp posts with sodium glow (visual + real point lights).
  const lampPositions = [[-16, -8], [16, -8], [-8, 8], [8, 8], [0, -13]];
  for (const [x, z] of lampPositions) {
    const pole = new THREE.Mesh(boxGeo, materialFor(PALETTE.darkSteel));
    pole.position.set(x, 2.4, z);
    pole.scale.set(0.18, 4.8, 0.18);
    scene.add(pole);
    meshes.push(pole);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: PALETTE.lamp, emissive: PALETTE.lamp, emissiveIntensity: 3 }),
    );
    head.position.set(x, 4.9, z);
    scene.add(head);
    meshes.push(head);
    const light = new THREE.PointLight(PALETTE.lamp, LIGHT.lampIntensity, LIGHT.lampDistance, 1.6);
    light.position.set(x, 4.7, z);
    scene.add(light);
    lamps.push(light);
  }

  // Moon: a pale disc low over the water + directional moonlight.
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe8f2, fog: false }),
  );
  moon.position.set(-14, 16, -60);
  moon.lookAt(0, 2, 0);
  scene.add(moon);
  meshes.push(moon);
  const moonLight = new THREE.DirectionalLight(LIGHT.moon, LIGHT.moonIntensity);
  moonLight.position.set(-12, 22, 8);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1024, 1024);
  moonLight.shadow.camera.left = -30;
  moonLight.shadow.camera.right = 30;
  moonLight.shadow.camera.top = 30;
  moonLight.shadow.camera.bottom = -30;
  scene.add(moonLight);
  scene.add(new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity));

  let time = 0;
  return {
    colliders,
    nodes,
    edges,
    sites,
    spawns,
    shootables,
    meshes,
    nearestNode,
    findPath,
    inSite(point, site) {
      const r = site.rect;
      return point.x >= r.minX && point.x <= r.maxX && point.z >= r.minZ && point.z <= r.maxZ;
    },
    setLowFx(on) {
      moonLight.castShadow = !on;
      for (const m of meshes) m.castShadow = false;
      for (const l of lamps) l.intensity = on ? LIGHT.lampIntensity * 0.6 : LIGHT.lampIntensity;
    },
    update(dt) {
      time += dt;
      // Water shimmer: a slow breathing of the specular look.
      water.material.metalness = 0.55 + Math.sin(time * 0.7) * 0.15;
    },
  };
}
