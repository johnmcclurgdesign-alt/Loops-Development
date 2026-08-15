// Stylised looks — a post chain you can switch between from a menu.
//
// The brief was "change the style but keep the dramatic lighting", and that rules the
// design. Stylisations split into two families:
//
//   · tone-REPLACING (cel, posterise) quantise luminance — and luminance IS the lighting,
//     so a baked-GI scene loses exactly what makes it good.
//   · tone-PRESERVING keep luminance and restyle the detail, chroma and edges instead.
//
// Everything here is the second kind. Ink and halftone go further and are *driven* by
// luminance — the baked light decides stroke density, so the lighting does the drawing.
//
// WHERE THE PASSES SIT, and why it matters:
//
//   RenderPass → [style] → OutputPass → screen
//
// three only applies tone mapping when it renders straight to the canvas (renderer.js:
// `if (currentRenderTarget === null) toneMapping = renderer.toneMapping`). Inside the
// composer's target the materials do NOT tone-map, so OutputPass doing ACES + exposure
// at the very end reproduces the scene exactly — and with no style pass in between the
// image is unchanged. The styles therefore run on LINEAR HDR values, before ACES.
//
// That is deliberate. Ink and halftone darken the linear image and let ACES roll the
// highlights off afterwards, so bright windows stay filmic instead of turning into flat
// grey. Thresholds still need a display-referred number to be meaningful, so each shader
// gets uExposure and tone-maps a copy purely to decide density.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Shared GLSL. `display()` is a cheap ACES approximation used ONLY for deciding how dark
// a pixel reads on screen; the colour that leaves the shader stays linear.
const COMMON = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uExposure;
  uniform float uAmount;
  uniform float uBlend;
  uniform float uTime;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  // What this pixel will actually look like once ACES has run.
  float displayLuma(vec3 linear) { return luma(aces(linear * uExposure)); }

  // Exact inverse of the ACES fit above. Several looks decide the FINAL colour in display
  // space (riso ink, blueprint paper, a heat ramp), but OutputPass still has ACES and the
  // exposure to apply afterwards — so those looks have to hand back the linear value that
  // survives the trip. Dividing by exposure and fudging a multiplier washes them out;
  // this solves it properly.
  //   y = (2.51x^2 + 0.03x) / (2.43x^2 + 0.59x + 0.14)
  //   -> x^2(2.43y - 2.51) + x(0.59y - 0.03) + 0.14y = 0
  float acesInv1(float y) {
    y = clamp(y, 0.0, 0.999);
    float a = 2.43 * y - 2.51;
    float b = 0.59 * y - 0.03;
    float c = 0.14 * y;
    float disc = max(b * b - 4.0 * a * c, 0.0);
    return (-b - sqrt(disc)) / (2.0 * a);
  }
  vec3 acesInv(vec3 y) { return vec3(acesInv1(y.r), acesInv1(y.g), acesInv1(y.b)); }

  /** Display colour -> the linear value that renders as it once OutputPass runs. */
  vec3 toLinear(vec3 display) { return acesInv(display) / max(uExposure, 0.0001); }

  // ---- blending -------------------------------------------------------------
  //
  // Blend modes are defined on 0..1 display values. These shaders work in linear HDR
  // where a bright window is 8.0, and Overlay of 8.0 is meaningless — so both sides are
  // tone-mapped to display space, blended there, then converted back. That is why the
  // modes behave the way they do in Photoshop rather than producing garbage in highlights.

  vec3 bMul(vec3 b, vec3 s)     { return b * s; }
  vec3 bScreen(vec3 b, vec3 s)  { return 1.0 - (1.0 - b) * (1.0 - s); }
  vec3 bOverlay(vec3 b, vec3 s) {
    return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  }
  vec3 bSoft(vec3 b, vec3 s) {
    vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  vec3 bDodge(vec3 b, vec3 s)   { return b / max(1.0 - s, 0.004); }
  vec3 bBurn(vec3 b, vec3 s)    { return 1.0 - (1.0 - b) / max(s, 0.004); }

  /** Swap one colour's brightness onto another's hue — the pair that keeps the lighting. */
  vec3 setLuma(vec3 c, float l) {
    float d = l - luma(c);
    return clamp(c + d, 0.0, 1.0);
  }

  vec3 blendPair(vec3 b, vec3 s, float m) {
    if (m < 0.5)  return s;                      // normal
    if (m < 1.5)  return bMul(b, s);
    if (m < 2.5)  return bScreen(b, s);
    if (m < 3.5)  return bOverlay(b, s);
    if (m < 4.5)  return bSoft(b, s);
    if (m < 5.5)  return bOverlay(s, b);         // hard light = overlay with the layers swapped
    if (m < 6.5)  return bDodge(b, s);
    if (m < 7.5)  return bBurn(b, s);
    if (m < 8.5)  return abs(b - s);             // difference
    if (m < 9.5)  return min(b, s);              // darken
    if (m < 10.5) return max(b, s);              // lighten
    if (m < 11.5) return setLuma(b, luma(s));    // luminosity: style's light, scene's colour
    return setLuma(s, luma(b));                  // colour: style's colour, scene's light
  }

  /** Blend a style result against the untouched scene, and hand back a linear colour. */
  vec4 compositeDisplay(vec3 srcLinear, vec3 styledDisplay) {
    vec3 base = aces(srcLinear * uExposure);
    vec3 mixed = clamp(blendPair(base, clamp(styledDisplay, 0.0, 1.0), uBlend), 0.0, 1.0);
    return vec4(toLinear(mix(base, mixed, uAmount)), 1.0);
  }
  /** Same, for a style that produced a linear colour. */
  vec4 compositeLinear(vec3 srcLinear, vec3 styledLinear) {
    return compositeDisplay(srcLinear, aces(styledLinear * uExposure));
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  // Sobel over DISPLAY luminance — edges land where the eye sees contrast, not where
  // the raw HDR happens to have a big number.
  float edgeStrength(vec2 uv, vec2 px) {
    float l00 = displayLuma(texture2D(tDiffuse, uv + px * vec2(-1,-1)).rgb);
    float l10 = displayLuma(texture2D(tDiffuse, uv + px * vec2( 0,-1)).rgb);
    float l20 = displayLuma(texture2D(tDiffuse, uv + px * vec2( 1,-1)).rgb);
    float l01 = displayLuma(texture2D(tDiffuse, uv + px * vec2(-1, 0)).rgb);
    float l21 = displayLuma(texture2D(tDiffuse, uv + px * vec2( 1, 0)).rgb);
    float l02 = displayLuma(texture2D(tDiffuse, uv + px * vec2(-1, 1)).rgb);
    float l12 = displayLuma(texture2D(tDiffuse, uv + px * vec2( 0, 1)).rgb);
    float l22 = displayLuma(texture2D(tDiffuse, uv + px * vec2( 1, 1)).rgb);
    float gx = -l00 - 2.0*l01 - l02 + l20 + 2.0*l21 + l22;
    float gy = -l00 - 2.0*l10 - l20 + l02 + 2.0*l12 + l22;
    return sqrt(gx*gx + gy*gy);
  }
`;

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const uniforms = (extra = {}) => Object.assign({
  tDiffuse: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uExposure: { value: 1 },
  uAmount: { value: 1 },
  uBlend: { value: 0 },
  uTime: { value: 0 },
}, extra);

// ---------------------------------------------------------------- painterly
//
// Generalised Kuwahara. For each pixel it splits the neighbourhood into sectors, and
// takes the mean of whichever sector has the LOWEST variance. Because it only ever
// outputs an average of colours already present, it cannot invent or crush tone — which
// is precisely why it keeps the lighting while abstracting the detail.
//
// Gaussian sector weights are the textbook version and are ruinous in a nested loop, so
// the weight is a polynomial approximation instead (per Maxime Heckel).

const KUWAHARA = /* glsl */`
  ${COMMON}
  uniform float uRadius;
  uniform float uSharpness;

  void main() {
    vec2 px = 1.0 / uResolution;
    int R = int(uRadius);
    const int SECTORS = 8;

    vec3 sumC[SECTORS];
    vec3 sumC2[SECTORS];
    float sumW[SECTORS];
    for (int i = 0; i < SECTORS; i++) { sumC[i] = vec3(0.0); sumC2[i] = vec3(0.0); sumW[i] = 0.0; }

    for (int y = -12; y <= 12; y++) {
      for (int x = -12; x <= 12; x++) {
        if (abs(x) > R || abs(y) > R) continue;
        vec2 o = vec2(float(x), float(y));
        float d2 = dot(o, o);
        if (d2 > uRadius * uRadius) continue;

        vec3 c = texture2D(tDiffuse, vUv + o * px).rgb;

        // Which sector this sample belongs to, softened at the boundaries so the
        // result does not band into visible pie slices.
        float ang = atan(o.y, o.x);
        float s = (ang + 3.14159265) / 6.28318530 * float(SECTORS);
        for (int k = 0; k < SECTORS; k++) {
          float dist = abs(mod(s - float(k) + float(SECTORS) * 1.5, float(SECTORS)) - float(SECTORS) * 0.5);
          float w = max(0.0, 1.0 - dist);          // polynomial stand-in for a Gaussian
          w *= w;
          w *= max(0.0, 1.0 - d2 / (uRadius * uRadius));
          sumC[k] += c * w;
          sumC2[k] += c * c * w;
          sumW[k] += w;
        }
      }
    }

    vec3 outC = vec3(0.0);
    float outW = 0.0;
    for (int k = 0; k < SECTORS; k++) {
      if (sumW[k] <= 0.0) continue;
      vec3 mean = sumC[k] / sumW[k];
      vec3 var = abs(sumC2[k] / sumW[k] - mean * mean);
      float v = var.r + var.g + var.b;
      // Low variance wins. The exponent decides how hard the winner is favoured —
      // higher is flatter and more "painted", lower keeps more of the photograph.
      float w = 1.0 / (1.0 + pow(max(v, 1e-6) * 250.0, uSharpness));
      outC += mean * w;
      outW += w;
    }
    vec3 painted = outW > 0.0 ? outC / outW : texture2D(tDiffuse, vUv).rgb;
    gl_FragColor = compositeLinear(texture2D(tDiffuse, vUv).rgb, painted);
  }
`;

// ---------------------------------------------------------------- watercolour
// Kuwahara for the pigment pooling, then the two things that actually say "watercolour":
// darker edges where pigment gathers, and paper tooth breaking up the wash.
const WATERCOLOUR = /* glsl */`
  ${COMMON}
  uniform float uRadius;
  uniform float uSharpness;
  uniform float uPaper;

  void main() {
    vec2 px = 1.0 / uResolution;
    int R = int(uRadius);
    const int SECTORS = 8;
    vec3 sumC[SECTORS]; vec3 sumC2[SECTORS]; float sumW[SECTORS];
    for (int i = 0; i < SECTORS; i++) { sumC[i] = vec3(0.0); sumC2[i] = vec3(0.0); sumW[i] = 0.0; }

    for (int y = -10; y <= 10; y++) {
      for (int x = -10; x <= 10; x++) {
        if (abs(x) > R || abs(y) > R) continue;
        vec2 o = vec2(float(x), float(y));
        float d2 = dot(o, o);
        if (d2 > uRadius * uRadius) continue;
        // Wobble the tap so washes get an uneven, hand-made edge.
        vec2 warp = vec2(noise((vUv + o * px) * 90.0), noise((vUv + o * px) * 90.0 + 7.3)) - 0.5;
        vec3 c = texture2D(tDiffuse, vUv + o * px + warp * px * 2.5).rgb;
        float ang = atan(o.y, o.x);
        float s = (ang + 3.14159265) / 6.28318530 * float(SECTORS);
        for (int k = 0; k < SECTORS; k++) {
          float dist = abs(mod(s - float(k) + float(SECTORS) * 1.5, float(SECTORS)) - float(SECTORS) * 0.5);
          float w = max(0.0, 1.0 - dist); w *= w;
          w *= max(0.0, 1.0 - d2 / (uRadius * uRadius));
          sumC[k] += c * w; sumC2[k] += c * c * w; sumW[k] += w;
        }
      }
    }
    vec3 outC = vec3(0.0); float outW = 0.0;
    for (int k = 0; k < SECTORS; k++) {
      if (sumW[k] <= 0.0) continue;
      vec3 mean = sumC[k] / sumW[k];
      vec3 var = abs(sumC2[k] / sumW[k] - mean * mean);
      float w = 1.0 / (1.0 + pow(max(var.r + var.g + var.b, 1e-6) * 250.0, uSharpness));
      outC += mean * w; outW += w;
    }
    vec3 wash = outW > 0.0 ? outC / outW : texture2D(tDiffuse, vUv).rgb;

    // pigment gathers at the edge of a wash
    float e = clamp(edgeStrength(vUv, px) * 2.2, 0.0, 1.0);
    wash *= 1.0 - e * 0.55;

    // paper tooth: two scales so it does not read as digital noise
    float tooth = noise(vUv * uResolution.xy * 0.55) * 0.6 + noise(vUv * uResolution.xy * 0.14) * 0.4;
    wash *= mix(1.0, 0.82 + tooth * 0.36, uPaper);

    gl_FragColor = compositeLinear(texture2D(tDiffuse, vUv).rgb, wash);
  }
`;

// ---------------------------------------------------------------- ink / hatching
//
// The purest answer to "keep the lighting": stroke density is CHOSEN by the baked
// light. Four hatch layers cut in as the surface darkens, each rotated, so the image is
// drawn entirely by tone. Screen-space rather than a real Tonal Art Map — no per-surface
// UVs needed, at the cost of strokes living on the screen instead of on the wall.
const INK = /* glsl */`
  ${COMMON}
  uniform float uScale;
  uniform float uInk;

  float hatch(vec2 p, float angle, float freq) {
    float s = sin(angle), c = cos(angle);
    vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    // slight waver so the line looks drawn rather than printed
    float w = noise(r * 0.06) * 2.2;
    return sin((r.y + w) * freq);
  }

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float L = displayLuma(src);
    vec2 p = vUv * uResolution * uScale;

    float ink = 0.0;
    // Each layer switches on over its own tonal range: mid tones get one direction,
    // shadows accumulate more until the darkest areas are nearly solid.
    if (L < 0.85) ink = max(ink, smoothstep(0.30, 0.0, abs(hatch(p, 0.6, 0.55))) * smoothstep(0.85, 0.55, L));
    if (L < 0.55) ink = max(ink, smoothstep(0.30, 0.0, abs(hatch(p, -0.7, 0.55))) * smoothstep(0.55, 0.32, L));
    if (L < 0.32) ink = max(ink, smoothstep(0.30, 0.0, abs(hatch(p, 1.9, 0.6))) * smoothstep(0.32, 0.16, L));
    if (L < 0.16) ink = max(ink, smoothstep(0.30, 0.0, abs(hatch(p, -1.9, 0.6))) * smoothstep(0.16, 0.04, L));

    // contour lines on top of the tonal hatching
    float e = clamp(edgeStrength(vUv, px) * 3.0, 0.0, 1.0);
    ink = max(ink, e);

    // Multiply into the LINEAR image so ACES still rolls the highlights afterwards.
    vec3 drawn = src * (1.0 - ink * uInk);
    gl_FragColor = compositeLinear(src, drawn);
  }
`;

// ---------------------------------------------------------------- comic / halftone
// Same idea as ink, but dots instead of lines, plus a chroma lift so it reads as print.
const COMIC = /* glsl */`
  ${COMMON}
  uniform float uDots;
  uniform float uInk;

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float L = displayLuma(src);

    // rotated dot grid — the classic screen angle keeps it from looking like a checkerboard
    float a = 0.4;
    vec2 p = vUv * uResolution;
    vec2 r = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)) / uDots;
    vec2 cell = fract(r) - 0.5;
    // dot radius grows as the pixel darkens
    float radius = sqrt(clamp(1.0 - L, 0.0, 1.0)) * 0.62;
    float dot = smoothstep(radius, radius - 0.12, length(cell));

    float e = clamp(edgeStrength(vUv, px) * 3.4, 0.0, 1.0);
    float ink = max(1.0 - dot, e);

    vec3 lifted = mix(vec3(luma(src)), src, 1.35);        // push the chroma toward print
    vec3 drawn = lifted * (1.0 - ink * uInk);
    gl_FragColor = compositeLinear(src, drawn);
  }
