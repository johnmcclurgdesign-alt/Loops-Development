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

# Session log — 2026-08-16 (bake day). READ THIS FIRST.

## Where the repo actually stands

On branch **`realtime-lighting`**, not `main`. **Nothing has been pushed**, so the live
GitHub Pages site is still the old build.

Committed today:

| commit | what |
|---|---|
| `6176ce2` | Yuka + Ossos notes for the cat (see the cat section below) |
| `fb77425` | the re-baked lightmap + the bake traps in `CLAUDE.md` |

**Still uncommitted, and this is the thing to deal with first:**

- `assets/factory/factory.glb` — 50 MB, re-exported 10:56. **The lightmap is committed and the
  glb it belongs to is not**, so the repo is currently in a split state. Commit them together
  or the next person gets a mismatch that looks like a bake bug.
- `tools/flycam.js` — **untracked and fully documented in `CLAUDE.md`.** It would vanish with
  the folder. Highest-risk file in the tree.
- `loops/{factory,factory-rt,dust-and-light}/index.html` — the flycam wiring (+30 lines), which
  imports `tools/flycam.js`. Commit these *with* flycam or the loops break on a fresh clone.
- `feedback/notes.json` + `feedback/shots/` — 8 open notes, see below.

## Why the .glb doubled, 23 MB → 50 MB (answered — it is correct, do not "fix" it)

Two unrelated causes, both intended, measured by parsing the container's JSON chunk:

| | old (committed) | new (10:56) |
|---|---|---|
| images | **16, all WebP**, 17.6 MB | **21 JPEG + 2 PNG**, 31.4 MB |
| geometry etc | 5.5 MB | **18.5 MB** |
| meshes / nodes / materials | 75 / 76 / 21 | **251 / 471 / 30** |

1. **+13.8 MB is the texture correctness fix.** The old build's WebP is the documented bug —
   linear values written into an sRGB-tagged file, a **+0.2515** additive lift. Correct JPEGs
   are simply bigger. `CLAUDE.md` predicted ~47.9 MB for this recipe; we landed at 50.2 MB.
2. **+13 MB is the scene actually being complete.** 75 meshes → 251, which lines up with the
   252 mesh objects the bake covered. The old export was a fraction of the room.

**Two export traps verified clean on the new file, so don't re-check blind:**
- exactly one camera, `Cam_Loop_01` (the two-camera trap)
- `modular_factory_facade_windows` carries `baseColorFactor = [0.0575, 0.0857, 0.045, 1.0]` —
  the green trim patch **was** re-run after this export. It must be re-run after every export.

## The bake — verified, one object fixed

63.97% → **64.10% lit**, no NaN, no negatives, margin 3 px, lightmap in UV slot 1 everywhere.
Browser confirms **265 meshes / 265 lightmapped**.

`cornice03_standard_standard_01.017` had been silently skipped — a 107×314 patch of pure black.
Re-baked alone with `use_clear` off: **0.0% → 62.7%**, with its twin `.016` holding at 57.7% as
the control proving the rest of the atlas survived. Full trap list is in `CLAUDE.md`.

## Open feedback notes — several may already be closed by today's work

All 8 are still `"status": "open"` in `feedback/notes.json`. **Re-check these against the new
build before doing any work on them** — three look already answered:

| note | object | says | likely status now |
|---|---|---|---|
| n003 | `wall_standard_standard_01.011` | "white glow around wall and door. Could be uv islands bleading in to each other?" | **probably FIXED** — that is the white-outline bug, margin was 16 px against a gap of 8; it is 3 px now. Verify in the new build, then close. Note this object still samples at only 7.7% lit. |
| n007 | `Cube169_1` | "Widow trim color (green) not displaying" | **probably FIXED** — `baseColorFactor` confirmed present in the new glb. |
| n008 | `Column005` | "The concrete columns are black now." | **explained, not a bug** — `CLAUDE.md` documents this exactly: correct textures make genuinely dark materials (columns source mean 0.11 vs brick 0.40) read near-black. This is a grading call, not a defect. Needs an art decision, not a fix. |
| n004 | `Cube001` | door "very splotchy", wants a higher-res bake for specific elements | open — real work |
| n005 | `Rack_1001` | "lose the heavy ping and bake the shelves way down" | open — real work |
| n006 | `Raidiator_01` | "textures are not rendering properly across the radiator pieces" | open — real work |
| n002 | `wall_standard_standard_01.005` | user flagged as a test, lightmap stuff "later" | low priority |
| n001 | — | test note | can be deleted |

