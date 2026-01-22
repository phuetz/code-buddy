/**
 * Headless mode processing for Code Buddy CLI
 *
 * Handles non-interactive command processing including:
 * - Single prompt processing
 * - Git commit-and-push automation
 * - Piped input handling
 */

import { logger } from "../utils/logger.js";
import type { ChatCompletionMessageParam } from 'openai/resources/chat';

// Lazy imports for heavy modules
const lazyImport = {
  CodeBuddyAgent: () => import('../agent/codebuddy-agent.js').then(m => m.CodeBuddyAgent),
  ConfirmationService: () => import('../utils/confirmation-service.js').then(m => m.ConfirmationService),
};

export interface HeadlessOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  maxToolRounds?: number;
  selfHealEnabled?: boolean;
  outputFormat?: 'json' | 'text' | 'markdown' | 'stream-json';
}

/**
 * Process a single prompt in headless mode and exit
 */
export async function processPromptHeadless(
  prompt: string,
  options: HeadlessOptions
): Promise<void> {
  const {
    apiKey,
    baseURL,
    model,
    maxToolRounds,
    selfHealEnabled = true,
  } = options;

  try {
    const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
    const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure self-healing
    if (!selfHealEnabled) {
      agent.setSelfHealing(false);
    }

    // Configure confirmation service for headless mode (auto-approve all operations)
    const { ConfirmationService } = await import('../utils/confirmation-service.js');
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag('allOperations', true);

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    // Convert chat entries to OpenAI compatible message objects
    const messages: ChatCompletionMessageParam[] = [];

    for (const entry of chatEntries) {
      switch (entry.type) {
        case 'user':
          messages.push({
            role: 'user',
            content: entry.content,
          });
          break;

        case 'assistant': {
          const assistantMessage: ChatCompletionMessageParam = {
            role: 'assistant',
            content: entry.content,
          };

          // Add tool calls if present
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            assistantMessage.tool_calls = entry.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }));
          }

          messages.push(assistantMessage);
          break;
        }

        case 'tool_result':
          if (entry.toolCall) {
            messages.push({
              role: 'tool',
              tool_call_id: entry.toolCall.id,
              content: entry.content,
            });
          }
          break;
      }
    }

    // Output each message as a separate JSON object
    for (const message of messages) {
      console.log(JSON.stringify(message));
    }
  } catch (error: unknown) {
    // Output error in OpenAI compatible format
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        role: 'assistant',
        content: `Error: ${errorMessage}`,
      })
    );
    process.exit(1);
  }
}

/**
 * Handle commit-and-push command in headless mode
 */
export async function handleCommitAndPushHeadless(
  options: HeadlessOptions
): Promise<void> {
  const { apiKey, baseURL, model, maxToolRounds } = options;

  try {
    const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
    const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const { ConfirmationService } = await import('../utils/confirmation-service.js');
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag('allOperations', true);

    console.log('Commit and push in headless mode...\n');
    console.log('> /commit-and-push\n');

    // First check if there are any changes at all
    const initialStatusResult = await agent.executeBashCommand('git status --porcelain');

    if (!initialStatusResult.success || !initialStatusResult.output?.trim()) {
      console.log('No changes to commit. Working directory is clean.');
      process.exit(1);
    }

    console.log('git status: Changes detected');

    // Add all changes
    const addResult = await agent.executeBashCommand('git add .');

    if (!addResult.success) {
      console.log(`git add: ${addResult.error || 'Failed to stage changes'}`);
      process.exit(1);
    }

    console.log('git add: Changes staged');

    // Get staged changes for commit message generation (status is already known)
    const diffResult = await agent.executeBashCommand('git diff --cached');
    // Note: We already have initialStatusResult, so we reuse it for the commit prompt

    // Generate commit message using AI
    const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || 'No staged changes shown'}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

    console.log('Generating commit message...');

    const commitMessageEntries = await agent.processUserMessage(commitPrompt);
    let commitMessage = '';

    // Extract the commit message from the AI response
    for (const entry of commitMessageEntries) {
      if (entry.type === 'assistant' && entry.content.trim()) {
        commitMessage = entry.content.trim();
        break;
      }
    }

    if (!commitMessage) {
      console.log('Failed to generate commit message');
      process.exit(1);
    }

    // Clean the commit message
    const cleanCommitMessage = commitMessage.replace(/^["']|["']$/g, '');
    console.log(`Generated commit message: "${cleanCommitMessage}"`);

    // Execute the commit
    const commitCommand = `git commit -m "${cleanCommitMessage}"`;
    const commitResult = await agent.executeBashCommand(commitCommand);

    if (commitResult.success) {
      console.log(
        `git commit: ${commitResult.output?.split('\n')[0] || 'Commit successful'}`
      );

      // If commit was successful, push to remote
      // First try regular push, if it fails try with upstream setup
      let pushResult = await agent.executeBashCommand('git push');

      if (!pushResult.success && pushResult.error?.includes('no upstream branch')) {
        console.log('Setting upstream and pushing...');
        pushResult = await agent.executeBashCommand('git push -u origin HEAD');
      }

      if (pushResult.success) {
        console.log(
          `git push: ${pushResult.output?.split('\n')[0] || 'Push successful'}`
        );
      } else {
        console.log(`git push: ${pushResult.error || 'Push failed'}`);
        process.exit(1);
      }
    } else {
      console.log(`git commit: ${commitResult.error || 'Commit failed'}`);
      process.exit(1);
    }
  } catch (error: unknown) {
    logger.error('Error during commit and push:', error as Error);
    process.exit(1);
  }
}

/**
 * Read piped input from stdin
 */
export async function readPipedInput(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}
