/**
 * Tool filter plumbing for custom agents.
 *
 * Custom agents have supported `tools` and `disabledTools` in their
 * config for a while. This helper turns those fields into the global
 * tool-filter format used by the Code Buddy tool registry.
 */

import type { ToolFilterConfig } from '../../utils/tool-filter.js';
import type { CustomAgentConfig } from './custom-agent-loader.js';
import { TOOL_ALIASES } from '../../tools/registry/tool-alias-map.js';
import { parseAgentTools, resolveAgentTool } from '../agent-tools.js';
import { filterToolNames } from '../../utils/tool-filter.js';
import { buildDispatchToolFilter } from '../../fleet/dispatch-profile.js';

const EMPTY_FILTER: ToolFilterConfig = {
  enabledPatterns: [],
  disabledPatterns: [],
};

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function hasCustomAgentToolFilter(agent: CustomAgentConfig): boolean {
  return Boolean(agent.tools !== undefined || agent.disabledTools?.length || agent.fleetDispatchProfile);
}

export function buildCustomAgentToolFilter(
  agent: CustomAgentConfig,
  existing: ToolFilterConfig = EMPTY_FILTER,
  availableTools: readonly string[] = [],
): ToolFilterConfig {
  // Programmatic configs must obey the same contract as files.
  parseAgentTools(agent.tools);
  parseAgentTools(agent.disabledTools, 'deny');
  const agentEnabled = unique((agent.tools ?? []).flatMap(name => resolveAgentTool(name) === 'bash' ? ['bash', 'terminal', 'shell_exec', 'interactive_shell'] : [name]));
  const rawDisabled = agent.disabledTools ?? [];
  const names = [...Object.keys(TOOL_ALIASES), ...Object.values(TOOL_ALIASES), 'interactive_shell'];
  const deniedEffects = new Set(filterToolNames(names, { enabledPatterns: rawDisabled, disabledPatterns: [] }).map(resolveAgentTool));
  const agentDisabled = rawDisabled.length ? unique([...rawDisabled, ...names.filter(name => deniedEffects.has(resolveAgentTool(name)))]) : [];
  const profileFilter = agent.fleetDispatchProfile && availableTools.length > 0
    ? buildDispatchToolFilter(agent.fleetDispatchProfile, availableTools)
    : EMPTY_FILTER;

  return {
    enabledPatterns: unique(
      existing.enabledPatterns.length > 0
        ? existing.enabledPatterns
        : agentEnabled.length > 0
          ? agentEnabled
          : profileFilter.enabledPatterns,
    ),
    disabledPatterns: unique([
      ...profileFilter.disabledPatterns,
      ...existing.disabledPatterns,
      ...agentDisabled,
      ...(agent.tools?.length === 0 ? ['*'] : []),
    ]),
  };
}
