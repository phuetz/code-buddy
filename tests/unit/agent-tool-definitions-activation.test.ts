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

  it('exposes the lessons concept graph to the LLM tool list', () => {
    const names = new Set(AGENT_TOOLS.map((tool) => tool.function.name));

    expect(names.has('lessons_graph')).toBe(true);
  });

  it('exposes the Hermes skill management facade to the LLM tool list', () => {
    const skillManageTool = AGENT_TOOLS.find((tool) => tool.function.name === 'skill_manage');

    expect(skillManageTool).toBeDefined();
    expect(skillManageTool!.function.parameters.properties.action.enum).toEqual([
      'list',
      'view',
      'create',
      'discover',
      'candidate_list',
      'candidate_view',
      'candidate_install',
    ]);
  });

  it('exposes browser proof-loop actions to the LLM schema', () => {
    const browserTool = BROWSER_TOOLS.find((tool) => tool.function.name === 'browser');
    expect(browserTool).toBeDefined();

    const actionEnum = browserTool!.function.parameters.properties.action.enum;
    expect(actionEnum).toContain('observe');
    expect(actionEnum).toContain('extract');
    expect(actionEnum).toContain('assert_text');
    expect(browserTool!.function.parameters.properties.query).toBeDefined();
    expect(browserTool!.function.parameters.properties.expectedText).toBeDefined();
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

  it('makes Hermes Fleet dispatch tools discoverable through metadata keywords', () => {
    const metadataByName = new Map(TOOL_METADATA.map((item) => [item.name, item]));

    expect(metadataByName.get('route_peer')?.keywords).toEqual(
      expect.arrayContaining(['hermes', 'dispatch', 'dispatchProfile', 'toolset', 'policy']),
    );
    expect(metadataByName.get('peer_delegate')?.keywords).toEqual(
      expect.arrayContaining(['hermes', 'dispatch', 'toolset', 'policy']),
    );
    expect(metadataByName.get('peer_chain')?.keywords).toEqual(
      expect.arrayContaining(['hermes', 'chain', 'handoff', 'roles']),
    );
    expect(metadataByName.get('list_peers')?.keywords).toEqual(
      expect.arrayContaining(['capabilities', 'routing', 'hermes']),
    );
  });
});
