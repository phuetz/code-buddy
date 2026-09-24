/**
 * Mandates — what Lisa may do on her own, written by her owner.
 *
 * A mandate is a standing order in `~/.codebuddy/lisa/mandats.toml` (outside any repository):
 * which tools, which effects, from which origin (a heard voice turn, a self-started initiative),
 * within which paths, how often, until when, and whether it already runs on its own or is still
 * supervised. The charter decides the rest, in a fixed order (`decideAutonomousAction`):
 *
 *   1. only AUTONOMOUS origins are decided here; an interactive session keeps its own flow;
 *   2. an unidentified speaker never acts (fail closed);
 *   3. Lisa never writes her own guardrails (mandates, charter, identities, policies);
 *   4. an undeclared effect is never allowed on its own;
 *   5. reading is free;
 *   6. an EMISSION towards the world (message to a third party, purchase, publication, e-mail,
 *      definitive deletion) is ALWAYS asked — no mandate can waive it;
 *   7. a REVERSIBLE action runs alone only under an autonomous, unexpired, in-cap mandate that
 *      names the tool, the origin and (when set) the paths — and always with a restore point.
 *      Anything else is asked. Silence to a question is a refusal (the asker's contract).
 *
 * The loader fails closed: an unreadable, invalid or symlinked file yields NO mandate, so every
 * reversible action falls back to asking.
 *
 * @module companion/mandates/mandates
 */

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';
import { z } from 'zod';
import { deobfuscateSafeForScan } from '../../security/text-deobfuscation.js';
import { logger } from '../../utils/logger.js';

export type ToolEffect = 'read' | 'reversible' | 'emission';
export type AutonomousOrigin = 'voice' | 'initiative';
export type IdentityRole = 'owner' | 'present' | 'guest';

const idRe = /^[a-z0-9][a-z0-9-]{1,63}$/;
const toolRe = /^[a-z][a-z0-9_]{1,63}$/;

