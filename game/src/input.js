// Controls: keyboard state plus mouse look through pointer lock. The game
// reads `keys` once per rendered frame and `drainLook()` empties the
// accumulated mouse delta; shop keys and single-press actions are consumed
// by main.js on the next frame so a slow renderer never eats a keypress.
export function wireControls(canvas, onCaptureChange) {
  const keys = {
    down: new Set(),
    triggerHeld: false,
    scopeHeld: false,
    captured: false,
    yawAccum: 0,
    pitchAccum: 0,
    tapped: new Set(), // codes pressed since the last consume
  };

  function pressKey(event) {
    if (event.repeat) return;
    keys.down.add(event.code);
    keys.tapped.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function releaseKey(event) {
    keys.down.delete(event.code);
  }
  function pressMouse(event) {
    if (event.button === 0) {
      keys.triggerHeld = true;
      keys.tapped.add('MouseDown');
    }
    if (event.button === 2) keys.scopeHeld = true;
  }
  function releaseMouse(event) {
    if (event.button === 0) keys.triggerHeld = false;
    if (event.button === 2) keys.scopeHeld = false;
  }
  function moveMouse(event) {
    if (!keys.captured) return;
    keys.yawAccum += event.movementX;
    keys.pitchAccum += event.movementY;
  }
  function lockFlip() {
    keys.captured = document.pointerLockElement === canvas;
    onCaptureChange(keys.captured);
  }
  function blockMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', pressKey);
  window.addEventListener('keyup', releaseKey);
  canvas.addEventListener('mousedown', pressMouse);
  window.addEventListener('mouseup', releaseMouse);
  document.addEventListener('mousemove', moveMouse);
  document.addEventListener('pointerlockchange', lockFlip);
  canvas.addEventListener('contextmenu', blockMenu);

  return {
    keys,
    capturePointer() {
      try {
        canvas.requestPointerLock();
      } catch {
        // Headless or denied: the game still runs; look stays at rest.
      }
    },
    releasePointer() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    drainLook() {
      const look = { x: keys.yawAccum, y: keys.pitchAccum };
      keys.yawAccum = 0;
      keys.pitchAccum = 0;
      return look;
    },
    // Returns true once per press; the caller drains it every frame.
    takeTap(code) {
      if (keys.tapped.has(code)) {
        keys.tapped.delete(code);
        return true;
      }
      return false;
    },
    clearTaps() {
      keys.tapped.clear();
    },
  };
}
