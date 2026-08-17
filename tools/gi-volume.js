// Irradiance volume — real bounce light, in the browser, with no bake in Blender.
//
// WHAT IT IS. A grid of light probes through the building. Each probe renders a tiny
// cubemap of the room from where it stands, and that cubemap is squashed down into four
// numbers per colour channel (spherical harmonics, band 1). Those numbers answer, for any
// direction you ask, "how much light arrives here facing that way". Surfaces look up the
// grid at their own position and normal and add the answer to their lighting.
//
// It is a photograph of the light in the room, taken 500 times, stored as an average and a
// direction rather than as pixels. The three.js `HemisphereLight` it replaces is the same
// idea frozen at one value for the whole world — sky above, ground below, no position, no
// colour bleed, no idea where the walls are.
//
// WHY IT MATTERS HERE. The handoff measured the gap between the real-time rig and the
// Cycles bake and found it was not the direct light — that part matches easily — but the
// darks. Uniform ambient fills exactly the corners real bounce leaves alone. A volume has
// a value per cubic metre, so a corner is dark because the probe standing in it saw walls,
// not because someone tuned a number down.
//
// MULTI-BOUNCE. Pass 0 bakes with the volume switched off, so probes see direct light only
// — that is bounce 1. Pass 1 bakes again with pass 0's result feeding the materials, so the
// probes now see direct + bounce 1, giving bounce 2. Each pass REPLACES the grid rather
// than adding to it, which is the Neumann series for the rendering equation and is why it
// converges instead of running away.
//
// COST. The bake is the expensive part (seconds, once). Sampling it afterwards is four
// 3D-texture reads per fragment and costs nothing. `serialise()` / `load()` exist so the
// bake can be done once and the result shipped as a file, which is what a published loop
// wants — GitHub Pages should not spend eight seconds baking on every visit.

import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

// ── projecting a probe cubemap onto SH ──────────────────────────────────────
// three ships this as LightProbeGenerator.fromCubeRenderTarget, and we use that as the
// reference — `verifyProjection()` below checks the two agree. But the shipped one is
// ASYNC: it calls readRenderTargetPixelsAsync per face, which polls a GPU fence on a 4 ms
// timer, so six faces cost ~25 ms of waiting per probe no matter how small the cubemap is.
// Across 1,400 probe bakes that is a minute of pure timer latency. The buffers here are
// 4 KB, so a synchronous read stalls for a fraction of that.
//
// The conventions below (face axes, the `flip` for WebGL's coordinate system, the solid
// angle weight, the 4π/totalWeight normalisation) are copied from three r169 exactly. Get
// any of them wrong and the volume is subtly the wrong brightness or mirrored, which reads
// as a grading problem rather than a maths one.
// ★ YIELDING WITH setTimeout MAKES THE BAKE LOOK LIKE A HANG.
// The bake hands control back to the browser between chunks so the tab stays alive. The
// obvious `setTimeout(0)` is clamped to ONE PER SECOND once the tab is backgrounded (or
// merely not compositing), and since a chunk is ~12 ms of work that turns a 20-second bake
// into 25 minutes — measured: 2.2% done after 35 seconds. MessageChannel is not clamped,
// so the same loop runs at full speed whether the tab is in front or not.
const _yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
function yieldToBrowser() {
  if (!_yieldChannel) return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    _yieldChannel.port1.addEventListener('message', function once() {
      _yieldChannel.port1.removeEventListener('message', once);
      resolve();
    });
    _yieldChannel.port1.start();
    _yieldChannel.port2.postMessage(0);
  });
}

const _coord = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _basis = [0, 0, 0, 0, 0, 0, 0, 0, 0];

function faceCoord(faceIndex, col, row, flip, out) {
  switch (faceIndex) {
    case 0: return out.set(-1 * flip, row, col * flip);
    case 1: return out.set(1 * flip, row, -col * flip);
    case 2: return out.set(col, 1, -row);
    case 3: return out.set(col, -1, row);
    case 4: return out.set(col, row, 1);
    default: return out.set(-col, row, -1);
  }
}

/**
 * Read a cube render target and project it onto the first `numSH` SH coefficients.
 * Writes into `outVec3s` (an array of THREE.Vector3), which is reused across probes so a
 * 1,400-probe bake does not allocate 1,400 times.
 */
