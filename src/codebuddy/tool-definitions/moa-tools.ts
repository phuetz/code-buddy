import type { CodeBuddyTool } from './types.js';

export const MIXTURE_OF_AGENTS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'mixture_of_agents',
    description:
      'Route a genuinely hard problem through several complementary LLMs in parallel, then synthesize their answers. ' +
      'Uses zero-cost OpenRouter variants by default, assigns specialist roles, tolerates saturated providers, and should be used for decisions where diversity improves reliability.',
    parameters: {
      type: 'object',
      properties: {
        user_prompt: {
          type: 'string',
          description:
            'The complex query or problem to solve using multiple model perspectives and a final aggregator.',
        },
        use_case: {
          type: 'string',
          enum: ['balanced', 'fast', 'code', 'architecture', 'decision', 'research', 'security'],
          description:
            'Selects complementary model roles and free OpenRouter models. balanced is the default.',
        },
      },
      required: ['user_prompt'],
    },
  },
};

export const MOA_TOOLS: CodeBuddyTool[] = [MIXTURE_OF_AGENTS_TOOL];
