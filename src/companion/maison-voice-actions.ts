import {
  CookingTimerStore,
  HomeModeStore,
  findNextZonedMinute,
  type HomeMode,
} from '../life-rhythm/index.js';
import { MealPlanStore } from '../meals/index.js';
import { logger } from '../utils/logger.js';
import { normalizeVoiceInteractionText } from '../sensory/voice-interactions.js';

export type MaisonVoiceCommand =
  | { kind: 'mode'; mode: HomeMode; durationMs?: number; boundaryHour?: number }
  | { kind: 'timer-start'; durationMs: number; label: string }
  | { kind: 'timer-list' }
  | { kind: 'timer-cancel'; label: string }
  | { kind: 'timer-ack'; label?: string }
  | { kind: 'meal-next' };

export interface MaisonVoiceActionDeps {
  speak: (text: string) => Promise<void>;
  now?: () => Date;
  timeZone?: string;
  homeModeStore?: Pick<HomeModeStore, 'setMode'>;
  cookingTimerStore?: Pick<
    CookingTimerStore,
    'start' | 'listActive' | 'cancel' | 'acknowledge'
  >;
  mealPlanStore?: Pick<MealPlanStore, 'nextUpcoming'>;
}

function parseSpokenDuration(text: string): number | undefined {
  const match = text.match(/\b(\d{1,3})\s*(seconde|secondes|minute|minutes|heure|heures)\b/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!;
  const multiplier = unit.startsWith('seconde')
    ? 1_000
    : unit.startsWith('minute')
      ? 60_000
      : 3_600_000;
  const durationMs = amount * multiplier;
  return durationMs >= 1_000 && durationMs <= 24 * 3_600_000 ? durationMs : undefined;
}

function cleanTimerLabel(value: string | undefined): string {
  const normalized = value?.replace(/^(?:le|la|les|des|du|de l)\s+/, '').trim();
  return normalized?.slice(0, 120) || 'cuisson';
}

/** Conservative deterministic parser: only explicit Maison/minuteur wording is intercepted. */
export function parseMaisonVoiceCommand(heard: string): MaisonVoiceCommand | null {
  const text = normalizeVoiceInteractionText(heard).replace(/^lisa\s+/, '').replace(/\s+lisa$/, '');
  if (!text) return null;

  const timerDuration = parseSpokenDuration(text);
  if (/\b(?:minuteur|chrono|chronometre)\b/.test(text) && /\b(?:mets|met|lance|demarre|regle|programme)\b/.test(text)) {
    if (!timerDuration) return null;
    const label = text.match(/\b(?:pour|nomme|appele)\s+(.+)$/)?.[1];
    return { kind: 'timer-start', durationMs: timerDuration, label: cleanTimerLabel(label) };
  }
  if (/\b(?:liste|quels|montre|reste)\b.*\b(?:minuteur|minuteurs|chronos?)\b/.test(text)) {
    return { kind: 'timer-list' };
  }
  const cancelTimer = text.match(/\b(?:annule|arrete|supprime)\s+(?:le\s+)?(?:minuteur|chrono)(?:\s+(?:de|des|du|pour))?\s*(.*)$/);
  if (cancelTimer) return { kind: 'timer-cancel', label: cleanTimerLabel(cancelTimer[1]) };
  const ackTimer = text.match(/\b(?:acquitte|confirme|ok|c est bon|j ai vu)\b.*\b(?:minuteur|chrono)\b(?:\s+(?:de|des|du|pour))?\s*(.*)$/);
  if (ackTimer) return { kind: 'timer-ack', ...(ackTimer[1]?.trim() ? { label: cleanTimerLabel(ackTimer[1]) } : {}) };

  if (/^(?:qu est ce qu on mange|on mange quoi|quel est le prochain repas|qu est ce qui est prevu (?:pour|au) (?:repas|dejeuner|diner))$/.test(text)) {
    return { kind: 'meal-next' };
  }

  const explicitDuration = parseSpokenDuration(text);
  if (/\b(?:silence|mode silencieux|ne me derange pas|ne parle pas)\b/.test(text)) {
    return {
      kind: 'mode',
      mode: 'silent',
      ...(explicitDuration ? { durationMs: explicitDuration } : {}),
      ...(/\b(?:aujourd hui|jusqu a demain)\b/.test(text) ? { boundaryHour: 0 } : {}),
    };
  }
  if (/\b(?:je vais dormir|je vais me coucher|bonne nuit)\b/.test(text)) {
    return { kind: 'mode', mode: 'rest', boundaryHour: 8 };
  }
  if (/\b(?:mode concentration|mode focus|je veux me concentrer|protege mon attention)\b/.test(text)) {
    return { kind: 'mode', mode: 'focus', ...(explicitDuration ? { durationMs: explicitDuration } : {}) };
  }
  if (/\b(?:mode repos|je veux me reposer|laisse moi me reposer)\b/.test(text)) {
    return { kind: 'mode', mode: 'rest', ...(explicitDuration ? { durationMs: explicitDuration } : {}) };
  }
  if (/\b(?:mode cuisine|je vais cuisiner|on cuisine|commencons a cuisiner)\b/.test(text)) {
    return { kind: 'mode', mode: 'cooking' };
  }
  if (/\b(?:mode invites|j ai des invites|on a des invites)\b/.test(text)) {
    return { kind: 'mode', mode: 'guests' };
  }
  if (/\b(?:les invites sont partis|fin du mode invites)\b/.test(text)) {
    return { kind: 'mode', mode: 'normal' };
  }
  if (/\b(?:mode absent|mode absence|je passe en mode absent)\b/.test(text)) {
    return { kind: 'mode', mode: 'away' };
  }
  if (/\b(?:journee libre|mode journee libre|je suis en conge)\b/.test(text)) {
    return { kind: 'mode', mode: 'free-day' };
  }
  if (/\b(?:mode normal|reprends le mode normal|tu peux reparler|je suis de retour|je suis rentre)\b/.test(text)) {
    return { kind: 'mode', mode: 'normal' };
  }
  return null;
}

export function isMaisonVoiceCommand(text: string): boolean {
  return parseMaisonVoiceCommand(text) !== null;
}

function selectTimer<T extends { label: string }>(timers: T[], label?: string): T | undefined {
  if (!label) return timers.length === 1 ? timers[0] : undefined;
  const needle = normalizeVoiceInteractionText(label);
  return timers.find((timer) => {
    const candidate = normalizeVoiceInteractionText(timer.label);
    return candidate.includes(needle) || needle.includes(candidate);
  });
}

function modeConfirmation(mode: HomeMode): string {
  const confirmations: Record<HomeMode, string> = {
    normal: 'D’accord, je repasse en mode normal.',
    'free-day': 'D’accord, je garde la journée légère et vraiment libre.',
    focus: 'D’accord, je protège ta concentration et je retiens les interruptions.',
    rest: 'D’accord. Repose-toi, je reste disponible sans te solliciter.',
    cooking: 'Mode cuisine activé. Je peux suivre les étapes et garder des minuteurs nommés.',
    guests: 'Mode invités activé. Je masque les souvenirs, messages et projets personnels.',
    away: 'Mode absent activé. Je ne parlerai pas dans une pièce vide.',
    silent: 'D’accord, je reste silencieuse jusqu’à ce que tu me réactives.',
  };
  return confirmations[mode];
}

export async function handleMaisonVoiceCommand(
  text: string,
  deps: MaisonVoiceActionDeps
): Promise<boolean> {
  const command = parseMaisonVoiceCommand(text);
  if (!command) return false;
  try {
    const now = deps.now?.() ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Maison voice clock is invalid');
    const timeZone = deps.timeZone
      || process.env.CODEBUDDY_TIMEZONE
      || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const modes = deps.homeModeStore ?? new HomeModeStore();
    const timers = deps.cookingTimerStore ?? new CookingTimerStore();

    if (command.kind === 'meal-next') {
      const upcoming = await (deps.mealPlanStore ?? new MealPlanStore()).nextUpcoming(now);
      if (!upcoming) {
        await deps.speak('Aucun repas n’est encore planifié. Je peux t’aider à en choisir un.');
        return true;
      }
      const slotLabels = {
        breakfast: 'le petit-déjeuner',
        lunch: 'le déjeuner',
        dinner: 'le dîner',
        snack: 'l’en-cas',
      } as const;
      const status = upcoming.entry.status === 'planned' ? 'est prévu' : 'est proposé';
      await deps.speak(
        `${upcoming.entry.recipeTitle} ${status} pour ${slotLabels[upcoming.entry.slot]}, `
        + `le ${upcoming.entry.localDate} à ${upcoming.entry.localTime}.`
      );
      return true;
    }

    if (command.kind === 'mode') {
      let durationMs = command.durationMs;
      if (durationMs === undefined && command.boundaryHour !== undefined) {
        durationMs = findNextZonedMinute(now, timeZone, command.boundaryHour, 0)
          .instant.getTime() - now.getTime();
      }
      await modes.setMode(command.mode, durationMs !== undefined ? { durationMs } : {});
      await deps.speak(modeConfirmation(command.mode));
      return true;
    }

    if (command.kind === 'timer-start') {
      const timer = await timers.start(command.durationMs, command.label);
      const minutes = Math.max(1, Math.round(timer.durationMs / 60_000));
      await deps.speak(
        `Minuteur « ${timer.label} » lancé pour ${minutes} minute${minutes > 1 ? 's' : ''}.`
      );
      return true;
    }

    const active = await timers.listActive(now);
    if (command.kind === 'timer-list') {
      if (active.length === 0) await deps.speak('Aucun minuteur de cuisine n’est actif.');
      else await deps.speak(active.slice(0, 5).map((timer) => (
        timer.state === 'due'
          ? `${timer.label} est terminé`
          : `${timer.label}, encore ${Math.max(1, Math.ceil(timer.remainingMs / 60_000))} minute${timer.remainingMs > 60_000 ? 's' : ''}`
      )).join('. ') + '.');
      return true;
    }

    const selected = selectTimer(active, command.label);
    if (!selected) {
      await deps.speak(active.length > 1
        ? 'Dis-moi le nom du minuteur concerné.'
        : 'Je ne trouve pas ce minuteur.');
      return true;
    }
    if (command.kind === 'timer-cancel') {
      await timers.cancel(selected.id);
      await deps.speak(`Minuteur « ${selected.label} » annulé.`);
      return true;
    }
    const acknowledged = await timers.acknowledge(selected.id, now);
    await deps.speak(acknowledged
      ? `Minuteur « ${selected.label} » acquitté.`
      : `Le minuteur « ${selected.label} » n’est pas encore terminé.`);
    return true;
  } catch (error) {
    logger.warn('[maison-voice] command failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await deps.speak('Je n’ai pas pu appliquer cette commande Maison. Rien n’a été supposé.');
    return true;
  }
}
