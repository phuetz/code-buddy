import { CommandHandlerResult } from './branch-handlers.js';
import { CodeBuddyClient } from '../../codebuddy/client.js';
import { logger } from '../../utils/logger.js';

/** Singleton client reference — set from enhanced-command-handler */
let clientRef: CodeBuddyClient | null = null;

/**
 * Set the CodeBuddyClient reference for /btw calls.
 */
export function setBtwClient(client: CodeBuddyClient | null): void {
  clientRef = client;
}

/**
 * /btw — Side question without tools or history modification.
 *
 * Makes a one-shot LLM call with a minimal system prompt.
 * The response is NOT added to the main conversation history.
 * Advanced enterprise architecture for v2026.3.14's /btw command.
 */
export async function handleBtw(args: string[]): Promise<CommandHandlerResult> {
  const question = args.join(' ').trim();

  if (!question) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Usage: /btw <question>\n\nAsk a quick side question without modifying the conversation context.\nExample: /btw what is CORS?',
        timestamp: new Date(),
      },
    };
  }

  if (!clientRef) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Cannot process /btw: LLM client not available.',
        timestamp: new Date(),
      },
    };
  }

  try {
    const response = await clientRef.chat([
      { role: 'system', content: 'Answer this side question briefly. Do not use tools.' },
      { role: 'user', content: question },
    ]);

    const answer = response?.choices?.[0]?.message?.content;
    if (!answer || answer.trim().length === 0) {
      throw new Error('/btw received no assistant response');
    }

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `**[/btw]** ${answer}`,
        timestamp: new Date(),
      },
      // Do NOT set passToAI — this prevents the main loop from processing further
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('/btw error', { error: msg });
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `/btw error: ${msg}`,
        timestamp: new Date(),
      },
    };
  }
}
