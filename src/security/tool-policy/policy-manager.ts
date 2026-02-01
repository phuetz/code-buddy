/**
 * Policy Manager
 *
 * Singleton manager for tool policies. Coordinates policy resolution,
 * configuration persistence, and event emission.
 *
 * Usage:
 * ```typescript
 * const manager = getPolicyManager();
 * const decision = manager.checkTool('bash', { command: 'npm install' });
 * if (decision.action === 'allow') {
 *   // Execute tool
 * } else if (decision.action === 'confirm') {
 *   // Request user confirmation
 * } else {
 *   // Deny operation
 * }
 * ```
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  PolicyProfile,
  PolicyAction,
  PolicyRule,
  PolicyDecision,
  PolicyContext,
  PolicyConfig,
  PolicyEvents,
  ToolGroup,
} from './types.js';
import { DEFAULT_POLICY_CONFIG } from './types.js';
import { PolicyResolver } from './policy-resolver.js';
import { getProfile, getProfileNames } from './profiles.js';
import { getToolGroups, registerToolGroups } from './tool-groups.js';

// ============================================================================
// Policy Manager
// ============================================================================

/**
 * Central manager for tool policies
 */
export class PolicyManager extends EventEmitter {
  private config: PolicyConfig;
  private resolver: PolicyResolver;
  private configPath: string;
  private sessionOverrides: Map<string, PolicyAction> = new Map();
  private decisionCache: Map<string, PolicyDecision> = new Map();
  private auditLog: Array<{ timestamp: Date; decision: PolicyDecision; context: PolicyContext }> = [];

  constructor(configDir?: string) {
    super();
    this.configPath = this.getConfigPath(configDir);
    this.config = this.loadConfig();
    this.resolver = new PolicyResolver(this.config);
  }

  // ============================================================================
  // Core API
  // ============================================================================

  /**
   * Check policy for a tool
   * @param toolName Tool to check
   * @param args Tool arguments (for conditional rules)
   * @returns Policy decision
   */
  checkTool(toolName: string, args?: Record<string, unknown>): PolicyDecision {
    // Check cache first
    const cacheKey = this.getCacheKey(toolName, args);
    const cached = this.decisionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const context: Partial<PolicyContext> = {
      args,
      sessionOverrides: this.sessionOverrides,
    };

    const decision = this.resolver.resolve(toolName, context);

    // Cache the decision
    this.decisionCache.set(cacheKey, decision);

    // Log if audit mode is enabled
    if (this.config.auditLog) {
      this.logDecision(decision, { toolName, groups: getToolGroups(toolName), ...context });
    }

    // Emit event
    this.emit('policy:decision', { ...decision, context: { toolName, groups: getToolGroups(toolName), ...context } });

    if (decision.action === 'deny') {
      this.emit('policy:denied', { ...decision, context: { toolName, groups: getToolGroups(toolName), ...context } });
    }

    return decision;
  }

  /**
   * Check if a tool is allowed (shorthand)
   */
  isAllowed(toolName: string, args?: Record<string, unknown>): boolean {
    const decision = this.checkTool(toolName, args);
    return decision.action === 'allow';
  }

  /**
   * Check if a tool requires confirmation
   */
  requiresConfirmation(toolName: string, args?: Record<string, unknown>): boolean {
    const decision = this.checkTool(toolName, args);
    return decision.action === 'confirm';
  }

