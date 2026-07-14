/**
 * Deterministic research-intake card for an understood video.
 *
 * This is deliberately NOT an LLM summary. It scans the complete transcript,
 * groups neighbouring captions into readable windows, and surfaces passages
 * likely to contain technologies or externally-verifiable claims. The card is
 * a compact map that helps the main agent inspect a long video without drawing
 * conclusions from the first truncated transcript chunk.
 */

export interface VideoResearchCardSegment {
  t_start: number;
  t_end: number;
  said: string;
}

export interface VideoResearchCardInput {
  source: string;
  method: string;
  transcriptPath: string;
  segments: VideoResearchCardSegment[];
  question?: string;
  cloudAnswer?: string;
}

export type VideoExperimentCategory =
  | 'scientific-research'
  | 'genomics'
  | 'world-model-3d'
  | 'game-world'
  | 'avatar-fashion'
  | 'robotics'
  | 'long-horizon-agent'
  | 'workflow-automation'
  | 'general-ai';

export interface VideoExperimentCandidate {
  id: string;
  title: string;
  category: VideoExperimentCategory;
  verificationStatus: 'unverified';
  confidence: 'low' | 'medium';
  evidence: { t_start: number; t_end: number; transcript: string };
  namesToVerify: string[];
  links: string[];
  requirements: string[];
  risks: string[];
  minimumExperiment: string;
}

export interface VideoExperimentBacklog {
  version: 1;
  source: string;
  method: string;
  candidates: VideoExperimentCandidate[];
}

interface TranscriptWindow {
  start: number;
  end: number;
  text: string;
}

const WINDOW_SECONDS = 30;
const MAX_WINDOW_CHARS = 650;
const MAX_TECH_SIGNALS = 8;
const MAX_CLAIM_SIGNALS = 8;
const MAX_EXPERIMENT_CANDIDATES = 24;
const MAX_RENDERED_EXPERIMENTS = 12;
const MAX_PREVIEW_SIGNALS = 3;
const MAX_PREVIEW_WINDOW_CHARS = 320;

const TECHNOLOGY_PATTERN =
  /\b(?:ai|ia|llm|mod[eè]le|syst[eè]me|architecture|multi[- ]?agent|agentique|robot|avatar|world model|mod[eè]le monde|open source|github|gpu|transformer|diffusion|vision|g[eé]nom|adn|arn|rna|prot[eé]ine|logiciel|framework|api)\b/gi;
const CLAIM_PATTERN =
  /(?:\d+(?:[.,]\d+)?\s*(?:%|x|fois|millions?|milliards?|tokens?|param[eè]tres?|gpu|jours?|heures?|fps|images? par seconde)|benchmark|score|plus rapide|publi[eé]|publication|nature|laboratoire|exp[eé]rimental|confirm[eé]|open source|disponible sur github)/gi;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const NAMED_PROJECT_PATTERN =
  /\b(?:mod[eè]le|projet|syst[eè]me|outil|framework)\s+([A-Z][\p{L}\d.-]*(?:\s+(?:[A-Z][\p{L}\d.-]*|[A-Z]{2,}|\d+(?:\.\d+)?)){0,3})/gu;
const MULTIWORD_NAME_PATTERN =
  /\b([A-Z][\p{L}\d.-]{2,}(?:\s+(?:[A-Z][\p{L}\d.-]{2,}|[A-Z]{2,}|\d+(?:\.\d+)?)){1,3})\b/gu;
const NAME_STOP_WORDS = new Set([
  'Cette Semaine',
  'Tout Ça',
  'Code Buddy',
  'Intelligence Artificielle',
  'Donc Lia',
]);

interface KnownProject {
  name: string;
  category: VideoExperimentCategory;
  patterns: RegExp[];
  links: string[];
}

/**
 * Canonical names for projects whose names are commonly damaged by automatic
 * French captions. The links are primary-source discovery hints; the claims in
 * the video remain unverified until a human or research agent checks them.
 */
