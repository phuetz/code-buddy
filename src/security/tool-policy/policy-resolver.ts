/**
 * Policy Resolver
 *
 * Resolves policy decisions for tools using hierarchical rules.
 * Resolution order (highest priority first):
 * 1. Explicit session overrides
 * 2. Global overrides
 * 3. Provider-specific rules (MCP, plugins)
 * 4. Agent-specific rules
 * 5. Profile rules (by priority)
 * 6. Default action
 */

import type {
  ToolGroup,
  PolicyProfile,
  PolicyAction,
  PolicyRule,
  PolicyDecision,
  PolicyContext,
  PolicyCondition,
  PolicySource,
  PolicyConfig,
} from './types.js';
import { isChildGroup } from './types.js';
import { getToolGroups } from './tool-groups.js';
import { getProfileRules } from './profiles.js';

// ============================================================================
// Policy Resolver
// ============================================================================

/**
 * Resolves policy decisions for tools
 */
export class PolicyResolver {
  constructor(private config: PolicyConfig) {}

  /**
   * Resolve policy for a tool
   * @param toolName Tool name to check
   * @param context Additional context for resolution
   * @returns Policy decision
   */
  resolve(toolName: string, context?: Partial<PolicyContext>): PolicyDecision {
    const fullContext = this.buildContext(toolName, context);

    // 1. Check session overrides (highest priority)
    if (fullContext.sessionOverrides?.has(toolName)) {
      return this.createDecision(
        fullContext.sessionOverrides.get(toolName)!,
        'Session override',
        'session'
      );
    }

    // 2. Check global overrides
    if (fullContext.globalOverrides?.has(toolName)) {
      return this.createDecision(
        fullContext.globalOverrides.get(toolName)!,
        'Global override',
        'global'
      );
    }

    // Check for tool-specific global rule
    const globalToolRule = this.config.globalRules.find(
      r => r.group === toolName as unknown as ToolGroup
    );
    if (globalToolRule && this.evaluateConditions(globalToolRule.conditions, fullContext)) {
      return this.createDecision(
        globalToolRule.action,
        globalToolRule.reason || 'Global rule',
        'global',
        globalToolRule
      );
    }

    // 3. Check provider-specific rules (for MCP/plugin tools)
    if (fullContext.provider) {
      const providerRules = this.config.providerRules[fullContext.provider];
      if (providerRules) {
        const decision = this.resolveFromRules(providerRules, fullContext, 'provider');
        if (decision) return decision;
      }
    }

    // 4. Check agent-specific rules
    if (fullContext.agentId) {
      const agentRules = this.config.agentRules[fullContext.agentId];
      if (agentRules) {
        const decision = this.resolveFromRules(agentRules, fullContext, 'agent');
        if (decision) return decision;
      }
    }

    // 5. Check global rules by group
    const globalGroupDecision = this.resolveFromRules(
      this.config.globalRules,
      fullContext,
      'global'
    );
    if (globalGroupDecision) return globalGroupDecision;

    // 6. Check profile rules
    const profileRules = getProfileRules(this.config.activeProfile);
    const profileDecision = this.resolveFromRules(profileRules, fullContext, 'profile');
    if (profileDecision) return profileDecision;

    // 7. Fall back to default action
    return this.createDecision(
      this.config.defaultAction,
      'No matching rule found, using default',
      'default'
    );
  }

  /**
   * Resolve from a list of rules
   */
  private resolveFromRules(
    rules: PolicyRule[],
    context: PolicyContext,
    source: PolicySource
  ): PolicyDecision | null {
    // Sort rules by priority (highest first)
    const sortedRules = [...rules].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    // Find best matching rule
    for (const rule of sortedRules) {
      if (this.ruleMatches(rule, context)) {
        if (this.evaluateConditions(rule.conditions, context)) {
          return this.createDecision(
            rule.action,
            rule.reason || `Matched rule for ${rule.group}`,
            source,
            rule
          );
        }
      }
    }

    return null;
  }