`;

// ---------------------------------------------------------------- dither
// Ordered 8×8 Bayer. Tone is carried by dot DENSITY, so the lighting survives even
// though the palette collapses — the most extreme look here that still keeps the drama.
const DITHER = /* glsl */`
  ${COMMON}
  uniform float uLevels;
  uniform float uPixel;
  uniform float uMono;

  float bayer(vec2 p) {
    int x = int(mod(p.x, 8.0)), y = int(mod(p.y, 8.0));
    int i = x + y * 8;
    // 8x8 ordered matrix, unrolled — GLSL1 cannot index a const array by a variable.
    float m[64];
    m[0]=0.0;m[1]=32.0;m[2]=8.0;m[3]=40.0;m[4]=2.0;m[5]=34.0;m[6]=10.0;m[7]=42.0;
    m[8]=48.0;m[9]=16.0;m[10]=56.0;m[11]=24.0;m[12]=50.0;m[13]=18.0;m[14]=58.0;m[15]=26.0;
    m[16]=12.0;m[17]=44.0;m[18]=4.0;m[19]=36.0;m[20]=14.0;m[21]=46.0;m[22]=6.0;m[23]=38.0;
    m[24]=60.0;m[25]=28.0;m[26]=52.0;m[27]=20.0;m[28]=62.0;m[29]=30.0;m[30]=54.0;m[31]=22.0;
    m[32]=3.0;m[33]=35.0;m[34]=11.0;m[35]=43.0;m[36]=1.0;m[37]=33.0;m[38]=9.0;m[39]=41.0;
    m[40]=51.0;m[41]=19.0;m[42]=59.0;m[43]=27.0;m[44]=49.0;m[45]=17.0;m[46]=57.0;m[47]=25.0;
    m[48]=15.0;m[49]=47.0;m[50]=7.0;m[51]=39.0;m[52]=13.0;m[53]=45.0;m[54]=5.0;m[55]=37.0;
    m[56]=63.0;m[57]=31.0;m[58]=55.0;m[59]=23.0;m[60]=61.0;m[61]=29.0;m[62]=53.0;m[63]=21.0;
    float v = 0.0;
    for (int k = 0; k < 64; k++) if (k == i) v = m[k];
    return v / 64.0;
  }

  void main() {
    vec2 grid = floor(vUv * uResolution / uPixel);
    vec2 snapped = (grid * uPixel + uPixel * 0.5) / uResolution;
    vec3 src = texture2D(tDiffuse, snapped).rgb;

    vec3 disp = aces(src * uExposure);                    // dither in display space
    disp = mix(disp, vec3(luma(disp)), uMono);
    float t = bayer(grid);
    vec3 q = floor(disp * uLevels + t) / uLevels;

    gl_FragColor = compositeDisplay(src, q);
  }
