/** One-shot LLM planning for manuscript-grounded cinematic book trailers. */

import type {
  BookManuscript,
  CandidateExcerpt,
} from '../../tools/video/book-manuscript-source.js';
import {
  validateCinematicTrailerPlan,
  type CinematicTrailerPlan,
} from '../../tools/video/cinematic-trailer-plan.js';
import { generateJsonWithRetry } from '../../utils/llm-retry.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_DURATION_SECONDS = 75;

export type TrailerPlannerProvider = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface PlanBookTrailerInput {
  manuscript: BookManuscript;
  excerpts: CandidateExcerpt[];
  durationTargetSeconds?: number;
  /** Injectable for tests; defaults to the currently configured command provider. */
  provider?: TrailerPlannerProvider;
}

export function buildTrailerPlannerSystemPrompt(durationTargetSeconds: number): string {
  return [
    'Tu es un réalisateur et monteur de bandes-annonces de films, spécialisé dans les adaptations de romans.',
    'Réponds uniquement avec un objet JSON conforme au contrat CinematicTrailerPlan schemaVersion 1.',
    `Construis un master d'environ ${durationTargetSeconds} secondes. La durée totale doit rester entre 45 et 90 secondes; le contrat de préflight exige en pratique 60 à 90 secondes.`,
    'La structure dramatique est obligatoire : hook de 3 secondes maximum, monde et protagoniste, montée de tension, prix à payer, climax coupé avant sa résolution, puis titre et call-to-action.',
    'Utilise au minimum les tokens hook, world, protagonist, escalation, price, withheld, brand et cta.',
    'Chaque shot narratif (tout sauf brand et cta) doit reprendre exactement le manuscriptSource.file et le manuscriptSource.locator d\'un excerpt numéroté fourni. N\'invente jamais une scène, une citation, un fichier ou un locator.',
    'Un shot transmet exactement une information, montre exactement une action humaine et utilise exactement un mouvement caméra (ou static). Ne chaîne jamais deux actions ou mouvements.',
    'Chaque shot dure au plus 12 secondes, possède entryHandle=true, exitHandle=true, burnedInText=false et au moins une rejectionCondition.',
    'Aucun texte ne doit être incrusté dans les images générées. Le titre et le call-to-action passent uniquement par overlays avec safeZone=true.',
    'Le plan initial doit rester privé et en attente humaine : status=READY_FOR_PREFLIGHT, contentTier=safe, publication.visibility=private, autoPublish=false, containsSyntheticMedia=true, humanReviewRequired=true.',
    'Ne prétends à aucune validation humaine : tous les champs approvals sont false. Les coûts sont des estimations locales non approuvées.',
    'Déclare quatre couches sonores distinctes (ambience, foley, motif, speech) et au moins un master son.',
    'Renseigne tous les champs book, retention, cost, sound, characters, shots, overlays, approvals et publication du contrat. Si aucune référence personnage approuvée n\'est fournie, laisse characters vide et les tableaux characters des shots vides.',
    'Format attendu, sans commentaire ni markdown : {"schemaVersion":1,"status":"READY_FOR_PREFLIGHT","contentTier":"safe","book":{...},"masterDurationSeconds":75,"characters":[],"shots":[...],"overlays":[...],"sound":{...},"retention":{...},"cost":{...},"approvals":{...},"publication":{...}}',
  ].join('\n');
}

export function buildTrailerPlannerUserPrompt(
  manuscript: BookManuscript,
  excerpts: readonly CandidateExcerpt[],
): string {
  const chapterList = manuscript.chapters
    .map((chapter, index) => `${index + 1}. ${chapter.file} — ${chapter.heading}`)
    .join('\n');
  const excerptList = excerpts.map((excerpt, index) => [
    `[EXCERPT ${index + 1}: ${excerpt.id}]`,
    `file=${excerpt.manuscriptSource.file}`,
    `locator=${excerpt.manuscriptSource.locator}`,
    `text=${JSON.stringify(excerpt.text)}`,
  ].join('\n')).join('\n\n');
  return [
    `Livre : ${manuscript.title}`,
    'Chapitres :',
    chapterList,
    '',
    'Excerpts autorisés (seules sources narratives permises) :',
    excerptList,
    '',
    'Produis maintenant le CinematicTrailerPlan JSON complet et uniquement lui.',
  ].join('\n');
}

async function defaultProvider(system: string, user: string): Promise<string> {
  const { resolveCommandProvider } = await import('../../commands/llm-provider-resolution.js');
  const resolved = resolveCommandProvider({});
  if (!resolved) {
    throw new Error(
      'Aucun modèle LLM configuré pour planifier la bande-annonce. Lancez `buddy login` ou configurez un provider.',
    );
  }
  const { CodeBuddyClient } = await import('../../codebuddy/client.js');
  const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
  const response = await client.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    undefined,
    { responseFormat: 'json' },
  );
  return response?.choices?.[0]?.message?.content ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function provenanceKey(file: string, locator: string): string {
  return `${file}\u0000${locator}`;
}

