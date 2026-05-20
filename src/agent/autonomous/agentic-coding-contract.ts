import path from 'node:path';
import { z } from 'zod';

const trimmedString = z.string().trim().min(1);

const riskLevelSchema = z.enum(['low', 'medium', 'high']);
const outputSchema = z.enum(['text', 'json']);
const memoryPolicySchema = z.enum(['none', 'handoff', 'lessons']);
const fleetPolicySchema = z.enum(['none', 'read-only-help', 'delegated-slices']);
const workflowNodeTypeSchema = z.enum(['gate', 'analysis', 'approval', 'edit', 'verification', 'handoff']);
const workflowCanvasNodeKindSchema = z.enum(['trigger', 'action', 'logic']);
const approvalDecisionSchema = z.enum(['approved', 'rejected']);
const workflowNodeIdSchema = trimmedString
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/, 'node ids may only contain letters, numbers, dots, underscores, colons, and dashes');

function normalizeScopePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isSafeScopePath(value: string): boolean {
  if (!value || value === '.' || value === '*' || value === '**' || value === '**/*') {
    return false;
  }

  if (value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    return false;
  }

  return value !== '..' && !value.startsWith('../') && !value.includes('/../');
}

const allowedPathSchema = trimmedString
  .transform(normalizeScopePath)
  .refine(isSafeScopePath, {
    message: 'allowedPaths must be bounded relative paths without traversal',
  });

const agenticCodingEditSchema = z.object({
  type: z.literal('replace_text'),
  path: allowedPathSchema,
  find: trimmedString,
  replace: z.string(),
  expectedOccurrences: z.number().int().positive().max(20).default(1),
}).strict();

export const agenticCodingEditProposalSchema = z.object({
  summary: trimmedString,
  edits: z.array(agenticCodingEditSchema).min(1),
  producer: trimmedString.optional(),
  risks: z.array(trimmedString).default([]),
  verificationNotes: z.array(trimmedString).default([]),
}).strict();

export const agenticCodingApprovalDecisionSchema = z.object({
  kind: z.literal('agentic-coding-approval-decision'),
  schemaVersion: z.literal(1),
  decision: approvalDecisionSchema,
  reviewer: trimmedString.max(120),
  reason: trimmedString.max(1000),
  decidedAt: trimmedString.max(120).optional(),
}).strict();

const agenticCodingWorkflowBuilderProposalNodeSchema = z.object({
  id: workflowNodeIdSchema,
  label: trimmedString.max(120),
  description: trimmedString.max(1000),
  agenticType: workflowNodeTypeSchema,
  type: workflowCanvasNodeKindSchema,
}).strict();

const agenticCodingWorkflowBuilderProposalEdgeSchema = z.object({
  source: workflowNodeIdSchema,
  target: workflowNodeIdSchema,
}).strict();

