/**
 * Porte des fichiers exécutables ou interprétables d'un skill importé.
 *
 * Historique : la reprise 13 mettait en quarantaine tout skill qui embarque un
 * script (douze reprises de listes de motifs n'avaient jamais fermé la classe
 * « un script contourne l'analyse »). Trop restrictif : on perdait des skills
 * utiles. Reprise 14, la sanction change, pas la porte :
 *
 * - binaires (ELF, PE, Mach-O, WebAssembly, bytecode, y compris sous un nom de
 *   donnée), liens symboliques ou physiques, fichiers spéciaux ou illisibles :
 *   QUARANTAINE, sauf entrée explicite de la liste blanche (source + chemin + sha256) ;
 * - scripts (extensions de script, Makefile, shebang, bit exécutable) : le skill
 *   est IMPORTÉ, mais ses scripts sont rendus inertes (bit exécutable retiré) et
 *   marqués `scriptsUnverified`. Les lancer passe par `ConfirmationService`
 *   (`src/tools/bash/imported-skill-guard.ts`), sauf script listé dans la liste
 *   blanche avec le sha256 du fichier COURANT.
 *
 * L'analyse par motifs (`skill-scanner.ts`) reste la seconde couche (quarantaine
 * d'un script dangereux) et seule juge de SKILL.md (injection de prompt).
 * Aucune lecture de contenu pour classer : extension, nom, bit exécutable et
 * premiers octets suffisent.
 *
 * @module security/skill-executable-gate
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { logger } from '../utils/logger.js';

/** Extensions interprétées ou chargées par un moteur d'exécution courant. */
const EXECUTABLE_EXTENSIONS = new Set([
  // shells
  '.sh', '.bash', '.zsh', '.ksh', '.fish', '.dash', '.ash', '.csh', '.tcsh',
  // langages de script
  '.py', '.pyw', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.pl', '.pm', '.rb', '.php', '.phtml', '.lua', '.tcl', '.awk', '.sed', '.r', '.jl', '.groovy', '.ex', '.exs',
  // Windows
  '.ps1', '.psm1', '.psd1', '.bat', '.cmd', '.vbs', '.vbe', '.wsf', '.hta',
  // macOS
  '.scpt', '.applescript', '.command',
  // constructeurs
  '.mk', '.make', '.mak', '.just', '.gradle',
]);

/** Binaires, bibliothèques, bytecode : jamais traités comme des scripts. */
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.elf', '.jar', '.class', '.wasm', '.node', '.app',
  '.pyc', '.pyo', '.msi', '.scr', '.com',
  // archives : un conteneur de code que la porte ne peut pas lire
  '.zip', '.tar', '.tgz', '.gz', '.bz2', '.xz', '.7z', '.rar', '.zst', '.cab', '.iso', '.cpio', '.ar', '.deb', '.rpm', '.whl', '.egg',
]);

/** Noms sans extension que `make`, `just` et consorts exécutent. */
const EXECUTABLE_BASENAMES = /^(?:gnumakefile|makefile|justfile|rakefile)$/i;

/** Dossiers dont le contenu est du code par convention : tout fichier y est un script. */
const SCRIPT_DIRS = new Set(['scripts', 'bin', 'hooks', 'script']);

/**
 * Premiers octets : ELF, Mach-O, PE, WebAssembly, bytecode, archives (zip, gzip,
 * bzip2, xz, 7z, rar, zstd, tar) ; shebang en tête, après un BOM ou des blancs.
 */
function magicKind(prefix: Buffer): { label: string; binary: boolean } | null {
  if (prefix.length >= 4) {
    const hex = prefix.subarray(0, 4).toString('hex');
    if (hex === '7f454c46') return { label: 'ELF', binary: true };
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(hex)) return { label: 'Mach-O', binary: true };
    if (hex === 'cafebabe' || hex === 'bebafeca') return { label: 'Mach-O fat / classe Java', binary: true };
    if (hex === '0061736d') return { label: 'WebAssembly', binary: true };
    if (hex === '504b0304' || hex === '504b0506' || hex === '504b0708') return { label: 'archive zip', binary: true };
    if (hex.startsWith('1f8b')) return { label: 'archive gzip', binary: true };
    if (hex === 'fd377a58') return { label: 'archive xz', binary: true };
    if (hex === '377abcaf') return { label: 'archive 7z', binary: true };
    if (hex === '28b52ffd') return { label: 'archive zstd', binary: true };
    if (hex === '52617221') return { label: 'archive rar', binary: true };
    if (prefix.subarray(0, 3).toString('latin1') === 'BZh') return { label: 'archive bzip2', binary: true };
    if (prefix.subarray(0, 7).toString('latin1') === '!<arch>') return { label: 'archive ar', binary: true };
  }
  if (prefix.length >= 262 && prefix.subarray(257, 262).toString('latin1') === 'ustar') return { label: 'archive tar', binary: true };
  if (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) return { label: 'PE (MZ)', binary: true };
  // Shebang: at the very start, after a UTF-8 BOM or leading blanks.
  const head = prefix.subarray(0, 512).toString('latin1').replace(/^\xef\xbb\xbf/, '');
  if (/^[\s\0]*#!/.test(head)) return { label: 'shebang', binary: false };
  return null;
}

