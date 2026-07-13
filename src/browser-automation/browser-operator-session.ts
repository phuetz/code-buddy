import type {
  InternetScoutPlan,
  InternetScoutStep,
  InternetScoutStepStage,
} from './internet-scout-plan.js';

export type BrowserOperatorMode = 'isolated' | 'local';
export type BrowserOperatorActionStatus = 'planned' | 'running' | 'completed' | 'blocked' | 'stopped';
export type BrowserOperatorConsentScope =
  | 'local_browser'
  | 'authenticated_tabs'
  | 'browser_interaction'
  | 'public_web_read';

export interface BrowserOperatorConsentState {
  required: boolean;
  granted: boolean;
  scopes: BrowserOperatorConsentScope[];
  reason: string;
  grantedBy?: string;
  grantedAt?: string;
}

export interface BrowserOperatorActionLogEntry {
  id: string;
  sequence: number;
  status: BrowserOperatorActionStatus;
  tool: string;
  action?: string;
  stage: InternetScoutStepStage;
  title: string;
  evidence: string;
  requiresConsent: boolean;
  expectedArtifact: string;
  reason: string;
  inputs?: Record<string, any>;
}

export interface BrowserOperatorSessionDraft {
  schemaVersion: 1;
  sessionId: string;
  generatedAt: string;
  goal: string;
  query: string;
  sourceUrl?: string;
  mode: BrowserOperatorMode;
  intent: InternetScoutPlan['intent'];
  dedicatedTab: {
    label: string;
    reason: string;
  };
  consent: BrowserOperatorConsentState;
  stopControl: {
    enabled: true;
    label: string;
    stopConditions: string[];
  };
  actionLog: BrowserOperatorActionLogEntry[];
  proofExport: {
    artifactName: string;
    includes: string[];
  };
}

export interface BrowserOperatorSessionOptions {
  mode?: BrowserOperatorMode;
  generatedAt?: string;
  sessionId?: string;
  consentGranted?: boolean;
  grantedBy?: string;
  grantedAt?: string;
  dedicatedTabLabel?: string;
}

export function buildBrowserOperatorSessionDraft(
  plan: InternetScoutPlan,
  options: BrowserOperatorSessionOptions = {},
): BrowserOperatorSessionDraft {
  const generatedAt = normalizeText(options.generatedAt) || new Date().toISOString();
  const mode = options.mode ?? 'isolated';
  const sessionId = normalizeText(options.sessionId) || buildSessionId(plan.goal, generatedAt);
  const consentScopes = buildConsentScopes(plan, mode);
  const consentRequired = consentScopes.length > 0;
  const consentGranted = consentRequired ? options.consentGranted === true : false;

  return {
    schemaVersion: 1,
    sessionId,
    generatedAt,
    goal: plan.goal,
    query: plan.query,
    ...(plan.sourceUrl ? { sourceUrl: plan.sourceUrl } : {}),
    mode,
    intent: plan.intent,
    dedicatedTab: {
      label: normalizeText(options.dedicatedTabLabel) || `Browser Operator - ${truncate(plan.goal, 48)}`,
      reason: mode === 'local'
        ? 'Open a visible browser owned by Code Buddy with a persistent dedicated profile. Sign-ins made in this profile can be reused, but existing personal browser tabs are never attached.'
        : 'Use an isolated browser surface (headless) so public web work stays separated from the operator browser.',
    },
    consent: {
      required: consentRequired,
      granted: consentGranted,
      scopes: consentScopes,
      reason: buildConsentReason(plan, mode, consentRequired),
      ...(consentGranted && options.grantedBy ? { grantedBy: options.grantedBy } : {}),
      ...(consentGranted && options.grantedAt ? { grantedAt: options.grantedAt } : {}),
    },
    stopControl: {
      enabled: true,
      label: 'Stop browser operator',
      stopConditions: plan.stopConditions,
    },
    actionLog: plan.steps.map((step, index) => buildActionLogEntry(step, index, consentRequired, mode)),
    proofExport: {
      artifactName: `${sessionId}.browser-operator.json`,
      includes: [
        'operator mode',
        'consent state',
        'action log',
        'source URLs',
        'stop conditions',
        'assertions',
        'evidence snippets',
      ],
    },
  };
}

