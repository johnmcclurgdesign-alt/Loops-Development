# Loops — web build

Real-time browser scenes. Replaces the heavy Unreal pipeline for this line of work.

**Deliverable:** a live web page that runs forever in a browser. Not a rendered video.

**Style:** not locked. We push toward atmospheric and high-end, and stay open to both
stylized and near-photoreal on a per-loop basis. Prove a look with a test scene before
committing a whole loop to it.

---

## Repo shape

```
index.html              gallery — links to every loop
loops/<name>/index.html one self-contained scene per folder
assets/<name>/          .glb files and textures for that loop
```

One folder per loop. Each loop is self-contained so one breaking never breaks another.

## Stack

- **Three.js** from a CDN via importmap — no build step, no `node_modules`, no bundler.
- Pinned to a version in each scene's importmap. Bump deliberately, never silently.
- Deployed by **GitHub Pages** off `main`. Push, wait ~1 min, it's live.

Live: https://johnmcclurgdesign-alt.github.io/dripping-pickle/

## Running locally

Modules won't load over `file://`. Any static server works:

```bash
python -m http.server 5173
```

## Blender → web

Export **glTF 2.0 (`.glb`)** — mesh, materials, textures, animations in one file.

- **+Y up** on export (Blender is +Z up; the exporter converts, leave the default on).
- **Apply modifiers.** Nothing procedural survives the trip.
- **Bake lighting** to texture where the look depends on it. The browser has no Lumen, and
  no path tracer in the normal render path — baked light is how we get GI-looking results.
  (Caveat since 2026-08-14: `three-gpu-pathtracer` *is* a browser path tracer, but it is
  progressive and resets on any change, so it suits a converged still rather than a live
  animated loop. See HANDOFF.md — useful as ground truth against the bake, not as a swap.)
- **Principled BSDF only.** Other Blender nodes do not export. Complex shading has to
  be rebuilt as GLSL on this side — ask before relying on it.
- Keep `.glb` under ~10 MB per loop. Use Draco or Meshopt compression above that.
- Real-time shadow casters cost the most. Flag which objects genuinely need to cast.

## What carries the look

In this order — atmosphere first, geometry last:

1. **ACES tone mapping** (`renderer.toneMapping`) — biggest single quality jump.
2. **Fog** (`FogExp2`) — depth, and it hides the edge of the world.
3. **Bloom** — makes light sources read as light instead of bright paint.
4. **Light shafts** — crossed additive planes with a gradient shader. Fake, convincing.
5. **Dust motes** — `Points` with a soft radial sprite. Never leave them square.
6. **Vignette + film grain** — stops the image reading as "computer graphics".

See `loops/dust-and-light/index.html` — it is the reference implementation for all six.

## Canvas UI registry

33 WebGL effects, registered in `components.json` as `@canvas-ui`, reachable via the
shadcn MCP (`search_items_in_registries`, `view_items_in_registries`). Every effect
ships six framework builds — **always take `-vanilla`**, we have no framework.

They split into two families, and the difference decides whether one is usable:

**Object effects — built on three.js, take a GLB/glTF straight from Blender.**
This is the half that matters for loops.

| Effect            | What it does                                                        |
|-------------------|---------------------------------------------------------------------|
| `glass-object`    | refraction, chromatic dispersion, frost, tinted absorption          |
| `liquid-object`   | drags the model through a GPU fluid, chromatic fringes              |
| `particle-object` | rebuilds the model as a cursor-reactive particle cloud              |
| `ascii-object`    | renders the model as ASCII glyphs that trace its edges              |
| `dithered-object` | 1-bit Bayer / halftone / Floyd–Steinberg                            |

**Page effects** (`vhs`, `frost`, `glass`, `bend`, `peel`, `cloth`, `laser`, `grid`,
`liquid`, `ripple`, `glitch`, …) distort a live HTML page rather than a 3D scene. They
lean on the **experimental html-in-canvas Chrome API**, so they are not safe for
anything the team opens on arbitrary browsers. Site chrome only, never a loop.

