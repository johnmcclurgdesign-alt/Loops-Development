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

### ★ There are TWO loops. Both are live.

| loop | what it is |
|---|---|
| `loops/factory-rt/` | **the factory.** Live GI, raymarched shafts, `?mode=baked` for the bake. |
| `loops/cat-sequencer/` | the cat's workshop. Was `loops/cat-test/` until 2026-08-17. |

**`loops/factory/` and `loops/dust-and-light/` were DELETED on 2026-08-17** — both were the old
card-shaft generation, superseded by the raymarched pass in `tools/volumetrics.js`. If you find a
reference to either, it is stale; fix it rather than recreating the folder. **The tell is
card-based volumetrics: a scene that builds light shafts out of quads is from before that line.**
`grep -rc "shaftMat\|shaftPlanes" loops/` must read **0** everywhere.

Nothing was lost by deleting them. `factory-rt` already renders the Blender bake under
`?mode=baked` and loads the same `assets/factory/lightmap_4k.hdr`, so the whole lightmap section
below still applies — and `git show 8a17175:loops/factory/index.html` has the old file if the card
implementation is ever wanted. The 16 feedback notes were re-pointed at `factory-rt` first; the 8
that were originally taken in the baked loop carry `origin_loop` so their screenshots aren't
mistaken for the real-time look.

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

## Unreal → web (the cat)

The cat comes from Unreal, not Blender — `/Game/Cat_Simple/` in `Loops_PickleFactory`, the $30
Fab "Cats – Simple" pack. UE 5.8 ships a glTF exporter, so there is no Blender round-trip:
`unreal.GLTFSkeletalMeshExporter` for the mesh, `unreal.GLTFAnimSequenceExporter` per clip,
driven by `unreal.AssetExportTask`.

- **Exporting a SkeletalMesh does NOT include its animations, even with
  `export_animation_sequences=True`.** The probe export reported success and contained
  `animations 0`. Every clip must be its own export, and each one needs
  `export_preview_mesh=False` or it ships another copy of the 5.8 MB cat.
  Result: `cat.glb` + one small `anim_<name>.glb` per clip (~70–330 KB each), loaded in
  parallel and fed to a single `AnimationMixer`.
- **`export_uniform_scale` defaults to 0.01, which is already correct** (Unreal centimetres →
  glTF metres). Leave it. The check that it worked is the model's bounding box: the cat reads
  0.14 × 0.45 × 0.78 m, and a wrong scale reads ~45 or ~0.005.
- **Bone names survive the trip identically**, so a clip exported from one asset binds to a
  mesh exported from another — 51/51 joints matched here with zero mismatches. Verify it before
  building anything on top: a name mismatch fails silently as a cat that simply never moves.
- **Take the `_IP` (in-place) clips, never `_RM`.** Root motion makes the clip travel, and the
  steering system is already moving the body — you get double speed, which reads as the feet
  being wrong rather than the obvious "there are two movement systems".
- **No turn clips.** A fixed-length turn animation fights continuous steering; that pairing is
  what produced the Unreal cat's wall-walking. The body rotates under the walk cycle instead.
- Skinned meshes need `frustumCulled = false` — the bounds are computed from the bind pose and
  do not follow the bones, so the cat vanishes at certain camera angles.
- `Box3.setFromObject` on a skinned mesh also reports the BIND pose. To measure the animated
  pose, walk the bones' world positions instead.
- The textures are the whole file, not the geometry: base colour 1.8 MB, normal 2.4 MB, ORM
  1.1 MB out of 5.8 MB. Strip with `tools/glb-strip.mjs` (below); the cat ships without ORM.
- **★ UNREAL PACKS OCCLUSION/ROUGHNESS/METALLIC INTO ONE IMAGE AND WIRES IT TO TWO SLOTS** —
  both `metallicRoughnessTexture` and `occlusionTexture` point at `T_Cat_Metallic_Linear`. Drop
  one slot and the image survives on the other, the file comes back the **same size**, and it
  reads as the tool being broken. `--drop metallicRoughness,occlusion` is what actually removes
  it (5.79 → 4.66 MB). Losing it costs a little roughness variation and AO along with the
  metal; if the fur ever looks plasticky, that is the thing to put back.
- **Removing a glTF image is not a delete.** Accessors and images index a shared `bufferViews`
  list, so dropping one shifts every index after it. `tools/glb-strip.mjs` rebuilds the BIN
  chunk from only the referenced views and remaps everything, rather than orphaning the bytes.
  It must be re-run after **every** re-export.
- **Dropping `metallicRoughnessTexture` without setting `metallicFactor = 0` makes it worse.**
  glTF defaults that factor to 1.0, so removing the texture renders the cat as chrome.
- **21 clips cost 4.0 MB — animation is not free.** Long idles are the expensive ones (7.5 s =
  412 KB). The full set is 9.9 MB against a ~10 MB budget; the next lever is the 2.4 MB normal
  map, which is real quality on a dynamically lit character, so weigh it rather than reflexively
  cutting.
- **There are SIX coats, not twelve.** The pack ships `T_Cat_BaseColor_1..6` at 2048 and
  `T_Cat_BaseColor_M_1..6` at **512** — the same six coats at a lower resolution, not six more.
  Mean colours match pairwise (c5 `140,106,77` vs m5 `140,104,77`) and downscaling ours to 512
  gives 34–39 dB PSNR against theirs. The `_M_` set is not shipped.
- **Fur is loaded as external JPEGs, and stripped from the .glb** (`--drop baseColor`) so there
  is one source of truth and the export does not pin the default. 6 × 1024 JPEG = 1.2 MB, which
  is *less than the single base colour the .glb used to carry*. An externally loaded base colour
  needs **`flipY = false`** (glTF UVs are top-left origin; `GLTFLoader` sets this for embedded
  textures, a separately loaded one does not get it and the fur comes out mirrored) and
  **`colorSpace = SRGBColorSpace`** (linear renders pale and washed out). Verify by loading a
  glb that still has the texture embedded and comparing what `GLTFLoader` set — do not eyeball it.
  Also `map.dispose()` before reassigning, or every swap leaks a texture.
- **UE's glTF exporter downsizes textures on the way out.** The source is 2048 but the image
  embedded in the .glb decodes to **1024**, so matching 1024 externally costs no quality at all.
  Read the decoded `image.width`, not the source asset's resolution.
- **Check a rest chain has a way OUT.** The first export shipped `Lie_belly_start/loop/sleep` and
  no `Lie_belly_end`, so he could lie down and fall asleep but never stand up. The pack names
  `_start` / `_loop_N` / `_end` consistently — take the whole chain or the state machine dead-ends.

## Steering the cat — Yuka

