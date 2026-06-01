/**
 * Tools CLI inspector.
 *
 * Exposes effective Hermes/Fleet tool profile decisions against either the
 * real built-in Code Buddy tool list or an explicit tool subset.
 */

import type { Command } from 'commander';
import {
  buildDispatchToolFilter,
  getDispatchToolPolicy,
  normalizeDispatchProfile,
  previewDispatchToolDecisions,
  type FleetDispatchProfile,
} from '../../fleet/dispatch-profile.js';
import { getBuiltinToolNames } from '../../codebuddy/tools.js';
import {
  buildBrowserOperatorSessionDraft,
  buildInternetScoutPlan,
  renderBrowserOperatorSessionDraft,
  renderInternetScoutPlan,
  type BrowserOperatorMode,
  type InternetScoutIntent,
} from '../../browser-automation/index.js';
import {
  installResearchScriptSkillCandidate,
  listMaterializedResearchScriptSkillCandidatesWithInstallState,
  readMaterializedResearchScriptSkillCandidate,
  readMaterializedResearchScriptSkillCandidateWithInstallState,
  type ResearchScriptSkillCandidate,
  type ResearchScriptSkillCandidateWithInstallState,
  type SkillCandidateDiffPreview,
  type SkillCandidateInstallState,
} from '../../agent/research-script-skill-candidate.js';

interface ToolsProfileOptions {
  json?: boolean;
}

interface ToolsSkillCandidateInspectOptions {
  json?: boolean;
}

interface ToolsSkillCandidateListOptions {
  eligibleOnly?: boolean;
  json?: boolean;
  skillRoot?: string;
}

interface ToolsSkillCandidateInstallOptions {
  approvedBy: string;
  json?: boolean;
  overwrite?: boolean;
}

interface ToolsBrowserOperatorDraftOptions {
  allowLoginPages?: boolean;
  consentGranted?: boolean;
  expectedText?: string;
  generatedAt?: string;
  intent?: string;
  json?: boolean;
  maxPages?: string;
  mode?: string;
  query?: string;
  requiresInteraction?: boolean;
  sessionId?: string;
  sourceUrl?: string;
  tabLabel?: string;
  url?: string;
  grantedBy?: string;
  grantedAt?: string;
}

interface NormalizedToolsProfile {
  profile: FleetDispatchProfile;
  profileId: string;
}

