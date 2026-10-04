/**
 * Garde d'exécution des scripts de skills importés.
 *
 * Un skill importé peut embarquer des scripts. Ils sont copiés inertes (bit
 * exécutable retiré, `scriptsUnverified` dans le frontmatter). Quand une
 * commande bash en lance un (chemin du script, ou interpréteur + chemin, sous
 * le dossier d'un skill `imported-*`), la décision passe par
 * `ConfirmationService` avec `forcePrompt` : ni YOLO, ni `dontAsk`, ni
 * `bypassPermissions`, ni CODEBUDDY_AUTO_CONFIRM, ni accord de session ne
 * l'approuvent ; sans humain (headless) la réponse est un refus. Seul un script
 * de la liste blanche (source + chemin + sha256 du fichier COURANT, recalculé
 * ici à chaque exécution) passe sans confirmation.
 *
 * L'analyse est lexicale, donc elle est fermée par défaut (reprise 15) : une
 * commande ou un programme qui lance quelque chose avec un nom de fichier calculé
 * à l'exécution (variable, substitution, concaténation, glob, `xargs`) demande
 * aussi, tant qu'un skill importé porte des scripts non autorisés ; une lecture
 * d'un SCRIPT (`cat run.sh > x`) en est un lancement différé ; une commande qui
 * part d'un dossier de skill (`make` nu) vise ses scripts. Limites : un nom
 * calculé à partir de données hors du texte de la commande, et la réécriture à
 * la main d'un script par l'agent, ne sont pas vus.
 *
 * @module tools/bash/imported-skill-guard
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as yaml from 'yaml';
import { getCodeBuddyPath } from '../../utils/codebuddy-home.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import {
  importedSkillRoots,
  classifyFile,
  findExecutablePayloads,
  loadExecAllowlist,
  sha256File,
  type ExecAllowlistEntry,
} from '../../security/skill-executable-gate.js';

const IMPORTED_PREFIX = 'imported-';

/** Commandes qui, lancées depuis un dossier de skill, ne peuvent pas exécuter son contenu. */
const LAUNCHER_FREE = new Set(['git', 'rm', 'mv', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'ln', 'sleep', 'date', 'which', 'whoami', 'id', 'uname']);

/** Commandes qui ne font que lire ou se déplacer : citer un script ne le lance pas. */
const READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'ls', 'tree', 'wc', 'stat', 'file', 'grep', 'egrep', 'fgrep', 'rg',
  'sha256sum', 'sha1sum', 'md5sum', 'diff', 'cmp', 'nl', 'cd', 'pushd', 'popd', 'echo', 'printf', 'pwd',
  'true', 'false', 'du', 'realpath', 'basename', 'dirname', 'readlink',
]);

/** Interpréteurs et leurs options « code en ligne ». */
const INLINE_FLAGS: Record<string, RegExp> = {
  bash: /^-\w*c/, sh: /^-\w*c/, zsh: /^-\w*c/, dash: /^-\w*c/, ksh: /^-\w*c/, fish: /^-\w*c/,
  python: /^-\w*c/, python3: /^-\w*c/, node: /^(?:-\w*[ep]|--eval|--print)$/, nodejs: /^(?:-\w*[ep]|--eval)$/,
  bun: /^(?:-\w*e|--eval)$/, deno: /^eval$/, perl: /^-\w*[eE]/, ruby: /^-\w*e/, php: /^-\w*r/, lua: /^-\w*e/,
};

export interface ImportedScriptHit {
  /** Chemin absolu du script. */
  file: string;
  skillDir: string;
  /** Empreinte épinglée au moment de la décision ('' pour un lancement en ligne ou un fichier illisible). */
  sha256: string;
  allowed: boolean;
  /** Avertissements de l'analyse par motifs enregistrés à l'import (affichés dans la confirmation). */
  warnings: string[];
  /** `-c` / `-e` lancé depuis le dossier du skill : pas de fichier à épingler. */
  inline?: boolean;
  /** Chemin construit à l'exécution (variable, substitution, concaténation) alors qu'un skill importé à scripts non vérifiés est installé : le fichier visé est inconnu. */
  dynamic?: boolean;
}

export { importedSkillRoots };

function skillDirOf(candidate: string, roots: string[]): string | null {
  for (const root of roots) {
    const rel = path.relative(root, candidate);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const first = rel.split(path.sep)[0]!;
    if (first.startsWith(IMPORTED_PREFIX)) return path.join(root, first);
  }
  return null;
}

