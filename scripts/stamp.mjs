// Fingerprint every file the page loads, so a phone or iPad never runs a stale mix.
// Rewrites index.html: ?v=<hash> on styles.css and main.js, an import map for every
// module, and <meta name="version">. Run after changing anything in src/ or styles.css:
//   node scripts/stamp.mjs          write index.html
//   node scripts/stamp.mjs --check  exit 1 if index.html is out of date (CI)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function stamped(){
  const mods = walk(join(root, 'src')).filter(f => f.endsWith('.js')).sort()
    .map(f => ['./' + relative(root, f).split('\\').join('/'), hash(readFileSync(f))]);
  const css = hash(readFileSync(join(root, 'styles.css')));
  const version = hash(mods.map(m => m.join('=')).join() + css);
  const map = JSON.stringify({ imports: Object.fromEntries(mods.map(([p, h]) => [p, `${p}?v=${h}`])) });
  const main = mods.find(([p]) => p === './src/main.js')[1];
  let html = readFileSync(join(root, 'index.html'), 'utf8');
  html = html
    .replace(/<meta name="version"[^>]*>\n?/, '')
    .replace(/<script type="importmap">.*?<\/script>\n?/s, '')
    .replace(/<link rel="stylesheet" href="styles\.css[^"]*">/, `<meta name="version" content="${version}">\n<script type="importmap">${map}</script>\n<link rel="stylesheet" href="styles.css?v=${css}">`)
    .replace(/<script type="module" src="src\/main\.js[^"]*">/, `<script type="module" src="src/main.js?v=${main}">`);
  return { html, version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)){
  const { html } = stamped(), file = join(root, 'index.html');
  if (process.argv.includes('--check')){
    if (readFileSync(file, 'utf8') !== html){ console.error('index.html is stale: run node scripts/stamp.mjs'); process.exit(1); }
  } else writeFileSync(file, html);
}
