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
// Not a sprite pinned to a light: ANY pixel brighter than the threshold grows
// ghosts (mirrored copies walking through the optical centre — internal lens
// reflections), a halo, and an anamorphic horizontal streak. The glazing, the
// sun pool and the sky through a doorway all flare, and the artefacts slide
// around naturally as the camera moves, which is what sells it as optics.
// Runs on LINEAR HDR, so "bright" means real HDR values, not display white.
const FlareShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlare:   { value: 0.0 },   // ghost/halo gain; 0 skips all the sampling
    uStreak:  { value: 0.0 },   // anamorphic streak gain
    uThresh:  { value: 0.18 },  // calibrated: the glazing reads ~0.3-0.5 linear
    uAspect:  { value: 16 / 9 },
    // 0..1 — how much the camera faces the sun; the SCENE drives it per frame
    // (lens.setSunGate). Defaults to 1 so loops that never call it keep the old
    // always-on behaviour. Exists because a threshold CANNOT separate "the sun"
    // from "a bright screen" — the warehouse TVs are 5x brighter than the
    // glazing, so the only way to make flare read as sun optics is to gate it
    // by look direction, not by brightness.
    uSunGate: { value: 1.0 },
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
    varying vec2 vUv;

    // thresholded fetch, softened with a tiny cross so ghost edges do not alias
    vec3 bright(vec2 uv) {
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
      vec2 px = vec2(0.002, 0.002 * uAspect);
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.4
             + texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb * 0.15
             + texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb * 0.15
             + texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb * 0.15
             + texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb * 0.15;
      return max(c - uThresh, vec3(0.0));
    }

    // Ghost/halo fetch: a real ghost is DEFOCUSED, and sampling the source sharply
    // is how the TV static ghosted as animated white speckle on the dark walls (a
    // field of tiny bright dots stays a field of tiny bright dots through a sharp
    // mirror). A 3x3 average over ~1.5% of the frame turns speckle into the dim
    // soft blob a lens actually produces — and averaging BEFORE the threshold also
    // means a lone hot pixel contributes a ninth, not its full value. The streak
    // keeps the sharp fetch: a crisp horizontal line is its whole point.
    vec3 brightSoft(vec2 uv) {
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
      vec2 px = vec2(0.007, 0.007 * uAspect);
      vec3 c = vec3(0.0);
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++)
          c += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * px).rgb;
      return max(c / 9.0 - uThresh, vec3(0.0));
    }

    void main() {
      vec3 scene = texture2D(tDiffuse, vUv).rgb;
      vec3 flare = vec3(0.0);
      float fl = uFlare * uSunGate;
      float st = uStreak * uSunGate;

      if (fl > 0.0) {
        // ghosts: the frame mirrored through the centre at a few scales, each
        // fading toward the frame edge and tinted like coated glass
        vec2 m = 1.0 - vUv;
        vec2 toC = vec2(0.5) - vUv;
        float edge = 1.0 - smoothstep(0.2, 0.75, length(toC * vec2(uAspect, 1.0)));
        flare += brightSoft(mix(vec2(0.5), m, 0.35)) * 0.30 * vec3(1.0, 0.85, 0.7) * edge;
        flare += brightSoft(mix(vec2(0.5), m, 0.65)) * 0.20 * vec3(0.7, 0.9, 1.0) * edge;
        flare += brightSoft(mix(vec2(0.5), m, -0.4)) * 0.15 * vec3(0.85, 1.0, 0.85) * edge;
        // halo: sample a ring's worth away from the centre along this pixel's ray
        vec2 haloVec = normalize(toC + vec2(1e-5)) * 0.42;
        flare += brightSoft(vUv + haloVec) * 0.20 * vec3(0.6, 0.75, 1.0)
               * smoothstep(0.5, 0.1, abs(length(toC * vec2(uAspect, 1.0)) - 0.35));
        flare *= fl;
      }

      if (st > 0.0) {
        // anamorphic streak: gather horizontally with exponential spacing —
        // 8 taps a side reads as a clean blue line without a separate blur RT.
        // Soft fetch here too: sharp taps on the TV static painted faint speckle
        // ROWS across the room at screen-TV height (the far taps reach ~28% of
        // the frame, so the rows landed on the chalkboard wall). The gather is
        // already a horizontal smear, so pre-blurring the source keeps the line
        // a line — it just stops point-sampling noise.
        vec3 s = vec3(0.0);
        float wsum = 0.0;
        for (int i = 1; i <= 8; i++) {
          float d = 0.004 * pow(1.7, float(i));
          float w = 1.0 / float(i * i);
          s += (brightSoft(vUv + vec2(d, 0.0)) + brightSoft(vUv - vec2(d, 0.0))) * w;
          wsum += 2.0 * w;
        }
        flare += (s / wsum) * st * 2.0 * vec3(0.55, 0.7, 1.0);
      }

      gl_FragColor = vec4(scene + flare, 1.0);
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
