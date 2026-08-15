# Handoff — 2026-08-14

Written at the end of a long session so the next one starts cold and moves fast.
`CLAUDE.md` is the real documentation; this is only "where we got to and what's next".

---

## Start the next chat like this

**Launch UE *before* opening the chat** if the cat work involves Unreal — the unreal-mcp
tools only register at session start, so an editor launched mid-chat is invisible.

```
1. Open UE with Loops_PickleFactory
2. Console: ModelContextProtocol.StartServer     (the plugin ships bAutoStartServer=false)
   Check: GET http://127.0.0.1:8000/mcp  →  405 means alive
3. THEN start the chat
```

Say **"the dripping pickle 3js tool"** — not "our 3js tool", which sent a previous session
into `Desktop\FBX_Viewer` for an hour.

Dev server for this repo:
```bash
cd "C:/Users/dexte/Desktop/Loops Pickle Factory/The Dripping Pickle - 3JS" && node tools/dev-server.mjs 5173
```
→ `http://localhost:5173/loops/factory/index.html?dev=1`

---

## ⭐ Next task: a three.js cat with a walk cycle

**The ask:** "a 3js version of our cat, at least enough to give him a walk cycle."

**What was established before the session ended** (inspected `Cat_PF.blend` headless):

`C:\Users\dexte\Desktop\Loops Pickle Factory\Assets_Created\Cat_PF.blend` holds **two rigs
and zero animations** (`bpy.data.actions` is empty):

| | bones | drives | notes |
|---|---|---|---|
| `root` / `root_Armature` | 23 | `SK_Cat` (10,952 v / 11,056 f) | the UE-export rig, clean FK: `pelvis → spine_01/02 → head`, `thigh/calf/hock/foot`, `upperarm/lowerarm/frontfoot`, 5 tail bones |
| `Armature.001` | 32 | `sculpt.001` + `Eye1` | original asset rig, IK controls + pole targets |

Textures are packed (`CAT_TEX_C` 2048, `EyeV2_C` 1024, `WHITE_MASK` 512).

**THE DECISION THE USER STILL HAS TO MAKE — ask before building:**

- **Their own `SK_Cat`** — fully theirs, no licence question, but **no animation exists**, so
  the walk has to be authored (procedurally in Blender, or driven in three.js at runtime).
- **The Fab "Cats – Simple" cat** — 51-bone skeleton, proven `Walk_F_RM` clip already
  debugged extensively in UE, exportable to GLB in one step. But it is a $30 Fab asset and
  this repo deploys publicly to GitHub Pages, so the licence is worth a look.

Claude's recommendation at the time: take the Fab cat first to prove the pipeline in a day,
swap in `SK_Cat` later. **Nothing was built — no export was run, deliberately.**

A ready-to-run headless GLB exporter for `SK_Cat` was drafted but not executed. Re-derive it
if needed; the shape is `bpy.ops.export_scene.gltf(use_selection=True, export_yup=True,
export_apply=True, export_skins=True, export_animations=False)` on `root` + `SK_Cat`, with
`hide_render` cleared first (a hidden object silently vanishes from a glTF export).

Relevant memory: `cat-npc-motion-matching` — very long, and it carries the full history of
the UE cat including the motion-matching bugs. Read it before touching the UE side.

---

## What this session built (26 commits, all in this repo)

**`tools/feedback.js`** — the review panel. Started as click-an-object-and-write-a-note; now
also does multi-select (shift-click), a combined move/rotate gizmo, undo/redo, edits that
survive a refresh, and a before/after "Capture Suggestion" straight to the clipboard.

**`tools/looks.js`** — new. 13 stylised post-process looks × 13 blend modes, a sectioned
panel (Style / Image / Atmosphere), volumetrics toggle and dials, and **Copy settings**
which shares a whole look as a URL.

Both are documented properly in `CLAUDE.md`, including the reasoning and the measurements.

---

## Open threads

1. **Sky and shafts over-expose in every composed look.** They are custom `ShaderMaterial`s
   writing display-referred colour, and three does not auto-inject tone mapping into a custom
   shader — so through a composer they get ACES'd a second time. Fix is adding
   `#include <tonemapping_fragment>` / `<colorspace_fragment>` and re-fitting `SKY_GAIN` /
   `SHAFT_GAIN`. That is an art-direction change, so it was deliberately left alone.
   Workaround today: pull the Exposure slider down.
2. **Trim the 13 looks** to the three that survive real use, and tune those.
3. **Notes as pins in the scene** — past notes become clickable markers. Biggest jump in
   usefulness; user liked the idea.
