// Input: keyboard state plus mouse look through pointer lock. The game
// reads `state` once per rendered frame and `takeLook()` drains the
// accumulated mouse delta; buy keys and single-press actions are consumed
// by main.js on the next frame so a slow renderer never eats a keypress.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    aiming: false,
    locked: false,
    lookX: 0,
    lookY: 0,
    pressed: new Set(), // codes pressed since the last consume
  };

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    state.pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseDown(event) {
    if (event.button === 0) {
      state.firing = true;
      state.pressed.add('MouseDown');
    }
    if (event.button === 2) state.aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }
  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    onLockChange(state.locked);
  }
  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    requestLock() {
      try {
        canvas.requestPointerLock();
      } catch {
        // Headless or denied: the game still runs; look stays at rest.
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    // Returns true once per press; the caller drains it every frame.
    consume(code) {
      if (state.pressed.has(code)) {
        state.pressed.delete(code);
        return true;
      }
      return false;
    },
    drainPressed() {
      state.pressed.clear();
    },
  };
}
