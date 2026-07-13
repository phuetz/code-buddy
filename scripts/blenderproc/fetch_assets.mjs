#!/usr/bin/env node
/**
 * Fetch a small set of CC0 Poly Haven models by KEYWORD (no guessed slugs),
 * laid out as `<out>/<coco_class>/<slug>.<ext>` — the layout scene.py expects.
 *
 * Prefers SELF-CONTAINED formats (.blend, then .glb): a bare Poly Haven .gltf is
 * only the JSON descriptor (its .bin + textures are separate) and would import
 * empty. Self-contained (Node ≥18 global fetch, no deps) so it runs on DARKSTAR
 * (Windows) too:  node scripts/blenderproc/fetch_assets.mjs [outDir] [perClass]
 *
 * The class names are COCO classes the perceiver (YOLO) knows, so ground truth
 * lines up. Note: CC0 banks skew toward furniture/props — there are no rigged
 * "person" meshes here (add those from a dedicated source for presence tests).
 */
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const API = 'https://api.polyhaven.com';
const OUT = process.argv[2] || './vision-assets';
const PER_CLASS = Number(process.argv[3] || '2');

// COCO class → keyword substrings matched against categories/tags/slug.
const CLASS_KEYWORDS = {
  chair: ['chair'],
  couch: ['sofa', 'couch'],
  'dining table': ['table'],
  'potted plant': ['plant', 'ficus', 'pot plant'],
  vase: ['vase'],
  book: ['book'],
  bottle: ['bottle'],
  cup: ['cup', 'mug'],
  laptop: ['laptop'],
  tv: ['tv', 'monitor', 'television'],
};

function firstFileUrl(node, ext, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  if (typeof node.url === 'string' && node.url.split('?')[0].toLowerCase().endsWith(ext)) return node.url;
  for (const v of Object.values(node)) {
    const u = firstFileUrl(v, ext, seen);
    if (u) return u;
  }
  return null;
}

async function resolveUrl(slug) {
  const res = await fetch(`${API}/files/${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  const files = await res.json();
  for (const ext of ['.blend', '.glb']) {
    const url = firstFileUrl(files, ext);
    if (url) return { url, ext };
  }
  return null;
}

const catRes = await fetch(`${API}/assets?type=models`);
if (!catRes.ok) {
  console.error(`Poly Haven catalog fetch failed: ${catRes.status}`);
  process.exit(1);
}
const catalog = await catRes.json();
const entries = Object.entries(catalog); // [slug, {categories, tags, name}]

let ok = 0;
for (const [cls, keywords] of Object.entries(CLASS_KEYWORDS)) {
  const matches = entries
    .filter(([slug, meta]) => {
      const hay = [slug, ...(meta.categories ?? []), ...(meta.tags ?? [])].join(' ').toLowerCase();
      return keywords.some((k) => hay.includes(k));
    })
    .slice(0, PER_CLASS);
  for (const [slug] of matches) {
    try {
      const found = await resolveUrl(slug);
      if (!found) { console.warn(`- skip ${cls}/${slug} (no blend/glb)`); continue; }
      const dir = join(OUT, cls);
      await mkdir(dir, { recursive: true });
      const bin = Buffer.from(await (await fetch(found.url)).arrayBuffer());
      await writeFile(join(dir, `${slug}${found.ext}`), bin);
      console.log(`✓ ${cls}/${slug}${found.ext}  (${(bin.length / 1024 / 1024).toFixed(1)} MB)`);
      ok++;
    } catch (e) {
      console.warn(`- error ${cls}/${slug}: ${e.message}`);
    }
  }
}
console.log(`\nDone: ${ok} asset(s) into ${OUT}/  (CC0 — commercial OK). Next: blenderproc run scripts/blenderproc/scene.py -- --assets ${OUT} --out out --count 12`);
