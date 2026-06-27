#!/usr/bin/env node
/**
 * TTS cache report + eviction — see which cached voice syntheses earn their keep
 * (high hit count) vs the one-offs you can remove.
 *
 *   node scripts/tts-cache.mjs stats
 *   node scripts/tts-cache.mjs evict --max-hits 1          # drop one-shots
 *   node scripts/tts-cache.mjs evict --older-than-days 30  # drop stale entries
 *
 * Reads ~/.codebuddy/tts-cache/manifest.json (override with CODEBUDDY_TTS_CACHE_DIR).
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = process.env.CODEBUDDY_TTS_CACHE_DIR || join(homedir(), '.codebuddy', 'tts-cache');
const manifestPath = join(dir, 'manifest.json');

function load() {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return m?.entries && typeof m.entries === 'object' ? m : { version: '1', entries: {} };
  } catch {
    return { version: '1', entries: {} };
  }
}
function save(m) {
  writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`, 'utf-8');
}
function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2] || 'stats';
const m = load();
const entries = Object.values(m.entries).sort(
  (a, b) => b.hits - a.hits || String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)),
);

if (cmd === 'stats') {
  if (entries.length === 0) {
    console.log(`(cache vide — ${manifestPath})`);
    process.exit(0);
  }
  const totalKo = (entries.reduce((s, e) => s + (e.sizeBytes || 0), 0) / 1024).toFixed(0);
  console.log(`TTS cache : ${entries.length} entrées, ${totalKo} Ko — ${dir}\n`);
  console.log('hits  dernière utilisation   taille  texte');
  for (const e of entries) {
    const ko = `${((e.sizeBytes || 0) / 1024).toFixed(0)}Ko`.padStart(6);
    console.log(`${String(e.hits).padStart(4)}  ${String(e.lastUsedAt || '').slice(0, 19)}  ${ko}  ${JSON.stringify((e.text || '').slice(0, 60))}`);
  }
  const oneOffs = entries.filter((e) => e.hits <= 1).length;
  console.log(`\n${oneOffs} entrée(s) à ≤1 hit (one-shot) — évincables : node scripts/tts-cache.mjs evict --max-hits 1`);
} else if (cmd === 'evict') {
  const maxHits = flag('--max-hits') !== undefined ? Number(flag('--max-hits')) : undefined;
  const olderDays = flag('--older-than-days') !== undefined ? Number(flag('--older-than-days')) : undefined;
  if (maxHits === undefined && olderDays === undefined) {
    console.error('Usage: evict --max-hits N | --older-than-days D');
    process.exit(1);
  }
  const cutoff = olderDays !== undefined ? Date.now() - olderDays * 86_400_000 : undefined;
  let removed = 0;
  for (const [key, e] of Object.entries(m.entries)) {
    const low = maxHits !== undefined && e.hits <= maxHits;
    const stale = cutoff !== undefined && Date.parse(e.lastUsedAt) < cutoff;
    if (low || stale) {
      try {
        rmSync(join(dir, `${key}.wav`), { force: true });
      } catch {
        /* best-effort */
      }
      delete m.entries[key];
      removed += 1;
    }
  }
  save(m);
  console.log(`Évincé ${removed} entrée(s). Reste ${Object.keys(m.entries).length}.`);
} else {
  console.error('Commandes : stats | evict [--max-hits N] [--older-than-days D]');
  process.exit(1);
}
