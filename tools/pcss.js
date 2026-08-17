// PCSS — shadows whose softness comes from the scene instead of from a slider.
//
// WHAT IT IS. Percentage-Closer Soft Shadows. A real shadow is sharp where the object
// touches the floor and blurry further away, because the light source has a SIZE: stand a
// chair leg on the ground and its contact point is crisp, while the shadow of the seat a
// metre up is soft. Every shadow map in three is uniformly blurry instead — one radius for
// the whole map — so contact points float and nothing sits down.
//
// HOW IT WORKS, in three steps, all inside the fragment shader:
//   1. BLOCKER SEARCH. Look around in the shadow map and find the things between this
//      point and the sun. Average how far away they are.
//   2. PENUMBRA SIZE. The further the blocker is from the receiver, the wider the blur —
//      it is a similar-triangles problem, with the light's angular size as the ratio.
//   3. FILTER. Do the usual shadow comparison, but over a disc of exactly that width.
//
// WHY IT MATTERS HERE. This room is lit through a 7.4 x 2.1 m roof aperture. That is an
// enormous source, so its shadows should be very soft high up and still crisp at the
// floor. A fixed radius has to pick one or the other. The previous rig used VSM at radius
// 2.5, which is the "pick one" compromise — this replaces it.
//
// COST. The shadow map must store DEPTH, so the renderer has to be on PCFShadowMap;
// VSMShadowMap packs moments instead and PCSS cannot read it. Set that in the scene.
//
// THIS PATCHES A three.js SHADER CHUNK. That is pinned-version territory: `getShadow` in
// r169 is matched by an exact string. If three is bumped and shadows go hard-edged, this
// is the first place to look — `install()` throws rather than failing silently.

import * as THREE from 'three';

const uniforms = {
  // tan of the sun's angular RADIUS. The real sun is ~0.0046; this scene's light is a
  // skylight the size of a bus, so the useful range here is one to two orders larger.
  pcssSunTan:       { value: 0.055 },
  // metres spanned by the shadow camera's ortho box, and by its near..far range. Needed
  // to turn a depth difference into metres and a penumbra in metres back into UV.
  pcssFrustumWidth: { value: 18.0 },
  pcssDepthRange:   { value: 33.0 },
  // hard ceiling on the filter radius in UV. Without it a blocker seen at a grazing angle
  // asks for a 40-texel blur and the shadow map runs out of resolution as banding.
  pcssMaxRadiusUV:  { value: 0.035 },
};

const PCSS_GLSL = /* glsl */`
#ifdef USE_PCSS
  uniform float pcssSunTan, pcssFrustumWidth, pcssDepthRange, pcssMaxRadiusUV;

  // Vogel disc: golden-angle spiral, evenly covers a disc for any tap count, and needs no
  // lookup table. phi rotates it per pixel, which turns the ring pattern you would
  // otherwise see into noise the eye reads as grain.
  // (No backticks in here — this whole block is a JS template literal and one would
  //  close it, giving a syntax error that points at the next GLSL word instead.)
  vec2 pcssDisc( int i, int n, float phi ) {
    float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
    float theta = float( i ) * 2.39996323 + phi;
    return vec2( cos( theta ), sin( theta ) ) * r;
  }

  // interleaved gradient noise — one multiply-fract, stable under motion
  float pcssNoise( vec2 p ) {
    return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
  }

  float pcssShadow( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord ) {
    vec2 uv = shadowCoord.xy;
    float z = shadowCoord.z;
    float phi = pcssNoise( gl_FragCoord.xy ) * 6.2831853;
    float texel = 1.0 / shadowMapSize.x;

    // 1. BLOCKER SEARCH. Search wide enough to find a blocker that would cast the widest
    //    penumbra we allow, but no wider — every extra UV here is wasted taps.
    float searchUV = clamp( pcssSunTan * pcssDepthRange * 0.5 / pcssFrustumWidth,
                            texel, pcssMaxRadiusUV );
    float sum = 0.0, count = 0.0;
    // The centre tap matters and the Vogel disc does not include it: its innermost sample
    // sits at sqrt(0.5/N) of the radius. Right where an object meets the floor the ONLY
    // blocker is directly overhead, so without this the search can step straight over it.
    float dc = unpackRGBAToDepth( texture2D( shadowMap, uv ) );
    if ( dc < z ) { sum += dc; count += 1.0; }
    for ( int i = 0; i < PCSS_BLOCKER_TAPS; i ++ ) {
      float d = unpackRGBAToDepth( texture2D( shadowMap, uv + pcssDisc( i, PCSS_BLOCKER_TAPS, phi ) * searchUV ) );
      if ( d < z ) { sum += d; count += 1.0; }
    }
    // ★ NO BLOCKER FOUND DOES NOT MEAN FULLY LIT, AND ASSUMING IT DOES DRAWS A BRIGHT LINE
    //   ALONG EVERY CONTACT EDGE.
    //   The search compares against a BIASED depth, and where a wall meets the floor the
    //   blocker sits at almost exactly the receiver's own depth — so the d < z test fails
    //   by a hair, the search reports nothing, and this returns 1.0 for a band of floor that
    //   should be in shadow. Measured on the wall/floor junction: that band read 146
    //   against 64 with the sun off, while every other pixel in the column was identical
    //   with the sun on or off. It looks exactly like light leaking through the wall,
    //   which sends you hunting shadow bias — and bias does nothing, because this is a
    //   logic error, not a precision one.
    //   Falling back to the plain depth comparison costs one tap in the rare case and is
    //   what stock three would have done anyway.
    if ( count < 1.0 ) return texture2DCompare( shadowMap, uv, z );

    // 2. PENUMBRA. Similar triangles: the gap between blocker and receiver, times the
    //    angular size of the source. Depth is linear in an ortho projection, so the gap
    //    converts to metres with a single multiply.
    float gap = max( z - sum / count, 0.0 ) * pcssDepthRange;
    float radiusUV = clamp( gap * pcssSunTan / pcssFrustumWidth, texel * 0.5, pcssMaxRadiusUV );

    // 3. FILTER at that radius.
    float lit = 0.0;
    for ( int i = 0; i < PCSS_PCF_TAPS; i ++ ) {
      lit += texture2DCompare( shadowMap, uv + pcssDisc( i, PCSS_PCF_TAPS, phi ) * radiusUV, z );
    }
    return lit / float( PCSS_PCF_TAPS );
  }
#endif
`;

