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

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] ?? 5173);
const FEEDBACK_DIR = join(ROOT, 'feedback');
const SHOTS_DIR = join(FEEDBACK_DIR, 'shots');
const NOTES = join(FEEDBACK_DIR, 'notes.json');

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

async function loadNotes() {
  try { return JSON.parse(await readFile(NOTES, 'utf8')); }
  catch { return []; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- feedback endpoints -------------------------------------------------
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    try {
      const note = JSON.parse((await readBody(req)).toString('utf8'));
      await mkdir(SHOTS_DIR, { recursive: true });

      const notes = await loadNotes();
      const id = 'n' + String(notes.length + 1).padStart(3, '0');
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