interface SkillScriptManifest {
  source: string;
  /** `scriptsUnverified: true` : le skill embarquait des scripts non vérifiés (information). */
  unverified: boolean;
  /** chemin relatif au skill installé -> chemin relatif au dossier source. */
  scripts: Map<string, string>;
  warnings: Map<string, string[]>;
}

function readManifest(skillDir: string): SkillScriptManifest {
  const empty: SkillScriptManifest = { source: '', unverified: false, scripts: new Map(), warnings: new Map() };
  try {
    const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return empty;
    const fm = (yaml.parse(m[1]!) ?? {}) as Record<string, unknown>;
    const scripts = new Map<string, string>();
    const warnings = new Map<string, string[]>();
    if (Array.isArray(fm.scripts)) {
      for (const s of fm.scripts) {
        const e = s as Record<string, unknown>;
        if (typeof e?.path === 'string' && typeof e.sourcePath === 'string') {
          scripts.set(e.path, e.sourcePath);
          if (Array.isArray(e.warnings)) warnings.set(e.path, e.warnings.filter((w): w is string => typeof w === 'string'));
        }
      }
    }
    return { source: typeof fm.source === 'string' ? fm.source : '', unverified: fm.scriptsUnverified === true || scripts.size > 0, scripts, warnings };
  } catch {
    return empty;
  }
}