Installing is manual — `shadcn add` expects a framework project with a build step.
Read the vanilla source from the registry and fit it by hand. Do not add a bundler.

## Baking lightmaps out of Blender — the traps

Learned the hard way on `loops/factory`. Every one of these fails **silently**.

**Before packing any lightmap UVs, check these three things:**

1. **`scene.tool_settings.use_uv_select_sync` must be ON.** With it off, `mesh.select_all`
   does not select UVs, so `uv.pack_islands` packs a handful of objects, leaves the rest
   stacked on top of each other, and reports success. Symptom: decals and light from one
   object appearing on a different object. Verify by rasterising island centroids into a
   grid and counting cells claimed twice — never trust the packer.
2. **`uv.average_islands_scale` measures LOCAL space, not world.** An object with scale 45
   looks 2000× smaller than it is and gets a proportionally tiny island. Either apply scale
   first, or compute world area yourself and set island scale manually. We do the latter.
3. **Islands taller than 1.0 UV unit cannot be packed.** Cylinders (pipes) smart-project
   into long thin ribbons. Clamp any object whose UV bbox exceeds ~0.85 before packing.

**Deleting a UV layer can silently change what renders.** Blender promotes another layer to
`active_render`, and materials with no UV Map node use whatever that is. We deleted
`automap` and Blender promoted **Lightmap** — so wood textures started sampling lightmap
atlas coordinates. Symptoms were "floor texture blown up" and "beam grain rotated 90°".
Always re-assert `active_render` on the texture UV after touching layers.

**Check the evaluated mesh, not just the base mesh.** Modifier evaluation can re-create UV
layers that you deleted. A third UV set pushes the lightmap from `uv1` to `uv2`, and
three.js reads `lightMap` from `uv1` — so the lightmap lands on the wrong coordinates for
those objects only.

**Solidify doubles the baked surface.** Its generated faces inherit the same UVs as the
face they came from, so a pitch-black underside bakes into the same texels as the lit top.
Remove it from floors and roofs — nothing sees the underside.

**Subsurf viewport level must equal render level.** The bake uses render, the exporter uses
viewport. Mismatched, you bake onto one surface and ship a different one.

**Objects sharing mesh data share lightmap UVs** and all bake into one island. Make every
lightmapped object single-user first.

**A blocking bake outlasts the MCP timeout.** `bpy.ops.object.bake` freezes Blender's main
thread. Set everything up from Python, then have the user press the Bake button — they get
a progress bar and a cancel, and the connection survives.

## glTF carries ONE base-colour texture per material

Any material that composites several images — a decal over brick, a mask driven by
a displacement map, a second UV set — cannot survive the export. The exporter picks
one image, drops the rest, and only warns:

> More than one shader node tex image used for a texture

The symptom is subtle: the object still renders, but with the wrong image and the
wrong alpha. Both pickle signs did this — `Base Color = Mix(pickle, brick)` and
`Alpha = Mix(pickle.alpha, ColorRamp(brick_displacement))` — so the sign quads
shipped raw brick and lit up as bright patches over the real wall.

**Fix: bake the node graph down to one RGBA texture.**

1. Bake `DIFFUSE` with `pass_filter={'COLOR'}` (no direct, no indirect) → albedo.
2. Alpha can't be baked directly. Reroute the alpha chain into **Emission Color**,
   set Emission Strength 1, and bake `EMIT` → the alpha as greyscale.
3. Combine RGB + A into one image, save as PNG with `alpha_mode = 'STRAIGHT'`.
4. At export, replace the material's graph with that single texture:
   `Color → Base Color`, `Alpha → Alpha`.

Baked sign textures live in `assets/factory/sign_*.png`. The export surgery loads
them by path — **don't delete them** or the signs revert to broken.

Check the export log for that warning after ANY material change. It is the only
signal you get.

## Loading a Blender lightmap in three.js

