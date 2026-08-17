// Walk the cat around a real room without walking through it.
//
// This is the cat-sequencer steering with the circular leash taken out and wall avoidance
// put in. Everything that was learned there still applies and is repeated here rather than
// cross-referenced, because the failure modes are all silent:
//
//   ★ A CAT CHANGES DIRECTION, NOT PACE. Steering is used for its DIRECTION only. A steering
//     force is a vector and part of it points along the velocity, so letting it drive speed
//     brakes him — measured 0.45 -> 0.07 m/s when the old leash fired, and at the bottom of
//     that the heading is noise, so he stopped and spun: 367 pivot frames in five minutes.
//     Instead: hold `travelDir` across frames, move it toward what steering asked by at most
//     maxTurnRate * dt, and rebuild the velocity at a CONSTANT speed. The path radius is then
//     speed / turnRate by construction rather than by hoping the forces work out.
//   ★ SET AN ARC RADIUS IN METRES, never a force or a turn speed. force = v^2/r, rate = v/r.
//   ★ WanderBehavior picks its target on a SPHERE, so it will steer a ground animal into the
//     air. Pin y every frame.
//   ★ setRenderComponent needs matrixAutoUpdate = false, or three recomposes the matrix from
//     position/quaternion and silently discards everything Yuka wrote — he animates
//     perfectly on the spot and never moves an inch.
//   ★ Start with a non-zero velocity or the first frames have no heading to face: measured
//     522 deg/s against a 47 deg/s cap, then clean forever after.
//   ★ Low jitter does NOT read as calm, it reads as driving in circles. 9 is the default.
//     Do not widen radius/distance to compensate — that makes the circling worse.
//
// ── AVOIDANCE, AND WHY IT IS A GRID AND NOT RAYCASTS ─────────────────────────────────────
// The obvious build is a fan of raycast whiskers. three's Raycaster is linear in triangles
// with no BVH, and this building is 428k of them — seven whiskers a frame is three million
// triangle tests per frame for a cat. So the room is measured ONCE into a coarse walkability
// grid and the whiskers become array lookups.
//
// A cell is blocked if any mesh's bounding box overlaps it in XZ *and* overlaps the cat's
// own height band in Y. The band is what keeps the floor walkable and the roof irrelevant
// without needing to name either. Boxes are coarse — a diagonal beam blocks its whole
// rectangle — which is the right error to make: he keeps clear of things rather than
// clipping them.
//
// ★ THE LOOKAHEAD MUST BE LONGER THAN THE TURNING CIRCLE OR AVOIDANCE IS IMPOSSIBLE BY
// CONSTRUCTION. He cannot turn tighter than the arc radius, so a wall spotted at less than
// that distance is already a collision. Derived from the radius, never typed.

import * as THREE from 'three';
import * as YUKA from 'yuka';

/**
 * What travel speed was this walk clip authored for? Measured off the clip, not guessed.
 *
 * ★ FOOT SLIDE IS ONE NUMBER AND IT IS THIS ONE. Clip rate = travel speed / authored speed,
 * so the paws only stay planted when the authored speed is right. It had been ASSUMED to be
 * 0.45 to match the travel speed, which makes the rate exactly 1.0 and looks deliberate. It
 * is really 0.472, so the paws were sweeping backward 4.9% faster than the room was going
 * past — about 2 cm of slip per stance. Small, and exactly what "a tiny bit of foot slide"
 * looks like.
 *
 * HOW: freeze the body at the origin, so a claw's world position IS its position relative to
 * the cat. Step the clip. A paw that is planted must sweep backward at precisely the travel
 * speed, so the backward speed of a claw during its stance phase is the answer. Stance is the
 * bottom of its vertical travel, which needs no threshold picked by eye — the lift is only
 * 3-4 cm and the bottom 15% of it is unambiguous.
 *
 * Measured here: all four claws inside 0.471-0.473, quartiles 0.467-0.475. That tight a
 * spread is why a single number can kill this almost completely.
 *
 * Re-run it after ANY re-export of the walk clip rather than carrying the number forward.
 */
