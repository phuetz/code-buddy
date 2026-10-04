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
 * Limite assumée : l'analyse est lexicale. Un chemin assemblé à l'exécution par
 * une variable ou une substitution n'est pas résolu (le script reste toutefois
 * sans bit exécutable : il faut un interpréteur explicite).
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
  findExecutablePayloads,
  loadExecAllowlist,
  sha256File,
  type ExecAllowlistEntry,
} from '../../security/skill-executable-gate.js';

const IMPORTED_PREFIX = 'imported-';

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
  return command
    .split(/[;&|\n`()<>]+/)
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

/**
 * Scripts de skills importés qu'une commande bash lance (ou semble lancer).
 * `allowlist` : liste blanche courante (relue à chaque appel par défaut).
 */
export function findImportedScriptHits(
  command: string,
  cwd: string,
  allowlist: readonly ExecAllowlistEntry[] | (() => readonly ExecAllowlistEntry[]) = () => loadExecAllowlist(),
  env: NodeJS.ProcessEnv = process.env,
): ImportedScriptHit[] {
  const roots = importedSkillRoots(env);
  const segments = segmentsOf(command);
  const words = segments.flat();
  // Quick exit: nothing in the command can name a skill directory.
  if (!words.some(w => w.includes('/') || w.includes('~') || w.includes('$') || /\.\w{1,5}$/.test(w))) return [];

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
  if (mentioned.size === 0) return [];
  const bases = [cwd, ...mentioned];

  const manifests = new Map<string, SkillScriptManifest>();
  const manifestOf = (dir: string): SkillScriptManifest => {
    let m = manifests.get(dir);
    if (!m) { m = readManifest(dir); manifests.set(dir, m); }
    return m;
  };
  const files = new Set<string>();
  const inline = new Set<string>();
  const addDir = (dir: string): void => {
    for (const f of findExecutablePayloads(dir, dir).slice(0, 200)) files.add(path.join(dir, ...f.relPath.split('/')));
  };
  for (const seg of segments) {
    const firstIndex = seg.findIndex(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const first = seg[firstIndex < 0 ? 0 : firstIndex]!;
    const firstName = path.basename(first);
    if (READ_ONLY_COMMANDS.has(firstName)) continue;
    // `bash -c`, `python -c`, `node -e`… started from a skill directory: no file to pin.
    const flag = INLINE_FLAGS[firstName.replace(/\d+(?:\.\d+)*$/, '') || firstName] ?? INLINE_FLAGS[firstName];
    if (flag && seg.slice(firstIndex + 1).some(w => flag.test(w))) {
      for (const sd of mentioned) inline.add(sd);
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
          if (info.isDirectory()) addDir(r);
          // ANY file of an imported skill handed to a non-reading command counts, whatever its
          // name or content (`python x.py`, `bash notes.txt`, `make -f data.json`, a file the
          // import-time detection did not recognise): the detection is a hint, not the barrier.
          else files.add(r);
        }
      }
    }
  }

  const list = typeof allowlist === 'function' ? allowlist() : allowlist;
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

/**
 * Point d'accroche unique de BashTool (exécution tamponnée, flux, argv).
 * Retourne `null` quand la commande n'engage aucun fichier de skill importé ;
 * sinon la décision (confirmation humaine forcée tant que tout n'est pas sur la
 * liste blanche) et le contrôle d'empreinte à refaire avant de lancer.
 */
export async function confirmImportedSkillScripts(
  command: string,
  cwd: string,
): Promise<ImportedScriptDecision | null> {
  let hits: ImportedScriptHit[];
  try {
    hits = findImportedScriptHits(command, cwd);
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
    h.inline
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