const KNOWN_PROJECTS: KnownProject[] = [
  {
    name: 'Carbon',
    category: 'genomics',
    patterns: [
      /\bcarbon\b[^.]{0,180}\b(?:adn|arn|g[eé]nom)/iu,
      /\b(?:adn|arn|g[eé]nom)[^.]{0,180}\bcarbon\b/iu,
    ],
    links: [
      'https://github.com/huggingface/carbon',
      'https://huggingface.co/HuggingFaceBio/Carbon-3B',
    ],
  },
  {
    name: 'PanoWorld',
    category: 'world-model-3d',
    patterns: [/\bpano\s*world\b/iu, /\bpanoworld\b/iu],
    links: [
      'https://github.com/jjrCN/PanoWorld',
      'https://jjrcn.github.io/PanoWorld-project-home/',
    ],
  },
  {
    name: 'ReactiveGWM',
    category: 'game-world',
    patterns: [/\br[eé]active\s*[gj]wm\b/iu, /\breactivegwm\b/iu],
    links: ['https://github.com/INV-WZQ/ReactiveGWM', 'https://inv-wzq.github.io/ReactiveGWM/'],
  },
  {
    name: 'LongCat-Video-Avatar-1.5',
    category: 'avatar-fashion',
    patterns: [
      /\blong\s*(?:cat|4)\s*(?:-|\s)?vid[eé]o\s+avatar\s+1[.,]5\b/iu,
      /\blongcat[- ]video[- ]avatar[- ]1[.,]5\b/iu,
    ],
    links: [
      'https://github.com/meituan-longcat/LongCat-Video',
      'https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5',
    ],
  },
  {
    name: 'FashionChameleon',
    category: 'avatar-fashion',
    patterns: [/\bfashion\s*ch?am[eé]l[eé]on\b/iu, /\bfashionchameleon\b/iu],
    links: [
      'https://github.com/QuanjianSong/FashionChameleon',
      'https://quanjiansong.github.io/projects/FashionChameleon/',
    ],
  },
];

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeInline(value: string): string {
  return collapseWhitespace(value).replace(/`/g, '\\`');
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remaining)}` : `${minutes}:${pad(remaining)}`;
}

function truncate(value: string, maxChars: number): string {
  const normalized = collapseWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  const cut = normalized.slice(0, Math.max(0, maxChars - 1));
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > maxChars * 0.65 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function buildTranscriptWindows(segments: VideoResearchCardSegment[]): TranscriptWindow[] {
  const windows: TranscriptWindow[] = [];
  let current: TranscriptWindow | null = null;

  // Caption providers and concatenated transcript sources do not always preserve
  // chronology. Sorting a copy prevents a late-arriving cue from being merged into
  // an unrelated window and inheriting its experiment category.
  const chronologicalSegments = [...segments].sort(
    (a, b) => a.t_start - b.t_start || a.t_end - b.t_end
  );
  for (const segment of chronologicalSegments) {
    const text = collapseWhitespace(segment.said ?? '');
    if (!text) continue;
    if (
      !current ||
      segment.t_start - current.start >= WINDOW_SECONDS ||
      current.text.length + text.length + 1 > MAX_WINDOW_CHARS
    ) {
      if (current) windows.push(current);
      current = {
        start: segment.t_start,
        end: segment.t_end,
        text,
      };
      continue;
    }
    current.end = Math.max(current.end, segment.t_end);
    current.text = `${current.text} ${text}`;
  }
  if (current) windows.push(current);
  return windows;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function selectSignals(
  windows: TranscriptWindow[],
  pattern: RegExp,
  limit: number
): TranscriptWindow[] {
  return windows
    .map((window, index) => ({
      window,
      index,
      score: countMatches(window.text, pattern),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((candidate) => candidate.window);
}

function renderSignals(windows: TranscriptWindow[], maxChars = MAX_WINDOW_CHARS): string {
  if (windows.length === 0) return '- Aucun passage détecté automatiquement.';
  return windows
    .map((window) => `- **${formatTimestamp(window.start)}** — ${truncate(window.text, maxChars)}`)
    .join('\n');
}

function extractUrls(segments: VideoResearchCardSegment[]): string[] {
  const urls = new Set<string>();
  for (const segment of segments) {
    for (const match of segment.said.match(URL_PATTERN) ?? []) {
      urls.add(match.replace(/[.,;:!?]+$/g, ''));
    }
  }
  return [...urls].slice(0, 20);
}

const EXPERIMENT_CATEGORY_PATTERNS: ReadonlyArray<readonly [VideoExperimentCategory, RegExp]> = [
  ['genomics', /g[eé]nom|adn|arn|rna|prot[eé]ine|biolog/gi],
  [
    'world-model-3d',
    /world model|mod[eè]le monde|panorama|3d|gaussian|spatial|sc[eè]ne|point de vue/gi,
  ],
  ['game-world', /game world|monde de jeux?|pnj|npc|joueur|street fighter|strat[eé]gie/gi],
  ['avatar-fashion', /avatar|fashion|v[eê]tement|try[- ]?on|visage|synchronisation labiale/gi],
  ['robotics', /robot|humano[iï]de|quadrup[eè]de|moteur|action physique/gi],
  ['long-horizon-agent', /multi[- ]?agent|autonom|plusieurs heures|long[- ]?horizon|planif/gi],
  ['workflow-automation', /n8n|workflow|automatisation|orchestration/gi],
  ['scientific-research', /hypoth[eè]se|laboratoire|exp[eé]rience|nature|recherche scientifique/gi],
];

function classifyExperiment(text: string): VideoExperimentCategory {
  const known = matchKnownProjects(text);
  if (known.length === 1) return known[0]!.category;
  let selected: VideoExperimentCategory = 'general-ai';
  let selectedScore = 0;
  for (const [category, pattern] of EXPERIMENT_CATEGORY_PATTERNS) {
    const score = countMatches(text, pattern);
    if (score > selectedScore) {
      selected = category;
      selectedScore = score;
    }
  }
  return selected;
}

function matchKnownProjects(text: string): KnownProject[] {
  return KNOWN_PROJECTS.filter((project) => project.patterns.some((pattern) => pattern.test(text)));
}

function extractNames(text: string): string[] {
  const names = new Set<string>();
  for (const project of matchKnownProjects(text)) names.add(project.name);
  for (const pattern of [NAMED_PROJECT_PATTERN, MULTIWORD_NAME_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const name = collapseWhitespace(match[1] ?? '');
      if (name.length >= 3 && name.length <= 80 && !NAME_STOP_WORDS.has(name)) names.add(name);
    }
  }
  return [...names].slice(0, 6);
}

function experimentGuidance(
  category: VideoExperimentCategory
): Pick<VideoExperimentCandidate, 'requirements' | 'risks' | 'minimumExperiment'> {
  switch (category) {
    case 'scientific-research':
      return {
        requirements: ['publication primaire', 'protocole reproductible', 'revue humaine experte'],
        risks: ['affirmation non vérifiée', 'confusion corrélation/causalité'],
        minimumExperiment:
          'Reproduire hors production une étape publiée sur un jeu de données public, avec critères d’arrêt.',
      };
    case 'genomics':
      return {
        requirements: [
          'modèle et licence vérifiés',
          'jeu de données public et anonymisé',
          'revue bio-informatique',
        ],
        risks: ['données de santé sensibles', 'interprétation clinique abusive', 'coût GPU'],
        minimumExperiment:
          'Comparer une tâche de séquence publique à un baseline déterministe; aucune conclusion médicale.',
      };
    case 'world-model-3d':
      return {
        requirements: ['dépôt officiel', 'licence et poids', 'budget VRAM', 'scène de référence'],
        risks: ['incohérence spatiale', 'dépendances GPU lourdes', 'licence restrictive'],
        minimumExperiment:
          'Générer une petite scène multi-vues et mesurer cohérence géométrique, temps et mémoire.',
      };
    case 'game-world':
      return {
        requirements: [
          'dépôt et poids officiels',
          'GPU isolé',
          'jeu de test autorisé',
          'commandes enregistrées',
        ],
        risks: [
          'simulation visuelle sans physique fiable',
          'latence',
          'comportement émergent mal évalué',
        ],
        minimumExperiment:
          'Rejouer un scénario borné avec deux stratégies de PNJ et mesurer contrôle, cohérence et latence.',
      };
    case 'avatar-fashion':
      return {
        requirements: [
          'références consenties',
          'licence commerciale',
          'protocole de cohérence d’identité',
        ],
        risks: ['usurpation d’identité', 'sexualisation non consentie', 'dérive visuelle'],
        minimumExperiment:
          'Tester sur un avatar synthétique avec trois poses et mesurer identité, tenue et artefacts.',
      };
    case 'robotics':
      return {
        requirements: ['simulateur', 'limites d’action', 'arrêt d’urgence', 'journal de commandes'],
        risks: ['mouvement dangereux', 'commande vocale ambiguë', 'latence'],
        minimumExperiment:
          'Exécuter en simulation une commande vocale bornée avant toute activation physique.',
      };
    case 'long-horizon-agent':
      return {
        requirements: ['sandbox', 'checkpoints', 'plafond de coût', 'preuves de progression'],
        risks: ['boucle infinie', 'dérive d’objectif', 'dépense incontrôlée'],
        minimumExperiment:
          'Résoudre une tâche isolée de 30 minutes avec reprise sur checkpoint et budget strict.',
      };
    case 'workflow-automation':
      return {
        requirements: [
          'connecteurs isolés',
          'secrets référencés',
          'dry-run',
          'journal d’exécution',
        ],
        risks: ['effet externe involontaire', 'fuite de secret', 'répétition non idempotente'],
        minimumExperiment:
          'Exécuter un workflow local en dry-run avec entrée enregistrée et résultat administrable.',
      };
    default:
      return {
        requirements: ['source officielle', 'licence', 'baseline', 'critères de succès'],
        risks: ['nom mal transcrit', 'gain marketing non reproduit'],
        minimumExperiment:
          'Vérifier le projet puis construire un benchmark minimal, isolé et reproductible.',
      };
  }
}

/** Convert technology passages into a machine-readable, explicitly unverified lab backlog. */
export function buildVideoExperimentBacklog(input: VideoResearchCardInput): VideoExperimentBacklog {
  const rankedWindows = buildTranscriptWindows(input.segments)
    .map((window, index) => ({
      window,
      index,
      category: classifyExperiment(window.text),
      score:
        countMatches(window.text, TECHNOLOGY_PATTERN) + countMatches(window.text, CLAIM_PATTERN),
    }))
    .filter((candidate) => candidate.score > 0);

  // A plain top-N heavily favours a dense opening chapter (often genomics or AI news)
  // and silently drops later discoveries. Round-robin the ranked category buckets so
  // the backlog represents the whole video's capability surface before taking a second
  // candidate from any one category.
  const categoryBuckets = new Map<VideoExperimentCategory, typeof rankedWindows>();
  for (const candidate of rankedWindows) {
    const bucket = categoryBuckets.get(candidate.category) ?? [];
    bucket.push(candidate);
    categoryBuckets.set(candidate.category, bucket);
  }
  for (const bucket of categoryBuckets.values()) {
    const firstMention = bucket.reduce((earliest, candidate) =>
      candidate.index < earliest.index ? candidate : earliest
    );
    bucket.sort((a, b) => {
      const knownDifference =
        matchKnownProjects(b.window.text).length - matchKnownProjects(a.window.text).length;
      return knownDifference || b.score - a.score || a.index - b.index;
    });
    const firstMentionIndex = bucket.indexOf(firstMention);
    // Preserve broad chronological coverage when the first passage is useful,
    // but never let a generic continuation displace a named project in a
    // bounded backlog.
    if (firstMentionIndex > 0 && matchKnownProjects(firstMention.window.text).length > 0) {
      bucket.splice(firstMentionIndex, 1);
      bucket.unshift(firstMention);
    }
  }

  const selected: typeof rankedWindows = [];
  for (let depth = 0; selected.length < MAX_EXPERIMENT_CANDIDATES; depth += 1) {
    let added = false;
    for (const bucket of categoryBuckets.values()) {
      const candidate = bucket[depth];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= MAX_EXPERIMENT_CANDIDATES) break;
    }
    if (!added) break;
  }

  const windows = selected.sort((a, b) => a.index - b.index).map((candidate) => candidate.window);
  const candidates = windows.map((window): VideoExperimentCandidate => {
    const category = classifyExperiment(window.text);
    const knownProjects = matchKnownProjects(window.text);
    const namesToVerify = extractNames(window.text);
    const guidance = experimentGuidance(category);
    const title =
      knownProjects[0]?.name ??
      namesToVerify[0] ??
      `${category} @ ${formatTimestamp(window.start)}`;
    const signalCount =
      countMatches(window.text, TECHNOLOGY_PATTERN) + countMatches(window.text, CLAIM_PATTERN);
    return {
      id: `${category}-${Math.max(0, Math.floor(window.start))}`,
      title,
      category,
      verificationStatus: 'unverified',
      confidence: signalCount >= 3 ? 'medium' : 'low',
      evidence: {
        t_start: window.start,
        t_end: window.end,
        transcript: truncate(window.text, MAX_WINDOW_CHARS),
      },
      namesToVerify,
      links: [
        ...new Set([
          ...knownProjects.flatMap((project) => project.links),
          ...extractUrls([{ t_start: window.start, t_end: window.end, said: window.text }]),
        ]),
      ],
      ...guidance,
    };
  });
  return { version: 1, source: input.source, method: input.method, candidates };
}

function renderExperimentBacklog(backlog: VideoExperimentBacklog): string {
  if (backlog.candidates.length === 0) return '- Aucune expérience candidate détectée.';
  const rendered = backlog.candidates
    .slice(0, MAX_RENDERED_EXPERIMENTS)
    .map((candidate) =>
      [
        `### ${candidate.title} — ${candidate.category}`,
        `- **Statut :** ${candidate.verificationStatus} (${candidate.confidence})`,
        `- **Preuve :** ${formatTimestamp(candidate.evidence.t_start)} — ${candidate.evidence.transcript}`,
        `- **Expérience minimale :** ${candidate.minimumExperiment}`,
        `- **Risques :** ${candidate.risks.join('; ')}`,
      ].join('\n')
    )
    .join('\n\n');
  const remaining = backlog.candidates.length - MAX_RENDERED_EXPERIMENTS;
  return remaining > 0
    ? `${rendered}\n\n- *${remaining} autre(s) expérience(s) dans le backlog JSON.*`
    : rendered;
}

