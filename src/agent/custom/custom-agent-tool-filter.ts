/**
 * Tool filter plumbing for custom agents.
 *
 * Custom agents have supported `tools` and `disabledTools` in their
 * config for a while. This helper turns those fields into the global
 * tool-filter format used by the Code Buddy tool registry.
 */

import type { ToolFilterConfig } from '../../utils/tool-filter.js';
import type { CustomAgentConfig } from './custom-agent-loader.js';
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
  const agentEnabled = agent.tools ?? [];
  const agentDisabled = agent.disabledTools ?? [];
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
