/**
 * Research Tool Adapters (factory)
 *
 * Wires the `deep_research` ITool adapter into the FormalToolRegistry so it is
 * DISPATCHABLE in interactive chat (via `ToolHandler.initializeRegistry`), not
 * only in headless/multi-agent runs. The adapter itself (business delegation +
 * conservative in-chat bounds) lives in src/tools/deep-research-tool.ts.
 */

import type { ITool } from './types.js';
import { DeepResearchTool } from '../deep-research-tool.js';

/**
 * Create all research tool instances.
 */
export function createResearchTools(): ITool[] {
  return [new DeepResearchTool()];
}