function projectCubeSH(renderer, cubeRT, buf, outVec3s, numSH) {
  const flip = renderer.coordinateSystem === THREE.WebGLCoordinateSystem ? -1 : 1;
  const W = cubeRT.width;
  const pixelSize = 2 / W;
  let totalWeight = 0;

  for (let c = 0; c < numSH; c++) outVec3s[c].set(0, 0, 0);

  for (let face = 0; face < 6; face++) {
    renderer.readRenderTargetPixels(cubeRT, 0, 0, W, W, buf, face);
    for (let i = 0, px = 0; i < buf.length; i += 4, px++) {
      const r = THREE.DataUtils.fromHalfFloat(buf[i]);
      const g = THREE.DataUtils.fromHalfFloat(buf[i + 1]);
      const b = THREE.DataUtils.fromHalfFloat(buf[i + 2]);

      const col = (1 - ((px % W) + 0.5) * pixelSize) * flip;
      const row = 1 - (Math.floor(px / W) + 0.5) * pixelSize;
      faceCoord(face, col, row, flip, _coord);

      // Solid angle of this texel: pixels at a cube face's corner cover less sky than
      // pixels at its centre, and weighting them equally tilts the whole result.
      const lenSq = _coord.lengthSq();
      const weight = 4 / (Math.sqrt(lenSq) * lenSq);
      totalWeight += weight;

      _dir.copy(_coord).normalize();
      THREE.SphericalHarmonics3.getBasisAt(_dir, _basis);
      for (let c = 0; c < numSH; c++) {
        const w = _basis[c] * weight;
        outVec3s[c].x += w * r;
        outVec3s[c].y += w * g;
        outVec3s[c].z += w * b;
      }
    }
  }

  const norm = (4 * Math.PI) / totalWeight;
  for (let c = 0; c < numSH; c++) outVec3s[c].multiplyScalar(norm);
}

// Band-1 spherical harmonics: 4 coefficients (1 constant + 3 directional) x RGB.
// Band 2 would be 9 and visibly better on hard creases, but it needs nine 3D textures
// against four and diffuse bounce is smooth by nature — the constant and the direction
// carry almost all of it. This is the same trade every engine that shipped "light probes"
// made before it could afford a full irradiance field.
const NUM_SH = 4;

// three's own irradiance evaluation, trimmed to band 1. These constants are not arbitrary:
// they are the cosine-lobe convolution that turns radiance coefficients into irradiance,
// and they MUST match `shGetIrradianceAt` in three's bsdfs.glsl or the volume will be
// subtly the wrong brightness against every other light in the scene.
const SH_GLSL = /* glsl */`
  vec3 giSHIrradiance( vec3 n, vec3 c0, vec3 c1, vec3 c2, vec3 c3 ) {
    vec3 r = c0 * 0.886227;
    r += c1 * ( 2.0 * 0.511664 * n.y );
    r += c2 * ( 2.0 * 0.511664 * n.z );
    r += c3 * ( 2.0 * 0.511664 * n.x );
    return r;
  }
`;

