export type InternetScoutIntent =
  | 'research'
  | 'prospecting'
  | 'profile_enrichment'
  | 'page_verification'
  | 'lead_discovery';

export const INTERNET_SCOUT_INTENTS: InternetScoutIntent[] = [
  'research',
  'prospecting',
  'profile_enrichment',
  'page_verification',
  'lead_discovery',
];

export type InternetScoutStepTool =
  | 'web_search'
  | 'web_fetch'
  | 'browser'
  | 'relationship_context'
  | 'remember'
  | 'lessons_add';

export type InternetScoutStepStage =
  | 'discover'
  | 'read'
  | 'observe'
  | 'interact'
  | 'extract'
  | 'context'
  | 'assert'
  | 'persist';

export type InternetScoutEvidenceKind =
  | 'source-candidates'
  | 'static-content'
  | 'visible-state'
  | 'user-action'
  | 'structured-facts'
  | 'relationship-card'
  | 'assertion'
  | 'memory';

export interface InternetScoutPlanOptions {
  goal: string;
  query?: string;
  sourceUrl?: string;
  intent?: InternetScoutIntent;
  requiresInteraction?: boolean;
  expectedText?: string;
  persistWhenProven?: boolean;
  maxPages?: number;
  allowLoginPages?: boolean;
}

export interface InternetScoutStep {
  id: string;
  title: string;
  tool: InternetScoutStepTool;
  stage: InternetScoutStepStage;
  evidence: InternetScoutEvidenceKind;
  required: boolean;
  action?: string;
  reason: string;
  inputs?: Record<string, string | number | boolean>;
}

export interface InternetScoutPlan {
  goal: string;
  query: string;
  intent: InternetScoutIntent;
  sourceUrl?: string;
  expectedText?: string;
  maxPages: number;
  allowLoginPages: boolean;
  steps: InternetScoutStep[];
  safetyRules: string[];
  stopConditions: string[];
  evidenceChecklist: string[];
  rateLimit: {
    maxPages: number;
    pauseBetweenPagesMs: number;
    retryPolicy: string;
  };
}

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_PAUSE_MS = 1500;

const RELATIONSHIP_INTENTS = new Set<InternetScoutIntent>([
  'prospecting',
  'profile_enrichment',
  'lead_discovery',
]);

export function buildInternetScoutPlan(options: InternetScoutPlanOptions): InternetScoutPlan {
  const goal = normalizeRequired(options.goal, 'goal');
  const query = normalizeText(options.query) || goal;
  const sourceUrl = normalizeText(options.sourceUrl);
  const expectedText = normalizeText(options.expectedText);
  const intent = normalizeIntent(options.intent);
  const maxPages = normalizeMaxPages(options.maxPages);
  const allowLoginPages = options.allowLoginPages === true;
  const steps: InternetScoutStep[] = [];

  if (!sourceUrl) {
    steps.push({
      id: 'discover',
      title: 'Discover public source candidates',
      tool: 'web_search',
      stage: 'discover',
      evidence: 'source-candidates',
      required: true,
      reason: 'Start with search results so the agent can compare sources before opening pages.',
      inputs: { query, maxPages },
    });
  }

  steps.push({
    id: 'static-read',
    title: 'Read the source before opening a browser',
    tool: 'web_fetch',
    stage: 'read',
    evidence: 'static-content',
    required: true,
    reason: sourceUrl
      ? 'Cheap static fetch may already contain the needed evidence.'
      : 'Fetch the strongest search candidate before using browser automation.',
    inputs: sourceUrl ? { url: sourceUrl } : { query },
  });

  if (options.requiresInteraction === true || expectedText) {
    steps.push({
      id: 'observe',
      title: 'Observe visible state before acting',
      tool: 'browser',
      stage: 'observe',
      evidence: 'visible-state',
      required: true,
      action: 'observe',
      reason: 'Capture refs, visible text, forms, and blockers before any click or typing.',
      inputs: { query },
    });
  }

  if (options.requiresInteraction === true) {
    steps.push({
      id: 'interaction-plan',
      title: 'Interact only through observed refs',
      tool: 'browser',
      stage: 'interact',
      evidence: 'user-action',
      required: false,
      action: 'click/type/fill',
      reason: 'Use explicit refs from observe/snapshot, avoid blind selectors, and stop on auth or anti-bot walls.',
      inputs: { requiresVisibleRef: true },
    });
  }

  steps.push({
    id: 'extract',
    title: 'Extract structured page evidence',
    tool: 'browser',
    stage: 'extract',
    evidence: 'structured-facts',
    required: true,
    action: 'extract',
    reason: 'Collect URL, title, headings, links, actions, and goal-focused text snippets as proof.',
    inputs: { query },
  });

  if (RELATIONSHIP_INTENTS.has(intent)) {
    steps.push({
      id: 'relationship-context',
      title: 'Convert public findings into a safe context card',
      tool: 'relationship_context',
      stage: 'context',
      evidence: 'relationship-card',
      required: false,
      reason: 'Prospecting and profile enrichment should separate public facts from private or uncertain identity claims.',
      inputs: { mode: 'prospecting' },
    });
  }

  if (expectedText) {
    steps.push({
      id: 'assert',
      title: 'Assert the expected page state',
      tool: 'browser',
      stage: 'assert',
      evidence: 'assertion',
      required: true,
      action: 'assert_text',
      reason: 'Make the browsing result testable with an explicit pass/fail assertion.',
      inputs: { expectedText },
    });
  }

  if (options.persistWhenProven === true) {
    steps.push({
      id: 'persist',
      title: 'Persist only durable verified facts',
      tool: 'remember',
      stage: 'persist',
      evidence: 'memory',
      required: false,
      reason: 'Save concise facts only after source evidence or assertions prove them.',
    });
    steps.push({
      id: 'lesson',
      title: 'Capture reusable navigation lessons',
      tool: 'lessons_add',
      stage: 'persist',
      evidence: 'memory',
      required: false,
      reason: 'Store repeatable browsing patterns, selectors, blockers, or proof loops without raw page dumps.',
    });
  }

  return {
    goal,
    query,
    intent,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(expectedText ? { expectedText } : {}),
    maxPages,
    allowLoginPages,
    steps,
    safetyRules: buildSafetyRules(),
    stopConditions: buildStopConditions(allowLoginPages),
    evidenceChecklist: buildEvidenceChecklist(intent, Boolean(expectedText)),
    rateLimit: {
      maxPages,
      pauseBetweenPagesMs: DEFAULT_PAUSE_MS,
      retryPolicy: 'Retry transient network failures once; do not retry 403, 429, captcha, or auth walls.',
    },
  };
}

