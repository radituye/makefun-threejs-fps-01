// Sound: every effect is synthesised with WebAudio, so the game makes no
// network request. One AudioContext, created on the first user gesture; all
// calls before that are no-ops. A quiet harbour hum (low oscillator plus
// filtered noise) starts with the first shot so the yard never sounds dead.
export function createAudio() {
  let ctx = null;
  let master = null;
  let humStarted = false;
  let lastStepAt = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function startHum() {
    if (humStarted || !ctx) return;
    humStarted = true;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 52;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    // Slow filtered-noise swell, like wind over the water.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.012;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();
  }

  function noiseBurst(duration, filterFreq, volume, type = 'lowpass') {
    if (!ensure()) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  function tone(freq, duration, volume, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
      startHum();
    },
    shot(kind) {
      if (!ensure()) return;
      startHum();
      if (kind === 'dmr') {
        noiseBurst(0.22, 900, 0.9);
        tone(140, 0.18, 0.5, 'sine', 55);
      } else if (kind === 'smg') {
        noiseBurst(0.09, 1800, 0.45);
        tone(220, 0.06, 0.25, 'square', 110);
      } else if (kind === 'pistol') {
        noiseBurst(0.12, 1400, 0.6);
        tone(180, 0.09, 0.35, 'sine', 70);
      } else {
        noiseBurst(0.14, 1200, 0.7);
        tone(160, 0.1, 0.4, 'sine', 60);
      }
    },
    enemyShot() {
      if (!ensure()) return;
      noiseBurst(0.1, 1000, 0.22);
    },
    dryClick() {
      if (!ensure()) return;
      tone(1400, 0.03, 0.15, 'square');
    },
    reload() {
      if (!ensure()) return;
      tone(900, 0.05, 0.2, 'square');
      setTimeout(() => tone(650, 0.05, 0.2, 'square'), 180);
    },
    hit(head) {
      if (!ensure()) return;
      tone(head ? 2400 : 1700, 0.05, 0.25, 'square');
    },
    kill() {
      if (!ensure()) return;
      tone(520, 0.08, 0.3, 'sine', 780);
      setTimeout(() => tone(780, 0.12, 0.3, 'sine', 1040), 90);
    },
    hurt() {
      if (!ensure()) return;
      tone(110, 0.16, 0.5, 'sawtooth', 60);
    },
    step(now) {
      if (!ensure()) return;
      if (now - lastStepAt < 0.34) return;
      lastStepAt = now;
      noiseBurst(0.05, 500, 0.08);
    },
    grenade() {
      if (!ensure()) return;
      tone(300, 0.1, 0.2, 'sine', 500);
    },
    explosion() {
      if (!ensure()) return;
      noiseBurst(0.7, 400, 1.0);
      tone(70, 0.6, 0.8, 'sine', 30);
    },
    beep(final) {
      if (!ensure()) return;
      tone(final ? 1560 : 1040, final ? 0.3 : 0.09, 0.3, 'sine');
    },
    plantDone() {
      if (!ensure()) return;
      tone(880, 0.12, 0.3, 'sine');
      setTimeout(() => tone(1320, 0.2, 0.3, 'sine'), 120);
    },
    roundWon() {
      if (!ensure()) return;
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.3, 'sine'), i * 110));
    },
    roundLost() {
      if (!ensure()) return;
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.3, 'sine'), i * 120));
    },
  };
}
