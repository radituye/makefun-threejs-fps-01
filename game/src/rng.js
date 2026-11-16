// Chance: one seeded stream feeds the whole match, so a capture seed
// replays the same guard patrol choices and the same crate paint order.
// Mulberry32 — tiny, fast, and good enough for a game that never needs
// cryptographic randomness.
export function seededStream(grain) {
  let state = grain | 0;
  return function draw() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw one member of a list with the seeded stream.
export function chooseOne(draw, list) {
  return list[Math.floor(draw() * list.length)];
}

// A value in [low, high).
export function spanBetween(draw, low, high) {
  return low + draw() * (high - low);
}