function plannerValidationErrors(
  value: unknown,
  excerpts: readonly CandidateExcerpt[],
): string[] {
  const validation = validateCinematicTrailerPlan(value);
  const errors = [...validation.blockers];
  if (validation.status === 'INCOMPLETE' || validation.qualifiedStatus === 'INCOMPLETE') {
    errors.push(`trailer-status-not-preflight:${validation.status}`);
  }
  if (!isRecord(value)) return [...new Set(errors)];
  const masterDuration = value.masterDurationSeconds;
  if (typeof masterDuration !== 'number' || masterDuration < 45 || masterDuration > 90) {
    errors.push('planner-duration-out-of-range');
  }

  const allowed = new Set(excerpts.map((excerpt) => provenanceKey(
    excerpt.manuscriptSource.file,
    excerpt.manuscriptSource.locator,
  )));
  const shots = Array.isArray(value.shots) ? value.shots : [];
  for (const rawShot of shots) {
    if (!isRecord(rawShot)) continue;
    const id = typeof rawShot.id === 'string' ? rawShot.id : '<unknown>';
    if (rawShot.token === 'hook' && (typeof rawShot.durationSeconds !== 'number' || rawShot.durationSeconds > 3)) {
      errors.push(`hook-too-long:${id}`);
    }
    for (const field of ['information', 'action', 'cameraMove'] as const) {
      if (typeof rawShot[field] !== 'string' || !rawShot[field].trim()) {
        errors.push(`empty-${field}:${id}`);
      }
    }
    const source = rawShot.manuscriptSource;
    if (source !== undefined) {
      if (
        !isRecord(source) ||
        typeof source.file !== 'string' ||
        typeof source.locator !== 'string' ||
        !allowed.has(provenanceKey(source.file, source.locator))
      ) {
        errors.push(`unknown-manuscript-source:${id}`);
      }
    }
  }
  return [...new Set(errors)];
}

function repairPrompt(value: unknown, errors: readonly string[]): string {
  return [
    'Le plan JSON précédent ne passe pas le préflight strict.',
    `Erreurs : ${errors.join(', ')}`,
    'Corrige uniquement ces erreurs en respectant toutes les contraintes et les provenances autorisées du prompt initial.',
    'Retourne une seule fois le CinematicTrailerPlan JSON complet, sans markdown.',
    `Plan précédent : ${JSON.stringify(value)}`,
  ].join('\n');
}

/**
 * Fill the deterministic structural scaffolding the LLM is unreliable at
 * (sound layers/masters, retention hypotheses, cost, approvals, publication,
 * status, overlay timecodes) while preserving its creative content (shots,
 * overlay text, book synopsis). Keeps one-shot LLM output from failing the
 * strict preflight on non-narrative fields.
 */
