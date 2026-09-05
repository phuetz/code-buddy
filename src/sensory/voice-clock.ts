/**
 * Deterministic wall-clock answers for the voice loop. Time, date and weekday
 * are machine facts: they must not be guessed by a small-talk model.
 *
 * @module sensory/voice-clock
 */

export type ClockQuestionKind = 'time' | 'date' | 'weekday';

const VOCATIVE_PREFIX = /^(?:lisa|buddy|code buddy)\s+/;
const VOCATIVE_SUFFIX = /\s+(?:lisa|buddy)$/;
const POLITE_SUFFIX = /\s+(?:s il te plait|s il vous plait|stp|svp)$/;
const TODAY_SUFFIX = /\s+aujourd hui$/;
const LEAD_IN =
  /^(?:est ce que )?(?:(?:tu (?:peux|pourrais)|peux tu|pourrais tu) )?(?:me )?(?:dire |donner |indiquer )|^(?:dis moi |donne moi |indique moi )/;

const TIME_QUESTION =
  /^(?:quel(?:le)? heure(?: est il| il est)?|il est quelle heure|c est quelle heure|(?:t as|tu as) l heure|l heure(?: qu il est| actuelle)?)$/;
const DATE_QUESTION =
  /^(?:quel(?:le)? date(?: (?:est il|sommes nous|on est))?|on est quelle date|c est quelle date|(?:la )?date du jour|on est le combien|le combien(?: on est)?)$/;
const WEEKDAY_QUESTION =
  /^(?:(?:on est )?quel jour(?: on est| sommes nous| est il| de la semaine)?|c est quel jour(?: de la semaine)?)$/;

function canonicalizeClockQuery(heard: string): string {
  return heard
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(VOCATIVE_PREFIX, '')
    .replace(VOCATIVE_SUFFIX, '')
    .replace(POLITE_SUFFIX, '')
    .replace(TODAY_SUFFIX, '')
    .replace(LEAD_IN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyClockQuestion(heard: string): ClockQuestionKind | null {
  const query = canonicalizeClockQuery(heard);
  if (!query) return null;
  if (TIME_QUESTION.test(query)) return 'time';
  if (DATE_QUESTION.test(query)) return 'date';
  if (WEEKDAY_QUESTION.test(query)) return 'weekday';
  return null;
}

export function resolveVoiceTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_TIMEZONE?.trim();
  if (configured) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: configured }).resolvedOptions()
        .timeZone;
    } catch {
      /* invalid IANA name → machine zone */
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function spokenFrenchTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
    .format(now)
    .replace(/\u202f|\u00a0/g, ' ')
    .replace(':', ' h ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatVoiceClock(
  now: Date = new Date(),
  timeZone: string = resolveVoiceTimeZone(),
): { time: string; date: string; weekday: string; timeZone: string } {
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(now);
  const weekday = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    timeZone,
  }).format(now);
  return {
    time: spokenFrenchTime(now, timeZone),
    date,
    weekday,
    timeZone,
  };
}

/** Instant spoken answer for a direct clock question. null otherwise. */
export function clockCompanionReply(heard: string, now: Date = new Date()): string | null {
  const kind = classifyClockQuestion(heard);
  if (!kind) return null;
  const clock = formatVoiceClock(now);
  if (kind === 'time') return `Il est ${clock.time}.`;
  if (kind === 'date') return `Nous sommes ${clock.date}.`;
  return `Nous sommes ${clock.weekday}.`;
}

/** Per-turn system-prompt block so chitchat cannot invent the wall clock. */
export function voiceClockPromptBlock(now: Date = new Date()): string {
  const clock = formatVoiceClock(now);
  return [
    '<horloge>',
    `Maintenant : ${clock.date}, ${clock.time} (fuseau ${clock.timeZone}).`,
    "N'invente jamais l'heure, la date ou le jour : sers-toi uniquement de cet horodatage.",
    '</horloge>',
  ].join('\n');
}
