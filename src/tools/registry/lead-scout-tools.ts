import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import {
  LEAD_SCOUT_EXPORT_FORMATS,
  LEAD_SCOUT_MISSING_FIELDS,
  LEAD_SCOUT_SOURCES,
  LEAD_SCOUT_TARGETS,
  buildLeadScoutEnrichmentPlan,
  buildLeadScoutLessonCandidates,
  buildLeadScoutPlan,
  renderLeadScoutEnrichmentPlan,
  renderLeadScoutLessonCandidates,
  renderLeadScoutRunResult,
  renderLeadScoutPlan,
  runLeadScout,
  type LeadScoutExportFormat,
  type LeadScoutEnrichmentPlanOptions,
  type LeadScoutLessonOptions,
  type LeadScoutMissingField,
  type LeadScoutPlanOptions,
  type LeadScoutRunOptions,
  type LeadScoutSource,
  type LeadScoutTarget,
} from '../../leads/index.js';

const TARGETS: LeadScoutTarget[] = [...LEAD_SCOUT_TARGETS];
const SOURCES: LeadScoutSource[] = [...LEAD_SCOUT_SOURCES];
const EXPORT_FORMATS: LeadScoutExportFormat[] = [...LEAD_SCOUT_EXPORT_FORMATS];
const MISSING_FIELDS: LeadScoutMissingField[] = [...LEAD_SCOUT_MISSING_FIELDS];