export function measureAuthoredSpeed({ model, mixer, action, samples = 240 } = {}) {
  let skinned = null;
  model.traverse((o) => { if (!skinned && o.isSkinnedMesh) skinned = o; });
  if (!skinned || !action) return null;
  const claws = skinned.skeleton.bones.filter((b) => /^claw_/.test(b.name));
  if (!claws.length) return null;

  const saved = model.matrix.clone();
  const wasTime = action.time, wasWeight = action.getEffectiveWeight();
  const wasRunning = action.isRunning();
  const wasAuto = model.matrixAutoUpdate;
  action.play().setEffectiveWeight(1);
  // ★ THE SAME matrixAutoUpdate TRAP AS setRenderComponent, IN A NEW PLACE, AND IT DOES NOT
  // LOOK LIKE ONE. Freezing the body means writing `matrix` — but with matrixAutoUpdate on,
  // updateMatrixWorld RECOMPOSES it from position/quaternion/scale on the very next line and
  // the identity is gone. The claws then get measured in WORLD space, so the cat's yaw rotates
  // the backward sweep out of Z and the answer comes back short by cos(yaw): 0.197 against a
  // true 0.472 at 125 degrees. It reads as a plausible number, which is what makes it nasty —
  // and it then sets the clip rate to 2.29 and gives you far MORE slide than you started with.
  model.matrixAutoUpdate = false;
  model.matrix.identity();
  model.updateMatrixWorld(true);

  const dur = action._clip.duration, dt = dur / samples;
  const track = claws.map(() => []);
  const p = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    action.time = i * dt;
    mixer.update(0);                       // evaluate at this time without advancing it
    model.updateMatrixWorld(true);
    claws.forEach((b, k) => { b.getWorldPosition(p); track[k].push({ y: p.y, z: p.z }); });
  }

  model.matrix.copy(saved);
  model.matrixAutoUpdate = wasAuto;
  model.updateMatrixWorld(true);
  action.time = wasTime; action.setEffectiveWeight(wasWeight);
  if (!wasRunning) action.stop();

  const medians = [];
  for (const s of track) {
    const ys = s.map((q) => q.y);
    const lo = Math.min(...ys), thr = lo + (Math.max(...ys) - lo) * 0.15;
    const v = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i].y <= thr && s[i - 1].y <= thr) {
        const back = -(s[i].z - s[i - 1].z) / dt;   // forward is +Z, so a planted paw goes -Z
        if (back > 0) v.push(back);
      }
    }
    if (v.length) { v.sort((a, b) => a - b); medians.push(v[Math.floor(v.length / 2)]); }
  }
  if (!medians.length) return null;
  return medians.reduce((a, b) => a + b, 0) / medians.length;
}

