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
}

interface HermesParityFeature extends HermesFeatureParityItem {
  codeBuddyEvidence: string[];
  notes: string;
}

interface HermesParityManifest {
  generatedAt: string;
  officialSource: {
    auditDocument: string;
    inspectedCommit: string;
    latestTagObserved: string;
    repository: string;
  };
  summary: HermesFeatureParitySummary['summary'];
  features: HermesParityFeature[];
}

interface HermesParityManifestModule {
  buildHermesParityManifest: () => HermesParityManifest;
}

const PRIORITY_FEATURE_IDS = [
  'closed-learning-loop',
  'skills',
  'runtime-backends',
  'browser-automation',
  'messaging-gateway',
  'mcp-acp',
  'openclaw-migration',
];

export function buildHermesFeatureParityCommand(): string {
  return 'buddy hermes parity --json';
}

export async function getHermesFeatureParityForReview(): Promise<HermesFeatureParitySummary | null> {
  const mod = await loadCoreModule<HermesParityManifestModule>('agent/hermes-parity-manifest.js');
  if (!mod?.buildHermesParityManifest) return null;

  const manifest = mod.buildHermesParityManifest();
  const needsWork = manifest.features.filter((feature) =>
    feature.status === 'gap' || feature.status === 'partial'
  );
  const topWork = [
    ...PRIORITY_FEATURE_IDS
      .map((id) => needsWork.find((feature) => feature.id === id))
      .filter((feature): feature is HermesParityFeature => Boolean(feature)),
    ...needsWork.filter((feature) => !PRIORITY_FEATURE_IDS.includes(feature.id)),
  ].slice(0, 7);

  return {
    auditDocument: manifest.officialSource.auditDocument,
    command: buildHermesFeatureParityCommand(),
    generatedAt: manifest.generatedAt,
    inspectedCommit: manifest.officialSource.inspectedCommit,
    latestTagObserved: manifest.officialSource.latestTagObserved,
    source: manifest.officialSource.repository,
    summary: manifest.summary,
    topWork: topWork.map((feature) => ({
      area: feature.area,
      id: feature.id,
      nextWork: feature.nextWork,
      officialSurface: feature.officialSurface,
      status: feature.status,
      verificationCommands: feature.verificationCommands.slice(0, 3),
    })),
  };
}