export class LeadScoutPlanTool implements ITool {
  readonly name = 'lead_scout_plan';
  readonly description =
    'Build a safe B2B lead-discovery plan that turns a prospecting goal into sources, schema, scoring, script recipe, and human-review gates.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const plan = buildLeadScoutPlan(input as unknown as LeadScoutPlanOptions);
      return {
        success: true,
        output: [
          renderLeadScoutPlan(plan),
          '',
          'Structured result:',
          JSON.stringify(plan, null, 2),
        ].join('\n'),
        data: plan,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Prospecting objective, e.g. find architects near a city for a renovation offer.',
          },
          target: {
            type: 'string',
            enum: TARGETS,
            description: 'Lead category. Use custom with customTarget for another B2B target.',
          },
          customTarget: {
            type: 'string',
            description: 'Custom B2B lead category label when target is custom.',
          },
          zone: {
            type: 'string',
            description: 'Geographic scope such as city, postal code, department, region, or radius text.',
          },
          offer: {
            type: 'string',
            description: 'Offer or service to qualify leads against.',
          },
          maxProspects: {
            type: 'number',
            minimum: 1,
            maximum: 500,
            description: 'Maximum lead budget for review. Defaults to 50.',
          },
          sources: {
            type: 'array',
            items: { type: 'string', enum: SOURCES },
            description: 'Optional source strategy. Defaults depend on target.',
          },
          exportFormats: {
            type: 'array',
            items: { type: 'string', enum: EXPORT_FORMATS },
            description: 'Desired review output formats. Defaults to csv and json.',
          },
          localDatasetPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Existing CSV/JSON lead datasets to import before web discovery.',
          },
          requireHumanApprovalBeforeContact: {
            type: 'boolean',
            description: 'Whether a human must approve source evidence and outreach before contact. Defaults true.',
          },
        },
        required: ['goal'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (typeof data.goal !== 'string' || data.goal.trim() === '') {
      return { valid: false, errors: ['goal must be a non-empty string'] };
    }

    if (data.target !== undefined && !TARGETS.includes(data.target as LeadScoutTarget)) {
      return { valid: false, errors: [`target must be one of: ${TARGETS.join(', ')}`] };
    }

    const numericValidation = validateOptionalNumber(data.maxProspects, 'maxProspects', 1, 500);
    if (!numericValidation.valid) {
      return numericValidation;
    }

    const sourcesValidation = validateOptionalStringArray(data.sources, 'sources', SOURCES);
    if (!sourcesValidation.valid) {
      return sourcesValidation;
    }

    const formatsValidation = validateOptionalStringArray(data.exportFormats, 'exportFormats', EXPORT_FORMATS);
    if (!formatsValidation.valid) {
      return formatsValidation;
    }

    if (data.localDatasetPaths !== undefined && !isStringArray(data.localDatasetPaths)) {
      return { valid: false, errors: ['localDatasetPaths must be an array of strings'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: [
        'lead scout',
        'prospecting',
        'prospect',
        'leads',
        'b2b',
        'architectes',
        'syndics',
        'agences immobilieres',
        'sirene',
        'rnc',
        'osint',
        'public data',
        'script recipe',
        'scoring',
        'email draft',
      ],
      priority: 9,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
      dependencies: ['internet_scout_plan', 'internet_scout_run', 'web_search', 'web_fetch', 'relationship_context'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class LeadScoutRunTool implements ITool {
  readonly name = 'lead_scout_run';
  readonly description =
    'Run a local-first B2B lead discovery pipeline over JSON/CSV datasets: normalize, dedupe, score, draft optional outreach, and optionally export a human review queue.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await runLeadScout(input as unknown as LeadScoutRunOptions);
      return {
        success: result.success,
        output: [
          renderLeadScoutRunResult(result),
          '',
          'Structured result:',
          JSON.stringify(result, null, 2),
        ].join('\n'),
        data: result,
        ...(result.success ? {} : { error: 'Lead Scout Run did not produce a review queue' }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Prospecting objective, e.g. rank architects near a city for a renovation offer.',
          },
          localDatasetPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'JSON or CSV datasets to load. This runner is local-first and does not browse by itself.',
          },
          target: {
            type: 'string',
            enum: TARGETS,
            description: 'Lead category. Use custom with customTarget for another B2B target.',
          },
          customTarget: {
            type: 'string',
            description: 'Custom B2B lead category label when target is custom.',
          },
          zone: {
            type: 'string',
            description: 'Geographic scope such as city, postal code, department, region, or radius text.',
          },
          offer: {
            type: 'string',
            description: 'Offer or service to qualify leads against.',
          },
          maxProspects: {
            type: 'number',
            minimum: 1,
            maximum: 500,
            description: 'Maximum lead budget for review. Defaults to 50.',
          },
          minScore: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Minimum score to keep in the review queue. Defaults to 0.',
          },
          includeOutreachDrafts: {
            type: 'boolean',
            description: 'Include draft-only outreach text. It never sends email. Defaults true.',
          },
          outputFormat: {
            type: 'string',
            enum: EXPORT_FORMATS,
            description: 'Format to write when path is provided. Defaults from path extension.',
          },
          path: {
            type: 'string',
            description: 'Optional output file path (.json, .csv, or .md). Omit to return results without writing.',
          },
          requireHumanApprovalBeforeContact: {
            type: 'boolean',
            description: 'Whether a human must approve source evidence and outreach before contact. Defaults true.',
          },
        },
        required: ['goal', 'localDatasetPaths'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const baseValidation = validateLeadScoutBaseInput(input);
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const data = input as Record<string, unknown>;
    if (!isStringArray(data.localDatasetPaths) || data.localDatasetPaths.length === 0) {
      return { valid: false, errors: ['localDatasetPaths must be a non-empty array of strings'] };
    }

    const minScoreValidation = validateOptionalNumber(data.minScore, 'minScore', 0, 100);
    if (!minScoreValidation.valid) {
      return minScoreValidation;
    }

    if (data.outputFormat !== undefined && !EXPORT_FORMATS.includes(data.outputFormat as LeadScoutExportFormat)) {
      return { valid: false, errors: [`outputFormat must be one of: ${EXPORT_FORMATS.join(', ')}`] };
    }

    if (data.path !== undefined && (typeof data.path !== 'string' || data.path.trim() === '')) {
      return { valid: false, errors: ['path must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: [
        'lead scout',
        'run',
        'prospecting',
        'prospect',
        'leads',
        'b2b',
        'architectes',
        'syndics',
        'agences immobilieres',
        'dataset',
        'json',
        'csv',
        'dedupe',
        'scoring',
        'review queue',
        'email draft',
      ],
      priority: 10,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
      fleetSafe: false,
      dependencies: ['lead_scout_plan'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class LeadScoutEnrichmentPlanTool implements ITool {
  readonly name = 'lead_scout_enrichment_plan';
  readonly description =
    'Plan a multi-hop public B2B enrichment job where a profile page can reveal an official website, and that website can reveal phone/email/contact details, with a protected run_script contract.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const plan = buildLeadScoutEnrichmentPlan(input as unknown as LeadScoutEnrichmentPlanOptions);
      return {
        success: true,
        output: [
          renderLeadScoutEnrichmentPlan(plan),
          '',
          'Structured result:',
          JSON.stringify(plan, null, 2),
        ].join('\n'),
        data: plan,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Enrichment objective, e.g. find architect phones by following official website links.',
          },
          target: {
            type: 'string',
            enum: TARGETS,
            description: 'Lead category. Defaults to custom.',
          },
          sourceUrlField: {
            type: 'string',
            description: 'Field containing the seed profile/directory URL. Defaults to source_url.',
          },
          websiteField: {
            type: 'string',
            description: 'Field containing or receiving the official website URL. Defaults to site_web.',
          },
          nameField: {
            type: 'string',
            description: 'Field containing the business/person name. Defaults to nom.',
          },
          missingFields: {
            type: 'array',
            items: { type: 'string', enum: MISSING_FIELDS },
            description: 'Fields to enrich. Defaults to email, telephone, and site_web.',
          },
          maxHops: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: 'Maximum evidence hops from source profile to official site/contact pages. Defaults to 3.',
          },
          pageBudget: {
            type: 'number',
            minimum: 1,
            maximum: 30,
            description: 'Maximum public pages per lead for the generated script. Defaults to 8.',
          },
          delayMs: {
            type: 'number',
            minimum: 250,
            maximum: 10000,
            description: 'Delay between requests in the generated script. Defaults to 1500ms.',
          },
          allowedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional domain allowlist. Empty means public web except ignored domains.',
          },
          ignoredDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional domains to treat as generic portals or off-limits.',
          },
          allowGeneratedScript: {
            type: 'boolean',
            description: 'Include the generated Python script in the output. Defaults true.',
          },
        },
        required: ['goal'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (typeof data.goal !== 'string' || data.goal.trim() === '') {
      return { valid: false, errors: ['goal must be a non-empty string'] };
    }

    if (data.target !== undefined && !TARGETS.includes(data.target as LeadScoutTarget)) {
      return { valid: false, errors: [`target must be one of: ${TARGETS.join(', ')}`] };
    }

    const fieldsValidation = validateOptionalStringArray(data.missingFields, 'missingFields', MISSING_FIELDS);
    if (!fieldsValidation.valid) {
      return fieldsValidation;
    }

    for (const [field, min, max] of [
      ['maxHops', 1, 5],
      ['pageBudget', 1, 30],
      ['delayMs', 250, 10000],
    ] as const) {
      const validation = validateOptionalNumber(data[field], field, min, max);
      if (!validation.valid) {
        return validation;
      }
    }

    if (data.allowedDomains !== undefined && !isStringArray(data.allowedDomains)) {
      return { valid: false, errors: ['allowedDomains must be an array of strings'] };
    }

    if (data.ignoredDomains !== undefined && !isStringArray(data.ignoredDomains)) {
      return { valid: false, errors: ['ignoredDomains must be an array of strings'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: [
        'lead scout',
        'enrichment',
        'multi-hop',
        'script generation',
        'sandbox',
        'manus',
        'architectes',
        'website',
        'contact page',
        'phone',
        'email',
        'evidence chain',
      ],
      priority: 10,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
      dependencies: ['lead_scout_run', 'internet_scout_plan', 'run_script'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class LeadScoutLessonCandidatesTool implements ITool {
  readonly name = 'lead_scout_lesson_candidates';
  readonly description =
    'Generate reviewed lesson candidates from Lead Scout runs or sandboxed enrichment scripts so reusable patterns can be persisted with lessons_add after human/agent review.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = buildLeadScoutLessonCandidates(input as unknown as LeadScoutLessonOptions);
      return {
        success: true,
        output: [
          renderLeadScoutLessonCandidates(result),
          '',
          'Structured result:',
          JSON.stringify(result, null, 2),
        ].join('\n'),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Lead Scout task or run goal that produced observations.',
          },
          context: {
            type: 'string',
            description: 'Optional lesson context label, e.g. "Lead Scout architect enrichment".',
          },
          stats: {
            type: 'object',
            description: 'Run stats such as processed, enriched, skipped, blocked, selectedLeads, needsPublicEnrichment, and contact coverage.',
            properties: {
              processed: { type: 'number', description: 'Rows or leads processed.' },
              enriched: { type: 'number', description: 'Rows enriched.' },
              skipped: { type: 'number', description: 'Rows skipped.' },
              blocked: { type: 'number', description: 'Rows blocked by safety/access stops.' },
              selectedLeads: { type: 'number', description: 'Leads selected in review queue.' },
              needsPublicEnrichment: { type: 'number', description: 'Selected leads with no email, phone, or website.' },
              leadsWithEmail: { type: 'number', description: 'Selected leads with email.' },
              leadsWithPhone: { type: 'number', description: 'Selected leads with phone.' },
              leadsWithWebsite: { type: 'number', description: 'Selected leads with website.' },
            },
          },
          warnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Warnings from a Lead Scout run.',
          },
          blockers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Safety or access blockers observed, such as captcha, login, 403, 429.',
          },
          successfulPatterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Patterns that worked and may be reusable.',
          },
          failedPatterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Patterns that failed and should not be retried blindly.',
          },
          contactPathsThatWorked: {
            type: 'array',
            items: { type: 'string' },
            description: 'Same-domain contact paths that yielded public contact data.',
          },
          domainsToIgnore: {
            type: 'array',
            items: { type: 'string' },
            description: 'Generic or non-official domains to ignore in future enrichment.',
          },
          scriptChanges: {
            type: 'array',
            items: { type: 'string' },
            description: 'Potential generated-script improvements observed during the run.',
          },
        },
        required: ['goal'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (typeof data.goal !== 'string' || data.goal.trim() === '') {
      return { valid: false, errors: ['goal must be a non-empty string'] };
    }

    for (const field of [
      'warnings',
      'blockers',
      'successfulPatterns',
      'failedPatterns',
      'contactPathsThatWorked',
      'domainsToIgnore',
      'scriptChanges',
    ]) {
      if (data[field] !== undefined && !isStringArray(data[field])) {
        return { valid: false, errors: [`${field} must be an array of strings`] };
      }
    }

    if (data.stats !== undefined && (typeof data.stats !== 'object' || data.stats === null || Array.isArray(data.stats))) {
      return { valid: false, errors: ['stats must be an object'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: [
        'lead scout',
        'lessons',
        'learning',
        'self improvement',
        'script feedback',
        'sandbox logs',
        'patterns',
        'enrichment',
      ],
      priority: 9,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
      dependencies: ['lessons_add'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createLeadScoutTools(): ITool[] {
  return [
    new LeadScoutPlanTool(),
    new LeadScoutRunTool(),
    new LeadScoutEnrichmentPlanTool(),
    new LeadScoutLessonCandidatesTool(),
  ];
}

function validateLeadScoutBaseInput(input: unknown): IValidationResult {
  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['Input must be an object'] };
  }

  const data = input as Record<string, unknown>;
  if (typeof data.goal !== 'string' || data.goal.trim() === '') {
    return { valid: false, errors: ['goal must be a non-empty string'] };
  }

  if (data.target !== undefined && !TARGETS.includes(data.target as LeadScoutTarget)) {
    return { valid: false, errors: [`target must be one of: ${TARGETS.join(', ')}`] };
  }

  const numericValidation = validateOptionalNumber(data.maxProspects, 'maxProspects', 1, 500);
  if (!numericValidation.valid) {
    return numericValidation;
  }

  return { valid: true };
}

function validateOptionalNumber(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): IValidationResult {
  if (value === undefined) {
    return { valid: true };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { valid: false, errors: [`${fieldName} must be a finite number`] };
  }
  if (value < min || value > max) {
    return { valid: false, errors: [`${fieldName} must be between ${min} and ${max}`] };
  }
  return { valid: true };
}

function validateOptionalStringArray(
  value: unknown,
  fieldName: string,
  allowedValues: string[],
): IValidationResult {
  if (value === undefined) {
    return { valid: true };
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return { valid: false, errors: [`${fieldName} must be an array of strings`] };
  }
  const invalidValues = value.filter((item) => !allowedValues.includes(item));
  if (invalidValues.length > 0) {
    return { valid: false, errors: [`${fieldName} must contain only: ${allowedValues.join(', ')}`] };
  }
  return { valid: true };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
