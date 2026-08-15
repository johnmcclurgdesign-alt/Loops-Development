# Lighting reference

`dp_lighting_reference.png` — 2560×1600 Cycles render, 2026-08-14.

**This image is the target.** The browser build gets graded until it sits next to this.
If the Blender scene's camera or lighting changes, this render is stale and must be redone.

## How it was made

Source: `Assets_Created/DP_Factory_Warhouse.blend`

| | |
|---|---|
| Camera | `Cam_Loop_01`, 28 mm, at `(-11.42, -0.67, 0.19)` |
| Render | 2560×1600 @ 75% |
| Engine | Cycles, GPU, **OptiX** |
| Samples | 800, adaptive (noise threshold 0.01) |
| Denoise | OpenImageDenoise, Accurate prefilter, GPU |
| Max bounces | 4 |
| Caustics | off (both reflective and refractive) |
| Lighting | World only — "Bright Cloud Sky". **No light objects in the scene.** |
| View transform | **ACES 1.3**, look "Reference Gamut Compression" |
| Exposure / gamma | **2.5 / 1.3** |

## What has to be reproduced on the web side

The view transform, exposure and gamma above are **display settings**. They are not
baked into anything. The lightmap will store raw linear light, so the browser starts
from a much darker image and has to rebuild this grade by hand.

Three.js `ACESFilmicToneMapping` is a four-line approximation of ACES, not Blender's
ACES 1.3 OCIO transform. The gamma 1.3 and the gamut-compression look have no direct
equivalent at all. Expect to need a small grading pass, not just an exposure number.

## What carries this image

1. **The window shafts on the floor.** Sharp-edged, with the skylight's mullion grid
   legible in the pool of light. This is the whole shot — protect it through the bake.
   Lightmap resolution on the floor matters more than anywhere else.
2. **Warm brick against cool everything else.** The light itself is neutral-to-cool
   white, not golden. The warmth is entirely in the brick.
3. **The dark left third.** Deep, but not crushed — brick detail survives in shadow.
4. **The air is clear.** No haze, no visible dust, no volumetric beams. The light lands
   on the floor rather than travelling through the air. An open art-direction question
   for the web build: leave it clean, or add atmosphere.
