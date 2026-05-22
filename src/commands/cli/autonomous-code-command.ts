import type { Command } from 'commander';

import {
  renderAgenticCodingRunReport,
  runAgenticCodingCell,
  writeAgenticCodingApprovalDecisionPrompt,
  writeAgenticCodingApprovalSnapshot,
  writeAgenticCodingEditProposalProducerDispatch,
  writeAgenticCodingEditProposalReviewSnapshot,
  writeAgenticCodingEditProposalPrompt,
  writeAgenticCodingProposalLoopArtifactBundle,
  writeAgenticCodingProposalLoopCanvas,
  writeAgenticCodingProposalLoopCoworkImport,
  writeAgenticCodingProposalLoopCoworkImportCheck,
  writeAgenticCodingProposalLoopCoworkWorkspace,
  writeAgenticCodingProposalLoopNextActionSnapshot,
  writeAgenticCodingProposalLoopSnapshot,
  writeAgenticCodingRunReport,
  writeAgenticCodingWorkflowBuilderPrompt,
  writeAgenticCodingWorkflowBuilderProposalCanvas,
  writeAgenticCodingWorkflowCanvas,
  writeAgenticCodingWorkflowEventsSnapshot,
  writeAgenticCodingWorkflowProgressSnapshot,
} from '../../agent/autonomous/agentic-coding-runner.js';

interface AutonomousCodeOptions {
  applyEdits?: boolean;
  approvalDecisionFile?: string;
  approvalDecisionPromptFile?: string;
  approvalFile?: string;
  editProposalFile?: string;
  editProposalProducerDispatchFile?: string;
  editProposalReviewFile?: string;
  json?: boolean;
  previewEdits?: boolean;
  proposalLoopArtifactsDir?: string;
  proposalLoopCanvasFile?: string;
  proposalLoopCoworkImportCheckFile?: string;
  proposalLoopCoworkImportFile?: string;
  proposalLoopCoworkWorkspaceFile?: string;
  proposalLoopFile?: string;
  proposalLoopNextActionFile?: string;
  proposalPromptFile?: string;
  requireApproval?: boolean;
  requirePreview?: boolean;
  reportFile?: string;
  runVerification?: boolean;
  taskFile?: string;
  verificationTimeoutMs?: string;
  workflowBuilderPromptFile?: string;
  workflowBuilderProposalCanvasFile?: string;
  workflowBuilderProposalFile?: string;
  workflowEventsFile?: string;
  workflowFile?: string;
  workflowProgressFile?: string;
  resume?: string;
  runId?: string;
  maxCostUsd?: string;
}

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    throw new Error('--verification-timeout-ms must be an integer >= 1000');
  }

  return parsed;
}

