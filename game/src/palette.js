// Palette: TIDELOCK's night-harbour look in one place. Every material in
// the game takes its colour from here, so the scene reads as one place:
// deep night blue, wet asphalt, sodium-amber lamps against cold steel, and
// one cyan signal accent for the HUD, the spike and the site beacons.
export const PALETTE = {
  sky: 0x070b12, // night sky and fog colour
  canvas: 0x0a0e15, // page background behind the canvas
  asphalt: 0x1b2027, // yard floor
  asphaltLine: 0x39424d, // painted yard markings
  concrete: 0x2a313a, // walls, shed, crane legs
  steel: 0x46525f, // walkway deck, rails, container frames
  darkSteel: 0x232a33, // container doors, roof panels
  lamp: 0xffb347, // sodium lamp glow
  signal: 0x37d6e0, // cyan: HUD accent, spike light, site markers
  danger: 0xe5484d, // red: damage flashes, round-loss banner, hazard paint
  ink: 0xe8ecef, // HUD text
  muted: 0x8b98a5, // secondary HUD text
  // Container paint, one per stack, so the yard reads at a glance.
  containers: [0x8a3b2e, 0x2e6b6b, 0xa67c2e, 0x3a4a5e, 0x6b4a7a, 0x4a6b3a],
};

export const FOG = { near: 20, far: 68 };
export const LIGHT = {
  moon: 0x8fa8c8, // cool directional moonlight
  moonIntensity: 0.85,
  hemiSky: 0x2a3a4d,
  hemiGround: 0x0c0e12,
  hemiIntensity: 0.7,
  lampIntensity: 26, // point-light intensity (distance falloff on)
  lampDistance: 26,
};
