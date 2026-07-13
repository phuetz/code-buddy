import type {
  MaisonDataStatus,
  MaisonDayContext,
  MaisonDayKind,
  MaisonMealPlan,
  MaisonMode,
  MaisonPresence,
  MaisonPresenceState,
  MaisonProvenance,
  MaisonProvenanceKind,
  MaisonSnapshot,
} from './maison-types.js';

export const DEFAULT_MAISON_MODES: readonly MaisonMode[] = [
  'normal',
  'free-day',
  'focus',
  'rest',
  'cooking',
  'guests',
  'away',
  'silent',
];

export type MaisonTone = 'accent' | 'success' | 'warning' | 'muted';
export type MaisonFreshness = 'fresh' | 'recent' | 'stale' | 'unknown';

export interface MaisonContextPresentation {
  label: string;
  detail: string;
  tone: MaisonTone;
}

export interface MaisonMealPresentation {
  title: string;
  whenLabel: string;
  detail: string;
  originLabel: string;
  planned: boolean;
}

export interface MaisonModePresentation extends MaisonContextPresentation {
  mode: MaisonMode | 'unknown';
}

export interface MaisonCardModel {
  status: MaisonDataStatus;
  headline: string;
  summary: string;
  day: MaisonContextPresentation;
  presence: MaisonContextPresentation;
  mode: MaisonModePresentation;
  provenance: {
    sourceLabel: string;
    ageLabel: string;
    freshness: MaisonFreshness;
    combinedLabel: string;
  };
  meal: MaisonMealPresentation | null;
  actionsDisabled: boolean;
  stateMessage: string | null;
}

const DAY_PRESENTATION: Record<MaisonDayKind, MaisonContextPresentation> = {
  workday: {
    label: 'Journée de travail',
    detail: 'Le rythme habituel reste disponible.',
    tone: 'muted',
  },
  weekend: {
    label: 'Week-end',
    detail: 'Un rythme plus léger, sans urgence ajoutée.',
    tone: 'accent',
  },
  holiday: {
    label: 'Jour férié',
    detail: 'La maison privilégie le calme et le temps libre.',
    tone: 'accent',
  },
  unknown: {
    label: 'Jour à confirmer',
    detail: 'Aucun rythme n’est supposé sans source fiable.',
    tone: 'muted',
  },
};

const PRESENCE_PRESENTATION: Record<MaisonPresenceState, MaisonContextPresentation> = {
  present: {
    label: 'Présence confirmée',
    detail: 'Les interactions locales peuvent être proposées.',
    tone: 'success',
  },
  away: {
    label: 'Maison inoccupée',
    detail: 'Aucune prise de parole personnelle.',
    tone: 'muted',
  },
  unknown: {
    label: 'Présence inconnue',
    detail: 'Code Buddy reste discret par défaut.',
    tone: 'muted',
  },
};

export const MAISON_MODE_PRESENTATION: Record<MaisonMode, MaisonModePresentation> = {
  normal: {
    mode: 'normal',
    label: 'Normal',
    detail: 'Disponible, avec une proactivité mesurée.',
    tone: 'success',
  },
  'free-day': {
    mode: 'free-day',
    label: 'Journée libre',
    detail: 'Des idées douces, sans transformer la journée en tâches.',
    tone: 'accent',
  },
  focus: {
    mode: 'focus',
    label: 'Concentration',
    detail: 'Les interruptions non essentielles sont retenues.',
    tone: 'accent',
  },
  rest: {
    mode: 'rest',
    label: 'Repos',
    detail: 'Aucune suggestion spontanée pendant ce moment.',
    tone: 'accent',
  },
  cooking: {
    mode: 'cooking',
    label: 'Cuisine',
    detail: 'Étapes, minuteurs et réponses mains libres.',
    tone: 'success',
  },
  guests: {
    mode: 'guests',
    label: 'Invités',
    detail: 'Les souvenirs et notifications privés restent masqués.',
    tone: 'accent',
  },
  away: {
    mode: 'away',
    label: 'Absent',
    detail: 'La maison observe uniquement les routines autorisées.',
    tone: 'muted',
  },
  silent: {
    mode: 'silent',
    label: 'Silence',
    detail: 'Aucune initiative sonore jusqu’à réactivation.',
    tone: 'warning',
  },
};