`;

// ---------------------------------------------------------------- outline only
// Tone completely untouched — the cheapest "different style, same lighting" there is.
const OUTLINE = /* glsl */`
  ${COMMON}
  uniform float uInk;
  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float e = clamp(edgeStrength(vUv, px) * 3.0, 0.0, 1.0);
    e = smoothstep(0.15, 0.7, e);
    gl_FragColor = compositeLinear(src, src * (1.0 - e * uInk));
  }
`;

// ---------------------------------------------------------------- impasto
// Kuwahara for the colour, then treat the result as a HEIGHT field: differentiate the
// luminance, build a normal from it, and light that with a raking light. The strokes
// stop being a flat filter and start catching light like loaded paint on canvas.
const IMPASTO = /* glsl */`
  ${COMMON}
  uniform float uRadius;
  uniform float uRelief;
  uniform float uGloss;

  vec3 kuwa(vec2 uv, vec2 px, float radius) {
    const int SECTORS = 8;
    vec3 sumC[SECTORS]; vec3 sumC2[SECTORS]; float sumW[SECTORS];
    for (int i = 0; i < SECTORS; i++) { sumC[i] = vec3(0.0); sumC2[i] = vec3(0.0); sumW[i] = 0.0; }
    int R = int(radius);
    for (int y = -8; y <= 8; y++) {
      for (int x = -8; x <= 8; x++) {
        if (abs(x) > R || abs(y) > R) continue;
        vec2 o = vec2(float(x), float(y));
        float d2 = dot(o, o);
        if (d2 > radius * radius) continue;
        vec3 c = texture2D(tDiffuse, uv + o * px).rgb;
        float s = (atan(o.y, o.x) + 3.14159265) / 6.28318530 * float(SECTORS);
        for (int k = 0; k < SECTORS; k++) {
          float dist = abs(mod(s - float(k) + float(SECTORS) * 1.5, float(SECTORS)) - float(SECTORS) * 0.5);
          float w = max(0.0, 1.0 - dist); w *= w;
          w *= max(0.0, 1.0 - d2 / (radius * radius));
          sumC[k] += c * w; sumC2[k] += c * c * w; sumW[k] += w;
        }
      }
    }
    vec3 outC = vec3(0.0); float outW = 0.0;
    for (int k = 0; k < SECTORS; k++) {
      if (sumW[k] <= 0.0) continue;
      vec3 mean = sumC[k] / sumW[k];
      vec3 var = abs(sumC2[k] / sumW[k] - mean * mean);
      float w = 1.0 / (1.0 + pow(max(var.r + var.g + var.b, 1e-6) * 250.0, 6.0));
      outC += mean * w; outW += w;
    }
    return outW > 0.0 ? outC / outW : texture2D(tDiffuse, uv).rgb;
  }

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    vec3 paint = kuwa(vUv, px, uRadius);

    // Height = painted luminance plus canvas tooth, so the weave shows through thin paint.
    float h  = displayLuma(kuwa(vUv, px, uRadius)) + noise(vUv * uResolution * 0.5) * 0.06;
    float hx = displayLuma(kuwa(vUv + vec2(px.x, 0.0) * 2.0, px, uRadius));
    float hy = displayLuma(kuwa(vUv + vec2(0.0, px.y) * 2.0, px, uRadius));
    vec3 n = normalize(vec3((h - hx) * uRelief, (h - hy) * uRelief, 0.06));

    vec3 L = normalize(vec3(-0.5, 0.7, 0.5));
    float diff = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);

    vec3 lit = paint * (0.72 + diff * 0.6) + spec * uGloss * (0.4 + paint * 0.6);
    gl_FragColor = compositeLinear(src, lit);
  }