export function registerAutonomousCodeCommand(program: Command): void {
  program
    .command('autonomous-code')
    .description('Run a guarded Agentic Coding Cell task contract')
    .option('--task-file <path>', 'path to an Agentic Coding Cell JSON task contract')
    .option('--resume <runId>', 'resume a run from a checkpoint state')
    .option('--run-id <runId>', 'unique run identifier for checkpointing')
    .option('--edit-proposal-file <path>', 'path to a controlled edit proposal JSON file')
    .option('--edit-proposal-producer-dispatch-file <path>', 'write a data-only dispatch artifact for a future edit-proposal producer')
    .option('--edit-proposal-review-file <path>', 'write a compact review snapshot for a controlled edit proposal')
    .option('--preview-edits', 'preview declared scoped edit operations without writing files')
    .option('--apply-edits', 'apply declared scoped edit operations after preflight passes')
    .option('--require-preview', 'require a successful scoped edit preview before applying edits')
    .option('--proposal-prompt-file <path>', 'write a constrained prompt for producing an edit proposal JSON file')
    .option('--proposal-loop-file <path>', 'write a Cowork proposal loop packet with prompts, artifacts, and commands')
    .option('--proposal-loop-canvas-file <path>', 'write a ReactFlow-style canvas for the proposal loop packet')
    .option('--proposal-loop-cowork-import-file <path>', 'write a standalone Cowork import manifest for proposal-loop artifacts')
    .option('--proposal-loop-cowork-import-check-file <path>', 'write a passive artifact availability check for the Cowork import manifest')
    .option('--proposal-loop-cowork-workspace-file <path>', 'write a Cowork workspace summary from the import manifest')
    .option('--proposal-loop-next-action-file <path>', 'write a compact Cowork next-action snapshot for the proposal loop')
    .option('--proposal-loop-artifacts-dir <path>', 'materialize a non-writing Cowork proposal loop artifact bundle')
    .option('--approval-file <path>', 'write a compact Cowork approval-state JSON artifact')
    .option('--approval-decision-file <path>', 'path to a controlled Cowork approval decision JSON file')
    .option('--approval-decision-prompt-file <path>', 'write a constrained prompt for producing an approval decision JSON file')
    .option('--require-approval', 'require an approved decision file before applying scoped edits')
    .option('--workflow-builder-prompt-file <path>', 'write a constrained prompt for designing a workflow canvas')
    .option('--workflow-builder-proposal-file <path>', 'path to a controlled workflow builder proposal JSON file')
    .option('--workflow-builder-proposal-canvas-file <path>', 'write a canvas JSON artifact from a validated workflow builder proposal')
    .option('--workflow-file <path>', 'write a PostCommander-style workflow canvas JSON artifact')
    .option('--workflow-events-file <path>', 'write a compact workflow event timeline JSON artifact')
    .option('--workflow-progress-file <path>', 'write a compact workflow progress snapshot JSON artifact')
    .option('--run-verification', 'run declared verification commands after preflight passes')
    .option('--verification-timeout-ms <ms>', 'timeout per verification command', '120000')
    .option('--max-cost-usd <usd>', 'maximum allowed cost in USD')
    .option('--report-file <path>', 'write the JSON report to a file')
    .option('--json', 'output JSON')
    .action(async (options: AutonomousCodeOptions) => {
      try {
        if (!options.taskFile && !options.resume) {
          throw new Error('Either --task-file or --resume must be provided.');
        }

        const report = await runAgenticCodingCell({
          applyEdits: Boolean(options.applyEdits),
          approvalDecisionFile: options.approvalDecisionFile,
          editProposalFile: options.editProposalFile,
          previewEdits: Boolean(options.previewEdits),
          requireApproval: Boolean(options.requireApproval),
          requirePreview: Boolean(options.requirePreview),
          runVerification: Boolean(options.runVerification),
          taskFile: options.taskFile,
          verificationTimeoutMs: parseTimeout(options.verificationTimeoutMs),
          workflowBuilderProposalFile: options.workflowBuilderProposalFile,
          resume: options.resume,
          runId: options.runId,
          maxCostUsd: options.maxCostUsd ? Number(options.maxCostUsd) : undefined,
        });
        const reportPath = options.reportFile
          ? await writeAgenticCodingRunReport(report, options.reportFile)
          : undefined;
        const approvalPath = options.approvalFile
          ? await writeAgenticCodingApprovalSnapshot(report, options.approvalFile)
          : undefined;
        const editProposalReviewPath = options.editProposalReviewFile
          ? await writeAgenticCodingEditProposalReviewSnapshot(report, options.editProposalReviewFile)
          : undefined;
        const editProposalProducerDispatchPath = options.editProposalProducerDispatchFile
          ? await writeAgenticCodingEditProposalProducerDispatch(report, options.editProposalProducerDispatchFile)
          : undefined;
        const approvalDecisionPromptPath = options.approvalDecisionPromptFile
          ? await writeAgenticCodingApprovalDecisionPrompt(report, options.approvalDecisionPromptFile)
          : undefined;
        const proposalPromptPath = options.proposalPromptFile
          ? await writeAgenticCodingEditProposalPrompt(report, options.proposalPromptFile, {
            includeDirtyFiles: true,
          })
          : undefined;
        const proposalLoopPath = options.proposalLoopFile
          ? await writeAgenticCodingProposalLoopSnapshot(report, options.proposalLoopFile)
          : undefined;
        const proposalLoopCanvasPath = options.proposalLoopCanvasFile
          ? await writeAgenticCodingProposalLoopCanvas(report, options.proposalLoopCanvasFile)
          : undefined;
        const proposalLoopNextActionPath = options.proposalLoopNextActionFile
          ? await writeAgenticCodingProposalLoopNextActionSnapshot(report, options.proposalLoopNextActionFile)
          : undefined;
        const proposalLoopArtifactsPath = options.proposalLoopArtifactsDir
          ? await writeAgenticCodingProposalLoopArtifactBundle(report, options.proposalLoopArtifactsDir)
          : undefined;
        const proposalLoopCoworkImportPath = options.proposalLoopCoworkImportFile
          ? await writeAgenticCodingProposalLoopCoworkImport(report, options.proposalLoopCoworkImportFile)
          : undefined;
        if (options.proposalLoopCoworkImportCheckFile && !proposalLoopCoworkImportPath) {
          throw new Error('--proposal-loop-cowork-import-check-file requires --proposal-loop-cowork-import-file');
        }
        const proposalLoopCoworkImportCheckPath = options.proposalLoopCoworkImportCheckFile && proposalLoopCoworkImportPath
          ? await writeAgenticCodingProposalLoopCoworkImportCheck(
            proposalLoopCoworkImportPath,
            options.proposalLoopCoworkImportCheckFile,
          )
          : undefined;
        if (options.proposalLoopCoworkWorkspaceFile && !proposalLoopCoworkImportPath) {
          throw new Error('--proposal-loop-cowork-workspace-file requires --proposal-loop-cowork-import-file');
        }
        const proposalLoopCoworkWorkspacePath = options.proposalLoopCoworkWorkspaceFile && proposalLoopCoworkImportPath
          ? await writeAgenticCodingProposalLoopCoworkWorkspace(
            proposalLoopCoworkImportPath,
            options.proposalLoopCoworkWorkspaceFile,
          )
          : undefined;
        const workflowPath = options.workflowFile
          ? await writeAgenticCodingWorkflowCanvas(report, options.workflowFile)
          : undefined;
        const workflowBuilderPromptPath = options.workflowBuilderPromptFile
          ? await writeAgenticCodingWorkflowBuilderPrompt(report, options.workflowBuilderPromptFile, {
            includeCurrentCanvas: true,
          })
          : undefined;
        const workflowBuilderProposalCanvasPath = options.workflowBuilderProposalCanvasFile
          ? await writeAgenticCodingWorkflowBuilderProposalCanvas(
            report,
            options.workflowBuilderProposalCanvasFile,
          )
          : undefined;
        const workflowProgressPath = options.workflowProgressFile
          ? await writeAgenticCodingWorkflowProgressSnapshot(report, options.workflowProgressFile)
          : undefined;
        const workflowEventsPath = options.workflowEventsFile
          ? await writeAgenticCodingWorkflowEventsSnapshot(report, options.workflowEventsFile)
          : undefined;

        if (options.json) {
          console.log(JSON.stringify({
            ...report,
            approvalDecisionPromptPath,
            approvalPath,
            editProposalProducerDispatchPath,
            editProposalReviewPath,
            proposalLoopArtifactsPath,
            proposalLoopCanvasPath,
            proposalLoopCoworkImportCheckPath,
            proposalLoopCoworkImportPath,
            proposalLoopCoworkWorkspacePath,
            proposalLoopNextActionPath,
            proposalLoopPath,
            proposalPromptPath,
            reportPath,
            workflowBuilderPromptPath,
            workflowBuilderProposalCanvasPath,
            workflowEventsPath,
            workflowPath,
            workflowProgressPath,
          }, null, 2));
          return;
        }

        console.log(renderAgenticCodingRunReport(report));
        if (proposalPromptPath) {
          console.log(`\nProposal prompt written: ${proposalPromptPath}`);
        }
        if (proposalLoopPath) {
          console.log(`\nProposal loop packet written: ${proposalLoopPath}`);
        }
        if (proposalLoopCanvasPath) {
          console.log(`\nProposal loop canvas written: ${proposalLoopCanvasPath}`);
        }
        if (proposalLoopNextActionPath) {
          console.log(`\nProposal loop next-action snapshot written: ${proposalLoopNextActionPath}`);
        }
        if (proposalLoopArtifactsPath) {
          console.log(`\nProposal loop artifact bundle written: ${proposalLoopArtifactsPath}`);
        }
        if (proposalLoopCoworkImportPath) {
          console.log(`\nProposal loop Cowork import manifest written: ${proposalLoopCoworkImportPath}`);
        }
        if (proposalLoopCoworkImportCheckPath) {
          console.log(`\nProposal loop Cowork import check written: ${proposalLoopCoworkImportCheckPath}`);
        }
        if (proposalLoopCoworkWorkspacePath) {
          console.log(`\nProposal loop Cowork workspace written: ${proposalLoopCoworkWorkspacePath}`);
        }
        if (approvalPath) {
          console.log(`\nApproval state written: ${approvalPath}`);
        }
        if (editProposalReviewPath) {
          console.log(`\nEdit proposal review written: ${editProposalReviewPath}`);
        }
        if (editProposalProducerDispatchPath) {
          console.log(`\nEdit proposal producer dispatch written: ${editProposalProducerDispatchPath}`);
        }
        if (approvalDecisionPromptPath) {
          console.log(`\nApproval decision prompt written: ${approvalDecisionPromptPath}`);
        }
        if (reportPath) {
          console.log(`\nReport written: ${reportPath}`);
        }
        if (workflowPath) {
          console.log(`\nWorkflow canvas written: ${workflowPath}`);
        }
        if (workflowBuilderPromptPath) {
          console.log(`\nWorkflow builder prompt written: ${workflowBuilderPromptPath}`);
        }
        if (workflowBuilderProposalCanvasPath) {
          console.log(`\nWorkflow builder proposal canvas written: ${workflowBuilderProposalCanvasPath}`);
        }
        if (workflowProgressPath) {
          console.log(`\nWorkflow progress snapshot written: ${workflowProgressPath}`);
        }
        if (workflowEventsPath) {
          console.log(`\nWorkflow events snapshot written: ${workflowEventsPath}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