  /**
   * Check if a tool is denied
   */
  isDenied(toolName: string, args?: Record<string, unknown>): boolean {
    const decision = this.checkTool(toolName, args);
    return decision.action === 'deny';
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Get current profile
   */
  getProfile(): PolicyProfile {
    return this.config.activeProfile;
  }

  /**
   * Set active profile
   */
  setProfile(profile: PolicyProfile): void {
    if (!getProfileNames().includes(profile)) {
      throw new Error(`Invalid profile: ${profile}. Available: ${getProfileNames().join(', ')}`);
    }

    const previousProfile = this.config.activeProfile;
    this.config.activeProfile = profile;
    this.resolver.updateConfig(this.config);
    this.clearCache();

    this.emit('policy:profile-changed', { from: previousProfile, to: profile });
    this.saveConfig();
  }

  /**
   * Get profile info
   */
  getProfileInfo(profile?: PolicyProfile) {
    return getProfile(profile || this.config.activeProfile);
  }

  /**
   * Get all available profiles
   */
  getAvailableProfiles(): PolicyProfile[] {
    return getProfileNames();
  }

  // ============================================================================
  // Session Overrides
  // ============================================================================

  /**
   * Set session override for a tool
   */
  setSessionOverride(toolName: string, action: PolicyAction): void {
    this.sessionOverrides.set(toolName, action);
    this.clearCache();
  }

  /**
   * Clear session override for a tool
   */
  clearSessionOverride(toolName: string): void {
    this.sessionOverrides.delete(toolName);
    this.clearCache();
  }

  /**
   * Clear all session overrides
   */
  clearAllSessionOverrides(): void {
    this.sessionOverrides.clear();
    this.clearCache();
  }

  /**
   * Get all session overrides
   */
  getSessionOverrides(): Map<string, PolicyAction> {
    return new Map(this.sessionOverrides);
  }

  // ============================================================================
  // Rule Management
  // ============================================================================

  /**
   * Add a global rule
   */
  addGlobalRule(rule: PolicyRule): void {
    this.config.globalRules.push(rule);
    this.resolver.updateConfig(this.config);
    this.clearCache();
    this.emit('policy:rule-added', { rule, source: 'global' });
    this.saveConfig();
  }

  /**
   * Add an agent-specific rule
   */
  addAgentRule(agentId: string, rule: PolicyRule): void {
    if (!this.config.agentRules[agentId]) {
      this.config.agentRules[agentId] = [];
    }
    this.config.agentRules[agentId].push(rule);
    this.resolver.updateConfig(this.config);
    this.clearCache();
    this.emit('policy:rule-added', { rule, source: 'agent' });
    this.saveConfig();
  }

  /**
   * Add a provider-specific rule
   */
  addProviderRule(providerId: string, rule: PolicyRule): void {
    if (!this.config.providerRules[providerId]) {
      this.config.providerRules[providerId] = [];
    }
    this.config.providerRules[providerId].push(rule);
    this.resolver.updateConfig(this.config);
    this.clearCache();
    this.emit('policy:rule-added', { rule, source: 'provider' });
    this.saveConfig();
  }

  /**
   * Remove a global rule
   */
  removeGlobalRule(group: ToolGroup): boolean {
    const index = this.config.globalRules.findIndex(r => r.group === group);
    if (index >= 0) {
      this.config.globalRules.splice(index, 1);
      this.resolver.updateConfig(this.config);
      this.clearCache();
      this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Get all global rules
   */
  getGlobalRules(): PolicyRule[] {
    return [...this.config.globalRules];
  }

  // ============================================================================
  // Tool Registration
  // ============================================================================

  /**
   * Register a tool with its groups
   */
  registerTool(toolName: string, groups: ToolGroup[]): void {
    registerToolGroups(toolName, groups);
    this.clearCache();
  }

  /**
   * Get groups for a tool
   */
  getToolGroups(toolName: string): ToolGroup[] {
    return getToolGroups(toolName);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): PolicyConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<PolicyConfig>): void {
    Object.assign(this.config, updates);
    this.resolver.updateConfig(this.config);
    this.clearCache();
    this.saveConfig();
  }

  /**
   * Reset to default configuration
   */
  resetConfig(): void {
    this.config = { ...DEFAULT_POLICY_CONFIG };
    this.resolver = new PolicyResolver(this.config);
    this.clearCache();
    this.saveConfig();
  }

  /**
   * Enable/disable audit logging
   */
  setAuditLog(enabled: boolean): void {
    this.config.auditLog = enabled;
    this.saveConfig();
  }

  /**
   * Get audit log
   */
  getAuditLog(): Array<{ timestamp: Date; decision: PolicyDecision; context: PolicyContext }> {
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Get config file path
   */
  private getConfigPath(configDir?: string): string {
    const dir = configDir || path.join(os.homedir(), '.codebuddy');
    return path.join(dir, 'tool-policy.json');
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): PolicyConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(content) as Partial<PolicyConfig>;

        // Validate and merge with defaults
        return {
          ...DEFAULT_POLICY_CONFIG,
          ...loaded,
          // Ensure arrays are not undefined
          globalRules: loaded.globalRules || [],
          agentRules: loaded.agentRules || {},
          providerRules: loaded.providerRules || {},
        };
      }
    } catch (error) {
      this.emit('policy:error', { error: error as Error });
    }

    return { ...DEFAULT_POLICY_CONFIG };
  }

