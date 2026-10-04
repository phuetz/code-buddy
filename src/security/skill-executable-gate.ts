/**
 * Refus par défaut des fichiers exécutables ou interprétables d'un skill importé.
 *
 * Décision (reprise 13) : douze reprises de listes de motifs n'ont jamais fermé
 * la classe « un script contourne l'analyse ». Un skill importé qui embarque un
 * fichier exécutable ou interprétable est donc mis en quarantaine quel que soit
 * son contenu, sauf si ce fichier figure dans une liste blanche explicite
 * (source + chemin relatif + sha256). L'analyse par motifs (`skill-scanner.ts`)
 * reste une seconde couche, et reste seule juge de SKILL.md (injection de prompt).
 *
 * Aucune lecture de contenu pour décider : l'extension, le nom, le bit exécutable
 * et les premiers octets (shebang, ELF, PE, Mach-O, WebAssembly) suffisent.
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
  '.py', '.pyw', '.pyc', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.pl', '.pm', '.rb', '.php', '.phtml', '.lua', '.tcl', '.awk', '.sed', '.r', '.jl', '.groovy', '.ex', '.exs',
  // Windows
  '.ps1', '.psm1', '.psd1', '.bat', '.cmd', '.vbs', '.vbe', '.wsf', '.hta', '.com', '.scr', '.msi',
  // macOS
  '.scpt', '.applescript', '.command',
  // binaires, bibliothèques, bytecode
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.elf', '.jar', '.class', '.wasm', '.node', '.app',
  // constructeurs
  '.mk', '.make', '.mak', '.just', '.gradle',
]);

/** Noms sans extension que `make`, `just` et consorts exécutent. */
const EXECUTABLE_BASENAMES = /^(?:gnumakefile|makefile|justfile|rakefile)$/i;

/** Premiers octets : ELF, Mach-O (32/64, fat), PE (MZ), WebAssembly, shebang, bytecode Python/Java. */
function magicKind(prefix: Buffer): string | null {
  if (prefix.length >= 2 && prefix[0] === 0x23 && prefix[1] === 0x21) return 'shebang';
  if (prefix.length >= 4) {
    const hex = prefix.subarray(0, 4).toString('hex');
    if (hex === '7f454c46') return 'ELF';
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(hex)) return 'Mach-O';
    if (hex === 'cafebabe' || hex === 'bebafeca') return 'Mach-O fat / classe Java';
    if (hex === '0061736d') return 'WebAssembly';
  }
  if (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) return 'PE (MZ)';
  return null;
}

export interface ExecutableFile {
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
  /** Vrai si au moins un fichier exécutable n'est pas autorisé. */
  blocked: boolean;
  executables: ExecutableFile[];
  /** Fichiers exécutables absents de la liste blanche. */
  denied: ExecutableFile[];
  /** Explication lisible, avec les empreintes à copier dans la liste blanche. */
  reason: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function classify(name: string, mode: number, prefix: Buffer): string[] {
  const reasons: string[] = [];
  const ext = path.extname(name).toLowerCase();
  if (EXECUTABLE_EXTENSIONS.has(ext)) reasons.push(`extension ${ext}`);
  if (EXECUTABLE_BASENAMES.test(name)) reasons.push('fichier de construction');
  if ((mode & 0o111) !== 0) reasons.push('bit exécutable');
  const magic = magicKind(prefix);
  if (magic) reasons.push(magic);
  return reasons;
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Parcourt `skillDir` (récursif, liens symboliques non suivis) et liste chaque
 * fichier exécutable ou interprétable. Un fichier illisible est compté comme
 * exécutable (refus par défaut).
 */
export function findExecutablePayloads(skillDir: string, rootDir: string = skillDir): ExecutableFile[] {
  const out: ExecutableFile[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      out.push({ relPath: toPosix(path.relative(rootDir, dir)), sha256: '', reasons: ['dossier illisible'] });
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(rootDir, full));
      if (entry.isSymbolicLink()) {
        // Un lien peut désigner un exécutable hors de l'arbre : refusé par défaut.
        out.push({ relPath: rel, sha256: '', reasons: ['lien symbolique'] });
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) {
        out.push({ relPath: rel, sha256: '', reasons: ['fichier spécial'] });
        continue;
      }
      try {
        const info = fs.lstatSync(full);
        const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        let prefix: Buffer;
        try {
          prefix = Buffer.alloc(4);
          const n = fs.readSync(fd, prefix, 0, 4, 0);
          prefix = prefix.subarray(0, n);
        } finally {
          fs.closeSync(fd);
        }
        const reasons = classify(entry.name, info.mode, prefix);
        if (reasons.length > 0) out.push({ relPath: rel, sha256: hashFile(full), reasons });
      } catch {
        out.push({ relPath: rel, sha256: '', reasons: ['fichier illisible'] });
      }
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

/**
 * Décide si les exécutables d'un skill sont tous autorisés.
 * `skillDir` est analysé ; les chemins de la liste blanche sont relatifs à `sourceRoot`.
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
  const denied = executables.filter(f => f.sha256 === '' || !allowed.has(`${f.relPath}\u0000${f.sha256}`));
  const reason = denied.length === 0
    ? ''
    : `Executable payload refused by default (${denied.length} file${denied.length > 1 ? 's' : ''}): `
      + denied.slice(0, 5).map(f => `${f.relPath} [${f.reasons.join(', ')}${f.sha256 ? `; sha256 ${f.sha256}` : ''}]`).join('; ')
      + (denied.length > 5 ? `; +${denied.length - 5} more` : '')
      + `. Allow explicitly in ${defaultExecAllowlistPath()} (source, path, sha256).`;
  return { blocked: denied.length > 0, executables, denied, reason };
}
