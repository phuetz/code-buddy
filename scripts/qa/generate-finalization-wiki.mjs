#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
const [report, artifacts, output] = process.argv.slice(2).map(p => resolve(p));
if (!report || !artifacts || !output) throw new Error('Expected report.md artifacts-directory output.html');
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const href = p => relative(dirname(output), resolve(p)).split(sep).map(encodeURIComponent).join('/');
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const blocks = readFileSync(report, 'utf8').split(/\n\s*\n/).map(block => {
  const heading = block.match(/^(#{1,3}) (.+)$/);
  if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
  if (block.split('\n').every(line => line.startsWith('- '))) return '<ul>' + block.split('\n').map(line => '<li>' + inline(line.slice(2)) + '</li>').join('') + '</ul>';
  return '<p>' + inline(block).replaceAll('\n', '<br>') + '</p>';
}).join('\n');
const casesPath = resolve(artifacts, 'pty/results-reviewed.json');
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const rows = cases.map(c => `<tr><td><code>/${esc(c.command)}</code></td><td>${esc(c.status)}</td><td>${esc(c.summary)}</td><td><a href="${href(resolve(artifacts, 'pty', c.artifact))}">Capture terminal</a></td></tr>`).join('');
const proofs = [
  ['electron-replay/fleet-1.png', 'Fleet après correction'],
  ['electron-replay/dag-connected.png', 'Connexions DAG et inspecteur'],
  ['electron-replay/dag-persisted.png', 'DAG conservé après rechargement'],
  ['electron-replay/skill-request.png', 'Skill : demande transmise'],
  ['traces/chatgpt-explorer-natural-optional-schema.stdout', 'Buddy ChatGPT : Code Explorer naturel'],
  ['lm-restore-proof.json', 'Restauration LM identique'],
  ['lm-optimizer-replay.json', 'Mesure réduction LM, rejeu direct'],
  ['lm-diagnostics.json', 'Protocoles LM : ancien, candidat, absent'],
  ['windows/phuetz-code-buddy-2.0.0.tgz', 'Archive locale 2.0.0'],
  ['windows/Installer-Preversion.ps1', 'Installateur Windows isolé'],
  ['windows/LIRE-MOI.md', 'Procédure Windows et limites'],
  ['windows/SHA256SUMS.txt', 'SHA-256 du paquet'],
  ['windows/install-linux-smoke.json', 'Contrôles du paquet installé'],
  ['validate-final.log', 'Validation ciblée complète'],
];
for (const [file] of proofs) if (!existsSync(resolve(artifacts, file))) throw new Error('Missing proof: ' + file);
const links = proofs.map(([file, label]) => `<li><a href="${href(resolve(artifacts, file))}">${esc(label)}</a></li>`).join('');
writeFileSync(output, `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finalisation Code Buddy</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f3f5f8;color:#172032;margin:0}main{max-width:1080px;margin:auto;padding:28px}header,article,section{background:white;padding:24px;border-radius:12px;margin-bottom:20px}h1{font-size:30px;line-height:1.2}h2{margin-top:32px}a{color:#165ca5}code{background:#edf0f5;padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top}nav{display:flex;flex-wrap:wrap;gap:18px}.scroll{overflow:auto}li{margin-bottom:8px}.badge{background:#e2f0e8;padding:8px 12px;display:inline-block;border-radius:7px}@media(max-width:600px){main{padding:10px}header,article,section{padding:16px}h1{font-size:24px}}</style><main><header><nav><a href="index.html">Tous les wikis</a><a href="Wiki-Code-Buddy.html">Commandes</a><a href="Wiki-Cowork.html">Cowork</a><a href="Wiki-Integrations-Skills.html">Intégrations</a></nav><h1>Finalisation Code Buddy</h1><p class="badge">Préversion locale — revue avant publication</p><p>Corrections vérifiées sur CLI, Electron et ChatGPT. Les preuves antérieures sont conservées ; Windows natif reste à tester.</p><a href="${href(report)}">Rapport Markdown complet</a></header><section><h2>Dix commandes rejouées dans un vrai terminal</h2><div class="scroll"><table><thead><tr><th>Commande</th><th>Verdict relu</th><th>Observation</th><th>Preuve</th></tr></thead><tbody>${rows}</tbody></table></div></section><section><h2>Captures, paquet et résultats</h2><ul>${links}</ul></section><article>${blocks}</article></main></html>`);
console.log(output);
