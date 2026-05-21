import {
  buildLeadDiscoveryWorkflowTemplate,
  renderLeadDiscoveryWorkflowTemplate,
  type LeadDiscoveryWorkflowTemplate,
} from './lead-discovery-workflow-template.js';

export type LeadScoutTarget =
  | 'architectes'
  | 'syndics'
  | 'agences_immobilieres'
  | 'maitres_oeuvre'
  | 'promoteurs'
  | 'bureaux_etudes'
  | 'custom';

export const LEAD_SCOUT_TARGETS: LeadScoutTarget[] = [
  'architectes',
  'syndics',
  'agences_immobilieres',
  'maitres_oeuvre',
  'promoteurs',
  'bureaux_etudes',
  'custom',
];

export type LeadScoutSource =
  | 'local_dataset'
  | 'sirene'
  | 'rnc'
  | 'official_directory'
  | 'public_website'
  | 'web_search';

export const LEAD_SCOUT_SOURCES: LeadScoutSource[] = [
  'local_dataset',
  'sirene',
  'rnc',
  'official_directory',
  'public_website',
  'web_search',
];

export type LeadScoutExportFormat = 'csv' | 'json' | 'markdown';

export const LEAD_SCOUT_EXPORT_FORMATS: LeadScoutExportFormat[] = ['csv', 'json', 'markdown'];

export interface LeadScoutPlanOptions {
  goal: string;
  target?: LeadScoutTarget;
  customTarget?: string;
  zone?: string;
  offer?: string;
  maxProspects?: number;
  sources?: LeadScoutSource[];
  exportFormats?: LeadScoutExportFormat[];
  localDatasetPaths?: string[];
  requireHumanApprovalBeforeContact?: boolean;
}

export interface LeadScoutField {
  name: string;
  description: string;
  required: boolean;
}

export interface LeadScoutSourcePlan {
  source: LeadScoutSource;
  priority: number;
  reason: string;
}

export interface LeadScoutPipelineStep {
  id: string;
  title: string;
  action: string;
  required: boolean;
  output: string;
}

export interface LeadScoutScoringRule {
  id: string;
  weight: number;
  rule: string;
}

export interface LeadScoutScriptRecipeStep {
  id: string;
  module: string;
  input: string;
  output: string;
  notes: string[];
}

export interface LeadScoutPlan {
  goal: string;
  target: LeadScoutTarget;
  targetLabel: string;
  zone: string;
  offer: string;
  maxProspects: number;
  requireHumanApprovalBeforeContact: boolean;
  sources: LeadScoutSourcePlan[];
  localDatasetPaths: string[];
  exportFormats: LeadScoutExportFormat[];
  leadSchema: LeadScoutField[];
  pipelineSteps: LeadScoutPipelineStep[];
  scoringRules: LeadScoutScoringRule[];
  safetyRules: string[];
  agentTools: string[];
  scriptRecipe: LeadScoutScriptRecipeStep[];
  workflowTemplate: LeadDiscoveryWorkflowTemplate;
}

const DEFAULT_MAX_PROSPECTS = 50;
const MAX_PROSPECTS_LIMIT = 500;
const DEFAULT_EXPORT_FORMATS: LeadScoutExportFormat[] = ['csv', 'json'];

const TARGET_LABELS: Record<LeadScoutTarget, string> = {
  architectes: 'architectes',
  syndics: 'syndics de copropriete',
  agences_immobilieres: 'agences immobilieres',
  maitres_oeuvre: "maitres d'oeuvre",
  promoteurs: 'promoteurs immobiliers',
  bureaux_etudes: "bureaux d'etudes",
  custom: 'prospects B2B',
};

const DEFAULT_SOURCES_BY_TARGET: Record<LeadScoutTarget, LeadScoutSource[]> = {
  architectes: ['local_dataset', 'official_directory', 'public_website', 'web_search'],
  syndics: ['local_dataset', 'rnc', 'public_website', 'web_search'],
  agences_immobilieres: ['local_dataset', 'sirene', 'public_website', 'web_search'],
  maitres_oeuvre: ['local_dataset', 'sirene', 'public_website', 'web_search'],
  promoteurs: ['sirene', 'public_website', 'web_search'],
  bureaux_etudes: ['local_dataset', 'sirene', 'public_website', 'web_search'],
  custom: ['web_search', 'public_website'],
};

