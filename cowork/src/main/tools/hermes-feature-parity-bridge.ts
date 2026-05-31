import { loadCoreModule } from '../utils/core-loader';

export type HermesFeatureParityStatus = 'covered' | 'covered-partial' | 'partial' | 'gap';

export interface HermesFeatureParityItem {
  area: string;
  id: string;
  nextWork?: string;
  officialSurface: string;
  status: HermesFeatureParityStatus;
  verificationCommands: string[];
}

export interface HermesFeatureParitySummary {
  auditDocument: string;
  command: string;
  deferredWork: HermesFeatureParityItem[];
  generatedAt: string;
  inspectedCommit: string;
  latestTagObserved: string;
  source: string;
  summary: {
    covered: number;
    coveredPartial: number;
    gaps: number;
    partial: number;
    total: number;
  };
  topWork: HermesFeatureParityItem[];
  todoCommand: string;
}

interface HermesParityManifest {
  features?: HermesParityFeature[];
  generatedAt: string;
  officialSource: {
    auditDocument: string;
    inspectedCommit: string;
    latestTagObserved: string;
    repository: string;
  };
  summary: HermesFeatureParitySummary['summary'];
}

interface HermesParityFeature extends HermesFeatureParityItem {
  codeBuddyEvidence: string[];
  notes: string;
}

interface HermesParityTodoItem {
  area: string;
  id: string;
  nextWork: string;
  officialSurface: string;
  status: Extract<HermesFeatureParityStatus, 'partial' | 'gap'>;
  verificationCommand: string;
}

interface HermesParityManifestModule {
  buildHermesParityManifest: () => HermesParityManifest;
  buildHermesParityTodo?: (options?: { includeDeferred?: boolean; limit?: number }) => {
    deferred?: HermesParityTodoItem[];
    todos?: HermesParityTodoItem[];
  };
}

const FALLBACK_PRIORITY_FEATURE_IDS = [
  'closed-learning-loop',
  'skills',
  'runtime-backends',
  'browser-automation',
  'messaging-gateway',
  'mcp-acp',
  'openclaw-migration',
  'research-trajectories',
];

export function buildHermesFeatureParityCommand(): string {
  return 'buddy hermes parity --json';
}

export function buildHermesFeatureTodoCommand(): string {
  return 'buddy hermes todo --json';
}

function fallbackTopWorkFromManifest(manifest: HermesParityManifest): HermesParityTodoItem[] {
  const needsWork = (manifest.features ?? []).filter(
    (feature): feature is HermesParityFeature & { status: 'partial' | 'gap' } =>
      feature.id !== 'openclaw-migration' && (feature.status === 'gap' || feature.status === 'partial'),
  );
  const priorityIds = new Set(FALLBACK_PRIORITY_FEATURE_IDS);
  return [
    ...FALLBACK_PRIORITY_FEATURE_IDS
      .map((id) => needsWork.find((feature) => feature.id === id))
      .filter((feature): feature is HermesParityFeature & { status: 'partial' | 'gap' } => Boolean(feature)),
    ...needsWork.filter((feature) => !priorityIds.has(feature.id)),
  ].slice(0, 7).map((feature) => ({
    area: feature.area,
    id: feature.id,
    nextWork: feature.nextWork ?? feature.notes,
    officialSurface: feature.officialSurface,
    status: feature.status,
    verificationCommand: feature.verificationCommands[0] ?? 'n/a',
  }));
}

function fallbackDeferredWorkFromManifest(manifest: HermesParityManifest): HermesParityTodoItem[] {
  return (manifest.features ?? [])
    .filter(
      (feature): feature is HermesParityFeature & { status: 'gap' } =>
        feature.id === 'openclaw-migration' && feature.status === 'gap',
    )
    .map((feature) => ({
      area: feature.area,
      id: feature.id,
      nextWork: feature.nextWork ?? feature.notes,
      officialSurface: feature.officialSurface,
      status: feature.status,
      verificationCommand: feature.verificationCommands[0] ?? 'n/a',
    }));
}

function toHermesFeatureParityItem(feature: HermesParityTodoItem): HermesFeatureParityItem {
  return {
    area: feature.area,
    id: feature.id,
    nextWork: feature.nextWork,
    officialSurface: feature.officialSurface,
    status: feature.status,
    verificationCommands: [feature.verificationCommand].filter(Boolean).slice(0, 3),
  };
}

export async function getHermesFeatureParityForReview(): Promise<HermesFeatureParitySummary | null> {
  const mod = await loadCoreModule<HermesParityManifestModule>('agent/hermes-parity-manifest.js');
  if (!mod?.buildHermesParityManifest) return null;

  const manifest = mod.buildHermesParityManifest();
  const todo = mod.buildHermesParityTodo?.({ includeDeferred: false, limit: 7 });
  const topWork = todo?.todos ?? fallbackTopWorkFromManifest(manifest);
  const deferredWork = todo?.deferred ?? fallbackDeferredWorkFromManifest(manifest);

  return {
    auditDocument: manifest.officialSource.auditDocument,
    command: buildHermesFeatureParityCommand(),
    deferredWork: deferredWork.map(toHermesFeatureParityItem),
    generatedAt: manifest.generatedAt,
    inspectedCommit: manifest.officialSource.inspectedCommit,
    latestTagObserved: manifest.officialSource.latestTagObserved,
    source: manifest.officialSource.repository,
    summary: manifest.summary,
    topWork: topWork.map(toHermesFeatureParityItem),
    todoCommand: buildHermesFeatureTodoCommand(),
  };
}
