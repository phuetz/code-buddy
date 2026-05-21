export type LeadScoutLessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';

export interface LeadScoutLessonStats {
  processed?: number;
  enriched?: number;
  skipped?: number;
  blocked?: number;
  selectedLeads?: number;
  needsPublicEnrichment?: number;
  leadsWithEmail?: number;
  leadsWithPhone?: number;
  leadsWithWebsite?: number;
}

export interface LeadScoutLessonOptions {
  goal: string;
  context?: string;
  stats?: LeadScoutLessonStats;
  warnings?: string[];
  blockers?: string[];
  successfulPatterns?: string[];
  failedPatterns?: string[];
  contactPathsThatWorked?: string[];
  domainsToIgnore?: string[];
  scriptChanges?: string[];
}

export interface LeadScoutLessonCandidate {
  category: LeadScoutLessonCategory;
  content: string;
  context: string;
  source: 'self_observed';
  confidence: number;
  reason: string;
  lessonsAddInput: {
    category: LeadScoutLessonCategory;
    content: string;
    context: string;
    source: 'self_observed';
  };
}

export interface LeadScoutLessonCandidateResult {
  goal: string;
  context: string;
  candidates: LeadScoutLessonCandidate[];
  reviewRequired: boolean;
  persistenceTool: 'lessons_add';
  guidance: string[];
}

export function buildLeadScoutLessonCandidates(
  options: LeadScoutLessonOptions,
): LeadScoutLessonCandidateResult {
  const goal = normalizeRequired(options.goal, 'goal');
  const context = normalizeText(options.context) || 'Lead Scout';
  const candidates: LeadScoutLessonCandidate[] = [];

  addStatsCandidates(candidates, goal, context, options.stats);
  addPatternCandidates(candidates, context, options);
  addWarningCandidates(candidates, context, options.warnings);
  addBlockerCandidates(candidates, context, options.blockers);
  addScriptChangeCandidates(candidates, context, options.scriptChanges);

  return {
    goal,
    context,
    candidates: dedupeCandidates(candidates),
    reviewRequired: true,
    persistenceTool: 'lessons_add',
    guidance: [
      'Review candidates before persisting them with lessons_add.',
      'Persist only stable reusable patterns, not one-off data or raw page content.',
      'Prefer PATTERN for repeatable extraction behavior and RULE for safety constraints.',
      'Keep lessons short enough to steer future runs without replacing source evidence.',
    ],
  };
}

export function renderLeadScoutLessonCandidates(result: LeadScoutLessonCandidateResult): string {
  const lines = [
    `# Lead Scout Lesson Candidates: ${result.goal}`,
    '',
    `Context: ${result.context}`,
    `Review required: ${result.reviewRequired ? 'yes' : 'no'}`,
    `Persistence tool: ${result.persistenceTool}`,
    '',
    '## Candidates',
    ...(result.candidates.length > 0
      ? result.candidates.map((candidate, index) => (
        `${index + 1}. [${candidate.category}] ${candidate.content} (confidence ${candidate.confidence})`
      ))
      : ['No lesson candidates generated.']),
    '',
    '## Guidance',
    ...result.guidance.map((line) => `- ${line}`),
  ];

  return lines.join('\n');
}

function addStatsCandidates(
  candidates: LeadScoutLessonCandidate[],
  goal: string,
  context: string,
  stats: LeadScoutLessonStats | undefined,
): void {
  if (!stats) {
    return;
  }

  if (stats.needsPublicEnrichment && stats.selectedLeads && stats.needsPublicEnrichment > 0) {
    const ratio = Math.round((stats.needsPublicEnrichment / stats.selectedLeads) * 100);
    candidates.push(createCandidate({
      category: 'INSIGHT',
      content: `${ratio}% of selected leads for "${goal}" still need public enrichment; run lead_scout_enrichment_plan before outreach review.`,
      context,
      confidence: ratio >= 40 ? 0.9 : 0.75,
      reason: 'High share of selected leads lacks email, phone, and website.',
    }));
  }

  if (stats.leadsWithEmail || stats.leadsWithPhone || stats.leadsWithWebsite) {
    candidates.push(createCandidate({
      category: 'CONTEXT',
      content: `Lead Scout contact coverage: email=${stats.leadsWithEmail ?? 0}, phone=${stats.leadsWithPhone ?? 0}, website=${stats.leadsWithWebsite ?? 0}.`,
      context,
      confidence: 0.7,
      reason: 'Contact coverage helps choose the next enrichment strategy.',
    }));
  }

  if (stats.skipped && stats.processed && stats.skipped > 0) {
    candidates.push(createCandidate({
      category: 'PATTERN',
      content: `When ${stats.skipped}/${stats.processed} rows are skipped, inspect name-field aliases before rerunning Lead Scout.`,
      context,
      confidence: 0.8,
      reason: 'Skipped rows usually mean schema mismatch, not bad prospects.',
    }));
  }
}

