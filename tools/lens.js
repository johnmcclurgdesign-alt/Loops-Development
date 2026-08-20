// Camera formats as a system: focal length in real millimetres, plus the lens
// character (distortion, fringe, vignette, grain, letterbox) as ONE shader pass.
//
// WHY ONE PASS. Each of these effects is a few instructions on a fragment that is
// already in hand; five separate passes would pay the bandwidth of the full frame
// five times to do the same work. The pass runs inside the composer on LINEAR HDR
// (before ACES in OutputPass), which is what keeps the vignette from crushing and
// lets grain roll off filmically instead of speckling the highlights.
//
// FOCAL LENGTH IS THE DIAL, NOT FOV. 2*atan(18/f) on a 36 mm full-frame width —
// the numbers photographers already know: 16 ultra-wide, 24 wide, 35 normal-wide,
// 50 normal, 85 portrait. The scene keeps HORIZONTAL fov constant across canvas
// shapes (same convention as the Blender camera import).
//
// ★ THE LETTERBOX IS DRAWN IN THE SHADER, NOT AS DOM BARS. The feedback panel's
// screenshots capture the canvas; DOM bars would vanish from every note and the
// framing the reviewer saw would not be the framing on file.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function focalToHFov(mm) {
  return 2 * Math.atan(18 / mm); // radians, 36 mm full-frame width
}

// Format presets. `focal` in mm; `ratio` is a letterbox aspect (0 = none, i.e.
// use the whole canvas); the rest are LensPass/FlarePass uniforms.
export const FORMATS = [
  { id: 'native',  label: 'Native (Blender cam)', focal: null, ratio: 0,
    distort: 0, fringe: 0, vignette: 0, grain: 0, flare: 0, streak: 0 },
  // wide24 is the DEFAULT lens, so its character is nearly subliminal since
  // 2026-08-19: at the brighter warehouse grade, 0.02 distortion + 0.0012
  // fringe doubled every high-contrast edge into red/cyan dashes — reported as
  // "marching ants everywhere", and the distortion resample softened the whole
  // frame besides. The stylised formats below keep their heavy character;
  // choosing them is opting in.
  { id: 'wide24',  label: 'Wide 24mm', focal: 24, ratio: 0,
    distort: 0.006, fringe: 0.0004, vignette: 0.22, grain: 0.035, flare: 0.6, streak: 0.4 },
  { id: 'ultra16', label: 'Ultra 16mm', focal: 16, ratio: 0,
    distort: 0.07, fringe: 0.0022, vignette: 0.32, grain: 0.035, flare: 0.7, streak: 0.3 },
  { id: 'ana239',  label: 'Anamorphic 2.39', focal: 28, ratio: 2.39,
    distort: 0.035, fringe: 0.0030, vignette: 0.26, grain: 0.045, flare: 1.1, streak: 1.5 },
  { id: 'doc16',   label: 'Doc 16mm film', focal: 21, ratio: 0,
    distort: 0.03, fringe: 0.0016, vignette: 0.38, grain: 0.10, flare: 0.4, streak: 0 },
  { id: 'tele85',  label: 'Portrait 85mm', focal: 85, ratio: 0,
    distort: -0.01, fringe: 0.0006, vignette: 0.18, grain: 0.03, flare: 0.5, streak: 0.5 },
];

