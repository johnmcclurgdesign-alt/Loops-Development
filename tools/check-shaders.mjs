// Guard against the one syntax error that keeps costing a debugging round here.
//
// GLSL lives in JS template literals, and a backtick inside a GLSL comment CLOSES the
// literal. The SyntaxError you get points at the next GLSL word — "Unexpected identifier
// 'phi'", "Unexpected identifier 'd'" — which is nowhere near the backtick, so it reads as
// a shader problem rather than a quoting one. It has happened twice.
//
//   node tools/check-shaders.mjs
//
// Exits non-zero and names the file and line if any shader block contains a backtick.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'assets') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (['.js', '.mjs', '.html'].includes(extname(e.name))) yield p;
  }
}

// A shader block is a template literal that opens right after a `/* glsl */` marker or is
// assigned to something whose name says shader. Rather than parse JS, scan for the marker
// and for the vertexShader/fragmentShader property form, then read to the closing backtick.
const OPENERS = [
  /\/\*\s*glsl\s*\*\/\s*`/g,
  /(?:vertexShader|fragmentShader)\s*:\s*`/g,
];

let bad = 0;
for await (const file of walk(ROOT)) {
  const src = await readFile(file, 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;

  for (const re of OPENERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length;
      // Walk forward to the closing backtick, honouring \` escapes and ${ } spans.
      let i = start, depth = 0;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { i++; continue; }
        if (c === '$' && src[i + 1] === '{') { depth++; i++; continue; }
        if (c === '}' && depth > 0) { depth--; continue; }
        if (c === '`' && depth === 0) break;
      }
      // The stray backtick is the thing that ENDED the literal, so it is never "inside"
      // the body — checking the body is how the first version of this file passed a file
      // that was actually broken. The correct invariant: a shader literal must not end on
      // a line that is a GLSL comment. A healthy block closes on `; or `, or `) .
      const endLine = src.slice(src.lastIndexOf('\n', i) + 1, i);
      if (endLine.includes('//')) {
        console.error(`${file}:${lineOf(i)}: shader literal ends inside a GLSL comment — a backtick in the comment closed it early`);
        console.error(`    ${endLine.trim()}\``);
        bad++;
      }
      re.lastIndex = i + 1;
    }
  }
}

if (bad) {
  console.error(`\n${bad} shader block(s) contain a backtick in a comment.`);
  process.exit(1);
}
console.log('shader blocks clean — no backticks inside GLSL comments');
