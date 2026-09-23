import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { CodeBuddyClient } from "../../codebuddy/client.js";
import { AITestRunner, createAITestRunner } from "../../testing/ai-integration-tests.js";

export interface CommandHandlerResult {
  handled: boolean;
  failed?: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Generate Tests - Create test scaffolds
 */
export function handleGenerateTests(args: string[]): CommandHandlerResult {
  const targetFile = args[0];

  if (!targetFile) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🧪 Test Generator

Usage: /generate-tests <file>

Example: /generate-tests src/utils/helpers.ts

This will:
1. Analyze the file
2. Detect the test framework
3. Generate comprehensive tests`,
        timestamp: new Date(),
      },
    };
  }

  return {
    handled: true,
    passToAI: true,
    prompt: `Generate comprehensive tests for: ${targetFile}

1. Read and analyze the file
2. Identify all testable functions/methods
3. Generate unit tests covering:
   - Happy paths
   - Edge cases
   - Error conditions
4. Use the detected test framework conventions
5. Create the test file in the appropriate location`,
  };
}

/**
 * AI Test - Run integration tests on the current AI provider
 */
export async function handleAITest(
  args: string[],
  codebuddyClient: CodeBuddyClient | null
): Promise<CommandHandlerResult> {
  const option = args[0]?.toLowerCase();

  // Check for API key
  const apiKey = process.env.GROK_API_KEY;
  if (!codebuddyClient && !apiKey) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ AI Test Failed

No GROK_API_KEY environment variable found.
Set your API key to run integration tests.`,
        timestamp: new Date(),
      },
    };
  }

  // Use current client if available, otherwise create new one from env
  let client = codebuddyClient;
  if (!client) {
    // Fallback: create client from environment variables
    const model = process.env.GROK_MODEL || process.env.OPENAI_MODEL;
    const baseURL = process.env.GROK_BASE_URL || process.env.OPENAI_BASE_URL;
    client = new CodeBuddyClient(apiKey ?? '', model, baseURL);
  }

  const currentBaseURL = client.getBaseURL();

  // Detect local models (LM Studio, Ollama) and increase timeout
  const isLocalModel = currentBaseURL.includes(':1234') ||
                       currentBaseURL.includes(':11434') ||
                       currentBaseURL.includes('localhost') ||
                       currentBaseURL.includes('127.0.0.1') ||
                       currentBaseURL.match(/10\.\d+\.\d+\.\d+/) !== null;

  // Local models get 120s timeout (vs 30s for cloud APIs)
  const timeout = isLocalModel ? 120000 : 30000;

  // Configure test options based on argument
  const testOptions = {
    timeout,
    verbose: false,
    skipExpensive: option === 'quick',
    testTools: option !== 'stream',
    testStreaming: option !== 'tools',
  };

  // Ink owns the terminal. Render the final report through the conversation
  // instead of writing cursor-control sequences over the active UI.
  try {
    const runner = createAITestRunner(client, testOptions);
    const suite = await runner.runAll();

    // Format final results
    const resultContent = AITestRunner.formatResults(suite);

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: resultContent,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ AI Test Error

${error instanceof Error ? error.message : String(error)}

Check your API key and network connection.`,
        timestamp: new Date(),
      },
    };
  }
}