export function buildLeadScoutPlan(options: LeadScoutPlanOptions): LeadScoutPlan {
  const goal = normalizeRequired(options.goal, 'goal');
  const target = normalizeTarget(options.target);
  const targetLabel = normalizeTargetLabel(target, options.customTarget);
  const zone = normalizeText(options.zone) || 'zone non precisee';
  const offer = normalizeText(options.offer) || 'offre B2B a qualifier';
  const maxProspects = normalizeMaxProspects(options.maxProspects);
  const localDatasetPaths = normalizeStringArray(options.localDatasetPaths);
  const exportFormats = normalizeExportFormats(options.exportFormats);
  const requireHumanApprovalBeforeContact = options.requireHumanApprovalBeforeContact !== false;

  const sourcePlans = normalizeSources(options.sources, target).map((source, index) => ({
    source,
    priority: index + 1,
    reason: getSourceReason(source, targetLabel),
  }));

  const planWithoutTemplate: Omit<LeadScoutPlan, 'workflowTemplate'> = {
    goal,
    target,
    targetLabel,
    zone,
    offer,
    maxProspects,
    requireHumanApprovalBeforeContact,
    sources: sourcePlans,
    localDatasetPaths,
    exportFormats,
    leadSchema: buildLeadSchema(),
    pipelineSteps: buildPipelineSteps(localDatasetPaths.length > 0, requireHumanApprovalBeforeContact),
    scoringRules: buildScoringRules(zone, offer),
    safetyRules: buildSafetyRules(requireHumanApprovalBeforeContact),
    agentTools: buildAgentTools(),
    scriptRecipe: buildScriptRecipe(exportFormats, requireHumanApprovalBeforeContact),
  };

  return {
    ...planWithoutTemplate,
    workflowTemplate: buildLeadDiscoveryWorkflowTemplate({
      goal,
      targetLabel,
      zone,
      offer,
      maxProspects,
      requireHumanApprovalBeforeContact,
      localDatasetPaths,
      exportFormats,
      allowedSources: sourcePlans.map((source) => source.source),
    }),
  };
}

