import { describe, it, expect } from 'vitest';
import {
  CORE_TOOLS,
  SEARCH_TOOLS,
  TODO_TOOLS,
  WEB_TOOLS,
  ADVANCED_TOOLS,
  MULTIMODAL_TOOLS,
  COMPUTER_CONTROL_TOOLS,
  BROWSER_TOOLS,
  CANVAS_TOOLS,
  AGENT_TOOLS,
} from '../../src/codebuddy/tool-definitions/index.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

describe('Agent tool activation in LLM schemas', () => {
  it('exposes memory and parallel tools to the LLM tool list', () => {
    const names = new Set(AGENT_TOOLS.map((tool) => tool.function.name));

    expect(names.has('spawn_parallel_agents')).toBe(true);
    expect(names.has('remember')).toBe(true);
    expect(names.has('recall')).toBe(true);
    expect(names.has('forget')).toBe(true);
  });

  it('provides metadata entries for all built-in tool definitions', () => {
    const allToolDefs = [
      ...CORE_TOOLS,
      ...SEARCH_TOOLS,
      ...TODO_TOOLS,
      ...WEB_TOOLS,
      ...ADVANCED_TOOLS,
      ...MULTIMODAL_TOOLS,
      ...COMPUTER_CONTROL_TOOLS,
      ...BROWSER_TOOLS,
      ...CANVAS_TOOLS,
      ...AGENT_TOOLS,
    ];

    const definitionNames = new Set(allToolDefs.map((tool) => tool.function.name));
    const metadataNames = new Set(TOOL_METADATA.map((item) => item.name));
    const missing = Array.from(definitionNames).filter((name) => !metadataNames.has(name));

    expect(missing).toEqual([]);
  });
});