// ── screen-space flare ──────────────────────────────────────────────────────
// ★ DRAWN AT THE SUN, NOT HARVESTED FROM BRIGHT PIXELS. The first version
// thresholded the whole frame and mirrored it through the centre — real optics,
// but a threshold cannot tell the sun from a bright TV (the warehouse screens
// read 5x brighter than the glazing), so whenever the sun-gate opened, the TV
// static ghosted as white dash rows and arcs across the room. Now the scene
// hands this pass the sun's screen position (lens.setSunScreen, driven per
// frame like the gate) and every element — core, starburst, red ring, the
// coloured ghost chain, the far green/violet ring, the anamorphic streak — is
// drawn procedurally along the sun→centre axis, which is the line internal
// reflections actually march. The frame is sampled at ONE place only, the sun
// itself, to ask "can this camera see something bright there?" — sun behind a
// beam or brick means no flare, and no other pixel can ever ghost again.
// Runs on LINEAR HDR before ACES, so the added light tone-maps like light.
const FlareShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlare:   { value: 0.0 },   // ghost/halo gain; 0 skips the work
    uStreak:  { value: 0.0 },   // anamorphic streak gain
    uThresh:  { value: 0.18 },  // calibrated: the glazing reads ~0.3-0.5 linear
    uAspect:  { value: 16 / 9 },
    // 0..1 — how much the camera faces the sun; the SCENE drives it per frame
    // (lens.setSunGate). Defaults to 1 so loops that never call it keep the old
    // always-on behaviour. Still needed alongside the anchored position: it is
    // what fades the whole system in over ~17° so it reads as optics.
    uSunGate: { value: 1.0 },
    // The sun's position in 0..1 screen UV (lens.setSunScreen). May sit outside
    // the frame — flare persists a while past the edge, like a real lens. The
    // default parks it far above the frame so a scene that never calls the
    // setter renders no flare rather than a wrong one.
    uSunUv:   { value: new THREE.Vector2(0.5, 3.0) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uFlare, uStreak, uThresh, uAspect, uSunGate;
    uniform vec2 uSunUv;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // Defocused probe at the sun's own position — the single place the frame
    // is sampled. 3x3 over ~1.5% of the frame so one hot pixel cannot flick
    // the whole flare on and off.
    vec3 brightSoft(vec2 uv) {
      vec2 px = vec2(0.007, 0.007 * uAspect);
      vec3 c = vec3(0.0);
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++)
          c += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * px).rgb;
      return max(c / 9.0 - uThresh, vec3(0.0));
    }

    // soft-edged disc and gaussian ring, distances in aspect-corrected UV
    float disc(float d, float rad) { return smoothstep(rad, rad * 0.55, d); }
    float ringf(float d, float rad, float w) {
      float x = (d - rad) / w; return exp(-x * x);
    }

    void main() {
      vec3 scene = texture2D(tDiffuse, vUv).rgb;
      float fl = uFlare * uSunGate;
      float st = uStreak * uSunGate;
      if (fl <= 0.0 && st <= 0.0) { gl_FragColor = vec4(scene, 1.0); return; }

      // Visibility: fade out as the sun leaves the frame (a lens keeps flaring
      // for a while — kill it at the edge and it pops), and while it IS in
      // frame, ask the image whether the sun is actually visible there. A sun
      // behind a beam probes dark and the flare dies, which is the honest cue.
      float off = max(max(-uSunUv.x, uSunUv.x - 1.0), max(-uSunUv.y, uSunUv.y - 1.0));
      float offFade = 1.0 - smoothstep(0.0, 0.35, max(off, 0.0));
      float inFrame = 1.0 - smoothstep(0.0, 0.05, max(off, 0.0));
      float occ = smoothstep(0.0, 0.15, luma(brightSoft(clamp(uSunUv, vec2(0.02), vec2(0.98)))));
      float vis = offFade * mix(1.0, occ, inFrame);
      if (vis <= 0.001) { gl_FragColor = vec4(scene, 1.0); return; }

      // aspect-corrected space, so discs stay round on a wide canvas
      vec2 A = vec2(uAspect, 1.0);
      vec2 p = vUv * A, s = uSunUv * A;
      vec2 rel = p - s;
      float r = length(rel);
      vec2 axis = vec2(0.5) * A - s;   // internal reflections march sun → centre
      vec3 col = vec3(0.0);

      if (fl > 0.0) {
        // core glow + the wide warm breath around the source
        col += vec3(1.0, 0.92, 0.82) * 2.5 * exp(-r * r * 240.0);
        col += vec3(1.0, 0.45, 0.32) * 0.28 * exp(-r * r * 5.5);
        // starburst: two ray frequencies so it does not read as a stencil
        float ang = atan(rel.y, rel.x);
        float rays = pow(abs(sin(ang * 4.0)), 24.0) * 0.7
                   + pow(abs(sin(ang * 7.0 + 1.3)), 60.0) * 0.5;
        col += vec3(1.0, 0.8, 0.7) * rays * exp(-r * 5.0) * 0.5;
        // the red-orange ring hugging the source
        col += vec3(1.0, 0.34, 0.22) * 0.55 * ringf(r, 0.115, 0.012);
        // ghost chain: coated-glass colours, alternating warm and cool
        vec2 g;
        g = s + axis * 0.85;
        col += vec3(1.0, 0.72, 0.45) * 0.16 * disc(length(p - g), 0.040);
        g = s + axis * 1.12;
        col += vec3(0.45, 1.0, 0.80) * 0.22 * disc(length(p - g), 0.014);
        g = s + axis * 1.35;
        col += vec3(1.0, 0.62, 0.30) * 0.14
             * (disc(length(p - g), 0.065) - 0.6 * disc(length(p - g), 0.035));
        g = s + axis * 1.55;
        col += vec3(0.42, 0.62, 1.0) * 0.25 * disc(length(p - g), 0.020);
        // the far ring: green body with a violet fringe just outside it
        g = s + axis * 1.95;
        float dg = length(p - g);
        col += vec3(0.45, 0.85, 0.40) * 0.30 * ringf(dg, 0.165, 0.010)
             + vec3(0.55, 0.38, 0.95) * 0.22 * ringf(dg, 0.178, 0.008)
             + vec3(0.35, 0.75, 0.35) * 0.05 * disc(dg, 0.165);
        col *= fl;
      }

      if (st > 0.0) {
        // anamorphic streak through the sun itself — a drawn line, not a
        // gather, so the TV wall cannot paint speckle rows any more
        float w = exp(-rel.y * rel.y * 5200.0) * exp(-abs(rel.x) * 1.9);
        col += vec3(0.55, 0.7, 1.0) * w * st * 0.9;
      }

      gl_FragColor = vec4(scene + col * vis, 1.0);
    }`,
};

const LensShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uDistort:  { value: 0.0 },   // barrel (+) / pincushion (-), at the corner
    uFringe:   { value: 0.0 },   // chromatic aberration, UV offset at the corner
    uVignette: { value: 0.0 },   // 0..1 corner darkening
    uGrain:    { value: 0.0 },   // 0..~0.15 luminance jitter
    uRatio:    { value: 0.0 },   // letterbox aspect; 0 disables
    uAspect:   { value: 16 / 9 },// canvas aspect, set on resize
    uTime:     { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uDistort, uFringe, uVignette, uGrain, uRatio, uAspect, uTime;
    varying vec2 vUv;

    // aspect-corrected radial coordinate: r = 1 at the frame corner
    vec2 warp(vec2 uv, float k) {
      vec2 c = uv - 0.5;
      c.x *= uAspect;
      float r2 = dot(c, c) / (0.25 * (uAspect * uAspect + 1.0));
      c *= 1.0 + k * r2;
      c.x /= uAspect;
      return c + 0.5;
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 61.7) * 43758.5453);
    }

    void main() {
      // letterbox first: outside the band is hard black, and the distortion
      // must not bend the bars
      if (uRatio > 0.0) {
        float band = 0.5 * (1.0 - uAspect / uRatio); // half-height of each bar
        if (band > 0.0 && (vUv.y < band || vUv.y > 1.0 - band)) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
      }

      vec2 uv = warp(vUv, uDistort);
      // fringe: red pulled in, blue pushed out, green true — cheap transverse CA
      vec2 c = uv - 0.5;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - c * uFringe * 2.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + c * uFringe * 2.0).b;

      // vignette, aspect-corrected so the falloff is a circle, not an ellipse
      vec2 vc = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(vc) / (0.5 * sqrt(uAspect * uAspect + 1.0));
      col *= 1.0 - uVignette * smoothstep(0.35, 1.05, r) * (0.4 + 0.6 * r);

      // ★ GRAIN MUST BE MULTIPLICATIVE HERE, NOT ADDITIVE. This pass runs on
      // LINEAR HDR before ACES, where a shadow pixel is ~0.01 — adding ±0.035 to
      // that is a 3x swing which tone mapping then lifts into a wall of noise
      // over the whole frame (measured: the room vanished behind static).
      // Scaling instead keeps grain proportional to signal, which is also how
      // film behaves: black stays black, the mid-tones carry the texture.
      // The grain RE-ROLLS at 24 fps (film cadence). A static pattern reads
      // fine on a static shot, but the moment the camera drifts, a screen-
      // fixed pattern over a moving image is a screen-door — reported as
      // "ants everywhere, the drift is a good way to see it". Film grain
      // boils; only a dirty lens holds still.
      float g = (hash(vUv * vec2(1920.0, 1080.0) + floor(uTime * 24.0) * vec2(7.13, 3.77)) - 0.5) * 2.0 * uGrain;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      // taper in the highlights so a blown window does not sparkle
      col *= 1.0 + g / (1.0 + 2.0 * luma);

      gl_FragColor = vec4(col, 1.0);
    }`,
};