interface ResearchScriptSkillCandidateSummary {
  candidateChecksum?: string;
  candidateDiffPreview?: SkillCandidateDiffPreview;
  eligible: boolean;
  id: string;
  installState?: SkillCandidateInstallState;
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  kind: string;
  reason: string;
  reviewCommands?: string[];
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  title: string;
  toolSequence?: string[];
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function normalizeToolsProfile(profileArg: string): NormalizedToolsProfile {
  const cleaned = profileArg
    .trim()
    .toLowerCase()
    .replace(/^fleet[.:/-]hermes[.:/-]/, '')
    .replace(/^hermes[.:/-]/, '');
  const profile = normalizeDispatchProfile(cleaned);
  return {
    profile,
    profileId: `fleet.hermes.${profile}`,
  };
}

type SkillCandidateSummarySource = ResearchScriptSkillCandidate
  & Partial<ResearchScriptSkillCandidateWithInstallState>;

function summarizeSkillCandidate(candidate: SkillCandidateSummarySource): ResearchScriptSkillCandidateSummary {
  return {
    ...(candidate.candidateChecksum ? { candidateChecksum: candidate.candidateChecksum } : {}),
    ...(candidate.candidateDiffPreview ? { candidateDiffPreview: candidate.candidateDiffPreview } : {}),
    eligible: candidate.eligible,
    id: candidate.id,
    ...(candidate.installState ? { installState: candidate.installState } : {}),
    ...(candidate.installedChecksum ? { installedChecksum: candidate.installedChecksum } : {}),
    ...(typeof candidate.installedIntegrityOk === 'boolean'
      ? { installedIntegrityOk: candidate.installedIntegrityOk }
      : {}),
    ...(candidate.installedPath ? { installedPath: candidate.installedPath } : {}),
    ...(candidate.installedVersion ? { installedVersion: candidate.installedVersion } : {}),
    kind: candidate.kind,
    reason: candidate.reason,
    ...(candidate.reviewCommands ? { reviewCommands: candidate.reviewCommands } : {}),
    skillName: candidate.skillName,
    skillPath: candidate.skillPath,
    sourceJobId: candidate.sourceJobId,
    sourceRunId: candidate.sourceRunId,
    successfulRunCount: candidate.successfulRunCount,
    title: candidate.title,
    toolSequence: candidate.toolSequence,
  };
}

function formatCandidateReviewPath(candidate: ResearchScriptSkillCandidate): string {
  return candidate.skillPath.replace(/\\/g, '/').replace(/\/?SKILL\.md$/i, '/candidate-review.json');
}

function formatCandidateDirectory(candidate: ResearchScriptSkillCandidate): string {
  return candidate.skillPath.replace(/\\/g, '/').replace(/\/?SKILL\.md$/i, '');
}

function normalizeBrowserOperatorMode(value: string | undefined): BrowserOperatorMode {
  const normalized = (value ?? 'isolated').trim().toLowerCase();
  if (normalized === 'isolated' || normalized === 'local') {
    return normalized;
  }

  throw new Error('mode must be one of: isolated, local');
}

function normalizePositiveInteger(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function normalizeInternetScoutIntent(value: string | undefined): InternetScoutIntent | undefined {
  if (!value) {
    return undefined;
  }

  return value as InternetScoutIntent;
}

function printSkillCandidate(candidate: SkillCandidateSummarySource): void {
  console.log(`\n${formatCandidateKind(candidate)} skill candidate: ${candidate.skillName}`);
  console.log(`  Candidate id: ${candidate.id}`);
  if (candidate.sourceRunId) {
    console.log(`  Source run: ${candidate.sourceRunId}`);
  } else {
    console.log(`  Source job: ${candidate.sourceJobId}`);
  }
  console.log(`  Status: ${candidate.eligible ? 'eligible for human approval' : 'not eligible yet'}`);
  if (candidate.installState) {
    console.log(`  Install state: ${candidate.installState}`);
  }
  console.log(`  Successful runs: ${candidate.successfulRunCount}`);
  if (candidate.toolSequence?.length) {
    console.log(`  Tool sequence: ${candidate.toolSequence.join(' -> ')}`);
  }
  console.log(`  Reason: ${candidate.reason}`);
  console.log(`  SKILL.md: ${candidate.skillPath}`);
  console.log(`  Review manifest: ${formatCandidateReviewPath(candidate)}`);
  if (candidate.reviewCommands?.length) {
    console.log('  Review commands:');
    for (const command of candidate.reviewCommands) {
      console.log(`    - ${command}`);
    }
  } else if (candidate.eligible) {
    console.log(`  Install: buddy tools skill-candidate install ${formatCandidateDirectory(candidate)} --approved-by <name>`);
  }
  console.log('');
}

function printSkillCandidateList(candidates: SkillCandidateSummarySource[]): void {
  console.log(`\nReview-gated skill candidates: ${candidates.length}`);
  for (const candidate of candidates) {
    const installState = candidate.installState ? `, ${candidate.installState}` : '';
    console.log(`  - ${candidate.skillName}: ${candidate.eligible ? 'eligible' : 'not eligible'} (${candidate.kind}${installState})`);
    if (candidate.sourceRunId) {
      console.log(`    Source run: ${candidate.sourceRunId}`);
    } else {
      console.log(`    Source job: ${candidate.sourceJobId}`);
    }
    console.log(`    Successful runs: ${candidate.successfulRunCount}`);
    if (candidate.toolSequence?.length) {
      console.log(`    Tool sequence: ${candidate.toolSequence.join(' -> ')}`);
    }
    console.log(`    Path: ${candidate.skillPath}`);
    console.log(`    Reason: ${candidate.reason}`);
  }
  console.log('');
}

function formatCandidateKind(candidate: ResearchScriptSkillCandidate): string {
  return candidate.kind === 'learning' ? 'Learning Agent' : 'Research script';
}

export function registerToolsCommands(program: Command): void {
  const tools = program
    .command('tools')
    .description('Inspect tool profiles and effective tool availability');

  tools
    .command('profile')
    .description('Inspect a Hermes/Fleet tool profile against real or provided tools')
    .argument('[profile]', 'profile id such as hermes-safe, fleet.hermes.review, or code', 'hermes-balanced')
    .argument('[toolNames...]', 'optional tool names to inspect instead of the built-in list')
    .option('--json', 'output JSON')
    .action((profileArg: string, toolNames: string[], options: ToolsProfileOptions) => {
      const normalized = normalizeToolsProfile(profileArg);
      const inspectedTools = toolNames.length > 0 ? toolNames : getBuiltinToolNames();
      const policy = getDispatchToolPolicy(normalized.profile);
      const decisions = previewDispatchToolDecisions(normalized.profile, inspectedTools);
      const filter = buildDispatchToolFilter(normalized.profile, inspectedTools);

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          profile: normalized.profile,
          profileId: normalized.profileId,
          toolCount: inspectedTools.length,
          policy,
          filter,
          decisions,
        }, null, 2));
        return;
      }

