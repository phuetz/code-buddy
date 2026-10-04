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
 * Ce qui est garanti (reprise 18) : (a) scripts importés inertes ; (b) tant qu'un skill a
 * un script non autorisé, une confirmation forcée dès que l'analyse (tree-sitter-bash,
 * récursive sur `-c`/`eval`/`env -S`, enveloppes et leurs options à argument, globs
 * POSIX, accolades, listes `for`) fait apparaître un fichier du skill, que `find
 * -exec`/`xargs`/`parallel`/`make` couvrent son dossier, ou que le texte ou le mot de
 * commande n'est pas résolu avec certitude ; (c) sha256 recalculé avant le lancement.
 * NON garanti : recopier ou reconstruire le script ailleurs puis le lancer (`cp`,
 * `printf`, octets, `os.environ`, `sys.argv`…) équivaut à le réécrire à la main.
 *
 * @module tools/bash/imported-skill-guard
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import * as yaml from 'yaml';
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
const SHELL_NAMES = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'csh', 'tcsh']);
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
  /** `find -exec`, `xargs`, `parallel`, `make` lancés sur un dossier qui contient ou recouvre un skill à scripts non autorisés. */
  covering?: string;
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

interface TsNode { type: string; text: string; childCount: number; child(i: number): TsNode | null; hasError?: boolean }
type TsParser = { setLanguage(l: unknown): void; parse(s: string): { rootNode: TsNode & { hasError: boolean } } };
let tsParser: TsParser | null | undefined;

/** The real shell grammar (tree-sitter-bash, a regular dependency), loaded synchronously. */
function shellParser(): TsParser {
  if (tsParser === undefined) {
    try {
      const req = createRequire(import.meta.url);
      const Parser = req('tree-sitter') as new () => TsParser;
      const parser = new Parser();
      parser.setLanguage(req('tree-sitter-bash'));
      tsParser = parser;
    } catch {
      tsParser = null;
    }
  }
  if (!tsParser) throw new Error('shell grammar unavailable');
  return tsParser;
}

/**
 * Simple commands of a shell text, one word list each, from the real parser (sub-shells,
 * `\(`…`\)`, line continuations, quotes, `$( )`, pipes, redirections). Output redirection
 * targets are dropped, input redirection files are kept with the command. A text the parser
 * cannot read throws: the caller treats that as "ask" (closed).
 */
function parseShellSegments(command: string): string[][] {
  const root = shellParser().parse(command).rootNode;
  if (root.hasError) throw new Error('shell text could not be parsed');
  const out: string[][] = [];
  // Text of a shell word as the shell would hand it over (quotes and escapes resolved), so `bash -c "…"` can be re-parsed.
  const wordText = (n: TsNode): string => {
    switch (n.type) {
      case 'string': return n.text.replace(/^"|"$/g, '').replace(/\\(["\\$`])/g, '$1');
      case 'raw_string': return n.text.replace(/^'|'$/g, '');
      case 'concatenation': {
        let t = '';
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) t += wordText(c); }
        return t;
      }
      case 'word': return n.text.replace(/\\(.)/gs, '$1');
      default: return n.text;
    }
  };
  const clean = (t: string): string => t.replace(/["'\\]/g, '');
  const walk = (n: TsNode, inputFiles: string[]): void => {
    if (n.type === 'redirected_statement') {
      const inputs: string[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c?.type === 'file_redirect' && c.text.trimStart().startsWith('<')) {
          for (let j = 0; j < c.childCount; j++) {
            const d = c.child(j);
            if (d && d.type !== '<' && d.type !== 'file_descriptor') inputs.push(wordText(d));
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type !== 'file_redirect') walk(c, [...inputFiles, ...inputs]);
      }
      return;
    }
    if (n.type === 'variable_assignment') {
      out.push([clean(n.text)]);
      return;
    }
    if (n.type === 'for_statement') {
      // `for f in "<path>"; do bash "$f"; done` : the literals of the list are paths in play.
      const values: string[] = [];
      let afterIn = false;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c) continue;
        if (c.type === 'in') { afterIn = true; continue; }
        if (c.type === 'do_group' || c.type === ';') break;
        if (afterIn) values.push(wordText(c));
      }
      if (values.length > 0) out.push(['for', ...values]);
    }
    if (n.type === 'command') {
      const words: string[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c || c.type === 'file_redirect' || c.type === 'heredoc_redirect') continue;
        if (c.type === 'command_substitution' || c.type === 'process_substitution') continue;
        words.push(wordText(c));
      }
      out.push([...words, ...inputFiles].filter(Boolean));
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c, n.type === 'command' ? [] : inputFiles);
    }
  };
  walk(root, []);
  return out.filter(words => words.length > 0);
}

