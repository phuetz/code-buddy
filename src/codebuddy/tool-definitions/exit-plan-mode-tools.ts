/**
 * ExitPlanMode Tool Definitions
 *
 * OpenAI function-calling schema for `exit_plan_mode` (V4.4).
 * Lets the LLM request user approval to leave plan mode and start
 * executing the plan it just produced.
 */

import type { CodeBuddyTool } from './types.js';

export const EXIT_PLAN_MODE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'exit_plan_mode',
    description:
      'Signal that your plan-mode research is complete and request user approval to leave ' +
      'plan mode (DEFAULT mode) so you can start executing. Use ONLY when (a) you have ' +
      'already produced/updated a plan markdown file, OR (b) you provide a `planSummary` ' +
      'inline; AND the user has not yet approved it. The tool shows the plan to the user ' +
      'and prompts for approval — on approval the agent switches to DEFAULT mode and you ' +
      'may run write/execute tools; on rejection plan mode stays active and you should ' +
      'refine the plan based on the rejection reason. Errors in non-TTY environments ' +
      '(CI, --prompt one-shot) — in that case present the markdown plan and ask the user ' +
      'to leave plan mode manually with `/plan off`.',
    parameters: {
      type: 'object',
      properties: {
        allowedPrompts: {
          type: 'array',
          description:
            'Optional list of the next tool calls you intend to run after approval ' +
            '(informational only — surfaced to the user so they know what they are ' +
            'signing off on). Max 16 items.',
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                description: 'Tool name you intend to call (e.g., "create_file", "bash")',
              },
              prompt: {
                type: 'string',
                description: 'Short description of the intended call (≤500 chars)',
              },
            },
            required: ['tool', 'prompt'],
          },
        },
        planSummary: {
          type: 'string',
          description:
            'Optional inline plan text shown to the user when no plan markdown file ' +
            'has been registered. Keep ≤8000 chars.',
        },
      },
      required: [],
    },
  },
};

// Write the plan file and request approval. Complementary to exit_plan_mode:
// this tool persists `.codebuddy/plans/current.md` and emits
// __PLAN_APPROVAL_REQUEST__ (consumed by the streaming runner). Already on
// the plan-mode allowlist (src/agent/plan-mode.ts) — without this schema the
// allowlist name was dead. Dispatch: src/tools/submit-plan-tool.ts.
export const SUBMIT_PLAN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description:
      'Submit a completed research/execution plan for user approval. Writes `.codebuddy/plans/current.md` and pauses for approval. Use in Plan Mode when research is complete: once approved you exit Plan Mode and gain write permissions. Prefer this over shelling a plan file. Distinct from exit_plan_mode, which requests to leave Plan Mode (optionally with an inline summary) without writing current.md.',
    parameters: {
      type: 'object',
      properties: {
        plan_content: {
          type: 'string',
          description:
            'The detailed markdown content of your plan: what will change, which files will be modified, and which commands will run.',
        },
      },
      required: ['plan_content'],
    },
  },
};

export const EXIT_PLAN_MODE_TOOLS: CodeBuddyTool[] = [EXIT_PLAN_MODE_TOOL, SUBMIT_PLAN_TOOL];