`loops/cat-sequencer/` drives him with [Yuka](https://github.com/Mugen87/yuka) 0.7.8 off jsDelivr,
straight into the importmap — MIT, zero dependencies, no build step. Yuka decides **where he
goes**; the `AnimationMixer` decides **how his legs move**. The only thing crossing between them
is travel speed → clip playback rate.

**★ A CAT CHANGES DIRECTION, NOT PACE — and you have to impose that.** It does not rotate on the
spot; it keeps walking and arcs round until it is facing the new way. Steering gives you a force
vector, and part of that vector points *along* the velocity, so it brakes as well as turns. When
the leash fired, speed fell 0.45 → 0.07 m/s and the heading at the bottom of that is noise, so he
stopped and spun: **367 pivot frames in five minutes**. The fix is to use steering for its
DIRECTION only — hold a `travelDir` across frames, move it toward what steering asked for by at
most `maxTurnRate * dt`, and rebuild the velocity at a constant speed. The path radius is then
`speed / turnRate` by construction. Measured after: 0 pivot frames, tightest arc 0.55 m against
0.55 configured, peak turn 46.9°/s against a 46.9 cap, slip (facing vs moving) 0.0°.

**Set an arc RADIUS in metres, never a force or a turn speed.** Everything derives from it:
`maxForce = v²/r`, `maxTurnRate = v/r`. Setting force directly is how you get a pivot — `maxForce`
of 4 at 0.45 m/s is a 5 cm turning circle.

**★ `steering.add()` ORDER IS PRIORITY. It is not a weighted average.** Yuka walks the behaviours
in the order they were added and gives each whatever force budget remains under `maxForce`, so the
first one can consume the lot. With wander added before the leash, the leash was starved no matter
what weight it carried — he reached 20.7 m from a 5 m circle and spent 46% of five minutes past
10 m. Add the constraint FIRST and leave it inert (weight 0) where it should not apply.

**Weights multiply raw forces, and those raw forces are nowhere near the same size.**
`WanderBehavior`'s is roughly its `distance` (5), `SeekBehavior`'s about `2 × maxSpeed` (0.9). A
seek weight of 10 still loses to a wander weight of 1. Compare forces, never weights.

**A circular leash is always SOFT.** He cannot turn tighter than the arc radius, so he must
overshoot, and the moment he crosses back inside the leash releases. A 5 m leash measured an 8.7 m
roam; raising the gain 0.8 → 4 moved the maximum only 9.4 → 8.7 m, because the turn rate binds,
not the pull. Size the circle for where you want him, not where you want the fence.

**`WanderBehavior` picks its target on a SPHERE**, so it will steer a ground animal up into the
air. Pin `position.y` and `velocity.y` every frame.

**`setRenderComponent` needs `object.matrixAutoUpdate = false`.** Left on, three recomposes
`.matrix` from position/quaternion every frame and silently discards everything Yuka wrote — the
cat animates perfectly on the spot and never moves an inch.

**Start the vehicle with a non-zero velocity.** From a dead stop there is no heading to face, so
the body snaps to whatever steering picks first: measured 522°/s over the opening frames against a
47°/s cap, then clean forever after.

**★ LOW `jitter` DOES NOT READ AS CALM — it reads as driving in circles.** Yuka's wander target
random-walks around a small sphere, and the *sign* of the steer only flips when that target crosses
the centre line. At jitter 2 the crossing takes most of a minute, so he holds one turn direction
and loops: measured over five minutes, the worst single sweep was **597°** — a circle and a half —
with a median sweep of 117°. At jitter 9 that is 232° worst / 7° median, and turns come out even
(48 left, 41 right). Default is 9.

**Do not widen `radius`/`distance` to get a livelier walk — it makes the circling worse.** That
ratio sets the maximum steer angle (`atan(1/5)` = 11° here); opening it parks the steer target
further off-centre so it takes *longer* to cross back. Worst sweep went 232° at radius 1 → 699° at
radius 2 → 784° at radius 3. Restlessness is the jitter's job. Leave radius 1 / distance 5.

**Wander's force magnitude is CONSTANT** (`≈ sqrt(distance² + radius²)`, ~5) — only its direction
varies, and it is always far above `maxForce`, so it is always truncated. Do not expect a
"gentle" wander by tuning its magnitude; there isn't one to tune.

**The arc dial needs a `curve`, because turn rate is `speed / radius` — a reciprocal.** On a linear
0.2–2.5 slider the 0.55 default sat at **15%** of travel and the top two thirds all looked
identical. `curve: 2.2` (the same value the shafts dial in `looks.js` uses, for the same reason)
puts it at 43% and gives 0.2–0.7 — where the character of the turn actually changes — about half
the travel. Reuse the `looks.js` dial contract rather than inventing a second scheme: input runs
0..1, `value = min + (max-min) * t^curve`.

**Foot skate is one number.** Clip rate = travel speed / the speed the clip was authored for
(`stride`). Tune it against the one-metre grid until a paw stays planted on a line as it passes —
there is no way to eyeball this without the grid.

**Whatever moves him has to write BOTH transforms.** With wander on Yuka owns `model.matrix`; with
it off three does. A recentre (or any teleport) that writes only one of them looks fine until the
mode is toggled, at which point he snaps back to where he was.

## Walking him around a real room — `tools/cat-walk.js`

The cat-sequencer steering with the circular leash taken out and wall avoidance put in.
Everything in **Steering the cat — Yuka** above still applies and is repeated in the module,
because those failure modes are all silent. What is new here:

- **★ IT IS A GRID, NOT RAYCAST WHISKERS, AND THAT IS NOT AN OPTIMISATION — IT IS THE ONLY
  WAY IT FITS.** three's `Raycaster` is linear in triangles with no BVH and this building is
  428k of them, so a seven-whisker fan is ~3M triangle tests *per frame*. The room is measured
  once into a coarse walkability grid (0.3 m cells, 4,422 of them) and the whiskers become
  array lookups. Frame cost with steering and the mixer running: **4.22 ms**.
- A cell is blocked if a mesh's bounding box overlaps it in XZ **and** overlaps the cat's own
  height band in Y (`floorY + 0.06` to `+0.55`). The band is what makes the floor walkable and
  the roof irrelevant without naming either. Boxes are coarse on purpose — he keeps clear of
  things rather than clipping them.
- **★ THE LOOKAHEAD MUST EXCEED THE TURNING CIRCLE OR AVOIDANCE IS IMPOSSIBLE BY CONSTRUCTION.**
  He cannot turn tighter than the arc radius, so a wall seen closer than that is already a
  collision. Derived from the radius (2.5×), never typed.
- **★ "INSIDE THE BOUNDING BOX" IS NOT "INSIDE THE ROOM" — THE DOORWAY IS THE DIFFERENCE.**
  The grid spans the whole bbox, so the ground *outside* the walls is unblocked too. He walked
  out through the door, and once past the bbox every cell reads blocked, so the fan had no
  clear heading to offer and he just kept going: **650 m away after twenty minutes**. Fixed by
  flood-filling from his start cell and marking everything unreachable as wall — 4,422 cells
  down to 1,375 reachable. That closes the doorway, the outside, and any leak nobody has found.
  **A five-minute test passes this; it took twenty to fail.**
- **"Clear ahead" is not "not scraping a wall".** Travelling *parallel* to a wall reads as
  fully clear at every lookahead, so nothing objects while wander curves him back into it —
  measured two ~17 s episodes inside 0.3 m of a wall. A short probe ring and a gentle nudge
  away fixes it: **30.7% → 0.1%** of time within 30 cm.
- **An unsigned avoidance fan always breaks ties to the same side**, and in a corner that is a
  stable orbit. Ask which way round is more open first, then try that side at each deviation.
- **The rate limit applies to the safety net too.** The escape recovery originally assigned the
  heading outright, which is a pivot: one **1040°/s** frame per simulated hour. One visible snap
  an hour is one too many in a loop that plays forever.
- **★ FOOT SLIDE IS ONE NUMBER AND YOU CAN MEASURE IT INSTEAD OF EYEBALLING IT.** `stride` is
  the travel speed the walk clip was authored for; rate is `travel / stride`. It had been
  ASSUMED equal to the travel speed, which makes the rate exactly 1.0 and looks deliberate.
  **Freeze the body at the origin and step the clip**: a claw's world position is then its
  position relative to the cat, and a planted paw must sweep backward at exactly the travel
  speed. Stance is the bottom 15% of the claw's vertical travel — no threshold picked by eye.
  Measured here: **0.472 m/s**, not 0.45, all four claws inside 0.471–0.473. `measureAuthoredSpeed()`
  runs it at load so a re-export cannot leave a stale number behind. Result: overall stance
  slide **6.3% → 3.2%** of travel speed, and in a straight line **1.3%**.
- **★ AND THE SAME `matrixAutoUpdate` TRAP AS `setRenderComponent` BITES THE MEASUREMENT.**
  Freezing the body means writing `matrix` — but with `matrixAutoUpdate` still on,
  `updateMatrixWorld` recomposes it from position/quaternion on the next line and the identity
  is gone. The claws then get measured in WORLD space, so the cat's yaw rotates the sweep out
  of Z and the answer comes back short by `cos(yaw)`: **0.197 against a true 0.472** at 125°.
  It is a plausible-looking number, it sets the clip rate to 2.29, and it gives you **more**
  slide than you started with.
- **What is left is CORNERING, not the clip.** The walk clip has no turn in it — the body yaws
  underneath a straight-line cycle, so a planted paw has to scrub. Bucketed by turn rate:
  straight **1.3%**, gentle 3.8%, hard (>25°/s) **19.5%**. The lever is the arc radius, and it
  is an art-direction trade, not a bug fix — median slide / worst-case p90 / max turn rate:
  **0.55 → 3.8% / 0.145 / 46.9°/s**, 0.8 → 2.7% / 0.114 / 32.2, 1.1 → 2.4% / 0.085 / 23.4,
  1.5 → 2.1% / 0.069 / 17.2. All four keep him out of the walls. Fixing it properly needs
  additive turn poses or IK, not a dial.
- **Measure it over an hour, not a minute.** Final run, 1 h simulated: 0 frames inside a wall,
  peak turn rate 46.9°/s against a 46.9 cap, **0 pivot frames**, speed constant at 0.45, 459
  half-metre cells visited, 0 loiters over 10 s.

## What carries the look

In this order — atmosphere first, geometry last:

1. **ACES tone mapping** (`renderer.toneMapping`) — biggest single quality jump.
2. **Fog** (`FogExp2`) — depth, and it hides the edge of the world.
3. **Bloom** — makes light sources read as light instead of bright paint.
4. **Light shafts** — raymarched against the sun's shadow map (`tools/volumetrics.js`). They used
   to be crossed additive planes; that generation is gone, and so is the loop that demoed it.
5. **Dust motes** — `Points` with a soft radial sprite. Never leave them square.
6. **Vignette + film grain** — stops the image reading as "computer graphics".

`loops/factory-rt/index.html` is the reference implementation for all six now — `dust-and-light`,
which used to be, was deleted with the card shafts on 2026-08-17.

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

## Scaling the building — `Scene_60`

The room was authored too large. `Scene_60` is the whole scene at **0.6**. Floor-to-apex
went 10.79 m → 6.48 m; against a 1.745 m figure that is **6.18 people tall → 3.71**. `loops/factory-60/` is the
matching web loop and loads its own `assets/factory/factory_60.glb`.

**Judge scale against a figure you have MEASURED.** The reference figure was **1.531 m** — a
10% short adult — and 55% "felt right" against it. Re-checked against a correct 1.745 m
person, the answer was 60%. A yardstick that is 10% short biases every scale call you make.

**Doors and the figure are the exceptions, kept at 1.0.** A door is a real object; uniform
scaling takes it to 1.28 m at 55%, shorter than the person walking through it. Only one door
is placed in the scene, so this is two objects, not a policy. The result reads better than
before: 2.33 m in a 2.85 m wall, where it used to be 2.33 m in a 4.75 m one.

**★ THE WALL BRICK IS UV-DRIVEN AND THE SIGN'S BRICK IS WORLD-PROJECTED, SO A SCALE CHANGE
MOVES ONE AND NOT THE OTHER.** `modular_factory_facade_brick` runs `Texture Coordinate → UV →
Mapping`, so its brick shrinks with the geometry (course **76.9 mm → 46.2 mm** at 0.6).
`M_Sign_DrippingPickle` builds its own lookup from `Geometry → Position` through the
`Combine XYZ` chain, so it does not move at all — it stays at whatever `Math.002`/`Math.003`
(labelled "U along wall" / "V from height") multiply by. They are a **matched pair**: the
sign's mortar dropout, per-brick wear and fade-into-brick all land on phantom bricks the
moment the two disagree. Keep `1 / multiplier == the wall's tile size in metres`. At 100%
that is 0.33333 (3 m tile, 76.9 mm courses); `Scene_60` uses **0.55555** (1.8 m tile,
46.2 mm) in `M_Sign_DrippingPickle_60`. **Re-fit the sign whenever you re-fit the wall** —
and note reverting only one half of the pair is how they drifted apart the first time.

**★ YOU CANNOT CHANGE BRICK DENSITY BY SCALING THESE UVs — EVERY MODULE IS UNWRAPPED 0..1 ON
ITS OWN.** At Mapping scale 1.0 each wall module shows exactly one whole tile, so the pattern
completes at the module edge and reads continuous. At 0.6 each module shows `u ∈ [0, 0.6]`
and the next restarts at 0, which puts a **visible seam on every wall section edge**. It is
arithmetic, not tuning: seamlessness needs a whole number of tiles per module, so the scale
must be an integer — and every integer (1, 2, 3…) makes bricks *smaller*. There is no factor
that enlarges them and stays seamless. Two real fixes: **re-crop the brick texture** so one
tile holds fewer, larger bricks (one 1.8 m tile at 24 courses = exactly 75 mm; the crop must
be an EVEN number of courses or the stretcher bond flips at the seam, and must land on whole
brick columns), or **re-project the module UVs in world space** so density stops depending on
module size. Measured: 15 of 29 materials are UV-driven and all of them shrink this way.

**★ `Scene` IS GONE — EDIT MATERIALS IN PLACE NOW.** Work moved to
`Assets_Created/DP_Factory_Warhouse_60.blend` and the full-size `Scene` was deleted from it on
2026-08-17, so `Scene_60` is the only scene and every material has exactly one scene using it.
The 12 that used to be shared (`M_DPW_Glass`, `M_DPW_Metal`, `Concrete used`, `SteelN`,
`M_WindowBar`, `M_Conduit_Galv_Boxes`, `M_DPW_DirtDecal`, `M_DPW_Paint`, `M_DPW_PlasterWhite`,
`M_DPW_Rubber`, `M_DPW_MetalRust_01/02`) are safe to edit directly. **The `_60` suffix on the
other 16 is now vestigial** — it records that they were once copies, not that a twin still
exists, so do not duplicate again before editing. The original two-scene file
(`DP_Factory_Warhouse.blend`) still has both if the full-size room is ever wanted back.

**Object copies share MESH DATA unless you say otherwise, and Edit Mode does not warn you.**
`Scene_60` was built with `o.copy()`, which shares data — that is why it cost 8 MB and not
another 2.8 GB. Cutting a door hole in a wall there would have cut it in `Scene` too (moot now
that `Scene` is deleted, but this is why the copies were made single-user). All 227
are single-user now (cost: **14.8 MB**, 100k verts — the 2.8 GB is packed textures, not mesh).
The camera was in that set: shared camera data means a lens change re-frames both scenes.
Check with the objects holding a datablock, not `.users` — a count of 2 does not say who.

**★ DUPLICATING A COLLECTION LEAVES ANYTHING PARKED IN THE SCENE ROOT BEHIND.** `Scene_60`
was made by copying `Collection 1` → `Collection 1 @60`, so the four objects sitting loose in
`Scene`'s root were never picked up: **`Lowpoly Girl Standing`** — the 1.745 m scale yardstick
this whole section is measured against — plus one `cable_10cm` segment and its two sockets.
Nothing warns; the object counts (406 vs 397) look like ordinary noise. They went with `Scene`
when it was deleted. **Before deleting a scene, diff the two by base name** (strip `.NNN` and
`_60`), don't just compare totals. Recover them from `DP_Factory_Warhouse.blend` if the
yardstick is wanted back.

**Saving warns "Unable to pack file" for two book textures — that is not a failed save.**
`bpy.data.use_autopack` is on and `book a bump.jpg` / `book a norm.jpg` are missing from disk,
so `save_mainfile()` raises while still writing the file. Check `bpy.data.is_dirty` and the
file's mtime rather than trusting the exception. Both belong to a material literally named
`Material` (an old leather book) that `Scene_60` does not use.

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

**★ THE BAKE MARGIN MUST BE LESS THAN HALF THE PACK GAP.** This is the white-outline bug, and it is
pure arithmetic. `render.bake.margin` floods each island's colour *outward* by that many pixels; if
two islands are closer than twice the margin, their floods meet and each paints into the other.
Shipped 2026-08-16 with **gap 8 px / margin 16 px** — every island overran. Measured on the atlas:
the ring 0–4 px outside a wall's island was 87% lit at **2.6× the wall's own brightness**, rising to
7.2× by 24 px. Correct pairing here: **gap 8 px, margin 3 px** (2 px dead zone).
**Raising the gap is NOT the fix — 16 px is unaffordable at this island count.** `pack_islands`
applies `margin_method='FRACTION'` per island, and with thousands of islands the margin cost exceeds
the unit square: the pack silently collapses to a total UV area of ~5e-11 spilling past 1.6.

**A collapsed pack reports success — always verify before baking.** Assert `total UV area > 0.2`
(healthy is ~0.31–0.37) **and** that the extent sits inside 0–1. Three separate attempts here
returned "done" while producing a dead atlas.

**Scale island clusters about the UV ORIGIN, never their own centre.** Centring pushes UVs negative,
and `pack_islands(udim_source='CLOSEST_UDIM')` sends a negative island to a *neighbouring UDIM tile*
rather than into 0–1 — which is one of the collapses above. smart_project output is always ≥ 0, so
origin scaling stays safe.

**Normalise island scale by WORLD area.** `average_islands_scale` measures local space (trap 2 above).
Compute world area per object and scale each object's UVs to a constant UV-area-per-m². A per-object
bbox clamp is a blunt instrument — the global pack nests **individual islands**, so an object's
overall bbox is irrelevant to packing, and clamping on it starves those objects (56 objects here ran
at 10 texels/m against a 61 median). Fixing that properly needs island-level splitting of long
slivers, not a parameter tweak.

**★ THE BAKE TARGET MUST BE ACTIVE *AND* SELECTED, in EVERY material.** Cycles skips any material
where the image node is active but not selected — and clicking in the Shader Editor does exactly
that (it deselects nodes while leaving `nodes.active` set). One material in 30 was in that state and
**151 of 251 objects baked nothing**; the bake still "completed". Before every bake assert, for each
material, `bt.select and nt.nodes.active.name == 'BAKE_TARGET'`, and also sweep every object's
material slots for empty slots or materials with no target node.

**Reading the bake's report log.** `bpy.ops.ui.reports_to_textblock()` does not exist in 5.2. Instead
temporarily switch an area to `INFO`, then under `bpy.context.temp_override(...)` run
`bpy.ops.info.select_all(action='SELECT')` + `bpy.ops.info.report_copy()` and read
`window_manager.clipboard`. The message to grep for is
*"No active and selected image texture node found in material"*. Note the log is capped, so absence
of an old entry is not proof it never happened — corroborate with the atlas itself.

**Verify bake completeness, not just that it ran.** Compare the atlas's lit fraction against its
triangle coverage (a complete bake here reads ~64% lit / max luma ~192; the failed one read 23.4% /
max 30), then sample each object's face centroids against the lit mask to get a per-object
percentage — that names exactly which objects were skipped.

**Read that per-object percentage with the room in mind — most low numbers are not failures.**
Measured 2026-08-16 on a healthy 63.97% bake: 4 objects read <5% and 80 read 5–50%, and almost all
were correct. A 6-face box at 33.3% is two faces catching light in a dim interior, which is the
right answer; objects under ~20 faces are simply too coarse for centroid sampling to mean anything.
**The signal that a bake genuinely missed an object is its atlas patch reading absolute zero**
(max luma ~0.003 over its whole UV bbox) while a comparable sibling reads normally — a shadowed
surface still catches bounce here, since the median lit texel is 0.23. That test found exactly one
real miss (`cornice03_standard_standard_01.017`) out of 84 suspicious-looking objects. Cross-check
against a sibling before touching anything.

**Re-baking ONE object: `render.bake.use_clear` MUST be False, or you wipe the whole atlas.** It
defaults to True and a single-object touch-up with it on destroys hours of work while looking like
a normal bake. Confirm the fix afterwards by re-measuring an *untouched* neighbour as a control —
if the neighbour is unchanged, `use_clear` behaved.

**Post-bake, the BAKE_TARGET nodes are gone, so the "is every material armed?" sweep reads as 51/51
broken.** They are stripped for export. Do not read that as a failed bake — corroborate against the
atlas (lit fraction, per-object coverage) before believing it. To re-bake one object you must first
put a target node back in *each* of its material slots, active AND selected.

**★ `image.save()` USES THE DATABLOCK'S `file_format`, NOT THE FILE EXTENSION.** `LM_Factory` carried
`OPEN_EXR`, so saving over `lightmap_4k.hdr` wrote an **OpenEXR file under a `.hdr` name** — 201 MB
instead of 39 MB, and the loop loads it with `RGBELoader`, which reads Radiance only, so the scene
would have shipped with no lightmap at all. Set `im.file_format = 'HDR'` *before* `save()`, then
verify on disk: the first 10 bytes must be `#?RADIANCE` (an EXR starts `\x76\x2f\x31\x01`) and the
size must land near 39 MB. Expect `max luma` to move a hair (12.9189 → 12.8741) — that is RGBE's
8-bit mantissa, not a bad write.

**Blender returns a FRESH wrapper each time you read `node_tree.nodes.active`, so `is` comparisons
lie.** `nt.nodes.active = bt` followed by `assert nt.nodes.active is bt` fails on a correctly armed
material. Compare `.name` instead. This one masquerades as the active-and-selected bug above.

## Exporting the .glb — three traps that each cost a re-export

- **`use_visible` reads VIEW-LAYER visibility, not `hide_render`.** Hiding the spare `Camera` via
  `hide_render` did nothing and **two cameras shipped**; the loop's `if (o.isCamera) camera = o`
  takes the LAST one, so the wrong camera can win. Use `obj.hide_set(True)`. Always assert the glb
  contains exactly `["Cam_Loop_01"]`.
- **★ THE EXPOSURE 5.0 IN `loops/factory` WAS FITTED AGAINST BRIGHTENED TEXTURES — read this before
  re-grading.** Measured 2026-08-16: the Aug-14 build shipped WebP whose trim texture read **0.362**
  against a source of **0.1105** — a **+0.2515 lift**. The JPEG path showed +0.267. So *every* build
  before 2026-08-16 had albedo roughly a quarter too bright, and `EXPOSURE`/`LM_INTENSITY` were fitted
  by eye on top of that. Once the textures are correct the scene reads markedly darker and genuinely
  dark materials (the concrete columns, source mean 0.11 vs brick 0.40) go almost black — that is the
  textures being *right*, not a new bug. **Re-fit the grade against `reference/dp_lighting_reference.png`
  rather than against memory of the old build**, and note a plain exposure multiply will not reproduce
  the old look: the bug was an additive lift in linear, so it raised blacks, which exposure does not.
- **NEVER use `export_image_format='JPEG'` or `'WEBP'` — both write LINEAR values into an sRGB-tagged file.**
  Measured 2026-08-16: every JPEG texture came out **+0.267 brighter** (door mean 0.30 → 0.57),
  which reads as washed-out and blotchy. The control that proves it: an image that ships as PNG
  round-trips with **exactly 0.0** error while the JPEGs do not. `'AUTO'` is correct but embeds
  source PNGs losslessly — 337 MB. **The working recipe: pre-encode correct JPEGs yourself, point
  the image nodes at them, and export with `'AUTO'` so the exporter just passes the bytes through.**
  → 47.9 MB with a residual shift of −0.00025. Cache lives in `Assets_Created\_web_tex\`.
  To write a correct JPEG from Blender you must build a **fresh unpacked image** —
  `images.new()` → set `colorspace_settings` → `pixels.foreach_set(src_linear_buffer)` →
  `file_format='JPEG'` → `filepath_raw` → `save(quality=90)`. Calling `save()` on the original
  copies its **packed bytes** and silently writes a PNG with a `.jpg` name (76 MB, pixel-perfect —
  which looks like success). `save_render()` is worse: it bakes the view transform in (+0.58).
- **A colour Multiply behind the Base Color is DROPPED, and Blender will not emit `baseColorFactor`.**
  `modular_factory_facade_windows` (the window trim/cornices) tints its diffuse by
  **(0.0575, 0.0857, 0.045)** — the green. glTF has `baseColorFactor` for exactly this, but the
  exporter writes `[1,1,1,1]` regardless; verified with both the new `ShaderNodeMix` and the legacy
  `ShaderNodeMixRGB`, and a no-op Hue/Saturation node in the chain is not the cause.
  **Do NOT bake the tint into the texture** — at a ~0.06 multiply the result lands in the near-black
  end of 8-bit sRGB and comes back ~20% too dark. **Patch the GLB's JSON chunk after export instead**
  (a float, so it is exact): set `materials[].pbrMetallicRoughness.baseColorFactor`, then rewrite the
  container with recomputed chunk lengths (JSON chunk pads with `0x20`, BIN with `0x00`).
  **This must be re-run after EVERY export** or the trim goes white again. Only this one material
  needs it — a sweep of all 30 found no other dropped multiply.
- **Do the strip-and-restore inside ONE `execute_blender_code` call.** Each call gets a fresh
  namespace, so a saved-links list from a previous call is gone and the restore is unrecoverable —
  and the strip also overwrites Roughness/Metallic *constants*, which no amount of re-linking gets
  back. Record links AND constants, export, restore, all in one call, then assert zero failed
  restores. (Blender's undo did recover it once, and left the lightmap UVs intact, but don't rely
  on that.)
- No Draco or Meshopt: `loops/factory-rt/index.html` uses a bare `GLTFLoader` with no decoder
  configured, so compressed geometry would fail to load.
- **`tools/glb-basecolor.mjs` is the baseColorFactor patch above, as a tool.** Run it after every
  export: `node tools/glb-basecolor.mjs in.glb out.glb --set "MatName=r,g,b"`. It **exits non-zero
  if a named material is missing**, which is the point — the material is `modular_factory_facade_windows`
  in `Scene` but `..._windows_60` in `Scene_60`, and a silent skip is how the trim ships white.
  Verified live: the exporter had written `[1,1,1,1]` both times.
- **The working export order is AUTO → `glb-webp.mjs` → `glb-basecolor.mjs`.** `'AUTO'` passes the
  source bytes through untouched (572 MB), `glb-webp.mjs` re-encodes with ffmpeg *outside* Blender
  to dodge the linear-into-sRGB bug, and the baseColor patch goes last so the container rewrite
  cannot undo it. Measured on `Scene_60`: 572 MB → **54.7 MB**, textures 528.6 → 37.5 MB.
- **★ MOST "More than one shader node tex image" WARNINGS ARE THE UNCONNECTED `BAKE_TARGET`, NOT A
  DROPPED COMPOSITE.** Triage instead of panicking: count the image nodes whose outputs are actually
  LINKED. Four of five warnings on the `Scene_60` export were materials carrying an inert
  `Lightmap_4K_bake` node (`M_Conduit_Galv_Boxes`, `Rust metal`, `Concrete used`, `M_DPW_Glass`).
  The real one was `M_Sign_DrippingPickle` — **six image nodes, all six linked**. glTF took the logo
  as `baseColorTexture` and dropped the brick composite, so the sign exports as a CLEAN decal with
  no mortar dropout and no per-brick wear. It needs the bake in the section below, and the shipped
  `assets/factory/sign_*.png` are the old logo, so they cannot stand in.
- **The exported camera fov does NOT follow the render resolution.** `sensor_fit` is `HORIZONTAL`,
  so Blender preserves horizontal fov and only redistributes it between `yfov` and `aspectRatio`.
  Changing the render aspect 16:9 → 1:1 moved the exported hFov by exactly nothing (60.14° both
  times). If two loops frame differently, compare the CAMERA DATA (`lens`, `sensor_width`), not the
  render settings: every camera in the blend is 19 mm on a 22 mm sensor = **60.14°**, while the
  older `factory.glb` still carries **64.01°** — that asset predates a camera change and is the
  stale one.

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

## The warehouse build — export ritual and the mural

The production scene is `Assets_Created/DP_Factory_Warehouse_Production.blend` (Scene_60,
Structure + Props collections). The web loop is `loops/warehouse/`.

- **★ EXPORT VIA `tools/blender-export-warehouse.py` (run inside Blender), NEVER by hand.**
  The pickle mural on the gable wall is a LIVE node mix in `M_Brick_Mural_60` — brick bake ×
  painted layer × a `MuralFade` Value node the artist dials in Blender — and glTF carries one
  base-colour image per material, so the script flattens the mix at the current fade, exports,
  and restores the live graph. A hand export ships whichever single image the exporter picks.
  Then finish outside Blender: `glb-webp.mjs` → `glb-basecolor.mjs` with the factors from
  `assets/warehouse/export-factors.json`, which the export script rewrites on every run —
  the windows tint plus any Brightness/Contrast dial an artist parks in front of a Base
  Color texture (folded into baseColorFactor when it is a pure multiply in linear; the
  script WARNS when the dial has a constant offset and cannot ship as a factor).
  The flattened PNG `assets/warehouse/brick_mural_wall.png` is load-bearing.
- **★ THE WALL MODULES' UV ISLANDS OVERLAP — 570 OF 644 OCCUPIED CELLS ON THE MURAL WALL ARE
  CLAIMED BY MORE THAN ONE FACE.** Any bake into a wall's own `UVMap` therefore paints onto
  every face sharing those texels: the first mural attempt appeared three times, chopped
  mid-letter. The fix is a dedicated non-overlapping layer (`MuralUV`, planar by world y/z
  over the mural region) on the 782 mural faces, which carry their own material slot. That
  layer exports as `TEXCOORD_2` (the Lightmap layer holds slot 1) — three r169 reads it via
  `texture.channel` automatically. Check overlap before ANY wall bake: rasterise island
  centroids and count cells claimed twice.
- The mural's painted layer comes from `M_Sign_DrippingPickle_60`'s `BAKED_EXPORT` texture
  (`assets/warehouse/sign_dripping_pickle_baked.png`) — the sign quad itself is hidden, kept
  only as the bake source. Its original composite graph is parked in the material; to change
  the artwork: relink the composite, re-bake the sign (n021 recipe in feedback notes), then
  re-run the mural layer bakes (`Mural_BASE/COL/ALP`, packed in the blend).

## The warehouse loop — lighting, props, camera (state as of 2026-08-18)

`loops/warehouse/` is **the production build and the hero card**; `factory-rt` and
`factory-60` are demoted to reference. Live at
`https://johnmcclurgdesign-alt.github.io/dripping-pickle/loops/warehouse/`.

**Lighting is the factory-rt stack, re-wired and re-fitted**, not a copy: GI volume
(700 probes at 1.6 m, 2 bounces, shipped as `assets/warehouse/gi_volume.bin` so a
visitor never bakes), PCSS sun, rect skylights measured off the glb's own panes
(10 apertures, 4 roof), GTAO with the floor split, raymarched shafts at a whisper.
Every trap from the `Real-time lighting` section below still applies — bias in
metres, `planeOf()` not bounding boxes, glass/decals non-casting, `?gibake=1` to
force a fresh bake. Grade fitted to the reference render: exposure 1.35, sun 2.1
at size 0.075, skylights 0.8, AO 1.35 / floor 1.45.

- **★ RE-BAKE THE GI WHENEVER THE PROP SET CHANGES.** 69 props are 69 new occluders;
  the volume baked against an empty room lights a full one wrongly. `?gibake=1`,
  then `window.__rt.saveGI()` and drop the file over `gi_volume.bin`.

**Props ship as their own `assets/warehouse/props.glb`** so set dressing never forces
a building re-export. They load BEFORE the bake so they occlude and receive bounce.

- **★ BUDGET PROP GEOMETRY BY SCREEN SIZE, NOT BY A FLAT RATIO.** The set arrived at
  **2.9M triangles — 7.5x the whole building** — with a 0.11 m paint can at 50,000
  and a flat rug at 631,556. Budget scales with the object's diagonal
  (`min(45000, max(600, diagonal * 14000))`), which keeps the sofa and starves the
  can. 2.9M -> 661k, 18% of source, no visible loss. Decimate modifiers are added,
  exported through and removed in a `finally`, so **the blend keeps its full-res
  meshes** — never decimate the source.
- **★ RESOLUTION BEATS QUALITY ON A PROP SET.** 221 images, nearly all 2K, on objects
  centimetres wide. `glb-webp.mjs --max 768` downscales inside the same ffmpeg pass
  as the encode: 538 MB -> 33.8 MB. Reach for `--max` before touching `--quality`.
- **★ A UDIM TEXTURE CANNOT BE EXPORTED AT ALL, AND IT KILLS THE WHOLE RUN.** The
  vintage chair's diffuse was `TILED`; the exporter tried to read the tile off disk,
  found nothing, and aborted the export of all 69 props at the last object. Both its
  images had exactly ONE tile (1001) — the UDIM label was vestigial on a plain 2048
  texture, so `pixels.foreach_get` -> `images.new` -> relink converts it losslessly.
  **Assert the buffer is non-empty before shipping** or you get a black prop. A real
  multi-tile UDIM would need a proper merge instead.

**The panel is CONSUMER-FACING since 2026-08-18** — five icon groups (Style / Light /
Atmosphere / Camera / Finish), art dials only. Everything that left it was rig
calibration: sun azimuth/elevation/size, skylight shadow, the AO radii, GI bias,
GI in-room, sky IBL, fringe, distortion, tone mapping. **Every removed dial still
answers to its URL param at boot** — calibration is a link away, reviewers just
don't get dials that break the rig. Combined dials are MULTIPLIERS about the
fitted values, not absolutes: `shade` scales both AO amounts together, `flarex`
scales the active Lens preset's flare/streak pair (so Doc 16mm stays streak-free
at any dial value). The old `flare`/`streak`/`aoamt`-style absolute keys still
work at boot but no longer round-trip through Copy settings.

