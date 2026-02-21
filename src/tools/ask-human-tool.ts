/**
 * AskHuman Tool (OpenManus-inspired)
 *
 * Allows the agent to pause mid-task and ask the user a clarifying
 * question. In CLI mode this blocks on readline. In non-interactive
 * environments it returns a timeout message so the agent can proceed
 * with a best-effort answer.
 *
 * The LLM should call this tool when:
 *  - It needs information that cannot be inferred from context
 *  - Multiple valid interpretations exist and the wrong one would waste effort
 *  - A destructive or irreversible action requires explicit human sign-off
 */

import * as readline from 'readline';
import type { ToolResult } from '../types/index.js';

export interface AskHumanInput {
  /** The question to ask the user */
  question: string;
  /** Optional suggested options (presented as a numbered list) */
  options?: string[];
  /** Timeout in seconds before the tool returns a default answer (default: 120) */
  timeout?: number;
  /** Default answer returned on timeout (default: "no answer provided, use best judgement") */
  default?: string;
}

export class AskHumanTool {
  /**
   * Pause agent execution and ask the human a question.
   * Returns the user's typed response as the tool output.
   */
  async execute(input: AskHumanInput): Promise<ToolResult> {
    const {
      question,
      options,
      timeout = 120,
      default: defaultAnswer = 'No answer provided – use your best judgement and continue.',
    } = input;

    // Detect non-interactive environments
    if (!process.stdin.isTTY) {
      return {
        success: true,
        output: defaultAnswer,
      };
    }

    return new Promise<ToolResult>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      let prompt = `\n🤔 Agent needs your input:\n${question}\n`;

      if (options && options.length > 0) {
        prompt += '\nOptions:\n';
        options.forEach((opt, i) => {
          prompt += `  ${i + 1}. ${opt}\n`;
        });
        prompt += '\nEnter your choice (number or free text): ';
      } else {
        prompt += '\nYour answer: ';
      }

      // Auto-timeout
      const timer = setTimeout(() => {
        rl.close();
        resolve({
          success: true,
          output: defaultAnswer,
        });
      }, timeout * 1000);

      rl.question(prompt, (answer) => {
        clearTimeout(timer);
        rl.close();

        // If user picked a number from the options list, expand it
        if (options && options.length > 0) {
          const n = parseInt(answer.trim(), 10);
          if (!isNaN(n) && n >= 1 && n <= options.length) {
            resolve({ success: true, output: options[n - 1] });
            return;
          }
        }

        resolve({
          success: true,
          output: answer.trim() || defaultAnswer,
        });
      });
    });
  }

  getSchema() {
    return {
      name: 'ask_human',
      description:
        'Pause execution and ask the user a clarifying question. Use when you need information that cannot be inferred from context, or when multiple interpretations would lead to very different outcomes. Returns the human\'s typed response.',
      parameters: {
        type: 'object' as const,
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user (be concise and specific)',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of suggested answers the user can pick from',
          },
          timeout: {
            type: 'number',
            description: 'Seconds to wait before returning a default answer (default: 120)',
          },
          default: {
            type: 'string',
            description: 'Default answer to return if the user does not respond in time',
          },
        },
        required: ['question'],
      },
    };
  }
}

let instance: AskHumanTool | null = null;

export function getAskHumanTool(): AskHumanTool {
  if (!instance) {
    instance = new AskHumanTool();
  }
  return instance;
}

export function resetAskHumanTool(): void {
  instance = null;
}