4. **Hide / measure tools** — hide a wall to see behind it, click two points for a distance.
5. **Path-traced ground truth in the browser** — [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
   (gkjohnson, the `three-mesh-bvh` author; MIT, WebGL2, actively developed). Progressive
   accumulation, real GGX materials, area/spot/directional/point lights with importance
   sampling, environment IBL, emissive, transmission, DOF, volumetric fog, skinning.

   **This invalidates a line in `CLAUDE.md`** — "the browser has no Lumen and no path tracer"
   was true when written and is now the exception. Do not read it as still-current.

   The value here is **not** replacing the bake, it is *checking* it — the same trick already
   used in Unreal on Pirate Beach ("render the same frame in pathtracing view mode; it is
   ground truth, so anything absent there is a Lumen artifact"), now available on the same
   `.glb` in the browser. That is a real answer to note **n002** (odd baked highlights on
   `wall_standard_standard_01.005`). Second use: converged hero stills without leaving the web
   build.

   Three catches, worth knowing before starting:
   - **The loops animate** (dust, shafts), and any change resets accumulation — so this is a
     static-frame tool here, not a renderer swap.
   - **The scene has no lights at all**, being 100% baked. Path-tracing it means porting the
     real lights back: skylight glazing as an area light, sky as environment. They exist in
     the Blender scene already.
   - **A dim interior lit through one small aperture is the slow case** for path tracing.
     125k tris is nothing; noise convergence is the cost.
   - `MeshStandardMaterial` / `MeshPhysicalMaterial` only, so the custom sky-dome and
     light-shaft shaders are ignored — which is what you want for a ground-truth render,
     since both are fakes standing in for real light.

   Suggested shape: a side-by-side `loops/factory-pt/` off the same `.glb`, real lights,
   converge and compare against the bake. Answers two questions at once — is the bake
   faithful, and could a still-camera loop skip Blender entirely.
5. `feedback/notes.json` + `feedback/shots/` are untracked. n001 is a test, n002 is a real
   note about baked highlights on `wall_standard_standard_01.005` — the user said the
   lightmap work is for later.

---

## Branch `realtime-lighting` — how close can the browser get to GI?

`loops/factory-rt/` — the factory scene with real lights put back, on its own branch so
`main` is untouched. Both scenes exist on the branch, so compare them in two tabs.
`http://localhost:5173/loops/factory-rt/index.html?dev=1`

The rig is built entirely from numbers already measured for the bake, which is why it lands
close on the first try: glazing centre, the 37.4°-off-vertical light direction, floor height.

- **Sun** — DirectionalLight along the measured ray, VSM shadows at 2048 over a tight 18-unit
  ortho box (~8 texels/cm; the default 100-unit box would give 1.3). VSM not PCF because one
  hard sun across a 10 m throw stair-steps visibly with PCF.
- **Skylight** — RectAreaLight filling the real 7.4 × 2.1 aperture, so the room reads as lit
  *through a hole*. Casts no shadow (three doesn't support it) — fill only.
- **Bounce** — HemisphereLight, sky above / warm floorboard below. Not GI, a stand-in.
- **Sky IBL** — the scene's own procedural sky PMREM'd into `scene.environment`, so
  reflections agree with what's out the window.
- **GTAO** — passed into `createLooks({ extraPasses })`, sitting after RenderPass and before
  the style passes, since occlusion is part of the render and a look should composite over it.

A **Lighting** dropdown switches Real-time / Baked / Both, and the rig has dials for Sun,
Skylight, Bounce, Sky IBL and Shadow soften — all URL-serialisable, so Copy settings shares a
lighting setup too. Baked and real-time are mutually exclusive by default: the lightmap
already contains the bounce the rig is imitating, so Both is deliberately double-lit.

**THE FINDING — the gap is the darks, not the light.** Frame statistics against the baked
render (mean / stdev / % of pixels below luma 20):

| | mean | sd | deep shadow |
|---|---|---|---|
| **baked (target)** | 87.9 | 85.1 | **30.1%** |
| first guess: sun 2.6, sky 1.8, bounce 0.30, env 1.0 | 98.5 | 71.2 | **5.3%** |
| **fitted default: sun 3.2, sky 1.2, bounce 0.12, env 0.40** | 84.1 | 78.1 | **24.2%** |
| sun 3.6, sky 0.9, bounce 0.06, env 0.22 | 78.1 | 81.8 | 40.2% |
| sun 4.2, sky 0.7, bounce 0.03, env 0.12 | 74.3 | 84.4 | 49.6% |

Direct light is easy to match. What uniform ambient cannot reproduce is *occlusion* — it
fills exactly the darks real GI leaves alone, which is why the bright first guess held only
5.3% deep shadow against the bake's 30%. Getting the darks back means turning ambient down
and leaning on AO, which is what the fitted defaults do.

**Caveat before trusting that table: matching a histogram is not matching a look.** The bake
has *directional* bounce — light off the floor onto the ceiling, colour bleed from the brick.
A hemisphere light is uniform, so the statistics can converge while the character does not.
Judge it by eye before believing the numbers; they were a search tool, not a verdict.

Worth trying next: light probes or a small irradiance volume for directional bounce, a second
dim bounce light aimed up from the floor, or SSGI. And thread 5 below (path tracing) is the
honest ground truth to measure any of it against.

---

## Traps that will otherwise cost an hour

- **The in-app Browser pane does not composite when hidden, so `requestAnimationFrame` never
  fires.** Call `scene.updateMatrixWorld(true)` by hand between synthetic events. Any
  animation (e.g. the Reset View fly-back) simply cannot be verified there — it needs a human.
- **A synthetic `pointermove` must carry `button: -1`.** `TransformControls.pointerMove()`
  returns immediately on anything else, so the drag starts and nothing moves.
- **Screenshots of the factory page time out through the Chrome MCP**, and its synthetic
  clicks never reached the canvas at all. Verify through `window.__fbk` / `window.__looks`.
- **`preview_start` resolved the wrong project's `launch.json`** from an Unreal Projects
  session. Start the dev server with Bash.
- Bash heredocs choke on the big inline Python used for edits here — write the script to the
  scratchpad with the Write tool and run it as a file.