export const agenticCodingWorkflowBuilderProposalSchema = z.object({
  kind: z.literal('agentic-coding-workflow-builder-proposal'),
  schemaVersion: z.literal(1),
  summary: trimmedString.max(1000),
  nodes: z.array(agenticCodingWorkflowBuilderProposalNodeSchema).min(1).max(30),
  edges: z.array(agenticCodingWorkflowBuilderProposalEdgeSchema).max(60),
  approvalGates: z.array(trimmedString.max(500)).default([]),
  coworkVisualizationNotes: z.array(trimmedString.max(500)).default([]),
  risks: z.array(trimmedString.max(500)).default([]),
}).strict().superRefine((proposal, ctx) => {
  const nodeIds = new Set<string>();
  for (const [index, node] of proposal.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate node id "${node.id}"`,
        path: ['nodes', index, 'id'],
      });
    }
    nodeIds.add(node.id);
  }

  for (const [index, edge] of proposal.edges.entries()) {
    if (!nodeIds.has(edge.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `edge source "${edge.source}" does not reference a node`,
        path: ['edges', index, 'source'],
      });
    }
    if (!nodeIds.has(edge.target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `edge target "${edge.target}" does not reference a node`,
        path: ['edges', index, 'target'],
      });
    }
  }

  const triggerNodes = proposal.nodes.filter((node) => node.type === 'trigger');
  if (triggerNodes.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `workflow builder proposals must declare exactly one trigger node, found ${triggerNodes.length}`,
      path: ['nodes'],
    });
    return;
  }

  const outgoingEdges = new Map<string, string[]>();
  for (const edge of proposal.edges) {
    outgoingEdges.set(edge.source, [...(outgoingEdges.get(edge.source) ?? []), edge.target]);
  }

  const reachableNodeIds = new Set<string>();
  const queue = [triggerNodes[0].id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachableNodeIds.has(current)) {
      continue;
    }

    reachableNodeIds.add(current);
    for (const target of outgoingEdges.get(current) ?? []) {
      if (nodeIds.has(target) && !reachableNodeIds.has(target)) {
        queue.push(target);
      }
    }
  }

  const unreachableNodes = proposal.nodes.filter((node) => !reachableNodeIds.has(node.id));
  if (unreachableNodes.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `workflow builder proposal has unreachable node(s): ${unreachableNodes.map((node) => node.id).join(', ')}`,
      path: ['nodes'],
    });
  }
});

export const agenticCodingTaskContractSchema = z.object({
  repo: trimmedString.refine((value) => path.isAbsolute(value), {
    message: 'repo must be an absolute path',
  }),
  task: trimmedString,
  allowedPaths: z.array(allowedPathSchema).min(1),
  verification: z.array(trimmedString).min(1),
  riskLevel: riskLevelSchema,
  output: outputSchema.default('text'),
  branchName: trimmedString
    .max(120)
    .regex(/^[A-Za-z0-9._/-]+$/, 'branchName may only contain letters, numbers, dots, underscores, slashes, and dashes')
    .optional(),
  maxFilesChanged: z.number().int().positive().max(50).default(10),
  maxToolRounds: z.number().int().positive().max(400).default(50),
  memoryPolicy: memoryPolicySchema.default('handoff'),
  fleetPolicy: fleetPolicySchema.default('none'),
  edits: z.array(agenticCodingEditSchema).default([]),
}).strict();

export type AgenticCodingTaskContract = z.infer<typeof agenticCodingTaskContractSchema>;
export type AgenticCodingEditProposal = z.infer<typeof agenticCodingEditProposalSchema>;
export type AgenticCodingApprovalDecision = z.infer<typeof agenticCodingApprovalDecisionSchema>;
export type AgenticCodingWorkflowBuilderProposal = z.infer<typeof agenticCodingWorkflowBuilderProposalSchema>;

export type AgenticCodingTaskValidationResult =
  | { success: true; contract: AgenticCodingTaskContract }
  | { success: false; errors: string[] };

export type AgenticCodingEditProposalValidationResult =
  | { success: true; proposal: AgenticCodingEditProposal }
  | { success: false; errors: string[] };

export type AgenticCodingApprovalDecisionValidationResult =
  | { success: true; decision: AgenticCodingApprovalDecision }
  | { success: false; errors: string[] };

export type AgenticCodingWorkflowBuilderProposalValidationResult =
  | { success: true; proposal: AgenticCodingWorkflowBuilderProposal }
  | { success: false; errors: string[] };

export interface AgenticCodingExecutionGate {
  autoExecutable: boolean;
  reasons: string[];
}

const HIGH_RISK_SCOPES = [
  'src/security/',
  'src/database/',
  'src/server/routes/auth',
  'src/commands/handlers/auth',
  'src/config/env',
  '.github/workflows/',
  'deploy/',
  'database/migrations/',
];

export function validateAgenticCodingTaskContract(input: unknown): AgenticCodingTaskValidationResult {
  const result = agenticCodingTaskContractSchema.safeParse(input);

  if (result.success) {
    return { success: true, contract: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : 'task';
      return `${field}: ${issue.message}`;
    }),
  };
}

export function validateAgenticCodingEditProposal(input: unknown): AgenticCodingEditProposalValidationResult {
  const result = agenticCodingEditProposalSchema.safeParse(input);

  if (result.success) {
    return { success: true, proposal: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : 'proposal';
      return `${field}: ${issue.message}`;
    }),
  };
}

export function validateAgenticCodingApprovalDecision(input: unknown): AgenticCodingApprovalDecisionValidationResult {
  const result = agenticCodingApprovalDecisionSchema.safeParse(input);

  if (result.success) {
    return { success: true, decision: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : 'approvalDecision';
      return `${field}: ${issue.message}`;
    }),
  };
}

export function validateAgenticCodingWorkflowBuilderProposal(
  input: unknown,
): AgenticCodingWorkflowBuilderProposalValidationResult {
  const result = agenticCodingWorkflowBuilderProposalSchema.safeParse(input);

  if (result.success) {
    return { success: true, proposal: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : 'workflowBuilderProposal';
      return `${field}: ${issue.message}`;
    }),
  };
}

export function assessAgenticCodingExecutionGate(
  contract: AgenticCodingTaskContract,
): AgenticCodingExecutionGate {
  const reasons: string[] = [];

  if (contract.riskLevel !== 'low') {
    reasons.push('V0 only auto-executes low-risk tasks');
  }

  if (contract.fleetPolicy === 'delegated-slices') {
    reasons.push('write delegation is not enabled in V0');
  }

  if (contract.maxFilesChanged > 10) {
    reasons.push('maxFilesChanged exceeds the V0 default safety boundary');
  }

  const editedFileCount = new Set(contract.edits.map((edit) => edit.path)).size;
  if (editedFileCount > contract.maxFilesChanged) {
    reasons.push('declared edits exceed maxFilesChanged');
  }

  const highRiskScope = contract.allowedPaths.find((scope) =>
    HIGH_RISK_SCOPES.some((prefix) => scope === prefix.slice(0, -1) || scope.startsWith(prefix))
  );

  if (highRiskScope) {
    reasons.push(`allowed path "${highRiskScope}" touches a high-risk scope`);
  }

  return {
    autoExecutable: reasons.length === 0,
    reasons,
  };
}
