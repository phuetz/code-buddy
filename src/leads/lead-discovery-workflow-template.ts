import {
  buildResearchScriptJobArtifact,
  type ResearchScriptJobArtifact,
} from '../agent/research-script-job-artifact.js';

export const LEAD_DISCOVERY_WORKFLOW_TEMPLATE_SCHEMA_VERSION = 1;

export type LeadDiscoveryStageId =
  | 'contact-field-extraction'
  | 'dedupe'
  | 'evidence'
  | 'export'
  | 'page-extraction'
  | 'search'
  | 'site-discovery';

export interface LeadDiscoveryWorkflowInput {
  description: string;
  name: string;
  required: boolean;
  source: 'derived' | 'operator' | 'public_web' | 'user_dataset';
}

export interface LeadDiscoveryWorkflowStage {
  id: LeadDiscoveryStageId;
  title: string;
  action: string;
  inputs: string[];
  outputs: string[];
  guardrails: string[];
}

export interface LeadDiscoveryContactPolicy {
  automaticContactAllowed: false;
  mode: 'review_queue_only';
  requiresHumanApproval: boolean;
  allowedActions: string[];
  blockedActions: string[];
}

export interface LeadDiscoveryExpectedArtifact {
  description: string;
  kind: 'dataset' | 'evidence' | 'export' | 'review_queue' | 'script' | 'summary';
  path: string;
}

export interface LeadDiscoveryWorkflowTemplate {
  schemaVersion: typeof LEAD_DISCOVERY_WORKFLOW_TEMPLATE_SCHEMA_VERSION;
  id: string;
  title: string;
  goal: string;
  targetLabel: string;
  zone: string;
  offer: string;
  maxProspects: number;
  publicDataOnly: true;
  allowedSources: string[];
  contactPolicy: LeadDiscoveryContactPolicy;
  inputs: LeadDiscoveryWorkflowInput[];
  stages: LeadDiscoveryWorkflowStage[];
  guardrails: string[];
  expectedArtifacts: LeadDiscoveryExpectedArtifact[];
  recommendedTools: string[];
  scriptJobArtifact: ResearchScriptJobArtifact;
}

export interface BuildLeadDiscoveryWorkflowTemplateOptions {
  allowedSources: string[];
  exportFormats: string[];
  goal: string;
  maxProspects: number;
  offer: string;
  targetLabel: string;
  zone: string;
  localDatasetPaths?: string[];
  requireHumanApprovalBeforeContact?: boolean;
}

export function buildLeadDiscoveryWorkflowTemplate(
  options: BuildLeadDiscoveryWorkflowTemplateOptions,
): LeadDiscoveryWorkflowTemplate {
  const goal = normalizeRequired(options.goal, 'goal');
  const targetLabel = normalizeRequired(options.targetLabel, 'targetLabel');
  const zone = normalizeText(options.zone) || 'zone non precisee';
  const offer = normalizeText(options.offer) || 'offre B2B a qualifier';
  const allowedSources = normalizeStringArray(options.allowedSources);
  const exportFormats = normalizeStringArray(options.exportFormats);
  const maxProspects = normalizeBoundedInteger(options.maxProspects, 50, 1, 500);
  const requiresHumanApproval = options.requireHumanApprovalBeforeContact !== false;
  const id = `lead-discovery-public-${slugify(targetLabel)}-${stableHash([goal, zone, offer].join('|'))}`;

  const expectedArtifacts = buildExpectedArtifacts(id, exportFormats);

  return {
    schemaVersion: LEAD_DISCOVERY_WORKFLOW_TEMPLATE_SCHEMA_VERSION,
    id,
    title: `Public-data lead discovery for ${targetLabel}`,
    goal,
    targetLabel,
    zone,
    offer,
    maxProspects,
    publicDataOnly: true,
    allowedSources,
    contactPolicy: buildContactPolicy(requiresHumanApproval),
    inputs: buildInputs(options.localDatasetPaths),
    stages: buildStages(requiresHumanApproval),
    guardrails: buildGuardrails(requiresHumanApproval),
    expectedArtifacts,
    recommendedTools: [
      'lead_scout_plan',
      'lead_scout_enrichment_plan',
      'lead_scout_run',
      'internet_scout_plan',
      'internet_scout_run',
      'web_search',
      'web_fetch',
      'lessons_add',
    ],
    scriptJobArtifact: buildResearchScriptJobArtifact({
      id: `${id}-script`,
      title: `${targetLabel} public lead discovery script`,
      goal,
      language: 'python',
      scriptFileName: 'discover-public-leads.py',
      inputContract: {
        SEARCH_QUERY: 'Public search query for the target, region, and offer.',
        SEED_URLS_JSON: 'Optional public seed/profile URLs selected by the operator or previous step.',
        LOCAL_DATASETS_JSON: 'Optional local dataset manifest with user-provided source files.',
        OUTPUT_JSON: 'Path where the script writes normalized leads and evidence.',
      },
      outputContract: {
        leads: 'Normalized public B2B lead rows with source_url, evidence, score, and review status.',
        evidence: 'Source URL, observed time, page title, snippet, and extraction reason for each field.',
        reviewQueue: 'Human-review queue; no automatic outreach or send action.',
      },
      command: {
        executable: 'python',
        args: ['discover-public-leads.py'],
        env: {
          SEARCH_QUERY: `${targetLabel} ${zone}`,
          OUTPUT_JSON: 'output.json',
          LIMIT: String(maxProspects),
        },
      },
      sandboxPolicy: {
        provider: 'local',
        network: 'https_only_public_web',
        writes: 'artifact_dir_only',
        pageBudget: 40,
        delayMs: 1500,
        timeoutMs: 180000,
        stopOn: ['captcha', 'login', 'paywall', '403', '429', 'private_data', 'non_public_source'],
        cleanup: 'keep_all_artifacts',
      },
      assertions: [
        {
          id: 'public-source-only',
          kind: 'evidence',
          description: 'Every exported lead is backed by a public source URL and short evidence snippet.',
          required: true,
        },
        {
          id: 'review-queue-only',
          kind: 'no_contact_action',
          description: 'The workflow creates review and draft artifacts only; it does not contact leads.',
          required: true,
        },
        {
          id: 'review-export-written',
          kind: 'file_exists',
          description: 'The run writes a review queue artifact under the script job folder.',
          required: true,
        },
      ],
    }),
  };
}