`;

// ---------------------------------------------------------------- risograph
// Two ink screens at different angles over paper white, deliberately misregistered.
// Everything is decided by tone, so the baked light survives a total palette rewrite.
const RISO = /* glsl */`
  ${COMMON}
  uniform vec3 uInkA;
  uniform vec3 uInkB;
  uniform float uDots;
  uniform float uOffset;

  float screenAt(vec2 uv, float angle, float coverage) {
    vec2 p = uv * uResolution;
    vec2 r = vec2(p.x * cos(angle) - p.y * sin(angle), p.x * sin(angle) + p.y * cos(angle)) / uDots;
    vec2 cell = fract(r) - 0.5;
    float radius = sqrt(clamp(coverage, 0.0, 1.0)) * 0.66;
    return 1.0 - smoothstep(radius - 0.14, radius, length(cell));
  }

  void main() {
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    vec3 disp = aces(src * uExposure);

    // Split the image between the two inks: warm content to A, cool to B, tone to both.
    float L = luma(disp);
    float warm = clamp((disp.r - disp.b) * 1.6 + 0.5, 0.0, 1.0);
    float covA = clamp((1.0 - L) * warm * 1.5, 0.0, 1.0);
    float covB = clamp((1.0 - L) * (1.0 - warm) * 1.5 + (1.0 - L) * 0.35, 0.0, 1.0);

    // misregistration — the thing that makes riso look printed rather than rendered
    vec2 off = vec2(uOffset, -uOffset) / uResolution;
    float a = screenAt(vUv + off, 0.26, covA);
    float b = screenAt(vUv - off, 1.31, covB);

    vec3 paper = vec3(0.94, 0.92, 0.87);
    vec3 ink = paper;
    ink = mix(ink, uInkA, a * 0.92);           // inks multiply, roughly
    ink = mix(ink, uInkB, b * 0.92);
    ink *= 0.97 + noise(vUv * uResolution * 0.7) * 0.06;   // paper grain

    gl_FragColor = compositeDisplay(src, ink);
  }
`;

// ---------------------------------------------------------------- thermal
// The most literal "lighting IS the image" look here: display luminance is remapped
// straight through a heat ramp. Nothing of the albedo survives, all of the light does.
const THERMAL = /* glsl */`
  ${COMMON}
  uniform float uBands;

  vec3 ramp(float t) {
    vec3 c = mix(vec3(0.02, 0.0, 0.14), vec3(0.5, 0.0, 0.55), smoothstep(0.0, 0.32, t));
    c = mix(c, vec3(0.95, 0.16, 0.05), smoothstep(0.28, 0.58, t));
    c = mix(c, vec3(1.0, 0.72, 0.05), smoothstep(0.55, 0.82, t));
    c = mix(c, vec3(1.0, 1.0, 0.92), smoothstep(0.8, 1.0, t));
    return c;
  }

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float L = displayLuma(src);
    // Optional isotherm banding — contour lines through the light, like a heat map.
    float t = uBands > 0.5 ? floor(L * uBands) / uBands + fract(L * uBands) * 0.12 : L;
    vec3 heat = ramp(clamp(t, 0.0, 1.0));
    float e = clamp(edgeStrength(vUv, px) * 2.0, 0.0, 1.0);
    heat = mix(heat, vec3(0.0), e * 0.25);
    gl_FragColor = compositeDisplay(src, heat);
  }