function addPatternCandidates(
  candidates: LeadScoutLessonCandidate[],
  context: string,
  options: LeadScoutLessonOptions,
): void {
  for (const pattern of normalizeStringArray(options.successfulPatterns)) {
    candidates.push(createCandidate({
      category: 'PATTERN',
      content: `Successful Lead Scout pattern: ${pattern}`,
      context,
      confidence: 0.85,
      reason: 'Successful patterns should steer future generated scripts.',
    }));
  }

  for (const path of normalizeStringArray(options.contactPathsThatWorked)) {
    candidates.push(createCandidate({
      category: 'PATTERN',
      content: `For B2B enrichment, try contact path "${path}" early when it appears on the same official domain.`,
      context,
      confidence: 0.85,
      reason: 'Observed path produced useful public contact data.',
    }));
  }

  const ignoredDomains = normalizeStringArray(options.domainsToIgnore);
  if (ignoredDomains.length > 0) {
    candidates.push(createCandidate({
      category: 'RULE',
      content: `Ignore generic/non-official lead enrichment domains: ${ignoredDomains.join(', ')}.`,
      context,
      confidence: 0.9,
      reason: 'Avoid wasting budget on portals, social pages, or unrelated aggregators.',
    }));
  }

  for (const pattern of normalizeStringArray(options.failedPatterns)) {
    candidates.push(createCandidate({
      category: 'PATTERN',
      content: `Avoid failed Lead Scout pattern until revised: ${pattern}`,
      context,
      confidence: 0.75,
      reason: 'Failed patterns should not be retried blindly.',
    }));
  }
}

function addWarningCandidates(
  candidates: LeadScoutLessonCandidate[],
  context: string,
  warnings: string[] | undefined,
): void {
  for (const warning of normalizeStringArray(warnings)) {
    if (/skipped|schema|field|column/i.test(warning)) {
      candidates.push(createCandidate({
        category: 'PATTERN',
        content: `Lead Scout schema warning to remember: ${warning}`,
        context,
        confidence: 0.75,
        reason: 'Schema warnings often reveal reusable import aliases or validation rules.',
      }));
    }
  }
}

function addBlockerCandidates(
  candidates: LeadScoutLessonCandidate[],
  context: string,
  blockers: string[] | undefined,
): void {
  const normalizedBlockers = normalizeStringArray(blockers);
  if (normalizedBlockers.length === 0) {
    return;
  }

  candidates.push(createCandidate({
    category: 'RULE',
    content: `Stop generated enrichment scripts on blockers: ${normalizedBlockers.join(', ')}.`,
    context,
    confidence: 0.95,
    reason: 'Blockers are safety constraints that should persist across runs.',
  }));
}

function addScriptChangeCandidates(
  candidates: LeadScoutLessonCandidate[],
  context: string,
  scriptChanges: string[] | undefined,
): void {
  for (const change of normalizeStringArray(scriptChanges)) {
    candidates.push(createCandidate({
      category: 'INSIGHT',
      content: `Generated script improvement candidate: ${change}`,
      context,
      confidence: 0.7,
      reason: 'Script changes may become durable once verified by follow-up runs.',
    }));
  }
}

function createCandidate(input: {
  category: LeadScoutLessonCategory;
  content: string;
  context: string;
  confidence: number;
  reason: string;
}): LeadScoutLessonCandidate {
  return {
    ...input,
    source: 'self_observed',
    lessonsAddInput: {
      category: input.category,
      content: input.content,
      context: input.context,
      source: 'self_observed',
    },
  };
}

function dedupeCandidates(candidates: LeadScoutLessonCandidate[]): LeadScoutLessonCandidate[] {
  const seen = new Set<string>();
  const deduped: LeadScoutLessonCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.category}:${candidate.content}`;
    if (!seen.has(key)) {
      deduped.push(candidate);
      seen.add(key);
    }
  }
  return deduped;
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

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.map((value) => normalizeText(value)).filter((value) => value.length > 0);
}
