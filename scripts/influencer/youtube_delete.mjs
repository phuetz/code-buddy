#!/usr/bin/env node
// Supprimer des vidéos YouTube par ID (chaîne LISA IA par défaut) — même auth que youtube_upload.mjs. Usage : node youtube_delete.mjs ID1 ID2 … [--tokens …]
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const require = createRequire(path.join(os.homedir(), 'DEV/youtube-mcp/package.json'));
const { google } = require('googleapis');
const MCP_DIR = path.join(os.homedir(), 'DEV/youtube-mcp');
const args = process.argv.slice(2); const ti = args.indexOf('--tokens'); const tokensFile = ti >= 0 ? args.splice(ti, 2)[1] : null;
const env = Object.fromEntries(fs.readFileSync(path.join(MCP_DIR, '.env'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, 'http://localhost:8723');
oauth.setCredentials(JSON.parse(fs.readFileSync(tokensFile ? path.resolve(tokensFile) : path.join(MCP_DIR, 'tokens.json'), 'utf8')));
const yt = google.youtube({ version: 'v3', auth: oauth });
for (const id of args) { try { await yt.videos.delete({ id }); console.log('supprimée', id); } catch (e) { console.log('ÉCHEC', id, e.message?.slice(0, 120)); } }