// createLens({ setHFov }) — setHFov(radians|null) is supplied by the scene and
// re-derives the camera projection; null restores the scene's native fov.
export function createLens({ setHFov } = {}) {
  const pass = new ShaderPass(LensShader);
  const u = pass.uniforms;
  // Flare is its own pass BEFORE the character pass, so ghosts pick up the
  // vignette and grain like everything else — light through glass, then film.
  const flarePass = new ShaderPass(FlareShader);
  const fu = flarePass.uniforms;
  flarePass.enabled = false;

  const api = {
    pass,
    flarePass,
    formats: FORMATS,
    current: 'native',
    setAspect(aspect) { u.uAspect.value = aspect; fu.uAspect.value = aspect; },
    update(t) { u.uTime.value = t; },
    setFocal(mm) {
      if (setHFov) setHFov(mm ? focalToHFov(mm) : null);
    },
    setFlare(v) {
      fu.uFlare.value = v;
      flarePass.enabled = v > 0 || fu.uStreak.value > 0;
    },
    setStreak(v) {
      fu.uStreak.value = v;
      flarePass.enabled = v > 0 || fu.uFlare.value > 0;
    },
    /** 0..1, how much the camera faces the sun — scenes drive this per frame. */
    setSunGate(v) { fu.uSunGate.value = v; },
    /** The sun's screen position in 0..1 UV, driven per frame alongside the
     *  gate. May land outside 0..1 — the shader fades the flare out over the
     *  next ~35% of the frame rather than popping it at the edge. */
    setSunScreen(x, y) { fu.uSunUv.value.set(x, y); },
    apply(idOrPreset) {
      const p = typeof idOrPreset === 'string'
        ? FORMATS.find((f) => f.id === idOrPreset) : idOrPreset;
      if (!p) return;
      api.current = p.id;
      api.setFocal(p.focal);
      u.uDistort.value = p.distort;
      u.uFringe.value = p.fringe;
      u.uVignette.value = p.vignette;
      u.uGrain.value = p.grain;
      u.uRatio.value = p.ratio;
      api.setFlare(p.flare ?? 0);
      api.setStreak(p.streak ?? 0);
    },
  };
  return api;
}
