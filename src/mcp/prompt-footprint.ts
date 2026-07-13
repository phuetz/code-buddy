import type { MCPTool } from './types.js';
import { estimateTokens } from '../utils/token-counter.js';

export interface MCPToolPromptFootprint {
  name: string;
  characters: number;
  bytes: number;
  estimatedTokens: number;
}

export interface MCPPromptFootprint {
  toolCount: number;
  characters: number;
  bytes: number;
  estimatedTokens: number;
  tools: MCPToolPromptFootprint[];
}

/**
 * Serialize an MCP tool exactly as Code Buddy exposes it to OpenAI-compatible
 * providers. Token counts remain estimates because providers use different
 * tokenizers; characters and UTF-8 bytes are exact.
 */
export function serializeMCPToolForPrompt(tool: MCPTool): string {
  return JSON.stringify({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  });
}

export function measureMCPPromptFootprint(tools: MCPTool[]): MCPPromptFootprint {
  const measured = tools.map((tool) => {
    const serialized = serializeMCPToolForPrompt(tool);
    return {
      name: tool.name,
      characters: serialized.length,
      bytes: Buffer.byteLength(serialized, 'utf8'),
      estimatedTokens: estimateTokens(serialized),
    };
  });

  return {
    toolCount: measured.length,
    characters: measured.reduce((sum, tool) => sum + tool.characters, 0),
    bytes: measured.reduce((sum, tool) => sum + tool.bytes, 0),
    estimatedTokens: measured.reduce((sum, tool) => sum + tool.estimatedTokens, 0),
    tools: measured,
  };
}