`;

// ---------------------------------------------------------------- neon
// Crush the base to near-black, then let the EDGES emit. The dramatic shafts read as
// light sources rather than lit surfaces, which is a very different feeling from the
// same geometry.
const NEON = /* glsl */`
  ${COMMON}
  uniform float uGlow;
  uniform float uScan;

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float L = displayLuma(src);

    // Multi-tap edge gather, widening — a cheap bloom around the linework.
    float e = 0.0;
    for (int i = 1; i <= 4; i++) {
      float s = float(i);
      e += edgeStrength(vUv, px * s) / s;
    }
    e = clamp(e * 0.55, 0.0, 1.0);

    // Hue from the source so the neon still describes the scene's own colour.
    vec3 tint = normalize(src + 0.001);
    tint = mix(vec3(0.15, 0.85, 1.0), tint * 1.6, 0.55);

    vec3 base = src * 0.10;                            // keep a whisper of the room
    vec3 glow = tint * e * uGlow + vec3(0.35, 0.05, 0.6) * pow(L, 2.2) * 0.8;
    vec3 outC = base + glow;

    float scan = 0.92 + 0.08 * sin(vUv.y * uResolution.y * 1.4 + uTime * 2.0);
    outC *= mix(1.0, scan, uScan);
    gl_FragColor = compositeLinear(src, outC);
  }
`;

// ---------------------------------------------------------------- charcoal
// Smudged graphite on paper. Direction comes from the local luminance gradient, so the
// strokes follow the form the way a hand would follow it.
const CHARCOAL = /* glsl */`
  ${COMMON}
  uniform float uGrain;
  uniform float uContrast;

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float L = displayLuma(src);

    // gradient of the tone gives a direction to smudge along
    float lx = displayLuma(texture2D(tDiffuse, vUv + vec2(px.x, 0.0) * 2.0).rgb) - L;
    float ly = displayLuma(texture2D(tDiffuse, vUv + vec2(0.0, px.y) * 2.0).rgb) - L;
    vec2 dir = normalize(vec2(-ly, lx) + 1e-5);

    // sample noise stretched along that direction — reads as a dragged stick of charcoal
    float g = 0.0;
    for (int i = -3; i <= 3; i++) {
      vec2 o = dir * float(i) * 2.2;
      g += noise((vUv * uResolution + o) * 0.85);
    }
    g /= 7.0;

    float tone = clamp((1.0 - L - 0.5) * uContrast + 0.5, 0.0, 1.0);
    float dark = clamp(tone + (g - 0.5) * uGrain, 0.0, 1.0);

    float e = clamp(edgeStrength(vUv, px) * 2.6, 0.0, 1.0);
    dark = max(dark, e * 0.85);

    vec3 paper = vec3(0.92, 0.90, 0.86) * (0.95 + noise(vUv * uResolution * 0.9) * 0.1);
    vec3 outC = paper * (1.0 - dark);
    gl_FragColor = compositeDisplay(src, outC);
  }
`;

// ---------------------------------------------------------------- blueprint
// Drafting print: paper becomes deep cyan, geometry becomes white line, and a faint
// grid sits under it all. Tone survives as line density rather than as brightness.
const BLUEPRINT = /* glsl */`
  ${COMMON}
  uniform float uGrid;

  void main() {
    vec2 px = 1.0 / uResolution;
    vec3 src = texture2D(tDiffuse, vUv).rgb;
    float L = displayLuma(src);

    float e = clamp(edgeStrength(vUv, px) * 3.2, 0.0, 1.0);
    e = smoothstep(0.12, 0.6, e);

    // hatch the darker areas so the drawing still has weight
    vec2 p = vUv * uResolution;
    float h = smoothstep(0.42, 0.0, abs(sin((p.x * 0.6 + p.y * 0.6) * 0.5)));
    float shade = h * smoothstep(0.7, 0.15, L) * 0.5;

    vec2 gcell = abs(fract(vUv * uGrid) - 0.5);
    float grid = smoothstep(0.5, 0.47, max(gcell.x, gcell.y)) * 0.0
               + (1.0 - smoothstep(0.0, 0.012, min(gcell.x, gcell.y))) * 0.35;

    vec3 paperBlue = vec3(0.06, 0.20, 0.45);
    vec3 line = vec3(0.86, 0.93, 1.0);
    vec3 outC = paperBlue;
    outC = mix(outC, paperBlue * 1.5, grid);
    outC = mix(outC, line * 0.7, shade);
    outC = mix(outC, line, e);

    gl_FragColor = compositeDisplay(src, outC);
  }