**★ N8AOPass REPLACES RenderPass — IT DRAWS THE SCENE ITSELF, UN-ANTIALIASED.**
Slotted mid-chain after the shafts it silently overwrites everything before it: the
MSAA'd render (reported as "I don't see any AA" — msaa 8 vs 0 was pixel-identical)
AND the composited light shafts, which vanished without anyone noticing at whisper
density. And left to render its own beauty, NO amount of end-of-chain SMAA recovers
the edges ("AA much worse than before the n8ao pass").
**The fix is the README's own escape hatch ("Using your own render target"):**
`configuration.autoRenderBeauty = false`, replace `aoPass.beautyRenderTarget` with a
`WebGLRenderTarget` built with `samples: 8` + a `DepthTexture` (three resolves both
on read), and render the scene into it in the frame loop just before the composer —
inside the drift wrapper, so the AO sees the drifted eye. Hardware MSAA and n8ao
coexist that way; 9.1 ms total. Chain order stays: n8ao FIRST in extraPasses,
RenderPass DISABLED while AO is on, volumetrics after, SMAA at the very end via
`createLooks({ finalPasses })` on the tone-mapped image. Composer msaa defaults to 0
when the AO is on (the beauty target carries the samples) and 8 when `?ao=0`.
Resize must `beautyRT.setSize` with the pixel ratio or the AO goes soft/stale.

