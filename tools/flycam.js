// flycam.js — WASD + QE fly movement layered on top of OrbitControls.
//
// Orbit alone is painful in an interior: you can only circle a fixed point, so
// getting behind a wall or up to a beam means dollying out, re-targeting, and
// dollying back. This adds the fly half without replacing orbit — drag still
// orbits, wheel still dollies.
//
// The trick is that every move translates the camera AND controls.target by the
// same vector. OrbitControls derives its spherical from (position - target), so
// keeping that offset constant means it never fights the movement or snaps back,
// and you carry on orbiting around whatever you flew to.
//
//   W / S   forward / back along the camera's true view axis (pitch included)
//   A / D   strafe left / right
//   Q / E   down / up along WORLD up, never the camera's — otherwise "up" tilts
//           with the look direction and you drift off the level you're inspecting
//   Shift   x4     Alt  x0.25

import * as THREE from 'three';

const DEFAULTS = {
  speed: 6,        // m/s. The building is ~35 x 31 x 14 m, so this crosses it in ~6 s.
  fastMul: 4,
  slowMul: 0.25,
  maxStep: 0.1,    // clamp dt: after a tab-switch the first frame can be seconds long
};

// Positional codes, not e.key — 'KeyW' is the same physical key on AZERTY/QWERTZ,
// where e.key would be 'z' and the controls would be nonsense.
const AXES = {
  KeyW: ['fwd',   1], KeyS: ['fwd',  -1],
  KeyD: ['right', 1], KeyA: ['right',-1],
  KeyE: ['up',    1], KeyQ: ['up',  -1],
};

const isTyping = (el) =>
  !!el && (el.isContentEditable ||
           /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));

export function createFlyCam({ camera, controls, opts = {} } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const held = new Set();
  let enabled = true;

  const fwd   = new THREE.Vector3();
  const right = new THREE.Vector3();
  const step  = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  const onKeyDown = (e) => {
    // Ctrl/Cmd combos belong to the browser and to the feedback panel's undo.
    if (e.ctrlKey || e.metaKey) return;
    if (isTyping(e.target)) return;          // writing a review note, not flying
    if (!AXES[e.code]) return;
    held.add(e.code);
    e.preventDefault();                      // only for keys we actually consume
  };
  const onKeyUp = (e) => { held.delete(e.code); };
  // Keys stick down if the window loses focus mid-press — you alt-tab back and
  // the camera is drifting with nothing held.
  const release = () => held.clear();

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', release);
  document.addEventListener('visibilitychange', release);

  function update(dt) {
    if (!enabled || !held.size || !camera) return false;
    dt = Math.min(dt || 0, cfg.maxStep);
    if (dt <= 0) return false;

    let f = 0, r = 0, u = 0;
    for (const code of held) {
      const [axis, sign] = AXES[code];
      if (axis === 'fwd') f += sign; else if (axis === 'right') r += sign; else u += sign;
    }
    if (!f && !r && !u) return false;

    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, WORLD_UP).normalize();

    step.set(0, 0, 0)
        .addScaledVector(fwd, f)
        .addScaledVector(right, r)
        .addScaledVector(WORLD_UP, u);
    if (step.lengthSq() === 0) return false;
    // Normalise so diagonals aren't ~1.7x faster than a straight line.
    step.normalize().multiplyScalar(speedNow() * dt);

    camera.position.add(step);
    if (controls) controls.target.add(step);   // constant offset => orbit stays sane
    return true;
  }

  const mods = { shift: false, alt: false };
  addEventListener('keydown', (e) => { mods.shift = e.shiftKey; mods.alt = e.altKey; });
  addEventListener('keyup',   (e) => { mods.shift = e.shiftKey; mods.alt = e.altKey; });
  function speedNow() {
    let s = cfg.speed;
    if (mods.shift) s *= cfg.fastMul;
    if (mods.alt)   s *= cfg.slowMul;
    return s;
  }

  return {
    update,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (!v) held.clear(); },
    get speed() { return cfg.speed; },
    set speed(v) { cfg.speed = Math.max(0.01, +v || 0); },
    get held() { return [...held]; },
    hint: 'WASD move · QE down/up · Shift fast · Alt slow',
    dispose() {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
      held.clear();
    },
  };
}
