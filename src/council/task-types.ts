/**
 * Shared task taxonomy for council learning and fleet routing.
 *
 * The string extension keeps third-party and future task labels compatible
 * while the known values remain discoverable to TypeScript callers.
 */

export const SCOREBOARD_TASK_TYPES = [
  'benchmark',
  'french',
  'code',
  'general',
  'reasoning',
  'vision',
  'redaction-fr',
  'arbitrage-litteraire',
  'jugement-litteraire',
  'audit-adversarial',
  'relecture-typo',
] as const;

export type KnownTaskType = (typeof SCOREBOARD_TASK_TYPES)[number];
export type TaskType = KnownTaskType | (string & {});

const KNOWN_TASK_TYPES = new Set<string>(SCOREBOARD_TASK_TYPES);

export function isKnownTaskType(value: string): value is KnownTaskType {
  return KNOWN_TASK_TYPES.has(value);
}

/**
 * Infer the most specific literary task before the generic technical and
 * language heuristics run. A French prompt is not necessarily a French task:
 * the category describes the work, not merely the prompt language.
 */
export function inferLiteraryTaskType(task: string): KnownTaskType | undefined {
  const t = task.toLocaleLowerCase('fr-FR');

  if (
    /\b(?:relecture|relire|relis|relisez|typograph\w*|orthograph\w*|ponctuation|proofread\w*|copyedit\w*|typeset\w*)\b/.test(t)
  ) {
    return 'relecture-typo';
  }

  if (
    /\b(?:audit\s+adversarial|adversarial\s+audit|red[ -]?team|attaque(?:r)?|attack(?:ed|ing)?|threat\s+model)\b/.test(t)
  ) {
    return 'audit-adversarial';
  }

  if (
    /\b(?:arbitrage|arbitre(?:r)?|author\s+arbitration)\b/.test(t)
    || (
      /\b(?:tranche(?:r|z)?|decide\s+between|choose\s+between)\b/.test(t)
      && /\b(?:auteur|author|version\w*|candidate\w*|manuscrit\w*|texte\w*)\b/.test(t)
    )
    || (
      /\b(?:tranche(?:r|z)?|decide\s+between|choose\s+between)\b/.test(t)
      && !/\b(?:code|cli|fichier|file|function|migration|plan|script|api|serveur|server|database|sql|json)\b/.test(t)
    )
  ) {
    return 'arbitrage-litteraire';
  }

  if (
    /\b(?:juge(?:r|z)?|judge|evaluate)\b/.test(t)
    && /\b(?:version\w*|candidate\w*|blind|aveugle|texte\w*|manuscrit\w*|literary|litt[ée]raire)\b/.test(t)
  ) {
    return 'jugement-litteraire';
  }

  if (
    /\b(?:[ée]cri(?:s|re|vez)?|r[ée]dig(?:e|er|ez)?|draft|write|writes|writing|chapter|chapitre|roman|novel|short\s+story|prose|manuscrit)\b/.test(t)
    && /\b(?:chapter|chapitre|roman|novel|story|prose|manuscrit|litt[ée]raire|literary|scene|sc[èe]ne|fiction)\b/.test(t)
  ) {
    return 'redaction-fr';
  }

  if (
    /\b(?:r[ée]dig(?:e|er|ez)?|draft|writing|write)\b/.test(t)
    && !/\b(?:code|cli|fichier|file|function|migration|script|api|serveur|server|database|sql|json|po[èe]me|poem)\b/.test(t)
  ) {
    return 'redaction-fr';
  }

  return undefined;
}