export function renderLeadScoutPlan(plan: LeadScoutPlan): string {
  const lines: string[] = [
    `# Lead Scout Plan: ${plan.goal}`,
    '',
    `Target: ${plan.targetLabel}`,
    `Zone: ${plan.zone}`,
    `Offer: ${plan.offer}`,
    `Prospect budget: ${plan.maxProspects}`,
    `Human approval before contact: ${plan.requireHumanApprovalBeforeContact ? 'required' : 'not required by plan'}`,
    '',
    '## Sources',
    ...plan.sources.map((source) => `${source.priority}. ${source.source} - ${source.reason}`),
  ];

  if (plan.localDatasetPaths.length > 0) {
    lines.push('', '## Local Datasets', ...plan.localDatasetPaths.map((path) => `- ${path}`));
  }

  lines.push(
    '',
    '## Pipeline',
    ...plan.pipelineSteps.map((step, index) => {
      const requirement = step.required ? 'required' : 'optional';
      return `${index + 1}. ${step.title} [${requirement}] - ${step.action}`;
    }),
    '',
    '## Scoring',
    ...plan.scoringRules.map((rule) => `- ${rule.id} (${rule.weight}): ${rule.rule}`),
    '',
    '## Safety Rules',
    ...plan.safetyRules.map((rule) => `- ${rule}`),
    '',
    '## Agent Tools',
    ...plan.agentTools.map((tool) => `- ${tool}`),
    '',
    '## Script Recipe',
    ...plan.scriptRecipe.map((step) => `- ${step.id}: ${step.module} -> ${step.output}`),
    '',
    '## Public-Data Workflow Template',
    renderLeadDiscoveryWorkflowTemplate(plan.workflowTemplate),
  );

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

function normalizeTarget(target: LeadScoutTarget | undefined): LeadScoutTarget {
  if (!target) {
    return 'custom';
  }
  if (!LEAD_SCOUT_TARGETS.includes(target)) {
    throw new Error(`target must be one of: ${LEAD_SCOUT_TARGETS.join(', ')}`);
  }
  return target;
}

function normalizeTargetLabel(target: LeadScoutTarget, customTarget: string | undefined): string {
  const custom = normalizeText(customTarget);
  if (target === 'custom' && custom) {
    return custom;
  }
  return TARGET_LABELS[target];
}

function normalizeMaxProspects(maxProspects: number | undefined): number {
  if (maxProspects === undefined || !Number.isFinite(maxProspects)) {
    return DEFAULT_MAX_PROSPECTS;
  }
  return Math.min(MAX_PROSPECTS_LIMIT, Math.max(1, Math.floor(maxProspects)));
}

function normalizeSources(sources: LeadScoutSource[] | undefined, target: LeadScoutTarget): LeadScoutSource[] {
  const candidateSources = sources && sources.length > 0 ? sources : DEFAULT_SOURCES_BY_TARGET[target];
  const uniqueSources: LeadScoutSource[] = [];
  for (const source of candidateSources) {
    if (!LEAD_SCOUT_SOURCES.includes(source)) {
      throw new Error(`sources must contain only: ${LEAD_SCOUT_SOURCES.join(', ')}`);
    }
    if (!uniqueSources.includes(source)) {
      uniqueSources.push(source);
    }
  }
  return uniqueSources;
}

function normalizeExportFormats(formats: LeadScoutExportFormat[] | undefined): LeadScoutExportFormat[] {
  const candidateFormats = formats && formats.length > 0 ? formats : DEFAULT_EXPORT_FORMATS;
  const uniqueFormats: LeadScoutExportFormat[] = [];
  for (const format of candidateFormats) {
    if (!LEAD_SCOUT_EXPORT_FORMATS.includes(format)) {
      throw new Error(`exportFormats must contain only: ${LEAD_SCOUT_EXPORT_FORMATS.join(', ')}`);
    }
    if (!uniqueFormats.includes(format)) {
      uniqueFormats.push(format);
    }
  }
  return uniqueFormats;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.map((value) => normalizeText(value)).filter((value) => value.length > 0);
}

function buildLeadSchema(): LeadScoutField[] {
  return [
    { name: 'nom', description: 'Business or organization name', required: true },
    { name: 'type', description: 'Target category such as architecte, syndic, agence', required: true },
    { name: 'email', description: 'Public professional email when available', required: false },
    { name: 'telephone', description: 'Public professional phone number when available', required: false },
    { name: 'site_web', description: 'Official website or public profile URL', required: false },
    { name: 'adresse', description: 'Public business address', required: false },
    { name: 'ville', description: 'City', required: false },
    { name: 'departement', description: 'Department or local administrative area', required: false },
    { name: 'region', description: 'Region', required: false },
    { name: 'source_url', description: 'URL proving the lead record or enrichment', required: true },
    { name: 'evidence', description: 'Short source excerpt or reason for inclusion', required: true },
    { name: 'score', description: 'Priority score from 0 to 100', required: true },
    { name: 'status', description: 'review, approved, contacted, do_not_contact, stale', required: true },
  ];
}

function buildPipelineSteps(hasLocalDatasets: boolean, requireHumanApprovalBeforeContact: boolean): LeadScoutPipelineStep[] {
  const steps: LeadScoutPipelineStep[] = [];

  if (hasLocalDatasets) {
    steps.push({
      id: 'import-local-datasets',
      title: 'Import local datasets first',
      action: 'Read existing CSV/JSON files, map known columns, and keep source file provenance.',
      required: true,
      output: 'Raw candidate leads with source_file metadata.',
    });
  }

  steps.push(
    {
      id: 'discover-public-sources',
      title: 'Discover public source candidates',
      action: 'Use official directories, public registries, and web_search queries tied to the target and zone.',
      required: true,
      output: 'Candidate source URLs with query and observed-at timestamp.',
    },
    {
      id: 'normalize-records',
      title: 'Normalize lead records',
      action: 'Normalize names, addresses, city labels, websites, emails, phones, and category labels.',
      required: true,
      output: 'Records matching the lead schema.',
    },
    {
      id: 'enrich-missing-public-contact',
      title: 'Enrich missing public contact data',
      action: 'Use internet_scout_plan/run only on public pages, with low page budgets and blocker-aware stops.',
      required: false,
      output: 'Additional public business contact fields with source_url and evidence.',
    },
    {
      id: 'dedupe',
      title: 'Deduplicate candidates',
      action: 'Merge records by normalized name plus city, website, email, or public registry identifier.',
      required: true,
      output: 'Unique lead list with merged evidence.',
    },
    {
      id: 'score',
      title: 'Score and prioritize',
      action: 'Apply scoring rules, cap weak evidence, and keep rejected candidates with a reason.',
      required: true,
      output: 'Ranked review queue.',
    },
    {
      id: 'draft-outreach',
      title: 'Draft outreach only',
      action: 'Generate short B2B outreach drafts referencing the offer and public context without sending.',
      required: false,
      output: 'Draft email snippets attached to approved records.',
    },
    {
      id: 'export-review-queue',
      title: 'Export review queue',
      action: 'Write CSV/JSON/Markdown outputs with status fields and source evidence.',
      required: true,
      output: 'Human-reviewable lead files.',
    },
  );

  if (requireHumanApprovalBeforeContact) {
    steps.push({
      id: 'human-approval-gate',
      title: 'Require human approval before contact',
      action: 'Move a record to approved only after a human reviews source evidence and outreach copy.',
      required: true,
      output: 'Approved contact queue; no automatic sends.',
    });
  }

  return steps;
}

function buildScoringRules(zone: string, offer: string): LeadScoutScoringRule[] {
  return [
    {
      id: 'public-contact',
      weight: 25,
      rule: 'Add points when a public professional email, phone, website, or contact form is proven.',
    },
    {
      id: 'local-fit',
      weight: 20,
      rule: `Add points when the lead is in or near "${zone}".`,
    },
    {
      id: 'target-fit',
      weight: 20,
      rule: 'Add points when the page, registry, or dataset clearly matches the requested target type.',
    },
    {
      id: 'offer-fit',
      weight: 20,
      rule: `Add points when public evidence suggests relevance to "${offer}".`,
    },
    {
      id: 'evidence-quality',
      weight: 15,
      rule: 'Add points for official sources, recent pages, stable URLs, and clear excerpts; cap weak or duplicate evidence.',
    },
  ];
}

function buildSafetyRules(requireHumanApprovalBeforeContact: boolean): string[] {
  const rules = [
    'Use public or user-provided B2B data only; do not collect private personal data for consumer targeting.',
    'Prefer official registries, professional directories, company websites, and existing local datasets.',
    'Do not bypass captcha, login walls, paywalls, anti-bot checks, robots/rate-limit signals, or access controls.',
    'Keep source_url and evidence for every exported lead so a human can audit the result.',
    'Respect unsubscribe, opt-out, do-not-contact, and stale-contact status fields.',
    'Do not send mass email or automated outreach from this planning tool.',
  ];

  if (requireHumanApprovalBeforeContact) {
    rules.push('Require human validation before any contact attempt or email send.');
  }

  return rules;
}

function buildAgentTools(): string[] {
  return [
    'lead_scout_plan',
    'lead_scout_lesson_candidates',
    'internet_scout_plan',
    'internet_scout_run',
    'web_search',
    'web_fetch',
    'relationship_context',
    'remember',
    'lessons_add',
  ];
}

function buildScriptRecipe(
  exportFormats: LeadScoutExportFormat[],
  requireHumanApprovalBeforeContact: boolean,
): LeadScoutScriptRecipeStep[] {
  return [
    {
      id: 'input',
      module: 'load-leads',
      input: 'CSV/JSON datasets, public registry exports, or source URL candidates.',
      output: 'Raw lead records.',
      notes: ['Keep original source path or URL on every row.', 'Fail closed on unreadable files instead of guessing columns.'],
    },
    {
      id: 'normalize',
      module: 'normalize-leads',
      input: 'Raw lead records.',
      output: 'Canonical lead schema.',
      notes: ['Trim whitespace and normalize casing.', 'Preserve original fields under metadata when useful.'],
    },
    {
      id: 'enrich',
      module: 'enrich-public-contact',
      input: 'Rows missing public contact fields.',
      output: 'Rows with additional source_url and evidence.',
      notes: ['Use Internet Scout with small budgets.', 'Stop on captcha, 403, 429, login, paywall, or private data.'],
    },
    {
      id: 'dedupe',
      module: 'dedupe-leads',
      input: 'Canonical lead records.',
      output: 'Unique records with merged evidence.',
      notes: ['Match on normalized name plus city, website, email, or registry id.', 'Never drop evidence silently.'],
    },
    {
      id: 'score',
      module: 'score-leads',
      input: 'Unique records.',
      output: 'Ranked review queue.',
      notes: ['Store score reasons.', 'Default status should be review, not contacted.'],
    },
    {
      id: 'export',
      module: 'export-leads',
      input: 'Ranked review queue.',
      output: exportFormats.join(', '),
      notes: [
        'Include status and source evidence in every format.',
        requireHumanApprovalBeforeContact ? 'Block send-ready exports until approval is recorded.' : 'Keep contact automation opt-in and explicit.',
      ],
    },
  ];
}

function getSourceReason(source: LeadScoutSource, targetLabel: string): string {
  switch (source) {
    case 'local_dataset':
      return `Start from existing curated ${targetLabel} files when available.`;
    case 'sirene':
      return 'Use public French company registry data for business identity and location checks.';
    case 'rnc':
      return 'Use public copropriete/syndic registry context when relevant.';
    case 'official_directory':
      return `Prefer official professional directories for ${targetLabel}.`;
    case 'public_website':
      return 'Use official websites to prove current public contact details.';
    case 'web_search':
      return 'Discover public candidates and fill gaps with bounded search.';
  }
}
