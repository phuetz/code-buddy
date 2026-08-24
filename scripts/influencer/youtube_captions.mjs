#!/usr/bin/env node
/**
 * Dépose une piste de sous-titres EXACTE sur une vidéo YouTube déjà en ligne (chaîne LISA IA / AMBRE),
 * via les credentials OAuth de ~/DEV/youtube-mcp — sans passer par le MCP.
 *
 * Pourquoi : YouTube génère sa propre transcription automatique et son modèle francise les noms du
 * domaine (DeepSeek → « Deeppsych », Qwen → « Quen », Lisa → « Liya »). Cette transcription sert à
 * l'INDEXATION de la recherche. Déposer notre piste — fabriquée depuis le script par
 * `srt_from_script.py` — la remplace, sans re-rendre ni ré-uploader la vidéo.
 *
 * À faire AVANT le passage en public : YouTube indexe dès la publication.
 *
 * Usage :
 *   node youtube_captions.mjs --video EWvyPEbY19U --file piste.fr.srt [--name "Français"] [--lang fr]
 *        [--replace] [--dry-run] [--tokens ~/DEV/youtube-mcp/tokens-ambre.json]
 *   node youtube_captions.mjs --video EWvyPEbY19U --list
 *
 * Prérequis : le jeton doit porter le scope `youtube.force-ssl` (sinon 403
 * ACCESS_TOKEN_SCOPE_INSUFFICIENT). Il est déclaré dans ~/DEV/youtube-mcp/src/auth.ts ; une
 * ré-autorisation est nécessaire une fois : `cd ~/DEV/youtube-mcp && npm run auth`.
 *
 * Quota : captions.list = 50 unités, captions.insert = 400, captions.delete = 50 (10 000/jour).
 * Le paramètre `sync` n'existe plus (déprécié le 13/03/2024, retiré le 12/04/2024) : le fichier
 * DOIT porter ses propres horodatages — c'est le cas des pistes produites par srt_from_script.py.
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

async function client(tokensFile) {
  const env = loadEnv();
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, 'http://localhost:8723');
  const tokensPath = tokensFile ? path.resolve(tokensFile) : path.join(MCP_DIR, 'tokens.json');
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  if (!String(tokens.scope ?? '').includes('youtube.force-ssl')) {
    throw new Error(
      "le jeton ne porte pas le scope 'youtube.force-ssl' : captions.* renverra 403.\n" +
      '  → cd ~/DEV/youtube-mcp && npm run auth   (avec le compte propriétaire de la chaîne)',
    );
  }
  oauth.setCredentials(tokens);
  oauth.on('tokens', (t) => fs.writeFileSync(tokensPath, JSON.stringify({ ...tokens, ...t }, null, 2)));
  return google.youtube({ version: 'v3', auth: oauth });
}

/** Contrôle de forme : un SRT sans horodatage serait accepté puis inutilisable. */
function verifierSrt(file) {
  const brut = fs.readFileSync(file);
  if (brut[0] === 0xef && brut[1] === 0xbb && brut[2] === 0xbf) {
    throw new Error('le fichier commence par un BOM UTF-8 — YouTube préfère un UTF-8 nu');
  }
  const texte = brut.toString('utf8');
  const cues = texte.match(/\d\d:\d\d:\d\d,\d\d\d --> \d\d:\d\d:\d\d,\d\d\d/g) ?? [];
  if (cues.length === 0) throw new Error('aucun horodatage trouvé : ce fichier n’est pas un SRT valide');
  const mo = brut.length / 1048576;
  if (mo > 100) throw new Error(`fichier de ${mo.toFixed(1)} Mo — la limite de l’API est 100 Mo`);
  return { cues: cues.length, ko: (brut.length / 1024).toFixed(1) };
}

async function main() {
  const videoId = arg('video');
  if (!videoId) throw new Error('--video <id> est requis');
  const yt = await client(arg('tokens'));
  const lang = arg('lang', 'fr');
  const nom = arg('name', '');

  const existantes = await yt.captions.list({ part: ['snippet'], videoId });
  const pistes = existantes.data.items ?? [];
  console.log(`Pistes déjà présentes sur ${videoId} : ${pistes.length || 'aucune'}`);
  for (const p of pistes) {
    console.log(`  - ${p.id} | ${p.snippet.language} | ${p.snippet.trackKind} | ` +
                `nom="${p.snippet.name ?? ''}" | brouillon=${p.snippet.isDraft}`);
  }
  if (arg('list')) return;

  const file = path.resolve(arg('file'));
  if (!fs.existsSync(file)) throw new Error(`fichier introuvable : ${file}`);
  const { cues, ko } = verifierSrt(file);
  console.log(`À déposer : ${path.basename(file)} — ${cues} sous-titres, ${ko} Ko, langue ${lang}`);

  // captions.insert refuse un doublon (langue + nom) avec une 409 captionExists.
  const doublon = pistes.find((p) => p.snippet.language === lang &&
                                     (p.snippet.name ?? '') === nom &&
                                     p.snippet.trackKind !== 'ASR');
  if (doublon && !arg('replace')) {
    throw new Error(`une piste ${lang} nommée "${nom}" existe déjà (${doublon.id}). ` +
                    'Relance avec --replace pour la remplacer.');
  }

  if (arg('dry-run')) {
    console.log('[dry-run] rien n’a été envoyé.');
    return;
  }

  if (doublon) {
    await yt.captions.delete({ id: doublon.id });
    console.log(`ancienne piste supprimée : ${doublon.id}`);
  }
  const res = await yt.captions.insert({
    part: ['snippet'],
    requestBody: { snippet: { videoId, language: lang, name: nom, isDraft: false } },
    media: { body: fs.createReadStream(file) },
  });
  console.log(`✅ piste déposée : ${res.data.id} (${res.data.snippet.language}, ` +
              `brouillon=${res.data.snippet.isDraft})`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
