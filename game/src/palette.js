// Harbor: TIDELOCK's night-harbour look in one place. Every material in
// the game takes its tint from here, so the scene reads as one place:
// deep night blue, wet asphalt, sodium-amber lamps against cold steel, and
// one cyan signal accent for the HUD, the charge and the site beacons.
export const HARBOR = {
  night: 0x070b12, // night sky and fog colour
  page: 0x0a0e15, // page background behind the canvas
  yard: 0x1b2027, // yard floor
  yardMark: 0x39424d, // painted yard markings
  wall: 0x2a313a, // walls, shed, crane legs
  deck: 0x46525f, // walkway deck, rails, container frames
  roof: 0x232a33, // container doors, roof panels
  sodium: 0xffb347, // sodium lamp glow
  beacon: 0x37d6e0, // cyan: HUD accent, charge light, site markers
  alarm: 0xe5484d, // red: damage flashes, round-loss banner, hazard paint
  paper: 0xe8ecef, // HUD text
  dim: 0x8b98a5, // secondary HUD text
  // Crate paint, one per stack, so the yard reads at a glance.
  crates: [0x8a3b2e, 0x2e6b6b, 0xa67c2e, 0x3a4a5e, 0x6b4a7a, 0x4a6b3a],
};

export const MIST = { close: 20, distant: 68 };
export const LAMPS = {
  moonTint: 0x8fa8c8, // cool directional moonlight
  moonGlow: 0.85,
  domeSky: 0x2a3a4d,
  domeFloor: 0x0c0e12,
  domeGlow: 0.7,
  lampGlow: 26, // point-light intensity (distance falloff on)
  lampReach: 26,
};
