# The Dripping Pickle

A 3D scene in the browser, built with [Three.js](https://threejs.org/).

**Live:** https://johnmcclurgdesign-alt.github.io/dripping-pickle/

## Status

Starter scene: a spinning cube on a floor, with drag-to-orbit and scroll-to-zoom.
The cube is a placeholder — a pickle goes there.

## Running it locally

No build step, no dependencies to install. Three.js loads from a CDN.
You just need any local web server (opening the file directly won't work —
browsers block JavaScript modules on `file://`).

```bash
python -m http.server 5173
```

Then open http://localhost:5173

## Files

- `index.html` — the whole thing: scene, camera, lights, render loop
