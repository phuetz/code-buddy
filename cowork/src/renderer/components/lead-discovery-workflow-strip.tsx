import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, FileJson, Route, SearchCheck, ShieldCheck } from 'lucide-react';

type LeadDiscoveryStageId =
  | 'contact-field-extraction'
  | 'dedupe'
  | 'evidence'
  | 'export'
  | 'page-extraction'
  | 'search'
  | 'site-discovery';

interface LeadDiscoveryWorkflowStage {
  id: LeadDiscoveryStageId;
  title: string;
  outputs: string[];
}

interface LeadDiscoveryExpectedArtifact {
  description: string;
  kind: 'dataset' | 'evidence' | 'export' | 'review_queue' | 'script' | 'summary';
  path: string;
}

interface LeadDiscoveryWorkflowTemplate {
  allowedSources: string[];
  contactPolicy: {
    automaticContactAllowed: false;
    mode: 'review_queue_only';
  };
  expectedArtifacts: LeadDiscoveryExpectedArtifact[];
  goal: string;
  guardrails: string[];
  id: string;
  maxProspects: number;
  offer: string;
  publicDataOnly: true;
  scriptJobArtifact: {
    files: {
      manifest: string;
      script: string;
    };
  };
  stages: LeadDiscoveryWorkflowStage[];
  targetLabel: string;
  title: string;
  zone: string;
}

export interface LeadDiscoveryWorkflowScheduleMetadata {
  [key: string]: unknown;
  leadDiscoveryArtifactCount: number;
  leadDiscoveryContactPolicy: string;
  leadDiscoveryPublicDataOnly: boolean;
  leadDiscoveryScriptManifest: string;
  leadDiscoveryStageCount: number;
  leadDiscoveryWorkflowId: string;
  leadDiscoveryWorkflowSurface: 'cowork';
}

export function buildLeadDiscoveryWorkflowGoal(template: LeadDiscoveryWorkflowTemplate): string {
  const lines = [
    'Run this public-data Lead Scout workflow from Cowork.',
    `Workflow: ${template.title}`,
    `Target: ${template.targetLabel}`,
    `Zone: ${template.zone}`,
    `Offer: ${template.offer}`,
    `Max prospects: ${template.maxProspects}`,
    `Public data only: ${template.publicDataOnly ? 'yes' : 'no'}`,
    `Contact policy: ${template.contactPolicy.mode}`,
    `Automatic contact allowed: ${template.contactPolicy.automaticContactAllowed ? 'yes' : 'no'}`,
    '',
    'Allowed sources:',
    ...template.allowedSources.map((source) => `- ${source}`),
    '',
    'Stages:',
    ...template.stages.map(
      (stage) => `- ${stage.title} [${stage.id}] -> ${stage.outputs.join(', ')}`
    ),
    '',
    'Expected artifacts:',
    ...template.expectedArtifacts.map(
      (artifact) => `- ${artifact.kind}: ${artifact.path} (${artifact.description})`
    ),
    '',
    'Guardrails:',
    ...template.guardrails.map((guardrail) => `- ${guardrail}`),
    '',
    `Script job manifest: ${template.scriptJobArtifact.files.manifest}`,
    'Execute only public-data discovery and prepare review artifacts. Do not send emails, submit forms, or contact leads.',
  ];

  return lines.join('\n');
}

export function buildLeadDiscoveryWorkflowMetadata(
  template: LeadDiscoveryWorkflowTemplate
): LeadDiscoveryWorkflowScheduleMetadata {
  return {
    leadDiscoveryWorkflowId: template.id,
    leadDiscoveryWorkflowSurface: 'cowork',
    leadDiscoveryPublicDataOnly: template.publicDataOnly,
    leadDiscoveryContactPolicy: template.contactPolicy.mode,
    leadDiscoveryStageCount: template.stages.length,
    leadDiscoveryArtifactCount: template.expectedArtifacts.length,
    leadDiscoveryScriptManifest: template.scriptJobArtifact.files.manifest,
  };
}