**★ WAREHOUSE AO IS n8ao (2026-08-19), NOT GTAO.** Three GTAO fits all failed the same
way — broad radii are soup, tight radii ink halos on the wall behind silhouettes, and
the falloff terminates visibly ("it stops then gets light again"). n8ao (pinned
`n8ao@1.9.4` in the importmap) feathers to nothing. Two integration traps: its dist
build imports `{ Pass } from "postprocessing"` for a flavour we don't use — the
importmap maps that name to `tools/stub-postprocessing.js` rather than shipping a
second post library — and **`gammaCorrection` must be set FALSE** (default true
converts to sRGB mid-chain; with OutputPass doing ACES at the end the whole frame
washes out white). `shade` (walls) and `shadef` (up-facing) split its
intensity — a pcss.js-style exact-string patch on the composite shader (throws on a
version move) that mixes two exponents by world up-ness. Beware: n8ao's `getWorldPos`
only inverts the PROJECTION — its "world" positions and normals are view-space
despite the name; the up test needs the `viewMatrixInv` rotate (already a uniform).
`aorad`/`aofall` are its radius and falloff. `tools/ao-floor.js` and the
aoamt/aothick/aofrad/aofamt params are retired
here; the factory loops still run the old GTAO + floor-split stack. Real grounding
under props is the skyShadow light (skyshadow 0.9), not the AO.