- `lightMap` reads **`uv1`** (glTF `TEXCOORD_1`). Confirm the lightmap is UV slot 1 on every
  object before exporting.
- **`texture.flipY = false`.** The glTF exporter already flips V; flipping again breaks it.
- Ship it as **HDR/EXR, not PNG**. The window is ~9× brighter than the floor; 8-bit clips it.
- `colorSpace = LinearSRGBColorSpace`, and bake with **Color OFF** so it multiplies over the
  albedo textures instead of replacing them.
- Strip normal/roughness/metallic on export. With no dynamic lights they do nothing, and
  their detail is already in the bake. Cut 269 megapixels to 40 that way.
- **Exposure will not match Blender.** Blender's ACES 1.3 + gamma 1.3 lifts shadows; three's
  `ACESFilmicToneMapping` is a four-line approximation with no lift. Expect to fit exposure
  by eye (we landed on 5.0 against Blender's 2.5) and to need a grading pass for the darks.

## Feedback panel

Kills the ambiguity in art-direction notes. Click an object, write a note; it
records the real Blender name, the material, the click point **in Blender
coordinates**, the camera, and a screenshot.

```bash
node tools/dev-server.mjs 5173
```

- `?dev=1` — writes notes into `feedback/notes.json` (+ `feedback/shots/`). Read
  that file at the start of a session; anything with `"status": "open"` is waiting.
- `?review=1` — same panel for the team on GitHub Pages. There's no server there,
  so **send** becomes **copy note**: it puts the note plus a deep link on the
  clipboard to paste wherever the team keeps its notes.
- Every note carries a **deep link** (`?cam=&tgt=&sel=`) that restores the exact
  camera and re-selects the object. Open it and you are looking at what they saw.

### Moving things

Reviewers can drag the scene around. **This is for visualising a suggestion, not for
editing the show** — the `.glb` is never written and the Blender file stays the single
source of truth. The point is that "move the barrel left a bit" arrives as a picture of
the barrel already moved.

- **Preview Mode / Select Mode**, or `Q` / `W`. Preview exists so a reviewer can look
  around and click things without moving anything by accident.
- **One gizmo does both.** TransformControls only has a single mode at a time, so Select
  Mode runs TWO of them on the same pivot — translate at size 0.4, rotate at 0.45 so the
  rings sit just outside the arrowheads. Rotation is red/green/blue axis rings ONLY —
  both of three's extra rotate handles are stripped. XYZE (free rotate) because its
  picker is a solid SPHERE, claiming the middle of the gizmo as a disc rather than a
  band, the one shape that cannot share space with the arrows; E (the faint yellow
  screen-space ring) as clutter. Twinmotion's manipulator has neither.
- Priority comes from listener order — the translate gizmo is constructed first and wins
  wherever both are hoverable. Whichever starts a drag disables the other for its
  duration, or the pivot delta is applied twice. Measured bands, pixels from the centre:
  **arrows 2–40, rings 42–64**.
- **The rings must stay OUTSIDE the arrows.** Seen at an angle a rotate ring projects
  across everything inside it, so an inner ring and an outer arrow cannot each own a
  clean band — tried it, rotate then shadowed the arrows out to 54px. To make the
  manipulator smaller, scale BOTH sizes together and keep the ratio; do not shrink one.
- Handles sit at the **centre of the selection**, never at an object's origin — glTF
  props keep whatever origin the artist left them, routinely nowhere near the mesh.
- **Shift-click** adds to the selection; shift-clicking a selected object drops it.
  A group drags rigidly. **Esc** or **clear** clears — *not* shift-click, which used
  to clear and no longer does.
- **Ctrl-Z / Ctrl-Shift-Z**. One step per drag, and it reaches across objects.
- Edits **survive a refresh** (localStorage, per loop) and are reapplied on load. Only
  the edits are stored, never the scene. Undo history is deliberately not persisted.
- The note carries `edits[]` — every object still off its mark, in Blender metres and
  degrees — plus `objects[]`, everything that was selected.
- **The screenshot keeps the green selection outline and drops the handles.** A note
  read six weeks later is only useful if you can see which object it was about; the
  handles are thick, occlude the thing being discussed, and say nothing once the drag
  is over. In a before/after the outline is redrawn for the rewound pose, so the box
  moves between the halves along with the object.
- Storage is per browser: a teammate opening the same URL sees the clean scene. Notes
  are how the work travels.

Two things in there are load bearing and will look like over-engineering until they
bite. **The pivot binds the selection once** (each member's pose stored relative to it,
every frame after is `pivotWorld * offset`) rather than re-measuring per drag — the
bounding box of a rotated shape is not centred on the point it was rotated about, so
re-measuring walks the handles off the object a little further with every turn.
**Restored edits are keyed by node path with the name checked**, so a re-export that
shifts node order drops that edit instead of silently dragging the wrong prop.

**glTF sanitises dots out of names.** `wall_standard_standard_01005` in a note is
`wall_standard_standard_01.005` in Blender. Convert before searching the scene.

Only the loaded glTF is selectable — light shafts, dust and sky are excluded
(`pickRoot`), since they have no Blender names and would report "(unnamed mesh)".

The dev server also sends `cache-control: no-store`, which fixes the stale-`.glb`
trap that once cost an hour of debugging a scene that had already been re-exported.

## Stylised looks

`tools/looks.js` — a post chain with a panel, bottom-left, in three sections: **Style**
(Look, Strength, Blend), **Image** (Tone, Exposure) and **Atmosphere** (Volumetrics and the
scene's dials). Collapses from its header so it gets out of the way of the thing it adjusts.

**Copy settings gives you a URL, not a JSON blob** — deliberately, because the scene already
reads `shaft`, `dustg`, `dusts` and `exp` off the query string at boot. A pasted link
restores the atmosphere natively and the panel replays its own controls on top, so sharing a
look is sharing a link. Dials and dropdowns opt in by declaring an `id`, which doubles as the
URL key; anything without one is simply not shareable. Round-trip verified across look,
strength, blend, tone, exposure, volumetrics on/off, all three dials and both blend modes. 13 looks: painterly, watercolour,
ink hatching, comic halftone, dither, outline, oil impasto, risograph, thermal, neon,
charcoal, blueprint, plus Original. `?look=<id>` preselects, `?looks=0` hides the menu for
a clean capture, `[` and `]` cycle. The bar also carries Strength, Tone mapping and
Exposure, so a look can be dialled back rather than being all-or-nothing.

**Blend mode multiplies the range.** Every look composites against the untouched scene
through a Photoshop-style mode — Normal, Multiply, Screen, Overlay, Soft/Hard light, Dodge,
Burn, Difference, Darken, Lighten, Luminosity, Colour — so 12 looks become 156 combinations.
The two worth knowing: **Luminosity** takes the style's light and keeps the scene's colour,
**Colour** does the reverse. Blending happens in DISPLAY space, not linear: a bright window
is 8.0 in linear HDR and Overlay of 8.0 is meaningless, so both sides are tone-mapped, blended,
and converted back through `toLinear()`. That is why the modes behave the way they do in
Photoshop instead of tearing in the highlights.

**Where the passes sit, and why it is not negotiable.** `RenderPass → [style] → OutputPass`.
three only tone-maps when it renders straight to the canvas — `if (currentRenderTarget ===
null)` in the renderer — so inside a composer target materials emit raw linear values and
OutputPass applies ACES + exposure at the end. Style passes therefore run on LINEAR HDR,
before ACES, which is what lets ink and halftone darken the image and still have the
windows roll off filmically instead of clipping to grey.

**Looks that decide a final colour must convert back.** Riso ink, blueprint paper and the
heat ramp are authored in display space, but OutputPass has ACES and the exposure still to
apply. `toLinear()` in the shared GLSL is an exact algebraic inverse of the ACES fit (the
curve is a ratio of quadratics, so inverting it is one quadratic solve). The first attempt
divided by exposure and multiplied by a fudge factor and those looks came out nearly flat —
riso measured a standard deviation of 7 out of 255. With the real inverse it is 27.

**Volumetrics dominate every composed look — there is a toggle.** The shafts and dust blend
additively, so through a post chain they accumulate in linear HDR and are tone-mapped as a
whole instead of per fragment at the canvas. Measured frame means with them on against off:
Original 42.8 / 30.7, Painterly 90.1 / **31.4**, Thermal 70.7 / **18.9**. In other words two
thirds of a composed look's brightness was the atmosphere, not the effect — with them off,
Painterly (31.4) sits right next to Original (30.7). Switch them off to judge a look, and to
tell "the look is doing that" from "the atmosphere is doing that". `?vol=0` starts that way.
There are also live dials for Shafts, Dust and Dust size, since the level that reads well is
per-look — a halftone screens the shafts into dots, Kuwahara smears them into haze. Shafts
alone move the frame mean from 30.8 to 74.4 across their range. That dial is capped at 0.2
rather than 0.4 and carries a `curve` of 2.2, because everything worth using lives at the
bottom: the slider now reads 0.014 at 30% of travel, 0.044 at 50% and the 0.095 default at
71%, so soft levels get most of the resolution instead of being crammed into the first fifth.
Dust is capped and curved the same way — 0 to 0.6 with a curve of 2.0, reading 0.04 at 25%
of travel, 0.15 at 50% and the 0.28 default at 68%. Opacity 1.0 was snow.
Dust size likewise, 0.002 to 0.04 curved at 2.0: its default used to sit at 19% of a linear
slider, so four fifths of the travel only made motes bigger — it now sits at 54% with real
resolution at the fine end. Shaft blend and Dust blend pick how the
atmosphere combines with what is behind it — Additive (the physical answer, and the default),
Screen, Normal, Multiply, Subtractive. Under a stylised look additive is often wrong: a
halftone wants the shafts to knock back rather than pile on. Measured frame means on the
shafts: add 42.9, screen 140.3, normal 39.5, multiply 10.3, subtractive 10.5. Screen is not a
three constant — it is `CustomBlending` with `OneFactor / OneMinusSrcColorFactor` — and
`material.needsUpdate` is required after any blending change or nothing happens. The dials
and dropdowns are passed in by the scene as `{label, …, onInput}` / `{label, options, onChange}`;
`looks.js` is shared across loops and deliberately knows nothing about what a light shaft is. Note each shaft is a CLONE of
`shaftMat`, so a setter has to write every clone's uniform — setting the original moves nothing.

**Known: bright areas over-expose in every composed look.** The sky dome and light shafts
are custom `ShaderMaterial`s that write display-referred colour, and three does not
auto-inject tone mapping into a custom shader. Rendering straight to the canvas that is
invisible; through the composer those values get ACES'd a second time at exposure 5 and the
window blows from 147 to 236. Everything else is byte-identical — three of four probe pixels
matched exactly. The real fix is adding `#include <tonemapping_fragment>` and
`<colorspace_fragment>` to those two shaders and re-fitting `SKY_GAIN` / `SHAFT_GAIN`, which
is an art-direction change, so it has been left alone. Pull the Exposure slider down to
compensate in the meantime.

`window.__looks` exposes the api for scripted checks — thirteen fragment shaders is too many
to eyeball, and a shader that fails to compile renders black rather than throwing.

## Working rules

- **Screenshot before claiming it works.** Run the local server, load the page, look at
  the image, judge it against the direction. A clean console is not evidence.
- **Palette constants at the top of every scene.** Art direction happens by changing a
  handful of named colors, not by hunting through the file.
- **Comment the intent, not the syntax.** Explain why a value is what it is.
- **Commit at every working state** so a bad experiment reverts cleanly.
- Ask before adding a dependency. The no-build-step property is worth protecting.
