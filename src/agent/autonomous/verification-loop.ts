import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgenticCodingTaskContract,
} from './agentic-coding-contract.js';
import type {
  AgenticCodingEditProposalProducerDispatch,
  AgenticCodingRunOptions,
  AgenticCodingRunStatus,
  AgenticCodingVerificationResult,
} from './agentic-coding-runner.js';
import {
  applyDeclaredEdits,
  previewDeclaredEdits,
  runVerificationCommands,
} from './agentic-coding-edits.js';
import { renderCodexAutonomyDirective } from './codex-autonomy-directive.js';
import { generateEditProposal } from './edit-proposal-producer.js';
import { CodeBuddyClient } from '../../codebuddy/client.js';
import type { CodeBuddyMessage, CodeBuddyTool } from '../../codebuddy/client.js';
import type { ChatOptions, SearchOptions } from '../../codebuddy/client.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint-manager.js';

const execFileAsync = promisify(execFile);

async function rollbackFiles(repo: string, relativePaths: string[]): Promise<void> {
  for (const relPath of relativePaths) {
    try {
      await execFileAsync('git', ['checkout', '--', relPath], { cwd: repo, windowsHide: true });
      await execFileAsync('git', ['clean', '-f', '--', relPath], { cwd: repo, windowsHide: true });
    } catch {
      // Ignore rollback failures for untracked/uncommitted files or non-git environments
    }
  }
}

import { createAuxiliaryClient } from '../../providers/auxiliary-llm.js';
import { getCostTracker } from '../../utils/cost-tracker.js';