**Camera drift — `tools/driftcam.js`.** Slow Lissajous sway (~12 cm at amount 1;
**default 0 — opt-in via the dial**: even ~7 px of tamed sway was reported as
"the camera offsets after load" on the locked shot, twice. `?drift=0.15` is a
good breath when it is wanted. **Rotation is a whisper (0.002 rad) on purpose** —
the first cut swayed the aim by 0.5° and on a locked shot that parks the
composition off-centre for ~10 s, which reads as "the camera is pointed down and
left now", not as a breath; translation + parallax carry the life instead.
**Applied just before render and RESTORED
right after**, so OrbitControls and the flycam never see it — both re-derive
their state from `camera.position` each frame, and letting the offset leak into
that loop turns a closed sway into a slow walk away from the framing. The
shafts' depth prepass sits INSIDE the apply/restore pair so the volumetrics
march from the same drifted eye as the frame. Verify it with a pixel diff, not
eyes — and kill the lens flare first: the TV static flickers the flare ghosts
across the whole frame, which buries the drift signal in noise (measured diff
46 no-drift vs 20 with-drift until the flare was zeroed; clean numbers are
14.9 at amount 2.5 against 0.54 at zero).

**★ `new OrbitControls()` LOOKS AT THE ORIGIN IN ITS CONSTRUCTOR, AND THAT EATS THE
BLENDER FRAMING.** The constructor calls `update()`, which `lookAt()`s the default
target `(0,0,0)` — from the warehouse camera that is a 14° downward snap. Reading
`getWorldDirection` AFTER constructing the controls captures the yanked aim, so
planting `target = pos + fwd·d` freezes the tilt in while *looking* like it
preserves the framing — factory-rt and factory-60 carried a comment saying exactly
that, above code with the read on the wrong side of the constructor. All three
loops shipped tilted from birth; nobody caught it until the art director put the
web build next to the Blender render (level camera, `[0,-0.7071,0,0.7071]` in the
glb — file and loader were always innocent). **Read fwd/eye BEFORE `new
OrbitControls`, then plant the target.** Symptom to recognise: framing is correct
for the first beat of loading, then shifts when the controls come alive. Diagnose
with a `lookAt` trap (patch `Object3D.prototype.lookAt`, log stacks for cameras) —
the first entry names the caller and the target in one shot.

**Camera formats — `tools/lens.js`** (shared module, wired here first). Focal length
in real millimetres is the dial (`2*atan(18/f)`, 36 mm frame); six presets bundle
focal + character: Native, **Wide 24 (default)**, Ultra 16, Anamorphic 2.39, Doc
16mm, Portrait 85. The Blender camera's ~19 mm equivalent read too tight for the
room. Distortion, fringe, vignette, grain and the letterbox are ONE pass; flare is a
second pass before it. Panel dials: Focal, Vignette, Grain, Fringe, Distortion, DoF
aperture, Flare, Streak. `window.__lens` for scripted checks.

- **★ THE LETTERBOX IS DRAWN IN THE SHADER, NOT AS DOM BARS**, so the framing a
  reviewer saw is the framing in their feedback screenshot.
- **★ GRAIN MUST BE MULTIPLICATIVE — THE PASS RUNS ON LINEAR HDR BEFORE ACES.** A
  shadow pixel is ~0.01 there, so adding ±0.035 is a 3x swing that tone mapping lifts
  into a wall of static over the entire frame (measured: the room vanished). Scaling
  by signal is both correct and how film behaves. Same warning for anything else
  added to colour in a pre-OutputPass shader.
- **★ THE FLARE IS SUN-GATED (2026-08-19): `lens.setSunGate(0..1)`, driven per frame by
  the scene from `dot(cameraForward, toSun)`.** A brightness threshold cannot separate
  "the sun" from "a bright TV" — the green screens are ~5× brighter than the glazing —
  so once the TVs went emissive, their ghosts read as speckly artifacts everywhere.
  Direction is the only signal that makes flare read as optics: it fades in over ~17°
  as the view tilts toward the skylights and is fully off at the level default view.
  Defaults to 1 (always on) for loops that never call it.
- **★ FLARE THRESHOLDS MUST BE MEASURED AGAINST THE SCENE, NEVER GUESSED.** The first
  value (1.5 linear) sat above everything in this moody room, so the pass ran and did
  **nothing** — which reads as broken plumbing, not a wrong number. Prove the
  machinery with absurd settings first, then measure: the glazing reads ~0.3–0.5
  linear here, threshold **0.18**. Re-check it if the grade moves.
- DoF is `BokehPass`, disabled until the aperture dial leaves 0, focus riding
  `controls.target`. Like `GTAOPass`, **it captured the placeholder camera at
  construction** and has to be handed the glTF camera on load.

**Page weight: ~59 MB since 2026-08-18** (45.4 building + 13.6 props, was ~92).
Both glbs ship Draco-compressed: `npx @gltf-transform/cli draco in.glb out.glb`
(defaults; 14-bit positions ≈ 2 mm over this room), and the warehouse loop feeds
`GLTFLoader` a `DRACOLoader` whose decoder path is the same pinned
`three@0.169.0` CDN as the importmap. **Re-run the compress after every
re-export** — an uncompressed glb still loads fine, so nothing warns when the
weight silently doubles. The factory loops still use a bare `GLTFLoader`; only
warehouse assets are compressed. What's left is textures (~40 MB of the
building), already WebP'd — no big lever remains.

## Feedback panel

Kills the ambiguity in art-direction notes. Click an object, write a note; it
records the real Blender name, the material, the click point **in Blender
coordinates**, the camera, and a screenshot.

```bash
node tools/dev-server.mjs 5173
```

- `?dev=1` — writes notes into `feedback/notes.json` (+ `feedback/shots/`). Read
  that file at the start of a session; anything with `"status": "open"` is waiting.
- **The tracker's Delete is for a note that should never have been filed** (a duplicate, a test,
  one against a deleted loop). "Mark done" is for one that was dealt with — delete keeps no
  resolution. Two clicks: the first arms the button for 4 seconds, because it sits next to
  "Mark done" and only one of the two is reversible from the UI. The record moves to
  `feedback/deleted.json` rather than being dropped, and the `.jpg` is left in `feedback/shots/`
  with the tombstone still pointing at it — a screenshot and a camera can't be reconstructed.
- **★ NEW IDS CAME FROM `notes.length + 1`, WHICH A DELETE BREAKS SILENTLY.** That only holds
  while notes are append-only. Measured: with 16 notes on file and `n017` live, the old scheme
  issued **`n017` again** — the new note would have overwritten `feedback/shots/n017.jpg`,
  keeping its own text and gaining someone else's picture. `nextId()` now takes the highest id
  ever issued, **tombstones included**, so a retired id is never reused while its `.jpg` exists.
  Any future "compact the notes file" idea has to respect the same rule.
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

**Anything the SCENE drives must be locked with `userData.noMove`** (on the object or any
ancestor) — a steered character, something on a path. It stays selectable and commentable,
which is the point of the panel; it just loses the handles. Its transform is an *output*, so
a dragged pose is not a suggestion, it is a value something overwrites. Worse, what gets
picked is the mesh *inside* the driven node: the cat is a SkinnedMesh in a Group whose matrix
the steering writes every frame, so a drag offsets the mesh **within** that group, the sim
carries on driving the group, and the cat renders somewhere else entirely — persisted by node
path and replayed on every load, with nothing in the sim to put it back. `restore()` prunes
locked entries rather than skipping them, so a stored one heals on the next load.

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

