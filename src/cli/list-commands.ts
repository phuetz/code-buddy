/**
 * List commands for Code Buddy CLI
 *
 * Handles --list-* commands that display available resources
 */

import { loadBaseURL } from './config-loader.js';

/**
 * List available models from the API endpoint
 */
export async function listModels(baseURL?: string): Promise<void> {
  const url = baseURL || loadBaseURL();

  try {
    const response = await fetch(`${url}/models`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as {
      data?: Array<{ id: string; owned_by?: string }>;
    };

    console.log('Available models:\n');
    if (data.data && data.data.length > 0) {
      data.data.forEach((model: { id: string; owned_by?: string }) => {
        console.log(`  - ${model.id}`);
      });
      console.log(`\n  Total: ${data.data.length} model(s)`);
    } else {
      console.log('  (no models found)');
    }
    process.exit(0);
  } catch (error) {
    console.error(`Error fetching models from ${url}/models:`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    console.error('\nMake sure the API server is running (LM Studio, Ollama, etc.)');
    process.exit(1);
  }
}

/**
 * List available system prompts
 */
export async function listPrompts(): Promise<void> {
  const { getPromptManager } = await import('../prompts/prompt-manager.js');
  const promptManager = getPromptManager();
  const prompts = await promptManager.listPrompts();

  console.log('Available system prompts:\n');
  console.log('  Built-in:');
  prompts
    .filter((p) => p.source === 'builtin')
    .forEach((p) => {
      console.log(`    - ${p.id}`);
    });

  const userPrompts = prompts.filter((p) => p.source === 'user');
  if (userPrompts.length > 0) {
    console.log('\n  User (~/.codebuddy/prompts/):');
    userPrompts.forEach((p) => {
      console.log(`    - ${p.id}`);
    });
  }

  console.log('\nUsage: codebuddy --system-prompt <id>');
  console.log('   Create custom prompts in ~/.codebuddy/prompts/<name>.md');
  process.exit(0);
}

/**
 * List available custom agents
 */
export async function listAgents(): Promise<void> {
  const { getCustomAgentLoader } = await import('../agent/custom/custom-agent-loader.js');
  const loader = getCustomAgentLoader();
  const agents = loader.listAgents();

  console.log('Available custom agents:\n');

  if (agents.length === 0) {
    console.log('  (no custom agents found)');
    console.log('\nCreate agents in ~/.codebuddy/agents/');
    console.log('   Example: ~/.codebuddy/agents/_example.toml');
  } else {
    agents.forEach((agent) => {
      const tags = agent.tags?.length ? ` [${agent.tags.join(', ')}]` : '';
      console.log(`  - ${agent.id}: ${agent.name}${tags}`);
      if (agent.description) {
        console.log(`      ${agent.description}`);
      }
    });
    console.log(`\n  Total: ${agents.length} agent(s)`);
  }

  console.log('\nUsage: codebuddy --agent <id>');
  process.exit(0);
}