/** Build a compact, evidence-first Markdown intake card from the full transcript. */
export function buildVideoResearchCard(input: VideoResearchCardInput): string {
  const windows = buildTranscriptWindows(input.segments);
  const technologySignals = selectSignals(windows, TECHNOLOGY_PATTERN, MAX_TECH_SIGNALS);
  const claimSignals = selectSignals(windows, CLAIM_PATTERN, MAX_CLAIM_SIGNALS);
  const urls = extractUrls(input.segments);
  const duration = input.segments.reduce((maximum, segment) => Math.max(maximum, segment.t_end), 0);
  const question = safeInline(input.question ?? '');
  const cloudAnswer = collapseWhitespace(input.cloudAnswer ?? '');
  const experimentBacklog = buildVideoExperimentBacklog(input);

  const sections = [
    '# Fiche de recherche vidéo',
    '',
    '> Pré-ingestion automatique. Les passages ci-dessous viennent du transcript ; ils ne constituent pas une validation scientifique ou factuelle.',
    '',
    `- **Source :** \`${safeInline(input.source)}\``,
    `- **Méthode :** ${safeInline(input.method)}`,
    `- **Couverture :** ${input.segments.length} segments, jusqu’à ${formatTimestamp(duration)}`,
    `- **Transcript complet :** \`${safeInline(input.transcriptPath)}\``,
    '',
    '## Demande',
    '',
    question || 'Analyse générale de la vidéo partagée.',
    '',
    '## Passages technologiques à examiner',
    '',
    renderSignals(technologySignals),
    '',
    '## Affirmations à vérifier dans des sources primaires',
    '',
    renderSignals(claimSignals),
    '',
    '## Liens mentionnés dans le transcript',
    '',
    urls.length > 0 ? urls.map((url) => `- ${url}`).join('\n') : '- Aucun lien explicite détecté.',
    '',
    '## Backlog d’expériences (non vérifié)',
    '',
    renderExperimentBacklog(experimentBacklog),
  ];

  if (cloudAnswer) {
    sections.push(
      '',
      '## Synthèse cloud disponible (non vérifiée)',
      '',
      truncate(cloudAnswer, 2_500)
    );
  }

  sections.push(
    '',
    '## Prochaine étape recommandée',
    '',
    '1. Identifier les noms propres possiblement déformés par la transcription.',
    '2. Retrouver les publications, dépôts et annonces officiels.',
    '3. Séparer faits vérifiés, affirmations de la vidéo et inférences.',
    '4. Proposer des expériences bornées avant toute intégration dans Code Buddy.',
    ''
  );

  return sections.join('\n');
}

/**
 * Render a bounded preview for the immediate tool observation.
 *
 * Long transcripts are truncated before they reach the main model. Including
 * a few signals selected from the complete transcript prevents the model from
 * answering only from the opening minutes while keeping the observation small.
 */
export function buildVideoResearchCardPreview(input: VideoResearchCardInput): string {
  const windows = buildTranscriptWindows(input.segments);
  const technologySignals = selectSignals(windows, TECHNOLOGY_PATTERN, MAX_PREVIEW_SIGNALS);
  const claimSignals = selectSignals(windows, CLAIM_PATTERN, MAX_PREVIEW_SIGNALS);

  if (technologySignals.length === 0 && claimSignals.length === 0) return '';

  return [
    '## Aperçu de recherche (transcript complet)',
    '',
    '> Indices automatiques, non vérifiés. Confirmer les noms et affirmations dans des sources primaires.',
    '',
    '### Technologies et projets mentionnés',
    '',
    renderSignals(technologySignals, MAX_PREVIEW_WINDOW_CHARS),
    '',
    '### Affirmations à vérifier',
    '',
    renderSignals(claimSignals, MAX_PREVIEW_WINDOW_CHARS),
  ].join('\n');
}