## What to come back to, in order

1. **Commit the glb + flycam + loop html together.** Split state is the active hazard.
2. **Re-check n003 / n007 / n008 against the new build and close what is done.** Cheap, and it
   shrinks the list from 8 to 5 before anyone starts real work.
3. **Push.** Nothing is live. Also decide whether `realtime-lighting` merges to `main` or stays
   an experiment — see the branch section further down.
4. **Re-fit the grade.** `CLAUDE.md` is explicit that `EXPOSURE 5.0` was fitted against the
   *brightened* textures, so it is now wrong by construction. Re-fit against
   `reference/dp_lighting_reference.png`, **not** against memory of the old build, and note a
   plain exposure multiply cannot reproduce the old look — the bug was additive in linear.
   n008 (black columns) is the same conversation; do them together.
5. ~~**The cat.** Rig decision is still open.~~ **DONE 2026-08-16 and frozen deliberately** —
   built, proved, stopped. `SK_Cat` is dead; it is the Fab cat. See the cat section below.
6. **Low priority:** 80 objects sampled 5–50% lit. Almost all are correct for a dim interior —
   `CLAUDE.md` explains how to tell a real miss from a shadow before anyone panics about it.

---

## The cat — BUILT, PROVED, AND FROZEN 2026-08-16

**Do not treat this as an open task.** It was stopped on purpose, at a working state, because
it had answered what it was built to answer. The user's words: *"This proved everything I
needed to know and it's going to work perfectly."*

**The rig decision is CLOSED. `SK_Cat` is dead** — the user's own rig is not being used. It is
the Fab **"Cats – Simple"** pack, already in the UE project at `/Game/Cat_Simple/`.
⚠ It is a **$30 Fab asset and this repo deploys publicly to GitHub Pages**, so the licence is
still worth reading before anything ships to Pages. That has not been done.

### What exists

`loops/cat-test/` — a deliberately plain scene: neutral ground, a **one-metre grid** to measure
foot skate against, a rim light for silhouette, fly camera and the feedback panel. Opens with
wander OFF because it is a clip-inspection scene first; `?wander=1` starts him moving.

`assets/cat/` — **11 MB**: `cat.glb` 2.9 MB (mesh + normal map only), 43 animation clips
6.6 MB, 6 fur coats 1.2 MB. Animation is now the bulk, not textures.

Straight out of UE 5.8's glTF exporter — **no Blender round-trip**. Every trap in that pipeline
is written up in `CLAUDE.md` under "Unreal → web (the cat)" and "Steering the cat — Yuka";
read those before re-exporting anything, they cost a day between them.

### What was proved (measured, not eyeballed)

- Bone names survive UE → glTF **51/51**, so one clip file binds to a separately exported mesh.
- Scale is right: 0.14 × 0.45 × 0.78 m, root bone on the floor.
- Steering produces **cat-like arcs, not pivots** — 0 pivot frames over 5 simulated minutes,
  tightest arc 0.55 m against 0.55 configured, peak turn 46.9°/s against a 46.9 cap, slip
  between facing and moving 0.0°, speed constant.
- Turn direction is balanced (48 left / 41 right) after the meander fix.

### Where to pick it back up: rests

He has 43 clips and only ever walks. The design was agreed but **not built**:

1. **A clip sequencer — this is the actual work.** A rest is a chain
   (`sit_start → sit_loop ×N → sit_end`), and nothing in three.js sequences that. The hook is
   the mixer's `finished` event. Build this first, with **sit only**: if one chain reads
   cleanly the rest are table entries, and if it does not you have found out cheaply.
2. **A hand-rolled state picker.** Not Yuka's `StateMachine` — that decides *states*, and the
   hard part here is *chains*, which it knows nothing about.
3. **★ One rule that must not be broken.** Constant speed is what killed the stop-and-spin bug,
   so the fix is not to revert it: **steering may only turn him; only the state machine may
   change his pace.** It sets a target speed and he eases toward it.

Starting rhythm to argue with: walking 40%, standing 15%, sitting 15%, lying/dozing 25%,
grooming 5%. **Rest lengths must vary a lot** — a cat that sits for exactly eight seconds every
time reads as scripted no matter how good the clip is.

**Deliberately left out:** cats rest *somewhere* — the warm spot, the high spot, out of the way
— and there is nowhere to choose in a grey test room. Build the mechanism now, wire it to real
places when he moves into the factory. Nothing gets thrown away.

### Still unread from the pack

170 clips exist; 43 are in. Unused and worth knowing about: **29 jump clips** (12 taken —
he could get *onto* crates, which is a different scene rather than a different clip),
**16 crouch/stalking**, 19 swim, 21 combat, and the walk/trot/run direction matrices we skip
because he always walks forward and arcs.

### Superseded — kept only because it explains why `SK_Cat` was ever a candidate

`C:\Users\dexte\Desktop\Loops Pickle Factory\Assets_Created\Cat_PF.blend` holds **two rigs
and zero animations** (`bpy.data.actions` is empty):

| | bones | drives | notes |
|---|---|---|---|
| `root` / `root_Armature` | 23 | `SK_Cat` (10,952 v / 11,056 f) | the UE-export rig, clean FK: `pelvis → spine_01/02 → head`, `thigh/calf/hock/foot`, `upperarm/lowerarm/frontfoot`, 5 tail bones |
| `Armature.001` | 32 | `sculpt.001` + `Eye1` | original asset rig, IK controls + pole targets |

Textures are packed (`CAT_TEX_C` 2048, `EyeV2_C` 1024, `WHITE_MASK` 512).

**~~THE DECISION THE USER STILL HAS TO MAKE~~ — DECIDED 2026-08-16: the Fab cat.**
`SK_Cat` is dead. It had no animation and would have needed a walk authored from scratch; the
Fab pack arrived with 170 clips. The drafted headless `SK_Cat` glTF exporter was never run and
is not needed — nothing goes through Blender on this path any more.

Relevant memory: `cat-npc-motion-matching` — very long, and it carries the full history of
the UE cat including the motion-matching bugs. Read it before touching the UE side.

### SHIPPED — [Yuka](https://github.com/Mugen87/yuka) drives him (collected and adopted 2026-08-16)

> Kept as written because the reasoning still holds, but this is no longer a candidate: it is
> in `loops/cat-test/` off jsDelivr, in the importmap, no build step. What it actually took to
> make it behave — the priority-order trap, forces vs weights, and why constant speed matters —
> is in `CLAUDE.md` under "Steering the cat — Yuka". Read that, not just this.

Game-AI library by **Mugen87**, a three.js core maintainer — so it is built against our stack
by someone who works on it. MIT, **zero dependencies**, ships an ES module build, so it drops
into an importmap with no build step:

```
https://cdn.jsdelivr.net/npm/yuka@0.7.8/build/yuka.module.js   (443 KB unminified)
```

**Split the job before evaluating it.** Yuka decides *where the cat goes and when it changes
its mind*. It does not move a single bone — the walk cycle is still glTF clips on an
`AnimationMixer`. Two separate problems; Yuka only solves the first. Feeding the cat's Yuka
speed into the walk clip's `timeScale` is what keeps the feet from skating.

What it carries that maps onto the known UE cat failures (`CLAUDE.md`, Handoff §9):