export function createCatWalk({
  model,                    // the loaded cat scene
  building,                 // what he must not walk through
  floorY,                   // world Y he stands on
  speed = 0.45,             // metres per second, constant
  turnRadius = 0.55,        // ★ the arc, in metres. Everything else derives from it.
  stride = 0.45,            // the travel speed the walk clip was authored for
  jitter = 9,               // wander restlessness
  cell = 0.3,               // walkability grid resolution, metres
  clearance = 0.22,         // how far his body is kept off a blocked cell, metres
  personal = 0.55,          // radius of the probe ring that keeps him off the skirting
  onClip = () => {},        // (name) => void — the scene owns the mixer
} = {}) {

  // ── measure the room once ──────────────────────────────────────────────────
  const bounds = new THREE.Box3().setFromObject(building);
  // The band a cat actually occupies. Anything overlapping it is in his way; the floor
  // stops just below it and the roof starts far above, so neither needs naming.
  const bandLo = floorY + 0.06, bandHi = floorY + 0.55;

  const nx = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / cell));
  const nz = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / cell));
  const blocked = new Uint8Array(nx * nz);
  const idx = (ix, iz) => iz * nx + ix;

  const box = new THREE.Box3();
  let blockers = 0;
  building.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    box.setFromObject(o);
    if (box.max.y < bandLo || box.min.y > bandHi) return;   // above or below him
    blockers++;
    const ix0 = Math.max(0, Math.floor((box.min.x - clearance - bounds.min.x) / cell));
    const ix1 = Math.min(nx - 1, Math.floor((box.max.x + clearance - bounds.min.x) / cell));
    const iz0 = Math.max(0, Math.floor((box.min.z - clearance - bounds.min.z) / cell));
    const iz1 = Math.min(nz - 1, Math.floor((box.max.z + clearance - bounds.min.z) / cell));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) blocked[idx(ix, iz)] = 1;
  });

  // ★ "INSIDE THE BUILDING'S BOUNDING BOX" IS NOT "INSIDE THE ROOM", AND A DOORWAY IS THE
  // DIFFERENCE. The grid spans the whole bbox, so the ground OUTSIDE the walls is unblocked
  // too — and the building has a door. Measured: he walked out through it, and once past
  // the bbox every cell reads blocked, so avoidance had no clear heading to offer and he
  // simply kept going. Twenty minutes in he was 650 m away and still walking.
  //
  // So flood fill from where he starts and keep only that connected region. Anything he
  // cannot reach by walking becomes wall, which closes the doorway, the outside, and any
  // other leak nobody has found yet — without needing to name a single one of them.
  function confineToReachable(sx, sz) {
    let ix = Math.floor((sx - bounds.min.x) / cell);
    let iz = Math.floor((sz - bounds.min.z) / cell);
    ix = Math.min(nx - 1, Math.max(0, ix)); iz = Math.min(nz - 1, Math.max(0, iz));
    const reach = new Uint8Array(nx * nz);
    if (blocked[idx(ix, iz)]) return 0;                 // caller already relocated him
    const stack = [ix, iz];
    reach[idx(ix, iz)] = 1;
    let n = 1;
    while (stack.length) {
      const z0 = stack.pop(), x0 = stack.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x1 = x0 + dx, z1 = z0 + dz;
        if (x1 < 0 || z1 < 0 || x1 >= nx || z1 >= nz) continue;
        const i = idx(x1, z1);
        if (reach[i] || blocked[i]) continue;
        reach[i] = 1; n++; stack.push(x1, z1);
      }
    }
    for (let i = 0; i < blocked.length; i++) if (!reach[i]) blocked[i] = 1;
    return n;
  }

  // Outside the building is blocked too, so he cannot leave through a doorway.
  const isBlocked = (x, z) => {
    const ix = Math.floor((x - bounds.min.x) / cell);
    const iz = Math.floor((z - bounds.min.z) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return true;
    return blocked[idx(ix, iz)] === 1;
  };

  // How far the room is clear along a heading, up to `max`. Stepping at half a cell so a
  // corner cannot be missed between samples.
  const clearAhead = (x, z, ang, max) => {
    const sx = Math.sin(ang), sz = Math.cos(ang), step = cell * 0.5;
    for (let d = step; d <= max; d += step) {
      if (isBlocked(x + sx * d, z + sz * d)) return d - step;
    }
    return max;
  };

  // ── steering ───────────────────────────────────────────────────────────────
  const entityManager = new YUKA.EntityManager();
  const vehicle = new YUKA.Vehicle();
  const wander = new YUKA.WanderBehavior();
  // Leave these two. radius/distance is the maximum steer angle, atan(1/5) = 11 degrees.
  // Opening it parks the steer target further off centre so the sign takes LONGER to flip,
  // and the worst one-way sweep gets worse: 232 deg at radius 1, 699 at 2, 784 at 3.
  wander.radius = 1.0;
  wander.distance = 5.0;
  wander.jitter = jitter;
  vehicle.steering.add(wander);
  entityManager.add(vehicle);

  function applyTurn() {
    vehicle.maxSpeed = speed;
    vehicle.maxForce = (speed * speed) / turnRadius;
    vehicle.maxTurnRate = speed / turnRadius;
  }
  applyTurn();

  // Drop him on the first walkable cell at or near where the scene put him.
  const start = new THREE.Vector3();
  model.getWorldPosition(start);
  if (isBlocked(start.x, start.z)) {
    let best = null;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      if (blocked[idx(ix, iz)]) continue;
      const x = bounds.min.x + (ix + 0.5) * cell, z = bounds.min.z + (iz + 0.5) * cell;
      const d = (x - start.x) ** 2 + (z - start.z) ** 2;
      if (!best || d < best.d) best = { x, z, d };
    }
    if (best) start.set(best.x, start.y, best.z);
  }
  const reachable = confineToReachable(start.x, start.z);

  // Non-zero velocity from the first frame — see the note at the top.
  const a0 = Math.random() * Math.PI * 2;
  vehicle.position.set(start.x, floorY, start.z);
  vehicle.rotation.fromEuler(0, a0, 0);
  vehicle.velocity.set(Math.sin(a0) * speed, 0, Math.cos(a0) * speed);
  // Yuka's forward is +Z and this cat's head is +Z too, so no correction. Guess it wrong
  // and he moonwalks.
  vehicle.setRenderComponent(model, (entity, rc) => { rc.matrix.copy(entity.worldMatrix); });
  model.matrixAutoUpdate = false;   // REQUIRED — see the note at the top

  // The direction he is actually TRAVELLING. Held across frames so it can only change at
  // the arc's rate, which is what makes the path a curve rather than a set of instant turns.
  let travelDir = a0;
  // Somewhere known-good to aim at if he is ever found outside the walkable region.
  const home = { x: start.x, z: start.z };
  let lastClear = 99;

  // Candidate deviations, in radians, smallest first: he should prefer to keep going.
  // ★ SIGNED, AND THE SIGN IS CHOSEN PER FRAME. An unsigned fan tried in a fixed
  // [+, -, +, -] order always breaks ties to the same side, and in a corner that is a
  // stable orbit — measured a 20 s loop in one before this. Ask which way round is
  // actually more open first, then try that side at each deviation.
  const FAN = [0.35, 0.7, 1.15, 1.7, 2.4];

  function update(dt) {
    entityManager.update(dt);
    vehicle.position.y = floorY;          // wander steers on a sphere; pin the ground animal

    const v = vehicle.velocity;
    v.y = 0;
    let want = travelDir;
    if (v.x * v.x + v.z * v.z > 1e-8) want = Math.atan2(v.x, v.z);

    // ★ Lookahead is derived, not typed: he cannot turn tighter than the arc, so anything
    // closer than the turning circle is already unavoidable. 2.5x gives him room to commit
    // to a curve rather than a swerve.
    const look = Math.max(turnRadius * 2.5, 0.9);
    const px = vehicle.position.x, pz = vehicle.position.z;

    // Take the least-deviant heading that is clear. Measuring from `want` rather than from
    // `travelDir` keeps the wander's intent when the room allows it.
    lastClear = clearAhead(px, pz, want, look);
    if (lastClear < look) {
      // Which way round is more open? One probe each side, at the widest deviation.
      const wide = FAN[FAN.length - 1];
      const openL = clearAhead(px, pz, want + wide, look);
      const openR = clearAhead(px, pz, want - wide, look);
      const first = openL >= openR ? 1 : -1;
      let best = { ang: want, clear: lastClear };
      outer:
      for (const dev of FAN) {
        for (const sign of [first, -first]) {
          const a = want + dev * sign;
          const c = clearAhead(px, pz, a, look);
          if (c > best.clear) best = { ang: a, clear: c };
          if (c >= look) break outer;          // least deviation that is fully clear
        }
      }
      want = best.ang;
      lastClear = best.clear;
    }

    // ★ "CLEAR AHEAD" IS NOT THE SAME AS "NOT SCRAPING A WALL", and the difference is a cat
    // who paces the skirting board. Travelling PARALLEL to a wall reads as fully clear at
    // every lookahead, so nothing above objects while wander curves him back into it and out
    // again — measured two episodes of ~17 s spent inside 0.3 m of a wall, both with
    // clearance reading the full 1.38 m. So give him personal space as well as a path: a
    // short probe ring, and a nudge directly away from whatever is inside it. It is a bias
    // on the desired heading, not a force, so the constant-speed rule above still holds.
    let rx = 0, rz = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sx = Math.sin(a), sz = Math.cos(a);
      if (isBlocked(px + sx * personal, pz + sz * personal)) { rx -= sx; rz -= sz; }
    }
    if (rx || rz) {
      const away = Math.atan2(rx, rz);
      let d = away - want;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      // Gentle: a cat does walk near walls, it just does not sand them down.
      want += d * 0.35;
    }

    // ★ Direction only, rate limited, constant speed. This is the whole trick.
    let da = want - travelDir;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    travelDir += THREE.MathUtils.clamp(da, -vehicle.maxTurnRate * dt, vehicle.maxTurnRate * dt);
    // Wrap. sin/cos do not care, but this loop is meant to run FOREVER in a browser tab and
    // an angle that only ever accumulates is a slow precision leak — after a day of turning
    // it is a six-figure number of radians, and every heading it produces is that bit
    // coarser. Costs nothing to keep it in range.
    if (travelDir > Math.PI) travelDir -= 2 * Math.PI;
    else if (travelDir < -Math.PI) travelDir += 2 * Math.PI;
    v.set(Math.sin(travelDir) * speed, 0, Math.cos(travelDir) * speed);

    // Belt and braces: if a frame still lands him inside a blocked cell — a dt spike, or a
    // gap the grid could not see — push him back out rather than letting him walk on
    // through. Never happens in normal running; when it does, the alternative is a cat
    // inside a wall for the rest of the session.
    if (isBlocked(vehicle.position.x, vehicle.position.z)) {
      // Back out along the way he came, and AIM him home. Backing out alone is not a
      // recovery: outside the reachable region every heading reads blocked, so the fan has
      // nothing to offer and he keeps walking. That is how he ended up 650 m away.
      vehicle.position.x -= Math.sin(travelDir) * speed * dt * 2;
      vehicle.position.z -= Math.cos(travelDir) * speed * dt * 2;
      // Turn him home at the SAME rate limit as everything else. Assigning the heading
      // outright here is a pivot, and the safety net is not exempt from the one rule this
      // whole module exists to keep — measured a single 1040 deg/s frame in an hour, which
      // is one visible snap in an hour, which is one too many for a loop that plays forever.
      let hd = Math.atan2(home.x - vehicle.position.x, home.z - vehicle.position.z) - travelDir;
      while (hd > Math.PI) hd -= 2 * Math.PI;
      while (hd < -Math.PI) hd += 2 * Math.PI;
      travelDir += THREE.MathUtils.clamp(hd, -vehicle.maxTurnRate * dt, vehicle.maxTurnRate * dt);
      v.set(Math.sin(travelDir) * speed, 0, Math.cos(travelDir) * speed);
    }

    // The one place the two systems touch: travel speed drives clip rate. Matched, a paw
    // stays planted on a floorboard as it passes.
    onClip('walk', THREE.MathUtils.clamp(speed / stride, 0.35, 2.5));
  }

  return {
    update,
    vehicle,
    /** Debug: the grid, for drawing or for a test to assert against. */
    grid: { nx, nz, cell, min: bounds.min.clone(), blocked },
    stats: () => ({
      blockers, cells: nx * nz, reachable, stride,
      blockedCells: blocked.reduce((a, b) => a + b, 0),
      clearAhead: +lastClear.toFixed(2),
      pos: [+vehicle.position.x.toFixed(2), +vehicle.position.z.toFixed(2)],
      headingDeg: +(travelDir * 180 / Math.PI).toFixed(1),
    }),
    setSpeed: (v) => { speed = v; applyTurn(); },
    setTurnRadius: (v) => { turnRadius = v; applyTurn(); },
    setStride: (v) => { stride = v; },
    setJitter: (v) => { wander.jitter = v; },
  };
}
