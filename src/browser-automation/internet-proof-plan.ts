export type InternetProofStepTool =
  | 'web_search'
  | 'web_fetch'
  | 'browser'
  | 'remember'
  | 'lessons_add';

export interface InternetProofStep {
  id: string;
  title: string;
  tool: InternetProofStepTool;
  action?: string;
  required: boolean;
  evidence: 'discovery' | 'static-read' | 'observation' | 'extraction' | 'assertion' | 'memory';
  reason: string;
}

export interface InternetProofPlanOptions {
  goal: string;
  query?: string;
  sourceUrl?: string;
  expectedText?: string;
  requiresBrowser?: boolean;
  persistWhenProven?: boolean;
}

export interface InternetProofPlan {
  goal: string;
  query: string;
  sourceUrl?: string;
  expectedText?: string;
  steps: InternetProofStep[];
}

export interface InternetProofEvidence {
  url?: string;
  title?: string;
  query?: string;
  headings?: string[];
  matches?: string[];
  expectedText?: string;
  assertionPassed?: boolean;
  snippet?: string;
}

export interface InternetProofPersistenceOptions {
  plan: InternetProofPlan;
  evidence: InternetProofEvidence;
}

export interface InternetProofPersistenceSuggestion {
  tool: 'remember' | 'lessons_add';
  reason: string;
  input: Record<string, string>;
}

export function buildInternetProofPlan(options: InternetProofPlanOptions): InternetProofPlan {
  const goal = normalizeRequired(options.goal, 'goal');
  const query = normalizeText(options.query) || goal;
  const sourceUrl = normalizeText(options.sourceUrl);
  const expectedText = normalizeText(options.expectedText);
  const needsBrowser = options.requiresBrowser === true || Boolean(expectedText);
  const steps: InternetProofStep[] = [];

  if (!sourceUrl) {
    steps.push({
      id: 'discover',
      title: 'Discover source candidates',
      tool: 'web_search',
      required: true,
      evidence: 'discovery',
      reason: 'Find current public sources before opening a browser.',
    });
  }

  steps.push({
    id: 'static-read',
    title: 'Read the source cheaply',
    tool: 'web_fetch',
    required: true,
    evidence: 'static-read',
    reason: sourceUrl
      ? 'Fetch the known URL before browser automation.'
      : 'Fetch the best search result before browser automation.',
  });

  if (needsBrowser) {
    steps.push({
      id: 'observe',
      title: 'Observe page state before acting',
      tool: 'browser',
      action: 'observe',
      required: true,
      evidence: 'observation',
      reason: 'Capture actionable refs and visible page context before interaction.',
    });
  }

  steps.push({
    id: 'extract',
    title: 'Extract structured page evidence',
    tool: 'browser',
    action: 'extract',
    required: true,
    evidence: 'extraction',
    reason: 'Capture URL, title, headings, actions, links and query-focused text evidence.',
  });

  if (expectedText) {
    steps.push({
      id: 'assert',
      title: 'Assert the expected page state',
      tool: 'browser',
      action: 'assert_text',
      required: true,
      evidence: 'assertion',
      reason: 'Turn the expected text into an explicit pass/fail browser assertion.',
    });
  }

  if (options.persistWhenProven === true) {
    steps.push({
      id: 'persist',
      title: 'Persist only proven durable facts',
      tool: 'remember',
      required: false,
      evidence: 'memory',
      reason: 'Save only durable facts after extraction or assertions prove them.',
    });
    steps.push({
      id: 'lesson',
      title: 'Capture reusable workflow lessons',
      tool: 'lessons_add',
      required: false,
      evidence: 'memory',
      reason: 'Store reusable web automation patterns, not raw browsing noise.',
    });
  }

  return {
    goal,
    query,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(expectedText ? { expectedText } : {}),
    steps,
  };
}