export type ExecutableKind = 'script' | 'binary';

export interface ExecutableFile {
  /** `binary` : quarantaine du skill ; `script` : importé inerte. */
  kind: ExecutableKind;
  /** Chemin POSIX relatif à la racine passée à `findExecutablePayloads`. */
  relPath: string;
  sha256: string;
  /** Pourquoi ce fichier est traité comme exécutable ou interprétable. */
  reasons: string[];
}

export interface ExecAllowlistEntry {
  /** Étiquette de provenance de l'import (`--source`, ou nom du dossier pour `--dir`). */
  source: string;
  /** Chemin du fichier relatif au dossier source importé, séparateurs `/`. */
  path: string;
  /** Empreinte SHA-256 hexadécimale du contenu autorisé. */
  sha256: string;
}

export interface ExecGateResult {
  /** Vrai si un binaire, lien ou fichier spécial n'est pas autorisé : quarantaine. */
  blocked: boolean;
  executables: ExecutableFile[];
  /** Binaires (ou liens) absents de la liste blanche. */
  deniedBinaries: ExecutableFile[];
  /** Scripts absents de la liste blanche : importés inertes. */
  unverifiedScripts: ExecutableFile[];
  /** Motif de quarantaine (binaires), vide sinon. */
  reason: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Retire les caractères de format invisibles (U+200B, bidi…) et normalise en NFKC. */
function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/[\p{Cf}\u00ad]/gu, '');
}

export function classifyPrefix(name: string, mode: number, prefix: Buffer, relPath = name): { reasons: string[]; binary: boolean } {
  const reasons: string[] = [];
  let binary = false;
  const clean = normalizeName(name);
  const lower = clean.toLowerCase();
  // Every dotted segment counts: `tool.py.txt`, `run.sh.bak`.
  const exts = lower.split('.').slice(1).map(e => `.${e}`);
  // Binary extensions: the LAST one only (`linear.app.md`, `stripe.com.md` are documents); real binaries are caught by magic bytes.
  const lastExt = exts[exts.length - 1];
  const binExt = lastExt !== undefined && BINARY_EXTENSIONS.has(lastExt) ? lastExt : undefined;
  const scriptExt = exts.find(e => EXECUTABLE_EXTENSIONS.has(e));
  if (binExt) { reasons.push(`extension binaire ${binExt}`); binary = true; }
  else if (scriptExt) reasons.push(`extension ${scriptExt}`);
  // A lookalike (full-width, Cyrillic…) or invisible character in the name: never plain data.
  if (clean !== name || /[^ -~]/.test(clean)) reasons.push('nom avec caractères non ASCII ou invisibles');
  if (EXECUTABLE_BASENAMES.test(clean)) reasons.push('fichier de construction');
  if ((mode & 0o111) !== 0) reasons.push('bit exécutable');
  const magic = magicKind(prefix);
  if (magic) { reasons.push(magic.label); if (magic.binary) binary = true; }
  const dirs = relPath.split('/').slice(0, -1).map(d => d.toLowerCase());
  if (dirs.some(d => SCRIPT_DIRS.has(d))) reasons.push('dossier de scripts');
  return { reasons, binary };
}

/**
 * Classe un fichier ordinaire du disque (aussi utilisé à l'exécution par la
 * garde de BashTool). `null` : ni script ni binaire. Lien, fichier spécial,
 * illisible : binaire (refus par défaut).
 */