export async function runVerificationAndSelfCorrectionLoop(
  contract: AgenticCodingTaskContract,
  options: AgenticCodingRunOptions,
  dispatch: AgenticCodingEditProposalProducerDispatch,
  customClient?: CodeBuddyClient,
  maxIterations = 4
): Promise<{
  status: AgenticCodingRunStatus;
  verification: AgenticCodingVerificationResult[];
  iterations: number;
  contract: AgenticCodingTaskContract;
  reason?: string;
}> {
  let currentContract = { ...contract };
  const requestedMaxIterations = options.maxIterations ?? maxIterations;
  const saveEarlyBlockedCheckpoint = async (reason: string): Promise<void> => {
    if (!options.runId) return;
    await saveCheckpoint({
      runId: options.runId,
      options,
      contract: currentContract,
      step: 'blocked',
      blockedReasons: [reason],
      timestamp: new Date().toISOString(),
      verification: [],
    });
  };
  if (!Number.isInteger(requestedMaxIterations) || requestedMaxIterations < 1) {
    const reason = `maxIterations must be a positive integer; received ${String(requestedMaxIterations)}.`;
    await saveEarlyBlockedCheckpoint(reason);
    return {
      status: 'blocked',
      verification: [],
      iterations: 0,
      contract: currentContract,
      reason,
    };
  }
  const effectiveMaxIterations = requestedMaxIterations;
  let checkpointToResume = null;
  if (options.resume) {
    checkpointToResume = await loadCheckpoint(options.resume);
  }

  let cumulativeCostUsd = 0;
  const costLimit = options.maxCostUsd ?? 5.0;
  if (!Number.isFinite(costLimit) || costLimit < 0) {
    const reason = `maxCostUsd must be a finite non-negative number; received ${String(costLimit)}.`;
    await saveEarlyBlockedCheckpoint(reason);
    return {
      status: 'blocked',
      verification: [],
      iterations: 0,
      contract: currentContract,
      reason,
    };
  }

  if (costLimit < 0.01) {
    const reason = `Cost budget of $${costLimit.toFixed(5)} is too low to run the agent.`;
    await saveEarlyBlockedCheckpoint(reason);
    return {
      status: 'blocked',
      verification: [],
      iterations: 0,
      contract: currentContract,
      reason,
    };
  }

  // 1. Resolve client
  let baseClient: CodeBuddyClient;
  if (customClient) {
    baseClient = customClient;
  } else {
    const resolved = createAuxiliaryClient('verification');
    if (!resolved) {
      throw new Error('No LLM provider configuration found in environment.');
    }
    baseClient = resolved;
  }

  const tracker = getCostTracker();

  // 2. Wrap client in a proxy to track cumulative LLM cost
  const clientProxy = new Proxy(baseClient, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return async function (
          messages: CodeBuddyMessage[],
          tools?: CodeBuddyTool[],
          chatOpts?: string | ChatOptions,
          searchOpts?: SearchOptions
        ) {
          if (cumulativeCostUsd >= costLimit) {
            throw new Error(`Cost budget of $${costLimit.toFixed(2)} exceeded. Blocking further LLM calls.`);
          }
          const response = await target.chat(messages, tools, chatOpts, searchOpts);
          const model = target.getCurrentModel();
          const choice = response.choices?.[0];
          const inputTokens = response.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(messages).length / 4);
          const outputTokens = response.usage?.completion_tokens ?? Math.ceil((choice?.message?.content ?? '').length / 4);

          const usage = tracker.recordUsage(inputTokens, outputTokens, model);
          cumulativeCostUsd += usage.cost;

          if (cumulativeCostUsd >= costLimit) {
            throw new Error(`Cost budget of $${costLimit.toFixed(2)} exceeded. Blocking further LLM calls.`);
          }
          return response;
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  let currentVerification: AgenticCodingVerificationResult[] = [];
  let hasFailed = false;
  const saveBlockedCheckpoint = async (reason: string, verification = currentVerification): Promise<void> => {
    if (!options.runId) return;
    await saveCheckpoint({
      runId: options.runId,
      options,
      contract: currentContract,
      step: 'blocked',
      blockedReasons: [reason],
      timestamp: new Date().toISOString(),
      verification,
    });
  };

  if (checkpointToResume && checkpointToResume.step === 'applied') {
    currentContract = checkpointToResume.contract;
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );
    hasFailed = currentVerification.some((result) => result.status !== 'passed');
  } else if (checkpointToResume && checkpointToResume.step === 'proposal_generated') {
    currentContract = checkpointToResume.contract;
    await applyDeclaredEdits(currentContract);
    if (options.runId) {
      await saveCheckpoint({
        runId: options.runId,
        options,
        contract: currentContract,
        step: 'applied',
        timestamp: new Date().toISOString(),
      });
    }
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );
    hasFailed = currentVerification.some((result) => result.status !== 'passed');
  } else {
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );
    hasFailed = currentVerification.some((result) => result.status !== 'passed');
  }

  // If any verification command was blocked by safety checks, rollback files and return status 'blocked'
  const hasBlocked = currentVerification.some((result) => result.status === 'blocked');
  if (hasBlocked) {
    const filesToRestore = Array.from(new Set(currentContract.edits.map((e) => e.path)));
    await rollbackFiles(currentContract.repo, filesToRestore);
    const reason = 'Verification command blocked by safety policy check.';
    await saveBlockedCheckpoint(reason, currentVerification);
    return {
      status: 'blocked',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
      reason,
    };
  }

  // If applyEdits is false, do not attempt to produce edits or self-correct.
  if (options.applyEdits === false) {
    return {
      status: hasFailed ? 'verification_failed' : 'verified',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
    };
  }

  if (!hasFailed) {
    if (options.runId) {
      await saveCheckpoint({
        runId: options.runId,
        options,
        contract: currentContract,
        step: 'verified',
        timestamp: new Date().toISOString(),
        verification: currentVerification,
      });
    }
    return {
      status: 'verified',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
    };
  }

  // Keep a copy of the messages history for self-correction turns
  const messagesHistory: AgenticCodingEditProposalProducerDispatch['messages'] = [...dispatch.messages];

  let lastProposalFailedValidation = false;
  let lastValidationError = '';

  if (currentContract.edits.length === 0) {
    try {
      const initialProposal = await generateEditProposal(dispatch, clientProxy);
      currentContract.edits = initialProposal.edits;

      if (options.runId) {
        await saveCheckpoint({
          runId: options.runId,
          options,
          contract: currentContract,
          step: 'proposal_generated',
          timestamp: new Date().toISOString(),
        });
      }

      await applyDeclaredEdits(currentContract);

      if (options.runId) {
        await saveCheckpoint({
          runId: options.runId,
          options,
          contract: currentContract,
          step: 'applied',
          timestamp: new Date().toISOString(),
        });
      }

      // Re-run verification after applying the newly generated edits
      currentVerification = await runVerificationCommands(
        currentContract,
        options.verificationTimeoutMs ?? 120000
      );

      // Check safety checks block
      const hasBlockedAfterInitial = currentVerification.some((result) => result.status === 'blocked');
      if (hasBlockedAfterInitial) {
        const filesToRestore = Array.from(new Set(currentContract.edits.map((e) => e.path)));
        await rollbackFiles(currentContract.repo, filesToRestore);
        const reason = 'Verification command blocked by safety policy check after applying initial edits.';
        await saveBlockedCheckpoint(reason, currentVerification);
        return {
          status: 'blocked',
          verification: currentVerification,
          iterations: 0,
          contract: currentContract,
          reason,
        };
      }

      hasFailed = currentVerification.some((result) => result.status !== 'passed');
      if (!hasFailed) {
        if (options.runId) {
          await saveCheckpoint({
            runId: options.runId,
            options,
            contract: currentContract,
            step: 'verified',
            timestamp: new Date().toISOString(),
            verification: currentVerification,
          });
        }
        return {
          status: 'verified',
          verification: currentVerification,
          iterations: 0,
          contract: currentContract,
        };
      }
    } catch (err) {
      const filesToRestore = Array.from(new Set(currentContract.edits.map((e) => e.path)));
      await rollbackFiles(currentContract.repo, filesToRestore);
      if (cumulativeCostUsd >= costLimit) {
        const reason = `Cost budget of $${costLimit.toFixed(2)} exceeded during initial edit proposal generation.`;
        await saveBlockedCheckpoint(reason, currentVerification);
        return {
          status: 'blocked',
          verification: currentVerification,
          iterations: 0,
          contract: currentContract,
          reason,
        };
      }
      
      // Instead of failing immediately, record validation error and let it self-correct in the loop
      lastProposalFailedValidation = true;
      lastValidationError = err instanceof Error ? err.message : String(err);
    }
  }

  for (let iter = 0; iter < effectiveMaxIterations; iter++) {
    if (lastProposalFailedValidation) {
      messagesHistory.push({
        role: 'user',
        content: `Your previous proposal failed validation or could not be applied: ${lastValidationError}. Please generate a new proposal that is valid JSON and contains at least one edit.`,
      });
      lastProposalFailedValidation = false;
    } else {
      // 1. Get current git diff before rolling back
      let diff = '';
      try {
        const diffResult = await execFileAsync('git', ['diff'], {
          cwd: currentContract.repo,
          windowsHide: true,
        });
        diff = diffResult.stdout;
      } catch {
        // Fallback if git diff fails
      }

      // 2. Format the failures and diff for the LLM
      const failedDetails = currentVerification
        .filter((v) => v.status !== 'passed')
        .map((v) => {
          return `Command: ${v.command}\nExit Code: ${v.exitCode}\nStdout:\n${v.stdout}\nStderr:\n${v.stderr}\nReason: ${v.reason ?? ''}`;
        })
        .join('\n\n');

      const promptContent = `Verification failed. Here are the details of the failures:

${failedDetails}

Here is the git diff of the changes made:
\`\`\`diff
${diff}
\`\`\`

Please analyze the failure and generate a new, corrected edit proposal to resolve the errors. Make sure the proposed changes fix the failing tests/checks and do not introduce new issues.`;
      const correctionDirective = renderCodexAutonomyDirective(currentContract, { mode: 'self-correction' });

      // 3. Construct message turns: previous assistant proposal + user feedback
      const previousProposal = {
        summary: `Attempt ${iter + 1} edits`,
        edits: currentContract.edits,
      };
      const assistantContent = JSON.stringify(previousProposal, null, 2);

      messagesHistory.push({
        role: 'assistant',
        content: `\`\`\`json\n${assistantContent}\n\`\`\``,
      });

      messagesHistory.push({
        role: 'user',
        content: `${promptContent}\n\n${correctionDirective}`,
      });
    }

    // 4. Rollback files to restore baseline before applying corrected edits
    const filesToRestore = Array.from(new Set(currentContract.edits.map((e) => e.path)));
    await rollbackFiles(currentContract.repo, filesToRestore);

    // 5. Generate a new proposal using the producer
    const nextDispatch: AgenticCodingEditProposalProducerDispatch = {
      ...dispatch,
      messages: messagesHistory,
    };

    let newProposal;
    try {
      newProposal = await generateEditProposal(nextDispatch, clientProxy);
    } catch (err) {
      const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
      await rollbackFiles(currentContract.repo, pathsToRevert);
      if (cumulativeCostUsd >= costLimit) {
        const reason = `Cost budget of $${costLimit.toFixed(2)} exceeded during self-correction iteration ${iter + 1}.`;
        await saveBlockedCheckpoint(reason, currentVerification);
        return {
          status: 'blocked',
          verification: currentVerification,
          iterations: iter + 1,
          contract: currentContract,
          reason,
        };
      }
      
      // Record validation error and proceed to the next iteration
      lastProposalFailedValidation = true;
      lastValidationError = err instanceof Error ? err.message : String(err);
      continue;
    }

    // 6. Apply the new proposal
    currentContract = {
      ...currentContract,
      edits: newProposal.edits,
    };

    try {
      const previews = await previewDeclaredEdits(currentContract);
      const failedPreviews = previews.filter((p) => p.status !== 'previewed');
      if (failedPreviews.length > 0) {
        const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
        await rollbackFiles(currentContract.repo, pathsToRevert);
        
        lastProposalFailedValidation = true;
        lastValidationError = `Preview of self-corrected proposal failed: ${failedPreviews.map(p => `${p.path} (${p.reason ?? p.status})`).join(', ')}`;
        continue;
      }

      await applyDeclaredEdits(currentContract);
    } catch (err) {
      const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
      await rollbackFiles(currentContract.repo, pathsToRevert);
      
      lastProposalFailedValidation = true;
      lastValidationError = err instanceof Error ? err.message : String(err);
      continue;
    }

    // 7. Re-run verification commands
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );

    // If safety checks blocked any verification command, rollback and block
    const hasBlockedInLoop = currentVerification.some((result) => result.status === 'blocked');
    if (hasBlockedInLoop) {
      const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
      await rollbackFiles(currentContract.repo, pathsToRevert);
      const reason = 'Verification command blocked by safety policy check during self-correction loop.';
      await saveBlockedCheckpoint(reason, currentVerification);
      return {
        status: 'blocked',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
        reason,
      };
    }

    hasFailed = currentVerification.some((result) => result.status !== 'passed');
    if (!hasFailed) {
      if (options.runId) {
        await saveCheckpoint({
          runId: options.runId,
          options,
          contract: currentContract,
          step: 'verified',
          timestamp: new Date().toISOString(),
          verification: currentVerification,
        });
      }
      return {
        status: 'verified',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
      };
    }
  }

  // Rollback files when iteration limit is reached
  const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
  await rollbackFiles(currentContract.repo, pathsToRevert);

  let finalReason = `Maximum iterations (${effectiveMaxIterations}) reached without passing verification.`;
  if (lastProposalFailedValidation) {
    finalReason += ` Last proposal validation error: ${lastValidationError}`;
  }
  await saveBlockedCheckpoint(finalReason, currentVerification);

  return {
    status: 'blocked',
    verification: currentVerification,
    iterations: effectiveMaxIterations,
    contract: currentContract,
    reason: finalReason,
  };
}