export function renderBrowserOperatorSessionDraft(draft: BrowserOperatorSessionDraft): string {
  const lines = [
    `# Browser Operator Session: ${draft.goal}`,
    '',
    `Mode: ${draft.mode}`,
    `Consent: ${draft.consent.required ? (draft.consent.granted ? 'granted' : 'required') : 'not required'}`,
    `Tab: ${draft.dedicatedTab.label}`,
    '',
    '## Action Log',
    ...draft.actionLog.map((entry) => {
      const toolAction = entry.action ? `${entry.tool}.${entry.action}` : entry.tool;
      const consent = entry.requiresConsent ? ', consent' : '';
      return `${entry.sequence}. ${entry.title} [${toolAction}, ${entry.status}${consent}] - ${entry.reason}`;
    }),
    '',
    '## Stop Conditions',
    ...draft.stopControl.stopConditions.map((condition) => `- ${condition}`),
    '',
    `Proof export: ${draft.proofExport.artifactName}`,
  ];

  return lines.join('\n');
}

function buildActionLogEntry(
  step: InternetScoutStep,
  index: number,
  consentRequired: boolean,
  mode: BrowserOperatorMode,
): BrowserOperatorActionLogEntry {
  return {
    id: step.id,
    sequence: index + 1,
    status: 'planned',
    tool: step.tool,
    ...(step.action ? { action: step.action } : {}),
    stage: step.stage,
    title: step.title,
    evidence: step.evidence,
    requiresConsent: stepRequiresConsent(step, consentRequired, mode),
    expectedArtifact: expectedArtifactForStep(step),
    reason: step.reason,
    inputs: step.inputs,
  };
}

function buildConsentScopes(
  plan: InternetScoutPlan,
  mode: BrowserOperatorMode,
): BrowserOperatorConsentScope[] {
  const scopes = new Set<BrowserOperatorConsentScope>();

  if (mode === 'local') {
    scopes.add('local_browser');
    scopes.add('public_web_read');
    scopes.add('authenticated_tabs');
  }

  if (plan.allowLoginPages) {
    scopes.add('authenticated_tabs');
  }

  if (plan.steps.some((step) => step.stage === 'interact')) {
    scopes.add('browser_interaction');
  }

  return [...scopes];
}

function buildConsentReason(
  plan: InternetScoutPlan,
  mode: BrowserOperatorMode,
  consentRequired: boolean,
): string {
  if (!consentRequired) {
    return 'Public isolated browsing plan; no local authenticated browser access requested.';
  }

  const reasons: string[] = [];
  if (mode === 'local') {
    reasons.push('local browser access and its persistent authenticated Code Buddy profile');
  }
  if (plan.allowLoginPages) {
    reasons.push('login or authenticated pages may be encountered');
  }
  if (plan.steps.some((step) => step.stage === 'interact')) {
    reasons.push('planned browser interaction');
  }

  return `Explicit operator consent required for ${reasons.join(', ')}.`;
}

function stepRequiresConsent(
  step: InternetScoutStep,
  consentRequired: boolean,
  mode: BrowserOperatorMode,
): boolean {
  if (!consentRequired) {
    return false;
  }

  if (mode === 'local' && (step.tool === 'browser' || step.tool === 'web_fetch' || step.tool === 'web_search')) {
    return true;
  }

  return step.stage === 'interact';
}

function expectedArtifactForStep(step: InternetScoutStep): string {
  switch (step.stage) {
    case 'discover':
      return 'search-candidates.json';
    case 'read':
      return 'static-fetch.txt';
    case 'observe':
      return 'browser-observation.json';
    case 'interact':
      return 'browser-action-log.jsonl';
    case 'extract':
      return 'browser-extract.json';
    case 'context':
      return 'relationship-context.json';
    case 'assert':
      return 'browser-assertion.json';
    case 'persist':
      return 'memory-or-lesson-candidate.md';
  }
}

function buildSessionId(goal: string, generatedAt: string): string {
  const slug = normalizeText(goal)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'browser-session';
  const stamp = generatedAt.replace(/\D/g, '').slice(0, 14);
  return `browser-operator-${slug}-${stamp}`;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
