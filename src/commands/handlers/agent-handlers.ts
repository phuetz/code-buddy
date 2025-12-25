/**
 * Agent command handlers
 *
 * Handles /agent commands for custom agent management:
 * - /agent - List all agents
 * - /agent <id> - Activate an agent
 * - /agent create <name> - Create a new agent
 * - /agent info <id> - Show agent details
 */

import { getCustomAgentLoader } from '../../agent/custom/custom-agent-loader.js';

export interface CommandHandlerResult {
  handled: boolean;
  output?: string;
  error?: string;
  passToAI?: boolean;
  systemPrompt?: string;
  prompt?: string;
}

/**
 * Handle /agent command
 */
export function handleAgent(args: string[]): CommandHandlerResult {
  const loader = getCustomAgentLoader();

  // No args - list agents
  if (args.length === 0) {
    return {
      handled: true,
      output: loader.formatAgentList(),
    };
  }

  const subcommand = args[0].toLowerCase();

  // Create new agent
  if (subcommand === 'create') {
    return handleAgentCreate(args.slice(1));
  }

  // Show agent info
  if (subcommand === 'info') {
    return handleAgentInfo(args.slice(1));
  }

  // Reload agents
  if (subcommand === 'reload') {
    // Force cache clear by creating new loader
    const agents = loader.listAgents();
    return {
      handled: true,
      output: `Reloaded ${agents.length} custom agent(s).`,
    };
  }

  // Activate agent by ID
  return handleAgentActivate(args);
}

/**
 * Create a new agent
 */
function handleAgentCreate(args: string[]): CommandHandlerResult {
  if (args.length === 0) {
    return {
      handled: true,
      output: `Usage: /agent create <name>

This will create a new agent configuration file.

Example:
  /agent create code-reviewer
  /agent create "Security Analyst"

The agent will be created in ~/.codebuddy/agents/ with a default template.
You can then edit the .toml file to customize the system prompt and settings.`,
    };
  }

  const name = args.join(' ');
  const loader = getCustomAgentLoader();

  try {
    const filePath = loader.createAgent(
      name,
      `Custom agent: ${name}`,
      `You are ${name}. Help the user with their tasks.`
    );

    return {
      handled: true,
      output: `Created agent "${name}"

Configuration file: ${filePath}

Edit this file to customize:
- systemPrompt: The agent's personality and instructions
- triggers: Words that auto-activate this agent
- tools: Which tools the agent can use
- temperature: Response creativity (0-2)

Then use /agent ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} to activate it.`,
    };
  } catch (error) {
    return {
      handled: true,
      error: `Failed to create agent: ${error}`,
    };
  }
}

/**
 * Show agent details
 */
function handleAgentInfo(args: string[]): CommandHandlerResult {
  if (args.length === 0) {
    return {
      handled: true,
      output: 'Usage: /agent info <agent-id>',
    };
  }

  const id = args[0];
  const loader = getCustomAgentLoader();
  const agent = loader.getAgent(id);

  if (!agent) {
    const agents = loader.listAgents();
    const suggestions = agents
      .filter(a => a.id.includes(id) || a.name.toLowerCase().includes(id.toLowerCase()))
      .map(a => a.id);

    return {
      handled: true,
      error: `Agent "${id}" not found.${suggestions.length ? `\n\nDid you mean: ${suggestions.join(', ')}?` : ''}`,
    };
  }

  const lines = [
    `Agent: ${agent.name}`,
    '─'.repeat(50),
    `ID: ${agent.id}`,
    `Description: ${agent.description || '(none)'}`,
    '',
  ];

  if (agent.author) lines.push(`Author: ${agent.author}`);
  if (agent.version) lines.push(`Version: ${agent.version}`);
  if (agent.model) lines.push(`Model: ${agent.model}`);
  if (agent.temperature !== undefined) lines.push(`Temperature: ${agent.temperature}`);
  if (agent.maxTokens) lines.push(`Max Tokens: ${agent.maxTokens}`);
  if (agent.tags?.length) lines.push(`Tags: ${agent.tags.join(', ')}`);
  if (agent.triggers?.length) lines.push(`Triggers: ${agent.triggers.join(', ')}`);
  if (agent.tools?.length) lines.push(`Allowed Tools: ${agent.tools.join(', ')}`);
  if (agent.disabledTools?.length) lines.push(`Disabled Tools: ${agent.disabledTools.join(', ')}`);

  lines.push('');
  lines.push('System Prompt:');
  lines.push('─'.repeat(50));
  lines.push(agent.systemPrompt.slice(0, 500) + (agent.systemPrompt.length > 500 ? '...' : ''));

  return {
    handled: true,
    output: lines.join('\n'),
  };
}

/**
 * Activate an agent
 */
function handleAgentActivate(args: string[]): CommandHandlerResult {
  const id = args[0];
  const loader = getCustomAgentLoader();
  const agent = loader.getAgent(id);

  if (!agent) {
    const agents = loader.listAgents();
    const suggestions = agents
      .filter(a => a.id.includes(id) || a.name.toLowerCase().includes(id.toLowerCase()))
      .map(a => a.id);

    return {
      handled: true,
      error: `Agent "${id}" not found.${suggestions.length ? `\n\nDid you mean: ${suggestions.join(', ')}?` : ''}

Use /agent to list available agents.`,
    };
  }

  // Build the activation prompt
  const remainingArgs = args.slice(1).join(' ');
  const prompt = remainingArgs || `You are now activated as "${agent.name}". How can I help you?`;

  return {
    handled: true,
    output: `Activated agent: ${agent.name}`,
    passToAI: true,
    systemPrompt: agent.systemPrompt,
    prompt: prompt,
  };
}

/**
 * Check if input triggers any custom agent
 */
export function checkAgentTriggers(input: string): CommandHandlerResult | null {
  const loader = getCustomAgentLoader();
  const matchingAgents = loader.findByTrigger(input);

  if (matchingAgents.length === 0) {
    return null;
  }

  // Use the first matching agent
  const agent = matchingAgents[0];

  return {
    handled: false, // Don't fully handle - let the message through with modified context
    passToAI: true,
    systemPrompt: agent.systemPrompt,
  };
}
