import { loadCoreModule } from '../utils/core-loader';

type FleetDispatchProfile = 'balanced' | 'research' | 'code' | 'review' | 'safe';
type PolicyAction = 'allow' | 'confirm' | 'deny';

interface FleetDispatchProfileGuidance {
  label: string;
  policySummary: string;
  profile: FleetDispatchProfile;
  useWhen: string;
}

interface FleetDispatchToolDecision {
  action: PolicyAction;
  groups: string[];
  matchedGroup?: string;
  reason: string;
  source: string;
  tool: string;
}

export interface FleetHermesToolsetReview {
  allowGroups: string[];
  allowedTools: string[];
  confirmGroups: string[];
  confirmTools: string[];
  decisions: FleetDispatchToolDecision[];
  defaultAction: PolicyAction;
  deniedTools: string[];
  denyGroups: string[];
  intent: string;
  label: string;
  policyProfile: string;
  profile: FleetDispatchProfile;
  summary: string;
  systemPrompt: string;
  toolsetId: string;
}

export interface HermesToolsetsCatalogReview {
  activeProfile: FleetDispatchProfile;
  activeToolset: FleetHermesToolsetReview;
  command: string;
  generatedAt: string;
  guidance: FleetDispatchProfileGuidance[];
  kind: 'hermes_toolsets_catalog';
  notes: string[];
  officialSource: {
    inspectedCommit: string;
    repository: string;
    sourceFiles: string[];
  };
  previewTools: string[];
  requestedProfile: string;
  schemaVersion: 1;
  summary: {
    profiles: FleetDispatchProfile[];
    totalToolsets: number;
  };
  toolsets: FleetHermesToolsetReview[];
}

interface HermesDispatchProfileModule {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS: readonly string[];
  FLEET_DISPATCH_PROFILES: readonly FleetDispatchProfile[];
  FLEET_DISPATCH_PROFILE_GUIDANCE?: Record<FleetDispatchProfile, FleetDispatchProfileGuidance>;
  buildHermesToolsetDescriptor: (
    profile: FleetDispatchProfile,
    tools?: readonly string[]
  ) => FleetHermesToolsetReview;
  normalizeDispatchProfile: (value: unknown) => FleetDispatchProfile;
}

export function buildHermesToolsetsCommand(profile: FleetDispatchProfile): string {
  return `buddy hermes toolsets ${profile} --json`;
}

export async function getHermesToolsetsForReview(
  profileArg: string = 'balanced'
): Promise<HermesToolsetsCatalogReview | null> {
  const mod = await loadCoreModule<HermesDispatchProfileModule>('fleet/dispatch-profile.js');
  if (!mod?.buildHermesToolsetDescriptor || !mod.normalizeDispatchProfile) return null;

  const activeProfile = mod.normalizeDispatchProfile(profileArg);
  const previewTools = [...(mod.DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS ?? [])];
  const profiles = [...(mod.FLEET_DISPATCH_PROFILES ?? [activeProfile])];
  const toolsets = profiles.map((profile) =>
    mod.buildHermesToolsetDescriptor(profile, previewTools)
  );

  return {
    activeProfile,
    activeToolset: mod.buildHermesToolsetDescriptor(activeProfile, previewTools),
    command: buildHermesToolsetsCommand(activeProfile),
    generatedAt: new Date().toISOString(),
    guidance: profiles
      .map((profile) => mod.FLEET_DISPATCH_PROFILE_GUIDANCE?.[profile])
      .filter((guidance): guidance is FleetDispatchProfileGuidance => Boolean(guidance)),
    kind: 'hermes_toolsets_catalog',
    notes: [
      'This is the Code Buddy native Fleet/Hermes toolset mapping, not the upstream Python runtime.',
      'Decisions are policy previews for representative tools; model-facing schemas are filtered again at runtime.',
    ],
    officialSource: {
      inspectedCommit: '5921d667',
      repository: 'https://github.com/NousResearch/hermes-agent',
      sourceFiles: ['toolsets.py::TOOLSETS', 'toolsets.py::_HERMES_CORE_TOOLS'],
    },
    previewTools,
    requestedProfile: profileArg,
    schemaVersion: 1,
    summary: {
      profiles,
      totalToolsets: toolsets.length,
    },
    toolsets,
  };
}
