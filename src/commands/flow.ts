/**
 * buddy flow — Planning Flow CLI command (OpenManus-compatible)
 *
 * Executes a multi-agent planning flow: plan → execute → synthesize.
 *
 * Usage:
 *   buddy flow "Fix the authentication bug in src/auth/"
 *   buddy flow "Refactor the API layer" --max-retries 2
 */

import { Command } from 'commander';
import type { ExecutionPlan } from '../agent/flow/planning-flow.js';
import { getSettingsManager } from '../utils/settings-manager.js';
import { detectProviderFromEnv, selectModelForDetectedProvider } from '../utils/provider-detector.js';

function extractContent(response: { choices: Array<{ message: { content: string | null } }> }): string {
  return response.choices?.[0]?.message?.content || '';
}

export function createFlowCommand(): Command {
  const cmd = new Command('flow')
    .description('Execute a multi-agent planning flow (OpenManus-compatible)')
    .argument('<goal>', 'The goal to plan and execute')
    .option('--max-retries <n>', 'Max retries per failed step', '1')
    .option('--default-agent <key>', 'Default agent key', 'default')
    .option('--verbose', 'Show step-by-step progress', false)
    .action(async (goal: string, options) => {
      const settingsManager = getSettingsManager();
      const provider = detectProviderFromEnv();

      if (!provider) {
        console.error('Error: No AI provider configured. Run: buddy login chatgpt');
        process.exit(1);
      }

      console.log(`\n  Planning Flow: "${goal}"\n`);

      try {
        const { PlanningFlow } = await import('../agent/flow/planning-flow.js');
        const { CodeBuddyClient } = await import('../codebuddy/client.js');

        const model = selectModelForDetectedProvider(provider, settingsManager.getCurrentModel());
        const client = new CodeBuddyClient(provider.apiKey, model, provider.baseURL);

        // Plan with LLM function
        const planWithLLM = async (prompt: string): Promise<string> => {
          const response = await client.chat([
            {
              role: 'system',
              content: 'You are a planning agent. Given a goal, output a JSON object with a "steps" array. Each step has: id, title, description, agentKey (use "default"), dependencies (array of step ids). Output ONLY valid JSON, no markdown.',
            },
            { role: 'user', content: prompt },
          ]);
          return extractContent(response);
        };

        // Default agent: uses the LLM to execute step instructions
        const defaultAgent = {
          name: 'default',
          run: async (instruction: string): Promise<string> => {
            const response = await client.chat([
              {
                role: 'system',
                content: 'You are a software engineering agent. Execute the given instruction and report results concisely.',
              },
              { role: 'user', content: instruction },
            ]);
            return extractContent(response);
          },
        };

        const agents = new Map([['default', defaultAgent]]);

        const flow = new PlanningFlow({
          planWithLLM,
          agents,
          defaultAgentKey: options.defaultAgent,
          maxRetries: parseInt(options.maxRetries, 10),
        });

        // Progress events
        if (options.verbose) {
          flow.on('flow:plan_created', (data: { plan?: ExecutionPlan }) => {
            console.log(`  Plan: ${data.plan?.steps.length ?? 0} steps`);
          });
          flow.on('flow:step_start', (data: { title: string }) => {
            console.log(`  [${flow.getProgress()}%] Step: ${data.title}`);
          });
          flow.on('flow:step_complete', (data: { title: string; duration?: number }) => {
            const duration = typeof data.duration === 'number' ? `, ${data.duration}ms` : '';
            console.log(`  Done: ${data.title}${duration}`);
          });
        }

        const result = await flow.execute(goal);
        console.log(result);
      } catch (err) {
        console.error('Flow error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  return cmd;
}
