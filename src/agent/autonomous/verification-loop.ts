import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgenticCodingTaskContract,
} from './agentic-coding-contract.js';
import {
  AgenticCodingEditProposalProducerDispatch,
  AgenticCodingRunOptions,
  AgenticCodingRunStatus,
  AgenticCodingVerificationResult,
  applyDeclaredEdits,
  previewDeclaredEdits,
  runVerificationCommands,
} from './agentic-coding-runner.js';
import { generateEditProposal } from './edit-proposal-producer.js';
import { CodeBuddyClient } from '../../codebuddy/client.js';
import type { CodeBuddyMessage, CodeBuddyTool } from '../../codebuddy/client.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint-manager.js';

const execFileAsync = promisify(execFile);

async function rollbackFiles(repo: string, relativePaths: string[]): Promise<void> {
  for (const relPath of relativePaths) {
    try {
      await execFileAsync('git', ['checkout', '--', relPath], { cwd: repo, windowsHide: true });
      await execFileAsync('git', ['clean', '-f', '--', relPath], { cwd: repo, windowsHide: true });
    } catch (err) {
      // Ignore rollback failures for untracked/uncommitted files or non-git environments
    }
  }
}

import { detectProviderFromEnv } from '../../utils/provider-detector.js';
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
  let checkpointToResume = null;
  if (options.resume) {
    checkpointToResume = await loadCheckpoint(options.resume);
  }

  let cumulativeCostUsd = 0;
  const costLimit = options.maxCostUsd ?? 5.0;

  // 1. Resolve client
  let baseClient: CodeBuddyClient;
  if (customClient) {
    baseClient = customClient;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      throw new Error('No LLM provider configuration found in environment.');
    }
    baseClient = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
  }

  const tracker = getCostTracker();

  // 2. Wrap client in a proxy to track cumulative LLM cost
  const clientProxy = new Proxy(baseClient, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return async function (
          messages: CodeBuddyMessage[],
          tools?: CodeBuddyTool[],
          chatOpts?: any,
          searchOpts?: any
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
    return {
      status: 'blocked',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
      reason: 'Verification command blocked by safety policy check.',
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
        return {
          status: 'blocked',
          verification: currentVerification,
          iterations: 0,
          contract: currentContract,
          reason: 'Verification command blocked by safety policy check after applying initial edits.',
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
        return {
          status: 'blocked',
          verification: currentVerification,
          iterations: 0,
          contract: currentContract,
          reason: `Cost budget of $${costLimit.toFixed(2)} exceeded during initial edit proposal generation.`,
        };
      }
      return {
        status: 'verification_failed',
        verification: currentVerification,
        iterations: 0,
        contract: currentContract,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Keep a copy of the messages history for self-correction turns
  const messagesHistory: CodeBuddyMessage[] = [...dispatch.messages] as CodeBuddyMessage[];

  for (let iter = 0; iter < maxIterations; iter++) {
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
      content: promptContent,
    });

    // 4. Rollback files to restore baseline before applying corrected edits
    const filesToRestore = Array.from(new Set(currentContract.edits.map((e) => e.path)));
    await rollbackFiles(currentContract.repo, filesToRestore);

    // 5. Generate a new proposal using the producer
    const nextDispatch: AgenticCodingEditProposalProducerDispatch = {
      ...dispatch,
      messages: messagesHistory as any,
    };

    let newProposal;
    try {
      newProposal = await generateEditProposal(nextDispatch, clientProxy);
    } catch (err) {
      const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
      await rollbackFiles(currentContract.repo, pathsToRevert);
      if (cumulativeCostUsd >= costLimit) {
        return {
          status: 'blocked',
          verification: currentVerification,
          iterations: iter + 1,
          contract: currentContract,
          reason: `Cost budget of $${costLimit.toFixed(2)} exceeded during self-correction iteration ${iter + 1}.`,
        };
      }
      return {
        status: 'verification_failed',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
        reason: err instanceof Error ? err.message : String(err),
      };
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
        return {
          status: 'verification_failed',
          verification: currentVerification,
          iterations: iter + 1,
          contract: currentContract,
          reason: 'Preview of self-corrected proposal failed.',
        };
      }

      await applyDeclaredEdits(currentContract);
    } catch (err) {
      const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
      await rollbackFiles(currentContract.repo, pathsToRevert);
      return {
        status: 'verification_failed',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
        reason: err instanceof Error ? err.message : String(err),
      };
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
      return {
        status: 'blocked',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
        reason: 'Verification command blocked by safety policy check during self-correction loop.',
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

  // Rollback files when iteration limit is reached
  const pathsToRevert = Array.from(new Set(currentContract.edits.map((e) => e.path)));
  await rollbackFiles(currentContract.repo, pathsToRevert);

  return {
    status: 'blocked',
    verification: currentVerification,
    iterations: maxIterations,
    contract: currentContract,
    reason: `Maximum iterations (${maxIterations}) reached without passing verification.`,
  };
}
