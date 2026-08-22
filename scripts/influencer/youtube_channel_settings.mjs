#!/usr/bin/env node
/**
 * Pose les réglages « À propos » d'une chaîne YouTube via l'API (channels.update / brandingSettings) :
 * description, mots-clés, pays, langue par défaut. Pensé pour la chaîne AMBRE (tokens séparés de LISA IA).
 *
 * Usage :
 *   node youtube_channel_settings.mjs --fiche ~/.codebuddy/personas/ambre/chaine/FICHE-CHAINE-AMBRE.md \
 *        [--tokens ~/DEV/youtube-mcp/tokens-ambre.json] [--dry-run] [--show]
 *
 * La fiche est un Markdown avec des sections « ## Description » (bloc ```), « ## Mots-clés » (bloc ```, virgules ou lignes)
 * et des lignes « Pays : FR », « Langue : fr ». Rien n'est envoyé sans --dry-run retiré ; --show affiche l'état courant.
 * Ne crée PAS de chaîne (geste humain dans l'UI YouTube). Quota : channels.update = 50 unités.
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
  oauth.setCredentials(tokens);
  oauth.on('tokens', (t) => fs.writeFileSync(tokensPath, JSON.stringify({ ...tokens, ...t }, null, 2)));
  return google.youtube({ version: 'v3', auth: oauth });
}

function parseFiche(fichePath) {
  const md = fs.readFileSync(fichePath, 'utf8');
  const section = (name) => md.match(new RegExp(`## ${name}[^\\n]*\\n+\`\`\`[^\\n]*\\n([\\s\\S]*?)\`\`\``, 'i'))?.[1]?.trim();
  const description = section('Description');
  const keywordsRaw = section('Mots-cl[ée]s');
  const keywords = keywordsRaw ? keywordsRaw.split(/[,\n]/).map((k) => k.trim().replace(/^\d+\.\s*/, '')).filter(Boolean) : [];
  const country = md.match(/^Pays\s*:\s*`?([A-Z]{2})`?/m)?.[1];
  const defaultLanguage = md.match(/^Langue\s*:\s*`?([a-z]{2}(?:-[A-Z]{2})?)`?/m)?.[1];
  return { description, keywords, country, defaultLanguage };
}

// YouTube attend les mots-clés en une chaîne ; les expressions contenant des espaces sont entourées de guillemets.
function keywordsToString(keywords) {
  return keywords.map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(' ');
}

async function main() {
  const dry = !!arg('dry-run', false);
  const show = !!arg('show', false);
  const fiche = arg('fiche', null);
  if (!fiche && !show) { console.error('usage : --fiche FICHE.md [--tokens f] [--dry-run] | --show'); process.exit(2); }
  const settings = fiche ? parseFiche(path.resolve(fiche)) : null;
  if (settings) {
    const words = settings.description ? settings.description.split(/\s+/).filter(Boolean).length : 0;
    console.log(`Fiche : description ${settings.description?.length ?? 0} car. / ${words} mots · ${settings.keywords.length} mots-clés · pays ${settings.country ?? '—'} · langue ${settings.defaultLanguage ?? '—'}`);
    if (!settings.description) throw new Error('section « ## Description » introuvable dans la fiche');
    if (settings.description.length > 1000) throw new Error(`description trop longue (${settings.description.length} > 1000 car.)`);
    const kw = keywordsToString(settings.keywords);
    if (kw.length > 500) throw new Error(`mots-clés trop longs (${kw.length} > 500 car.)`);
  }
  if (dry) { console.log('DRY-RUN — rien envoyé.'); console.log(JSON.stringify(settings, null, 2)); return; }
  const yt = await client(arg('tokens', null));
  const mine = await yt.channels.list({ part: ['id', 'snippet', 'brandingSettings'], mine: true });
  const ch = mine.data.items?.[0];
  if (!ch) throw new Error('aucune chaîne pour ces tokens — refaire l’OAuth en choisissant la chaîne Ambre');
  console.log(`Chaîne : ${ch.snippet.title} (${ch.id}) · handle ${ch.snippet.customUrl ?? '—'}`);
  if (show) { console.log(JSON.stringify(ch.brandingSettings?.channel ?? {}, null, 2)); if (!settings) return; }
  if (/lisa/i.test(ch.snippet.title) && !arg('force', false)) throw new Error('ces tokens pointent sur LISA IA — refus (passer --force si c’est voulu)');
  const channelBranding = {
    ...(ch.brandingSettings?.channel ?? {}),
    description: settings.description,
    keywords: keywordsToString(settings.keywords),
    ...(settings.country ? { country: settings.country } : {}),
    ...(settings.defaultLanguage ? { defaultLanguage: settings.defaultLanguage } : {}),
  };
  const res = await yt.channels.update({
    part: ['brandingSettings'],
    requestBody: { id: ch.id, brandingSettings: { channel: channelBranding } },
  });
  console.log('✅ brandingSettings mis à jour :', JSON.stringify(res.data.brandingSettings?.channel ?? {}, null, 2));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