/**
 * Enveloppes qui lancent leur argument, avec leurs options À ARGUMENT (`env -u X`, `nice -n +5`,
 * `stdbuf -o L`, `timeout -s KILL 5`…) et le nombre d'arguments positionnels avant la commande
 * (`timeout <durée>`, `flock <fichier>`, `taskset <masque>`, `chrt <priorité>`).
 */
const WRAPPERS: Record<string, { optArgs: string[]; positionals: number }> = {
  env: { optArgs: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'], positionals: 0 },
  command: { optArgs: [], positionals: 0 },
  exec: { optArgs: ['-a'], positionals: 0 },
  builtin: { optArgs: [], positionals: 0 },
  time: { optArgs: ['-f', '--format', '-o', '--output'], positionals: 0 },
  nohup: { optArgs: [], positionals: 0 },
  nice: { optArgs: ['-n', '--adjustment'], positionals: 0 },
  ionice: { optArgs: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'], positionals: 0 },
  stdbuf: { optArgs: ['-i', '-o', '-e', '--input', '--output', '--error'], positionals: 0 },
  timeout: { optArgs: ['-s', '--signal', '-k', '--kill-after'], positionals: 1 },
  flock: { optArgs: ['-w', '-E', '--timeout', '--wait', '--conflict-exit-code'], positionals: 1 },
  busybox: { optArgs: [], positionals: 0 },
  sudo: { optArgs: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-R'], positionals: 0 },
  doas: { optArgs: ['-u', '-C'], positionals: 0 },
  setsid: { optArgs: [], positionals: 0 },
  chrt: { optArgs: [], positionals: 1 },
  taskset: { optArgs: ['-c', '--cpu-list'], positionals: 0 },
  unbuffer: { optArgs: [], positionals: 0 },
  strace: { optArgs: ['-o', '-e', '-p', '-s', '-u', '-E'], positionals: 0 },
  ltrace: { optArgs: ['-o', '-e', '-p', '-s', '-u'], positionals: 0 },
};

interface CommandPosition {
  /** Index of the word that is really run (past assignments and wrappers). */
  index: number;
  /** Text handed to the shell by `env -S`. */
  splitString?: string;
}

function commandPosition(seg: string[]): CommandPosition {
  let i = 0;
  let splitString: string | undefined;
  for (;;) {
    while (i < seg.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg[i]!)) i++;
    if (i >= seg.length) return { index: Math.max(0, seg.length - 1), ...(splitString ? { splitString } : {}) };
    const name = path.basename(seg[i]!);
    const wrapper = WRAPPERS[name];
    if (!wrapper) return { index: i, ...(splitString ? { splitString } : {}) };
    i++;
    let positionals = wrapper.positionals;
    let usedCpuList = false;
    while (i < seg.length) {
      const w = seg[i]!;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; }
      if (w === '--') { i++; break; }
      if (w.startsWith('-') && w.length > 1) {
        if (wrapper.optArgs.includes(w)) {
          if ((w === '-S' || w === '--split-string') && seg[i + 1] !== undefined) splitString = seg[i + 1];
          if (name === 'taskset' && (w === '-c' || w === '--cpu-list')) usedCpuList = true;
          i += 2;
        } else {
          i++;
        }
        continue;
      }
      // `nice -n +5` consumed above; a bare `+5` / duration / mask is positional.
      if (/^[-+]?\d+(?:\.\d+)?[smhd]?$/.test(w) && name !== 'nohup') { i++; if (positionals > 0) positionals--; continue; }
      if (positionals > 0 && !(name === 'taskset' && usedCpuList)) { positionals--; i++; continue; }
      break;
    }
    if (name === 'taskset' && !usedCpuList && i < seg.length && /^(?:0x)?[0-9a-fA-F]+$/.test(seg[i]!)) i++;
  }
}

/** Même sens que l'ancien index, pour les appelants qui n'ont besoin que de la position. */
function commandIndex(seg: string[]): number {
  return commandPosition(seg).index;
}

/** `{a,b}` brace expansion, bounded. */
function expandBraces(word: string, limit = 64): string[] {
  const m = word.match(/^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s);
  if (!m) return [word];
  const out: string[] = [];
  for (const alt of m[2]!.split(',')) {
    for (const e of expandBraces(`${m[1]}${alt}${m[3]}`, limit)) {
      out.push(e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w', cntrl: '\\x00-\\x1f', print: ' -~', graph: '!-~',
};

/** One glob path segment (`*`, `?`, `[..]` with POSIX classes and `!`/`^` negation) as a RegExp. */
function globSegmentToRegExp(part: string): RegExp {
  let re = '^';
  for (let i = 0; i < part.length; i++) {
    const ch = part[i]!;
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else if (ch === '[') {
      let j = i + 1;
      let cls = '';
      if (part[j] === '!' || part[j] === '^') { cls += '^'; j++; }
      if (part[j] === ']') { cls += '\\]'; j++; }
      let closed = false;
      for (; j < part.length; j++) {
        if (part[j] === '[' && part[j + 1] === ':') {
          const end = part.indexOf(':]', j + 2);
          if (end > 0) { cls += POSIX_CLASSES[part.slice(j + 2, end)] ?? ''; j = end + 1; continue; }
        }
        if (part[j] === ']') { closed = true; break; }
        cls += part[j] === '\\' || part[j] === '^' && cls.length > 0 ? `\\${part[j]}` : part[j];
      }
      if (!closed) { re += '\\['; continue; }
      re += `[${cls}]`;
      i = j;
    } else re += ch.replace(/[.+^${}()|\\\]/]/g, '\\$&');
  }
  return new RegExp(`${re}$`);
}

/** Minimal glob over the real file system, bounded. */
function globMatches(pattern: string, limit = 200): string[] {
  const parts = pattern.split('/');
  let current: string[] = [pattern.startsWith('/') ? '/' : ''];
  for (let k = pattern.startsWith('/') ? 1 : 0; k < parts.length; k++) {
    const part = parts[k]!;
    const next: string[] = [];
    for (const base of current) {
      if (!/[*?[]/.test(part)) {
        next.push(base === '' ? part : path.join(base, part));
        continue;
      }
      let re: RegExp;
      try {
        re = globSegmentToRegExp(part);
      } catch {
        continue;
      }
      let names: string[] = [];
      try {
        names = fs.readdirSync(base === '' ? '.' : base);
      } catch { /* absent dir: no match */ }
      for (const name of names) {
        if (re.test(name) && (!name.startsWith('.') || part.startsWith('.'))) next.push(base === '' ? name : path.join(base, name));
        if (next.length >= limit) break;
      }
    }
    current = next.slice(0, limit);
  }
  return current;
}

function candidatesOf(word: string): string[] {
  const out = [word];
  const eq = word.indexOf('=');
  if (eq > 0) out.push(word.slice(eq + 1));
  return out;
}

function resolveCandidate(raw: string, bases: string[]): string[] {
  const out: string[] = [];
  for (const braced of expandBraces(raw)) {
    const expanded = expandToken(braced);
    if (expanded === null || expanded === '') continue;
    const abs = path.isAbsolute(expanded) ? [expanded] : bases.map(b => path.resolve(b, expanded));
    for (const a of abs) {
      if (/[*?[]/.test(a)) {
        out.push(...globMatches(a));
        // What the matcher cannot be sure about (`**`, odd classes): the directory before the first wildcard is in play too.
        const cut = a.search(/[*?[]/);
        out.push(path.resolve(a.slice(0, Math.max(0, a.lastIndexOf('/', cut)) + 1) || '.'));
      }
      else out.push(path.resolve(a));
    }
  }
  return out;
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
  depth = 0,
): ImportedScriptHit[] {
  if (depth > 4) throw new Error('shell nesting too deep');
  const roots = importedSkillRoots(env);
  const list = typeof allowlist === 'function' ? allowlist() : allowlist;
  const segments = mode === 'shell'
    ? parseShellSegments(command)
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
    if (!fs.existsSync(dir)) return;
    for (const f of findExecutablePayloads(dir, dir).slice(0, 200)) files.add(path.join(dir, ...f.relPath.split('/')));
  };
  const isScriptFile = (abs: string, sd: string): boolean => {
    const rel = path.relative(sd, abs).split(path.sep).join('/');
    return manifestOf(sd).scripts.has(rel) || classifyFile(abs, rel) !== null;
  };

  const nested: Array<{ text: string; mode: GuardMode }> = [];
  for (const seg of segments) {
    const position = commandPosition(seg);
    const firstIndex = position.index;
    const first = seg[firstIndex]!;
    const firstName = launcherName(first);
    const assignmentsOnly = seg.every(w => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const readOnly = mode === 'shell' && (assignmentsOnly || READ_ONLY_COMMANDS.has(path.basename(first)));
    // The text handed to `bash -c`, `sh -c`, `eval`, `env -S`, `python -c`… is analysed again, recursively.
    if (!readOnly && mode === 'shell') {
      const rest = seg.slice(firstIndex + 1);
      const base = path.basename(first);
      if (SHELL_NAMES.has(launcherName(first))) {
        const j = rest.findIndex(w => /^-[A-Za-z]*c[A-Za-z]*$/.test(w));
        const text = j >= 0 ? rest.slice(j + 1).find(w => !w.startsWith('-')) : undefined;
        if (text) nested.push({ text, mode: 'shell' });
      } else if (base === 'eval') {
        nested.push({ text: rest.join(' '), mode: 'shell' });
      } else {
        const flag = INLINE_FLAGS[firstName];
        const j = flag ? rest.findIndex(w => flag.test(w)) : -1;
        if (j >= 0 && rest[j + 1] !== undefined) nested.push({ text: rest[j + 1]!, mode: 'code' });
      }
      if (position.splitString) nested.push({ text: position.splitString, mode: 'shell' });
    }
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

  for (const n of nested) hits.push(...findImportedScriptHits(n.text, cwd, list, env, n.mode, depth + 1));

  // Generic, path-based rule (no pattern list): `find -exec/-execdir/-ok`, `xargs`, `parallel` and `make`
  // run what they are pointed at. While an imported skill still has an unauthorised script, they ask when
  // the working directory or a path argument CONTAINS or OVERLAPS a skill directory (`find . -exec bash {} +`
  // from the project that holds the skill, `make -C ..`). Approval is not content-bound for these hits.
  {
    let pendingSkills: string[] | null = null;
    const EXEC_FLAG = /^-(?:exec|execdir|ok|okdir)$/;
    const covered = (name: string, seg: string[]): void => {
      pendingSkills ??= skillsWithPendingScripts(roots, list);
      if (pendingSkills.length === 0) return;
      const targets = new Set<string>([path.resolve(cwd)]);
      for (const w of seg) {
        for (const c of candidatesOf(w)) {
          for (const r of resolveCandidate(c, [cwd])) if (!c.startsWith('-')) targets.add(r);
        }
      }
      for (const target of targets) {
        const t = realOrSame(target);
        const overlap = pendingSkills.find((sd) => {
          const rs = realOrSame(sd);
          const down = path.relative(t, rs);
          const up = path.relative(rs, t);
          return (!down.startsWith('..') && !path.isAbsolute(down)) || (!up.startsWith('..') && !path.isAbsolute(up));
        });
        if (overlap) {
          hits.push({ file: overlap, skillDir: overlap, sha256: '', allowed: false, warnings: [], covering: `${name} over ${target}` });
          return;
        }
      }
    };
    const askIfPending = (reason: string): void => {
      pendingSkills ??= skillsWithPendingScripts(roots, list);
      if (pendingSkills.length > 0) {
        hits.push({ file: pendingSkills[0]!, skillDir: pendingSkills[0]!, sha256: '', allowed: false, warnings: [], covering: reason });
      }
    };
    if (mode === 'shell') {
      for (const seg of segments) {
        const effective = seg[commandIndex(seg)]!;
        const isAssignments = seg.every(w => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
        if (isAssignments || seg[0] === 'for' || READ_ONLY_COMMANDS.has(path.basename(effective))) continue;
        // The tool or wrapper may be anywhere in the segment (`flock -n . find …`, `systemd-run make`): look at every word.
        const names = seg.map(w => launcherName(w));
        const name = names.includes('find') && seg.some(w => EXEC_FLAG.test(w)) ? 'find'
          : (['xargs', 'parallel', 'make', 'gmake'] as const).find(n => names.includes(n));
        if (name) covered(name, seg);
        // Whatever the analyser cannot classify with certainty (a command word that is a variable, a glob or an option):
        // ask while a skill still has an unauthorised script.
        if (/[$`*?]/.test(effective) || /^[-+]/.test(effective)) askIfPending(`command word not resolvable (${effective})`);
      }
    } else {
      // A program that spells the tool and its arguments as strings (`subprocess.run(["find", root, "-exec", …])`, `os.system("make")`).
      const all = segments[0] ?? [];
      const name = all.includes('find') && all.some(w => EXEC_FLAG.test(w)) ? 'find'
        : (['xargs', 'parallel', 'make', 'gmake'] as const).find(n => all.includes(n));
      if (name) covered(name, all);
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
    // Analysis failure: fail closed only while some imported skill still has unauthorised scripts.
    hits = [];
    try {
      const pending = skillsWithPendingScripts(importedSkillRoots(), loadExecAllowlist());
      if (pending.length > 0) hits = [{ file: pending[0]!, skillDir: pending[0]!, sha256: '', allowed: false, warnings: [], covering: 'analysis failed for this command' }];
    } catch { /* nothing to protect or nothing readable */ }
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
    h.covering
      ? `${h.covering}, which contains or overlaps imported skill ${h.skillDir} (unverified scripts)`
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
