# Inspiration — what I actually saw

Notes from visiting the reference list on 2026-08-14. Organised by what we can take,
not by site. Screenshots were taken live; anything marked *(not reached)* I did not see.

---

## The two big conclusions

**1. Both registers are provably achievable in a browser. This is settled.**

The reference set contains a near-photoreal interior *and* a flat stylized illustration,
and both read as expensive. So "stylized vs photoreal" is not a technical question for
us — it's purely an art call, per loop. Keeping the option open costs us nothing.

**2. Everyone in this scene ships a live control panel.**

Six of the sites expose a slider panel — bloom threshold, curl noise, wind speed, film
grain, colour pickers. It is standard practice here, not a debug leftover. **This is the
single most useful thing for how we work together:** if every scene ships a tuning panel,
art direction stops being "describe it to me and wait" and becomes you moving a slider.
I should build one into every loop from now on.

---

## Site by site

### The closest thing to our project
**webgl-boxing-gym.vercel.app** — Sébastien Lempens. A grimy basement gym, near-photoreal.
Baked lighting, hard daylight through a horizontal slot window, visible dust in the beam,
worn concrete and brick, warm light against cool shadow. This is *the pickle factory
interior*, already solved. The technique is baked lightmaps out of Blender — not
real-time lights. If we want the photoreal end, this is the proof and the recipe.

### The most beautiful
**above-the-grassland.pages.dev** — Ameen Abdullah. WebGPU grass field. Misty rolling
hills, golden rim light catching only the ridge crests, everything distant dissolving to
pale sky-blue. No hard edge anywhere in frame. Loading screen counts to 100 and offers
"ENTER THE FIELD" — the load is part of the piece, not an apology for it.
Takeaway: **atmospheric perspective is the biggest single "expensive" cue.** Distant
geometry desaturating toward the sky colour does more than any amount of detail.

### The one that resets expectations
**mengto.github.io/towers** — A Japanese castle assembling itself, in flat cream/sage
illustration tones. Zero photorealism. Reads as expensive as anything else on the list.
Layered hills in flat tints for depth, editorial typography sitting *in* the composition,
and viewer controls across the top: **STYLE / WEATHER / TIME / SOUND / REBUILD**.
Takeaway: a loop the viewer can change the weather of is a much better deliverable than
a loop they can only watch.

### Mood and light
**webgl-monkey-island.vercel.app** — Lempens again. Night jungle, torch fire throwing warm
orange against deep blue moonlight, light scattering across water. Textbook warm/cool
split. Exposes Scene / Camera / Lights panels.

**ameen-abdullah.dev** — Near-black field, one glowing cherry tree, petals drifting with
iridescent fringing on each petal. Almost nothing on screen and it still holds. Restraint.

**bruno-simon.com** — The canonical WebGL portfolio, now neon synthwave: a driveable car
on a glowing disc, purple grid horizon, heavy bloom. Playable, not just watchable.

**samsy.ninja** — Cyberpunk Tokyo, dense neon signage in near-total darkness. Very low key.
Interesting as a lighting extreme: almost the whole frame is black and it still reads.

### Technique references
**noisy-gradient-webgl.vercel.app** — Flowing abstract gradient under *heavy* film grain
(grain sat at 0.65 — far higher than I'd have dared). Exposed controls for speed, scale,
specular, three colours, bloom, grain. Proof that grain can be a headline feature.

**particles-transition-webgpu.vercel.app** — WebGPU particle system, 145 fps, with the
most complete control panel of the set: curl noise scale/speed/strength, wind, particle
life, transition noise. Technical reference for building a real particle system.

### Directories to hunt in
- **mesh3d.gallery/websites** — curated Three.js/WebGL sites, filterable by tag, maker,
  and technology. The best hunting ground of the three.
- **threejsresources.com** *(not reached)*
- **recent.design/websites** *(not reached)*
- **collectui.com/designs/3d-ui-design-inspiration** *(not reached)*

### Did not render
**webgl-skydiving.vercel.app**, **r3f-flow-field-particles.vercel.app** — both returned a
blank dark canvas after a long wait. Possibly WebGPU-gated or needing interaction. Worth a
second try. **webxr-island-family.vercel.app** and **sebastien-lempens.com** *(not reached)*.

---

## What to steal, concretely

1. **Ship a `lil-gui` panel in every scene.** Palette, fog density, bloom, grain, exposure,
   camera speed. Hidden behind a key press for the team build, open for us.
2. **Viewer-facing state, not just viewer-facing pixels.** Weather / time-of-day / mood as
   a control, the way Towers does it.
3. **Atmospheric perspective everywhere.** Fog colour == sky colour, always. Distant
   geometry should desaturate, not just dim.
4. **Rim light only on the silhouette edge.** The grassland reads as lit almost entirely
   from one thin gold line along each ridge.
5. **Make the loading screen part of the piece.** A counter and a deliberate "enter".
6. **Be braver with grain.** We're running 0.016. The reference is running 4× that.
7. **Bake lighting in Blender for the photoreal register.** Real-time lights are not how
   the boxing gym got there.
8. **One well-lit object beats a full scene.** Ameen's cherry tree is one asset in a black
   void and it's the most memorable frame in the set.