export function renderInternetScoutPlan(plan: InternetScoutPlan): string {
  const lines = [
    `# Internet Scout Plan: ${plan.goal}`,
    '',
    `Intent: ${plan.intent}`,
    `Query: ${plan.query}`,
    plan.sourceUrl ? `Source URL: ${plan.sourceUrl}` : '',
    plan.expectedText ? `Expected text: ${plan.expectedText}` : '',
    `Page budget: ${plan.maxPages}`,
    '',
    '## Steps',
    ...plan.steps.map((step, index) => {
      const toolAction = step.action ? `${step.tool}.${step.action}` : step.tool;
      const requirement = step.required ? 'required' : 'optional';
      return `${index + 1}. ${step.title} [${toolAction}, ${requirement}] - ${step.reason}`;
    }),
    '',
    '## Stop Conditions',
    ...plan.stopConditions.map((condition) => `- ${condition}`),
    '',
    '## Evidence Checklist',
    ...plan.evidenceChecklist.map((item) => `- ${item}`),
    '',
    '## Safety Rules',
    ...plan.safetyRules.map((rule) => `- ${rule}`),
  ];

  return lines.filter((line) => line !== '').join('\n');
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

function normalizeIntent(intent: InternetScoutIntent | undefined): InternetScoutIntent {
  if (!intent) {
    return 'research';
  }

  if (!INTERNET_SCOUT_INTENTS.includes(intent)) {
    throw new Error(`intent must be one of: ${INTERNET_SCOUT_INTENTS.join(', ')}`);
  }

  return intent;
}

function normalizeMaxPages(maxPages: number | undefined): number {
  if (maxPages === undefined) {
    return DEFAULT_MAX_PAGES;
  }

  if (!Number.isFinite(maxPages)) {
    return DEFAULT_MAX_PAGES;
  }

  return Math.min(20, Math.max(1, Math.floor(maxPages)));
}

function buildSafetyRules(): string[] {
  return [
    'Use public web pages or user-authorized pages only.',
    'Prefer web_fetch before browser automation to reduce page load and side effects.',
    'Observe before clicking or typing, and use visible refs rather than blind selectors.',
    'Do not bypass captcha, bot checks, paywalls, access controls, or robots/rate-limit signals.',
    'Do not infer or persist identity for unknown people without explicit permission and evidence.',
    'Persist only compact facts with source evidence; avoid storing raw page dumps or private data.',
  ];
}

function buildStopConditions(allowLoginPages: boolean): string[] {
  const loginCondition = allowLoginPages
    ? 'Credentials, cookies, or session injection are required and were not explicitly user-provided.'
    : 'A login wall, paywall, or private member area is required.';

  return [
    'Captcha, device challenge, security checkpoint, or bot-verification wall appears.',
    loginCondition,
    'HTTP 403, 429, rate-limit warning, or explicit crawling prohibition appears.',
    'The task asks for stealth, captcha solving, scraping behind access controls, or credential harvesting.',
    'The page exposes sensitive personal data that is not necessary for the user-authorized goal.',
  ];
}

function buildEvidenceChecklist(intent: InternetScoutIntent, needsAssertion: boolean): string[] {
  const checklist = [
    'Final URL and page title.',
    'At least one source snippet or heading tied to the goal.',
    'Source timestamps or observed-at time when available.',
    'Clear note of any blocker, missing evidence, or uncertainty.',
  ];

  if (RELATIONSHIP_INTENTS.has(intent)) {
    checklist.push('Public facts separated from private memory, guesses, and sensitive facts.');
  }

  if (needsAssertion) {
    checklist.push('Explicit assert_text pass/fail result for the expected page state.');
  }

  return checklist;
}