export function renderLeadDiscoveryWorkflowTemplate(template: LeadDiscoveryWorkflowTemplate): string {
  const lines = [
    `# ${template.title}`,
    '',
    `Goal: ${template.goal}`,
    `Zone: ${template.zone}`,
    `Offer: ${template.offer}`,
    `Public data only: ${template.publicDataOnly ? 'yes' : 'no'}`,
    `Human approval before contact: ${template.contactPolicy.requiresHumanApproval ? 'required' : 'not required by template'}`,
    '',
    '## Inputs',
    ...template.inputs.map((input) => `- ${input.name}: ${input.description}`),
    '',
    '## Stages',
    ...template.stages.map((stage, index) => `${index + 1}. ${stage.title} - ${stage.action}`),
    '',
    '## Expected Artifacts',
    ...template.expectedArtifacts.map((artifact) => `- ${artifact.path}: ${artifact.description}`),
    '',
    '## Script Job',
    `- Manifest: ${template.scriptJobArtifact.files.manifest}`,
    `- Script: ${template.scriptJobArtifact.files.script}`,
    `- Output: ${template.scriptJobArtifact.files.output}`,
  ];

  return lines.join('\n');
}

function buildInputs(localDatasetPaths: string[] | undefined): LeadDiscoveryWorkflowInput[] {
  const inputs: LeadDiscoveryWorkflowInput[] = [
    {
      name: 'publicSearchQuery',
      description: 'Public query combining target role, region, and offer context.',
      required: true,
      source: 'operator',
    },
    {
      name: 'region',
      description: 'City, postal code, department, region, or radius text.',
      required: true,
      source: 'operator',
    },
    {
      name: 'targetRole',
      description: 'B2B role or organization category to find.',
      required: true,
      source: 'operator',
    },
    {
      name: 'allowedSources',
      description: 'Public source families allowed for the run.',
      required: true,
      source: 'operator',
    },
    {
      name: 'fieldsToExtract',
      description: 'Public professional fields such as website, email, phone, address, and evidence.',
      required: true,
      source: 'operator',
    },
    {
      name: 'contactPolicy',
      description: 'Review-only contact policy that blocks automatic outreach.',
      required: true,
      source: 'operator',
    },
  ];

  if (localDatasetPaths && localDatasetPaths.length > 0) {
    inputs.push({
      name: 'localDatasetPaths',
      description: 'User-provided JSON/CSV files to import before web discovery.',
      required: false,
      source: 'user_dataset',
    });
  }

  return inputs;
}

