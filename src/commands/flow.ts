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
import { resolveCommandProvider } from './llm-provider-resolution.js';

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
    .option('-m, --model <model>', 'Override the model for this flow run')
    .action(async (goal: string, options, command) => {
      // The root program also declares a global `-m, --model`; depending on
      // argv order Commander can bind it there — merge so either wins.
      const modelOverride: string | undefined = options.model ?? command?.optsWithGlobals?.()?.model;
      const resolved = resolveCommandProvider({ explicitModel: modelOverride });
      if (!resolved) {
        console.error(
          'Error: No provider available — set an API key, run `buddy onboard`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        );
        process.exit(1);
      }

      console.log(`\n  Planning Flow: "${goal}"\n`);

      try {
        const { PlanningFlow } = await import('../agent/flow/planning-flow.js');
        const { CodeBuddyClient } = await import('../codebuddy/client.js');

        const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);

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
          flow.on('flow:plan_created', (data: any) => {
            console.log(`  Plan: ${data.stepCount} steps`);
          });
          flow.on('flow:step_start', (data: any) => {
            console.log(`  [${flow.getProgress()}%] Step: ${data.title}`);
          });
          flow.on('flow:step_complete', (data: any) => {
            console.log(`  Done: ${data.title} (${data.status ?? 'completed'})`);
          });
          flow.on('flow:step_failed', (data: any) => {
            console.log(`  Failed: ${data.stepId ?? ''} ${data.error ?? ''}`.trim());
          });
        }

        const result = await flow.execute(goal);
        console.log(result);
        if (!flow.succeeded) {
          process.exitCode = 1;
        }
      } catch (err) {
        console.error('Flow error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  return cmd;
}