export const mandateSchema = z
  .object({
    id: z.string().regex(idRe),
    description: z.string().min(3).max(300),
    /** `supervise`: every action is still asked; `autonome`: granted by the owner after verified successes. */
    confiance: z.enum(['supervise', 'autonome']),
    origines: z.array(z.enum(['voice', 'initiative'])).min(1).max(2),
    outils: z.array(z.string().regex(toolRe)).min(1).max(20),
    /** Only read/reversible: an emission can never be mandated away. */
    effets: z.array(z.enum(['read', 'reversible'])).min(1).max(2),
    /** Roots the action's targets must stay under (`~` expands to the home directory). Required:
     * a mandate without roots would grant its tools everywhere. */
    chemins: z.array(z.string().min(1).max(300)).min(1).max(10),
    /** Substrings that make a command or target refused under this mandate. */
    interdits: z.array(z.string().min(1).max(100)).max(30).optional(),
    plafond_par_jour: z.number().int().min(1).max(200),
    /** Local date 'YYYY-MM-DD' after which the mandate no longer applies. */
    expire: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type Mandate = z.infer<typeof mandateSchema>;

export const mandatesFileSchema = z
  .object({
    version: z.literal(1),
    mandat: z.array(mandateSchema).max(50),
  })
  .strict();

export function mandatesFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEBUDDY_LISA_MANDATES_FILE?.trim();
  return override && path.isAbsolute(override)
    ? override
    : path.join(homedir(), '.codebuddy', 'lisa', 'mandats.toml');
}

export interface LoadedMandates {
  mandates: Mandate[];
  /** Why nothing (or less than written) was loaded; empty when the file loaded cleanly. */
  problems: string[];
}

/** Load the owner's mandates. Fails closed: any doubt yields no mandate at all. Never throws. */
export function loadMandates(file: string = mandatesFilePath()): LoadedMandates {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    return { mandates: [], problems: [] };
  }
  if (stat.isSymbolicLink()) return refuse(`mandate file is a symlink, ignored: ${file}`);
  // A symlinked PARENT (e.g. ~/.codebuddy pointing elsewhere) is invisible to lstat on the file.
  try {
    if (realpathSync(file) !== path.resolve(file)) {
      return refuse(`mandate file is reached through a symlinked directory, ignored: ${file}`);
    }
  } catch {
    return refuse(`mandate file path cannot be resolved, ignored: ${file}`);
  }
  if (!stat.isFile()) return refuse(`mandate file is not a regular file, ignored: ${file}`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) {
    return refuse(`mandate file is writable by group or others, ignored: ${file}`);
  }
  // Someone who can write the DIRECTORY can replace the file whatever the file's own mode.
  if (process.platform !== 'win32') {
    try {
      if ((statSync(path.dirname(file)).mode & 0o022) !== 0) {
        return refuse(`mandate directory is writable by group or others, ignored: ${path.dirname(file)}`);
      }
    } catch {
      return refuse(`mandate directory cannot be inspected, ignored: ${path.dirname(file)}`);
    }
  }
  try {
    const parsed = mandatesFileSchema.safeParse(TOML.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      return refuse(`mandate file is invalid, ignored: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const ids = new Set<string>();
    for (const mandate of parsed.data.mandat) {
      if (ids.has(mandate.id)) return refuse(`duplicate mandate id, file ignored: ${mandate.id}`);
      ids.add(mandate.id);
    }
    return { mandates: parsed.data.mandat, problems: [] };
  } catch (err) {
    return refuse(`mandate file unreadable, ignored: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function refuse(problem: string): LoadedMandates {
  logger.warn(`[mandates] ${problem}`);
  return { mandates: [], problems: [problem] };
}

export type AutonomousDecision = 'defer' | 'allow' | 'allow-with-checkpoint' | 'ask' | 'deny';

export interface ActionRequest {
  tool: string;
  /** Declared effect of the tool (`src/tools/metadata.ts`); undefined when undeclared. */
  effect: ToolEffect | undefined;
  /** Undefined = interactive session: not decided here. */
  origin: AutonomousOrigin | undefined;
  role: IdentityRole;
  /** Absolute paths the action would touch (files written, moved, deleted). */
  targets?: string[];
  /** Shell command text, when the tool runs one. */
  command?: string;
}

export interface DecisionContext {
  mandates: Mandate[];
  now: Date;
  /** How many actions each mandate already ran today (the caller keeps the journal). */
  usedToday: (mandateId: string) => number;
  /** Paths Lisa may never write: mandates, charter, identities, policies. */
  protectedPaths: string[];
  home?: string;
}

export interface DecisionResult {
  decision: AutonomousDecision;
  reason: string;
  mandateId?: string;
}

/** Guardrail files Lisa must never write, whatever a mandate says. */
export function defaultProtectedPaths(home: string = homedir()): string[] {
  const codebuddy = path.join(home, '.codebuddy');
  return [
    path.join(codebuddy, 'lisa'),
    path.join(codebuddy, 'settings.json'),
    path.join(codebuddy, 'user-settings.json'),
    path.join(codebuddy, 'identity-links.json'),
    path.join(codebuddy, 'devices.json'),
    path.join(codebuddy, 'policies'),
    path.join(codebuddy, 'vision.env'),
    path.join(home, '.config', 'systemd', 'user'),
  ];
}

function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
}

/**
 * The REAL path a write would land on: a symlink planted in an allowed folder and pointing at a
 * guardrail must be judged by where it leads. For a path that does not exist yet, its nearest
 * existing ancestor is resolved and the rest re-appended.
 */
export function realTarget(target: string): string | null {
  let current = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(current), ...rest);
    } catch {
      // A component that EXISTS but cannot be resolved is a dangling (or looping) symlink: where a
      // write through it would land is unknown, so the path cannot be judged at all.
      try {
        lstatSync(current);
        return null;
      } catch {
        /* truly absent: judge by its nearest existing ancestor */
      }
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isUnder(target: string, root: string): boolean {
  const t = realTarget(target);
  const r = realTarget(root);
  if (t === null || r === null) return false;
  return t === r || t.startsWith(r + path.sep);
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The charter, in order. Pure: everything it needs is passed in. */
export function decideAutonomousAction(request: ActionRequest, context: DecisionContext): DecisionResult {
  if (!request.origin) return { decision: 'defer', reason: 'interactive session: its own confirmation flow applies' };
  if (request.role === 'guest') return { decision: 'deny', reason: 'unidentified speaker: never acts' };

  const home = context.home ?? homedir();
  const targets = request.targets ?? [];
  // The default guardrails are ALWAYS enforced; a caller can only add to them.
  const protectedPaths = [...defaultProtectedPaths(home), ...context.protectedPaths];
  if (targets.some((t) => realTarget(t) === null)) {
    return { decision: 'deny', reason: 'a target goes through a dangling symlink: where it lands is unknown' };
  }
  // Protected when the target is a guardrail, lies inside one, or CONTAINS one (moving or
  // deleting ~/.codebuddy would take ~/.codebuddy/lisa with it).
  const guarded = targets.find((t) => protectedPaths.some((p) => isUnder(t, p) || isUnder(p, t)));
  if (guarded && request.effect !== 'read') {
    return { decision: 'deny', reason: `Lisa never writes her own guardrails (${guarded})` };
  }

  if (!request.effect) return { decision: 'ask', reason: `effect of ${request.tool} is undeclared` };
  if (request.effect === 'read') return { decision: 'allow', reason: 'reading is free' };
  if (request.effect === 'emission') {
    return { decision: 'ask', reason: 'an emission towards the world is always asked' };
  }

  // A reversible action must say what it touches, in absolute paths; otherwise it is asked.
  if (targets.length === 0 || targets.some((t) => !path.isAbsolute(t))) {
    return { decision: 'ask', reason: 'a reversible action must name its absolute targets' };
  }
  const today = localDate(context.now);
  // Invisible characters, homoglyphs and odd spacing must not smuggle a forbidden word through.
  const haystack = deobfuscateSafeForScan([request.command ?? '', ...targets].join('\n'))
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let supervised: Mandate | undefined;
  for (const mandate of context.mandates) {
    if (!mandate.origines.includes(request.origin)) continue;
    if (!mandate.outils.includes(request.tool)) continue;
    if (!mandate.effets.includes('reversible')) continue;
    if (mandate.expire < today) continue;
    const forbidden = (mandate.interdits ?? []).map((w) => deobfuscateSafeForScan(w).toLowerCase().replace(/\s+/g, ' '));
    if (forbidden.some((word) => haystack.includes(word))) continue;
    const roots = mandate.chemins.map((c) => expandHome(c, home));
    if (!targets.every((t) => roots.some((r) => isUnder(t, r)))) continue;
    if (context.usedToday(mandate.id) >= mandate.plafond_par_jour) continue;
    if (mandate.confiance !== 'autonome') {
      supervised ??= mandate;
      continue;
    }
    return {
      decision: 'allow-with-checkpoint',
      reason: `mandate ${mandate.id}: reversible, with a restore point`,
      mandateId: mandate.id,
    };
  }
  if (supervised) {
    return { decision: 'ask', reason: `mandate ${supervised.id} is still supervised`, mandateId: supervised.id };
  }
  return { decision: 'ask', reason: 'no mandate covers this reversible action' };
}
