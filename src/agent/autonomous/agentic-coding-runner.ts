import { exec, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  assessAgenticCodingExecutionGate,
  validateAgenticCodingApprovalDecision,
  validateAgenticCodingEditProposal,
  validateAgenticCodingTaskContract,
  validateAgenticCodingWorkflowBuilderProposal,
  type AgenticCodingApprovalDecision,
  type AgenticCodingEditProposal,
  type AgenticCodingExecutionGate,
  type AgenticCodingTaskContract,
  type AgenticCodingWorkflowBuilderProposal,
} from './agentic-coding-contract.js';
import { validateCommand } from '../../utils/input-validation/command-validator.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export type AgenticCodingRunStatus =
  | 'validation_failed'
  | 'blocked'
  | 'ready'
  | 'previewed'
  | 'edited'
  | 'verified'
  | 'verification_failed';

export interface AgenticCodingRunOptions {
  applyEdits?: boolean;
  approvalDecisionFile?: string;
  editProposalFile?: string;
  generatedAt?: string;
  previewEdits?: boolean;
  requireApproval?: boolean;
  requirePreview?: boolean;
  runVerification?: boolean;
  taskFile: string;
  verificationTimeoutMs?: number;
  workflowBuilderProposalFile?: string;
}

export interface AgenticCodingRulesFile {
  path: string;
  present: boolean;
}

export interface AgenticCodingDirtyFile {
  path: string;
  status: string;
  allowed: boolean;
}

export interface AgenticCodingVerificationResult {
  command: string;
  exitCode: number;
  status: 'passed' | 'failed' | 'blocked';
  stdout: string;
  stderr: string;
  reason?: string;
}

export interface AgenticCodingEditResult {
  path: string;
  status: 'applied' | 'blocked' | 'failed';
  occurrences: number;
  reason?: string;
}

export interface AgenticCodingEditPreview {
  after: string;
  before: string;
  occurrences: number;
  path: string;
  reason?: string;
  status: 'previewed' | 'blocked' | 'failed';
}

export type AgenticCodingApprovalState =
  | 'not_required'
  | 'draft'
  | 'needs_approval'
  | 'approved'
  | 'rejected';

export interface AgenticCodingApprovalReport {
  reason: string;
  requiredBeforeApply: boolean;
  state: AgenticCodingApprovalState;
}

export interface AgenticCodingApprovalDecisionReport {
  decidedAt?: string;
  decision: AgenticCodingApprovalDecision['decision'];
  file: string;
  reason: string;
  reviewer: string;
}

