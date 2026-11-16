// Seeded RNG: mulberry32. The whole game takes its randomness from one
// instance per session, so a screenshot seed reproduces the same bot
// patrol picks and the same container paint order.
export function mulberry32(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick one element of an array with the seeded RNG.
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

// A value in [min, max).
export function range(random, min, max) {
  return min + random() * (max - min);
}