export const LeadDiscoveryWorkflowStrip: React.FC<{
  goal?: string;
  maxProspects?: number;
  offer?: string;
  onScheduleGoal?: (goal: string, metadata: LeadDiscoveryWorkflowScheduleMetadata) => void;
  onUseAsGoal?: (goal: string) => void;
  targetLabel?: string;
  zone?: string;
}> = ({
  goal,
  maxProspects = 50,
  offer = 'offre B2B a qualifier',
  onScheduleGoal,
  onUseAsGoal,
  targetLabel = 'prospects B2B',
  zone = 'zone non precisee',
}) => {
  const { t } = useTranslation();
  const template = useMemo(
    () =>
      buildLeadDiscoveryPreviewTemplate({
        goal: normalizeGoal(goal),
        maxProspects,
        offer,
        targetLabel,
        zone,
      }),
    [goal, maxProspects, offer, targetLabel, zone]
  );
  const visibleStages = template.stages.slice(0, 4);
  const goalDraft = useMemo(() => buildLeadDiscoveryWorkflowGoal(template), [template]);
  const metadata = useMemo(() => buildLeadDiscoveryWorkflowMetadata(template), [template]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-lead-discovery-workflow"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SearchCheck size={11} className="shrink-0 text-success" />
          <span className="truncate text-[10px] uppercase tracking-wider text-success">
            {t('fleet.leadDiscovery.title', 'Public-data workflow')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
          {template.contactPolicy.mode.replaceAll('_', ' ')}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">
          {t('fleet.leadDiscovery.stagesChip', '{{count}} stages', {
            count: template.stages.length,
          })}
        </span>
        <span className="rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">
          {t('fleet.leadDiscovery.artifactsChip', '{{count}} artifacts', {
            count: template.expectedArtifacts.length,
          })}
        </span>
        <span className="rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">
          {t('fleet.leadDiscovery.reviewChip', 'review queue only')}
        </span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
        <ShieldCheck size={10} className="shrink-0 text-success" />
        <span className="truncate">
          {t('fleet.leadDiscovery.guardrail', 'Public data only; no automatic contact')}
        </span>
      </div>

      <ul className="mt-1.5 space-y-1">
        {visibleStages.map((stage) => (
          <li
            key={stage.id}
            className="flex min-w-0 items-center justify-between gap-2 rounded bg-surface/80 px-2 py-1"
          >
            <span className="truncate text-[10px] text-text-secondary">{stage.title}</span>
            <span className="shrink-0 rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">
              {stage.id}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <FileJson size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{template.scriptJobArtifact.files.script}</code>
      </div>

      {(onUseAsGoal || onScheduleGoal) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {onUseAsGoal && (
            <button
              type="button"
              onClick={() => onUseAsGoal(goalDraft)}
              className="flex items-center gap-1 rounded border border-success/50 px-2 py-1 text-[10px] text-success transition-colors hover:bg-success/10"
            >
              <Route size={10} />
              {t('fleet.leadDiscovery.useAsGoal', 'Use workflow as goal')}
            </button>
          )}
          {onScheduleGoal && (
            <button
              type="button"
              onClick={() => onScheduleGoal(goalDraft, metadata)}
              className="flex items-center gap-1 rounded border border-success/50 px-2 py-1 text-[10px] text-success transition-colors hover:bg-success/10"
            >
              <CalendarPlus size={10} />
              {t('fleet.leadDiscovery.schedule', 'Schedule workflow')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

function normalizeGoal(goal: string | undefined): string {
  const normalized = goal?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : 'Find public B2B leads with sourced evidence and a human-review queue.';
}

function buildLeadDiscoveryPreviewTemplate(input: {
  goal: string;
  maxProspects: number;
  offer: string;
  targetLabel: string;
  zone: string;
}): LeadDiscoveryWorkflowTemplate {
  const id = `lead-discovery-public-${slugify(input.targetLabel)}-${stableHash(
    [input.goal, input.zone, input.offer].join('|')
  )}`;
  const root = `lead-discovery/${id}`;
  const scriptRoot = `research-scripts/${id}-script`;

  return {
    id,
    title: `Public-data lead discovery for ${input.targetLabel}`,
    goal: input.goal,
    targetLabel: input.targetLabel,
    zone: input.zone,
    offer: input.offer,
    maxProspects: input.maxProspects,
    publicDataOnly: true,
    allowedSources: ['web_search', 'public_website'],
    contactPolicy: {
      mode: 'review_queue_only',
      automaticContactAllowed: false,
    },
    stages: [
      {
        id: 'search',
        title: 'Search public candidates',
        outputs: ['candidateSourceUrls'],
      },
      {
        id: 'site-discovery',
        title: 'Discover official sites',
        outputs: ['officialWebsiteCandidates'],
      },
      {
        id: 'page-extraction',
        title: 'Extract public page evidence',
        outputs: ['pageEvidence'],
      },
      {
        id: 'contact-field-extraction',
        title: 'Extract public contact fields',
        outputs: ['normalizedLeadRows'],
      },
      {
        id: 'dedupe',
        title: 'Deduplicate leads',
        outputs: ['uniqueLeadRows'],
      },
      {
        id: 'evidence',
        title: 'Score evidence and prepare review',
        outputs: ['reviewQueue'],
      },
      {
        id: 'export',
        title: 'Export review artifacts',
        outputs: ['jsonExport', 'csvExport', 'markdownSummary'],
      },
    ],
    guardrails: [
      'Use public B2B sources or user-provided datasets only.',
      'Stop on captcha, login walls, paywalls, 403, or 429.',
      'Keep source URL, observed time, page title, and evidence snippet for every exported value.',
      'Never contact leads automatically from the workflow.',
      'Require human approval before any send, call, CRM mutation, or contact-status change.',
    ],
    expectedArtifacts: [
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
      {
        kind: 'export',
        path: `${root}/review-queue.csv`,
        description: 'CSV export for spreadsheet review.',
      },
      {
        kind: 'export',
        path: `${root}/review-queue.md`,
        description: 'Markdown export for human handoff.',
      },
    ],
    scriptJobArtifact: {
      files: {
        manifest: `${scriptRoot}/manifest.json`,
        script: `${scriptRoot}/discover-public-leads.py`,
      },
    },
  };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'leads'
  );
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