const UNKNOWN_MODE: MaisonModePresentation = {
  mode: 'unknown',
  label: 'Mode inconnu',
  detail: 'Le contexte n’a pas encore été confirmé.',
  tone: 'muted',
};

const SOURCE_LABELS: Record<MaisonProvenanceKind, string> = {
  manual: 'Réglage manuel',
  calendar: 'Calendrier local',
  presence: 'Présence locale',
  companion: 'Companion local',
  sensor: 'Capteurs locaux',
  derived: 'Contexte déduit',
  unknown: 'Source inconnue',
};

const MEAL_ORIGIN_LABELS: Record<NonNullable<MaisonMealPlan['origin']>, string> = {
  manual: 'Choisi par toi',
  leftovers: 'Avec les restes',
  recipe: 'Idée recette',
  calendar: 'Prévu au calendrier',
  unknown: 'Origine à confirmer',
};

function normalizedStatus(
  snapshot: MaisonSnapshot | null | undefined,
  status: MaisonDataStatus | undefined,
): MaisonDataStatus {
  return status ?? (snapshot ? 'ready' : 'unknown');
}

function parseObservedAt(value: MaisonProvenance['observedAt']): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function describeFreshness(
  observedAt: MaisonProvenance['observedAt'],
  now: number,
): { ageLabel: string; freshness: MaisonFreshness } {
  const observed = parseObservedAt(observedAt);
  if (observed === null || !Number.isFinite(now)) {
    return { ageLabel: 'heure inconnue', freshness: 'unknown' };
  }

  const deltaMs = Math.max(0, now - observed);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return { ageLabel: "à l’instant", freshness: 'fresh' };
  if (minutes < 60) {
    return {
      ageLabel: `il y a ${minutes} min`,
      freshness: minutes <= 15 ? 'fresh' : 'recent',
    };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return {
      ageLabel: `il y a ${hours} h`,
      freshness: hours <= 2 ? 'recent' : 'stale',
    };
  }
  const days = Math.floor(hours / 24);
  return { ageLabel: `il y a ${days} j`, freshness: 'stale' };
}

function presentDay(day: MaisonDayContext | undefined): MaisonContextPresentation {
  const kind = day?.kind ?? 'unknown';
  const base = DAY_PRESENTATION[kind];
  if (day?.label?.trim()) return { ...base, label: day.label.trim() };
  if (kind === 'holiday' && day?.holidayName?.trim()) {
    return { ...base, label: `Férié · ${day.holidayName.trim()}` };
  }
  return base;
}

function presentPresence(presence: MaisonPresence | undefined): MaisonContextPresentation {
  const state = presence?.state ?? 'unknown';
  const base = PRESENCE_PRESENTATION[state];
  const label = state === 'present' && presence?.displayName?.trim()
    ? `${presence.displayName.trim()} est là`
    : base.label;
  return {
    ...base,
    label,
    ...(presence?.detail?.trim() ? { detail: presence.detail.trim() } : {}),
  };
}

function presentProvenance(
  provenance: MaisonProvenance | undefined,
  now: number,
): MaisonCardModel['provenance'] {
  const sourceLabel = provenance?.label?.trim()
    || SOURCE_LABELS[provenance?.kind ?? 'unknown'];
  const { ageLabel, freshness } = describeFreshness(provenance?.observedAt, now);
  return {
    sourceLabel,
    ageLabel,
    freshness,
    combinedLabel: `${sourceLabel} · ${ageLabel}`,
  };
}

function presentMeal(meal: MaisonMealPlan | null | undefined): MaisonMealPresentation | null {
  if (!meal?.title.trim()) return null;
  return {
    title: meal.title.trim(),
    whenLabel: meal.whenLabel?.trim() || 'Prochain repas',
    detail: meal.detail?.trim() || 'Une proposition pratique, à confirmer au moment de cuisiner.',
    originLabel: MEAL_ORIGIN_LABELS[meal.origin ?? 'unknown'],
    planned: meal.state === 'planned',
  };
}