  /**
   * Check if a rule matches the context
   */
  private ruleMatches(rule: PolicyRule, context: PolicyContext): boolean {
    // Check if any of the tool's groups match the rule's group
    for (const group of context.groups) {
      if (isChildGroup(group, rule.group)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate conditions for a rule
   */
  private evaluateConditions(
    conditions: PolicyCondition[] | undefined,
    context: PolicyContext
  ): boolean {
    if (!conditions || conditions.length === 0) {
      return true;
    }

    // All conditions must match (AND logic)
    for (const condition of conditions) {
      const result = this.evaluateCondition(condition, context);
      if (condition.negate ? result : !result) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: PolicyCondition,
    context: PolicyContext
  ): boolean {
    const args = context.args || {};

    switch (condition.type) {
      case 'path': {
        // Check if path argument matches pattern
        const pathArg = args.path || args.file || args.target;
        if (typeof pathArg !== 'string') return false;
        return this.matchGlob(pathArg, condition.value);
      }

      case 'command': {
        // Check if command argument matches pattern
        const cmdArg = args.command || args.cmd;
        if (typeof cmdArg !== 'string') return false;
        return cmdArg.includes(condition.value);
      }

      case 'pattern': {
        // Check if any string argument matches regex pattern
        const regex = new RegExp(condition.value, 'i');
        for (const value of Object.values(args)) {
          if (typeof value === 'string' && regex.test(value)) {
            return true;
          }
        }
        return false;
      }

      case 'time': {
        // Check time-based condition (e.g., "business-hours")
        return this.evaluateTimeCondition(condition.value);
      }

      case 'custom': {
        // Custom conditions can be added here
        return true;
      }

      default:
        return true;
    }
  }

  /**
   * Simple glob matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Evaluate time-based condition
   */
  private evaluateTimeCondition(value: string): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    switch (value) {
      case 'business-hours':
        return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
      case 'weekend':
        return day === 0 || day === 6;
      case 'night':
        return hour < 6 || hour >= 22;
      default:
        return true;
    }
  }

  /**
   * Build full context from partial input
   */
  private buildContext(
    toolName: string,
    partial?: Partial<PolicyContext>
  ): PolicyContext {
    let groups = getToolGroups(toolName);

    // Add provider groups if applicable
    if (toolName.startsWith('mcp__')) {
      groups = [...groups, 'group:mcp'];
    } else if (toolName.startsWith('plugin__')) {
      groups = [...groups, 'group:plugin'];
    }

    return {
      toolName,
      groups,
      ...partial,
    };
  }

  /**
   * Create a policy decision
   */
  private createDecision(
    action: PolicyAction,
    reason: string,
    source: PolicySource,
    rule?: PolicyRule
  ): PolicyDecision {
    return {
      action,
      reason,
      source,
      rule,
      timestamp: new Date(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PolicyConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current configuration
   */
  getConfig(): PolicyConfig {
    return { ...this.config };
  }

  /**
   * Check if action allows operation
   */
  static isAllowed(decision: PolicyDecision): boolean {
    return decision.action === 'allow';
  }

  /**
   * Check if action requires confirmation
   */
  static requiresConfirmation(decision: PolicyDecision): boolean {
    return decision.action === 'confirm';
  }

  /**
   * Check if action denies operation
   */
  static isDenied(decision: PolicyDecision): boolean {
    return decision.action === 'deny';
  }
}

// ============================================================================
// Batch Resolution
// ============================================================================

/**
 * Resolve policies for multiple tools
 */
export function resolveMultiple(
  resolver: PolicyResolver,
  toolNames: string[],
  context?: Partial<PolicyContext>
): Map<string, PolicyDecision> {
  const results = new Map<string, PolicyDecision>();

  for (const toolName of toolNames) {
    results.set(toolName, resolver.resolve(toolName, context));
  }

  return results;
}

/**
 * Filter tools by policy
 */
export function filterByPolicy(
  resolver: PolicyResolver,
  toolNames: string[],
  action: PolicyAction,
  context?: Partial<PolicyContext>
): string[] {
  return toolNames.filter(name => {
    const decision = resolver.resolve(name, context);
    return decision.action === action;
  });
}

/**
 * Get allowed tools
 */
export function getAllowedTools(
  resolver: PolicyResolver,
  toolNames: string[],
  context?: Partial<PolicyContext>
): string[] {
  return toolNames.filter(name => {
    const decision = resolver.resolve(name, context);
    return decision.action !== 'deny';
  });
}