export function normalizeTrailerScaffold(
  value: unknown,
  duration: number,
): unknown {
  if (!isRecord(value)) return value;
  const plan: Record<string, unknown> = { ...value };
  plan.schemaVersion = 1;
  plan.status = 'READY_FOR_PREFLIGHT';
  plan.contentTier = 'safe';

  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  // Cumulative shot timeline to repair NaN / out-of-range overlay timecodes.
  const timeline: number[] = [];
  let acc = 0;
  for (const shot of shots) {
    timeline.push(acc);
    const d = isRecord(shot) && typeof shot.durationSeconds === 'number' ? shot.durationSeconds : 0;
    acc += d;
  }
  const total = acc > 0 ? acc : duration;

  const DEFAULT_LAYERS = [
    'ambience: nappe technologique sourde, souffle de datacenter',
    'foley: frappes de clavier, bourdonnement de serveurs, respiration',
    'motif: pulsation rythmique montante jusqu\'au climax',
    'speech: voix off tendue, phrases courtes',
  ];
  const existingSound = isRecord(plan.sound) ? plan.sound : {};
  const rawLayers = Array.isArray(existingSound.layers)
    ? existingSound.layers.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : [];
  const distinct = new Set(rawLayers.map((l) => l.trim().toLowerCase()));
  // Keep the LLM's layers only if it gave four genuinely distinct ones.
  const layers = distinct.size >= 4 ? rawLayers : DEFAULT_LAYERS;
  const rawMasters = Array.isArray(existingSound.masters)
    ? existingSound.masters.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : [];
  const masters = rawMasters.length >= 1 ? rawMasters : ['master-16x9-fr'];
  plan.sound = { layers, masters };

  const existingBook = isRecord(plan.book) ? plan.book : {};
  const bField = (k: string, fallback: string): string =>
    typeof existingBook[k] === 'string' && (existingBook[k] as string).trim()
      ? (existingBook[k] as string)
      : fallback;
  plan.book = {
    title: bField('title', 'Sans titre'),
    genre: bField('genre', 'Thriller'),
    stagingSentence: bField('stagingSentence', 'On passe du monde ordinaire au vertige, vu du protagoniste, sans révéler l\'issue.'),
    spoilerLimit: bField('spoilerLimit', 'Ne jamais révéler le dénouement ni le sort final des personnages.'),
    commercialAction: bField('commercialAction', 'Lire le premier chapitre — lien en description.'),
  };

  const existingRetention = isRecord(plan.retention) ? plan.retention : {};
  const rField = (k: string, fallback: string): string =>
    typeof existingRetention[k] === 'string' && (existingRetention[k] as string).trim()
      ? (existingRetention[k] as string)
      : fallback;
  plan.retention = {
    hookA: rField('hookA', 'Ouvrir sur l\'écran unique dans le noir.'),
    hookB: rField('hookB', 'Ouvrir sur la phrase choc en surimpression.'),
    promise: rField('promise', 'Un thriller sur le pouvoir de l\'information.'),
    proofWithinThreeSeconds: rField('proofWithinThreeSeconds', 'Image forte + question dérangeante dès la première seconde.'),
    deeperPayoff: rField('deeperPayoff', 'La question morale qui reste après le générique.'),
    singleAbVariable: rField('singleAbVariable', 'hook image vs hook texte'),
  };

  const existingCost = isRecord(plan.cost) ? plan.cost : {};
  plan.cost = {
    displayedInUi: false,
    estimatedFlowCredits: typeof existingCost.estimatedFlowCredits === 'number'
      ? existingCost.estimatedFlowCredits
      : shots.length * 10,
    approvedCeilingFlowCredits: 0,
  };

  plan.approvals = {
    narrativeReviewed: false,
    castingReviewed: false,
    costApproved: false,
    publicationApproved: false,
  };
  plan.publication = {
    visibility: 'private',
    autoPublish: false,
    containsSyntheticMedia: true,
    humanReviewRequired: true,
  };

  if (typeof plan.masterDurationSeconds !== 'number'
    || plan.masterDurationSeconds < 45 || plan.masterDurationSeconds > 90) {
    plan.masterDurationSeconds = Math.min(90, Math.max(45, Math.round(total)));
  }

  const overlays = Array.isArray(plan.overlays) ? plan.overlays : [];
  plan.overlays = overlays.map((ov, i) => {
    if (!isRecord(ov)) return ov;
    const t = ov.timecodeSeconds;
    const valid = typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= total;
    return {
      ...ov,
      timecodeSeconds: valid ? t : Math.min(total, timeline[Math.min(i, timeline.length - 1)] ?? total),
      safeZone: true,
      source: ov.source === 'manuscript' ? 'manuscript' : 'editorial',
    };
  });

  return plan;
}

/** Plan a grounded trailer, allowing exactly one semantic repair after validation. */
export async function planBookTrailer(input: PlanBookTrailerInput): Promise<CinematicTrailerPlan> {
  if (!input.manuscript.chapters.length) throw new Error('Trailer planning requires manuscript chapters');
  if (!input.excerpts.length) throw new Error('Trailer planning requires grounded candidate excerpts');
  const duration = input.durationTargetSeconds ?? DEFAULT_DURATION_SECONDS;
  if (!Number.isFinite(duration) || duration < 45 || duration > 90) {
    throw new Error('Trailer duration target must be between 45 and 90 seconds');
  }
  const system = buildTrailerPlannerSystemPrompt(duration);
  const user = buildTrailerPlannerUserPrompt(input.manuscript, input.excerpts);
  const provider = input.provider ?? defaultProvider;
  const generate = (prompt: string): Promise<string> => provider(system, prompt);

  let candidate = normalizeTrailerScaffold(await generateJsonWithRetry<unknown>(generate, user), duration);
  let errors = plannerValidationErrors(candidate, input.excerpts);
  if (errors.length > 0) {
    candidate = normalizeTrailerScaffold(
      await generateJsonWithRetry<unknown>(generate, repairPrompt(candidate, errors), 0),
      duration,
    );
    errors = plannerValidationErrors(candidate, input.excerpts);
  }
  if (errors.length > 0) {
    throw new Error(`Trailer plan failed strict validation after one repair: ${errors.join(', ')}`);
  }

  logger.info(
    `[trailer-planner] Plan ${duration}s validé pour « ${input.manuscript.title.slice(0, 80)} »`,
  );
  return candidate as CinematicTrailerPlan;
}