function buildStages(requiresHumanApproval: boolean): LeadDiscoveryWorkflowStage[] {
  return [
    {
      id: 'search',
      title: 'Search public candidates',
      action: 'Run bounded public search queries and collect candidate source URLs.',
      inputs: ['publicSearchQuery', 'region', 'targetRole', 'allowedSources'],
      outputs: ['candidateSourceUrls'],
      guardrails: ['Use public pages only.', 'Stop on captcha, login walls, paywalls, 403, or 429.'],
    },
    {
      id: 'site-discovery',
      title: 'Discover official sites',
      action: 'Follow directory/profile pages to official company websites when available.',
      inputs: ['candidateSourceUrls'],
      outputs: ['officialWebsiteCandidates'],
      guardrails: ['Reject generic portals and social-only profiles as official sites.'],
    },
    {
      id: 'page-extraction',
      title: 'Extract public page evidence',
      action: 'Read home, contact, about, agency, and legal pages with a bounded page budget.',
      inputs: ['officialWebsiteCandidates'],
      outputs: ['pageEvidence'],
      guardrails: ['Store snippets, not full raw pages.', 'Stay on same-domain pages unless explicitly allowed.'],
    },
    {
      id: 'contact-field-extraction',
      title: 'Extract public contact fields',
      action: 'Extract public professional email, phone, website, address, and contact URL fields.',
      inputs: ['pageEvidence'],
      outputs: ['normalizedLeadRows'],
      guardrails: ['Keep source_url and snippet for every field.', 'Do not collect unrelated private personal data.'],
    },
    {
      id: 'dedupe',
      title: 'Deduplicate leads',
      action: 'Merge candidates by normalized name plus city, website, email, phone, or registry identifier.',
      inputs: ['normalizedLeadRows'],
      outputs: ['uniqueLeadRows'],
      guardrails: ['Never drop evidence silently.', 'Preserve rejected duplicate reasons.'],
    },
    {
      id: 'evidence',
      title: 'Score evidence and prepare review',
      action: 'Score leads, keep proof trails, and mark every row as review by default.',
      inputs: ['uniqueLeadRows'],
      outputs: ['reviewQueue'],
      guardrails: ['Cap weak evidence.', 'Keep source timestamps and score reasons.'],
    },
    {
      id: 'export',
      title: 'Export review artifacts',
      action: requiresHumanApproval
        ? 'Write review files and draft-only outreach notes; require human approval before any contact.'
        : 'Write review files and draft-only outreach notes; contact automation remains outside this template.',
      inputs: ['reviewQueue'],
      outputs: ['jsonExport', 'csvExport', 'markdownSummary'],
      guardrails: ['Do not send emails.', 'Do not submit forms.', 'Do not mutate CRM/contact status automatically.'],
    },
  ];
}

function buildContactPolicy(requiresHumanApproval: boolean): LeadDiscoveryContactPolicy {
  return {
    mode: 'review_queue_only',
    requiresHumanApproval,
    automaticContactAllowed: false,
    allowedActions: [
      'write_review_queue',
      'write_draft_outreach_copy',
      'export_public_source_evidence',
    ],
    blockedActions: [
      'send_email',
      'submit_contact_form',
      'call_phone_number',
      'bypass_access_control',
      'enrich_private_personal_profiles',
    ],
  };
}

function buildGuardrails(requiresHumanApproval: boolean): string[] {
  const guardrails = [
    'Use public B2B sources or user-provided datasets only.',
    'Do not bypass captcha, login walls, paywalls, anti-bot checks, robots/rate-limit signals, or access controls.',
    'Keep source_url, observed_at, page title, and evidence snippet for every exported value.',
    'Store snippets and structured facts, not raw full-page dumps.',
    'Never contact leads automatically from the workflow.',
  ];

  if (requiresHumanApproval) {
    guardrails.push('Require human approval before any send, call, CRM mutation, or contact-status change.');
  }

  return guardrails;
}

function buildExpectedArtifacts(id: string, exportFormats: string[]): LeadDiscoveryExpectedArtifact[] {
  const root = `lead-discovery/${id}`;
  const artifacts: LeadDiscoveryExpectedArtifact[] = [
    {
      kind: 'script',
      path: `${root}/script/manifest.json`,
      description: 'Generated research-script job manifest with sandbox policy and assertions.',
    },
    {
      kind: 'dataset',
      path: `${root}/normalized-leads.json`,
      description: 'Normalized public lead rows before scoring.',
    },
    {
      kind: 'evidence',
      path: `${root}/evidence.json`,
      description: 'Source URLs, snippets, observed timestamps, and extraction reasons.',
    },
    {
      kind: 'review_queue',
      path: `${root}/review-queue.json`,
      description: 'Human-review queue with scores and status fields.',
    },
    {
      kind: 'summary',
      path: `${root}/summary.md`,
      description: 'Operator summary with counts, blockers, and next recommended action.',
    },
  ];

  if (exportFormats.includes('csv')) {
    artifacts.push({
      kind: 'export',
      path: `${root}/review-queue.csv`,
      description: 'CSV export for spreadsheet review.',
    });
  }
  if (exportFormats.includes('markdown')) {
    artifacts.push({
      kind: 'export',
      path: `${root}/review-queue.md`,
      description: 'Markdown export for human handoff.',
    });
  }

  return artifacts;
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'leads';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
