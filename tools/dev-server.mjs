// Local dev server. Serves the site exactly like `python -m http.server`, and adds
// one endpoint the browser can POST to so the feedback panel can write notes
// straight into the repo. Nothing here ships — GitHub Pages serves the static
// files and never sees this.
//
//   node tools/dev-server.mjs [port]

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] ?? 5173);
const FEEDBACK_DIR = join(ROOT, 'feedback');
const SHOTS_DIR = join(FEEDBACK_DIR, 'shots');
const NOTES = join(FEEDBACK_DIR, 'notes.json');
// Deleted notes are moved here rather than dropped. A note carries a screenshot and a
// camera that cannot be reconstructed, so a mis-click must be recoverable.
const DELETED = join(FEEDBACK_DIR, 'deleted.json');
// Cat behaviours authored in loops/cat-sequencer/. They live under assets/ rather
// than feedback/ because they are SHOW DATA, not review traffic — the warehouse
// cat is meant to run one by name.
const BEHAVIORS = join(ROOT, 'assets', 'cat', 'behaviors.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr':  'image/vnd.radiance',
  '.exr':  'image/x-exr',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { fail(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

// A missing file is not an error — nobody has authored a behaviour yet.
async function loadBehaviors() {
  try {
    const d = JSON.parse(await readFile(BEHAVIORS, 'utf8'));
    return { version: d.version ?? 1, behaviors: Array.isArray(d.behaviors) ? d.behaviors : [] };
  } catch { return { version: 1, behaviors: [] }; }
}

async function loadNotes() {
  try { return JSON.parse(await readFile(NOTES, 'utf8')); }
  catch { return []; }
}

async function loadDeleted() {
  try { return JSON.parse(await readFile(DELETED, 'utf8')); }
  catch { return []; }
}

// ★ NOT `notes.length + 1`, which is what this used to be. That only holds while notes are
// append-only: delete one and the next note reuses a LIVE id, whose screenshot is then
// overwritten in feedback/shots/ — the note keeps its text and silently gains someone
// else's picture. Take the highest id ever issued, deleted ones included, so a retired id
// is never handed out again while its .jpg is still on disk.
function nextId(...lists) {
  const max = lists.flat().reduce((m, n) => {
    const hit = /^n(\d+)$/.exec(n?.id ?? '');
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return 'n' + String(max + 1).padStart(3, '0');
}

// ── auto-push (2026-08-19) ──────────────────────────────────────────────────
// A note written into the repo used to sit UNCOMMITTED until someone remembered
// to file it — shots lingered in the working tree for hours. Now every write to
// feedback/ schedules a commit+push of that directory, debounced 5 s so a note
// and its screenshot (and a burst of tick-offs) land as ONE commit. Failures
// only warn: no remote, no auth, or offline must never break note-taking.
// NO_AUTOPUSH=1 turns it off for a session.
const git = (args) => new Promise((ok) =>
  execFile('git', args, { cwd: ROOT }, (err, stdout, stderr) =>
    ok({ err, out: String(stdout) + String(stderr) })));
let pushTimer = null;
const pushReasons = new Set();
function schedulePush(reason) {
  if (process.env.NO_AUTOPUSH) return;
  pushReasons.add(reason);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const what = [...pushReasons].join(', ');
    pushReasons.clear();
    let r = await git(['add', 'feedback']);
    if (r.err) { console.warn('  ↥ autopush add failed:', r.out.trim()); return; }
    r = await git(['commit', '-m', `Notes: ${what}`]);
    if (r.err) {
      if (!/nothing to commit/.test(r.out)) console.warn('  ↥ autopush commit failed:', r.out.trim());
      return;
    }
    r = await git(['push']);
    console.log(r.err
      ? `  ↥ committed (${what}) but push failed — push by hand when back online`
      : `  ↥ pushed to GitHub: ${what}`);
  }, 5000);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- feedback endpoints -------------------------------------------------
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    try {
      const note = JSON.parse((await readBody(req)).toString('utf8'));
      await mkdir(SHOTS_DIR, { recursive: true });

      const notes = await loadNotes();
      const id = nextId(notes, await loadDeleted());
      let shot = null;

      if (note.screenshot?.startsWith('data:image/')) {
        const [meta, b64] = note.screenshot.split(',');
        const ext = meta.includes('png') ? '.png' : '.jpg';
        shot = `shots/${id}${ext}`;
        await writeFile(join(FEEDBACK_DIR, shot), Buffer.from(b64, 'base64'));
      }
      delete note.screenshot;

      notes.push({ id, status: 'open', ...note, shot });
      await writeFile(NOTES, JSON.stringify(notes, null, 2) + '\n', 'utf8');

      console.log(`  ✎ ${id}  ${note.object ?? '(no object)'}  —  ${String(note.comment ?? '').slice(0, 60)}`);
      schedulePush(`${id} filed`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, shot }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    }
    return;
  }

  if (url.pathname === '/api/feedback' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await loadNotes()));
    return;
  }

  // Update an existing note — this is how a note gets closed off. Separate from the POST
  // above, which only ever APPENDS: a reviewer filing feedback and someone working through
  // it are different jobs, and conflating them is how you accidentally overwrite a note
  // while trying to tick it off. Only status and resolution are writable; the note's own
  // record of what was seen (object, camera, screenshot) is never edited after the fact.
  if (url.pathname === '/api/feedback/update' && req.method === 'POST') {
    try {
      const { id, status, resolution } = JSON.parse((await readBody(req)).toString('utf8'));
      const notes = await loadNotes();
      const note = notes.find((n) => n.id === id);
      if (!note) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'no such note: ' + id }));
        return;
      }
      if (status !== undefined) note.status = status;
      if (resolution !== undefined) note.resolution = resolution;
      note.updated = new Date().toISOString();

      await writeFile(NOTES, JSON.stringify(notes, null, 2) + '\n', 'utf8');
      console.log(`  ✓ ${id}  ${note.status}${note.resolution ? '  —  ' + note.resolution.slice(0, 60) : ''}`);
      schedulePush(`${id} ${note.status}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, note }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    }
    return;
  }

  // Delete a note. "Mark done" is for a note that was dealt with; this is for one that
  // should never have been filed — a duplicate, a test, a note against a loop that no
  // longer exists. It is NOT a harder version of closing, so it keeps no resolution.
  //
  // The record moves to feedback/deleted.json instead of being dropped: the screenshot and
  // the camera in a note cannot be reconstructed, and the button sits one row away from
  // "Mark done". The .jpg in feedback/shots/ is deliberately left where it is — the
  // tombstone still points at it, so an undelete is a copy back rather than a re-shoot.
  if (url.pathname === '/api/feedback/delete' && req.method === 'POST') {
    try {
      const { id } = JSON.parse((await readBody(req)).toString('utf8'));
      const notes = await loadNotes();
      const i = notes.findIndex((n) => n.id === id);
      if (i < 0) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'no such note: ' + id }));
        return;
      }
      const [gone] = notes.splice(i, 1);

      const tomb = await loadDeleted();
      tomb.push({ ...gone, deleted_at: new Date().toISOString() });
      await writeFile(DELETED, JSON.stringify(tomb, null, 2) + '\n', 'utf8');
      await writeFile(NOTES, JSON.stringify(notes, null, 2) + '\n', 'utf8');

      console.log(`  ✗ ${id}  deleted  —  moved to feedback/deleted.json`);
      schedulePush(`${id} deleted`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, notes }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    }
    return;
  }

  // Save a hero thumbnail straight out of a running loop. The gallery card wants a picture of
  // the scene at its own loop camera, and the only thing that can produce that is the scene
  // itself — there is no headless renderer here. So the browser captures its canvas and posts
  // the data URL, and this writes it to assets/thumbs/<id>.jpg.
  //
  // Capture note for whoever does the next one: a backgrounded tab never fires
  // requestAnimationFrame, so its drawing buffer is empty and toDataURL returns a blank
  // image that looks like a broken canvas. Drive one render by hand (__looks.render()) and
  // read the canvas in the SAME call. preserveDrawingBuffer must also be on, which it is
  // whenever the feedback panel is.
  if (url.pathname === '/api/thumb' && req.method === 'POST') {
    try {
      const { id, dataUrl } = JSON.parse((await readBody(req)).toString('utf8'));
      // The id becomes a filename, so it is not allowed to describe a path.
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) throw new Error('bad id: ' + id);
      const [meta, b64] = String(dataUrl ?? '').split(',');
      if (!/^data:image\/(jpeg|png);base64$/.test(meta ?? '')) throw new Error('expected a jpeg or png data URL');

      const dir = join(ROOT, 'assets', 'thumbs');
      await mkdir(dir, { recursive: true });
      const file = `${id}${meta.includes('png') ? '.png' : '.jpg'}`;
      const bytes = Buffer.from(b64, 'base64');
      await writeFile(join(dir, file), bytes);

      console.log(`  ▣ assets/thumbs/${file}  ${(bytes.length / 1024).toFixed(0)} KB`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: `assets/thumbs/${file}`, bytes: bytes.length }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    }
    return;
  }

  // ---- cat behaviour endpoints --------------------------------------------
  // Upsert by id, so Save on a loaded behaviour EDITS it rather than piling up
  // near-identical copies — which is what a plain append gives you the first
  // time someone tweaks a duration and saves again.
  if (url.pathname === '/api/behaviors' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await loadBehaviors()));
    return;
  }

  if (url.pathname === '/api/behaviors' && req.method === 'POST') {
    try {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      // The id is how the warehouse cat will ask for one by name, so it has to
      // stay a plain slug — no paths, no spaces, nothing that needs quoting.
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(b.id ?? '')) throw new Error('bad id: ' + b.id);
      if (!Array.isArray(b.steps) || !b.steps.length) throw new Error('a behaviour needs at least one step');

      const doc = await loadBehaviors();
      const i = doc.behaviors.findIndex((x) => x.id === b.id);
      const rec = {
        id: b.id,
        name: String(b.name ?? b.id),
        loop: b.loop !== false,
        notes: String(b.notes ?? ''),
        steps: b.steps.map((s) => ({
          clip: String(s.clip),
          seconds: Math.max(0.05, Number(s.seconds) || 0),
          fade: Math.max(0, Number(s.fade) || 0),
        })),
      };
      if (i >= 0) doc.behaviors[i] = rec; else doc.behaviors.push(rec);
      await mkdir(join(ROOT, 'assets', 'cat'), { recursive: true });
      await writeFile(BEHAVIORS, JSON.stringify(doc, null, 2) + '\n', 'utf8');

      const secs = rec.steps.reduce((a, s) => a + s.seconds, 0);
      console.log('  \u266a ' + rec.id + '  ' + (i >= 0 ? 'updated' : 'saved') +
                  '  \u2014  ' + rec.steps.length + ' steps, ' + secs.toFixed(1) + 's');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: rec.id, behaviors: doc.behaviors }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    }
    return;
  }

  if (url.pathname === '/api/behaviors/delete' && req.method === 'POST') {
    try {
      const { id } = JSON.parse((await readBody(req)).toString('utf8'));
      const doc = await loadBehaviors();
      const i = doc.behaviors.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('no such behaviour: ' + id);
      const [gone] = doc.behaviors.splice(i, 1);
      await writeFile(BEHAVIORS, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      console.log('  \u2717 ' + gone.id + '  behaviour deleted');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, behaviors: doc.behaviors }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    }
    return;
  }

  // ---- static files -------------------------------------------------------
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // assets change constantly during art direction; never let the browser
      // hold a stale .glb. This cost us an hour once already.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + p);
  }
});

await mkdir(SHOTS_DIR, { recursive: true });
server.listen(PORT, () => {
  console.log(`  serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  notes -> ${NOTES}`);
});
