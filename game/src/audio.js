// Sound: every effect is synthesised with WebAudio, so the game makes no
// network request. One AudioContext, created on the first user gesture; all
// calls before that are no-ops. A quiet harbour drone (low oscillator plus
// filtered noise) starts with the first shot so the yard never sounds dead.
export function buildSoundboard() {
  let engine = null;
  let bus = null;
  let droneOn = false;
  let lastTreadAt = 0;

  function boot() {
    if (engine) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      engine = new AC();
      bus = engine.createGain();
      bus.gain.value = 0.5;
      bus.connect(engine.destination);
    } catch {
      return false;
    }
    return true;
  }

  function beginDrone() {
    if (droneOn || !engine) return;
    droneOn = true;
    const osc = engine.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 52;
    const gain = engine.createGain();
    gain.gain.value = 0.035;
    osc.connect(gain);
    gain.connect(bus);
    osc.start();
    // Slow filtered-noise swell, like wind over the water.
    const len = engine.sampleRate * 2;
    const buffer = engine.createBuffer(1, len, engine.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = engine.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = engine.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const noiseGain = engine.createGain();
    noiseGain.gain.value = 0.012;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start();
  }

  function hiss(span, filterFreq, volume, type = 'lowpass') {
    if (!boot()) return;
    const len = Math.max(1, Math.floor(engine.sampleRate * span));
    const buffer = engine.createBuffer(1, len, engine.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = engine.createBufferSource();
    src.buffer = buffer;
    const filter = engine.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = engine.createGain();
    gain.gain.value = volume;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    src.start();
  }

  function chime(freq, span, volume, type = 'sine', glideTo = null) {
    if (!boot()) return;
    const osc = engine.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, engine.currentTime);
    if (glideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), engine.currentTime + span);
    const gain = engine.createGain();
    gain.gain.setValueAtTime(volume, engine.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, engine.currentTime + span);
    osc.connect(gain);
    gain.connect(bus);
    osc.start();
    osc.stop(engine.currentTime + span + 0.02);
  }

  return {
    wake() {
      if (boot() && engine.state === 'suspended') engine.resume();
      beginDrone();
    },
    gunshot(family) {
      if (!boot()) return;
      beginDrone();
      if (family === 'dmr') {
        hiss(0.22, 900, 0.9);
        chime(140, 0.18, 0.5, 'sine', 55);
      } else if (family === 'smg') {
        hiss(0.09, 1800, 0.45);
        chime(220, 0.06, 0.25, 'square', 110);
      } else if (family === 'pistol') {
        hiss(0.12, 1400, 0.6);
        chime(180, 0.09, 0.35, 'sine', 70);
      } else {
        hiss(0.14, 1200, 0.7);
        chime(160, 0.1, 0.4, 'sine', 60);
      }
    },
    distantShot() {
      if (!boot()) return;
      hiss(0.1, 1000, 0.22);
    },
    emptyClick() {
      if (!boot()) return;
      chime(1400, 0.03, 0.15, 'square');
    },
    reloadClicks() {
      if (!boot()) return;
      chime(900, 0.05, 0.2, 'square');
      setTimeout(() => chime(650, 0.05, 0.2, 'square'), 180);
    },
    hitPing(head) {
      if (!boot()) return;
      chime(head ? 2400 : 1700, 0.05, 0.25, 'square');
    },
    killChime() {
      if (!boot()) return;
      chime(520, 0.08, 0.3, 'sine', 780);
      setTimeout(() => chime(780, 0.12, 0.3, 'sine', 1040), 90);
    },
    hurtThud() {
      if (!boot()) return;
      chime(110, 0.16, 0.5, 'sawtooth', 60);
    },
    footstep(now) {
      if (!boot()) return;
      if (now - lastTreadAt < 0.34) return;
      lastTreadAt = now;
      hiss(0.05, 500, 0.08);
    },
    pinPull() {
      if (!boot()) return;
      chime(300, 0.1, 0.2, 'sine', 500);
    },
    blast() {
      if (!boot()) return;
      hiss(0.7, 400, 1.0);
      chime(70, 0.6, 0.8, 'sine', 30);
    },
    chirp(final) {
      if (!boot()) return;
      chime(final ? 1560 : 1040, final ? 0.3 : 0.09, 0.3, 'sine');
    },
    plantChime() {
      if (!boot()) return;
      chime(880, 0.12, 0.3, 'sine');
      setTimeout(() => chime(1320, 0.2, 0.3, 'sine'), 120);
    },
    winFanfare() {
      if (!boot()) return;
      [523, 659, 784].forEach((f, i) => setTimeout(() => chime(f, 0.16, 0.3, 'sine'), i * 110));
    },
    loseDirge() {
      if (!boot()) return;
      [392, 330, 262].forEach((f, i) => setTimeout(() => chime(f, 0.18, 0.3, 'sine'), i * 120));
    },
  };
}
