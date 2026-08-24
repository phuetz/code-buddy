#!/usr/bin/env node
/**
 * Supprime les téléversements PÉRIMÉS d'un journal, et seulement eux.
 *
 * Un même fichier peut avoir été mis en ligne plusieurs fois (reprise, re-rendu) : la
 * dernière version est la bonne, les précédentes sont des doublons privés à retirer.
 * Mesuré le 24/08 : six Shorts existaient en double, ceux du matin portant le rendu
 * fautif d'avant correction.
 *
 * Supprimer une vidéo est IRRÉVERSIBLE. Le script refuse donc de supprimer un doublon
 * tant qu'il n'a pas VU son remplaçant en ligne : si la dernière version a disparu, le
 * « doublon » est en réalité la seule copie restante.
 *
 * Usage :
 *   youtube_supprimer_doublons.mjs <journal.jsonl> [--faire] [--tokens …]
 * Sans --faire, il se contente de dire ce qu'il supprimerait.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MCP_DIR = path.join(os.homedir(), 'DEV', 'youtube-mcp');
const require = createRequire(path.join(MCP_DIR, 'package.json'));
const { google } = require('googleapis');

const args = process.argv.slice(2);
const ti = args.indexOf('--tokens');
const tokensFile = ti >= 0 ? args.splice(ti, 2)[1] : null;
const faire = args.includes('--faire');
const journal = args.find((a) => !a.startsWith('--'));
if (!journal) {
  console.error('usage : youtube_supprimer_doublons.mjs <journal.jsonl> [--faire]');
  process.exit(2);
}

function client() {
  const env = Object.fromEntries(
    fs.readFileSync(path.join(MCP_DIR, '.env'), 'utf8').split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }));
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET,
                                       'http://localhost:8723');
  oauth.setCredentials(JSON.parse(fs.readFileSync(
    tokensFile ? path.resolve(tokensFile) : path.join(MCP_DIR, 'tokens.json'), 'utf8')));
  return google.youtube({ version: 'v3', auth: oauth });
}

/** Regroupe le journal par fichier, dans l'ordre chronologique. */
function parFichier(chemin) {
  const groupes = new Map();
  for (const ligne of fs.readFileSync(chemin, 'utf8').split('\n')) {
    if (!ligne.trim()) continue;
    let d;
    try { d = JSON.parse(ligne); } catch { continue; }
    if (!d.id || !d.file) continue;
    const nom = path.basename(d.file);
    if (!groupes.has(nom)) groupes.set(nom, []);
    groupes.get(nom).push({ id: d.id, ts: d.ts ?? '' });
  }
  for (const v of groupes.values()) v.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return groupes;
}

const yt = client();
const groupes = parFichier(journal);
let supprimees = 0, ignorees = 0;

for (const [nom, versions] of groupes) {
  if (versions.length < 2) continue;
  const garde = versions[versions.length - 1];
  const anciennes = versions.slice(0, -1);

  // Garde-fou : on ne touche à rien tant que le remplaçant n'est pas vu EN LIGNE.
  let existe = false;
  try {
    const r = await yt.videos.list({ part: ['status'], id: [garde.id] });
    existe = (r.data.items ?? []).length > 0;
  } catch (e) {
    console.log(`⚠ ${nom} : impossible de vérifier ${garde.id} (${e.message.split('\n')[0].slice(0, 60)}) — rien supprimé`);
    ignorees += anciennes.length;
    continue;
  }
  if (!existe) {
    console.log(`⚠ ${nom} : la dernière version ${garde.id} est introuvable — les anciennes sont conservées`);
    ignorees += anciennes.length;
    continue;
  }

  console.log(`${nom}\n   on garde  ${garde.id}  (${garde.ts.slice(0, 16)})`);
  for (const vieille of anciennes) {
    if (!faire) {
      console.log(`   à retirer ${vieille.id}  (${vieille.ts.slice(0, 16)})   [simulation]`);
      continue;
    }
    try {
      await yt.videos.delete({ id: vieille.id });
      console.log(`   retirée   ${vieille.id}  (${vieille.ts.slice(0, 16)})`);
      supprimees++;
    } catch (e) {
      const m = e.message.split('\n')[0];
      // Une vidéo déjà disparue n'est pas une erreur : le journal en garde la trace.
      console.log(/could not be found/i.test(m)
        ? `   déjà absente ${vieille.id}`
        : `   ÉCHEC     ${vieille.id} : ${m.slice(0, 80)}`);
    }
  }
}

console.log(`\n${faire ? `${supprimees} vidéo(s) retirée(s)` : 'simulation — rien n’a été supprimé'}` +
            `${ignorees ? `, ${ignorees} conservée(s) par précaution` : ''}`);