  /**
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      this.emit('policy:config-saved', { config: this.config });
    } catch (error) {
      this.emit('policy:error', { error: error as Error });
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Get cache key for tool/args combination
   */
  private getCacheKey(toolName: string, args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) {
      return toolName;
    }
    // Include relevant args in cache key
    const relevantArgs = ['path', 'file', 'target', 'command', 'cmd'];
    const argParts = relevantArgs
      .filter(key => args[key])
      .map(key => `${key}:${args[key]}`)
      .join('|');
    return argParts ? `${toolName}|${argParts}` : toolName;
  }

  /**
   * Clear decision cache
   */
  private clearCache(): void {
    this.decisionCache.clear();
  }

  /**
   * Log decision for audit
   */
  private logDecision(decision: PolicyDecision, context: PolicyContext): void {
    this.auditLog.push({
      timestamp: new Date(),
      decision,
      context,
    });

    // Keep audit log bounded
    const maxLogSize = 1000;
    if (this.auditLog.length > maxLogSize) {
      this.auditLog = this.auditLog.slice(-maxLogSize);
    }
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const profile = this.getProfileInfo();
    const icons: Record<PolicyProfile, string> = {
      minimal: '🔒',
      coding: '💻',
      messaging: '💬',
      full: '🔓',
    };

    let output = '🛡️ Tool Policy Status\n' + '═'.repeat(50) + '\n\n';
    output += `Profile: ${icons[this.config.activeProfile]} ${this.config.activeProfile.toUpperCase()}\n`;
    output += `${profile.description}\n\n`;

    output += '📋 Global Rules: ' + (this.config.globalRules.length || 'None') + '\n';
    output += '👤 Agent Rules: ' + Object.keys(this.config.agentRules).length + ' agents\n';
    output += '🔌 Provider Rules: ' + Object.keys(this.config.providerRules).length + ' providers\n';
    output += '📝 Session Overrides: ' + this.sessionOverrides.size + '\n\n';

    output += `Audit Log: ${this.config.auditLog ? '✅ Enabled' : '❌ Disabled'}\n`;
    output += `Default Action: ${this.config.defaultAction}\n`;

    return output;
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.removeAllListeners();
    this.clearCache();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let policyManagerInstance: PolicyManager | null = null;

/**
 * Get or create the PolicyManager singleton
 */
export function getPolicyManager(configDir?: string): PolicyManager {
  if (!policyManagerInstance) {
    policyManagerInstance = new PolicyManager(configDir);
  }
  return policyManagerInstance;
}

/**
 * Reset the PolicyManager singleton
 */
export function resetPolicyManager(): void {
  if (policyManagerInstance) {
    policyManagerInstance.dispose();
  }
  policyManagerInstance = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick check if tool is allowed
 */
export function isToolAllowed(toolName: string, args?: Record<string, unknown>): boolean {
  return getPolicyManager().isAllowed(toolName, args);
}

/**
 * Quick check if tool requires confirmation
 */
export function toolRequiresConfirmation(toolName: string, args?: Record<string, unknown>): boolean {
  return getPolicyManager().requiresConfirmation(toolName, args);
}

/**
 * Quick check if tool is denied
 */
export function isToolDenied(toolName: string, args?: Record<string, unknown>): boolean {
  return getPolicyManager().isDenied(toolName, args);
}