export interface AgenticCodingApprovalSnapshot {
  decision?: {
    decidedAt?: string;
    decision: AgenticCodingApprovalDecisionReport['decision'];
    file: string;
    reason: string;
    reviewer: string;
  };
  editSummary: {
    applied: number;
    blocked: number;
    declared: number;
    files: string[];
    previewed: number;
    proposal?: {
      file: string;
      producer?: string;
      risks: string[];
      summary: string;
      verificationNotes: string[];
    };
  };
  gateNodeIds: string[];
  generatedAt: string;
  kind: 'agentic-coding-approval-state';
  nextAction: {
    message: string;
    nodeId?: string;
    type: 'none' | 'preview_required' | 'review_preview' | 'inspect_rejection';
  };
  reason: string;
  requiredBeforeApply: boolean;
  schemaVersion: 1;
  source: {
    activeNodeId?: string;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
  state: AgenticCodingApprovalState;
}

export interface AgenticCodingEditProposalReport {
  editCount: number;
  file: string;
  producer?: string;
  risks: string[];
  summary: string;
  verificationNotes: string[];
}

export type AgenticCodingEditProposalReviewState = 'missing' | 'accepted' | 'rejected';

export interface AgenticCodingEditProposalReviewSnapshot {
  editSummary: {
    declared: number;
    files: string[];
    proposal?: AgenticCodingEditProposalReport;
  };
  generatedAt: string;
  kind: 'agentic-coding-edit-proposal-review';
  nextAction: {
    message: string;
    stepId?: string;
    type: 'produce_edit_proposal' | 'fix_edit_proposal' | 'preview_edits';
  };
  reason: string;
  schemaVersion: 1;
  source: {
    proposalFile?: string;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
  state: AgenticCodingEditProposalReviewState;
  validationErrors: string[];
}

export interface AgenticCodingWorkflowBuilderProposalReport {
  approvalGates: string[];
  coworkVisualizationNotes: string[];
  edgeCount: number;
  edges: AgenticCodingWorkflowBuilderProposal['edges'];
  file: string;
  nodeCount: number;
  nodes: AgenticCodingWorkflowBuilderProposal['nodes'];
  risks: string[];
  summary: string;
}

export type AgenticCodingPlanStepStatus = 'completed' | 'ready' | 'blocked' | 'pending' | 'skipped';

export interface AgenticCodingPlanStep {
  id: string;
  title: string;
  status: AgenticCodingPlanStepStatus;
  detail: string;
}

export type AgenticCodingWorkflowNodeType =
  | 'gate'
  | 'analysis'
  | 'approval'
  | 'edit'
  | 'verification'
  | 'handoff';

export interface AgenticCodingWorkflowNode {
  id: string;
  type: AgenticCodingWorkflowNodeType;
  label: string;
  status: AgenticCodingPlanStepStatus;
  detail: string;
}

export interface AgenticCodingWorkflowEdge {
  animated: boolean;
  id: string;
  source: string;
  target: string;
}

export interface AgenticCodingWorkflowNodeError {
  message: string;
  nodeId: string;
}

export interface AgenticCodingWorkflowReport {
  activeNodeId?: string;
  blockedNodeIds: string[];
  completedNodeIds: string[];
  edges: AgenticCodingWorkflowEdge[];
  nodeErrors: AgenticCodingWorkflowNodeError[];
  nodes: AgenticCodingWorkflowNode[];
}

export interface AgenticCodingWorkflowCanvasNode {
  data: {
    agenticType: AgenticCodingWorkflowNodeType;
    description: string;
    errorMessages: string[];
    iconName: string;
    label: string;
    status: AgenticCodingPlanStepStatus;
    type: 'trigger' | 'action' | 'logic';
  };
  id: string;
  position: { x: number; y: number };
  type: 'customNode';
}

export interface AgenticCodingWorkflowCanvasEdge {
  animated: true;
  id: string;
  source: string;
  style: { stroke: string; strokeWidth: number };
  target: string;
}

export interface AgenticCodingWorkflowCanvas {
  activeNodeId?: string;
  blockedNodeIds: string[];
  completedNodeIds: string[];
  edges: AgenticCodingWorkflowCanvasEdge[];
  generatedAt: string;
  kind: 'agentic-coding-workflow-canvas';
  nodeErrors: AgenticCodingWorkflowNodeError[];
  nodes: AgenticCodingWorkflowCanvasNode[];
  schemaVersion: 1;
  source: {
    approvalState: AgenticCodingApprovalState;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export interface AgenticCodingWorkflowBuilderProposalCanvas {
  edges: AgenticCodingWorkflowCanvasEdge[];
  generatedAt: string;
  kind: 'agentic-coding-workflow-builder-proposal-canvas';
  nodes: AgenticCodingWorkflowCanvasNode[];
  schemaVersion: 1;
  source: {
    proposalFile: string;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
  summary: string;
}

export interface AgenticCodingWorkflowProgressSnapshot {
  activeNodeId?: string;
  approvalState: AgenticCodingApprovalState;
  blockedNodeIds: string[];
  completedNodeIds: string[];
  counts: {
    blocked: number;
    completed: number;
    pending: number;
    ready: number;
    skipped: number;
    total: number;
  };
  generatedAt: string;
  kind: 'agentic-coding-workflow-progress';
  nextAction: {
    message: string;
    nodeId?: string;
    type: 'inspect_blocker' | 'approve_preview' | 'continue' | 'complete';
  };
  nodeErrors: AgenticCodingWorkflowNodeError[];
  nodes: Array<{
    errorMessages: string[];
    id: string;
    label: string;
    status: AgenticCodingPlanStepStatus;
    type: AgenticCodingWorkflowNodeType;
  }>;
  schemaVersion: 1;
  source: {
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export type AgenticCodingWorkflowEventSeverity = 'info' | 'success' | 'warning' | 'error';

export interface AgenticCodingWorkflowEvent {
  active: boolean;
  id: string;
  message: string;
  nodeId: string;
  nodeType: AgenticCodingWorkflowNodeType;
  sequence: number;
  severity: AgenticCodingWorkflowEventSeverity;
  status: AgenticCodingPlanStepStatus;
}

export interface AgenticCodingWorkflowEventsSnapshot {
  activeNodeId?: string;
  events: AgenticCodingWorkflowEvent[];
  generatedAt: string;
  kind: 'agentic-coding-workflow-events';
  schemaVersion: 1;
  source: {
    approvalState: AgenticCodingApprovalState;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export type AgenticCodingProposalLoopNextActionType =
  | 'inspect_blocker'
  | 'generate_edit_proposal'
  | 'review_edit_proposal'
  | 'fix_edit_proposal'
  | 'preview_edits'
  | 'review_preview'
  | 'apply_approved_edits'
  | 'run_verification'
  | 'handoff';

export interface AgenticCodingProposalLoopCommand {
  args: string[];
  executable: 'buddy';
}

export interface AgenticCodingProposalLoopStep {
  command?: AgenticCodingProposalLoopCommand;
  id: string;
  inputArtifacts: string[];
  label: string;
  outputArtifacts: string[];
  safety: string[];
  status: AgenticCodingPlanStepStatus;
}

export interface AgenticCodingProposalLoopArtifacts {
  applyReportFile: string;
  approvalDecisionFile: string;
  approvalDecisionPromptFile: string;
  approvalFile: string;
  editProposalFile: string;
  editProposalProducerDispatchFile: string;
  editProposalReviewFile: string;
  previewReportFile: string;
  proposalPromptFile: string;
  workflowEventsFile: string;
  workflowProgressFile: string;
}

export interface AgenticCodingProposalLoopArtifactBundlePaths extends AgenticCodingProposalLoopArtifacts {
  artifactBundleFile: string;
  editProposalRequestFile: string;
  proposalLoopNextActionFile: string;
  proposalLoopCanvasFile: string;
  proposalLoopFile: string;
  seedReportFile: string;
}

export interface AgenticCodingProposalLoopMaterializedArtifact {
  path: string;
  role: string;
  safety: string;
}

export type AgenticCodingProposalLoopCoworkPanelView =
  | 'canvas'
  | 'queue'
  | 'review'
  | 'prompt'
  | 'state'
  | 'timeline'
  | 'evidence'
  | 'manifest';

export interface AgenticCodingProposalLoopCoworkImportPanel {
  artifactPath: string;
  id: string;
  role: string;
  title: string;
  view: AgenticCodingProposalLoopCoworkPanelView;
}

export interface AgenticCodingProposalLoopCoworkImport {
  defaultPanelId: string;
  panels: AgenticCodingProposalLoopCoworkImportPanel[];
  primaryArtifactPath: string;
  queueArtifactPath: string;
  requiredArtifactPaths: string[];
  schemaVersion: 1;
  suggestedFocusPanelId: string;
  summary: string;
}

export type AgenticCodingProposalLoopCoworkImportCheckStatus =
  | 'ready'
  | 'missing_required'
  | 'invalid';

export interface AgenticCodingProposalLoopCoworkImportArtifactCheck {
  exists: boolean;
  path: string;
  resolvedPath: string;
}

export interface AgenticCodingProposalLoopCoworkImportPanelCheck
  extends AgenticCodingProposalLoopCoworkImportPanel {
  exists: boolean;
  required: boolean;
  resolvedArtifactPath: string;
}

export interface AgenticCodingProposalLoopCoworkImportCheck {
  defaultPanelId?: string;
  generatedAt: string;
  kind: 'agentic-coding-proposal-loop-cowork-import-check';
  missingRequiredArtifactPaths: string[];
  panels: AgenticCodingProposalLoopCoworkImportPanelCheck[];
  primaryArtifactPath?: string;
  primaryArtifactExists: boolean;
  queueArtifactExists: boolean;
  requiredArtifacts: AgenticCodingProposalLoopCoworkImportArtifactCheck[];
  resolvedPrimaryArtifactPath?: string;
  schemaVersion: 1;
  source: {
    importFile: string;
    summary?: string;
  };
  status: AgenticCodingProposalLoopCoworkImportCheckStatus;
  suggestedFocusPanelId?: string;
  validationErrors: string[];
}

export type AgenticCodingProposalLoopCoworkWorkspaceStatus =
  | 'ready'
  | 'needs_artifacts'
  | 'invalid';

export type AgenticCodingProposalLoopCoworkWorkspaceActionType =
  | 'open_panel'
  | 'resolve_missing'
  | 'fix_import';

export interface AgenticCodingProposalLoopCoworkWorkspace {
  activity?: {
    activeEventId?: string;
    activeNodeId?: string;
    artifactPath: string;
    counts: {
      error: number;
      info: number;
      success: number;
      total: number;
      warning: number;
    };
    events: Array<{
      active: boolean;
      id: string;
      message: string;
      nodeId: string;
      nodeType: AgenticCodingWorkflowNodeType;
      sequence: number;
      severity: AgenticCodingWorkflowEventSeverity;
      status: AgenticCodingPlanStepStatus;
    }>;
    exists: boolean;
    resolvedArtifactPath: string;
    validationErrors: string[];
  };
  approval?: {
    affectedFiles: string[];
    artifactPath: string;
    editSummary?: {
      applied: number;
      blocked: number;
      declared: number;
      previewed: number;
    };
    exists: boolean;
    gateNodeIds: string[];
    nextAction?: AgenticCodingApprovalSnapshot['nextAction'];
    reason?: string;
    requiredBeforeApply?: boolean;
    resolvedArtifactPath: string;
    sourceActiveNodeId?: string;
    state?: AgenticCodingApprovalState;
    validationErrors: string[];
  };
  commands?: {
    artifactPath: string;
    commandCount: number;
    commands: Array<{
      canRunNow: boolean;
      command: AgenticCodingProposalLoopCommand;
      commandText: string;
      id: string;
      inputArtifacts: string[];
      label: string;
      outputArtifacts: string[];
      safety: string[];
      status: AgenticCodingPlanStepStatus;
    }>;
    exists: boolean;
    readyCommandCount: number;
    resolvedArtifactPath: string;
    validationErrors: string[];
  };
  evidence?: {
    approvalState?: AgenticCodingApprovalState;
    artifactPath: string;
    autoExecutable?: boolean;
    blockedReasons: string[];
    editSummary: {
      applied: number;
      blocked: number;
      declared: number;
      previewed: number;
    };
    exists: boolean;
    resolvedArtifactPath: string;
    runGeneratedAt?: string;
    status?: AgenticCodingRunStatus;
    validationErrors: string[];
    verificationSummary: {
      blocked: number;
      failed: number;
      passed: number;
      total: number;
    };
    workflow?: {
      activeNodeId?: string;
      blocked: number;
      completed: number;
      total: number;
    };
  };
  graph?: {
    activeNodeId?: string;
    approvalNodeIds: string[];
    artifactPath: string;
    blockedNodeIds: string[];
    edgeCount: number;
    edges: Array<{
      animated: boolean;
      id: string;
      source: string;
      target: string;
    }>;
    exists: boolean;
    nodeCount: number;
    nodes: Array<{
      active: boolean;
      id: string;
      label: string;
      status: AgenticCodingPlanStepStatus;
      type: AgenticCodingWorkflowNodeType;
    }>;
    resolvedArtifactPath: string;
    statusCounts: AgenticCodingProposalLoopSnapshot['counts'];
    validationErrors: string[];
  };
  manifest?: {
    artifactPath: string;
    coworkImport?: {
      defaultPanelId?: string;
      panelCount: number;
      queueArtifactPath?: string;
      requiredArtifactCount: number;
      suggestedFocusPanelId?: string;
    };
    exists: boolean;
    materialized: Array<{
      path: string;
      role: string;
      safety: string;
    }>;
    materializedCount: number;
    resolvedArtifactPath: string;
    roles: string[];
    source?: {
      activeStepId?: string;
      approvalState?: AgenticCodingApprovalState;
      status?: AgenticCodingRunStatus;
    };
    validationErrors: string[];
  };
  producer?: {
    request?: {
      artifactPath: string;
      editProposalFile?: string;
      exists: boolean;
      instructionCount: number;
      instructions: string[];
      proposalPromptFile?: string;
      resolvedArtifactPath: string;
      safety: string[];
      safetyCount: number;
      schemaKeys: string[];
      sourceActiveStepId?: string;
      status?: AgenticCodingRunStatus;
      taskFile?: string;
      validationErrors: string[];
    };
    dispatch?: {
      allowedTools: string[];
      artifactPath: string;
      disallowedActions: string[];
      editProposalFile?: string;
      exists: boolean;
      maxToolRounds?: number;
      mode?: 'data_only_edit_proposal';
      resolvedArtifactPath: string;
      reviewCommand?: AgenticCodingProposalLoopCommand;
      sourceActiveStepId?: string;
      validationErrors: string[];
    };
    review?: {
      affectedFiles: string[];
      artifactPath: string;
      editSummary?: {
        declared: number;
        producer?: string;
        proposed?: number;
        summary?: string;
      };
      exists: boolean;
      nextAction?: AgenticCodingEditProposalReviewSnapshot['nextAction'];
      reason?: string;
      resolvedArtifactPath: string;
      sourceProposalFile?: string;
      state?: AgenticCodingEditProposalReviewState;
      validationErrors: string[];
    };
    validationErrors: string[];
  };
  availablePanelIds: string[];
  defaultPanelId?: string;
  generatedAt: string;
  kind: 'agentic-coding-proposal-loop-cowork-workspace';
  missingRequiredArtifactPaths: string[];
  openPanelId?: string;
  panels: Array<{
    artifactPath: string;
    available: boolean;
    id: string;
    required: boolean;
    resolvedArtifactPath: string;
    role: string;
    title: string;
    view: AgenticCodingProposalLoopCoworkPanelView;
  }>;
  queue?: {
    activeStepId?: string;
    artifactPath: string;
    canRunCommand?: boolean;
    exists: boolean;
    nextActionType?: AgenticCodingProposalLoopNextActionType;
    resolvedArtifactPath: string;
    runState?: AgenticCodingProposalLoopRunState;
    uiPrimaryAction?: AgenticCodingProposalLoopNextActionUi['primaryAction'];
    validationErrors: string[];
  };
  schemaVersion: 1;
  source: {
    checkStatus: AgenticCodingProposalLoopCoworkImportCheckStatus;
    importFile: string;
    summary?: string;
  };
  status: AgenticCodingProposalLoopCoworkWorkspaceStatus;
  stepper?: {
    activeStepId?: string;
    artifactPath: string;
    blockedStepIds: string[];
    completedStepIds: string[];
    counts: AgenticCodingProposalLoopSnapshot['counts'];
    exists: boolean;
    resolvedArtifactPath: string;
    steps: Array<{
      active: boolean;
      id: string;
      label: string;
      status: AgenticCodingPlanStepStatus;
    }>;
    validationErrors: string[];
  };
  suggestedFocusPanelId?: string;
  ui: {
    primaryAction: {
      disabledReason?: string;
      enabled: boolean;
      label: string;
      panelId?: string;
      type: AgenticCodingProposalLoopCoworkWorkspaceActionType;
    };
    statusText: string;
  };
  unavailablePanelIds: string[];
}

type AgenticCodingProposalLoopCoworkWorkspaceQueue = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['queue']
>;

type AgenticCodingProposalLoopCoworkWorkspaceStepper = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['stepper']
>;

type AgenticCodingProposalLoopCoworkWorkspaceActivity = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['activity']
>;

type AgenticCodingProposalLoopCoworkWorkspaceApproval = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['approval']
>;

type AgenticCodingProposalLoopCoworkWorkspaceCommands = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['commands']
>;

type AgenticCodingProposalLoopCoworkWorkspaceEvidence = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['evidence']
>;

type AgenticCodingProposalLoopCoworkWorkspaceGraph = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['graph']
>;

type AgenticCodingProposalLoopCoworkWorkspaceManifest = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['manifest']
>;

type AgenticCodingProposalLoopCoworkWorkspaceProducer = NonNullable<
  AgenticCodingProposalLoopCoworkWorkspace['producer']
>;

export interface AgenticCodingProposalLoopEvent {
  active: boolean;
  id: string;
  message: string;
  sequence: number;
  severity: AgenticCodingWorkflowEventSeverity;
  status: AgenticCodingPlanStepStatus;
  stepId: string;
}

export interface AgenticCodingProposalLoopSnapshot {
  activeStepId?: string;
  artifacts: AgenticCodingProposalLoopArtifacts;
  blockedStepIds: string[];
  completedStepIds: string[];
  counts: {
    blocked: number;
    completed: number;
    pending: number;
    ready: number;
    skipped: number;
    total: number;
  };
  edges: AgenticCodingWorkflowEdge[];
  events: AgenticCodingProposalLoopEvent[];
  generatedAt: string;
  kind: 'agentic-coding-proposal-loop';
  nextAction: {
    message: string;
    stepId?: string;
    type: AgenticCodingProposalLoopNextActionType;
  };
  nodes: AgenticCodingWorkflowNode[];
  prompts: {
    approvalDecision: string;
    editProposal: string;
  };
  schemaVersion: 1;
  source: {
    activeNodeId?: string;
    approvalState: AgenticCodingApprovalState;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
  steps: AgenticCodingProposalLoopStep[];
}

export interface AgenticCodingProposalLoopCanvas {
  activeNodeId?: string;
  blockedNodeIds: string[];
  completedNodeIds: string[];
  edges: AgenticCodingWorkflowCanvasEdge[];
  generatedAt: string;
  kind: 'agentic-coding-proposal-loop-canvas';
  nodes: AgenticCodingWorkflowCanvasNode[];
  schemaVersion: 1;
  source: {
    activeStepId?: string;
    approvalState: AgenticCodingApprovalState;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export type AgenticCodingProposalLoopRunState =
  | 'ready_command'
  | 'human_input_required'
  | 'blocked'
  | 'pending';

export type AgenticCodingProposalLoopUiActionType =
  | 'run_command'
  | 'human_review'
  | 'inspect_blocker'
  | 'wait';

export interface AgenticCodingProposalLoopNextActionUi {
  artifactHints: {
    inputArtifacts: string[];
    outputArtifacts: string[];
  };
  primaryAction: {
    commandText?: string;
    disabledReason?: string;
    enabled: boolean;
    label: string;
    type: AgenticCodingProposalLoopUiActionType;
  };
  statusText: string;
}

export interface AgenticCodingProposalLoopNextActionSnapshot {
  activeStep?: {
    command?: AgenticCodingProposalLoopCommand;
    id: string;
    inputArtifacts: string[];
    label: string;
    outputArtifacts: string[];
    safety: string[];
    status: AgenticCodingPlanStepStatus;
  };
  artifacts: AgenticCodingProposalLoopArtifacts;
  canRunCommand: boolean;
  counts: AgenticCodingProposalLoopSnapshot['counts'];
  generatedAt: string;
  kind: 'agentic-coding-proposal-loop-next-action';
  nextAction: AgenticCodingProposalLoopSnapshot['nextAction'];
  runState: AgenticCodingProposalLoopRunState;
  schemaVersion: 1;
  source: {
    activeStepId?: string;
    approvalState: AgenticCodingApprovalState;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
  ui: AgenticCodingProposalLoopNextActionUi;
}

export interface AgenticCodingEditProposalRequest {
  generatedAt: string;
  input: {
    proposalPromptFile: string;
    taskFile: string;
  };
  instructions: string[];
  kind: 'agentic-coding-edit-proposal-request';
  output: {
    editProposalFile: string;
    schema: Record<string, unknown>;
  };
  safety: string[];
  schemaVersion: 1;
  source: {
    activeStepId?: string;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export interface AgenticCodingEditProposalProducerDispatch {
  allowedTools: string[];
  currentState: {
    activeStepId?: string;
    approvalState: AgenticCodingApprovalState;
    workflow: AgenticCodingWorkflowReport;
  };
  disallowedActions: string[];
  generatedAt: string;
  input: {
    proposalPromptFile: string;
    repo: string;
    taskFile: string;
  };
  kind: 'agentic-coding-edit-proposal-producer-dispatch';
  messages: Array<{
    content: string;
    role: 'system' | 'user';
  }>;
  output: {
    editProposalFile: string;
    reviewCommand: AgenticCodingProposalLoopCommand;
    schema: Record<string, unknown>;
  };
  runPolicy: {
    cwd: string;
    maxToolRounds: number;
    mode: 'data_only_edit_proposal';
  };
  safety: string[];
  schemaVersion: 1;
  source: {
    activeStepId?: string;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export interface AgenticCodingProposalLoopArtifactBundle {
  artifacts: AgenticCodingProposalLoopArtifactBundlePaths;
  coworkImport: AgenticCodingProposalLoopCoworkImport;
  generatedAt: string;
  kind: 'agentic-coding-proposal-loop-artifact-bundle';
  materialized: AgenticCodingProposalLoopMaterializedArtifact[];
  schemaVersion: 1;
  source: {
    activeStepId?: string;
    approvalState: AgenticCodingApprovalState;
    repo: string;
    status: AgenticCodingRunStatus;
    taskFile: string;
  };
}

export interface AgenticCodingRunReport {
  approval: AgenticCodingApprovalReport;
  approvalDecision?: AgenticCodingApprovalDecisionReport;
  autoExecutable: boolean;
  blockedReasons: string[];
  contract?: AgenticCodingTaskContract;
  dirtyFiles: AgenticCodingDirtyFile[];
  editProposal?: AgenticCodingEditProposalReport;
  editPreviewRequired: boolean;
  editPreviewRequested: boolean;
  editPreviews: AgenticCodingEditPreview[];
  editRequested: boolean;
  editResults: AgenticCodingEditResult[];
  executionGate?: AgenticCodingExecutionGate;
  generatedAt: string;
  gitStatus?: string;
  repo: string;
  rulesFiles: AgenticCodingRulesFile[];
  plan: AgenticCodingPlanStep[];
  status: AgenticCodingRunStatus;
  taskFile: string;
  validationErrors: string[];
  verification: AgenticCodingVerificationResult[];
  verificationRequested: boolean;
  workflow: AgenticCodingWorkflowReport;
  workflowBuilderProposal?: AgenticCodingWorkflowBuilderProposalReport;
}

export interface AgenticCodingEditProposalPromptOptions {
  includeDirtyFiles?: boolean;
}

export interface AgenticCodingWorkflowBuilderPromptOptions {
  includeCurrentCanvas?: boolean;
}

const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', 'COLAB.md', 'README.md'];
const MAX_CAPTURE_CHARS = 4000;
const COWORK_IMPORT_PANEL_VIEWS: readonly AgenticCodingProposalLoopCoworkPanelView[] = [
  'canvas',
  'queue',
  'review',
  'prompt',
  'state',
  'timeline',
  'evidence',
  'manifest',
];

function truncateOutput(value: string): string {
  if (value.length <= MAX_CAPTURE_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_CAPTURE_CHARS)}\n...[truncated ${value.length - MAX_CAPTURE_CHARS} chars]`;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

function mergeEditProposal(
  contract: AgenticCodingTaskContract,
  proposal: AgenticCodingEditProposal,
): AgenticCodingTaskContract {
  return {
    ...contract,
    edits: [
      ...contract.edits,
      ...proposal.edits,
    ],
  };
}

function summarizeEditProposal(
  proposal: AgenticCodingEditProposal,
  proposalFile: string,
): AgenticCodingEditProposalReport {
  return {
    editCount: proposal.edits.length,
    file: proposalFile,
    producer: proposal.producer,
    risks: proposal.risks,
    summary: proposal.summary,
    verificationNotes: proposal.verificationNotes,
  };
}

function summarizeApprovalDecision(
  decision: AgenticCodingApprovalDecision,
  decisionFile: string,
): AgenticCodingApprovalDecisionReport {
  return {
    decidedAt: decision.decidedAt,
    decision: decision.decision,
    file: decisionFile,
    reason: decision.reason,
    reviewer: decision.reviewer,
  };
}

function summarizeWorkflowBuilderProposal(
  proposal: AgenticCodingWorkflowBuilderProposal,
  proposalFile: string,
): AgenticCodingWorkflowBuilderProposalReport {
  return {
    approvalGates: proposal.approvalGates,
    coworkVisualizationNotes: proposal.coworkVisualizationNotes,
    edgeCount: proposal.edges.length,
    edges: proposal.edges,
    file: proposalFile,
    nodeCount: proposal.nodes.length,
    nodes: proposal.nodes,
    risks: proposal.risks,
    summary: proposal.summary,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isCoworkImportPanelView(value: unknown): value is AgenticCodingProposalLoopCoworkPanelView {
  return typeof value === 'string'
    && COWORK_IMPORT_PANEL_VIEWS.includes(value as AgenticCodingProposalLoopCoworkPanelView);
}

function isAgenticCodingPlanStepStatus(value: unknown): value is AgenticCodingPlanStepStatus {
  return value === 'completed'
    || value === 'ready'
    || value === 'blocked'
    || value === 'pending'
    || value === 'skipped';
}

function isAgenticCodingWorkflowNodeType(value: unknown): value is AgenticCodingWorkflowNodeType {
  return value === 'gate'
    || value === 'analysis'
    || value === 'approval'
    || value === 'edit'
    || value === 'verification'
    || value === 'handoff';
}

function isAgenticCodingWorkflowEventSeverity(value: unknown): value is AgenticCodingWorkflowEventSeverity {
  return value === 'info'
    || value === 'success'
    || value === 'warning'
    || value === 'error';
}

function isAgenticCodingApprovalState(value: unknown): value is AgenticCodingApprovalState {
  return value === 'not_required'
    || value === 'draft'
    || value === 'needs_approval'
    || value === 'approved'
    || value === 'rejected';
}

function isAgenticCodingRunStatus(value: unknown): value is AgenticCodingRunStatus {
  return value === 'validation_failed'
    || value === 'blocked'
    || value === 'ready'
    || value === 'previewed'
    || value === 'edited'
    || value === 'verified'
    || value === 'verification_failed';
}

function isAgenticCodingApprovalNextActionType(
  value: unknown,
): value is AgenticCodingApprovalSnapshot['nextAction']['type'] {
  return value === 'none'
    || value === 'preview_required'
    || value === 'review_preview'
    || value === 'inspect_rejection';
}

function isAgenticCodingEditProposalReviewState(value: unknown): value is AgenticCodingEditProposalReviewState {
  return value === 'missing'
    || value === 'accepted'
    || value === 'rejected';
}

function isAgenticCodingEditProposalReviewNextActionType(
  value: unknown,
): value is AgenticCodingEditProposalReviewSnapshot['nextAction']['type'] {
  return value === 'produce_edit_proposal'
    || value === 'fix_edit_proposal'
    || value === 'preview_edits';
}

function isProposalLoopRunState(value: unknown): value is AgenticCodingProposalLoopRunState {
  return value === 'ready_command'
    || value === 'human_input_required'
    || value === 'blocked'
    || value === 'pending';
}

function isProposalLoopNextActionType(value: unknown): value is AgenticCodingProposalLoopNextActionType {
  return value === 'inspect_blocker'
    || value === 'generate_edit_proposal'
    || value === 'review_edit_proposal'
    || value === 'fix_edit_proposal'
    || value === 'preview_edits'
    || value === 'review_preview'
    || value === 'apply_approved_edits'
    || value === 'run_verification'
    || value === 'handoff';
}

function isProposalLoopUiActionType(value: unknown): value is AgenticCodingProposalLoopUiActionType {
  return value === 'run_command'
    || value === 'human_review'
    || value === 'inspect_blocker'
    || value === 'wait';
}

function isProposalLoopCommand(value: unknown): value is AgenticCodingProposalLoopCommand {
  return isRecord(value)
    && value.executable === 'buddy'
    && isStringArray(value.args);
}

function resolveCoworkImportArtifactPath(importFile: string, artifactPath: string): string {
  if (path.isAbsolute(artifactPath)) {
    return path.resolve(artifactPath);
  }

  return path.resolve(path.dirname(importFile), artifactPath);
}

function parseAgenticCodingProposalLoopCoworkImport(input: unknown): {
  coworkImport?: AgenticCodingProposalLoopCoworkImport;
  errors: string[];
} {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { errors: ['import manifest must be an object'] };
  }

  if (input.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  for (const field of ['defaultPanelId', 'primaryArtifactPath', 'queueArtifactPath', 'suggestedFocusPanelId', 'summary']) {
    if (typeof input[field] !== 'string' || input[field].trim().length === 0) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if (!isStringArray(input.requiredArtifactPaths)) {
    errors.push('requiredArtifactPaths must be an array of non-empty strings');
  }

  if (!Array.isArray(input.panels) || input.panels.length === 0) {
    errors.push('panels must be a non-empty array');
  }

  const panels: AgenticCodingProposalLoopCoworkImportPanel[] = [];
  if (Array.isArray(input.panels)) {
    input.panels.forEach((panelInput, index) => {
      if (!isRecord(panelInput)) {
        errors.push(`panels[${index}] must be an object`);
        return;
      }

      const panelErrors: string[] = [];
      for (const field of ['artifactPath', 'id', 'role', 'title']) {
        if (typeof panelInput[field] !== 'string' || panelInput[field].trim().length === 0) {
          panelErrors.push(`${field} must be a non-empty string`);
        }
      }
      if (!isCoworkImportPanelView(panelInput.view)) {
        panelErrors.push('view must be a known Cowork panel view');
      }

      if (panelErrors.length > 0) {
        errors.push(...panelErrors.map((error) => `panels[${index}].${error}`));
        return;
      }

      panels.push({
        artifactPath: panelInput.artifactPath as string,
        id: panelInput.id as string,
        role: panelInput.role as string,
        title: panelInput.title as string,
        view: panelInput.view as AgenticCodingProposalLoopCoworkPanelView,
      });
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    coworkImport: {
      defaultPanelId: input.defaultPanelId as string,
      panels,
      primaryArtifactPath: input.primaryArtifactPath as string,
      queueArtifactPath: input.queueArtifactPath as string,
      requiredArtifactPaths: input.requiredArtifactPaths as string[],
      schemaVersion: 1,
      suggestedFocusPanelId: input.suggestedFocusPanelId as string,
      summary: input.summary as string,
    },
    errors,
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceQueue(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceQueue | undefined> {
  const queuePanel = check.panels.find((panel) => panel.id === 'next-action');
  if (!queuePanel) {
    return undefined;
  }

  const queue: AgenticCodingProposalLoopCoworkWorkspaceQueue = {
    artifactPath: queuePanel.artifactPath,
    exists: queuePanel.exists,
    resolvedArtifactPath: queuePanel.resolvedArtifactPath,
    validationErrors: [],
  };

  if (!queuePanel.exists) {
    return queue;
  }

  let input: unknown;
  try {
    input = await readJsonFile(queuePanel.resolvedArtifactPath);
  } catch (error) {
    return {
      ...queue,
      validationErrors: [`queueArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...queue,
      validationErrors: ['queueArtifact must be an object'],
    };
  }

  const activeStep = isRecord(input.activeStep) ? input.activeStep : undefined;
  const nextAction = isRecord(input.nextAction) ? input.nextAction : undefined;
  const ui = isRecord(input.ui) ? input.ui : undefined;
  const primaryAction = ui && isRecord(ui.primaryAction) ? ui.primaryAction : undefined;
  const uiPrimaryAction = primaryAction && isProposalLoopUiActionType(primaryAction.type)
    && typeof primaryAction.label === 'string'
    && typeof primaryAction.enabled === 'boolean'
    ? {
      ...(typeof primaryAction.commandText === 'string' ? { commandText: primaryAction.commandText } : {}),
      ...(typeof primaryAction.disabledReason === 'string' ? { disabledReason: primaryAction.disabledReason } : {}),
      enabled: primaryAction.enabled,
      label: primaryAction.label,
      type: primaryAction.type,
    }
    : undefined;

  return {
    ...queue,
    ...(activeStep && typeof activeStep.id === 'string' ? { activeStepId: activeStep.id } : {}),
    ...(typeof input.canRunCommand === 'boolean' ? { canRunCommand: input.canRunCommand } : {}),
    ...(nextAction && isProposalLoopNextActionType(nextAction.type) ? { nextActionType: nextAction.type } : {}),
    ...(isProposalLoopRunState(input.runState) ? { runState: input.runState } : {}),
    ...(uiPrimaryAction ? { uiPrimaryAction } : {}),
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceStepper(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceStepper | undefined> {
  if (!check.primaryArtifactPath || !check.resolvedPrimaryArtifactPath) {
    return undefined;
  }

  const emptyCounts = {
    blocked: 0,
    completed: 0,
    pending: 0,
    ready: 0,
    skipped: 0,
    total: 0,
  } satisfies AgenticCodingProposalLoopSnapshot['counts'];

  const stepperBase = {
    artifactPath: check.primaryArtifactPath,
    blockedStepIds: [],
    completedStepIds: [],
    counts: emptyCounts,
    exists: check.primaryArtifactExists,
    resolvedArtifactPath: check.resolvedPrimaryArtifactPath,
    steps: [],
    validationErrors: [],
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceStepper;

  if (!check.primaryArtifactExists) {
    return stepperBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(check.resolvedPrimaryArtifactPath);
  } catch (error) {
    return {
      ...stepperBase,
      validationErrors: [`stepperArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...stepperBase,
      validationErrors: ['stepperArtifact must be an object'],
    };
  }

  const activeStepId = typeof input.activeStepId === 'string' ? input.activeStepId : undefined;
  const validationErrors: string[] = [];
  const steps = Array.isArray(input.steps)
    ? input.steps.flatMap((stepInput, index) => {
      if (!isRecord(stepInput)) {
        validationErrors.push(`steps[${index}] must be an object`);
        return [];
      }
      if (
        typeof stepInput.id !== 'string'
        || typeof stepInput.label !== 'string'
        || !isAgenticCodingPlanStepStatus(stepInput.status)
      ) {
        validationErrors.push(`steps[${index}] must include id, label, and valid status`);
        return [];
      }

      return [{
        active: stepInput.id === activeStepId,
        id: stepInput.id,
        label: stepInput.label,
        status: stepInput.status,
      }];
    })
    : [];

  if (!Array.isArray(input.steps)) {
    validationErrors.push('steps must be an array');
  }

  const counts = steps.reduce(
    (summary, step) => ({
      ...summary,
      [step.status]: summary[step.status] + 1,
      total: summary.total + 1,
    }),
    emptyCounts,
  );

  return {
    ...(activeStepId ? { activeStepId } : {}),
    ...stepperBase,
    blockedStepIds: steps.filter((step) => step.status === 'blocked').map((step) => step.id),
    completedStepIds: steps.filter((step) => step.status === 'completed').map((step) => step.id),
    counts,
    steps,
    validationErrors,
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceActivity(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceActivity | undefined> {
  const eventsPanel = check.panels.find((panel) => panel.id === 'events');
  if (!eventsPanel) {
    return undefined;
  }

  const emptyCounts = {
    error: 0,
    info: 0,
    success: 0,
    total: 0,
    warning: 0,
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceActivity['counts'];

  const activityBase = {
    artifactPath: eventsPanel.artifactPath,
    counts: emptyCounts,
    events: [],
    exists: eventsPanel.exists,
    resolvedArtifactPath: eventsPanel.resolvedArtifactPath,
    validationErrors: [],
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceActivity;

  if (!eventsPanel.exists) {
    return activityBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(eventsPanel.resolvedArtifactPath);
  } catch (error) {
    return {
      ...activityBase,
      validationErrors: [`activityArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...activityBase,
      validationErrors: ['activityArtifact must be an object'],
    };
  }

  const validationErrors: string[] = [];
  const events = Array.isArray(input.events)
    ? input.events.flatMap((eventInput, index) => {
      if (!isRecord(eventInput)) {
        validationErrors.push(`events[${index}] must be an object`);
        return [];
      }
      if (
        typeof eventInput.id !== 'string'
        || typeof eventInput.message !== 'string'
        || typeof eventInput.nodeId !== 'string'
        || !isAgenticCodingWorkflowNodeType(eventInput.nodeType)
        || typeof eventInput.sequence !== 'number'
        || !isAgenticCodingWorkflowEventSeverity(eventInput.severity)
        || !isAgenticCodingPlanStepStatus(eventInput.status)
        || typeof eventInput.active !== 'boolean'
      ) {
        validationErrors.push(`events[${index}] must include valid event fields`);
        return [];
      }

      return [{
        active: eventInput.active,
        id: eventInput.id,
        message: eventInput.message,
        nodeId: eventInput.nodeId,
        nodeType: eventInput.nodeType,
        sequence: eventInput.sequence,
        severity: eventInput.severity,
        status: eventInput.status,
      }];
    })
    : [];

  if (!Array.isArray(input.events)) {
    validationErrors.push('events must be an array');
  }

  const counts = events.reduce(
    (summary, event) => ({
      ...summary,
      [event.severity]: summary[event.severity] + 1,
      total: summary.total + 1,
    }),
    emptyCounts,
  );
  const activeEvent = events.find((event) => event.active);

  return {
    ...(activeEvent ? { activeEventId: activeEvent.id } : {}),
    ...(typeof input.activeNodeId === 'string' ? { activeNodeId: input.activeNodeId } : {}),
    ...activityBase,
    counts,
    events,
    validationErrors,
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceApproval(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceApproval | undefined> {
  const approvalPanel = check.panels.find((panel) => panel.id === 'approval');
  if (!approvalPanel) {
    return undefined;
  }

  const approvalBase = {
    affectedFiles: [],
    artifactPath: approvalPanel.artifactPath,
    exists: approvalPanel.exists,
    gateNodeIds: [],
    resolvedArtifactPath: approvalPanel.resolvedArtifactPath,
    validationErrors: [],
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceApproval;

  if (!approvalPanel.exists) {
    return approvalBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(approvalPanel.resolvedArtifactPath);
  } catch (error) {
    return {
      ...approvalBase,
      validationErrors: [`approvalArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...approvalBase,
      validationErrors: ['approvalArtifact must be an object'],
    };
  }

  const validationErrors: string[] = [];
  const editSummary = isRecord(input.editSummary) ? input.editSummary : undefined;
  if (!editSummary) {
    validationErrors.push('editSummary must be an object');
  }

  const numericEditSummary = editSummary
    && typeof editSummary.applied === 'number'
    && typeof editSummary.blocked === 'number'
    && typeof editSummary.declared === 'number'
    && typeof editSummary.previewed === 'number'
    ? {
      applied: editSummary.applied,
      blocked: editSummary.blocked,
      declared: editSummary.declared,
      previewed: editSummary.previewed,
    }
    : undefined;

  if (editSummary && !numericEditSummary) {
    validationErrors.push('editSummary must include numeric applied, blocked, declared, and previewed counts');
  }

  const nextActionInput = isRecord(input.nextAction) ? input.nextAction : undefined;
  const nextAction = nextActionInput
    && isAgenticCodingApprovalNextActionType(nextActionInput.type)
    && typeof nextActionInput.message === 'string'
    ? {
      message: nextActionInput.message,
      ...(typeof nextActionInput.nodeId === 'string' ? { nodeId: nextActionInput.nodeId } : {}),
      type: nextActionInput.type,
    }
    : undefined;

  if (nextActionInput && !nextAction) {
    validationErrors.push('nextAction must include valid type and message');
  }

  const source = isRecord(input.source) ? input.source : undefined;
  const affectedFiles = editSummary && isStringArray(editSummary.files) ? editSummary.files : [];
  if (editSummary && !isStringArray(editSummary.files)) {
    validationErrors.push('editSummary.files must be an array of paths');
  }

  return {
    ...approvalBase,
    affectedFiles,
    ...(numericEditSummary ? { editSummary: numericEditSummary } : {}),
    gateNodeIds: isStringArray(input.gateNodeIds) ? input.gateNodeIds : [],
    ...(nextAction ? { nextAction } : {}),
    ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
    ...(typeof input.requiredBeforeApply === 'boolean' ? { requiredBeforeApply: input.requiredBeforeApply } : {}),
    ...(source && typeof source.activeNodeId === 'string' ? { sourceActiveNodeId: source.activeNodeId } : {}),
    ...(isAgenticCodingApprovalState(input.state) ? { state: input.state } : {}),
    validationErrors,
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceCommands(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceCommands | undefined> {
  if (!check.primaryArtifactPath || !check.resolvedPrimaryArtifactPath) {
    return undefined;
  }

  const commandsBase = {
    artifactPath: check.primaryArtifactPath,
    commandCount: 0,
    commands: [],
    exists: check.primaryArtifactExists,
    readyCommandCount: 0,
    resolvedArtifactPath: check.resolvedPrimaryArtifactPath,
    validationErrors: [],
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceCommands;

  if (!check.primaryArtifactExists) {
    return commandsBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(check.resolvedPrimaryArtifactPath);
  } catch (error) {
    return {
      ...commandsBase,
      validationErrors: [`commandsArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...commandsBase,
      validationErrors: ['commandsArtifact must be an object'],
    };
  }

  const validationErrors: string[] = [];
  const commands = Array.isArray(input.steps)
    ? input.steps.flatMap((stepInput, index) => {
      if (!isRecord(stepInput)) {
        validationErrors.push(`steps[${index}] must be an object`);
        return [];
      }

      if (
        typeof stepInput.id !== 'string'
        || typeof stepInput.label !== 'string'
        || !isAgenticCodingPlanStepStatus(stepInput.status)
      ) {
        validationErrors.push(`steps[${index}] must include id, label, and valid status`);
        return [];
      }

      if (stepInput.command === undefined) {
        return [];
      }

      if (!isProposalLoopCommand(stepInput.command)) {
        validationErrors.push(`steps[${index}].command must be a buddy command`);
        return [];
      }

      return [{
        canRunNow: stepInput.status === 'ready',
        command: stepInput.command,
        commandText: proposalLoopCommandText(stepInput.command),
        id: stepInput.id,
        inputArtifacts: isStringArray(stepInput.inputArtifacts) ? stepInput.inputArtifacts : [],
        label: stepInput.label,
        outputArtifacts: isStringArray(stepInput.outputArtifacts) ? stepInput.outputArtifacts : [],
        safety: isStringArray(stepInput.safety) ? stepInput.safety : [],
        status: stepInput.status,
      }];
    })
    : [];

  if (!Array.isArray(input.steps)) {
    validationErrors.push('steps must be an array');
  }

  return {
    ...commandsBase,
    commandCount: commands.length,
    commands,
    readyCommandCount: commands.filter((command) => command.canRunNow).length,
    validationErrors,
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceGraph(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceGraph | undefined> {
  if (!check.primaryArtifactPath || !check.resolvedPrimaryArtifactPath) {
    return undefined;
  }

  const emptyCounts = {
    blocked: 0,
    completed: 0,
    pending: 0,
    ready: 0,
    skipped: 0,
    total: 0,
  } satisfies AgenticCodingProposalLoopSnapshot['counts'];
  const graphBase = {
    approvalNodeIds: [],
    artifactPath: check.primaryArtifactPath,
    blockedNodeIds: [],
    edgeCount: 0,
    edges: [],
    exists: check.primaryArtifactExists,
    nodeCount: 0,
    nodes: [],
    resolvedArtifactPath: check.resolvedPrimaryArtifactPath,
    statusCounts: emptyCounts,
    validationErrors: [],
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceGraph;

  if (!check.primaryArtifactExists) {
    return graphBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(check.resolvedPrimaryArtifactPath);
  } catch (error) {
    return {
      ...graphBase,
      validationErrors: [`graphArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...graphBase,
      validationErrors: ['graphArtifact must be an object'],
    };
  }

  const activeNodeId = typeof input.activeStepId === 'string' ? input.activeStepId : undefined;
  const validationErrors: string[] = [];
  const nodes = Array.isArray(input.nodes)
    ? input.nodes.flatMap((nodeInput, index) => {
      if (!isRecord(nodeInput)) {
        validationErrors.push(`nodes[${index}] must be an object`);
        return [];
      }
      if (
        typeof nodeInput.id !== 'string'
        || typeof nodeInput.label !== 'string'
        || !isAgenticCodingPlanStepStatus(nodeInput.status)
        || !isAgenticCodingWorkflowNodeType(nodeInput.type)
      ) {
        validationErrors.push(`nodes[${index}] must include id, label, valid status, and valid type`);
        return [];
      }

      return [{
        active: nodeInput.id === activeNodeId,
        id: nodeInput.id,
        label: nodeInput.label,
        status: nodeInput.status,
        type: nodeInput.type,
      }];
    })
    : [];

  if (!Array.isArray(input.nodes)) {
    validationErrors.push('nodes must be an array');
  }

  const edges = Array.isArray(input.edges)
    ? input.edges.flatMap((edgeInput, index) => {
      if (!isRecord(edgeInput)) {
        validationErrors.push(`edges[${index}] must be an object`);
        return [];
      }
      if (
        typeof edgeInput.id !== 'string'
        || typeof edgeInput.source !== 'string'
        || typeof edgeInput.target !== 'string'
        || typeof edgeInput.animated !== 'boolean'
      ) {
        validationErrors.push(`edges[${index}] must include id, source, target, and animated`);
        return [];
      }

      return [{
        animated: edgeInput.animated,
        id: edgeInput.id,
        source: edgeInput.source,
        target: edgeInput.target,
      }];
    })
    : [];

  if (!Array.isArray(input.edges)) {
    validationErrors.push('edges must be an array');
  }

  const statusCounts = nodes.reduce(
    (summary, node) => ({
      ...summary,
      [node.status]: summary[node.status] + 1,
      total: summary.total + 1,
    }),
    emptyCounts,
  );

  return {
    ...(activeNodeId ? { activeNodeId } : {}),
    ...graphBase,
    approvalNodeIds: nodes.filter((node) => node.type === 'approval').map((node) => node.id),
    blockedNodeIds: nodes.filter((node) => node.status === 'blocked').map((node) => node.id),
    edgeCount: edges.length,
    edges,
    nodeCount: nodes.length,
    nodes,
    statusCounts,
    validationErrors,
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceProducer(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceProducer | undefined> {
  const requestPanel = check.panels.find((panel) => panel.id === 'producer-request');
  const dispatchPanel = check.panels.find((panel) => panel.id === 'producer-dispatch');
  const reviewPanel = check.panels.find((panel) => panel.id === 'producer-review');

  if (!requestPanel && !dispatchPanel && !reviewPanel) {
    return undefined;
  }

  const producer: AgenticCodingProposalLoopCoworkWorkspaceProducer = {
    validationErrors: [],
  };

  if (requestPanel) {
    const requestBase = {
      artifactPath: requestPanel.artifactPath,
      exists: requestPanel.exists,
      instructionCount: 0,
      instructions: [],
      resolvedArtifactPath: requestPanel.resolvedArtifactPath,
      safety: [],
      safetyCount: 0,
      schemaKeys: [],
      validationErrors: [],
    } satisfies NonNullable<AgenticCodingProposalLoopCoworkWorkspaceProducer['request']>;

    if (!requestPanel.exists) {
      producer.request = requestBase;
    } else {
      try {
        const input = await readJsonFile(requestPanel.resolvedArtifactPath);
        if (!isRecord(input)) {
          producer.request = {
            ...requestBase,
            validationErrors: ['producerRequestArtifact must be an object'],
          };
        } else {
          const validationErrors: string[] = [];
          const inputSpec = isRecord(input.input) ? input.input : undefined;
          const output = isRecord(input.output) ? input.output : undefined;
          const schema = output && isRecord(output.schema) ? output.schema : undefined;
          const source = isRecord(input.source) ? input.source : undefined;

          if (!inputSpec) {
            validationErrors.push('input must be an object');
          }
          if (!output) {
            validationErrors.push('output must be an object');
          }
          if (!isStringArray(input.instructions)) {
            validationErrors.push('instructions must be an array of messages');
          }
          if (!isStringArray(input.safety)) {
            validationErrors.push('safety must be an array of messages');
          }

          producer.request = {
            ...requestBase,
            ...(output && typeof output.editProposalFile === 'string' ? { editProposalFile: output.editProposalFile } : {}),
            instructionCount: isStringArray(input.instructions) ? input.instructions.length : 0,
            instructions: isStringArray(input.instructions) ? input.instructions : [],
            ...(inputSpec && typeof inputSpec.proposalPromptFile === 'string' ? { proposalPromptFile: inputSpec.proposalPromptFile } : {}),
            safety: isStringArray(input.safety) ? input.safety : [],
            safetyCount: isStringArray(input.safety) ? input.safety.length : 0,
            schemaKeys: schema ? Object.keys(schema).sort() : [],
            ...(source && typeof source.activeStepId === 'string' ? { sourceActiveStepId: source.activeStepId } : {}),
            ...(source && isAgenticCodingRunStatus(source.status) ? { status: source.status } : {}),
            ...(inputSpec && typeof inputSpec.taskFile === 'string' ? { taskFile: inputSpec.taskFile } : {}),
            validationErrors,
          };
        }
      } catch (error) {
        producer.request = {
          ...requestBase,
          validationErrors: [`producerRequestArtifact: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }
  }

  if (dispatchPanel) {
    const dispatchBase = {
      allowedTools: [],
      artifactPath: dispatchPanel.artifactPath,
      disallowedActions: [],
      exists: dispatchPanel.exists,
      resolvedArtifactPath: dispatchPanel.resolvedArtifactPath,
      validationErrors: [],
    } satisfies NonNullable<AgenticCodingProposalLoopCoworkWorkspaceProducer['dispatch']>;

    if (!dispatchPanel.exists) {
      producer.dispatch = dispatchBase;
    } else {
      try {
        const input = await readJsonFile(dispatchPanel.resolvedArtifactPath);
        if (!isRecord(input)) {
          producer.dispatch = {
            ...dispatchBase,
            validationErrors: ['producerDispatchArtifact must be an object'],
          };
        } else {
          const validationErrors: string[] = [];
          const output = isRecord(input.output) ? input.output : undefined;
          const runPolicy = isRecord(input.runPolicy) ? input.runPolicy : undefined;
          const source = isRecord(input.source) ? input.source : undefined;
          const reviewCommand = output && isProposalLoopCommand(output.reviewCommand)
            ? output.reviewCommand
            : undefined;

          if (!isStringArray(input.allowedTools)) {
            validationErrors.push('allowedTools must be an array of tool names');
          }
          if (!isStringArray(input.disallowedActions)) {
            validationErrors.push('disallowedActions must be an array of action names');
          }
          if (!output) {
            validationErrors.push('output must be an object');
          }
          if (output && !reviewCommand) {
            validationErrors.push('output.reviewCommand must be a buddy command');
          }
          if (!runPolicy) {
            validationErrors.push('runPolicy must be an object');
          }

          producer.dispatch = {
            ...dispatchBase,
            allowedTools: isStringArray(input.allowedTools) ? input.allowedTools : [],
            disallowedActions: isStringArray(input.disallowedActions) ? input.disallowedActions : [],
            ...(output && typeof output.editProposalFile === 'string' ? { editProposalFile: output.editProposalFile } : {}),
            ...(runPolicy && typeof runPolicy.maxToolRounds === 'number' ? { maxToolRounds: runPolicy.maxToolRounds } : {}),
            ...(runPolicy && runPolicy.mode === 'data_only_edit_proposal' ? { mode: runPolicy.mode } : {}),
            ...(reviewCommand ? { reviewCommand } : {}),
            ...(source && typeof source.activeStepId === 'string' ? { sourceActiveStepId: source.activeStepId } : {}),
            validationErrors,
          };
        }
      } catch (error) {
        producer.dispatch = {
          ...dispatchBase,
          validationErrors: [`producerDispatchArtifact: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }
  }

  if (reviewPanel) {
    const reviewBase = {
      affectedFiles: [],
      artifactPath: reviewPanel.artifactPath,
      exists: reviewPanel.exists,
      resolvedArtifactPath: reviewPanel.resolvedArtifactPath,
      validationErrors: [],
    } satisfies NonNullable<AgenticCodingProposalLoopCoworkWorkspaceProducer['review']>;

    if (!reviewPanel.exists) {
      producer.review = reviewBase;
    } else {
      try {
        const input = await readJsonFile(reviewPanel.resolvedArtifactPath);
        if (!isRecord(input)) {
          producer.review = {
            ...reviewBase,
            validationErrors: ['producerReviewArtifact must be an object'],
          };
        } else {
          const validationErrors: string[] = [];
          const editSummary = isRecord(input.editSummary) ? input.editSummary : undefined;
          const proposal = editSummary && isRecord(editSummary.proposal) ? editSummary.proposal : undefined;
          const nextActionInput = isRecord(input.nextAction) ? input.nextAction : undefined;
          const source = isRecord(input.source) ? input.source : undefined;

          if (!editSummary) {
            validationErrors.push('editSummary must be an object');
          }
          if (editSummary && typeof editSummary.declared !== 'number') {
            validationErrors.push('editSummary.declared must be a number');
          }
          if (editSummary && !isStringArray(editSummary.files)) {
            validationErrors.push('editSummary.files must be an array of paths');
          }

          const nextAction = nextActionInput
            && isAgenticCodingEditProposalReviewNextActionType(nextActionInput.type)
            && typeof nextActionInput.message === 'string'
            ? {
              message: nextActionInput.message,
              ...(typeof nextActionInput.stepId === 'string' ? { stepId: nextActionInput.stepId } : {}),
              type: nextActionInput.type,
            }
            : undefined;

          if (nextActionInput && !nextAction) {
            validationErrors.push('nextAction must include valid type and message');
          }

          const artifactValidationErrors = isStringArray(input.validationErrors) ? input.validationErrors : [];
          if (input.validationErrors !== undefined && !isStringArray(input.validationErrors)) {
            validationErrors.push('validationErrors must be an array of messages');
          }

          producer.review = {
            ...reviewBase,
            affectedFiles: editSummary && isStringArray(editSummary.files) ? editSummary.files : [],
            ...(editSummary && typeof editSummary.declared === 'number'
              ? {
                editSummary: {
                  declared: editSummary.declared,
                  ...(proposal && typeof proposal.producer === 'string' ? { producer: proposal.producer } : {}),
                  ...(proposal && typeof proposal.editCount === 'number' ? { proposed: proposal.editCount } : {}),
                  ...(proposal && typeof proposal.summary === 'string' ? { summary: proposal.summary } : {}),
                },
              }
              : {}),
            ...(nextAction ? { nextAction } : {}),
            ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
            ...(source && typeof source.proposalFile === 'string' ? { sourceProposalFile: source.proposalFile } : {}),
            ...(isAgenticCodingEditProposalReviewState(input.state) ? { state: input.state } : {}),
            validationErrors: [
              ...validationErrors,
              ...artifactValidationErrors,
            ],
          };
        }
      } catch (error) {
        producer.review = {
          ...reviewBase,
          validationErrors: [`producerReviewArtifact: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }
  }

  producer.validationErrors = [
    ...(producer.request?.validationErrors.map((error) => `request: ${error}`) ?? []),
    ...(producer.dispatch?.validationErrors.map((error) => `dispatch: ${error}`) ?? []),
    ...(producer.review?.validationErrors.map((error) => `review: ${error}`) ?? []),
  ];

  return producer;
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceEvidence(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceEvidence | undefined> {
  const evidencePanel = check.panels.find((panel) => panel.id === 'seed-report');
  if (!evidencePanel) {
    return undefined;
  }

  const emptyEditSummary = {
    applied: 0,
    blocked: 0,
    declared: 0,
    previewed: 0,
  };
  const emptyVerificationSummary = {
    blocked: 0,
    failed: 0,
    passed: 0,
    total: 0,
  };
  const evidenceBase = {
    artifactPath: evidencePanel.artifactPath,
    blockedReasons: [],
    editSummary: emptyEditSummary,
    exists: evidencePanel.exists,
    resolvedArtifactPath: evidencePanel.resolvedArtifactPath,
    validationErrors: [],
    verificationSummary: emptyVerificationSummary,
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceEvidence;

  if (!evidencePanel.exists) {
    return evidenceBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(evidencePanel.resolvedArtifactPath);
  } catch (error) {
    return {
      ...evidenceBase,
      validationErrors: [`evidenceArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...evidenceBase,
      validationErrors: ['evidenceArtifact must be an object'],
    };
  }

  const validationErrors: string[] = [];
  if (input.blockedReasons !== undefined && !isStringArray(input.blockedReasons)) {
    validationErrors.push('blockedReasons must be an array of messages');
  }
  if (input.validationErrors !== undefined && !isStringArray(input.validationErrors)) {
    validationErrors.push('validationErrors must be an array of messages');
  }

  const contract = isRecord(input.contract) ? input.contract : undefined;
  const declaredEdits = contract && Array.isArray(contract.edits) ? contract.edits.length : 0;
  const editPreviews = Array.isArray(input.editPreviews) ? input.editPreviews : [];
  const editResults = Array.isArray(input.editResults) ? input.editResults : [];
  if (input.editPreviews !== undefined && !Array.isArray(input.editPreviews)) {
    validationErrors.push('editPreviews must be an array');
  }
  if (input.editResults !== undefined && !Array.isArray(input.editResults)) {
    validationErrors.push('editResults must be an array');
  }

  const verification = Array.isArray(input.verification) ? input.verification : [];
  if (input.verification !== undefined && !Array.isArray(input.verification)) {
    validationErrors.push('verification must be an array');
  }

  const verificationSummary = verification.reduce(
    (summary, result) => {
      if (!isRecord(result) || (result.status !== 'passed' && result.status !== 'failed' && result.status !== 'blocked')) {
        return summary;
      }

      return {
        ...summary,
        [result.status]: summary[result.status] + 1,
        total: summary.total + 1,
      };
    },
    emptyVerificationSummary,
  );

  const workflow = isRecord(input.workflow) ? input.workflow : undefined;
  const completedNodeIds = workflow && Array.isArray(workflow.completedNodeIds) ? workflow.completedNodeIds : [];
  const blockedNodeIds = workflow && Array.isArray(workflow.blockedNodeIds) ? workflow.blockedNodeIds : [];
  const nodes = workflow && Array.isArray(workflow.nodes) ? workflow.nodes : [];

  return {
    ...evidenceBase,
    ...(isAgenticCodingApprovalState(isRecord(input.approval) ? input.approval.state : undefined)
      ? { approvalState: (input.approval as Record<string, unknown>).state as AgenticCodingApprovalState }
      : {}),
    ...(typeof input.autoExecutable === 'boolean' ? { autoExecutable: input.autoExecutable } : {}),
    blockedReasons: isStringArray(input.blockedReasons) ? input.blockedReasons : [],
    editSummary: {
      applied: editResults.filter((result) => isRecord(result) && result.status === 'applied').length,
      blocked: [
        ...editPreviews.filter((preview) => isRecord(preview) && preview.status !== 'previewed'),
        ...editResults.filter((result) => isRecord(result) && result.status !== 'applied'),
      ].length,
      declared: declaredEdits,
      previewed: editPreviews.filter((preview) => isRecord(preview) && preview.status === 'previewed').length,
    },
    ...(typeof input.generatedAt === 'string' ? { runGeneratedAt: input.generatedAt } : {}),
    ...(isAgenticCodingRunStatus(input.status) ? { status: input.status } : {}),
    validationErrors: [
      ...validationErrors,
      ...(isStringArray(input.validationErrors) ? input.validationErrors : []),
    ],
    verificationSummary,
    ...(workflow
      ? {
        workflow: {
          ...(typeof workflow.activeNodeId === 'string' ? { activeNodeId: workflow.activeNodeId } : {}),
          blocked: blockedNodeIds.length,
          completed: completedNodeIds.length,
          total: nodes.length,
        },
      }
      : {}),
  };
}

async function buildAgenticCodingProposalLoopCoworkWorkspaceManifest(
  check: AgenticCodingProposalLoopCoworkImportCheck,
): Promise<AgenticCodingProposalLoopCoworkWorkspaceManifest | undefined> {
  const manifestPanel = check.panels.find((panel) => panel.id === 'manifest');
  if (!manifestPanel) {
    return undefined;
  }

  const manifestBase = {
    artifactPath: manifestPanel.artifactPath,
    exists: manifestPanel.exists,
    materialized: [],
    materializedCount: 0,
    resolvedArtifactPath: manifestPanel.resolvedArtifactPath,
    roles: [],
    validationErrors: [],
  } satisfies AgenticCodingProposalLoopCoworkWorkspaceManifest;

  if (!manifestPanel.exists) {
    return manifestBase;
  }

  let input: unknown;
  try {
    input = await readJsonFile(manifestPanel.resolvedArtifactPath);
  } catch (error) {
    return {
      ...manifestBase,
      validationErrors: [`manifestArtifact: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(input)) {
    return {
      ...manifestBase,
      validationErrors: ['manifestArtifact must be an object'],
    };
  }

  const validationErrors: string[] = [];
  const materialized = Array.isArray(input.materialized)
    ? input.materialized.flatMap((item, index) => {
      if (!isRecord(item)) {
        validationErrors.push(`materialized[${index}] must be an object`);
        return [];
      }

      if (
        typeof item.path !== 'string'
        || typeof item.role !== 'string'
        || typeof item.safety !== 'string'
      ) {
        validationErrors.push(`materialized[${index}] must include path, role, and safety`);
        return [];
      }

      return [{
        path: item.path,
        role: item.role,
        safety: item.safety,
      }];
    })
    : [];

  if (!Array.isArray(input.materialized)) {
    validationErrors.push('materialized must be an array');
  }

  const coworkImport = isRecord(input.coworkImport) ? input.coworkImport : undefined;
  const source = isRecord(input.source) ? input.source : undefined;

  return {
    ...manifestBase,
    ...(coworkImport
      ? {
        coworkImport: {
          ...(typeof coworkImport.defaultPanelId === 'string' ? { defaultPanelId: coworkImport.defaultPanelId } : {}),
          panelCount: Array.isArray(coworkImport.panels) ? coworkImport.panels.length : 0,
          ...(typeof coworkImport.queueArtifactPath === 'string' ? { queueArtifactPath: coworkImport.queueArtifactPath } : {}),
          requiredArtifactCount: Array.isArray(coworkImport.requiredArtifactPaths)
            ? coworkImport.requiredArtifactPaths.length
            : 0,
          ...(typeof coworkImport.suggestedFocusPanelId === 'string'
            ? { suggestedFocusPanelId: coworkImport.suggestedFocusPanelId }
            : {}),
        },
      }
      : {}),
    materialized,
    materializedCount: materialized.length,
    roles: materialized.map((item) => item.role),
    ...(source
      ? {
        source: {
          ...(typeof source.activeStepId === 'string' ? { activeStepId: source.activeStepId } : {}),
          ...(isAgenticCodingApprovalState(source.approvalState) ? { approvalState: source.approvalState } : {}),
          ...(isAgenticCodingRunStatus(source.status) ? { status: source.status } : {}),
        },
      }
      : {}),
    validationErrors,
  };
}

async function collectRulesFiles(repo: string): Promise<AgenticCodingRulesFile[]> {
  return Promise.all(
    RULE_FILES.map(async (name) => ({
      path: name,
      present: await pathExists(path.join(repo, name)),
    })),
  );
}

function normalizeGitPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^"|"$/g, '');
}

function parseGitStatus(output: string, contract: AgenticCodingTaskContract | undefined): AgenticCodingDirtyFile[] {
  if (!contract) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('## '))
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).split(' -> ').pop() ?? line.slice(3);
      const filePath = normalizeGitPath(rawPath);
      return {
        allowed: isPathAllowedByContract(filePath, contract.allowedPaths),
        path: filePath,
        status,
      };
    });
}

function isPathAllowedByContract(filePath: string, allowedPaths: string[]): boolean {
  const normalizedPath = normalizeGitPath(filePath);

  return allowedPaths.some((scope) => {
    const normalizedScope = normalizeGitPath(scope);

    if (normalizedScope.endsWith('/...')) {
      const prefix = normalizedScope.slice(0, -3);
      return normalizedPath.startsWith(prefix);
    }

    return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
  });
}

function resolveRepoPath(repo: string, filePath: string): { path?: string; reason?: string } {
  const normalizedPath = normalizeGitPath(filePath);
  const resolved = path.resolve(repo, normalizedPath);
  const relative = path.relative(repo, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { reason: `path escapes repository: ${filePath}` };
  }

  return { path: resolved };
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let index = value.indexOf(search);

  while (index !== -1) {
    count += 1;
    index = value.indexOf(search, index + search.length);
  }

  return count;
}

async function collectGitStatus(
  repo: string,
  contract: AgenticCodingTaskContract | undefined,
): Promise<{ dirtyFiles: AgenticCodingDirtyFile[]; gitStatus?: string; reason?: string }> {
  try {
    const result = await execFileAsync('git', ['status', '--short', '--branch'], {
      cwd: repo,
      timeout: 15000,
      windowsHide: true,
    });
    const stdout = String(result.stdout);
    return {
      dirtyFiles: parseGitStatus(stdout, contract),
      gitStatus: stdout.trimEnd(),
    };
  } catch (error) {
    return {
      dirtyFiles: [],
      reason: `git status failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function applyDeclaredEdits(
  contract: AgenticCodingTaskContract,
): Promise<AgenticCodingEditResult[]> {
  const results: AgenticCodingEditResult[] = [];

  for (const edit of contract.edits) {
    if (!isPathAllowedByContract(edit.path, contract.allowedPaths)) {
      results.push({
        occurrences: 0,
        path: edit.path,
        reason: `edit path is outside allowedPaths: ${edit.path}`,
        status: 'blocked',
      });
      continue;
    }

    const resolved = resolveRepoPath(contract.repo, edit.path);
    if (!resolved.path) {
      results.push({
        occurrences: 0,
        path: edit.path,
        reason: resolved.reason ?? 'edit path failed repository safety check',
        status: 'blocked',
      });
      continue;
    }

    try {
      const current = await fs.readFile(resolved.path, 'utf8');
      const occurrences = countOccurrences(current, edit.find);

      if (occurrences !== edit.expectedOccurrences) {
        results.push({
          occurrences,
          path: edit.path,
          reason: `expected ${edit.expectedOccurrences} occurrence(s), found ${occurrences}`,
          status: 'blocked',
        });
        continue;
      }

      await fs.writeFile(resolved.path, current.split(edit.find).join(edit.replace), 'utf8');
      results.push({
        occurrences,
        path: edit.path,
        status: 'applied',
      });
    } catch (error) {
      results.push({
        occurrences: 0,
        path: edit.path,
        reason: error instanceof Error ? error.message : String(error),
        status: 'failed',
      });
    }
  }

  return results;
}

async function previewDeclaredEdits(
  contract: AgenticCodingTaskContract,
): Promise<AgenticCodingEditPreview[]> {
  const previews: AgenticCodingEditPreview[] = [];

  for (const edit of contract.edits) {
    if (!isPathAllowedByContract(edit.path, contract.allowedPaths)) {
      previews.push({
        after: '',
        before: '',
        occurrences: 0,
        path: edit.path,
        reason: `edit path is outside allowedPaths: ${edit.path}`,
        status: 'blocked',
      });
      continue;
    }

    const resolved = resolveRepoPath(contract.repo, edit.path);
    if (!resolved.path) {
      previews.push({
        after: '',
        before: '',
        occurrences: 0,
        path: edit.path,
        reason: resolved.reason ?? 'edit path failed repository safety check',
        status: 'blocked',
      });
      continue;
    }

    try {
      const current = await fs.readFile(resolved.path, 'utf8');
      const occurrences = countOccurrences(current, edit.find);

      if (occurrences !== edit.expectedOccurrences) {
        previews.push({
          after: '',
          before: truncateOutput(current),
          occurrences,
          path: edit.path,
          reason: `expected ${edit.expectedOccurrences} occurrence(s), found ${occurrences}`,
          status: 'blocked',
        });
        continue;
      }

      previews.push({
        after: truncateOutput(current.split(edit.find).join(edit.replace)),
        before: truncateOutput(current),
        occurrences,
        path: edit.path,
        status: 'previewed',
      });
    } catch (error) {
      previews.push({
        after: '',
        before: '',
        occurrences: 0,
        path: edit.path,
        reason: error instanceof Error ? error.message : String(error),
        status: 'failed',
      });
    }
  }

  return previews;
}

async function runVerificationCommands(
  contract: AgenticCodingTaskContract,
  timeoutMs: number,
): Promise<AgenticCodingVerificationResult[]> {
  const results: AgenticCodingVerificationResult[] = [];

  for (const command of contract.verification) {
    const validation = validateCommand(command);
    if (!validation.valid) {
      results.push({
        command,
        exitCode: 1,
        reason: validation.error ?? 'command failed validation',
        status: 'blocked',
        stderr: '',
        stdout: '',
      });
      continue;
    }

    try {
      const result = await execAsync(command, {
        cwd: contract.repo,
        timeout: timeoutMs,
        windowsHide: true,
      });
      results.push({
        command,
        exitCode: 0,
        status: 'passed',
        stderr: truncateOutput(String(result.stderr)),
        stdout: truncateOutput(String(result.stdout)),
      });
    } catch (error) {
      const commandError = error as Error & {
        code?: number;
        stderr?: string | Buffer;
        stdout?: string | Buffer;
      };
      results.push({
        command,
        exitCode: typeof commandError.code === 'number' ? commandError.code : 1,
        reason: commandError.message,
        status: 'failed',
        stderr: truncateOutput(String(commandError.stderr ?? '')),
        stdout: truncateOutput(String(commandError.stdout ?? '')),
      });
    }
  }

  return results;
}

function buildExecutionPlan(input: {
  approvalDecision?: AgenticCodingApprovalDecisionReport;
  approvalDecisionRequired: boolean;
  blockedReasons: string[];
  contract?: AgenticCodingTaskContract;
  dirtyFiles: AgenticCodingDirtyFile[];
  editProposal?: AgenticCodingEditProposalReport;
  editPreviewRequired: boolean;
  editPreviewRequested: boolean;
  editPreviews: AgenticCodingEditPreview[];
  editRequested: boolean;
  editResults: AgenticCodingEditResult[];
  rulesFiles: AgenticCodingRulesFile[];
  validationErrors: string[];
  verification: AgenticCodingVerificationResult[];
  verificationRequested: boolean;
}): AgenticCodingPlanStep[] {
  const hasValidationErrors = input.validationErrors.length > 0;
  const isBlocked = input.blockedReasons.length > 0 || hasValidationErrors;
  const previewFailed = input.editPreviews.some((preview) => preview.status !== 'previewed');
  const editFailed = input.editResults.some((result) => result.status !== 'applied');
  const verificationFailed = input.verification.some((result) => result.status !== 'passed');

  const plan: AgenticCodingPlanStep[] = [
    {
      detail: hasValidationErrors
        ? input.validationErrors.join('; ')
        : 'Task JSON is valid and defaults were applied.',
      id: 'contract',
      status: hasValidationErrors ? 'blocked' : 'completed',
      title: 'Validate task contract',
    },
  ];

  if (!input.contract) {
    return plan;
  }

  const presentRules = input.rulesFiles.filter((rule) => rule.present).map((rule) => rule.path);
  plan.push({
    detail: presentRules.length > 0
      ? `Found ${presentRules.join(', ')}.`
      : 'No standard workspace rules files found at repository root.',
    id: 'workspace-rules',
    status: 'completed',
    title: 'Load workspace rules',
  });

  const dirtyOutsideScope = input.dirtyFiles.filter((file) => !file.allowed);
  plan.push({
    detail: dirtyOutsideScope.length > 0
      ? `Dirty files outside allowedPaths: ${dirtyOutsideScope.map((file) => file.path).join(', ')}.`
      : 'No dirty files outside allowedPaths.',
    id: 'git-preflight',
    status: dirtyOutsideScope.length > 0 ? 'blocked' : 'completed',
    title: 'Inspect git state and allowed scope',
  });

  plan.push({
    detail: isBlocked
      ? input.blockedReasons.join('; ')
      : 'Task is low-risk, scoped, and eligible for V0 preflight.',
    id: 'safety-gate',
    status: isBlocked ? 'blocked' : 'completed',
    title: 'Apply V0 safety gate',
  });

  plan.push({
    detail: `Search and inspect ${input.contract.allowedPaths.join(', ')} before proposing edits.`,
    id: 'understanding',
    status: isBlocked ? 'pending' : 'ready',
    title: 'Map affected code before edits',
  });

  plan.push({
    detail: 'Add or identify a focused regression test before risky implementation.',
    id: 'behavior-lock',
    status: isBlocked ? 'pending' : 'ready',
    title: 'Lock behavior with focused tests when needed',
  });

  plan.push({
    detail: input.editProposal
      ? `Loaded ${input.editProposal.editCount} proposed edit(s): ${input.editProposal.summary}`
      : input.contract.edits.length > 0
        ? 'Using edit operations declared directly in the task contract.'
        : 'No edit proposal file supplied.',
    id: 'edit-proposal',
    status: input.editProposal ? 'completed' : (input.contract.edits.length > 0 ? 'skipped' : 'pending'),
    title: 'Load controlled edit proposal',
  });

  plan.push({
    detail: input.editPreviews.length > 0
      ? input.editPreviews.map((preview) => `${preview.status}: ${preview.path}`).join('; ')
      : input.contract.edits.length > 0
        ? input.editPreviewRequested
          ? input.editPreviewRequired
            ? 'Preview was required before apply, but preflight blocked execution.'
            : 'Preview was requested but preflight blocked execution.'
          : 'Declared edits can be previewed with --preview-edits before applying.'
        : 'No declared edits to preview.',
    id: 'edit-preview',
    status: input.editPreviews.length > 0
      ? (previewFailed ? 'blocked' : 'completed')
      : (isBlocked ? 'pending' : input.contract.edits.length > 0 ? 'ready' : 'pending'),
    title: 'Preview scoped edits',
  });

  plan.push({
    detail: input.approvalDecision
      ? `${input.approvalDecision.decision} by ${input.approvalDecision.reviewer}: ${input.approvalDecision.reason}`
      : input.contract.edits.length > 0
        ? input.approvalDecisionRequired
          ? 'A controlled approval decision file is required before applying scoped edits.'
          : 'No approval decision file supplied; Cowork can write one after reviewing the preview.'
        : 'No declared edits require approval.',
    id: 'approval-decision',
    status: input.approvalDecision
      ? (input.approvalDecision.decision === 'approved' ? 'completed' : 'blocked')
      : input.approvalDecisionRequired
        ? 'blocked'
        : (input.contract.edits.length > 0 ? 'ready' : 'pending'),
    title: 'Consume approval decision',
  });

  plan.push({
    detail: input.editResults.length > 0
      ? input.editResults.map((result) => `${result.status}: ${result.path}`).join('; ')
      : input.contract.edits.length > 0
        ? input.editRequested
          ? 'Declared edits were requested but preflight blocked execution.'
          : 'Declared edits are ready; pass --apply-edits to modify files.'
        : 'No declared edits in this task contract.',
    id: 'scoped-edit',
    status: input.editResults.length > 0
      ? (editFailed ? 'blocked' : 'completed')
      : (isBlocked ? 'pending' : input.contract.edits.length > 0 ? 'ready' : 'pending'),
    title: 'Apply scoped edits',
  });

  plan.push({
    detail: input.verification.length > 0
      ? input.verification.map((result) => `${result.status}: ${result.command}`).join('; ')
      : input.verificationRequested
        ? 'Verification was requested but preflight blocked execution.'
        : 'Verification is declared but only runs with --run-verification in V0.',
    id: 'verification',
    status: input.verification.length > 0
      ? (verificationFailed ? 'blocked' : 'completed')
      : (input.verificationRequested ? 'blocked' : 'pending'),
    title: 'Run declared verification',
  });

  plan.push({
    detail: 'Report files, checks, risks, and next steps for Cowork or the next agent.',
    id: 'handoff',
    status: input.verification.length > 0 && !verificationFailed ? 'completed' : 'pending',
    title: 'Produce evidence and memory handoff',
  });

  return plan;
}

function buildApprovalReport(input: {
  approvalDecision?: AgenticCodingApprovalDecisionReport;
  blockedReasons: string[];
  contract?: AgenticCodingTaskContract;
  editPreviewRequired: boolean;
  editPreviews: AgenticCodingEditPreview[];
  editResults: AgenticCodingEditResult[];
  validationErrors: string[];
}): AgenticCodingApprovalReport {
  if (input.validationErrors.length > 0) {
    return {
      reason: `Task or proposal validation failed: ${input.validationErrors.join('; ')}`,
      requiredBeforeApply: input.editPreviewRequired,
      state: 'rejected',
    };
  }

  const editCount = input.contract?.edits.length ?? 0;
  if (editCount === 0) {
    return {
      reason: 'No scoped edits were declared.',
      requiredBeforeApply: input.editPreviewRequired,
      state: 'not_required',
    };
  }

  const failedPreview = input.editPreviews.find((preview) => preview.status !== 'previewed');
  if (failedPreview) {
    return {
      reason: `Scoped edit preview failed for ${failedPreview.path}: ${failedPreview.reason ?? failedPreview.status}`,
      requiredBeforeApply: input.editPreviewRequired,
      state: 'rejected',
    };
  }

  const failedEdit = input.editResults.find((result) => result.status !== 'applied');
  if (failedEdit) {
    return {
      reason: `Scoped edit application failed for ${failedEdit.path}: ${failedEdit.reason ?? failedEdit.status}`,
      requiredBeforeApply: input.editPreviewRequired,
      state: 'rejected',
    };
  }

  if (input.approvalDecision?.decision === 'rejected') {
    return {
      reason: `Scoped edit preview rejected by ${input.approvalDecision.reviewer}: ${input.approvalDecision.reason}`,
      requiredBeforeApply: input.editPreviewRequired,
      state: 'rejected',
    };
  }

  if (input.blockedReasons.length > 0) {
    return {
      reason: `Preflight blocked scoped edits: ${input.blockedReasons.join('; ')}`,
      requiredBeforeApply: input.editPreviewRequired,
      state: 'rejected',
    };
  }

  if (input.approvalDecision?.decision === 'approved') {
    return {
      reason: `Scoped edit preview approved by ${input.approvalDecision.reviewer}: ${input.approvalDecision.reason}`,
      requiredBeforeApply: input.editPreviewRequired,
      state: 'approved',
    };
  }

  if (input.editResults.length > 0) {
    return {
      reason: 'Scoped edits were applied after validation and preflight.',
      requiredBeforeApply: input.editPreviewRequired,
      state: 'approved',
    };
  }

  if (input.editPreviews.length > 0) {
    return {
      reason: 'Scoped edit preview is ready for human or Cowork approval before applying.',
      requiredBeforeApply: input.editPreviewRequired,
      state: 'needs_approval',
    };
  }

  return {
    reason: 'Scoped edits are declared but have not been previewed or applied yet.',
    requiredBeforeApply: input.editPreviewRequired,
    state: 'draft',
  };
}

function planStepToWorkflowType(stepId: string): AgenticCodingWorkflowNodeType {
  if (['contract', 'workspace-rules', 'git-preflight', 'safety-gate'].includes(stepId)) {
    return 'gate';
  }

  if (['understanding', 'behavior-lock'].includes(stepId)) {
    return 'analysis';
  }

  if (['edit-proposal', 'edit-preview', 'approval-decision'].includes(stepId)) {
    return 'approval';
  }

  if (stepId === 'scoped-edit') {
    return 'edit';
  }

  if (stepId === 'verification') {
    return 'verification';
  }

  return 'handoff';
}

function buildWorkflowReport(plan: AgenticCodingPlanStep[]): AgenticCodingWorkflowReport {
  const nodes = plan.map((step) => ({
    detail: step.detail,
    id: step.id,
    label: step.title,
    status: step.status,
    type: planStepToWorkflowType(step.id),
  }));

  const edges = plan.slice(0, -1).map((step, index) => {
    const nextStep = plan[index + 1] ?? step;
    return {
      animated: true,
      id: `edge-${step.id}-${nextStep.id}`,
      source: step.id,
      target: nextStep.id,
    };
  });

  const blockedNodeIds = plan
    .filter((step) => step.status === 'blocked')
    .map((step) => step.id);
  const completedNodeIds = plan
    .filter((step) => step.status === 'completed' || step.status === 'skipped')
    .map((step) => step.id);
  const nodeErrors = plan
    .filter((step) => step.status === 'blocked')
    .map((step) => ({
      message: step.detail,
      nodeId: step.id,
    }));
  const lastCompletedIndex = plan.findLastIndex((step) =>
    step.status === 'completed' || step.status === 'skipped'
  );
  const activeNodeId =
    blockedNodeIds[0]
    ?? plan.slice(lastCompletedIndex + 1).find((step) =>
      step.status !== 'completed' && step.status !== 'skipped'
    )?.id
    ?? plan.find((step) => step.status !== 'completed' && step.status !== 'skipped')?.id;

  return {
    activeNodeId,
    blockedNodeIds,
    completedNodeIds,
    edges,
    nodeErrors,
    nodes,
  };
}

function workflowNodeKind(node: AgenticCodingWorkflowNode): 'trigger' | 'action' | 'logic' {
  if (node.id === 'contract') {
    return 'trigger';
  }

  return node.type === 'approval' ? 'logic' : 'action';
}

function proposalLoopCanvasNodeKind(
  node: AgenticCodingWorkflowNode,
  index: number,
): 'trigger' | 'action' | 'logic' {
  if (index === 0) {
    return 'trigger';
  }

  return node.type === 'approval' ? 'logic' : 'action';
}

function workflowNodeIcon(node: { type: AgenticCodingWorkflowNodeType }): string {
  switch (node.type) {
    case 'gate':
      return 'ShieldCheck';
    case 'analysis':
      return 'Search';
    case 'approval':
      return 'ClipboardCheck';
    case 'edit':
      return 'PenTool';
    case 'verification':
      return 'CheckCircle';
    case 'handoff':
      return 'Archive';
  }
}

export function buildAgenticCodingProposalLoopCanvas(
  loop: AgenticCodingProposalLoopSnapshot,
): AgenticCodingProposalLoopCanvas {
  return {
    activeNodeId: loop.activeStepId,
    blockedNodeIds: loop.blockedStepIds,
    completedNodeIds: loop.completedStepIds,
    edges: loop.edges.map((edge) => ({
      animated: true,
      id: edge.id,
      source: edge.source,
      style: { stroke: '#14b8a6', strokeWidth: 2 },
      target: edge.target,
    })),
    generatedAt: loop.generatedAt,
    kind: 'agentic-coding-proposal-loop-canvas',
    nodes: loop.nodes.map((node, index) => ({
      data: {
        agenticType: node.type,
        description: node.detail,
        errorMessages: loop.events
          .filter((event) => event.stepId === node.id && event.severity === 'error')
          .map((event) => event.message),
        iconName: workflowNodeIcon(node),
        label: node.label,
        status: node.status,
        type: proposalLoopCanvasNodeKind(node, index),
      },
      id: node.id,
      position: { x: 250, y: 50 + index * 150 },
      type: 'customNode',
    })),
    schemaVersion: 1,
    source: {
      ...(loop.activeStepId ? { activeStepId: loop.activeStepId } : {}),
      approvalState: loop.source.approvalState,
      repo: loop.source.repo,
      status: loop.source.status,
      taskFile: loop.source.taskFile,
    },
  };
}

export function buildAgenticCodingWorkflowCanvas(
  report: AgenticCodingRunReport,
): AgenticCodingWorkflowCanvas {
  return {
    activeNodeId: report.workflow.activeNodeId,
    blockedNodeIds: report.workflow.blockedNodeIds,
    completedNodeIds: report.workflow.completedNodeIds,
    edges: report.workflow.edges.map((edge) => ({
      animated: true,
      id: edge.id,
      source: edge.source,
      style: { stroke: '#8b5cf6', strokeWidth: 2 },
      target: edge.target,
    })),
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-workflow-canvas',
    nodeErrors: report.workflow.nodeErrors,
    nodes: report.workflow.nodes.map((node, index) => ({
      data: {
        agenticType: node.type,
        description: node.detail,
        errorMessages: report.workflow.nodeErrors
          .filter((error) => error.nodeId === node.id)
          .map((error) => error.message),
        iconName: workflowNodeIcon(node),
        label: node.label,
        status: node.status,
        type: workflowNodeKind(node),
      },
      id: node.id,
      position: { x: 250, y: 50 + index * 150 },
      type: 'customNode',
    })),
    schemaVersion: 1,
    source: {
      approvalState: report.approval.state,
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
  };
}

export function buildAgenticCodingWorkflowBuilderProposalCanvas(
  report: AgenticCodingRunReport,
): AgenticCodingWorkflowBuilderProposalCanvas | undefined {
  if (!report.workflowBuilderProposal) {
    return undefined;
  }

  return {
    edges: report.workflowBuilderProposal.edges.map((edge, index) => ({
      animated: true,
      id: `proposal-edge-${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      style: { stroke: '#06b6d4', strokeWidth: 2 },
      target: edge.target,
    })),
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-workflow-builder-proposal-canvas',
    nodes: report.workflowBuilderProposal.nodes.map((node, index) => ({
      data: {
        agenticType: node.agenticType,
        description: node.description,
        errorMessages: [],
        iconName: workflowNodeIcon({ type: node.agenticType }),
        label: node.label,
        status: 'pending',
        type: node.type,
      },
      id: node.id,
      position: { x: 250, y: 50 + index * 150 },
      type: 'customNode',
    })),
    schemaVersion: 1,
    source: {
      proposalFile: report.workflowBuilderProposal.file,
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
    summary: report.workflowBuilderProposal.summary,
  };
}

export function buildAgenticCodingWorkflowProgressSnapshot(
  report: AgenticCodingRunReport,
): AgenticCodingWorkflowProgressSnapshot {
  const statusCounts = report.workflow.nodes.reduce(
    (counts, node) => ({
      ...counts,
      [node.status]: counts[node.status] + 1,
    }),
    {
      blocked: 0,
      completed: 0,
      pending: 0,
      ready: 0,
      skipped: 0,
      total: report.workflow.nodes.length,
    } satisfies AgenticCodingWorkflowProgressSnapshot['counts'],
  );
  const firstNodeError = report.workflow.nodeErrors[0];
  const activeNode = report.workflow.nodes.find((node) => node.id === report.workflow.activeNodeId);
  const nextAction: AgenticCodingWorkflowProgressSnapshot['nextAction'] = firstNodeError
    ? {
      message: firstNodeError.message,
      nodeId: firstNodeError.nodeId,
      type: 'inspect_blocker',
    }
    : report.approval.state === 'needs_approval'
      ? {
        message: 'Review the scoped edit preview before applying changes.',
        nodeId: 'edit-preview',
        type: 'approve_preview',
      }
      : activeNode
        ? {
          message: `Continue with: ${activeNode.label}.`,
          nodeId: activeNode.id,
          type: 'continue',
        }
        : {
          message: 'Workflow has no pending action.',
          type: 'complete',
        };

  return {
    activeNodeId: report.workflow.activeNodeId,
    approvalState: report.approval.state,
    blockedNodeIds: report.workflow.blockedNodeIds,
    completedNodeIds: report.workflow.completedNodeIds,
    counts: statusCounts,
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-workflow-progress',
    nextAction,
    nodeErrors: report.workflow.nodeErrors,
    nodes: report.workflow.nodes.map((node) => ({
      errorMessages: report.workflow.nodeErrors
        .filter((error) => error.nodeId === node.id)
        .map((error) => error.message),
      id: node.id,
      label: node.label,
      status: node.status,
      type: node.type,
    })),
    schemaVersion: 1,
    source: {
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
  };
}

function workflowEventSeverity(
  node: AgenticCodingWorkflowNode,
  activeNodeId?: string,
): AgenticCodingWorkflowEventSeverity {
  if (node.status === 'blocked') {
    return 'error';
  }

  if (node.status === 'completed' || node.status === 'skipped') {
    return 'success';
  }

  return node.id === activeNodeId ? 'warning' : 'info';
}

export function buildAgenticCodingWorkflowEventsSnapshot(
  report: AgenticCodingRunReport,
): AgenticCodingWorkflowEventsSnapshot {
  return {
    activeNodeId: report.workflow.activeNodeId,
    events: report.workflow.nodes.map((node, index) => {
      const errorMessages = report.workflow.nodeErrors
        .filter((error) => error.nodeId === node.id)
        .map((error) => error.message);

      return {
        active: node.id === report.workflow.activeNodeId,
        id: `workflow-event-${String(index + 1).padStart(2, '0')}-${node.id}`,
        message: errorMessages.length > 0 ? errorMessages.join('; ') : node.detail,
        nodeId: node.id,
        nodeType: node.type,
        sequence: index + 1,
        severity: workflowEventSeverity(node, report.workflow.activeNodeId),
        status: node.status,
      };
    }),
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-workflow-events',
    schemaVersion: 1,
    source: {
      approvalState: report.approval.state,
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
  };
}

function proposalLoopCommand(args: string[]): AgenticCodingProposalLoopCommand {
  return {
    args,
    executable: 'buddy',
  };
}

function proposalLoopStepStatus(input: {
  blocked?: boolean;
  completed?: boolean;
  ready?: boolean;
}): AgenticCodingPlanStepStatus {
  if (input.blocked) {
    return 'blocked';
  }

  if (input.completed) {
    return 'completed';
  }

  return input.ready ? 'ready' : 'pending';
}

function proposalLoopEventSeverity(
  step: AgenticCodingProposalLoopStep,
  activeStepId?: string,
): AgenticCodingWorkflowEventSeverity {
  if (step.status === 'blocked') {
    return 'error';
  }

  if (step.status === 'completed' || step.status === 'skipped') {
    return 'success';
  }

  return step.id === activeStepId ? 'warning' : 'info';
}

function proposalLoopEventMessage(
  step: AgenticCodingProposalLoopStep,
  nextAction: AgenticCodingProposalLoopSnapshot['nextAction'],
): string {
  if (step.id === nextAction.stepId) {
    return nextAction.message;
  }

  switch (step.status) {
    case 'blocked':
      return `${step.label} is blocked.`;
    case 'completed':
      return `${step.label} completed.`;
    case 'ready':
      return `${step.label} is ready.`;
    case 'skipped':
      return `${step.label} skipped.`;
    case 'pending':
      return `${step.label} is pending.`;
  }
}

function proposalLoopNodeType(stepId: string): AgenticCodingWorkflowNodeType {
  switch (stepId) {
    case 'prepare-edit-proposal-prompt':
    case 'produce-edit-proposal':
    case 'review-edit-proposal':
      return 'analysis';
    case 'preview-scoped-edits':
    case 'apply-approved-edits':
      return 'edit';
    case 'review-preview':
      return 'approval';
    case 'run-verification':
      return 'verification';
    case 'handoff':
      return 'handoff';
    default:
      return 'analysis';
  }
}

function buildProposalLoopNodes(
  steps: AgenticCodingProposalLoopStep[],
): AgenticCodingWorkflowNode[] {
  return steps.map((step) => ({
    detail: step.safety.join(' '),
    id: step.id,
    label: step.label,
    status: step.status,
    type: proposalLoopNodeType(step.id),
  }));
}

function buildProposalLoopEdges(
  steps: AgenticCodingProposalLoopStep[],
): AgenticCodingWorkflowEdge[] {
  return steps.slice(1).map((step, index) => ({
    animated: true,
    id: `proposal-loop-edge-${steps[index].id}-${step.id}`,
    source: steps[index].id,
    target: step.id,
  }));
}

function buildProposalLoopNextAction(
  report: AgenticCodingRunReport,
): AgenticCodingProposalLoopSnapshot['nextAction'] {
  const firstNodeError = report.workflow.nodeErrors[0];
  if (firstNodeError) {
    return {
      message: firstNodeError.message,
      stepId: firstNodeError.nodeId,
      type: 'inspect_blocker',
    };
  }

  const declaredEdits = report.contract?.edits.length ?? 0;
  const previewedEdits = report.editPreviews.filter((preview) => preview.status === 'previewed').length;
  const appliedEdits = report.editResults.filter((result) => result.status === 'applied').length;
  const hasVerificationCommands = (report.contract?.verification.length ?? 0) > 0;

  if (declaredEdits === 0) {
    return {
      message: 'Generate a controlled edit proposal JSON from the bundled prompt.',
      stepId: 'produce-edit-proposal',
      type: 'generate_edit_proposal',
    };
  }

  const editProposalErrors = report.validationErrors.filter((error) => error.startsWith('editProposalFile:'));
  if (editProposalErrors.length > 0) {
    return {
      message: 'Fix the controlled edit proposal JSON before previewing.',
      stepId: 'review-edit-proposal',
      type: 'fix_edit_proposal',
    };
  }

  if (report.editProposal && previewedEdits === 0) {
    return {
      message: 'Review the controlled edit proposal output before previewing.',
      stepId: 'review-edit-proposal',
      type: 'review_edit_proposal',
    };
  }

  if (previewedEdits === 0) {
    return {
      message: 'Preview the controlled edit proposal before requesting approval.',
      stepId: 'preview-scoped-edits',
      type: 'preview_edits',
    };
  }

  if (report.approval.state === 'needs_approval') {
    return {
      message: 'Review the scoped edit preview and write an approval decision JSON file.',
      stepId: 'review-preview',
      type: 'review_preview',
    };
  }

  if (report.approval.state === 'approved' && appliedEdits === 0) {
    return {
      message: 'Apply the approved scoped edits through the runner.',
      stepId: 'apply-approved-edits',
      type: 'apply_approved_edits',
    };
  }

  if (appliedEdits > 0 && hasVerificationCommands && report.verification.length === 0) {
    return {
      message: 'Run the declared verification commands after the approved edit.',
      stepId: 'run-verification',
      type: 'run_verification',
    };
  }

  return {
    message: 'Prepare the final handoff with report, workflow progress, and approval evidence.',
    stepId: 'handoff',
    type: 'handoff',
  };
}

function deriveAgenticCodingProposalLoopArtifacts(
  proposalLoopFile: string,
): AgenticCodingProposalLoopArtifacts {
  const baseDir = path.dirname(path.resolve(proposalLoopFile));

  return {
    applyReportFile: path.join(baseDir, 'apply-report.json'),
    approvalDecisionFile: path.join(baseDir, 'approval-decision.json'),
    approvalDecisionPromptFile: path.join(baseDir, 'approval-decision-prompt.md'),
    approvalFile: path.join(baseDir, 'approval-state.json'),
    editProposalFile: path.join(baseDir, 'edit-proposal.json'),
    editProposalProducerDispatchFile: path.join(baseDir, 'edit-proposal-producer-dispatch.json'),
    editProposalReviewFile: path.join(baseDir, 'edit-proposal-review.json'),
    previewReportFile: path.join(baseDir, 'preview-report.json'),
    proposalPromptFile: path.join(baseDir, 'edit-proposal-prompt.md'),
    workflowEventsFile: path.join(baseDir, 'workflow-events.json'),
    workflowProgressFile: path.join(baseDir, 'workflow-progress.json'),
  };
}

function deriveAgenticCodingProposalLoopArtifactBundlePaths(
  proposalLoopArtifactsDir: string,
): AgenticCodingProposalLoopArtifactBundlePaths {
  const baseDir = path.resolve(proposalLoopArtifactsDir);

  return {
    ...deriveAgenticCodingProposalLoopArtifacts(path.join(baseDir, 'proposal-loop.json')),
    artifactBundleFile: path.join(baseDir, 'artifact-bundle.json'),
    editProposalRequestFile: path.join(baseDir, 'edit-proposal-request.json'),
    proposalLoopNextActionFile: path.join(baseDir, 'proposal-loop-next-action.json'),
    proposalLoopCanvasFile: path.join(baseDir, 'proposal-loop-canvas.json'),
    proposalLoopFile: path.join(baseDir, 'proposal-loop.json'),
    seedReportFile: path.join(baseDir, 'seed-report.json'),
  };
}

export function buildAgenticCodingProposalLoopSnapshot(
  report: AgenticCodingRunReport,
  artifacts: AgenticCodingProposalLoopArtifacts,
): AgenticCodingProposalLoopSnapshot {
  const declaredEdits = report.contract?.edits.length ?? 0;
  const hasControlledEdits = declaredEdits > 0;
  const previewBlocked = report.editPreviews.some((preview) => preview.status !== 'previewed');
  const previewCompleted = report.editPreviews.length > 0 && !previewBlocked;
  const applyBlocked = report.editResults.some((result) => result.status !== 'applied');
  const applyCompleted = report.editResults.length > 0 && !applyBlocked;
  const verificationBlocked = report.verification.some((result) => result.status !== 'passed');
  const verificationCompleted = report.verification.length > 0 && !verificationBlocked;
  const hasVerificationCommands = (report.contract?.verification.length ?? 0) > 0;
  const blockedByPreflight = report.workflow.nodeErrors.length > 0;
  const editProposalBlocked = report.validationErrors.some((error) => error.startsWith('editProposalFile:'));
  const steps: AgenticCodingProposalLoopStep[] = [
    {
      command: proposalLoopCommand([
        'autonomous-code',
        '--task-file',
        report.taskFile,
        '--proposal-prompt-file',
        artifacts.proposalPromptFile,
        '--json',
      ]),
      id: 'prepare-edit-proposal-prompt',
      inputArtifacts: [report.taskFile],
      label: 'Prepare edit proposal prompt',
      outputArtifacts: [artifacts.proposalPromptFile],
      safety: [
        'Writes only a prompt artifact.',
        'Does not modify repository files.',
      ],
      status: proposalLoopStepStatus({
        blocked: !report.contract,
        completed: Boolean(report.contract),
      }),
    },
    {
      id: 'produce-edit-proposal',
      inputArtifacts: [artifacts.proposalPromptFile],
      label: 'Produce controlled edit proposal JSON',
      outputArtifacts: [artifacts.editProposalProducerDispatchFile, artifacts.editProposalFile],
      safety: [
        'Producer dispatch is data only.',
        'Agent output is data only.',
        'Runner validates paths, operation type, and expected occurrences before any write.',
      ],
      status: proposalLoopStepStatus({
        blocked: blockedByPreflight && !hasControlledEdits,
        completed: hasControlledEdits,
        ready: Boolean(report.contract),
      }),
    },
    {
      command: proposalLoopCommand([
        'autonomous-code',
        '--task-file',
        report.taskFile,
        '--edit-proposal-file',
        artifacts.editProposalFile,
        '--edit-proposal-review-file',
        artifacts.editProposalReviewFile,
        '--json',
      ]),
      id: 'review-edit-proposal',
      inputArtifacts: [report.taskFile, artifacts.editProposalFile],
      label: 'Review controlled edit proposal',
      outputArtifacts: [artifacts.editProposalReviewFile],
      safety: [
        'Validates producer output only.',
        'Does not preview, apply, approve, or run verification commands.',
      ],
      status: proposalLoopStepStatus({
        blocked: editProposalBlocked,
        completed: hasControlledEdits && !editProposalBlocked && (!report.editProposal || previewCompleted),
        ready: Boolean(report.editProposal) && !previewCompleted,
      }),
    },
    {
      command: proposalLoopCommand([
        'autonomous-code',
        '--task-file',
        report.taskFile,
        '--edit-proposal-file',
        artifacts.editProposalFile,
        '--preview-edits',
        '--approval-file',
        artifacts.approvalFile,
        '--approval-decision-prompt-file',
        artifacts.approvalDecisionPromptFile,
        '--workflow-progress-file',
        artifacts.workflowProgressFile,
        '--workflow-events-file',
        artifacts.workflowEventsFile,
        '--report-file',
        artifacts.previewReportFile,
        '--json',
      ]),
      id: 'preview-scoped-edits',
      inputArtifacts: [report.taskFile, artifacts.editProposalFile, artifacts.editProposalReviewFile],
      label: 'Preview scoped edits',
      outputArtifacts: [
        artifacts.previewReportFile,
        artifacts.approvalFile,
        artifacts.approvalDecisionPromptFile,
        artifacts.workflowProgressFile,
        artifacts.workflowEventsFile,
      ],
      safety: [
        'Runs in preview mode only.',
        'Produces approval and workflow artifacts before any apply.',
      ],
      status: proposalLoopStepStatus({
        blocked: previewBlocked,
        completed: previewCompleted,
        ready: hasControlledEdits && (!report.editProposal || previewCompleted),
      }),
    },
    {
      id: 'review-preview',
      inputArtifacts: [artifacts.approvalFile, artifacts.approvalDecisionPromptFile],
      label: 'Review preview and write approval decision',
      outputArtifacts: [artifacts.approvalDecisionFile],
      safety: [
        'Approval decision is JSON data only.',
        'A rejected or missing decision blocks apply when approval is required.',
      ],
      status: proposalLoopStepStatus({
        blocked: report.approval.state === 'rejected',
        completed: report.approval.state === 'approved',
        ready: report.approval.state === 'needs_approval',
      }),
    },
    {
      command: proposalLoopCommand([
        'autonomous-code',
        '--task-file',
        report.taskFile,
        '--edit-proposal-file',
        artifacts.editProposalFile,
        '--approval-decision-file',
        artifacts.approvalDecisionFile,
        '--require-approval',
        '--apply-edits',
        '--run-verification',
        '--report-file',
        artifacts.applyReportFile,
        '--json',
      ]),
      id: 'apply-approved-edits',
      inputArtifacts: [report.taskFile, artifacts.editProposalFile, artifacts.approvalDecisionFile],
      label: 'Apply approved scoped edits',
      outputArtifacts: [artifacts.applyReportFile],
      safety: [
        'Requires an approved decision file.',
        'Runner previews again before applying.',
        'Writes only validated replace_text edits inside allowedPaths.',
      ],
      status: proposalLoopStepStatus({
        blocked: applyBlocked || report.approval.state === 'rejected',
        completed: applyCompleted,
        ready: report.approval.state === 'approved',
      }),
    },
    {
      command: proposalLoopCommand([
        'autonomous-code',
        '--task-file',
        report.taskFile,
        '--edit-proposal-file',
        artifacts.editProposalFile,
        '--approval-decision-file',
        artifacts.approvalDecisionFile,
        '--require-approval',
        '--apply-edits',
        '--run-verification',
        '--report-file',
        artifacts.applyReportFile,
        '--json',
      ]),
      id: 'run-verification',
      inputArtifacts: [artifacts.applyReportFile],
      label: 'Run declared verification',
      outputArtifacts: [artifacts.applyReportFile],
      safety: [
        'Runs only commands declared in the task contract.',
        'Command validator still blocks dangerous verification commands.',
      ],
      status: proposalLoopStepStatus({
        blocked: verificationBlocked,
        completed: verificationCompleted,
        ready: applyCompleted && hasVerificationCommands,
      }),
    },
    {
      id: 'handoff',
      inputArtifacts: [
        artifacts.previewReportFile,
        artifacts.applyReportFile,
        artifacts.workflowProgressFile,
        artifacts.workflowEventsFile,
      ],
      label: 'Handoff evidence',
      outputArtifacts: [],
      safety: [
        'Summarizes reports and artifacts.',
        'Does not push, deploy, or mutate unrelated files.',
      ],
      status: proposalLoopStepStatus({
        completed: report.status === 'verified',
        ready: report.status === 'edited',
      }),
    },
  ];
  const nextAction = buildProposalLoopNextAction(report);
  const activeStepId = nextAction.stepId;
  const counts = steps.reduce(
    (summary, step) => ({
      ...summary,
      [step.status]: summary[step.status] + 1,
    }),
    {
      blocked: 0,
      completed: 0,
      pending: 0,
      ready: 0,
      skipped: 0,
      total: steps.length,
    } satisfies AgenticCodingProposalLoopSnapshot['counts'],
  );
  const nodes = buildProposalLoopNodes(steps);

  return {
    ...(nextAction.stepId ? { activeStepId: nextAction.stepId } : {}),
    artifacts,
    blockedStepIds: steps.filter((step) => step.status === 'blocked').map((step) => step.id),
    completedStepIds: steps.filter((step) => step.status === 'completed').map((step) => step.id),
    counts,
    edges: buildProposalLoopEdges(steps),
    events: steps.map((step, index) => ({
      active: step.id === activeStepId,
      id: `proposal-loop-event-${step.id}`,
      message: proposalLoopEventMessage(step, nextAction),
      sequence: index + 1,
      severity: proposalLoopEventSeverity(step, activeStepId),
      status: step.status,
      stepId: step.id,
    })),
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-proposal-loop',
    nextAction,
    nodes,
    prompts: {
      approvalDecision: renderAgenticCodingApprovalDecisionPrompt(report),
      editProposal: renderAgenticCodingEditProposalPrompt(report, { includeDirtyFiles: true }),
    },
    schemaVersion: 1,
    source: {
      ...(report.workflow.activeNodeId ? { activeNodeId: report.workflow.activeNodeId } : {}),
      approvalState: report.approval.state,
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
    steps,
  };
}

export function buildAgenticCodingEditProposalRequest(
  report: AgenticCodingRunReport,
  artifacts: AgenticCodingProposalLoopArtifactBundlePaths,
): AgenticCodingEditProposalRequest {
  const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);

  return {
    generatedAt: report.generatedAt,
    input: {
      proposalPromptFile: artifacts.proposalPromptFile,
      taskFile: report.taskFile,
    },
    instructions: [
      'Read the proposal prompt file.',
      'Inspect only the repository files needed to produce a bounded proposal.',
      'Write only valid JSON to the edit proposal file.',
      'Do not modify repository files directly.',
      'Do not run shell commands, push, deploy, delete, rename, or rewrite broad areas.',
    ],
    kind: 'agentic-coding-edit-proposal-request',
    output: {
      editProposalFile: artifacts.editProposalFile,
      schema: editProposalOutputSchema(),
    },
    safety: [
      'This request is data-only and never applies edits by itself.',
      'The runner validates edit paths, operation type, and occurrence counts.',
      'A later preview and approval decision are still required before apply.',
    ],
    schemaVersion: 1,
    source: {
      ...(loop.activeStepId ? { activeStepId: loop.activeStepId } : {}),
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
  };
}

function editProposalOutputSchema(): Record<string, unknown> {
  return {
    summary: 'Short description of the intended change.',
    producer: 'agent-name-or-role',
    risks: ['Known risks or "none".'],
    verificationNotes: ['Commands or checks that should prove the change.'],
    edits: [{
      expectedOccurrences: 1,
      find: 'exact existing text to replace',
      path: 'relative/path/inside/allowedPaths',
      replace: 'replacement text',
      type: 'replace_text',
    }],
  };
}

export function buildAgenticCodingEditProposalProducerDispatch(
  report: AgenticCodingRunReport,
  artifacts: AgenticCodingProposalLoopArtifacts,
): AgenticCodingEditProposalProducerDispatch {
  const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);
  const maxToolRounds = report.contract?.maxToolRounds ?? 50;

  return {
    allowedTools: [
      'file_read',
      'rg',
      'git_status',
    ],
    currentState: {
      ...(loop.activeStepId ? { activeStepId: loop.activeStepId } : {}),
      approvalState: report.approval.state,
      workflow: report.workflow,
    },
    disallowedActions: [
      'apply_patch',
      'file_write',
      'shell_exec',
      'delete_file',
      'move_file',
      'push',
      'deploy',
    ],
    generatedAt: report.generatedAt,
    input: {
      proposalPromptFile: artifacts.proposalPromptFile,
      repo: report.repo,
      taskFile: report.taskFile,
    },
    kind: 'agentic-coding-edit-proposal-producer-dispatch',
    messages: [
      {
        content: [
          'You are Code Buddy\'s edit-proposal producer.',
          'Read the user prompt, inspect only the bounded repository context needed, and return data only.',
          'Do not modify files, run broad shell commands, push, deploy, or approve your own output.',
        ].join('\n'),
        role: 'system',
      },
      {
        content: renderAgenticCodingEditProposalPrompt(report, { includeDirtyFiles: true }),
        role: 'user',
      },
    ],
    output: {
      editProposalFile: artifacts.editProposalFile,
      reviewCommand: proposalLoopCommand([
        'autonomous-code',
        '--task-file',
        report.taskFile,
        '--edit-proposal-file',
        artifacts.editProposalFile,
        '--edit-proposal-review-file',
        artifacts.editProposalReviewFile,
        '--json',
      ]),
      schema: editProposalOutputSchema(),
    },
    runPolicy: {
      cwd: report.repo,
      maxToolRounds,
      mode: 'data_only_edit_proposal',
    },
    safety: [
      'This dispatch is an invocation boundary only; it does not execute an agent.',
      'The producer may inspect files but must write only the edit proposal JSON artifact.',
      'The review command validates producer output before preview or apply.',
    ],
    schemaVersion: 1,
    source: {
      ...(loop.activeStepId ? { activeStepId: loop.activeStepId } : {}),
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
  };
}

function proposalLoopRunState(
  step: AgenticCodingProposalLoopStep | undefined,
): AgenticCodingProposalLoopRunState {
  if (!step || step.status === 'blocked') {
    return 'blocked';
  }

  if (step.command && step.status === 'ready') {
    return 'ready_command';
  }

  if (step.status === 'ready') {
    return 'human_input_required';
  }

  return 'pending';
}

function proposalLoopCommandArgText(arg: string): string {
  if (/^[A-Za-z0-9._:/\\=@-]+$/.test(arg)) {
    return arg;
  }

  return JSON.stringify(arg);
}

function proposalLoopCommandText(command: AgenticCodingProposalLoopCommand): string {
  return [command.executable, ...command.args].map(proposalLoopCommandArgText).join(' ');
}

function proposalLoopNextActionUi(input: {
  activeStep: AgenticCodingProposalLoopStep | undefined;
  nextAction: AgenticCodingProposalLoopSnapshot['nextAction'];
  runState: AgenticCodingProposalLoopRunState;
}): AgenticCodingProposalLoopNextActionUi {
  const artifactHints = {
    inputArtifacts: input.activeStep?.inputArtifacts ?? [],
    outputArtifacts: input.activeStep?.outputArtifacts ?? [],
  };
  const stepLabel = input.activeStep?.label ?? input.nextAction.type.replace(/_/g, ' ');

  if (input.runState === 'ready_command' && input.activeStep?.command) {
    return {
      artifactHints,
      primaryAction: {
        commandText: proposalLoopCommandText(input.activeStep.command),
        enabled: true,
        label: `Run: ${stepLabel}`,
        type: 'run_command',
      },
      statusText: input.nextAction.message,
    };
  }

  if (input.runState === 'human_input_required') {
    return {
      artifactHints,
      primaryAction: {
        disabledReason: input.nextAction.message,
        enabled: false,
        label: `Review: ${stepLabel}`,
        type: 'human_review',
      },
      statusText: input.nextAction.message,
    };
  }

  if (input.runState === 'blocked') {
    return {
      artifactHints,
      primaryAction: {
        disabledReason: input.nextAction.message,
        enabled: false,
        label: 'Inspect blocker',
        type: 'inspect_blocker',
      },
      statusText: input.nextAction.message,
    };
  }

  return {
    artifactHints,
    primaryAction: {
      disabledReason: input.nextAction.message,
      enabled: false,
      label: `Wait: ${stepLabel}`,
      type: 'wait',
    },
    statusText: input.nextAction.message,
  };
}

export function buildAgenticCodingProposalLoopNextActionSnapshot(
  report: AgenticCodingRunReport,
  artifacts: AgenticCodingProposalLoopArtifacts,
): AgenticCodingProposalLoopNextActionSnapshot {
  const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);
  const activeStep = loop.steps.find((step) => step.id === loop.nextAction.stepId);
  const runState = proposalLoopRunState(activeStep);

  return {
    ...(activeStep
      ? {
        activeStep: {
          ...(activeStep.command ? { command: activeStep.command } : {}),
          id: activeStep.id,
          inputArtifacts: activeStep.inputArtifacts,
          label: activeStep.label,
          outputArtifacts: activeStep.outputArtifacts,
          safety: activeStep.safety,
          status: activeStep.status,
        },
      }
      : {}),
    artifacts,
    canRunCommand: runState === 'ready_command',
    counts: loop.counts,
    generatedAt: loop.generatedAt,
    kind: 'agentic-coding-proposal-loop-next-action',
    nextAction: loop.nextAction,
    runState,
    schemaVersion: 1,
    source: {
      ...(loop.activeStepId ? { activeStepId: loop.activeStepId } : {}),
      approvalState: loop.source.approvalState,
      repo: loop.source.repo,
      status: loop.source.status,
      taskFile: loop.source.taskFile,
    },
    ui: proposalLoopNextActionUi({
      activeStep,
      nextAction: loop.nextAction,
      runState,
    }),
  };
}

export function buildAgenticCodingProposalLoopCoworkImport(
  report: AgenticCodingRunReport,
  artifacts: AgenticCodingProposalLoopArtifactBundlePaths,
): AgenticCodingProposalLoopCoworkImport {
  const nextAction = buildAgenticCodingProposalLoopNextActionSnapshot(report, artifacts);
  const suggestedFocusPanelId =
    nextAction.runState === 'ready_command' ? 'next-action'
      : nextAction.runState === 'human_input_required' ? 'approval'
      : nextAction.runState === 'blocked' ? 'events'
      : 'canvas';

  return {
    defaultPanelId: 'canvas',
    panels: [
      {
        artifactPath: artifacts.proposalLoopCanvasFile,
        id: 'canvas',
        role: 'proposal_loop_canvas',
        title: 'Workflow canvas',
        view: 'canvas',
      },
      {
        artifactPath: artifacts.proposalLoopNextActionFile,
        id: 'next-action',
        role: 'proposal_loop_next_action',
        title: 'Next action',
        view: 'queue',
      },
      {
        artifactPath: artifacts.approvalFile,
        id: 'approval',
        role: 'approval_state',
        title: 'Approval state',
        view: 'review',
      },
      {
        artifactPath: artifacts.editProposalRequestFile,
        id: 'producer-request',
        role: 'edit_proposal_request',
        title: 'Producer request',
        view: 'prompt',
      },
      {
        artifactPath: artifacts.editProposalProducerDispatchFile,
        id: 'producer-dispatch',
        role: 'edit_proposal_producer_dispatch',
        title: 'Producer dispatch',
        view: 'prompt',
      },
      {
        artifactPath: artifacts.editProposalReviewFile,
        id: 'producer-review',
        role: 'edit_proposal_review',
        title: 'Producer review',
        view: 'review',
      },
      {
        artifactPath: artifacts.workflowEventsFile,
        id: 'events',
        role: 'workflow_events',
        title: 'Activity timeline',
        view: 'timeline',
      },
      {
        artifactPath: artifacts.seedReportFile,
        id: 'seed-report',
        role: 'seed_report',
        title: 'Seed report',
        view: 'evidence',
      },
      {
        artifactPath: artifacts.artifactBundleFile,
        id: 'manifest',
        role: 'artifact_manifest',
        title: 'Artifact manifest',
        view: 'manifest',
      },
    ],
    primaryArtifactPath: artifacts.proposalLoopFile,
    queueArtifactPath: artifacts.proposalLoopNextActionFile,
    requiredArtifactPaths: [
      artifacts.proposalLoopFile,
      artifacts.proposalLoopCanvasFile,
      artifacts.proposalLoopNextActionFile,
      artifacts.approvalFile,
      artifacts.workflowEventsFile,
    ],
    schemaVersion: 1,
    suggestedFocusPanelId,
    summary: `Import Agentic Coding proposal loop workspace for: ${report.contract?.task ?? report.taskFile}`,
  };
}

export function buildAgenticCodingProposalLoopArtifactBundle(
  report: AgenticCodingRunReport,
  artifacts: AgenticCodingProposalLoopArtifactBundlePaths,
): AgenticCodingProposalLoopArtifactBundle {
  const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);

  return {
    artifacts,
    coworkImport: buildAgenticCodingProposalLoopCoworkImport(report, artifacts),
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-proposal-loop-artifact-bundle',
    materialized: [
      {
        path: artifacts.proposalLoopFile,
        role: 'proposal_loop_packet',
        safety: 'Describes the safe route; does not execute commands.',
      },
      {
        path: artifacts.proposalLoopCanvasFile,
        role: 'proposal_loop_canvas',
        safety: 'Visualizes the safe route for Cowork; does not grant write authority.',
      },
      {
        path: artifacts.proposalPromptFile,
        role: 'edit_proposal_prompt',
        safety: 'Prompts for controlled JSON data only.',
      },
      {
        path: artifacts.editProposalRequestFile,
        role: 'edit_proposal_request',
        safety: 'Dispatch envelope for an agent to write edit proposal JSON only.',
      },
      {
        path: artifacts.editProposalProducerDispatchFile,
        role: 'edit_proposal_producer_dispatch',
        safety: 'Agent invocation boundary; describes read-only tools and expected JSON output only.',
      },
      {
        path: artifacts.editProposalReviewFile,
        role: 'edit_proposal_review',
        safety: 'Validates producer output before preview; does not apply edits.',
      },
      {
        path: artifacts.proposalLoopNextActionFile,
        role: 'proposal_loop_next_action',
        safety: 'Compact Cowork consumer hint; does not execute the next command.',
      },
      {
        path: artifacts.approvalDecisionPromptFile,
        role: 'approval_decision_prompt',
        safety: 'Prompts for review JSON data only.',
      },
      {
        path: artifacts.approvalFile,
        role: 'approval_state',
        safety: 'Queue-friendly status artifact; does not approve or apply edits.',
      },
      {
        path: artifacts.workflowProgressFile,
        role: 'workflow_progress',
        safety: 'UI status snapshot derived from the run report.',
      },
      {
        path: artifacts.workflowEventsFile,
        role: 'workflow_events',
        safety: 'Activity timeline derived from the run report.',
      },
      {
        path: artifacts.seedReportFile,
        role: 'seed_report',
        safety: 'Full run report captured before any loop step is executed by this bundle.',
      },
      {
        path: artifacts.artifactBundleFile,
        role: 'artifact_manifest',
        safety: 'Manifest of materialized artifacts for Cowork or an agent consumer.',
      },
    ],
    schemaVersion: 1,
    source: {
      ...(loop.activeStepId ? { activeStepId: loop.activeStepId } : {}),
      approvalState: report.approval.state,
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
  };
}

export async function runAgenticCodingCell(options: AgenticCodingRunOptions): Promise<AgenticCodingRunReport> {
  const taskFile = path.resolve(options.taskFile);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const approvalDecisionRequired = Boolean(options.requireApproval && options.applyEdits);
  const editPreviewRequired = Boolean(
    (options.requirePreview || options.requireApproval || options.approvalDecisionFile) && options.applyEdits,
  );
  const editPreviewRequested = Boolean(options.previewEdits || editPreviewRequired);
  const validationErrors: string[] = [];
  const blockedReasons: string[] = [];
  let contract: AgenticCodingTaskContract | undefined;
  let approvalDecision: AgenticCodingApprovalDecisionReport | undefined;
  let editProposal: AgenticCodingEditProposalReport | undefined;
  let workflowBuilderProposal: AgenticCodingWorkflowBuilderProposalReport | undefined;

  try {
    const input = await readJsonFile(taskFile);
    const validation = validateAgenticCodingTaskContract(input);
    if (validation.success) {
      contract = validation.contract;
    } else {
      validationErrors.push(...validation.errors);
    }
  } catch (error) {
    validationErrors.push(`taskFile: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (contract && options.editProposalFile) {
    const proposalFile = path.resolve(options.editProposalFile);
    try {
      const input = await readJsonFile(proposalFile);
      const validation = validateAgenticCodingEditProposal(input);
      if (validation.success) {
        contract = mergeEditProposal(contract, validation.proposal);
        editProposal = summarizeEditProposal(validation.proposal, proposalFile);
      } else {
        validationErrors.push(...validation.errors.map((error) => `editProposalFile: ${error}`));
      }
    } catch (error) {
      validationErrors.push(`editProposalFile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (contract && options.approvalDecisionFile) {
    const decisionFile = path.resolve(options.approvalDecisionFile);
    try {
      const input = await readJsonFile(decisionFile);
      const validation = validateAgenticCodingApprovalDecision(input);
      if (validation.success) {
        approvalDecision = summarizeApprovalDecision(validation.decision, decisionFile);
      } else {
        validationErrors.push(...validation.errors.map((error) => `approvalDecisionFile: ${error}`));
      }
    } catch (error) {
      validationErrors.push(`approvalDecisionFile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (contract && options.workflowBuilderProposalFile) {
    const proposalFile = path.resolve(options.workflowBuilderProposalFile);
    try {
      const input = await readJsonFile(proposalFile);
      const validation = validateAgenticCodingWorkflowBuilderProposal(input);
      if (validation.success) {
        workflowBuilderProposal = summarizeWorkflowBuilderProposal(validation.proposal, proposalFile);
      } else {
        validationErrors.push(...validation.errors.map((error) => `workflowBuilderProposalFile: ${error}`));
      }
    } catch (error) {
      validationErrors.push(`workflowBuilderProposalFile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const repo = contract?.repo ?? '';
  const rulesFiles = contract ? await collectRulesFiles(contract.repo) : [];
  const executionGate = contract ? assessAgenticCodingExecutionGate(contract) : undefined;
  let dirtyFiles: AgenticCodingDirtyFile[] = [];
  const editPreviews: AgenticCodingEditPreview[] = [];
  const editResults: AgenticCodingEditResult[] = [];
  let gitStatus: string | undefined;
  const verification: AgenticCodingVerificationResult[] = [];

  if (!contract) {
    const plan = buildExecutionPlan({
      approvalDecision,
      approvalDecisionRequired,
      blockedReasons,
      dirtyFiles,
      editProposal,
      editPreviewRequired,
      editPreviewRequested,
      editPreviews,
      editRequested: Boolean(options.applyEdits),
      editResults,
      rulesFiles,
      validationErrors,
      verification,
      verificationRequested: Boolean(options.runVerification),
    });

    return {
      approval: buildApprovalReport({
        approvalDecision,
        blockedReasons,
        editPreviewRequired,
        editPreviews,
        editResults,
        validationErrors,
      }),
      approvalDecision,
      autoExecutable: false,
      blockedReasons,
      dirtyFiles,
      editProposal,
      editPreviewRequired,
      editPreviewRequested,
      editPreviews,
      editRequested: Boolean(options.applyEdits),
      editResults,
      generatedAt,
      plan,
      repo,
      rulesFiles,
      status: 'validation_failed',
      taskFile,
      validationErrors,
      verification,
      verificationRequested: Boolean(options.runVerification),
      workflow: buildWorkflowReport(plan),
      workflowBuilderProposal,
    };
  }

  const repoExists = await pathExists(contract.repo);
  if (!repoExists) {
    blockedReasons.push(`repo does not exist: ${contract.repo}`);
  }

  const git = repoExists
    ? await collectGitStatus(contract.repo, contract)
    : { dirtyFiles: [], reason: 'repo does not exist' };
  dirtyFiles = git.dirtyFiles;
  gitStatus = git.gitStatus;
  if (git.reason) {
    blockedReasons.push(git.reason);
  }

  const dirtyOutsideScope = dirtyFiles.filter((file) => !file.allowed);
  if (dirtyOutsideScope.length > 0) {
    blockedReasons.push(
      `dirty files outside allowedPaths: ${dirtyOutsideScope.map((file) => file.path).join(', ')}`
    );
  }

  const editsOutsideScope = contract.edits.filter((edit) =>
    !isPathAllowedByContract(edit.path, contract.allowedPaths)
  );
  if (editsOutsideScope.length > 0) {
    blockedReasons.push(
      `declared edit paths outside allowedPaths: ${editsOutsideScope.map((edit) => edit.path).join(', ')}`
    );
  }

  if (executionGate && !executionGate.autoExecutable) {
    blockedReasons.push(...executionGate.reasons);
  }

  if (editPreviewRequested && validationErrors.length === 0 && blockedReasons.length === 0) {
    editPreviews.push(...await previewDeclaredEdits(contract));
    const failedPreviews = editPreviews.filter((preview) => preview.status !== 'previewed');
    if (failedPreviews.length > 0) {
      blockedReasons.push(
        `scoped edit preview failed: ${failedPreviews.map((preview) => `${preview.path} (${preview.reason ?? preview.status})`).join(', ')}`
      );
    }
  }

  if (approvalDecision?.decision === 'rejected') {
    blockedReasons.push(`approval decision rejected scoped edits: ${approvalDecision.reason}`);
  } else if (approvalDecisionRequired && !approvalDecision) {
    blockedReasons.push('approval decision file is required before applying scoped edits');
  }

  if (options.applyEdits && validationErrors.length === 0 && blockedReasons.length === 0) {
    editResults.push(...await applyDeclaredEdits(contract));
    const failedEdits = editResults.filter((result) => result.status !== 'applied');
    if (failedEdits.length > 0) {
      blockedReasons.push(
        `scoped edits failed: ${failedEdits.map((result) => `${result.path} (${result.reason ?? result.status})`).join(', ')}`
      );
    }
  }

  if (options.runVerification && validationErrors.length === 0 && blockedReasons.length === 0) {
    verification.push(...await runVerificationCommands(
      contract,
      options.verificationTimeoutMs ?? 120000,
    ));
  }

  const verificationFailed = verification.some((result) => result.status !== 'passed');
  const status: AgenticCodingRunStatus =
    validationErrors.length > 0 ? 'validation_failed'
      : blockedReasons.length > 0 ? 'blocked'
      : editResults.length > 0 && verification.length === 0 ? 'edited'
      : editPreviews.length > 0 && verification.length === 0 ? 'previewed'
      : verification.length === 0 ? 'ready'
      : verificationFailed ? 'verification_failed'
      : 'verified';
  const plan = buildExecutionPlan({
    approvalDecision,
    approvalDecisionRequired,
    blockedReasons,
    contract,
    dirtyFiles,
    editProposal,
    editPreviewRequired,
    editPreviewRequested,
    editPreviews,
    editRequested: Boolean(options.applyEdits),
    editResults,
    rulesFiles,
    validationErrors,
    verification,
    verificationRequested: Boolean(options.runVerification),
  });

  return {
    approval: buildApprovalReport({
      approvalDecision,
      blockedReasons,
      contract,
      editPreviewRequired,
      editPreviews,
      editResults,
      validationErrors,
    }),
    approvalDecision,
    autoExecutable: validationErrors.length === 0 && blockedReasons.length === 0,
    blockedReasons,
    contract,
    dirtyFiles,
    editProposal,
    editPreviewRequired,
    editPreviewRequested,
    editPreviews,
    editRequested: Boolean(options.applyEdits),
    editResults,
    executionGate,
    generatedAt,
    gitStatus,
    plan,
    repo: contract.repo,
    rulesFiles,
    status,
    taskFile,
    validationErrors,
    verification,
    verificationRequested: Boolean(options.runVerification),
    workflow: buildWorkflowReport(plan),
    workflowBuilderProposal,
  };
}

export function buildAgenticCodingApprovalSnapshot(
  report: AgenticCodingRunReport,
): AgenticCodingApprovalSnapshot {
  const files = Array.from(new Set([
    ...(report.contract?.edits.map((edit) => edit.path) ?? []),
    ...report.editPreviews.map((preview) => preview.path),
    ...report.editResults.map((result) => result.path),
  ]));
  const blockedCount =
    report.editPreviews.filter((preview) => preview.status !== 'previewed').length
    + report.editResults.filter((result) => result.status !== 'applied').length;
  const blockedNodeId = report.workflow.blockedNodeIds[0] ?? report.workflow.activeNodeId;
  const nextAction: AgenticCodingApprovalSnapshot['nextAction'] = (() => {
    switch (report.approval.state) {
      case 'draft':
        return {
          message: 'Run a scoped edit preview before requesting approval.',
          nodeId: 'edit-preview',
          type: 'preview_required',
        };
      case 'needs_approval':
        return {
          message: report.approval.reason,
          nodeId: 'edit-preview',
          type: 'review_preview',
        };
      case 'rejected':
        return blockedNodeId
          ? {
            message: report.approval.reason,
            nodeId: blockedNodeId,
            type: 'inspect_rejection',
          }
          : {
            message: report.approval.reason,
            type: 'inspect_rejection',
          };
      case 'approved':
        return {
          message: 'Approval gate is satisfied.',
          type: 'none',
        };
      case 'not_required':
        return {
          message: 'No approval action is required.',
          type: 'none',
        };
    }
  })();
  const proposal = report.editProposal
    ? {
      file: report.editProposal.file,
      risks: report.editProposal.risks,
      summary: report.editProposal.summary,
      verificationNotes: report.editProposal.verificationNotes,
      ...(report.editProposal.producer ? { producer: report.editProposal.producer } : {}),
    }
    : undefined;
  const decision = report.approvalDecision
    ? {
      decision: report.approvalDecision.decision,
      file: report.approvalDecision.file,
      reason: report.approvalDecision.reason,
      reviewer: report.approvalDecision.reviewer,
      ...(report.approvalDecision.decidedAt ? { decidedAt: report.approvalDecision.decidedAt } : {}),
    }
    : undefined;

  return {
    ...(decision ? { decision } : {}),
    editSummary: {
      applied: report.editResults.filter((result) => result.status === 'applied').length,
      blocked: blockedCount,
      declared: report.contract?.edits.length ?? 0,
      files,
      previewed: report.editPreviews.filter((preview) => preview.status === 'previewed').length,
      ...(proposal ? { proposal } : {}),
    },
    gateNodeIds: report.workflow.nodes
      .filter((node) => node.type === 'approval')
      .map((node) => node.id),
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-approval-state',
    nextAction,
    reason: report.approval.reason,
    requiredBeforeApply: report.approval.requiredBeforeApply,
    schemaVersion: 1,
    source: {
      ...(report.workflow.activeNodeId ? { activeNodeId: report.workflow.activeNodeId } : {}),
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
    state: report.approval.state,
  };
}

export function buildAgenticCodingEditProposalReviewSnapshot(
  report: AgenticCodingRunReport,
): AgenticCodingEditProposalReviewSnapshot {
  const editProposalErrors = report.validationErrors.filter((error) => error.startsWith('editProposalFile:'));
  const files = Array.from(new Set(report.contract?.edits.map((edit) => edit.path) ?? []));
  const proposal = report.editProposal;

  if (proposal) {
    return {
      editSummary: {
        declared: report.contract?.edits.length ?? proposal.editCount,
        files,
        proposal,
      },
      generatedAt: report.generatedAt,
      kind: 'agentic-coding-edit-proposal-review',
      nextAction: {
        message: 'Controlled edit proposal is valid; run preview before requesting approval.',
        stepId: 'preview-scoped-edits',
        type: 'preview_edits',
      },
      reason: `Accepted ${proposal.editCount} controlled edit proposal item(s).`,
      schemaVersion: 1,
      source: {
        proposalFile: proposal.file,
        repo: report.repo,
        status: report.status,
        taskFile: report.taskFile,
      },
      state: 'accepted',
      validationErrors: [],
    };
  }

  if (editProposalErrors.length > 0) {
    return {
      editSummary: {
        declared: 0,
        files: [],
      },
      generatedAt: report.generatedAt,
      kind: 'agentic-coding-edit-proposal-review',
      nextAction: {
        message: 'Fix the controlled edit proposal JSON before previewing.',
        stepId: 'produce-edit-proposal',
        type: 'fix_edit_proposal',
      },
      reason: editProposalErrors.join(' | '),
      schemaVersion: 1,
      source: {
        repo: report.repo,
        status: report.status,
        taskFile: report.taskFile,
      },
      state: 'rejected',
      validationErrors: editProposalErrors,
    };
  }

  return {
    editSummary: {
      declared: 0,
      files: [],
    },
    generatedAt: report.generatedAt,
    kind: 'agentic-coding-edit-proposal-review',
    nextAction: {
      message: 'Produce a controlled edit proposal JSON file from the request envelope.',
      stepId: 'produce-edit-proposal',
      type: 'produce_edit_proposal',
    },
    reason: 'No edit proposal file was loaded.',
    schemaVersion: 1,
    source: {
      repo: report.repo,
      status: report.status,
      taskFile: report.taskFile,
    },
    state: 'missing',
    validationErrors: [],
  };
}

export function renderAgenticCodingRunReport(report: AgenticCodingRunReport): string {
  const lines: string[] = [];
  lines.push(`Agentic Coding Cell: ${report.status}`);
  lines.push(`Task file: ${report.taskFile}`);
  if (report.repo) {
    lines.push(`Repo: ${report.repo}`);
  }

  if (report.contract) {
    lines.push(`Risk: ${report.contract.riskLevel}`);
    lines.push(`Allowed paths: ${report.contract.allowedPaths.join(', ')}`);
    lines.push(`Verification: ${report.contract.verification.join(' | ')}`);
  }

  lines.push(`Approval: ${report.approval.state}`);
  if (report.approval.requiredBeforeApply) {
    lines.push('Approval gate: preview required before apply');
  }
  lines.push(`Approval reason: ${report.approval.reason}`);

  if (report.approvalDecision) {
    lines.push(`Approval decision: ${report.approvalDecision.decision}`);
    lines.push(`Approval reviewer: ${report.approvalDecision.reviewer}`);
    lines.push(`Approval decision reason: ${report.approvalDecision.reason}`);
  }

  if (report.validationErrors.length > 0) {
    lines.push('\nValidation errors:');
    for (const error of report.validationErrors) {
      lines.push(`- ${error}`);
    }
  }

  if (report.blockedReasons.length > 0) {
    lines.push('\nBlocked reasons:');
    for (const reason of report.blockedReasons) {
      lines.push(`- ${reason}`);
    }
  }

  if (report.rulesFiles.length > 0) {
    lines.push('\nWorkspace rules:');
    for (const rule of report.rulesFiles) {
      lines.push(`- ${rule.path}: ${rule.present ? 'present' : 'missing'}`);
    }
  }

  if (report.dirtyFiles.length > 0) {
    lines.push('\nDirty files:');
    for (const file of report.dirtyFiles) {
      lines.push(`- ${file.status} ${file.path} (${file.allowed ? 'inside scope' : 'outside scope'})`);
    }
  }

  if (report.editProposal) {
    lines.push('\nEdit proposal:');
    lines.push(`- File: ${report.editProposal.file}`);
    lines.push(`- Summary: ${report.editProposal.summary}`);
    lines.push(`- Proposed edits: ${report.editProposal.editCount}`);
    if (report.editProposal.risks.length > 0) {
      lines.push(`- Risks: ${report.editProposal.risks.join(' | ')}`);
    }
  }

  if (report.workflowBuilderProposal) {
    lines.push('\nWorkflow builder proposal:');
    lines.push(`- File: ${report.workflowBuilderProposal.file}`);
    lines.push(`- Summary: ${report.workflowBuilderProposal.summary}`);
    lines.push(`- Nodes: ${report.workflowBuilderProposal.nodeCount}`);
    lines.push(`- Edges: ${report.workflowBuilderProposal.edgeCount}`);
    if (report.workflowBuilderProposal.approvalGates.length > 0) {
      lines.push(`- Approval gates: ${report.workflowBuilderProposal.approvalGates.join(' | ')}`);
    }
    if (report.workflowBuilderProposal.risks.length > 0) {
      lines.push(`- Risks: ${report.workflowBuilderProposal.risks.join(' | ')}`);
    }
  }

  if (report.editPreviewRequired) {
    lines.push('\nScoped edit preview was required before applying edits.');
  }

  if (report.editPreviewRequested && report.editPreviews.length === 0) {
    lines.push('\nScoped edit preview was requested but not run because the task is blocked.');
  }

  if (report.editPreviews.length > 0) {
    lines.push('\nScoped edit previews:');
    for (const preview of report.editPreviews) {
      lines.push(`- ${preview.status}: ${preview.path} (${preview.occurrences} occurrence(s))`);
      if (preview.reason) {
        lines.push(`  Reason: ${preview.reason}`);
      }
    }
  }

  if (report.editRequested && report.editResults.length === 0) {
    lines.push('\nScoped edits were requested but not run because the task is blocked.');
  }

  if (report.editResults.length > 0) {
    lines.push('\nScoped edit results:');
    for (const result of report.editResults) {
      lines.push(`- ${result.status}: ${result.path} (${result.occurrences} occurrence(s))`);
      if (result.reason) {
        lines.push(`  Reason: ${result.reason}`);
      }
    }
  }

  if (report.plan.length > 0) {
    lines.push('\nExecution plan:');
    for (const step of report.plan) {
      lines.push(`- ${step.status}: ${step.title}`);
      lines.push(`  ${step.detail}`);
    }
  }

  if (report.workflow.nodes.length > 0) {
    lines.push('\nWorkflow graph:');
    lines.push(`- Nodes: ${report.workflow.nodes.length}`);
    lines.push(`- Edges: ${report.workflow.edges.length}`);
    if (report.workflow.activeNodeId) {
      lines.push(`- Active node: ${report.workflow.activeNodeId}`);
    }
    if (report.workflow.blockedNodeIds.length > 0) {
      lines.push(`- Blocked nodes: ${report.workflow.blockedNodeIds.join(', ')}`);
    }
    if (report.workflow.nodeErrors.length > 0) {
      lines.push('- Node errors:');
      for (const error of report.workflow.nodeErrors) {
        lines.push(`  - ${error.nodeId}: ${error.message}`);
      }
    }
  }

  if (report.verificationRequested && report.verification.length === 0) {
    lines.push('\nVerification was requested but not run because the task is blocked.');
  }

  if (report.verification.length > 0) {
    lines.push('\nVerification results:');
    for (const result of report.verification) {
      lines.push(`- ${result.status}: ${result.command}`);
      if (result.reason) {
        lines.push(`  Reason: ${result.reason}`);
      }
    }
  }

  return lines.join('\n');
}

export async function writeAgenticCodingRunReport(
  report: AgenticCodingRunReport,
  reportFile: string,
): Promise<string> {
  const resolved = path.resolve(reportFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingApprovalSnapshot(
  report: AgenticCodingRunReport,
  approvalFile: string,
): Promise<string> {
  const resolved = path.resolve(approvalFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(buildAgenticCodingApprovalSnapshot(report), null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingEditProposalReviewSnapshot(
  report: AgenticCodingRunReport,
  editProposalReviewFile: string,
): Promise<string> {
  const resolved = path.resolve(editProposalReviewFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(buildAgenticCodingEditProposalReviewSnapshot(report), null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingWorkflowCanvas(
  report: AgenticCodingRunReport,
  workflowFile: string,
): Promise<string> {
  const resolved = path.resolve(workflowFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(buildAgenticCodingWorkflowCanvas(report), null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingWorkflowBuilderProposalCanvas(
  report: AgenticCodingRunReport,
  workflowBuilderProposalCanvasFile: string,
): Promise<string> {
  const canvas = buildAgenticCodingWorkflowBuilderProposalCanvas(report);
  if (!canvas) {
    throw new Error('workflow builder proposal is required before writing a proposal canvas');
  }

  const resolved = path.resolve(workflowBuilderProposalCanvasFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(canvas, null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingWorkflowProgressSnapshot(
  report: AgenticCodingRunReport,
  workflowProgressFile: string,
): Promise<string> {
  const resolved = path.resolve(workflowProgressFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(buildAgenticCodingWorkflowProgressSnapshot(report), null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingWorkflowEventsSnapshot(
  report: AgenticCodingRunReport,
  workflowEventsFile: string,
): Promise<string> {
  const resolved = path.resolve(workflowEventsFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(buildAgenticCodingWorkflowEventsSnapshot(report), null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingProposalLoopSnapshot(
  report: AgenticCodingRunReport,
  proposalLoopFile: string,
): Promise<string> {
  const resolved = path.resolve(proposalLoopFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    `${JSON.stringify(
      buildAgenticCodingProposalLoopSnapshot(report, deriveAgenticCodingProposalLoopArtifacts(resolved)),
      null,
      2,
    )}\n`,
    'utf8',
  );
  return resolved;
}

export async function writeAgenticCodingProposalLoopCanvas(
  report: AgenticCodingRunReport,
  proposalLoopCanvasFile: string,
): Promise<string> {
  const resolved = path.resolve(proposalLoopCanvasFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    `${JSON.stringify(
      buildAgenticCodingProposalLoopCanvas(
        buildAgenticCodingProposalLoopSnapshot(report, deriveAgenticCodingProposalLoopArtifacts(resolved)),
      ),
      null,
      2,
    )}\n`,
    'utf8',
  );
  return resolved;
}

export async function writeAgenticCodingProposalLoopNextActionSnapshot(
  report: AgenticCodingRunReport,
  proposalLoopNextActionFile: string,
): Promise<string> {
  const resolved = path.resolve(proposalLoopNextActionFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    `${JSON.stringify(
      buildAgenticCodingProposalLoopNextActionSnapshot(
        report,
        deriveAgenticCodingProposalLoopArtifacts(resolved),
      ),
      null,
      2,
    )}\n`,
    'utf8',
  );
  return resolved;
}

export async function writeAgenticCodingEditProposalProducerDispatch(
  report: AgenticCodingRunReport,
  editProposalProducerDispatchFile: string,
): Promise<string> {
  const resolved = path.resolve(editProposalProducerDispatchFile);
  const artifacts = {
    ...deriveAgenticCodingProposalLoopArtifacts(path.join(path.dirname(resolved), 'proposal-loop.json')),
    editProposalProducerDispatchFile: resolved,
  };
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    `${JSON.stringify(buildAgenticCodingEditProposalProducerDispatch(report, artifacts), null, 2)}\n`,
    'utf8',
  );
  return resolved;
}

export async function writeAgenticCodingProposalLoopArtifactBundle(
  report: AgenticCodingRunReport,
  proposalLoopArtifactsDir: string,
): Promise<string> {
  const artifacts = deriveAgenticCodingProposalLoopArtifactBundlePaths(proposalLoopArtifactsDir);
  const loop = buildAgenticCodingProposalLoopSnapshot(report, artifacts);
  const canvas = buildAgenticCodingProposalLoopCanvas(loop);
  const editProposalRequest = buildAgenticCodingEditProposalRequest(report, artifacts);
  const editProposalProducerDispatch = buildAgenticCodingEditProposalProducerDispatch(report, artifacts);
  const nextAction = buildAgenticCodingProposalLoopNextActionSnapshot(report, artifacts);
  const bundle = buildAgenticCodingProposalLoopArtifactBundle(report, artifacts);
  await fs.mkdir(path.dirname(artifacts.artifactBundleFile), { recursive: true });
  await Promise.all([
    fs.writeFile(artifacts.proposalLoopFile, `${JSON.stringify(loop, null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.proposalLoopCanvasFile, `${JSON.stringify(canvas, null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.proposalPromptFile, `${loop.prompts.editProposal}\n`, 'utf8'),
    fs.writeFile(artifacts.editProposalRequestFile, `${JSON.stringify(editProposalRequest, null, 2)}\n`, 'utf8'),
    fs.writeFile(
      artifacts.editProposalProducerDispatchFile,
      `${JSON.stringify(editProposalProducerDispatch, null, 2)}\n`,
      'utf8',
    ),
    fs.writeFile(
      artifacts.editProposalReviewFile,
      `${JSON.stringify(buildAgenticCodingEditProposalReviewSnapshot(report), null, 2)}\n`,
      'utf8',
    ),
    fs.writeFile(artifacts.proposalLoopNextActionFile, `${JSON.stringify(nextAction, null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.approvalDecisionPromptFile, `${loop.prompts.approvalDecision}\n`, 'utf8'),
    fs.writeFile(artifacts.approvalFile, `${JSON.stringify(buildAgenticCodingApprovalSnapshot(report), null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.workflowProgressFile, `${JSON.stringify(buildAgenticCodingWorkflowProgressSnapshot(report), null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.workflowEventsFile, `${JSON.stringify(buildAgenticCodingWorkflowEventsSnapshot(report), null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.seedReportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(artifacts.artifactBundleFile, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8'),
  ]);
  return artifacts.artifactBundleFile;
}

export async function writeAgenticCodingProposalLoopCoworkImport(
  report: AgenticCodingRunReport,
  proposalLoopCoworkImportFile: string,
): Promise<string> {
  const resolved = path.resolve(proposalLoopCoworkImportFile);
  const artifacts = deriveAgenticCodingProposalLoopArtifactBundlePaths(path.dirname(resolved));
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    `${JSON.stringify(buildAgenticCodingProposalLoopCoworkImport(report, artifacts), null, 2)}\n`,
    'utf8',
  );
  return resolved;
}

export async function buildAgenticCodingProposalLoopCoworkImportCheck(
  proposalLoopCoworkImportFile: string,
): Promise<AgenticCodingProposalLoopCoworkImportCheck> {
  const resolved = path.resolve(proposalLoopCoworkImportFile);
  const generatedAt = new Date().toISOString();
  let input: unknown;

  try {
    input = await readJsonFile(resolved);
  } catch (error) {
    return {
      generatedAt,
      kind: 'agentic-coding-proposal-loop-cowork-import-check',
      missingRequiredArtifactPaths: [],
      panels: [],
      primaryArtifactExists: false,
      queueArtifactExists: false,
      requiredArtifacts: [],
      schemaVersion: 1,
      source: { importFile: resolved },
      status: 'invalid',
      validationErrors: [`importFile: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const validation = parseAgenticCodingProposalLoopCoworkImport(input);
  if (!validation.coworkImport) {
    return {
      generatedAt,
      kind: 'agentic-coding-proposal-loop-cowork-import-check',
      missingRequiredArtifactPaths: [],
      panels: [],
      primaryArtifactExists: false,
      queueArtifactExists: false,
      requiredArtifacts: [],
      schemaVersion: 1,
      source: { importFile: resolved },
      status: 'invalid',
      validationErrors: validation.errors,
    };
  }

  const coworkImport = validation.coworkImport;
  const requiredArtifacts = await Promise.all(
    coworkImport.requiredArtifactPaths.map(async (artifactPath) => {
      const resolvedPath = resolveCoworkImportArtifactPath(resolved, artifactPath);
      return {
        exists: await pathExists(resolvedPath),
        path: artifactPath,
        resolvedPath,
      };
    }),
  );
  const requiredArtifactPathSet = new Set(requiredArtifacts.map((artifact) => artifact.resolvedPath));
  const panels = await Promise.all(
    coworkImport.panels.map(async (panel) => {
      const resolvedArtifactPath = resolveCoworkImportArtifactPath(resolved, panel.artifactPath);
      return {
        ...panel,
        exists: await pathExists(resolvedArtifactPath),
        required: requiredArtifactPathSet.has(resolvedArtifactPath),
        resolvedArtifactPath,
      };
    }),
  );
  const missingRequiredArtifactPaths = requiredArtifacts
    .filter((artifact) => !artifact.exists)
    .map((artifact) => artifact.path);
  const resolvedPrimaryArtifactPath = resolveCoworkImportArtifactPath(resolved, coworkImport.primaryArtifactPath);
  const resolvedQueueArtifactPath = resolveCoworkImportArtifactPath(resolved, coworkImport.queueArtifactPath);

  return {
    defaultPanelId: coworkImport.defaultPanelId,
    generatedAt,
    kind: 'agentic-coding-proposal-loop-cowork-import-check',
    missingRequiredArtifactPaths,
    panels,
    primaryArtifactPath: coworkImport.primaryArtifactPath,
    primaryArtifactExists: await pathExists(resolvedPrimaryArtifactPath),
    queueArtifactExists: await pathExists(resolvedQueueArtifactPath),
    requiredArtifacts,
    resolvedPrimaryArtifactPath,
    schemaVersion: 1,
    source: {
      importFile: resolved,
      summary: coworkImport.summary,
    },
    status: missingRequiredArtifactPaths.length > 0 ? 'missing_required' : 'ready',
    suggestedFocusPanelId: coworkImport.suggestedFocusPanelId,
    validationErrors: [],
  };
}

export function buildAgenticCodingProposalLoopCoworkWorkspace(
  check: AgenticCodingProposalLoopCoworkImportCheck,
  queue?: AgenticCodingProposalLoopCoworkWorkspaceQueue,
  stepper?: AgenticCodingProposalLoopCoworkWorkspaceStepper,
  activity?: AgenticCodingProposalLoopCoworkWorkspaceActivity,
  approval?: AgenticCodingProposalLoopCoworkWorkspaceApproval,
  commands?: AgenticCodingProposalLoopCoworkWorkspaceCommands,
  graph?: AgenticCodingProposalLoopCoworkWorkspaceGraph,
  producer?: AgenticCodingProposalLoopCoworkWorkspaceProducer,
  evidence?: AgenticCodingProposalLoopCoworkWorkspaceEvidence,
  manifest?: AgenticCodingProposalLoopCoworkWorkspaceManifest,
): AgenticCodingProposalLoopCoworkWorkspace {
  const availablePanelIds = check.panels.filter((panel) => panel.exists).map((panel) => panel.id);
  const unavailablePanelIds = check.panels.filter((panel) => !panel.exists).map((panel) => panel.id);
  const openPanelId = check.status === 'ready'
    ? [
      check.suggestedFocusPanelId,
      check.defaultPanelId,
      availablePanelIds[0],
    ].find((panelId): panelId is string => Boolean(panelId && availablePanelIds.includes(panelId)))
    : undefined;
  const openPanel = openPanelId ? check.panels.find((panel) => panel.id === openPanelId) : undefined;
  const status: AgenticCodingProposalLoopCoworkWorkspaceStatus =
    check.status === 'ready' ? 'ready'
      : check.status === 'missing_required' ? 'needs_artifacts'
      : 'invalid';
  const primaryAction = status === 'ready'
    ? {
      enabled: true,
      label: `Open ${openPanel?.title ?? 'workspace'}`,
      ...(openPanelId ? { panelId: openPanelId } : {}),
      type: 'open_panel' as const,
    }
    : status === 'needs_artifacts'
      ? {
        disabledReason: `${check.missingRequiredArtifactPaths.length} required artifact(s) missing.`,
        enabled: false,
        label: 'Resolve missing artifacts',
        type: 'resolve_missing' as const,
      }
      : {
        disabledReason: check.validationErrors[0] ?? 'Import manifest is invalid.',
        enabled: false,
        label: 'Fix import manifest',
        type: 'fix_import' as const,
      };
  const statusText = status === 'ready'
    ? `Workspace ready: ${availablePanelIds.length}/${check.panels.length} panels available.`
    : status === 'needs_artifacts'
      ? `Workspace missing ${check.missingRequiredArtifactPaths.length} required artifact(s).`
      : 'Import manifest invalid.';

  return {
    ...(activity ? { activity } : {}),
    ...(approval ? { approval } : {}),
    availablePanelIds,
    ...(commands ? { commands } : {}),
    defaultPanelId: check.defaultPanelId,
    ...(evidence ? { evidence } : {}),
    generatedAt: check.generatedAt,
    ...(graph ? { graph } : {}),
    kind: 'agentic-coding-proposal-loop-cowork-workspace',
    ...(manifest ? { manifest } : {}),
    missingRequiredArtifactPaths: check.missingRequiredArtifactPaths,
    ...(openPanelId ? { openPanelId } : {}),
    panels: check.panels.map((panel) => ({
      artifactPath: panel.artifactPath,
      available: panel.exists,
      id: panel.id,
      required: panel.required,
      resolvedArtifactPath: panel.resolvedArtifactPath,
      role: panel.role,
      title: panel.title,
      view: panel.view,
    })),
    ...(producer ? { producer } : {}),
    ...(queue ? { queue } : {}),
    schemaVersion: 1,
    source: {
      ...check.source,
      checkStatus: check.status,
    },
    status,
    ...(stepper ? { stepper } : {}),
    suggestedFocusPanelId: check.suggestedFocusPanelId,
    ui: {
      primaryAction,
      statusText,
    },
    unavailablePanelIds,
  };
}

export async function writeAgenticCodingProposalLoopCoworkImportCheck(
  proposalLoopCoworkImportFile: string,
  proposalLoopCoworkImportCheckFile: string,
): Promise<string> {
  const resolved = path.resolve(proposalLoopCoworkImportCheckFile);
  const check = await buildAgenticCodingProposalLoopCoworkImportCheck(proposalLoopCoworkImportFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(check, null, 2)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingProposalLoopCoworkWorkspace(
  proposalLoopCoworkImportFile: string,
  proposalLoopCoworkWorkspaceFile: string,
): Promise<string> {
  const resolved = path.resolve(proposalLoopCoworkWorkspaceFile);
  const check = await buildAgenticCodingProposalLoopCoworkImportCheck(proposalLoopCoworkImportFile);
  const queue = await buildAgenticCodingProposalLoopCoworkWorkspaceQueue(check);
  const stepper = await buildAgenticCodingProposalLoopCoworkWorkspaceStepper(check);
  const activity = await buildAgenticCodingProposalLoopCoworkWorkspaceActivity(check);
  const approval = await buildAgenticCodingProposalLoopCoworkWorkspaceApproval(check);
  const commands = await buildAgenticCodingProposalLoopCoworkWorkspaceCommands(check);
  const graph = await buildAgenticCodingProposalLoopCoworkWorkspaceGraph(check);
  const producer = await buildAgenticCodingProposalLoopCoworkWorkspaceProducer(check);
  const evidence = await buildAgenticCodingProposalLoopCoworkWorkspaceEvidence(check);
  const manifest = await buildAgenticCodingProposalLoopCoworkWorkspaceManifest(check);
  const workspace = buildAgenticCodingProposalLoopCoworkWorkspace(
    check,
    queue,
    stepper,
    activity,
    approval,
    commands,
    graph,
    producer,
    evidence,
    manifest,
  );
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
  return resolved;
}

export function renderAgenticCodingApprovalDecisionPrompt(report: AgenticCodingRunReport): string {
  if (!report.contract) {
    return [
      'Agentic Coding Cell approval decision prompt could not be generated.',
      '',
      'Validation errors:',
      ...report.validationErrors.map((error) => `- ${error}`),
    ].join('\n');
  }

  return [
    'You are reviewing an Agentic Coding Cell scoped edit preview.',
    '',
    'Return only valid JSON. Do not include Markdown fences or commentary.',
    '',
    'Required JSON schema:',
    JSON.stringify({
      kind: 'agentic-coding-approval-decision',
      schemaVersion: 1,
      decision: 'approved|rejected',
      reviewer: 'human-or-cowork-reviewer-id',
      reason: 'Short reason for the decision.',
      decidedAt: 'optional ISO-8601 timestamp',
    }, null, 2),
    '',
    'Decision rules:',
    '- Use decision "approved" only if every previewed edit is acceptable and inside the requested scope.',
    '- Use decision "rejected" if a preview is missing, ambiguous, outside scope, risky, or needs changes.',
    '- Do not propose file edits in this decision artifact.',
    '- The runner will validate this JSON and apply edits only when --require-approval sees decision "approved".',
    '',
    'Task contract:',
    `- Repo: ${report.contract.repo}`,
    `- Task: ${report.contract.task}`,
    `- Risk level: ${report.contract.riskLevel}`,
    `- Allowed paths: ${report.contract.allowedPaths.join(', ')}`,
    '',
    'Current approval state:',
    JSON.stringify(buildAgenticCodingApprovalSnapshot(report), null, 2),
    '',
    'Scoped edit previews:',
    ...(report.editPreviews.length > 0
      ? report.editPreviews.flatMap((preview) => [
        `- ${preview.status}: ${preview.path} (${preview.occurrences} occurrence(s))`,
        `  Before: ${JSON.stringify(preview.before)}`,
        `  After: ${JSON.stringify(preview.after)}`,
        ...(preview.reason ? [`  Reason: ${preview.reason}`] : []),
      ])
      : ['- No preview is available; reject unless a separate reviewed preview exists.']),
  ].join('\n');
}

export function renderAgenticCodingWorkflowBuilderPrompt(
  report: AgenticCodingRunReport,
  options: AgenticCodingWorkflowBuilderPromptOptions = {},
): string {
  if (!report.contract) {
    return [
      'Agentic Coding Cell workflow builder prompt could not be generated.',
      '',
      'Validation errors:',
      ...report.validationErrors.map((error) => `- ${error}`),
    ].join('\n');
  }

  const currentCanvas = options.includeCurrentCanvas === false
    ? []
    : [
      '',
      'Current runner canvas:',
      JSON.stringify(buildAgenticCodingWorkflowCanvas(report), null, 2),
    ];

  return [
    'You are designing a PostCommander-style workflow for the Agentic Coding Cell.',
    '',
    'Return only valid JSON. Do not include Markdown fences or commentary.',
    '',
    'Required JSON schema:',
    JSON.stringify({
      kind: 'agentic-coding-workflow-builder-proposal',
      schemaVersion: 1,
      summary: 'Short explanation of the proposed coding workflow.',
      nodes: [{
        id: 'contract',
        label: 'Validate task contract',
        description: 'What this node checks or performs.',
        agenticType: 'gate|analysis|approval|edit|verification|handoff',
        type: 'trigger|action|logic',
      }],
      edges: [{
        source: 'contract',
        target: 'workspace-rules',
      }],
      approvalGates: ['Human or Cowork approval points before file writes.'],
      coworkVisualizationNotes: ['How Cowork should display progress, errors, and evidence.'],
      risks: ['Known risks or "none".'],
    }, null, 2),
    '',
    'Task contract:',
    `- Repo: ${report.contract.repo}`,
    `- Task: ${report.contract.task}`,
    `- Risk level: ${report.contract.riskLevel}`,
    `- Allowed paths: ${report.contract.allowedPaths.join(', ')}`,
    `- Verification commands: ${report.contract.verification.join(' | ')}`,
    '',
    'Builder rules:',
    '- Preserve the existing safety order: contract, workspace rules, git preflight, gate, analysis, proposal, preview, approval, edit, verification, handoff.',
    '- Use graph nodes and edges only; do not propose direct file edits in this artifact.',
    '- Keep every write behind a preview and approval node.',
    '- Include progress and error visibility for Cowork.',
    '- Keep the workflow executable by a conservative runner; avoid speculative tools or hidden side effects.',
    '- If the task is blocked, make the blocked node explicit instead of inventing progress.',
    '',
    'Current run status:',
    `- Status: ${report.status}`,
    `- Approval state: ${report.approval.state}`,
    `- Active node: ${report.workflow.activeNodeId ?? 'none'}`,
    `- Blocked reasons: ${report.blockedReasons.length > 0 ? report.blockedReasons.join(' | ') : 'none'}`,
    ...currentCanvas,
  ].join('\n');
}

export function renderAgenticCodingEditProposalPrompt(
  report: AgenticCodingRunReport,
  options: AgenticCodingEditProposalPromptOptions = {},
): string {
  if (!report.contract) {
    return [
      'Agentic Coding Cell edit proposal prompt could not be generated.',
      '',
      'Validation errors:',
      ...report.validationErrors.map((error) => `- ${error}`),
    ].join('\n');
  }

  const dirtyFiles = options.includeDirtyFiles
    ? report.dirtyFiles.map((file) => `- ${file.status} ${file.path} (${file.allowed ? 'inside allowedPaths' : 'outside allowedPaths'})`)
    : [];

  return [
    'You are preparing a controlled edit proposal for the Agentic Coding Cell.',
    '',
    'Return only valid JSON. Do not include Markdown fences or commentary.',
    '',
    'Required JSON schema:',
    JSON.stringify({
      summary: 'Short description of the intended change.',
      producer: 'agent-name-or-role',
      risks: ['Known risks or "none".'],
      verificationNotes: ['Commands or checks that should prove the change.'],
      edits: [{
        type: 'replace_text',
        path: 'relative/path/inside/allowedPaths',
        find: 'exact existing text to replace',
        replace: 'replacement text',
        expectedOccurrences: 1,
      }],
    }, null, 2),
    '',
    'Task contract:',
    `- Repo: ${report.contract.repo}`,
    `- Task: ${report.contract.task}`,
    `- Risk level: ${report.contract.riskLevel}`,
    `- Allowed paths: ${report.contract.allowedPaths.join(', ')}`,
    `- Verification commands: ${report.contract.verification.join(' | ')}`,
    `- Max files changed: ${report.contract.maxFilesChanged}`,
    '',
    'Safety rules:',
    '- Propose replace_text edits only.',
    '- Use paths inside allowedPaths only.',
    '- Use exact text from files; do not invent context.',
    '- Set expectedOccurrences to the exact count that should be replaced.',
    '- Keep edits minimal and reversible.',
    '- Do not propose deletes, renames, shell commands, pushes, deploys, secrets, or broad rewrites.',
    '- If the task cannot be done safely, do not invent edits; stop and report the blocker outside this proposal artifact.',
    '',
    'Preflight status:',
    `- Status: ${report.status}`,
    `- Blocked reasons: ${report.blockedReasons.length > 0 ? report.blockedReasons.join(' | ') : 'none'}`,
    `- Workspace rules found: ${report.rulesFiles.filter((rule) => rule.present).map((rule) => rule.path).join(', ') || 'none at repo root'}`,
    ...(dirtyFiles.length > 0 ? ['', 'Dirty files:', ...dirtyFiles] : []),
    '',
    'Before applying any proposal, the runner will validate this JSON, preview edits with --preview-edits, and only write with --apply-edits.',
  ].join('\n');
}

export async function writeAgenticCodingEditProposalPrompt(
  report: AgenticCodingRunReport,
  proposalPromptFile: string,
  options?: AgenticCodingEditProposalPromptOptions,
): Promise<string> {
  const resolved = path.resolve(proposalPromptFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${renderAgenticCodingEditProposalPrompt(report, options)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingApprovalDecisionPrompt(
  report: AgenticCodingRunReport,
  approvalDecisionPromptFile: string,
): Promise<string> {
  const resolved = path.resolve(approvalDecisionPromptFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${renderAgenticCodingApprovalDecisionPrompt(report)}\n`, 'utf8');
  return resolved;
}

export async function writeAgenticCodingWorkflowBuilderPrompt(
  report: AgenticCodingRunReport,
  workflowBuilderPromptFile: string,
  options?: AgenticCodingWorkflowBuilderPromptOptions,
): Promise<string> {
  const resolved = path.resolve(workflowBuilderPromptFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${renderAgenticCodingWorkflowBuilderPrompt(report, options)}\n`, 'utf8');
  return resolved;
}