export function buildInternetProofPersistenceSuggestions(
  options: InternetProofPersistenceOptions,
): InternetProofPersistenceSuggestion[] {
  const { plan, evidence } = options;
  const shouldRemember = plan.steps.some((step) => step.tool === 'remember');
  const shouldAddLesson = plan.steps.some((step) => step.tool === 'lessons_add');
  if (!shouldRemember && !shouldAddLesson) {
    return [];
  }

  const assertionRequired = plan.steps.some((step) => step.evidence === 'assertion');
  if (evidence.assertionPassed === false || (assertionRequired && evidence.assertionPassed !== true)) {
    return [];
  }

  const normalizedEvidence = normalizeEvidence(plan, evidence);
  if (!hasDurableEvidence(normalizedEvidence)) {
    return [];
  }

  const suggestions: InternetProofPersistenceSuggestion[] = [];
  const proofSteps = summarizeProofSteps(plan);
  const durableEvidence = buildDurableEvidenceLines(plan, normalizedEvidence);

  if (shouldRemember) {
    suggestions.push({
      tool: 'remember',
      reason: 'Persist only browser-verified web facts after the proof loop succeeds.',
      input: {
        key: buildMemoryKey(plan, normalizedEvidence),
        value: durableEvidence.join('\n'),
        scope: 'project',
        category: 'patterns',
      },
    });
  }

  if (shouldAddLesson) {
    suggestions.push({
      tool: 'lessons_add',
      reason: 'Capture the reusable internet proof-loop pattern without storing raw browsing noise.',
      input: {
        category: 'INSIGHT',
        content: [
          `Verified "${displayTarget(plan, normalizedEvidence)}" before persistence.`,
          `Proof loop: ${proofSteps}.`,
          `Durable evidence: ${durableEvidence.slice(0, 4).join(' | ')}.`,
        ].join(' '),
        context: 'Internet automation proof loop',
        source: 'self_observed',
      },
    });
  }

  return suggestions;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeEvidence(
  plan: InternetProofPlan,
  evidence: InternetProofEvidence,
): Required<Pick<InternetProofEvidence, 'headings' | 'matches'>> &
  Omit<InternetProofEvidence, 'headings' | 'matches'> {
  return {
    url: normalizeText(evidence.url) || plan.sourceUrl,
    title: normalizeText(evidence.title),
    query: normalizeText(evidence.query) || plan.query,
    headings: normalizeTextList(evidence.headings),
    matches: normalizeTextList(evidence.matches),
    expectedText: normalizeText(evidence.expectedText) || plan.expectedText,
    assertionPassed: evidence.assertionPassed,
    snippet: normalizeText(evidence.snippet),
  };
}

function normalizeTextList(values: string[] | undefined): string[] {
  const normalized = (values ?? [])
    .map((value) => truncateSegment(normalizeText(value), 180))
    .filter((value): value is string => Boolean(value));
  return [...new Set(normalized)].slice(0, 5);
}

function hasDurableEvidence(evidence: InternetProofEvidence): boolean {
  return Boolean(
    evidence.url ||
      evidence.title ||
      evidence.headings?.length ||
      evidence.matches?.length ||
      evidence.snippet ||
      evidence.assertionPassed === true,
  );
}

function buildDurableEvidenceLines(
  plan: InternetProofPlan,
  evidence: InternetProofEvidence,
): string[] {
  const lines = [
    `Goal: ${plan.goal}`,
    evidence.url ? `URL: ${evidence.url}` : '',
    evidence.title ? `Title: ${evidence.title}` : '',
    evidence.query ? `Query: ${evidence.query}` : '',
    evidence.headings?.length ? `Headings: ${evidence.headings.join(' | ')}` : '',
    evidence.matches?.length ? `Matches: ${evidence.matches.join(' | ')}` : '',
    evidence.assertionPassed === true && evidence.expectedText
      ? `Assertion: passed for "${evidence.expectedText}"`
      : '',
    evidence.snippet ? `Snippet: ${truncateSegment(evidence.snippet, 240)}` : '',
  ];

  return lines.filter((line) => line.trim());
}

function summarizeProofSteps(plan: InternetProofPlan): string {
  return plan.steps
    .filter((step) => step.required || step.tool === 'remember' || step.tool === 'lessons_add')
    .map((step) => (step.action ? `${step.tool}.${step.action}` : step.tool))
    .join(' -> ');
}

function buildMemoryKey(plan: InternetProofPlan, evidence: InternetProofEvidence): string {
  const target = evidence.title || safeHostname(evidence.url) || evidence.query || plan.goal;
  return `web-proof:${slugify(target).slice(0, 72)}`;
}

function displayTarget(plan: InternetProofPlan, evidence: InternetProofEvidence): string {
  return evidence.title || evidence.url || evidence.query || plan.goal;
}

function safeHostname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'source';
}

function truncateSegment(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
