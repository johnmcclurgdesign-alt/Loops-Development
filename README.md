# Loops — real-time scenes in the browser

Live, endlessly-running 3D scenes built with [Three.js](https://threejs.org/) —
no build step, no install, the browser is the renderer.

**Live:** https://johnmcclurgdesign-alt.github.io/Loops-Development/
**Repos:** [source of truth (team, private)](https://github.com/CollectivusWorlds/Loops-Development-WebGL) · [public deploy mirror](https://github.com/johnmcclurgdesign-alt/Loops-Development)

The team repo is where the work happens; the public mirror exists only so
GitHub Pages can serve the site. Pushes from the main working clone land in
both, so the live site follows the team repo one push behind.

## What's here

- **The Dripping Pickle** (`loops/dripping-pickle/`) — the production scene: a
  warehouse lit in real time (probe-grid bounce, PCSS sun, measured
  skylights), TVs playing video that you can click to zoom into, and a cat
  asleep on the rug. The dashboard offers it two ways: the clean show, and a
  Developer Mode with light dials and the feedback panel.
- **Cat Sequencer** (`loops/cat-sequencer/`) — the cat's workshop: 43 clips,
  six coats, steering rather than paths.
- **Feedback tracker** (`feedback/`) — every review note, filterable and
  sortable, each one linking back to the exact camera it was written from.

## Running it locally

No dependencies. Any static server works, but the project's own dev server
also lets the feedback panel write notes into the repo (and auto-pushes them):

```bash
node tools/dev-server.mjs 5173
```

Then open http://localhost:5173

## Repo shape

```
index.html              dashboard — links to every loop
loops/<name>/index.html one self-contained scene per folder
assets/<name>/          .glb files, textures, video for that loop
tools/                  shared modules (lighting, lens, feedback) + dev server
feedback/               the notes tracker and its records
```

`CLAUDE.md` carries the full engineering log — every trap, measurement and
ritual, in detail.