`;

// Index order must match blendPair() in the shared GLSL.
export const BLEND_MODES = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Soft light',
  'Hard light', 'Dodge', 'Burn', 'Difference', 'Darken', 'Lighten', 'Luminosity', 'Colour'];

export const LOOKS = [
  { id: 'original', label: 'Original', shader: null },
  { id: 'painterly', label: 'Painterly', shader: KUWAHARA,
    extra: { uRadius: { value: 6 }, uSharpness: { value: 8 } } },
  { id: 'watercolour', label: 'Watercolour', shader: WATERCOLOUR,
    extra: { uRadius: { value: 7 }, uSharpness: { value: 6 }, uPaper: { value: 1 } } },
  { id: 'ink', label: 'Ink / hatching', shader: INK,
    extra: { uScale: { value: 1.0 }, uInk: { value: 0.92 } } },
  { id: 'comic', label: 'Comic halftone', shader: COMIC,
    extra: { uDots: { value: 5.0 }, uInk: { value: 0.9 } } },
  { id: 'dither', label: '1-bit dither', shader: DITHER,
    extra: { uLevels: { value: 3 }, uPixel: { value: 2 }, uMono: { value: 0.35 } } },
  { id: 'outline', label: 'Outline only', shader: OUTLINE,
    extra: { uInk: { value: 0.85 } } },
  { id: 'impasto', label: 'Oil impasto', shader: IMPASTO,
    extra: { uRadius: { value: 5 }, uRelief: { value: 2.2 }, uGloss: { value: 0.55 } } },
  { id: 'riso', label: 'Risograph', shader: RISO,
    extra: { uInkA: { value: new THREE.Color(0.95, 0.28, 0.42) },
             uInkB: { value: new THREE.Color(0.05, 0.45, 0.62) },
             uDots: { value: 4.2 }, uOffset: { value: 1.6 } } },
  { id: 'thermal', label: 'Thermal', shader: THERMAL,
    extra: { uBands: { value: 0 } } },
  { id: 'neon', label: 'Neon', shader: NEON,
    extra: { uGlow: { value: 1.6 }, uScan: { value: 0.5 } } },
  { id: 'charcoal', label: 'Charcoal', shader: CHARCOAL,
    extra: { uGrain: { value: 0.55 }, uContrast: { value: 1.5 } } },
  { id: 'blueprint', label: 'Blueprint', shader: BLUEPRINT,
    extra: { uGrid: { value: 26 } } },
];

/**
 * @param {{ renderer, scene, camera, mount?: HTMLElement, initial?: string, menu?: boolean }} opts
 */
/**
 * @param {object} opts
 * @param {Array} [opts.volumetrics]  objects the Volumetrics toggle hides
 * @param {Array} [opts.dials]        [{ label, min, max, step, value, onInput, curve }] —
 *   generic on purpose. This module is shared across loops and must not know what a light
 *   shaft is; the scene owns the meaning and hands over a setter. `curve` > 1 spends more
 *   of the slider on the low end, which is where a gain is actually dialled in.
 * @param {Array} [opts.choices]      [{ label, value, options:[{label,value}], onChange }] —
 *   same contract, for things that pick from a set rather than slide.
 */
export function createLooks({ renderer, scene, camera, getCamera, initial = 'original', menu = true,
                              volumetrics = [], volumetricsOn = true, dials = [], choices = [],
                              extraPasses = [] } = {}) {
  // A scene can swap its camera after load (the factory adopts the glTF's own camera), so
  // the live one is fetched per frame rather than captured once into the RenderPass.
  const cameraOf = typeof getCamera === 'function' ? getCamera : () => camera;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, cameraOf());
  composer.addPass(renderPass);

  // Scene-supplied passes that belong BEFORE the style passes — an ambient-occlusion pass
  // is part of the render, not a stylisation, so a look should composite over its result.
  for (const pass of extraPasses) if (pass) composer.addPass(pass);

  const passes = new Map();
  for (const look of LOOKS) {
    if (!look.shader) continue;
    const pass = new ShaderPass({
      uniforms: uniforms(look.extra || {}),
      vertexShader: VERT,
      fragmentShader: look.shader,
    });
    pass.enabled = false;
    passes.set(look.id, pass);
    composer.addPass(pass);
  }
  const output = new OutputPass();
  composer.addPass(output);

  let current = LOOKS.some(l => l.id === initial) ? initial : 'original';

  // Volumetrics — light shafts and dust. Both blend additively, so through a post chain
  // they accumulate in linear HDR and get tone-mapped as a whole rather than per fragment
  // at the canvas. That is arguably more correct and definitely different, which makes
  // them the least predictable thing in the frame when a look changes. Being able to drop
  // them is how you tell "the look is doing that" from "the atmosphere is doing that".
  const vols = (volumetrics || []).filter(Boolean);
  let volsOn = volumetricsOn !== false;
  function setVolumetrics(on) {
    volsOn = !!on;
    for (const o of vols) o.visible = volsOn;
    return volsOn;
  }
  setVolumetrics(volsOn);

  function setSize(w, h) {
    composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    for (const pass of passes.values()) pass.uniforms.uResolution.value.set(w * pr, h * pr);
  }
  setSize(renderer.domElement.clientWidth || innerWidth, renderer.domElement.clientHeight || innerHeight);

  function setLook(id) {
    current = passes.has(id) ? id : 'original';
    for (const [key, pass] of passes) pass.enabled = key === current;
    if (select && select.value !== current) select.value = current;
    return current;
  }

  function render(time = 0) {
    const cam = cameraOf();
    // 'original' bypasses the composer entirely rather than trusting an empty chain to
    // be a no-op — the baseline has to be provably the same image. Unless the scene added
    // passes of its own, in which case they still have to run.
    if (current === 'original' && !extraPasses.length) { renderer.render(scene, cam); return; }
    if (current === 'original') { renderPass.camera = cam; composer.render(); return; }
    renderPass.camera = cam;
    const pass = passes.get(current);
    pass.uniforms.uExposure.value = renderer.toneMappingExposure;
    pass.uniforms.uTime.value = time;
    composer.render();
  }


  // ---- panel ----------------------------------------------------------------
  //
  // This grew one control at a time into a single wrapping row of eleven, which is a pile
  // rather than an interface. It is a sectioned panel now: Style (what the look is), Image
  // (how it is tone-mapped) and Atmosphere (the volumetrics), collapsible so it can get out
  // of the way of the thing it is adjusting.

  const PANEL_CSS = `
    #looks { position: fixed; left: 14px; bottom: 14px; z-index: 9998; width: 268px;
      font: 12px/1.5 ui-monospace, Consolas, monospace; color: #dfe3ea;
      background: rgba(16,18,23,.94); border: 1px solid #2b3140; border-radius: 10px;
      backdrop-filter: blur(6px); box-shadow: 0 10px 30px rgba(0,0,0,.5); }
    #looks header { display:flex; align-items:center; justify-content:space-between;
      padding: 9px 12px; font-size:10px; letter-spacing:.14em; text-transform:uppercase;
      color:#8b93a7; border-bottom:1px solid #2b3140; }
    #looks[data-open="0"] header { border-bottom: none; }
    #looks[data-open="0"] .body { display: none; }
    #looks .body { padding: 4px 12px 12px; max-height: 62vh; overflow-y: auto; }
    #looks h3 { margin: 10px 0 5px; font-size:9.5px; letter-spacing:.14em;
      text-transform:uppercase; color:#5f6880; font-weight:500; }
    #looks .row { display:flex; align-items:center; gap:8px; min-height: 24px; }
    #looks .row > .k { flex: 0 0 76px; color:#8b93a7; font-size:11px; }
    #looks .row > .c { flex: 1; display:flex; align-items:center; gap:6px; min-width: 0; }
    #looks .row .v { flex: 0 0 40px; text-align:right; color:#dfe3ea; font-size:11px; }
    #looks select { width:100%; min-width:0; background:#0e1116; color:#dfe3ea;
      border:1px solid #262c39; border-radius:5px; padding:3px 5px;
      font: 11.5px ui-monospace, Consolas, monospace; }
    #looks select:focus { outline:none; border-color:#3c76c4; }
    #looks input[type=range] { width:100%; min-width:0; accent-color:#3c76c4;
      background:transparent; margin:0; }
    #looks button { background:#1b2029; color:#dfe3ea; border:1px solid #2b3140;
      border-radius:5px; padding:4px 10px; cursor:pointer;
      font: 11.5px ui-monospace, Consolas, monospace; }
    #looks button:hover { background:#232936; }
    #looks button[aria-pressed="true"] { background:#2f6fd0; border-color:#2f6fd0; }
    #looks button:disabled { opacity:.45; cursor:default; }
    #looks .foot { display:flex; gap:7px; margin-top:12px; padding-top:10px;
      border-top:1px solid #2b3140; }
    #looks .foot button { flex:1; }
    #looks .foot button.primary { background:#2f6fd0; border-color:#2f6fd0; }
    #looks .msg { margin-top:7px; min-height:14px; font-size:10.5px; color:#7fd18a; }
    #looks .hdr-btn { background:none; border:none; color:#8b93a7; padding:0 2px;
      font-size:14px; line-height:1; cursor:pointer; }`;

  let api_settingsURL = () => location.href;
  let select = null;
  const controls = [];   // everything URL-serialisable: { key, get, set }

  if (menu) {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'looks';
    box.dataset.open = '1';
    box.innerHTML = `
      <header><span>look</span><button class="hdr-btn" id="looks-collapse"
        title="Hide the panel" aria-label="Hide the panel">&minus;</button></header>
      <div class="body">
        <h3>Style</h3><div id="looks-style"></div>
        <h3>Image</h3><div id="looks-image"></div>
        <h3>Atmosphere</h3><div id="looks-atmos"></div>
        <div class="foot">
          <button id="looks-copy" class="primary">Copy settings</button>
          <button id="looks-reset">Reset</button>
        </div>
        <div class="msg" id="looks-msg"></div>
      </div>`;
    document.body.appendChild(box);

    const secStyle = box.querySelector('#looks-style');
    const secImage = box.querySelector('#looks-image');
    const secAtmos = box.querySelector('#looks-atmos');
    const copyMsg = box.querySelector('#looks-msg');

    box.querySelector('#looks-collapse').addEventListener('click', (e) => {
      const open = box.dataset.open === '1';
      box.dataset.open = open ? '0' : '1';
      e.target.innerHTML = open ? '+' : '&minus;';
      e.target.title = open ? 'Show the panel' : 'Hide the panel';
    });

    /** label + control, with an optional right-aligned value readout. */
    const row = (parent, label, node, valueNode) => {
      const r = document.createElement('div');
      r.className = 'row';
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      const c = document.createElement('span');
      c.className = 'c';
      c.appendChild(node);
      if (valueNode) c.appendChild(valueNode);
      r.append(k, c);
      parent.appendChild(r);
      return r;
    };
    const readout = (text) => {
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = text;
      return v;
    };

    // ---- Style --------------------------------------------------------------
    select = document.createElement('select');
    for (const l of LOOKS) {
      const o = document.createElement('option');
      o.value = l.id; o.textContent = l.label;
      select.appendChild(o);
    }
    select.value = current;
    select.addEventListener('change', () => setLook(select.value));
    row(secStyle, 'Look', select);
    controls.push({ key: 'look', get: () => current, set: (v) => setLook(v) });

    const amtInput = document.createElement('input');
    amtInput.type = 'range'; amtInput.min = '0'; amtInput.max = '1'; amtInput.step = '0.01';
    amtInput.value = '1';
    const amtV = readout('100%');
    amtInput.addEventListener('input', () => {
      const v = parseFloat(amtInput.value);
      amtV.textContent = Math.round(v * 100) + '%';
      for (const pass of passes.values()) pass.uniforms.uAmount.value = v;
    });
    row(secStyle, 'Strength', amtInput, amtV);
    controls.push({ key: 'amt', get: () => amtInput.value,
                    set: (v) => { amtInput.value = v; amtInput.dispatchEvent(new Event('input')); } });

    const blendSel = document.createElement('select');
    for (let i = 0; i < BLEND_MODES.length; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = BLEND_MODES[i];
      blendSel.appendChild(o);
    }
    blendSel.value = '0';
    blendSel.addEventListener('change', () => {
      const v = parseFloat(blendSel.value);
      for (const pass of passes.values()) pass.uniforms.uBlend.value = v;
    });
    row(secStyle, 'Blend', blendSel);
    controls.push({ key: 'blend', get: () => blendSel.value,
                    set: (v) => { blendSel.value = v; blendSel.dispatchEvent(new Event('change')); } });

    // ---- Image --------------------------------------------------------------
    const TONES = [
      ['ACES Filmic', THREE.ACESFilmicToneMapping],
      ['AgX', THREE.AgXToneMapping],
      ['Neutral', THREE.NeutralToneMapping],
      ['Reinhard', THREE.ReinhardToneMapping],
      ['Cineon', THREE.CineonToneMapping],
      ['Linear', THREE.LinearToneMapping],
      ['None', THREE.NoToneMapping],
    ];
    const toneSel = document.createElement('select');
    for (const [name, val] of TONES) {
      const o = document.createElement('option');
      o.value = String(val); o.textContent = name;
      toneSel.appendChild(o);
    }
    toneSel.value = String(renderer.toneMapping);
    toneSel.addEventListener('change', () => { renderer.toneMapping = parseInt(toneSel.value, 10); });
    row(secImage, 'Tone', toneSel);
    controls.push({ key: 'tone', get: () => toneSel.value,
                    set: (v) => { toneSel.value = v; toneSel.dispatchEvent(new Event('change')); } });

    const expInput = document.createElement('input');
    expInput.type = 'range'; expInput.min = '0.1'; expInput.max = '10'; expInput.step = '0.1';
    expInput.value = String(renderer.toneMappingExposure);
    const expV = readout((+expInput.value).toFixed(1));
    expInput.addEventListener('input', () => {
      renderer.toneMappingExposure = parseFloat(expInput.value);
      expV.textContent = (+expInput.value).toFixed(1);
    });
    row(secImage, 'Exposure', expInput, expV);
    controls.push({ key: 'exp', get: () => expInput.value,
                    set: (v) => { expInput.value = v; expInput.dispatchEvent(new Event('input')); } });

    // ---- Atmosphere ---------------------------------------------------------
    const vol = document.createElement('button');
    vol.type = 'button';
    vol.id = 'looks-vol';
    vol.title = 'Light shafts and dust. Additive, so they react to a look differently from ' +
                'the rest of the room - switch them off to judge the look alone.';
    const dialInputs = [];
    const syncDials = () => dialInputs.forEach(i => { i.disabled = !volsOn; });
    const paintVol = () => {
      vol.textContent = volsOn ? 'On' : 'Off';
      vol.setAttribute('aria-pressed', String(volsOn));
    };
    vol.addEventListener('click', () => { setVolumetrics(!volsOn); paintVol(); syncDials(); });
    paintVol();
    if (!vols.length) { vol.disabled = true; vol.title = 'This scene has no volumetrics.'; }
    row(secAtmos, 'Volumetrics', vol);
    controls.push({ key: 'vol', get: () => (volsOn ? '1' : '0'),
                    set: (v) => { setVolumetrics(v !== '0'); paintVol(); syncDials(); } });

    // Scene-supplied dials. Each look pushes the volumetrics around differently - a
    // halftone screens them into dots, Kuwahara smears them into a haze - so the levels
    // that read well are per-look, not global.
    for (const d of dials) {
      const fmt = (v) => ((d.max - d.min) <= 0.5 ? v.toFixed(3) : v.toFixed(2));
      const curve = d.curve && d.curve !== 1 ? d.curve : 0;
      const toValue = (t) => d.min + (d.max - d.min) * Math.pow(t, curve);
      const toSlider = (v) => Math.pow((v - d.min) / (d.max - d.min), 1 / curve);

      const input = document.createElement('input');
      input.type = 'range';
      if (curve) {
        input.min = '0'; input.max = '1'; input.step = '0.002';
        input.value = String(toSlider(d.value));
      } else {
        input.min = String(d.min); input.max = String(d.max);
        input.step = String(d.step); input.value = String(d.value);
      }
      const vOut = readout(fmt(d.value));
      input.addEventListener('input', () => {
        const val = curve ? toValue(parseFloat(input.value)) : parseFloat(input.value);
        vOut.textContent = fmt(val);
        d.onInput(val);
      });
      row(secAtmos, d.label, input, vOut);
      dialInputs.push(input);
      if (d.id) {
        controls.push({ key: d.id,
          get: () => (curve ? toValue(parseFloat(input.value)) : parseFloat(input.value)).toFixed(4),
          set: (raw) => {
            input.value = String(curve ? toSlider(parseFloat(raw)) : parseFloat(raw));
            input.dispatchEvent(new Event('input'));
          } });
      }
    }

    for (const c of choices) {
      const sel = document.createElement('select');
      for (const o of c.options) {
        const opt = document.createElement('option');
        opt.value = String(o.value); opt.textContent = o.label;
        sel.appendChild(opt);
      }
      sel.value = String(c.value);
      sel.addEventListener('change', () => c.onChange(sel.value));
      row(secAtmos, c.label, sel);
      dialInputs.push(sel);
      if (c.id) {
        controls.push({ key: c.id, get: () => sel.value,
                        set: (v2) => { sel.value = v2; sel.dispatchEvent(new Event('change')); } });
      }
    }
    syncDials();

    // ---- share --------------------------------------------------------------
    //
    // A settings URL rather than a blob of JSON, because the scene ALREADY reads shaft,
    // dustg, dusts and exp off the query string at boot - so a pasted link restores the
    // atmosphere natively, and the panel replays its own controls on top.
    const defaults = controls.map(c => [c.key, c.get()]);

    function settingsURL() {
      const u = new URL(location.href);
      for (const c of controls) u.searchParams.set(c.key, String(c.get()));
      return u.toString();
    }
    api_settingsURL = settingsURL;

    const flash = (text, colour) => {
      copyMsg.style.color = colour;
      copyMsg.textContent = text;
      setTimeout(() => { copyMsg.textContent = ''; }, 4000);
    };

    box.querySelector('#looks-copy').addEventListener('click', async () => {
      const url = settingsURL();
      try {
        await navigator.clipboard.writeText(url);
        flash('Link copied - paste it to share this look', '#7fd18a');
      } catch {
        // Clipboard can be refused; putting it in the address bar still lets them copy it.
        history.replaceState(null, '', url);
        flash('Clipboard blocked - the link is in the address bar', '#e2725b');
      }
    });

    box.querySelector('#looks-reset').addEventListener('click', () => {
      for (const [key, value] of defaults) {
        const c = controls.find(x => x.key === key);
        if (c) c.set(value);
      }
      flash('Back to defaults', '#8b93a7');
    });

    // Replay anything in the URL that this panel owns. The scene has already consumed its
    // own params (shaft/dustg/dusts/exp) to build the dials' starting values, and `look`
    // arrives through `initial` before the passes exist - so both are skipped here.
    const q = new URLSearchParams(location.search);
    for (const c of controls) {
      if (c.key === 'look' || !q.has(c.key)) continue;
      try { c.set(q.get(c.key)); } catch { /* a stale link must not break the panel */ }
    }

    // Cycle looks with [ and ] so two can be compared without going near the panel.
    addEventListener('keydown', (e) => {
      const t = e.target.tagName;
      if (t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT') return;
      if (e.key !== '[' && e.key !== ']') return;
      const i = LOOKS.findIndex(l => l.id === current);
      const next = LOOKS[(i + (e.key === ']' ? 1 : LOOKS.length - 1)) % LOOKS.length];
      setLook(next.id);
      if (select) select.value = current;
    });
  }

  setLook(current);

  const api = {
    composer, passes, render, setSize, setLook, renderPass, setVolumetrics,
    settingsURL: () => api_settingsURL(),
    setBlend: (i) => { for (const pass of passes.values()) pass.uniforms.uBlend.value = i; return i; },
    get look() { return current; },
    get volumetrics() { return volsOn; },
    get camera() { return cameraOf(); },
    uniformsFor: (id) => passes.get(id)?.uniforms || null,
  };
  // Handle for scripted checks — thirteen fragment shaders is too many to eyeball one
  // by one, and a shader that fails to compile renders black rather than throwing.
  window.__looks = api;
  return api;
}
