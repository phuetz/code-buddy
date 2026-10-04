#!/usr/bin/env node
/**
 * check-npm-package.mjs — Garde du paquet npm.
 *
 * Vérifie ce que `npm pack` inclurait réellement dans le tarball publié et
 * ÉCHOUE (code de sortie ≠ 0) sur toute violation des règles suivantes :
 *
 *   - carte des sources (`*.map`) ;
 *   - fichier d'environnement (`.env`, `.env.*`) ;
 *   - clé / jeton / secret détecté dans le CONTENU (motifs de
 *     `src/security/secret-patterns.ts`, source unique de vérité) ;
 *   - fichier privé (`*.private.json`, `auth.json`) ;
 *   - chemin personnel (`/home/<nom>`, `/data/<nom>`, `/Users/<nom>`,
 *     `C:\Users\<nom>`) dans un NOM DE FICHIER ou dans le CONTENU ;
 *   - fichier de test / QA (`_qa/`).
 *
 * Le message nomme toujours le fichier fautif et la règle, JAMAIS la valeur
 * d'un secret (le secret reste masqué).
 *
 * Le script n'écrit aucun fichier : il lance `npm pack --dry-run --json
 * --ignore-scripts`. `--ignore-scripts` est indispensable pour éviter la
 * récursion lorsque la garde est branchée dans `prepack` (qui lance déjà le
 * build) : sans lui, `npm pack` relancerait `prepack`, qui relancerait la garde.
 *
 * Usage :
 *   node scripts/check-npm-package.mjs [--cwd <dir>] [--json] [--quiet]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** Taille maximale d'un fichier dont le contenu est analysé (5 Mo). */
const MAX_CONTENT_SCAN_BYTES = 5 * 1024 * 1024;

/**
 * Chemin personnel : le segment de nom d'utilisateur doit commencer par un
 * caractère alphanumérique. Cela évite de flaguer des chemins techniques
 * légitimes comme `/home/.codebuddy` (segment commençant par un point) ou
 * `/home/$USER` (non résolu).
 */
export const PERSONAL_PATH_PATTERNS = [
  { rule: 'forbidden-personal-path: /home/<nom>', pattern: /\/home\/[A-Za-z0-9][A-Za-z0-9._-]*/g },
  { rule: 'forbidden-personal-path: /data/<nom>', pattern: /\/data\/[A-Za-z0-9][A-Za-z0-9._-]*/g },
  { rule: 'forbidden-personal-path: /Users/<nom>', pattern: /\/Users\/[A-Za-z0-9][A-Za-z0-9._-]*/g },
  { rule: 'forbidden-personal-path: C:\\Users\\<nom>', pattern: /C:\\Users\\[A-Za-z0-9][A-Za-z0-9._-]*/gi },
];

/**
 * Règles sur le NOM du fichier (chemin relatif normalisé en `/`).
 */
export const FILENAME_RULES = [
  { rule: 'forbidden-extension: *.map', test: (f) => /\.map$/i.test(f) },
  { rule: 'forbidden-pattern: .env*', test: (f) => /(^|\/)\.env(\.|$)/i.test(f) },
  { rule: 'forbidden-file: *.private.json', test: (f) => /\.private\.json$/i.test(f) },
  { rule: 'forbidden-file: auth.json', test: (f) => /(^|\/)auth\.json$/i.test(f) },
  { rule: 'forbidden-directory: _qa/', test: (f) => /(^|\/)_qa(\/|$)/.test(f) },
  {
    rule: 'forbidden-personal-path',
    test: (f) => PERSONAL_PATH_PATTERNS.some((p) => new RegExp(p.pattern.source, p.pattern.flags.replace('g', '')).test(f)),
  },
];