export function createGIVolume({
  renderer,
  scene,
  bounds,                 // THREE.Box3 covering the space to light
  spacing = 2.0,          // metres between probes
  cubeSize = 16,          // probe cubemap resolution per face
  maxProbes = 6000,
} = {}) {

  // WebGL2 gives sampler3D and linear filtering of half-float for free. three r163+ is
  // WebGL2-only so this should never fire, but a volume that silently renders black is
  // worse than one that says why.
  const caps = renderer.capabilities;
  if (!caps.isWebGL2 && !renderer.isWebGPURenderer) {
    console.warn('[gi] no WebGL2 — irradiance volume disabled');
    return null;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const dims = new THREE.Vector3(
    Math.max(2, Math.ceil(size.x / spacing) + 1),
    Math.max(2, Math.ceil(size.y / spacing) + 1),
    Math.max(2, Math.ceil(size.z / spacing) + 1),
  );
  // A grid is cubic in cost. Back off uniformly rather than clipping one axis, or the
  // volume gets anisotropic and bounce reads as banding along whichever axis lost.
  let count = dims.x * dims.y * dims.z;
  while (count > maxProbes) {
    dims.set(Math.max(2, dims.x - 1), Math.max(2, dims.y - 1), Math.max(2, dims.z - 1));
    const next = dims.x * dims.y * dims.z;
    if (next === count) break;
    count = next;
  }
  const probeCount = dims.x * dims.y * dims.z;

  // Probe SPACING is derived back from the final dims, because the grid spans the bounds
  // exactly — the corner probes sit ON the faces, not half a cell inside.
  const step = new THREE.Vector3(
    size.x / Math.max(1, dims.x - 1),
    size.y / Math.max(1, dims.y - 1),
    size.z / Math.max(1, dims.z - 1),
  );

  // ── storage ────────────────────────────────────────────────────────────────
  // One RGBA half-float 3D texture per SH coefficient. Half rather than full float
  // because linear filtering of RGBA32F is an optional extension, while RGBA16F
  // filtering is core WebGL2 — and trilinear filtering is the entire point of a volume.
  const data = [];
  const textures = [];
  for (let i = 0; i < NUM_SH; i++) {
    const buf = new Uint16Array(probeCount * 4);
    const tex = new THREE.Data3DTexture(buf, dims.x, dims.y, dims.z);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.HalfFloatType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;   // these are coefficients, not colours to convert
    tex.needsUpdate = true;
    data.push(buf);
    textures.push(tex);
  }

  // Half a texel in each axis. Sampling the volume at exactly 0 or 1 makes trilinear reach
  // for a neighbour that does not exist; clamped to edge that is harmless in the middle of
  // a grid and wrong at the boundary, where it flattens the gradient against the wall.
  const halfTexel = new THREE.Vector3(
    0.5 / dims.x, 0.5 / dims.y, 0.5 / dims.z);

  const uniforms = {
    giSH0: { value: textures[0] },
    giSH1: { value: textures[1] },
    giSH2: { value: textures[2] },
    giSH3: { value: textures[3] },
    giBoundsMin:  { value: bounds.min.clone() },
    giBoundsSize: { value: size.clone() },
    giHalfTexel:  { value: halfTexel },
    giIntensity:  { value: 1.0 },
    // Push the lookup along the surface normal before sampling. Probes that ended up
    // inside a wall are black, and a surface sampling its own wall picks them up as a
    // dark smear; stepping out along the normal reads the probe in the room instead.
    // This is the single control that decides between light leaking through walls (too
    // high) and dark rims on every surface (too low). Grid-spacing-relative by default.
    giNormalBias: { value: Math.max(step.x, step.y, step.z) * 0.55 },
  };

  // ── material patch ─────────────────────────────────────────────────────────
  const patched = new WeakSet();

  function patch(material) {
    if (!material || patched.has(material)) return;
    patched.add(material);

    // Chain rather than assign. PCSS installs an onBeforeCompile on these same materials,
    // and whichever ran second would otherwise erase the other — which reads as "the GI
    // works but the shadows are hard", or the reverse, depending on load order.
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGIWorldPos;')
        // AFTER project_vertex, `transformed` is final object space — morph targets and
        // skinning have already been applied to it. Reading it earlier would light the
        // bind pose. (InstancedMesh would still need instanceMatrix here; there is none
        // in this scene.)
        .replace('#include <project_vertex>',
                 '#include <project_vertex>\n\tvGIWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vGIWorldPos;
          uniform sampler3D giSH0, giSH1, giSH2, giSH3;
          uniform vec3 giBoundsMin, giBoundsSize, giHalfTexel;
          uniform float giIntensity, giNormalBias;
          ${SH_GLSL}
          vec3 giVolume( vec3 wpos, vec3 wn ) {
            vec3 uvw = ( wpos + wn * giNormalBias - giBoundsMin ) / giBoundsSize;
            uvw = clamp( uvw, giHalfTexel, 1.0 - giHalfTexel );
            vec3 c0 = texture( giSH0, uvw ).rgb;
            vec3 c1 = texture( giSH1, uvw ).rgb;
            vec3 c2 = texture( giSH2, uvw ).rgb;
            vec3 c3 = texture( giSH3, uvw ).rgb;
            // Band-1 SH can ring negative on the dark side of a strong gradient. Left
            // alone that subtracts light and punches black holes in shadowed geometry.
            return max( giSHIrradiance( wn, c0, c1, c2, c3 ), vec3( 0.0 ) ) * giIntensity;
          }`)
        // lights_fragment_maps is where the lightmap and light probes are added to
        // `irradiance`, and lights_fragment_end consumes it — so this is the one spot
        // that reaches diffuse indirect without touching direct light or specular.
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
          #if defined( RE_IndirectDiffuse )
            irradiance += giVolume( vGIWorldPos, inverseTransformDirection( geometryNormal, viewMatrix ) );
          #endif`);
    };
    // Without this, three reuses a cached program from an unpatched material with the
    // same feature set and the volume silently does nothing on some meshes.
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = function () {
      return (prevKey ? prevKey.call(this) : '') + '|gi-volume-v1';
    };
    material.needsUpdate = true;
  }

  // ── bake ───────────────────────────────────────────────────────────────────
  const cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
    type: THREE.HalfFloatType,        // the sky through a window is far above 1.0
    format: THREE.RGBAFormat,         // readRenderTargetPixels needs RGBA
    colorSpace: THREE.LinearSRGBColorSpace,
    generateMipmaps: false,
  });
  // far must clear the sky dome or probes see a hole where the sky should be; near must
  // be small or a probe standing close to a wall clips through it and sees the far side.
  const cubeCam = new THREE.CubeCamera(0.05, 1000, cubeRT);

  const probePos = new THREE.Vector3();
  // Reused across every probe — a bake is thousands of iterations and these would
  // otherwise be thousands of allocations feeding the garbage collector mid-render.
  const shOut = Array.from({ length: NUM_SH }, () => new THREE.Vector3());
  const readBuf = new Uint16Array(cubeSize * cubeSize * 4);
  let baking = false;

  /**
   * Check our fast synchronous projector against three's shipped one on the CURRENT probe
   * cubemap. Returns the largest absolute difference per coefficient. Anything above ~1e-3
   * means a convention drifted and the volume's brightness cannot be trusted.
   */
  async function verifyProjection() {
    projectCubeSH(renderer, cubeRT, readBuf, shOut, NUM_SH);
    const ref = await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeRT);
    return shOut.map((v, c) => ({
      coeff: c,
      ours: v.toArray().map((n) => +n.toFixed(5)),
      three: ref.sh.coefficients[c].toArray().map((n) => +n.toFixed(5)),
      maxDiff: +Math.max(
        Math.abs(v.x - ref.sh.coefficients[c].x),
        Math.abs(v.y - ref.sh.coefficients[c].y),
        Math.abs(v.z - ref.sh.coefficients[c].z)).toFixed(6),
    }));
  }

  function probeWorldPos(ix, iy, iz, out) {
    return out.set(
      bounds.min.x + ix * step.x,
      bounds.min.y + iy * step.y,
      bounds.min.z + iz * step.z,
    );
  }

  function uploadAll() {
    for (const t of textures) t.needsUpdate = true;
  }

  /**
   * @param {object}   o
   * @param {number}   o.bounces  how many times light is allowed to bounce (1 = direct only)
   * @param {Object3D[]} o.exclude objects hidden during the bake — additive fakes like the
   *                     light shafts and dust would be integrated as if they were real light
   * @param {function} o.onProgress ({done, total, bounce}) => void
   * @param {number}   o.budgetMs  probe work per chunk; the bake yields between chunks so
   *                     the tab stays answerable instead of hanging for ten seconds
   */
  async function bake({ bounces = 2, exclude = [], onProgress = null, budgetMs = 12 } = {}) {
    if (baking) return;
    baking = true;

    const hidden = exclude.map((o) => [o, o.visible]);
    for (const [o] of hidden) o.visible = false;

    // ★ THE SINGLE BIGGEST COST IN THE BAKE, AND IT IS INVISIBLE.
    // Every renderer.render() re-renders the shadow map, and a probe is SIX renders. At
    // 800 probes x 2 bounces that is 9,600 shadow passes over the whole building at
    // 4096x4096 — minutes of work for an answer that never changes, because the sun does
    // not move during a bake. Render it once and reuse it: autoUpdate off, needsUpdate on
    // for the first frame only. Without this the bake looks like an infinite hang.
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    // Probes must not see the sky dome's own tone-mapped brightness through the composer,
    // and must not see themselves — but they DO need to see the sky through the windows,
    // which is where most of this room's light comes from. So the sky stays.
    const prevIntensity = uniforms.giIntensity.value;
    const t0 = performance.now();

    try {
      for (let b = 0; b < bounces; b++) {
        // Pass 0 sees no volume at all, so it captures direct light only. Later passes
        // read the previous pass, which is what turns this into multi-bounce.
        uniforms.giIntensity.value = b === 0 ? 0 : 1;

        let i = 0;
        let chunkStart = performance.now();
        for (let iz = 0; iz < dims.z; iz++) {
          for (let iy = 0; iy < dims.y; iy++) {
            for (let ix = 0; ix < dims.x; ix++, i++) {
              probeWorldPos(ix, iy, iz, probePos);
              cubeCam.position.copy(probePos);
              cubeCam.updateMatrixWorld(true);
              cubeCam.update(renderer, scene);

              projectCubeSH(renderer, cubeRT, readBuf, shOut, NUM_SH);

              const o = i * 4;
              for (let c = 0; c < NUM_SH; c++) {
                data[c][o + 0] = THREE.DataUtils.toHalfFloat(shOut[c].x);
                data[c][o + 1] = THREE.DataUtils.toHalfFloat(shOut[c].y);
                data[c][o + 2] = THREE.DataUtils.toHalfFloat(shOut[c].z);
                data[c][o + 3] = 0;
              }

              if (performance.now() - chunkStart > budgetMs) {
                if (onProgress) onProgress({ done: i + 1, total: probeCount, bounce: b + 1, bounces });
                await yieldToBrowser();
                chunkStart = performance.now();
              }
            }
          }
        }
        // Only upload once the whole pass is written, so a pass never reads a grid that
        // is half this bounce and half the last one.
        uploadAll();
        if (onProgress) onProgress({ done: probeCount, total: probeCount, bounce: b + 1, bounces });
      }
    } finally {
      uniforms.giIntensity.value = prevIntensity;
      for (const [o, v] of hidden) o.visible = v;
      renderer.shadowMap.autoUpdate = prevAuto;
      renderer.shadowMap.needsUpdate = true;   // the live camera needs a fresh one
      baking = false;
    }

    return { probes: probeCount, ms: Math.round(performance.now() - t0) };
  }

  // ── persistence ────────────────────────────────────────────────────────────
  // A published loop should not re-bake on every page load. Bake once with ?gibake=1,
  // save this blob next to the .glb, and ship it.
  function serialise() {
    const header = { dims: dims.toArray(), min: bounds.min.toArray(), size: size.toArray(), numSH: NUM_SH };
    const json = new TextEncoder().encode(JSON.stringify(header));
    const pad = (4 - (json.length % 4)) % 4;
    const out = new Uint8Array(4 + json.length + pad + NUM_SH * probeCount * 8);
    new DataView(out.buffer).setUint32(0, json.length + pad, true);
    out.set(json, 4);
    let off = 4 + json.length + pad;
    for (let c = 0; c < NUM_SH; c++) {
      out.set(new Uint8Array(data[c].buffer), off);
      off += data[c].byteLength;
    }
    return out;
  }

  function load(buffer) {
    const u8 = new Uint8Array(buffer);
    const jsonLen = new DataView(u8.buffer, u8.byteOffset).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + jsonLen)).replace(/\0+$/, ''));
    if (header.dims.join(',') !== dims.toArray().join(',')) {
      console.warn('[gi] cached volume does not match this grid — re-bake');
      return false;
    }
    let off = 4 + jsonLen;
    for (let c = 0; c < NUM_SH; c++) {
      data[c].set(new Uint16Array(u8.buffer.slice(u8.byteOffset + off, u8.byteOffset + off + data[c].byteLength)));
      off += data[c].byteLength;
    }
    uploadAll();
    return true;
  }

  function dispose() {
    for (const t of textures) t.dispose();
    cubeRT.dispose();
  }

  return {
    dims, probeCount, step, bounds, uniforms, textures,
    patch, bake, serialise, load, dispose, verifyProjection,
    get baking() { return baking; },
    setIntensity: (v) => { uniforms.giIntensity.value = v; },
    setNormalBias: (v) => { uniforms.giNormalBias.value = v; },
    probeWorldPos: (ix, iy, iz) => probeWorldPos(ix, iy, iz, new THREE.Vector3()),
  };
}