- **Obstacle avoidance + a real navmesh.** The UE cat walks through walls because
  `CatWanderBehavior` never consults nav at all — it just faces a direction and pushes. Yuka
  constrains movement to the mesh instead of steering advisorily. This is the headline reason
  to look at it.
- **`WanderBehavior` on a proper vehicle model** — replaces the hand-rolled arc/commit logic
  whose 90° sweeps and blind `HeadingCommitDistance` walks *are* the wall-walking.
- **`StateMachine`** — idle → walk → sit → sleep. This is what makes him read as a cat rather
  than a roomba, and it is the part with no UE equivalent worth porting.
- Also has perception (vision, short-term memory), triggers, fuzzy logic, goal-driven agents,
  and JSON serialisation. All likely overkill for a loop; do not let the feature list set the
  scope.

**The catch: last published 2022-09-17 (v0.7.8), quiet ever since.** Not disqualifying —
no dependencies means nothing rots out from under it — but nobody is fixing a bug we find.
Weigh that against hand-writing steering behaviours, which is roughly a week.

**Nothing has been built or installed.** The next step, if chosen, is a throwaway
`loops/cat-test/` with a *cube* wandering the factory floor — prove Yuka drives something
sensibly around the real geometry before committing the actual cat and a rig decision to it.

### Candidate for the cat's *legs* — [Ossos](https://github.com/sketchpunklabs/ossos) (collected 2026-08-16)

Web character-animation system by **sketchpunklabs**. TypeScript, MIT, three.js examples in
the repo. This is the **other half of the Yuka split above** — Yuka decides where the cat
goes, Ossos is about how the body moves once it gets there. Neither replaces the other.

```
https://cdn.jsdelivr.net/npm/ossos@0.0.3/dist/ossos.es.js   (110 KB)
```
Not dependency-free like Yuka — needs `gl-matrix`, so the importmap gains a second entry.
Still no build step.

The three things in it that would actually matter to a cat:

- **IK solvers** (Aim, SwingTwist, Limb, FABRIK, CCD, +). The prize is **foot planting** —
  paws meeting the floor instead of floating above or sinking through it, which is the tell
  that separates a real walk from a clip playing on a sliding object.
- **Bone springs (rotation + translation).** Tail and ear follow-through for free. On a cat
  this is disproportionately valuable — the tail is most of the personality, and hand-keying
  secondary motion is exactly the work we do not want.
- **Animation retargeting for similar skeletal meshes.** Worth noting against the open rig
  decision above: this is in principle the bridge that puts the Fab cat's proven `Walk_F_RM`
  onto our own `SK_Cat`. Temper it heavily though — the README says *basic* and *similar*,
  and 23 bones vs 51 bones is not similar. Do not treat this as a solved path.

**Rate this well below Yuka. Four separate signals say early:**

- npm is at **v0.0.3, published 2022-03-03**. Version zero-point-zero-point-three.
- `main` has not moved since **2023-03-30**.
- There is an `ossos_next` branch — i.e. an in-flight rewrite — last touched **2025-11-19**,
  so the stable branch is the abandoned one and the live branch is unreleased.
- **Quadruped IK is explicitly marked *"Prototype Phase"* in the README.** The cat is a
  quadruped. The one feature we would lean on hardest is the one the author flags as
  unfinished. That is the sentence that should decide this, not the feature list.

**And the alternative is closer than it looks:** three.js already ships `CCDIKSolver` at our
pinned 0.169.0 (`three/addons/animation/CCDIKSolver.js`, verified 200 on the CDN), and bone
springs are a short hand-rolled damped-spring on a couple of tail bones. So unlike Yuka —
where the alternative was writing steering behaviours from scratch — Ossos is not load-bearing.

**Suggested posture: read it, don't depend on it.** MIT, so the solvers and the spring maths
can be lifted directly into `tools/` if we want them, without inheriting a v0.0.3 dependency
on a library mid-rewrite. Revisit properly if `ossos_next` ever ships.

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