## Fly camera — `tools/flycam.js`

Unreal's level-viewport navigation, layered **on top of** OrbitControls; with no button held,
drag still orbits and the wheel still dollies. `createFlyCam({ camera, controls })`, then
`fly.update(dt)` in the animation loop, before `controls.update()`. Wired into all four loops
and exposed as `window.__fly`.

**Hold RIGHT MOUSE, then:** mouse looks, W/S forward-back along the true view axis, A/D strafe,
Q/E down/up along world up, wheel changes camera speed. Shift ×4 / Alt ×0.25 are ours, not UE's —
the engine has no boost modifier and expects the wheel to be used.

- **★ WASD IS NOT A CAMERA CONTROL UNTIL THE RIGHT BUTTON IS HELD.** That gate is the whole of UE's
  model, and it is what lets the keys stay free for everything else. Keys are still *recorded* when
  not flying, so grabbing the mouse with W already down moves — the engine polls key state rather
  than latching it on press.
- **★ REGISTER THE RIGHT-BUTTON LISTENERS AT WINDOW CAPTURE, NOT ON THE CANVAS.** At the target
  element, listeners fire in **registration order regardless of the capture flag**, and every loop
  constructs OrbitControls first — so a canvas-level listener runs second, after OrbitControls has
  captured the pointer and started a right-button PAN. Capture at the window, check the target is
  inside the canvas, `stopPropagation()`. Verified with `controls.state` (-1 NONE / 0 ROTATE /
  2 PAN) and `controls._pointers.length`: both stay clean through a right-drag now.
- **★ THE ONE-STEP EULER VERSION OF UE'S DAMPING MAKES TOP SPEED DEPEND ON FRAME RATE.** "Add
  `speed*damping*dt`, then multiply by `exp(-damping*dt)`" settles at `speed * damping*dt*k/(1-k)`,
  not at `speed` — measured **5.06 m/s against a dialled 6** at 60 fps, and a different number on a
  144 Hz machine. Use the exact solution instead (exponential approach to the commanded velocity,
  displacement from the average velocity over the step): now 6.000 m/s at 20, 60 and 144 fps.
- **Speed is a ladder, not a number.** Notches that each double the last, default 4 — UE's scheme,
  anchored to the 6 m/s already fitted to this building rather than to a raw engine constant. The
  wheel moves it while flying. It needs the on-screen readout: a wheel notch you cannot see reads
  as a broken wheel, which is why UE puts the number in the viewport toolbar.
  **The engine offers eight notches; we stop at five (0.75 / 1.5 / 3 / 6 / 12 m/s).** UE's ladder is
  sized for a level, and this building is 35 m across — notch 8 is 96 m/s, which crosses it in a
  third of a second, so the top three notches were all "gone". `maxSetting` is the dial.
- **A LOOK has to re-plant `controls.target` down the new view axis at the same distance.** Rotating
  the camera alone desyncs OrbitControls, and its `update()` ends with `lookAt(target)` — so on the
  very next frame it snaps your rotation back. Re-anchoring makes that `lookAt` a no-op instead.
- **Translate `camera.position` AND `controls.target` by the same vector.** OrbitControls derives
  its spherical from `position - target`, so moving only the camera makes it snap back the moment
  the user drags. Keeping the offset constant also means you carry on orbiting whatever you flew to.
- **Q/E travel along WORLD up, never camera up** — otherwise "up" tilts with the look direction and
  you drift off the level you were inspecting.
- **Bail out when `e.target` is an input/textarea/contenteditable, or `ctrlKey`/`metaKey` is held.**
  Otherwise typing a review note flies the camera and Ctrl+Z gets eaten from the feedback panel.
- **`dt` must come from successive `clock.getElapsedTime()` values.** `clock.getDelta()` returns ~0
  here because `getElapsedTime()` already consumed the delta internally — the symptom is a fly
  camera that initialises fine and simply never moves.

Pointer lock is requested only once the drag is real (>3 px), so a stray right-click doesn't flash
the browser's "press Esc" toast; losing the lock to Esc ends the flight, or we would capture the
mouse forever. Uses `e.code` (`KeyW`), not `e.key`, so it stays positional on AZERTY/QWERTZ. Keys
and the button are cleared on `blur`/`visibilitychange`, or a held key sticks when you alt-tab away
mid-press. `dt` is clamped to 0.1 s so the first frame back from a background tab doesn't teleport
the camera. `fly.camera` / `fly.controls` are exposed because ramp, top speed and the target
re-anchor are not things you can eyeball.

The feedback panel's click-to-select is **left button only** for this — a right-click that happens
not to move would otherwise re-pick whatever is under the cursor.

## Stylised looks

`tools/looks.js` — a post chain with a panel, bottom-left. The panel renders **groups**:
a scene may pass `groups: [{id, label, icon}]` (icon = a key into the exported `ICONS`
or a raw `<svg>` string) and tag each dial/choice with `group:`; built-ins land via
`exposure: {group, label}` and `tone: false` (which keeps the `?tone=` URL key working
through a hidden control). A scene that passes no groups gets the classic **Style /
Image / Atmosphere** — the factory and cat loops are untouched. Group headers collapse
individually; the whole panel still collapses from its header. Two rules learned wiring
it: in grouped mode choices render (and REGISTER) before dials, so a settings URL
replays the Lens preset before the fine dials and the dials win — and `volTied` is
opt-in per dial in grouped mode (legacy tied every dial to the volumetrics switch,
which would have greyed out the Sun dial under `?vol=0`).

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

**★ `new WebGLRenderer({ antialias: true })` DOES NOTHING ONCE THERE IS A COMPOSER, AND
NOTHING WARNS.** That flag asks for MSAA on the **default framebuffer** — the canvas — but a
composer renders into its own targets and only the last pass touches the canvas, by which
point the geometry is already resolved pixels. `EffectComposer` builds its targets with
`samples: 0`, so `factory-rt` shipped with **no anti-aliasing at all** while its renderer
politely asked for some. Check it, don't assume: `composer.renderTarget1.samples`.
Fixed where the target is made (`createLooks({ msaa: 4 })`, `?msaa=0` to A/B) rather than by
bolting on FXAA/SMAA — hardware multisampling fixes the EDGES without softening the texture
detail a post-process AA smears. Measured 4× against 0: hard one-pixel steps across the frame
down **9.7%**, and the cat's back and ears go from stair-steps to clean. Costs **+0.8 ms**
(3.78 → 4.58). Note `loops/cat-sequencer/` renders straight to the canvas, so its `antialias`
is real and it needs none of this — the trap only exists where a composer does.

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

**★ A DIAL THAT PASSES NO `step` USED TO GET THE STRING "undefined", AND THE BROWSER SILENTLY
FALLS BACK TO A STEP OF 1.** So every *uncurved* dial was quantised to whole numbers: a 0–1.5
dial had two positions, and a 0–0.6 dial had **one**, sitting at 0 while its readout said 0.20.
It reads as the scene ignoring the control, not as the control being broken. Curved dials set
their own 0.002 step and were always fine, which is why this hid until a dial whose whole range
was under 1 turned up. `looks.js` now defaults to `(max - min) / 500`. **Verify a new dial by
driving the slider and reading the target back**, never by looking at the readout — the readout
was right the whole time.

**★ `PMREMGenerator.fromScene` DEFAULTS TO `far = 100`, AND THIS SKY DOME HAS A RADIUS OF 400.**
The cube camera rendered an empty scene, so `scene.environment` was **pure black** — mean value
0.0000 — and the Sky IBL dial was multiplying zero. Nothing errors and nothing warns; sweeping
the dial from 0 to 10 (fifty times the shipped value) moved the brightest pixel in the frame by
**2/255**. Prove which half is broken by swapping in a known-bright environment: white through
the same code path moved pixels by **233**, so the plumbing was never the problem. Note the
knock-on — `envi` 0.195 had been "fitted" against zero, and with the map actually rendering the
same number is **+11.6%** on the frame (loop camera 90.7 → 101.2), so it was re-defaulted to
0.02 rather than silently re-grading the room. **Move it far and the GI wants a re-bake**, since
the probes see whatever the environment is lighting the room with.

`window.__looks` exposes the api for scripted checks — thirteen fragment shaders is too many
to eyeball, and a shader that fails to compile renders black rather than throwing.

## Real-time lighting — `loops/factory-rt/`

The whole factory lit live: no lightmap, no Blender bake. `tools/gi-volume.js` (bounce) and
`tools/pcss.js` (shadows) are shared modules; the scene wires them together.

**Bounce is an irradiance volume, not a lightmap.** A grid of probes through the building,
each rendering a 16px cubemap of the room and squashing it to 4 spherical-harmonic
coefficients per channel — an average brightness plus a direction. Surfaces look the grid up
at their own position and normal. 924 probes over this building bakes in **9.4 s** and
serialises to **29 KB**, shipped as `assets/factory/gi_volume.bin` and loaded instantly;
`?gibake=1` forces a fresh one. Multi-bounce works by baking with the previous pass feeding
the materials, so each pass REPLACES the grid rather than adding to it.

**It lights moving objects, which a lightmap cannot.** The light is stored in the air, not
painted on the walls, so anything can sample it — the cat included. Call `gi.patch(material)`
on his materials and he picks up the bounce of wherever he is standing. The vertex patch runs
after `<project_vertex>`, so it reads the SKINNED position and works on a SkinnedMesh.

- **★ GLASS AND DECALS MUST NOT CAST SHADOWS, and this is what "the real-time lighting is
  broken" actually looks like.** 48 glass panes each behaving like a lid means the sun never
  enters the building — the room renders near-black and every dial you reach for is the wrong
  one. Decals are the same trap wearing a different hat: light passes the glass and is then
  stopped a millimetre later by a dirt quad. `NOCAST_RE = /glass|decal/i`; the hud prints the
  non-caster count so a re-export that renames a material is visible immediately.
- **★ NEVER HARDCODE A MEASURED LIGHT POSITION.** The previous rig carried the glazing
  centre, the light ray and six shaft positions as constants read off the bake. The building
  was re-exported with a second bay, all of them pointed at a skylight that had moved, and
  the scene rendered black while looking like a shader bug. Everything is measured from the
  .glb at load now — glass meshes are the apertures.