export function classifyFile(fullPath: string, relPath?: string): { reasons: string[]; binary: boolean } | null {
  try {
    const info = fs.lstatSync(fullPath);
    if (info.isSymbolicLink()) return { reasons: ['lien symbolique'], binary: true };
    if (!info.isFile()) return { reasons: ['fichier spécial'], binary: true };
    if (info.nlink > 1) return { reasons: ['lien physique'], binary: true };
    const fd = fs.openSync(fullPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
    let prefix: Buffer;
    try {
      prefix = Buffer.alloc(512);
      prefix = prefix.subarray(0, fs.readSync(fd, prefix, 0, 512, 0));
    } finally {
      fs.closeSync(fd);
    }
    const c = classifyPrefix(path.basename(fullPath), info.mode, prefix, relPath ?? path.basename(fullPath));
    return c.reasons.length > 0 ? c : null;
  } catch {
    return { reasons: ['fichier illisible'], binary: true };
  }
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Parcourt `skillDir` (récursif, liens symboliques non suivis) et liste chaque
 * fichier exécutable ou interprétable. Un fichier illisible est compté comme
 * exécutable (refus par défaut).
 */
export function findExecutablePayloads(skillDir: string, rootDir: string = skillDir): ExecutableFile[] {
  const skillRoot = skillDir;
  const out: ExecutableFile[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      out.push({ kind: 'binary', relPath: toPosix(path.relative(rootDir, dir)), sha256: '', reasons: ['dossier illisible'] });
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(rootDir, full));
      if (!entry.isSymbolicLink() && entry.isDirectory()) {
        walk(full);
        continue;
      }
      const c = classifyFile(full, toPosix(path.relative(skillRoot, full)));
      if (!c) continue;
      let sha = '';
      try {
        if (!c.reasons.some(r => /lien|spécial|illisible/.test(r))) sha = sha256File(full);
      } catch {
        sha = '';
      }
      out.push({ kind: c.binary ? 'binary' : 'script', relPath: rel, sha256: sha, reasons: c.reasons });
    }
  };
  walk(skillDir);
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Chemin documenté du fichier de liste blanche (vide par défaut : le fichier n'existe pas). */
export function defaultExecAllowlistPath(): string {
  return getCodeBuddyPath('skill-exec-allowlist.json');
}

/**
 * Charge la liste blanche : `{ "entries": [{ "source", "path", "sha256" }] }`.
 * Fichier absent : liste vide. Fichier invalide : liste vide et avertissement
 * (échec fermé, jamais d'autorisation par défaut).
 */
export function loadExecAllowlist(file: string = defaultExecAllowlistPath()): ExecAllowlistEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown };
    const list = Array.isArray(parsed) ? parsed : parsed.entries;
    if (!Array.isArray(list)) throw new Error('"entries" absent');
    const entries: ExecAllowlistEntry[] = [];
    for (const item of list) {
      const e = item as Record<string, unknown>;
      if (typeof e?.source === 'string' && typeof e.path === 'string' && typeof e.sha256 === 'string'
          && /^[0-9a-f]{64}$/i.test(e.sha256) && e.source !== '' && e.path !== '') {
        entries.push({ source: e.source, path: e.path.replace(/\\/g, '/'), sha256: e.sha256.toLowerCase() });
      } else {
        throw new Error('entrée invalide (source, path, sha256 hexadécimal de 64 caractères requis)');
      }
    }
    return entries;
  } catch (error) {
    logger.warn(`[skills] liste blanche d'exécutables ignorée (${file}) : ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Ligne exacte de liste blanche pour un fichier. */
export function allowlistLine(source: string, sourcePath: string, sha256: string): string {
  return JSON.stringify({ source, path: sourcePath, sha256 });
}

/**
 * Classe les exécutables d'un skill. `skillDir` est analysé ; les chemins de
 * la liste blanche sont relatifs à `sourceRoot`.
 */
export function checkExecutablePayloads(
  skillDir: string,
  opts: { sourceRoot: string; source: string; allowlist: readonly ExecAllowlistEntry[] | (() => readonly ExecAllowlistEntry[]) },
): ExecGateResult {
  const executables = findExecutablePayloads(skillDir, opts.sourceRoot);
  // Lazy: a skill without executable file never touches the allowlist file.
  const list = executables.length === 0 ? [] : typeof opts.allowlist === 'function' ? opts.allowlist() : opts.allowlist;
  const allowed = new Set(
    list.filter(e => e.source === opts.source).map(e => `${e.path}\u0000${e.sha256}`),
  );
  const isAllowed = (f: ExecutableFile): boolean => f.sha256 !== '' && allowed.has(`${f.relPath}\u0000${f.sha256}`);
  const deniedBinaries = executables.filter(f => f.kind === 'binary' && !isAllowed(f));
  const unverifiedScripts = executables.filter(f => f.kind === 'script' && !isAllowed(f));
  const reason = deniedBinaries.length === 0
    ? ''
    : `Binary, link or special file refused (${deniedBinaries.length} file${deniedBinaries.length > 1 ? 's' : ''}): `
      + deniedBinaries.slice(0, 5).map(f => `${f.relPath} [${f.reasons.join(', ')}${f.sha256 ? `; sha256 ${f.sha256}; allow with ${allowlistLine(opts.source, f.relPath, f.sha256)}` : ''}]`).join('; ')
      + (deniedBinaries.length > 5 ? `; +${deniedBinaries.length - 5} more` : '')
      + `. Allowlist file: ${defaultExecAllowlistPath()}.`;
  return { blocked: deniedBinaries.length > 0, executables, deniedBinaries, unverifiedScripts, reason };
}

/** Retire le bit exécutable des scripts copiés sous `destDir` (chemins relatifs au skill, `/`). */
export function disarmScripts(destDir: string, relPaths: readonly string[]): void {
  for (const rel of relPaths) {
    const copied = path.join(destDir, ...rel.split('/'));
    try {
      fs.chmodSync(copied, fs.statSync(copied).mode & ~0o111);
    } catch { /* un fichier non copié n'a rien à désarmer */ }
  }
}

/** Racines qui contiennent les skills importés (le dossier par défaut, plus l'environnement). */
export function importedSkillRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [getCodeBuddyPath('skills')];
  for (const extra of (env.CODEBUDDY_IMPORTED_SKILL_ROOTS ?? '').split(path.delimiter)) {
    if (extra.trim()) roots.push(path.resolve(extra.trim()));
  }
  const out = new Set<string>();
  for (const r of roots) {
    out.add(path.resolve(r));
    try {
      out.add(fs.realpathSync(r));
    } catch { /* racine absente */ }
  }
  return [...out];
}