function headlineFor(
  mode: MaisonMode | undefined,
  day: MaisonDayKind,
  presence: MaisonPresenceState,
): { headline: string; summary: string } {
  if (mode === 'silent') {
    return {
      headline: 'La maison reste silencieuse',
      summary: 'Aucune initiative sonore. Les informations utiles peuvent attendre ici sans interrompre.',
    };
  }
  if (mode === 'cooking') {
    return {
      headline: 'La cuisine est prête à t’accompagner',
      summary: 'Étapes courtes, minuteurs nommés et réponses mains libres restent au premier plan.',
    };
  }
  if (mode === 'guests') {
    return {
      headline: 'La maison accueille sans dévoiler le privé',
      summary: 'Souvenirs, messages et projets personnels restent masqués tant que le mode invités est actif.',
    };
  }
  if (mode === 'rest') {
    return {
      headline: 'Un moment calme, sans sollicitation',
      summary: 'Code Buddy reste disponible si tu l’appelles et retient toutes les suggestions spontanées.',
    };
  }
  if (mode === 'focus') {
    return {
      headline: 'La maison protège ton attention',
      summary: 'Seules les demandes directes et les événements réellement importants passent au premier plan.',
    };
  }
  if (presence === 'away' || mode === 'away') {
    return {
      headline: 'La maison veille discrètement',
      summary: 'Aucune prise de parole personnelle tant que ta présence n’est pas confirmée.',
    };
  }
  if (mode === 'free-day' || day === 'weekend' || day === 'holiday') {
    return {
      headline: 'Le temps peut rester vraiment libre',
      summary: 'Une aide douce est disponible, sans transformer cette journée en liste de tâches.',
    };
  }
  if (!mode) {
    return {
      headline: 'Le contexte Maison se précise',
      summary: 'Code Buddy ne suppose ni ton rythme ni ta présence tant que les signaux ne sont pas confirmés.',
    };
  }
  return {
    headline: 'Tout est calme à la maison',
    summary: 'Code Buddy reste disponible avec une proactivité mesurée et des actions toujours explicites.',
  };
}

function stateMessage(status: MaisonDataStatus, hasSnapshot: boolean): string | null {
  if (status === 'loading') {
    return hasSnapshot ? 'Actualisation du contexte Maison…' : 'Préparation du contexte Maison…';
  }
  if (status === 'offline') {
    return hasSnapshot
      ? 'Maison est hors ligne : le dernier état connu reste visible, sans action possible.'
      : 'Maison est hors ligne et aucun état local n’est encore disponible.';
  }
  if (status === 'unknown') {
    return hasSnapshot
      ? 'Certains signaux restent à confirmer avant toute initiative.'
      : 'Aucun contexte Maison n’est encore disponible. Code Buddy reste silencieux par défaut.';
  }
  return null;
}

export function buildMaisonCardModel(
  snapshot: MaisonSnapshot | null | undefined,
  status: MaisonDataStatus | undefined,
  now = Date.now(),
): MaisonCardModel {
  const effectiveStatus = normalizedStatus(snapshot, status);
  const day = presentDay(snapshot?.day);
  const presence = presentPresence(snapshot?.presence);
  const mode = snapshot?.mode ? MAISON_MODE_PRESENTATION[snapshot.mode] : UNKNOWN_MODE;
  const narrative = headlineFor(
    snapshot?.mode,
    snapshot?.day?.kind ?? 'unknown',
    snapshot?.presence?.state ?? 'unknown',
  );

  return {
    status: effectiveStatus,
    ...narrative,
    day,
    presence,
    mode,
    provenance: presentProvenance(snapshot?.provenance, now),
    meal: presentMeal(snapshot?.nextMeal),
    actionsDisabled: effectiveStatus !== 'ready',
    stateMessage: stateMessage(effectiveStatus, Boolean(snapshot)),
  };
}