- **The "flat panel" test for a roof light finds NOTHING here — the roof is PITCHED.** A
  skylight's bounding box is 3.2 m tall despite being a flat pane, so `size.y < min(size.x,
  size.z)` rejects it. Classify by HEIGHT instead: roof centres sit at 5.6 m, the arched wall
  windows at 0.2 m.
- **★ A RECT LIGHT BUILT FROM A PITCHED PANE'S BOUNDING BOX DRAWS A HARD STRAIGHT LINE ACROSS
  THE ROOM (n017).** A `RectAreaLight` is single-sided: everything behind its plane gets
  exactly zero, no falloff. The glazing is a sawtooth at 57°, so a flat 10.36 × 3.82 m pane
  boxes to 3.21 m tall — and placing the light at that box's centre, aimed straight down, put
  the cut-off on the HORIZONTAL plane y = 5.59, which is 1.6 m below the top of an aperture
  spanning 3.98–7.19 m. Every roof surface above it went unlit and the pitched roof crossing
  that plane drew a dead straight edge over beams, glass and brickwork. `size.z` was wrong
  too: 2.07 m is the slope's horizontal PROJECTION, not its 3.82 m length. `planeOf()` reads
  the pane's own plane out of the mesh (inward normal + extents along the plane's two axes),
  which is exactly what `width`/`height`/`lookAt` want. **Diagnose it by differencing the
  frame with the light on against off** — the contribution stepping 0 → 238 across one row
  names the plane immediately, and rules out the sun, the GI and the shafts in one shot (all
  three were toggled first here and none of them moved the line). Note the fix is brightness-
  neutral at the loop camera, 83.3 → 82.7: 1.85× the area, cancelled by the 57° cosine.
- **★ THE BAKE RE-RENDERS THE SHADOW MAP ONCE PER PROBE FACE UNLESS YOU STOP IT.** A probe is
  six `renderer.render()` calls and each one rebuilds a 4096² shadow map over the whole
  building. At 924 probes × 2 bounces that is 11,000 shadow passes for an answer that never
  changes, because the sun does not move during a bake. `shadowMap.autoUpdate = false` +
  `needsUpdate = true` for the first frame only. Without it the bake looks like an infinite hang.
- **★ `setTimeout(0)` BETWEEN BAKE CHUNKS IS CLAMPED TO 1 Hz IN A BACKGROUND TAB.** Measured:
  2.2% done after 35 seconds, i.e. a 26-minute bake, with no error anywhere. `MessageChannel`
  is not clamped and runs at full speed whether the tab is in front or not. This also bites
  any other chunked work in this repo.
- **`LightProbeGenerator.fromCubeRenderTarget` is ASYNC and that is the whole cost.** It polls
  a GPU fence on a 4 ms timer per face, so six faces cost ~25 ms of pure waiting per probe no
  matter how small the cubemap is. The synchronous projector in `gi-volume.js` copies three's
  conventions exactly and is **5.6× faster** (12,895 ms → 2,286 ms on the same 245 probes).
  `gi.verifyProjection()` checks the two agree — it currently reads **maxDiff 0** on all four
  coefficients, and that check is the only reason rolling our own is safe.
- **Band-1 SH can ring NEGATIVE on the dark side of a strong gradient.** Left alone it
  subtracts light and punches black holes in shadowed geometry. Clamp at zero in the shader.
- **`giNormalBias` is the one dial that matters.** Probes that landed inside a wall are black;
  a surface sampling its own wall picks them up as a dark rim. Stepping the lookup out along
  the normal reads the probe in the room instead. Too high and light leaks through walls.
  Default is 0.55 × probe spacing.
- **PCSS needs `PCFShadowMap`, NOT `VSMShadowMap`.** It reads packed DEPTH to work out how far
  away the blocker is; VSM stores depth MOMENTS, and reading those as a depth gives nonsense.
  The old rig used VSM because it wanted a uniform blur — PCSS derives the blur, so that
  reason is gone.
- **Acne under PCSS shows up as RAINBOW BANDING on fine geometry** (the radiator fins), not
  as the usual stripes, because the filter disc widens with blocker distance. `normalBias`
  is the control; it is in world units. Current pair: 2 mm depth bias, 6 mm normal bias.
- **★ A GRID THAT SPANS ITS BOUNDS EXACTLY CANNOT BE READ WITH A PLAIN `texture()` CALL — THIS
  WAS n018, "the corners glow and the middle is dark".** A sampler maps a normalised coord to
  texel index `u*D - 0.5`, but `gi-volume.js` puts probe `i` at `min + i*step` with
  `step = size/(D-1)`, so the correct index is `u*(D-1)`. The two agree **only at the exact
  centre probe**: at D=11 the error grows to half a probe — **1.1 m** — toward the edges. The
  volume was being read in the wrong place everywhere except the middle of the room. Fixing it
  moved wall corner/mid from 1.24 to 0.94 on its own. If you ever add another `Data3DTexture`
  grid here, decide up front whether probes sit ON the bounds or half a cell inside, and note
  that only the "half a cell inside" convention can use hardware filtering directly.
- **★ AND RE-BAKE AFTER TOUCHING THE SAMPLER.** Bounce pass 1 reads the volume *through this
  shader*, so a sampling bug is baked into the second bounce and survives the fix. Re-baking
  took floor edge/mid from 1.26 to 0.97 — bigger than the shader change that preceded it.
- **A hardware trilinear fetch cannot ask whether a probe can SEE the surface**, so a wall near
  a corner takes a quarter of its light from probes behind the perpendicular wall. Real corners
  are darker, so the error is *inverted*, not just wrong. `giVolume()` now gathers the eight
  neighbours with `texelFetch` and weights each by a wrapped cosine of the normal against the
  direction to that probe. **Be honest about what this buys: it is the smaller half** (wall
  0.924 → 0.878 on top of the alignment fix). It costs 32 texture reads against 4 and measures
  as *nothing* — 4.49/3.96 ms against 4.56/4.69 ms over 40 frames, because an 11×7×12 texture
  is entirely cache-resident. `givis` 0 reproduces the old sampler for an A/B.
- **★ THE BRIGHT BAND ALONG EVERY WALL/FLOOR JUNCTION IS ONE PROBE STANDING BEHIND THE WALL,
  AND NO NORMAL-BASED WEIGHT CAN REFUSE IT.** A floor point 15 cm from the wall at z = −4.052
  took **55%** of its bounce from the probe at z = −4.59 — half a metre behind that wall, in
  daylight, 3.4× brighter than the probe in the room. It is *sideways* from the floor, so the
  wrapped cosine barely disfavours it: sharpening exponent 2 → 16 moved the glow **2.50 → 2.43**.
  **Two obvious probe tests also miss it** — zeroing the 34 probes inside solid geometry changed
  nothing, and zeroing all 474 probes outside the building moved it 1.739 → 1.698. It is in open
  air, in the gap between the inner face and the outer envelope, on the wrong side of a wall.
  **The question that separates it is "how much open sky can this probe see?"** — 16 rays, count
  the misses. It works *because the glazing is geometry*: a ray leaving an indoor probe through a
  skylight still stops at the pane, so indoor probes score a clean **0.00**, the offender 0.31,
  fully outdoors 0.77–0.81. Stored in coefficient 0's alpha, which was already allocated and
  unused, so the file does not grow. Threshold 0.2 — and it is a **plateau**, not a knife edge:
  0.1/0.15/0.2/0.3 are byte-identical because the 16-ray score is quantised and nothing lands
  between 0.0625 and 0.313. At 0.45 the offender is valid again and the glow returns to 3.89,
  which is the mechanism confirming itself. Junction profile, GI alone: **4.05 → 1.40**.
  **If glass is ever deleted from the model rather than made non-casting, that 0.00 stops being
  0.00 and this threshold needs re-checking.**
- **Bake validity BEFORE the bounce passes**, or bounce 2 is gathered through the leak you are
  trying to remove — and stop the SH write from clearing coefficient 0's alpha, which it did.
- **`giNormalBias` at 0.55 of a probe spacing is a symptom, not a setting.** With no visibility
  test it is the only thing keeping a surface off the probe in its own wall, and there it cannot
  win — it helps walls and hurts floors in the same move. Measured wall corner/mid against floor
  edge/mid: **1.45/1.51 at 0.4, 1.24/1.88 at 2.0**. It is 0.33 now, a margin rather than a dial.
- **Diagnose an "unnatural light" note by isolating each source and measuring a RATIO**, not by
  looking. Corner-band mean ÷ mid-band mean, where >1.0 means corners glow: GI **1.24/1.88**,
  skylights 0.95/0.90, sun 0.20/0.19 — that named the culprit in one pass. And rule out inverted
  AO first, since it looks identical: of 124,967 pixels GTAO touched it darkened all of them and
  brightened **zero**. At full dials the whole frame read 0.74/0.62, i.e. the sun and skylights
  were bright enough to bury the defect — which is why it only showed up with the dials down.
- **★ GTAO's `thickness` MUST TRACK ITS `radius`, OR THE AO DIAL DELETES THE AO INSTEAD OF
  WIDENING IT.** `thickness` is how deep an occluder is assumed to be; a sample more than that
  behind the surface is read as "I can see past it". Pinned at its default 1 m while `radius`
  ran 0.1–5, every extra metre of radius threw more samples away. Spread of the AO buffer at
  the loop camera — **thickness 1: r1.2 60, r2 31, r3.5 15, r5 13** against **thickness =
  radius: r1.2 64, r2 39, r3.5 53, r5 68**. The "dark stripes past 1.2" were the same failure
  seen from the other side: differencing the frame at r1.2 against r3.5 shows the creases going
  **brighter by up to 72** while a broad band beside them darkens — the occlusion migrates off
  the geometry, and with no contact line anchoring it the leftover bands read as stripes.
  One occluder-depth per radius gives the soft per-surface vignette that was wanted, and costs
  nothing (3.56 ms at r1.5 against 3.60 ms at r5). **Diagnose this family on the AO BUFFER, not
  the composite** — `aoPass.output = GTAOPass.OUTPUT.Denoise`, then contrast-stretch it, because
  a healthy AO here only spans 180–246 out of 255 and every defect is invisible at that scale.
- **The floor has its own AO radius and amount — `tools/ao-floor.js`, dials `aofrad`/`aofamt`.**
  **It is ONE GTAO pass, not two, and that is the whole design.** A second `GTAOPass` re-renders
  the scene's depth *and* normals before it does any AO work, so it costs a full scene pass to
  buy two numbers. Instead the shipped shader is patched so the radius and thickness are chosen
  per fragment: three's GTAOShader already has the view normal in hand on the line above where
  it sets `radiusToUse`, and already carries `cameraWorldMatrix`. Measured 3.49 ms with the
  split inert against 3.89 ms with it wide open — inside the noise. **"Floor" is the world
  normal pointing up, not a list of objects**, so table tops and the tops of crates go with it;
  the crossfade band is a dial (`upMin`/`upMax`) so a ramp does not draw a line across itself.
  Verify a change to it by zeroing one amount at a time and painting the difference — the floor
  dial must move 5.4% of the frame and the wall dial 37.5%, with no overlap. Note **`thickness`
  is read in four places** in that shader, not just the falloff line; patch one and the floor
  marches with one depth budget and rejects with another. Pinned-version territory like
  `pcss.js`: it matches r169 by exact string and **throws** on a miss, because an AO split that
  silently does nothing is indistinguishable from one whose dials you have not found yet.
- **★ `shadow.bias` IS IN NORMALISED DEPTH, SO ITS REAL SIZE DEPENDS ON THE SHADOW CAMERA —
  THIS IS THE "SUN THROUGH THE WALLS" LIGHT LEAK.** It is a units bug, not a precision one.
  `-0.0006` across the old 33 m shadow box was 2 cm; fitting the box to the whole building
  took the range to 50 m and the SAME NUMBER became **3 cm**. Anything within 3 cm of its
  blocker is then pushed in front of it and reads as lit, which draws a bright strip along
  every wall/floor junction — and it looks exactly like a gap in the geometry. Measured sun
  contribution at the junction, 6 cm out: **33 at -0.0006, 8 at 2 mm, 0 once normalBias came
  down too.** Store the bias in METRES and divide by `far - near` in `aimSun()`, so
  re-fitting the shadow box cannot silently change what it means.
- **Sweep the parameter you actually suspect.** Two rounds were lost sweeping `normalBias`
  (which changes this leak by ~6 out of 82) while never once sweeping `bias`, which was the
  whole cause. And the first metrics — "brightest row", "top 1% of pixels" — measured the
  brightest thing in the frame rather than the defect, and reported no change while the bug
  sat in the picture. Probe the exact pixels, and A/B the one light you are blaming.
- **Patching a three ShaderChunk is pinned-version territory.** `pcss.js` matches `getShadow`
  in r169 by exact string and THROWS if it does not match, because a silent miss looks exactly
  like "PCSS is on and does nothing".
**Light shafts are RAYMARCHED now (`tools/volumetrics.js`), not cards.** A full-screen pass
walks each pixel's ray to the depth buffer, looks every step up in the SUN'S shadow map, and
sums the lit ones — the same question a shadow answers, asked about the air. The cards remain
behind the **Shafts** dropdown as a cheap fallback, but nothing below this line applies to the
default path any more; it is kept because the card traps are generic to billboard volumetrics.

- **Everything in the card list below is a property of the card being a card.** Raymarching
  has no silhouette to see, is shaped by the real glazing bars for free (they are already in
  the shadow map), is occluded by geometry for free (the march stops at the depth buffer),
  and adds in LINEAR HDR inside the composer rather than writing display-referred colour
  that gets tone-mapped twice.
- **★ FIT THE DENSITY, DO NOT GUESS IT.** The Henyey-Greenstein phase function is normalised
  to integrate to 1 over the sphere, so its value at any one angle is ~0.02. A "density" of
  0.02 therefore renders **nothing at all**, which reads as a broken pass rather than a dark
  one. Measured frame means at a fixed camera: **0.02 → 68.7 (invisible), 0.12 → beams read,
  0.3 → the room is fog, 0.5+ → white.** Default 0.08.
- **A composer pass is not an Object3D**, so the Volumetrics toggle cannot hide it — its list
  sets `.visible`. Both the pass and the cards go in via small proxies with a `visible`
  setter that also checks the current mode, or switching the toggle back on hands you BOTH
  implementations at once. Nine states verified.
- **The march start must be dithered per pixel** or the steps line up across the screen and
  you get banding instead of a beam. Half-resolution plus a blur is the lever if it costs
  too much; it runs full-res today.

- **★ A LIGHT SHAFT IS A QUAD, AND YOU CAN SEE ITS EDGES — THAT IS THE "SHAFT SHADOWING THE
  NEXT SHAFT" BUG (n011).** Where the quad passes through the floor it is sliced along a
  dead straight line; where it ends against the haze of the neighbouring beam that step
  reads as a shadow. It is strongly view-dependent because it is a silhouette. Diagnose it
  by tinting each shaft group a different hue and taking ONE frame — the artifact then tells
  you which beam it belongs to, which is far quicker than the three wrong guesses it took
  here. The fix is **soft particles**: render the opaque scene into a depth texture first,
  then fade each beam fragment as it approaches whatever is behind it (`uSoft`, in metres).
  It needs its OWN target — sampling the depth of the buffer you are drawing into is a
  feedback loop. Glass and the sky already carry `depthWrite:false` so beams pass through
  them, which is what you want since every beam starts at a pane of glass. A near-fade
  (`uNear`) handles walking *into* a beam, and widening the facing fade handles a beam
  slicing open air, where there is no depth to fade against.
- **★ THERE IS NO SUCH THING AS A DARK SHAFT — ADDITIVE BLENDING CANNOT DARKEN ANYTHING.**
  If the room has dark diagonal bands running through it, you are looking at the GAPS
  between bright beams, not at dark beams. Two causes, both fixed here:
  **(a) spacing and width are not the same number.** Each beam fades to zero at its own left
  and right edge, so laying them one width apart puts a trough at every seam. `sin(pi*u)`
  neighbours sum flat at 50% overlap, so the plane must be TWICE the spacing.
  **(b) the crossed second plane.** The pair existed so a beam never vanished edge-on, but
  the perpendicular blade means a row of beams is a row of parallel sheets, and their
  accumulated brightness ripples across the view. Replaced with ONE plane spun about the
  beam axis to face the camera — a billboard constrained to one axis, so the beam still
  points where the sun does. `shaftPlanes` is spun in the render loop.
  Diagnose the whole family the same way: toggle shafts and dust off. If the bands vanish
  it is the atmosphere; if they survive with the SUN's shadows off too, it was never a shadow.
- **The shaft plane's UVs run the opposite way to how they read.** The quad is pushed down
  by `len/2` from the glazing, so **`uv.y = 1` is the SKYLIGHT and `uv.y = 0` is the FLOOR**.
  Fade "the end" toward 0. Getting it backwards dims the beam exactly where it should be
  brightest, at the aperture — and looks enough like a lighting problem to send you off
  re-fitting the sun.
- **Never normalise a direction in the vertex shader and interpolate it.** Normalising is
  not linear, so the interpolated value is not the direction. On a `PlaneGeometry` — four
  vertices across an 11 m quad — the error is largest exactly where the plane is edge-on,
  which is where a facing term matters. Interpolate the raw view-space position and
  normalise per fragment.
- **★ NO BACKTICKS INSIDE A GLSL TEMPLATE LITERAL.** A backtick in a `//` comment inside the
  shader string closes the JS template literal, and the SyntaxError points at the next GLSL
  word — "Unexpected identifier 'phi'", "Unexpected identifier 'd'" — nowhere near the actual
  character. This has bitten twice, so there is now a guard: **`node tools/check-shaders.mjs`**,
  which is worth running after any shader edit. Note the invariant it tests is "the literal
  must not END on a comment line", not "the body contains a backtick" — the stray backtick is
  what terminates the literal, so it is never *inside* the body. The first version of that
  check looked in the body and passed a file that was genuinely broken.
