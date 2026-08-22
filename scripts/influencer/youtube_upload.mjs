#!/usr/bin/env node
/**
 * Upload YouTube (chaîne LISA IA / AMBRE) via les credentials OAuth de ~/DEV/youtube-mcp — SANS passer par le MCP.
 *
 * Sécurité éditoriale : privacyStatus = "private" PAR DÉFAUT (Patrice relit dans YouTube Studio et passe en public).
 * Ne jamais passer --privacy public sans son accord explicite.
 *
 * Usage :
 *   node youtube_upload.mjs --file SHORT-x.mp4 --title "…" --description-file desc.txt [--tags "a,b,c"]
 *        [--privacy private|unlisted|public] [--category 28] [--lang fr] [--dry-run]
 *   node youtube_upload.mjs --pack PACK-PUBLICATION-SHORTS.md [--only 01,02] [--dry-run]
 *        → lit le pack (blocs "# Short NN — …", lignes "Fichier : `X.mp4`", sections "## Titre" / "## Description" / "## Tags"
 *          en blocs ``` ) et uploade chaque short en privé ; écrit un journal JSONL à côté du pack.
 *
 * Prérequis : ~/DEV/youtube-mcp/.env (GOOGLE_CLIENT_ID/SECRET) + tokens.json (OAuth déjà validé le 01/08/2026).
 * Catégorie 28 = Science & Technology. Quota API YouTube : un upload = 1600 unités (10 000/jour) → ≤ 6 uploads/jour.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const MCP_DIR = path.join(os.homedir(), 'DEV', 'youtube-mcp');
const require = createRequire(path.join(MCP_DIR, 'package.json'));
const { google } = require('googleapis');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(MCP_DIR, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function client() {
  const env = loadEnv();
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, 'http://localhost:8723');
  const tokens = JSON.parse(fs.readFileSync(path.join(MCP_DIR, 'tokens.json'), 'utf8'));
  oauth.setCredentials(tokens);
  oauth.on('tokens', (t) => {
    const merged = { ...tokens, ...t };
    fs.writeFileSync(path.join(MCP_DIR, 'tokens.json'), JSON.stringify(merged, null, 2));
  });
  return google.youtube({ version: 'v3', auth: oauth });
}

async function upload(yt, job, dry) {
  const file = path.resolve(job.file);
  if (!fs.existsSync(file)) throw new Error(`fichier introuvable : ${file}`);
  const sizeMB = (fs.statSync(file).size / 1048576).toFixed(1);
  const body = {
    snippet: {
      title: job.title.slice(0, 100),
      description: job.description ?? '',
      tags: job.tags ?? [],
      categoryId: job.category ?? '28',
      defaultLanguage: job.lang ?? 'fr',
      defaultAudioLanguage: job.lang ?? 'fr',
    },
    status: {
      privacyStatus: job.privacy ?? 'private',
      madeForKids: false,
      selfDeclaredMadeForKids: false,
      // Voix + B-roll générés : déclaration « contenu altéré ou synthétique » (YouTube l'exige pour les avatars IA)
      containsSyntheticMedia: true,
    },
  };
  console.log(`→ ${path.basename(file)} (${sizeMB} Mo) · "${body.snippet.title}" · ${body.status.privacyStatus}${dry ? ' · DRY-RUN' : ''}`);
  if (dry) return { dryRun: true, file, title: body.snippet.title };
  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    notifySubscribers: false,
    requestBody: body,
    media: { body: fs.createReadStream(file) },
  });
  const id = res.data.id;
  console.log(`   ✅ https://youtu.be/${id}  (${res.data.status?.privacyStatus})`);
  return { file, id, url: `https://youtu.be/${id}`, privacy: res.data.status?.privacyStatus, title: body.snippet.title };
}

function parsePack(packPath, only) {
  const md = fs.readFileSync(packPath, 'utf8');
  const dir = path.dirname(packPath);
  const blocks = md.split(/^# Short /m).slice(1);
  const jobs = [];
  for (const b of blocks) {
    const num = b.match(/^(\d+)/)?.[1];
    if (only && !only.includes(num)) continue;
    const file = b.match(/Fichier\s*:\s*`([^`]+\.mp4)`/)?.[1];
    const section = (name) => b.match(new RegExp(`## ${name}[^\\n]*\\n+\`\`\`[^\\n]*\\n([\\s\\S]*?)\`\`\``))?.[1]?.trim();
    const title = section('Titre');
    const description = section('Description');
    const tagsRaw = section('Tags');
    if (!file || !title) { console.warn(`⚠️ Short ${num} : fichier ou titre introuvable dans le pack — ignoré`); continue; }
    const tags = tagsRaw ? tagsRaw.split(/[,\n]/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 30) : [];
    jobs.push({ num, file: path.isAbsolute(file) ? file : path.join(dir, file), title, description, tags });
  }
  return jobs;
}

async function main() {
  const dry = !!arg('dry-run', false);
  const privacy = arg('privacy', 'private');
  if (privacy === 'public') console.warn('⚠️ --privacy public : publication IMMÉDIATE — à n\'utiliser qu\'avec l\'accord explicite de Patrice.');
  const yt = dry ? null : await client();
  const results = [];
  const pack = arg('pack', null);
  if (pack) {
    const only = arg('only', null) ? String(arg('only')).split(',').map((s) => s.padStart(2, '0')) : null;
    const jobs = parsePack(path.resolve(pack), only);
    console.log(`${jobs.length} short(s) dans le pack`);
    for (const j of jobs) {
      try { results.push(await upload(yt, { ...j, privacy }, dry)); }
      catch (e) { console.error(`   ❌ Short ${j.num} : ${e.message}`); results.push({ file: j.file, error: e.message }); }
    }
    const journal = path.resolve(pack).replace(/\.md$/, '') + '.uploads.jsonl';
    if (!dry) fs.appendFileSync(journal, results.map((r) => JSON.stringify({ ts: new Date().toISOString(), ...r })).join('\n') + '\n');
  } else {
    const file = arg('file'); const title = arg('title');
    if (!file || !title) { console.error('usage : --file X.mp4 --title "…" [--description-file f] | --pack PACK.md'); process.exit(2); }
    const description = arg('description-file', null) ? fs.readFileSync(arg('description-file'), 'utf8') : (arg('description', '') || '');
    const tags = arg('tags', null) ? String(arg('tags')).split(',').map((t) => t.trim()).filter(Boolean) : [];
    results.push(await upload(yt, { file, title, description, tags, privacy, category: arg('category', '28'), lang: arg('lang', 'fr') }, dry));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
