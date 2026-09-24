/**
 * Enterprise Managed Policies
 *
 * Reads organization-level policies from system paths to enforce
 * tool restrictions, command restrictions, cost limits, and model allowlists.
 *
 * Policy files:
 * - /etc/codebuddy/managed-settings.json (Linux system-wide)
 * - ~/.codebuddy/managed-settings.json (fallback for testing)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';
import {
  applyDomainPolicy,
  commandMatchesDeny,
  domainPolicyFromManagedFile,
  type DomainAssessment,
  type DomainPolicy,
  type DomainPosture,
  type PolicyFinding,
} from './domain-policy.js';

// ============================================================================
// Types
// ============================================================================

export interface ManagedPoliciesConfig {
  allowManagedPermissionRulesOnly: boolean;
  allowManagedHooksOnly: boolean;
  disallowedTools: string[];
  disallowedCommands: string[];
  maxSessionCost?: number;
  allowedModels?: string[];
  /** Overlays par domaine. Absents si le fichier n'en déclare pas. */
  domains?: DomainPolicy;
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_MANAGED_PATH = '/etc/codebuddy/managed-settings.json';
const USER_MANAGED_PATH = path.join(os.homedir(), '.codebuddy', 'managed-settings.json');

const DEFAULT_POLICIES: ManagedPoliciesConfig = {
  allowManagedPermissionRulesOnly: false,
  allowManagedHooksOnly: false,
  disallowedTools: [],
  disallowedCommands: [],
};

// ============================================================================
// ManagedPoliciesManager
// ============================================================================

export class ManagedPoliciesManager {
  private policies: ManagedPoliciesConfig = { ...DEFAULT_POLICIES };
  private domainLoadFindings: PolicyFinding[] = [];
  private managed: boolean = false;
  private systemPath: string;
  private userPath: string;

  constructor(systemPath?: string, userPath?: string) {
    this.systemPath = systemPath ?? SYSTEM_MANAGED_PATH;
    this.userPath = userPath ?? USER_MANAGED_PATH;
    this.loadPolicies();
  }

  /**
   * Load policies from managed settings files.
   * System path takes priority over user path.
   */
  loadPolicies(): void {
    // Try system path first
    const loaded = this.tryLoadFrom(this.systemPath) || this.tryLoadFrom(this.userPath);

    if (!loaded) {
      this.policies = { ...DEFAULT_POLICIES };
      this.domainLoadFindings = [];
      this.managed = false;
      logger.debug('No managed policies found', { source: 'ManagedPoliciesManager' });
    }
  }

  private tryLoadFrom(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<ManagedPoliciesConfig>;
      const domains = domainPolicyFromManagedFile(parsed);

      this.domainLoadFindings = domains.findings;
      this.policies = {
        allowManagedPermissionRulesOnly: parsed.allowManagedPermissionRulesOnly ?? false,
        allowManagedHooksOnly: parsed.allowManagedHooksOnly ?? false,
        disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
        disallowedCommands: Array.isArray(parsed.disallowedCommands) ? parsed.disallowedCommands : [],
        maxSessionCost: typeof parsed.maxSessionCost === 'number' ? parsed.maxSessionCost : undefined,
        allowedModels: Array.isArray(parsed.allowedModels) ? parsed.allowedModels : undefined,
        ...(domains.policy ? { domains: domains.policy } : {}),
      };

      this.managed = true;
      logger.info(`Loaded managed policies from ${filePath}`, { source: 'ManagedPoliciesManager' });
      return true;
    } catch (error) {
      logger.warn(`Failed to load managed policies from ${filePath}: ${error}`, { source: 'ManagedPoliciesManager' });
      return false;
    }
  }

  /**
   * Check if a tool is allowed by managed policies
   */
  isToolAllowed(toolName: string): boolean {
    return !this.policies.disallowedTools.includes(toolName);
  }

  /**
   * Check if a command is allowed by managed policies.
   * Checks if any disallowed command pattern appears in the command string.
   */
  isCommandAllowed(command: string): boolean {
    const denies = [
      ...this.policies.disallowedCommands,
      ...(this.policies.domains?.exec?.deny_commands ?? []),
    ];
    // allow_commands n'est pas consulté : une liste d'autorisation de politique
    // ne peut pas rendre licite une commande refusée.
    return !commandMatchesDeny(command, denies);
  }

  /**
   * Posture calculée. Les clauses plus ouvertes restent dans les constats.
   * Ce résultat n'est pas lu par les exécuteurs.
   */
  assessDomain(posture: DomainPosture): DomainAssessment {
    const applied = applyDomainPolicy(posture, this.policies.domains ?? null);
    return {
      effective: applied.effective,
      findings: [...this.domainLoadFindings, ...applied.findings],
    };
  }

  /**
   * Get the current policies
   */
  getPolicies(): ManagedPoliciesConfig {
    return {
      ...this.policies,
      ...(this.policies.domains ? { domains: { ...this.policies.domains } } : {}),
    };
  }

  /**
   * Check if managed policies are active (file exists and was loaded)
   */
  isManaged(): boolean {
    return this.managed;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ManagedPoliciesManager | null = null;

export function getManagedPoliciesManager(systemPath?: string, userPath?: string): ManagedPoliciesManager {
  if (!instance || systemPath || userPath) {
    instance = new ManagedPoliciesManager(systemPath, userPath);
  }
  return instance;
}

export function resetManagedPolicies(): void {
  instance = null;
}