- **Both modules CHAIN `onBeforeCompile` rather than assigning it.** They patch the same
  materials, and last-write-wins reads as "the GI works but the shadows are hard" (or the
  reverse, depending on load order). Same for `customProgramCacheKey`.
- **★ EXTRA COMPOSER PASSES HOLD THEIR OWN CAMERA REFERENCE.** `GTAOPass` captured the
  placeholder camera at construction; the glTF camera replaced it on load, so the AO was
  computed from a camera that never moved and painted a fixed smear across the screen.
  `RenderPass` gets this right via `getCamera()` — everything else has to be told.
- **`createLooks` SNAPSHOTS its volumetrics list at construction.** Anything added later
  never responds to the toggle. Pass a permanent parent Group and fill it in afterwards.

Measured on the loop camera, atmosphere off, so the numbers are lighting only:

| | mean | sd | deep shadow |
|---|---|---|---|
| direct light only (GI off) | 25.5 | 22.6 | **47.3%** |
| with the volume | 42.9 | 28.1 | **18.3%** |

Deep shadow more than halves, and it does it with DIRECTION — the far bay has no skylight at
all and is lit entirely by bounce arriving through the arched windows.

**Still open:** the shafts and dust are still fitted to the old single-room export and want
re-doing against two skylights (gain dropped 0.095 → 0.04 as a stopgap). The volume now weights probes
both by visibility and by whether they stand in the room, which took the wall junction from 4.05
to 1.40 — but **1.40 is not 1.0**. The residue is what a band-1 SH volume on a 2.2 m grid cannot
represent: there is still no per-probe DEPTH, so nothing asks whether geometry sits *between* a
probe and the surface. That is the real remaining lever, and it is the DDGI Chebyshev test.
Note the `.uasset`-style trap here — the cache is versioned (`ver: 2`), so **bump
`FORMAT_VERSION` in `gi-volume.js` whenever a channel changes meaning**, or an old
`gi_volume.bin` loads silently as "every probe is outside the room" and the scene renders black.

## Working rules

- **Screenshot before claiming it works.** Run the local server, load the page, look at
  the image, judge it against the direction. A clean console is not evidence.
- **Palette constants at the top of every scene.** Art direction happens by changing a
  handful of named colors, not by hunting through the file.
- **Comment the intent, not the syntax.** Explain why a value is what it is.
- **Commit at every working state** so a bad experiment reverts cleanly.
- Ask before adding a dependency. The no-build-step property is worth protecting.