function expandToken(token: string): string | null {
  let t = token;
  const home = os.homedir();
  if (t === '~' || t.startsWith('~/')) t = home + t.slice(1);
  t = t.replace(/^\$\{HOME\}/, home).replace(/^\$HOME/, home);
  // Une autre substitution ne se résout pas statiquement.
  if (/\$|\{/.test(t)) return null;
  return t;
}

/** Séparateurs de commandes simples ; les guillemets sont retirés des mots. */
function segmentsOf(command: string): string[][] {
  // Output redirection targets are not commands; an input redirection (`bash < run.sh`) keeps its file in the segment.
  const noOutputTargets = command.replace(/\d*>>?[|&]?\s*\S+/g, ' ').replace(/<<?-?/g, ' ');
  return noOutputTargets
    .split(/[;&|\n`()]+/)
    .map(seg => seg.split(/\s+/).map(w => w.replace(/["'\\]/g, '')).filter(Boolean))
    .filter(words => words.length > 0);
}

function candidatesOf(word: string): string[] {
  const out = [word];
  const eq = word.indexOf('=');
  if (eq > 0) out.push(word.slice(eq + 1));
  return out;
}

function resolveCandidate(raw: string, bases: string[]): string[] {
  const expanded = expandToken(raw);
  if (expanded === null || expanded === '') return [];
  // Un motif de fichier : on garde le dossier qui le précède.
  const glob = expanded.search(/[*?[]/);
  const base = glob >= 0 ? expanded.slice(0, Math.max(0, expanded.lastIndexOf('/', glob)) + 1) || '.' : expanded;
  return path.isAbsolute(base) ? [path.resolve(base)] : bases.map(b => path.resolve(b, base));
}

function realOrSame(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Premiers mots qui lancent du code (interpréteurs, constructeurs, enveloppes). */
const LAUNCHERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash', 'python', 'node', 'nodejs', 'deno', 'bun', 'perl', 'ruby',
  'php', 'lua', 'tclsh', 'wish', 'make', 'gmake', 'just', 'awk', 'gawk', 'mawk', 'sed', 'env', 'xargs', 'parallel', 'source',
  '.', 'exec', 'eval', 'nohup', 'timeout', 'nice', 'ionice', 'stdbuf', 'setsid', 'script', 'watch', 'find', 'sudo', 'doas',
  'su', 'sg', 'chroot', 'unshare', 'bwrap', 'firejail', 'docker', 'podman', 'npm', 'npx', 'yarn', 'pnpm', 'java', 'Rscript',
  'julia', 'tsx', 'ts-node', 'pwsh', 'powershell', 'osascript', 'expect', 'busybox', 'command', 'builtin', 'time', 'strace',
  'cargo', 'go', 'gcc', 'cc', 'tcl', 'groovy', 'ld.so',
]);

/** Expansions qui ne cachent pas un chemin : `$HOME`, `$PWD`, codes de retour. */
const BENIGN_EXPANSION = /\$\{?(?:HOME|PWD|OLDPWD|USER|\?|#|\$|!)\}?/g;

/** Chemin construit par le shell : substitution, variable, accolades, quote ANSI-C, process substitution. */
function shellDynamic(rawSegment: string): boolean {
  const t = rawSegment.replace(BENIGN_EXPANSION, '');
  return /\$\(|`|\$\{|\$[A-Za-z_]|\$'|\$"|<\(|\{[^{}\s]*,[^{}\s]*\}/.test(t);
}

/** Programme (execute_code, code_exec, cellule…) : indices d'un nom de fichier ou d'un module calculé à l'exécution. */
const CODE_COMPUTES_NAME = /["'`]\s*\+\s*["'`]|["'`]\s*\.\s*["'`]|\.join\(|\bbase64\b|\batob\b|b64decode|fromCharCode|\bchr\(|getattr\(|__import__|importlib|runpy|\beval\(|\bexec\(|\bcompile\(|\bFunction\(|new Function|\$\{|\bf["']|\.format\(|%s|path\.(?:join|resolve)|os\.path\.join|\bglob\b|readdir|listdir|\bwalk\(|constructor\._load|\brequire\(\s*[^"'`\s)]|\bimport\(\s*[^"'`\s)]|open\(\s*[^"'`\s)]/;
const CODE_HAS_FACILITY = /\bopen\(|readFile|require\(|import\(|\bimport\b|\bexec|\bspawn|system\(|subprocess|child_process|Popen|\bsource\b|\bbash\b|\bsh\b|runpy|importlib|\beval\b/;

function launcherName(word: string): string {
  const base = path.basename(word);
  const stripped = base.replace(/\d+(?:\.\d+)*$/, '');
  return LAUNCHERS.has(base) ? base : LAUNCHERS.has(stripped) ? stripped : base;
}

/** Skills `imported-*` qui portent encore des scripts non autorisés (empreinte courante hors liste blanche). */
function skillsWithPendingScripts(roots: string[], list: readonly ExecAllowlistEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith(IMPORTED_PREFIX)) continue;
      const dir = path.join(root, e.name);
      const key = realOrSame(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      const m = readManifest(dir);
      if (m.scripts.size === 0) continue;
      const pending = [...m.scripts].some(([rel, sourcePath]) => {
        let sha = '';
        try {
          sha = sha256File(path.join(dir, ...rel.split('/')));
        } catch { /* absent : rien à lancer */ return false; }
        return !(m.source !== '' && list.some(x => x.source === m.source && x.path === sourcePath && x.sha256 === sha));
      });
      if (pending) out.push(dir);
    }
  }
  return out;
}

export type GuardMode = 'shell' | 'code';

/**
 * Scripts de skills importés qu'une commande bash lance (ou semble lancer).
 * `allowlist` : liste blanche courante (relue à chaque appel par défaut).
 */
export function findImportedScriptHits(
  command: string,
  cwd: string,
  allowlist: readonly ExecAllowlistEntry[] | (() => readonly ExecAllowlistEntry[]) = () => loadExecAllowlist(),
  env: NodeJS.ProcessEnv = process.env,
  mode: GuardMode = 'shell',
): ImportedScriptHit[] {
  const roots = importedSkillRoots(env);
  const list = typeof allowlist === 'function' ? allowlist() : allowlist;
  const segments = mode === 'shell'
    ? segmentsOf(command)
    // A program: every quoted string and every whitespace word is a path candidate, one big segment.
    : [[
        ...[...command.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)].map(m => m[2]!),
        ...command.split(/[\s()[\]{},;=]+/).map(w => w.replace(/["'`\\]/g, '')),
        'python',
      ].filter(Boolean)];
  const words = segments.flat();
  const manifests = new Map<string, SkillScriptManifest>();
  const manifestOf = (dir: string): SkillScriptManifest => {
    let m = manifests.get(dir);
    if (!m) { m = readManifest(dir); manifests.set(dir, m); }
    return m;
  };

  // `cd <skill> && ./scripts/x.sh` : les mots relatifs se lisent aussi depuis chaque skill cité.
  const mentioned = new Set<string>();
  const cwdSkill = skillDirOf(realOrSame(cwd), roots);
  if (cwdSkill) mentioned.add(cwdSkill);
  for (const w of words) {
    for (const c of candidatesOf(w)) {
      for (const r of resolveCandidate(c, [cwd])) {
        const sd = skillDirOf(r, roots) ?? skillDirOf(realOrSame(r), roots);
        if (sd) mentioned.add(sd);
      }
    }
  }
  // A program that merely names a skill (`imported-foo`) without a resolvable path.
  if (mode === 'code') {
    for (const m of command.matchAll(/imported-[A-Za-z0-9._-]+/g)) {
      for (const root of roots) {
        const dir = path.join(root, m[0]!);
        if (fs.existsSync(dir)) mentioned.add(dir);
      }
    }
  }

  const bases = [cwd, ...mentioned];
  const files = new Set<string>();
  const inline = new Set<string>();
  const addDir = (dir: string): void => {
    for (const f of findExecutablePayloads(dir, dir).slice(0, 200)) files.add(path.join(dir, ...f.relPath.split('/')));
  };
  const isScriptFile = (abs: string, sd: string): boolean => {
    const rel = path.relative(sd, abs).split(path.sep).join('/');
    return manifestOf(sd).scripts.has(rel) || classifyFile(abs, rel) !== null;
  };

  let launches = mode === 'code';
  for (const seg of segments) {
    const firstIndex = seg.findIndex(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const first = seg[firstIndex < 0 ? 0 : firstIndex]!;
    const firstName = launcherName(first);
    const readOnly = mode === 'shell' && READ_ONLY_COMMANDS.has(path.basename(first));
    if (!readOnly && (LAUNCHERS.has(firstName) || /^\.{0,2}\//.test(first) || first.includes('/'))) launches = true;
    // `bash -c`, `python -c`, `node -e`… started from a skill directory: no file to pin.
    if (!readOnly) {
      const flag = INLINE_FLAGS[firstName] ?? INLINE_FLAGS[path.basename(first)];
      if (mode === 'shell' && flag && seg.slice(firstIndex + 1).some(w => flag.test(w))) {
        for (const sd of mentioned) inline.add(sd);
      }
      // Any non-reading command run from inside a skill (bare `make`, `./x`, `npm run`…): its scripts are in play.
      if (mode === 'shell' && mentioned.size > 0 && !LAUNCHER_FREE.has(path.basename(first))) {
        for (const sd of mentioned) addDir(sd);
      }
    }
    for (const w of seg) {
      for (const c of candidatesOf(w)) {
        for (const r of resolveCandidate(c, bases)) {
          const real = realOrSame(r);
          const sd = skillDirOf(r, roots) ?? skillDirOf(real, roots);
          if (!sd) continue;
          let info: fs.Stats;
          try {
            info = fs.lstatSync(r);
          } catch {
            continue;
          }
          if (info.isDirectory()) {
            if (!readOnly) addDir(r);
          } else if (readOnly) {
            // Reading a script is not harmless: `cat run.sh > x && bash x` copies it. Documents stay readable.
            if (isScriptFile(r, sd)) files.add(r);
          } else {
            // ANY file of an imported skill handed to a non-reading command counts, whatever its
            // name or content (`python x.py`, `bash notes.txt`, `make -f data.json`, a file the
            // import-time detection did not recognise): the detection is a hint, not the barrier.
            files.add(r);
          }
        }
      }
    }
  }

  const hits: ImportedScriptHit[] = [];
  for (const file of files) {
    const skillDir = skillDirOf(file, roots) ?? skillDirOf(realOrSame(file), roots);
    if (!skillDir) continue;
    let sha = '';
    try {
      sha = sha256File(file);
    } catch { /* illisible : jamais autorisé */ }
    const manifest = manifestOf(skillDir);
    const relInSkill = path.relative(skillDir, file).split(path.sep).join('/');
    const sourcePath = manifest.scripts.get(relInSkill);
    const allowed = sha !== '' && sourcePath !== undefined && manifest.source !== ''
      && list.some(e => e.source === manifest.source && e.path === sourcePath && e.sha256 === sha);
    hits.push({ file, skillDir, sha256: sha, allowed, warnings: manifest.warnings.get(relInSkill) ?? [] });
  }
  for (const skillDir of inline) {
    hits.push({ file: skillDir, skillDir, sha256: '', allowed: false, warnings: [], inline: true });
  }

  // File names that the command computes at run time cannot be resolved lexically, so the rule is
  // fail-closed: if something is launched with a computed name and any imported skill still carries
  // unverified scripts, a human decides. (Computing the name from data outside the command text,
  // or rewriting a script by hand, remains out of reach: documented limit.)
  let dynamic = false;
  if (launches) {
    if (mode === 'shell') {
      const raw = command.split(/[;&|\n]+/);
      dynamic = raw.some((seg) => {
        const trimmed = seg.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
        const first = trimmed.split(/\s+/)[0] ?? '';
        const name = launcherName(first.replace(/["'\\]/g, ''));
        if (READ_ONLY_COMMANDS.has(path.basename(first))) return false;
        if (!(LAUNCHERS.has(name) || first.includes('/'))) return false;
        const args = trimmed.split(/\s+/).slice(1).join(' ');
        const globbedPath = /[*?]/.test(args) && args.includes('/');
        const inlineFlag = INLINE_FLAGS[name];
        const inlineComputed = inlineFlag !== undefined
          && trimmed.split(/\s+/).slice(1).some(w => inlineFlag.test(w))
          && CODE_COMPUTES_NAME.test(trimmed) && CODE_HAS_FACILITY.test(trimmed);
        return shellDynamic(seg) || name === 'xargs' || name === 'parallel' || globbedPath || inlineComputed;
      });
    } else {
      dynamic = CODE_COMPUTES_NAME.test(command) && CODE_HAS_FACILITY.test(command);
    }
  }
  if (dynamic) {
    const pending = skillsWithPendingScripts(roots, list);
    if (pending.length > 0) {
      hits.push({ file: pending[0]!, skillDir: pending[0]!, sha256: '', allowed: false, warnings: [], dynamic: true });
    }
  }
  return hits;
}

export interface ImportedScriptDecision {
  confirmed: boolean;
  error?: string;
  /**
   * Re-hache chaque fichier épinglé : `null` si rien n'a changé, sinon le refus.
   * À appeler juste avant le lancement (approbation liée au contenu).
   */
  verifyUnchanged(): string | null;
}

/** Même garde pour un outil qui exécute du CODE (execute_code, code_exec, cellule, run_script…). */
export function confirmImportedSkillCode(code: string, cwd: string, language?: string): Promise<ImportedScriptDecision | null> {
  return confirmImportedSkillScripts(code, cwd, language === 'shell' || language === 'bash' || language === 'sh' ? 'shell' : 'code');
}

/**
 * Point d'accroche unique de BashTool (exécution tamponnée, flux, argv).
 * Retourne `null` quand la commande n'engage aucun fichier de skill importé ;
 * sinon la décision (confirmation humaine forcée tant que tout n'est pas sur la
 * liste blanche) et le contrôle d'empreinte à refaire avant de lancer.
 */
export async function confirmImportedSkillScripts(
  command: string,
  cwd: string,
  mode: GuardMode = 'shell',
): Promise<ImportedScriptDecision | null> {
  let hits: ImportedScriptHit[];
  try {
    hits = findImportedScriptHits(command, cwd, undefined, process.env, mode);
  } catch {
    // Une analyse qui échoue ne doit pas bloquer tout bash : le reste des gardes s'applique.
    hits = [];
  }
  if (hits.length === 0) return null;
  const verifyUnchanged = (): string | null => {
    for (const h of hits) {
      if (h.inline || h.sha256 === '') continue;
      let now = '';
      try {
        now = sha256File(h.file);
      } catch { /* disparu ou illisible */ }
      if (now !== h.sha256) {
        return `Imported skill file changed after it was approved or allowlisted (${h.file}); command refused.`;
      }
    }
    return null;
  };
  const pending = hits.filter(h => !h.allowed);
  if (pending.length === 0) return { confirmed: true, verifyUnchanged };
  const shown = pending.slice(0, 5).map(h =>
    h.dynamic
      ? `a file name computed at run time (variable, substitution, concatenation, glob) while imported skill ${h.skillDir} still has unverified scripts`
      : h.inline
      ? `inline code (-c/-e) run from ${h.file}`
      : `${h.file} (sha256 ${h.sha256 || 'unreadable'})${h.warnings.length ? `\n    pattern warnings: ${h.warnings.join(' | ')}` : ''}`,
  ).join('\n  ');
  const result = await ConfirmationService.getInstance().requestConfirmation(
    {
      operation: 'Run a file from an imported skill with unverified scripts',
      filename: command,
      showVSCodeOpen: false,
      content:
        `Command: ${command}\nWorking directory: ${cwd}\n`
        + `Unverified file${pending.length > 1 ? 's' : ''} from an imported skill:\n  ${shown}\n`
        + 'Read the file first. Approval is bound to the sha256 above: if the file changes, the command is refused. '
        + 'To stop asking, add its exact line to ~/.codebuddy/skill-exec-allowlist.json.',
      riskLevel: 'high',
      // Fresh human decision every time: no mode, env flag or session grant approves it.
      forcePrompt: true,
      detail: { cwd },
    },
    'bash',
  );
  return result.confirmed
    ? { confirmed: true, verifyUnchanged }
    : { confirmed: false, error: result.feedback || 'Imported skill script not approved', verifyUnchanged };
}
