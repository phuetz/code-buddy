export interface AutonomyMorningBriefArtifact {
  kind: 'codebuddy_autonomy_morning_brief';
  schemaVersion: 1;
  briefingDate: string;
  generatedAt: string;
  window: { from: string; to: string };
  sourceDir: string;
  ledgerPath: string;
  summary: {
    observedTicks: number;
    completed: number;
    failed: number;
    selfImproved: number;
    maintenanceChecks: number;
    goalContinuations: number;
    paidModelRuns: number;
    worklogEntries: number;
  };
  queue: {
    total: number;
    open: number;
    inProgress: number;
    completed: number;
    blocked: number;
    criticalAwaitingOperator: number;
  };
  notableEvents: Array<{
    schemaVersion: 1;
    at: string;
    briefingDate: string;
    tickNumber: number;
    outcome: string;
    taskId?: string;
    taskTitle?: string;
    detail?: string;
    model?: { tier: string; model: string; paid: boolean };
  }>;
  worklog: Array<{
    id: string;
    date: string;
    agent: string;
    taskId?: string | null;
    summary: string;
    filesModified: Array<{ file: string; changes: string }>;
    issues: string[];
    nextSteps: string[];
    elapsedSeconds?: number;
  }>;
  opportunities: Array<{
    kind: string;
    title: string;
    reason: string;
    evidence: string;
    taskId?: string;
    safeNextStep: string;
  }>;
  guardrails: string[];
}

/**
 * Read-only envelope exposed to Cowork for the autonomy daemon's latest
 * evidence-backed morning briefing. Paths stay main-process-discovered: the
 * renderer never supplies an arbitrary file to read.
 */
export interface OsAutonomyBriefingPayload {
  brief: AutonomyMorningBriefArtifact;
  jsonPath: string;
  markdownPath: string;
}