let installed = false;

/**
 * Splice PCSS into three's shadow chunk. Idempotent; safe to call more than once.
 * Only materials passed to `patch()` actually take the new path — everything else keeps
 * stock three behaviour, so this cannot quietly change an unrelated scene.
 */
export function install() {
  if (installed) return;

  const src = THREE.ShaderChunk.shadowmap_pars_fragment;

  // Two exact anchors from r169. If either moves, fail loudly — a silent miss here looks
  // exactly like "PCSS is on and does nothing", which is an hour of staring at shadows.
  const FN_ANCHOR = 'float getShadow( sampler2D shadowMap,';
  const BRANCH_ANCHOR = 'if ( frustumTest ) {\n\t\t#if defined( SHADOWMAP_TYPE_PCF )';
  if (!src.includes(FN_ANCHOR) || !src.includes(BRANCH_ANCHOR)) {
    throw new Error('[pcss] three.js shadow chunk does not match r169 — patch needs updating');
  }

  THREE.ShaderChunk.shadowmap_pars_fragment = src
    // helpers go above getShadow, where texture2DCompare and unpackRGBAToDepth already exist
    .replace(FN_ANCHOR, PCSS_GLSL + '\n\t' + FN_ANCHOR)
    // turn the existing PCF branch into the fallback, with PCSS taking priority
    .replace(BRANCH_ANCHOR,
      'if ( frustumTest ) {\n' +
      '\t\t#ifdef USE_PCSS\n' +
      '\t\t\tshadow = pcssShadow( shadowMap, shadowMapSize, shadowCoord );\n' +
      '\t\t#elif defined( SHADOWMAP_TYPE_PCF )');

  installed = true;
}

/**
 * Opt one material into PCSS. Chains onto any existing onBeforeCompile (the GI volume
 * installs one too) rather than overwriting it — last patch wins is a very quiet bug.
 */
export function patch(material, { blockerTaps = 16, pcfTaps = 24 } = {}) {
  if (!material || material.userData.__pcss) return;
  material.userData.__pcss = true;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    // The defines must land before <shadowmap_pars_fragment> is included, and <common>
    // is the first include in every lit material — so this is the reliable spot.
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      `#define USE_PCSS\n#define PCSS_BLOCKER_TAPS ${blockerTaps}\n#define PCSS_PCF_TAPS ${pcfTaps}\n#include <common>`);
  };

  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : '') + `|pcss-${blockerTaps}-${pcfTaps}`;
  };
  material.needsUpdate = true;
}

/**
 * Keep the shader's idea of the shadow frustum in step with the light. Call after any
 * change to the shadow camera — the penumbra maths is in metres and silently wrong if
 * the ortho box is re-fitted without telling it.
 */
export function configureFromLight(light) {
  const c = light.shadow.camera;
  uniforms.pcssFrustumWidth.value = Math.max(c.right - c.left, c.top - c.bottom);
  uniforms.pcssDepthRange.value = c.far - c.near;
}

export const pcssUniforms = uniforms;
export const setSunAngle = (tan) => { uniforms.pcssSunTan.value = tan; };
export const setMaxRadius = (uv) => { uniforms.pcssMaxRadiusUV.value = uv; };