      console.log(`\nTool profile: ${normalized.profileId}`);
      if (profileArg !== normalized.profile && profileArg !== normalized.profileId) {
        console.log(`  Requested: ${profileArg} (normalized to ${normalized.profile})`);
      }
      console.log(`  Policy: ${policy.policyProfile} / ${policy.defaultAction}`);
      console.log(`  Summary: ${policy.summary}`);
      console.log(`  Inspected tools: ${inspectedTools.length}`);
      console.log(`  Effective allow: ${formatList(filter.enabledPatterns)}`);
      console.log(`  Effective deny: ${formatList(filter.disabledPatterns)}`);
      console.log('\nTool decisions:\n');
      for (const decision of decisions) {
        console.log(`  ${decision.tool}: ${decision.action}`);
        console.log(`    Groups: ${formatList(decision.groups)}`);
        if (decision.matchedGroup) {
          console.log(`    Matched group: ${decision.matchedGroup}`);
        }
        console.log(`    Reason: ${decision.reason}`);
      }
      console.log('');
    });

  const browserOperator = tools
    .command('browser-operator')
    .description('Preview Browser Operator session contracts without starting a browser');

  browserOperator
    .command('draft')
    .description('Build a Manus-style Browser Operator draft from an Internet Scout goal')
    .argument('<goal>', 'operator goal to inspect before browsing')
    .option('--url <url>', 'known source URL to inspect')
    .option('--source-url <url>', 'known source URL to inspect')
    .option('--query <query>', 'search or extraction query')
    .option('--intent <intent>', 'Internet Scout intent')
    .option('--requires-interaction', 'mark the flow as needing browser interaction')
    .option('--expected-text <text>', 'text that must be asserted on the page')
    .option('--max-pages <count>', 'maximum pages to inspect')
    .option('--allow-login-pages', 'include login/authenticated pages in the stop/consent posture')
    .option('--mode <mode>', 'browser operator mode: isolated or local', 'isolated')
    .option('--consent-granted', 'mark required consent as already granted in the draft')
    .option('--granted-by <name>', 'operator name for granted consent metadata')
    .option('--granted-at <iso>', 'timestamp for granted consent metadata')
    .option('--session-id <id>', 'stable session id to use in the draft')
    .option('--generated-at <iso>', 'stable generation timestamp')
    .option('--tab-label <label>', 'dedicated tab label')
    .option('--json', 'output JSON')
    .action((goal: string, options: ToolsBrowserOperatorDraftOptions) => {
      const plan = buildInternetScoutPlan({
        goal,
        query: options.query,
        sourceUrl: options.sourceUrl ?? options.url,
        intent: normalizeInternetScoutIntent(options.intent),
        requiresInteraction: options.requiresInteraction,
        expectedText: options.expectedText,
        persistWhenProven: false,
        maxPages: normalizePositiveInteger(options.maxPages, 'maxPages'),
        allowLoginPages: options.allowLoginPages,
      });
      const draft = buildBrowserOperatorSessionDraft(plan, {
        mode: normalizeBrowserOperatorMode(options.mode),
        consentGranted: options.consentGranted,
        dedicatedTabLabel: options.tabLabel,
        generatedAt: options.generatedAt,
        grantedAt: options.grantedAt,
        grantedBy: options.grantedBy,
        sessionId: options.sessionId,
      });

      if (options.json) {
        console.log(JSON.stringify({
          plan,
          draft,
        }, null, 2));
        return;
      }

      console.log('');
      console.log(renderBrowserOperatorSessionDraft(draft));
      console.log('');
      console.log('## Source Plan');
      console.log(renderInternetScoutPlan(plan));
      console.log('');
    });

  const skillCandidate = tools
    .command('skill-candidate')
    .description('Inspect and install reviewed SKILL.md candidates');

  skillCandidate
    .command('list')
    .description('List materialized SKILL.md candidates awaiting review')
    .option('--eligible-only', 'show only candidates with an install or overwrite review action')
    .option('--skill-root <path>', 'candidate root to scan', '.codebuddy/skill-candidates')
    .option('--json', 'output JSON')
    .action(async (options: ToolsSkillCandidateListOptions) => {
      const allCandidates = await listMaterializedResearchScriptSkillCandidatesWithInstallState({
        rootDir: process.cwd(),
        skillRoot: options.skillRoot,
      });
      const candidates = options.eligibleOnly
        ? allCandidates.filter(isInstallReviewableSkillCandidate)
        : allCandidates;

      if (options.json) {
        console.log(JSON.stringify({
          candidates: candidates.map(summarizeSkillCandidate),
          count: candidates.length,
        }, null, 2));
        return;
      }

      printSkillCandidateList(candidates);
    });

  skillCandidate
    .command('inspect')
    .description('Inspect a materialized SKILL.md candidate')
    .argument('<candidatePath>', 'path to the candidate SKILL.md file or candidate directory')
    .option('--json', 'output JSON')
    .action(async (candidatePath: string, options: ToolsSkillCandidateInspectOptions) => {
      const candidate = await readMaterializedResearchScriptSkillCandidateWithInstallState(candidatePath, {
        rootDir: process.cwd(),
      });

      if (options.json) {
        console.log(JSON.stringify({
          candidate: summarizeSkillCandidate(candidate),
          reviewManifestPath: formatCandidateReviewPath(candidate),
        }, null, 2));
        return;
      }

      printSkillCandidate(candidate);
    });

  skillCandidate
    .command('install')
    .description('Install an approved SKILL.md candidate as a workspace skill')
    .argument('<candidatePath>', 'path to the candidate SKILL.md file or candidate directory')
    .requiredOption('--approved-by <name>', 'human reviewer approving this workspace skill install')
    .option('--overwrite', 'replace an existing workspace skill with the same name')
    .option('--json', 'output JSON')
    .action(async (candidatePath: string, options: ToolsSkillCandidateInstallOptions) => {
      const candidate = await readMaterializedResearchScriptSkillCandidate(candidatePath, {
        rootDir: process.cwd(),
      });
      const installed = await installResearchScriptSkillCandidate(candidate, {
        approvedBy: options.approvedBy,
        overwrite: options.overwrite,
        rootDir: process.cwd(),
      });

      if (options.json) {
        console.log(JSON.stringify({
          candidate: summarizeSkillCandidate(candidate),
          installed,
        }, null, 2));
        return;
      }

      console.log(`\nInstalled reviewed skill: ${installed.skillName}`);
      console.log(`  Candidate id: ${installed.candidateId}`);
      console.log(`  Approved by: ${installed.approvedBy}`);
      console.log(`  Approved at: ${installed.approvedAt}`);
      console.log(`  Source candidate: ${installed.sourceCandidatePath}`);
      console.log(`  Workspace skill: ${installed.installedPath}`);
      console.log('');
    });
}

function isInstallReviewableSkillCandidate(candidate: ResearchScriptSkillCandidateWithInstallState): boolean {
  return candidate.eligible && candidate.reviewCommands.some((command) => command.includes('candidate_install'));
}