/** Normalise un chemin de paquet (séparateurs `/`, préfixe `./` retiré). */
export function normalizePackPath(file) {
  return String(file).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Charge les motifs de secrets depuis la source unique de vérité.
 *
 * 1. `dist/security/secret-patterns.js` s'il est compilé (flux de publication) ;
 * 2. sinon, extraction des littéraux RegExp de `src/security/secret-patterns.ts`
 *    (aucun loader TypeScript requis, compatible Node ≥ 18).
 *
 * Lève une erreur si moins de 20 motifs sont trouvés : la garde ne doit jamais
 * « passer » silencieusement faute de motifs.
 *
 * @returns {Array<{type: string, source: string, flags: string}>}
 */
export function loadSecretPatterns(root = REPO_ROOT) {
  const distFile = join(root, 'dist', 'security', 'secret-patterns.js');
  if (existsSync(distFile)) {
    // Import synchrone impossible en ESM : on lit et évalue via un module data URL.
    const js = readFileSync(distFile, 'utf8');
    const mod = evalModule(js);
    if (mod && Array.isArray(mod.SECRET_PATTERNS)) {
      return mod.SECRET_PATTERNS.map((p) => ({ type: p.type, source: p.pattern.source, flags: p.pattern.flags }));
    }
  }

  const tsFile = join(root, 'src', 'security', 'secret-patterns.ts');
  if (!existsSync(tsFile)) {
    throw new Error(
      `Impossible de charger les motifs de secrets : ni ${distFile} ni ${tsFile} n'existent.`,
    );
  }
  const src = readFileSync(tsFile, 'utf8');
  const patterns = extractRegexLiterals(src);
  if (patterns.length < 20) {
    throw new Error(
      `Extraction des motifs de secrets incomplète (${patterns.length} trouvés, ≥ 20 attendus) depuis ${tsFile}.`,
    );
  }
  return patterns;
}

/** Évalue un module CommonJS/ESM simple en mémoire (pour dist/…/secret-patterns.js). */
function evalModule(js) {
  try {
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    const fn = new Function('exports', 'module', 'require', js);
    fn(module.exports, module, () => ({}));
    return module.exports;
  } catch {
    return null;
  }
}

/**
 * Extrait les littéraux `/…/flags` suivant `pattern:` d'une source TypeScript.
 * Gère les classes de caractères `[…]` et les échappements.
 */
export function extractRegexLiterals(src) {
  const out = [];
  const anchor = /pattern:\s*\//g;
  let m;
  while ((m = anchor.exec(src)) !== null) {
    let i = m.index + m[0].length; // juste après le `/` ouvrant
    let body = '';
    let inClass = false;
    let closed = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') {
        body += c + (src[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      if (c === '/' && !inClass) {
        closed = true;
        break;
      }
      // Un saut de ligne avant fermeture signifie que ce n'était pas un littéral.
      if (c === '\n') break;
      body += c;
    }
    if (!closed) continue;
    const flags = /^[dgimsuvy]*/.exec(src.slice(i + 1))[0];
    // Le type est porté par l'objet juste au-dessus ; on le retrouve par proximité.
    const type = findPrecedingType(src, m.index);
    out.push({ type, source: body, flags });
  }
  return out;
}

/** Retrouve `type: 'xxx'` le plus proche AVANT la position donnée. */
function findPrecedingType(src, index) {
  const before = src.slice(Math.max(0, index - 400), index);
  const matches = [...before.matchAll(/type:\s*'([a-z_]+)'/g)];
  return matches.length ? matches[matches.length - 1][1] : 'unknown';
}

/**
 * Audit d'une liste de fichiers empaquetés.
 *
 * @param {string[]} files chemins relatifs du tarball
 * @param {object} [options]
 * @param {string} [options.cwd] racine pour lire le contenu (défaut : REPO_ROOT)
 * @param {string} [options.patternsRoot] racine des motifs de secrets (défaut : REPO_ROOT)
 * @param {boolean} [options.scanContents] analyser le contenu (défaut : true)
 * @param {Array} [options.secretPatterns] motifs de secrets (défaut : chargés)
 * @param {Array} [options.filenameRules] règles de nom (défaut : FILENAME_RULES)
 * @returns {{ok: boolean, violations: Array<{file: string, rule: string}>}}
 */
export function auditPackageFiles(files, options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  const scanContents = options.scanContents !== false;
  const filenameRules = options.filenameRules ?? FILENAME_RULES;
  const secretPatterns =
    options.secretPatterns ?? (scanContents ? loadSecretPatterns(options.patternsRoot ?? REPO_ROOT) : []);
  const violations = [];

  for (const raw of files) {
    const file = normalizePackPath(raw);

    for (const { rule, test } of filenameRules) {
      if (test(file)) violations.push({ file, rule });
    }

    if (scanContents) {
      for (const v of scanFileContents(join(cwd, file), file, secretPatterns)) {
        violations.push(v);
      }
    }
  }

  // Dédoublonne (même fichier + même règle).
  const seen = new Set();
  const unique = violations.filter((v) => {
    const key = `${v.file}\u0000${v.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: unique.length === 0, violations: unique };
}

/**
 * Analyse le contenu d'un fichier. Ne renvoie jamais la valeur d'un secret :
 * uniquement le fichier, la règle et le type.
 */
export function scanFileContents(absPath, relPath, secretPatterns) {
  const violations = [];
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return violations; // fichier absent du disque (ex. liste simulée) : rien à scanner
  }
  if (!stat.isFile() || stat.size > MAX_CONTENT_SCAN_BYTES) return violations;

  let buf;
  try {
    buf = readFileSync(absPath);
  } catch {
    return violations;
  }
  // Binaire : un octet NUL dans les 8 premiers Ko.
  if (buf.subarray(0, 8192).includes(0)) return violations;
  const text = buf.toString('utf8');

  for (const { rule, pattern } of PERSONAL_PATH_PATTERNS) {
    const rx = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    if (rx.test(text)) violations.push({ file: relPath, rule });
  }

  for (const p of secretPatterns) {
    let rx;
    try {
      rx = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
    } catch {
      continue; // motif non compilable : ignoré (ne doit pas faire passer la garde)
    }
    if (rx.test(text)) violations.push({ file: relPath, rule: `forbidden-secret: ${p.type}` });
  }

  return violations;
}

/**
 * Lance `npm pack --dry-run --json --ignore-scripts` et renvoie la liste des
 * fichiers empaquetés. Aucun fichier n'est écrit.
 */
export function collectPackagedFiles(cwd = REPO_ROOT) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let out;
  try {
    out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr) : '';
    throw new Error(`\`npm pack --dry-run --json\` a échoué : ${err.message}${stderr ? `\n${stderr}` : ''}`);
  }

  const start = out.indexOf('[');
  if (start < 0) throw new Error('Sortie `npm pack --json` illisible (aucun tableau JSON trouvé).');
  let parsed;
  try {
    parsed = JSON.parse(out.slice(start));
  } catch (err) {
    throw new Error(`Sortie \`npm pack --json\` illisible : ${err.message}`);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) {
    throw new Error('Sortie `npm pack --json` sans liste de fichiers.');
  }
  return entry.files.map((f) => normalizePackPath(f.path));
}

/** Point d'entrée. @returns {number} code de sortie. */
export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cwd = args.cwd ? resolve(args.cwd) : REPO_ROOT;

  let files;
  try {
    files = collectPackagedFiles(cwd);
  } catch (err) {
    process.stderr.write(`[check-npm-package] ERREUR : ${err.message}\n`);
    return 2;
  }

  let result;
  try {
    result = auditPackageFiles(files, { cwd });
  } catch (err) {
    process.stderr.write(`[check-npm-package] ERREUR : ${err.message}\n`);
    return 2;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: result.ok, fileCount: files.length, violations: result.violations }, null, 2) + '\n');
  } else if (!args.quiet || !result.ok) {
    if (result.ok) {
      process.stdout.write(`[check-npm-package] OK — ${files.length} fichiers, aucune violation.\n`);
    } else {
      process.stderr.write(
        `[check-npm-package] ÉCHEC — ${result.violations.length} violation(s) dans le paquet npm :\n`,
      );
      for (const v of result.violations) {
        process.stderr.write(`  ✗ ${v.file} — ${v.rule}\n`);
      }
      process.stderr.write(
        `[check-npm-package] Les valeurs des secrets ne sont jamais affichées. Corrigez .npmignore / package.json "files" / le contenu, puis relancez.\n`,
      );
    }
  }

  return result.ok ? 0 : 1;
}

function parseArgs(argv) {
  const args = { cwd: null, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--quiet') args.quiet = true;
  }
  return args;
}

// Exécution directe uniquement (importable par les tests sans effet de bord).
const invokedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  process.exit(run());
}