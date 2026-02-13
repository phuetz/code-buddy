/**
 * Enterprise Admin Configuration
 *
 * Loads admin-level configuration from system paths:
 * - /etc/codebuddy/requirements.toml  (enforced, cannot be overridden by users)
 * - /etc/codebuddy/managed_config.toml (defaults, user can override)
 *
 * Gracefully handles missing files for non-enterprise deployments.
 */

import * as fs from 'fs';
import * as path from 'path';
import TOML from '@iarna/toml';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Enforced requirements that cannot be overridden by users
 */
export interface AdminRequirements {
  maxCostLimit?: number;
  allowedModels?: string[];
  disabledTools?: string[];
  networkAccess?: boolean;
  sandboxMode?: string;
}

/**
 * Managed defaults that users can override
 */
export interface AdminManagedDefaults {
  model?: string;
  securityMode?: string;
  maxToolRounds?: number;
}

/**
 * Combined admin configuration
 */
export interface AdminConfig {
  /** Cannot be overridden by users */
  requirements: AdminRequirements;
  /** Can be overridden by users */
  managedDefaults: AdminManagedDefaults;
}

// ============================================================================
// Constants
// ============================================================================

const ADMIN_CONFIG_DIR = '/etc/codebuddy';
const REQUIREMENTS_FILE = 'requirements.toml';
const MANAGED_CONFIG_FILE = 'managed_config.toml';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Parse a TOML file safely, returning null on any error
 */
function parseTOMLFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return TOML.parse(content) as Record<string, unknown>;
  } catch (error) {
    logger.warn(`Failed to parse admin config: ${filePath}`, { error: String(error) });
    return null;
  }
}

/**
 * Extract requirements from parsed TOML data
 */
function extractRequirements(data: Record<string, unknown>): AdminRequirements {
  const req: AdminRequirements = {};
  const section = (data['requirements'] ?? data) as Record<string, unknown>;

  if (typeof section['max_cost_limit'] === 'number') {
    req.maxCostLimit = section['max_cost_limit'];
  }
  if (Array.isArray(section['allowed_models'])) {
    req.allowedModels = section['allowed_models'].filter(
      (m): m is string => typeof m === 'string'
    );
  }
  if (Array.isArray(section['disabled_tools'])) {
    req.disabledTools = section['disabled_tools'].filter(
      (t): t is string => typeof t === 'string'
    );
  }
  if (typeof section['network_access'] === 'boolean') {
    req.networkAccess = section['network_access'];
  }
  if (typeof section['sandbox_mode'] === 'string') {
    req.sandboxMode = section['sandbox_mode'];
  }

  return req;
}

/**
 * Extract managed defaults from parsed TOML data
 */
function extractManagedDefaults(data: Record<string, unknown>): AdminManagedDefaults {
  const defaults: AdminManagedDefaults = {};
  const section = (data['defaults'] ?? data) as Record<string, unknown>;

  if (typeof section['model'] === 'string') {
    defaults.model = section['model'];
  }
  if (typeof section['security_mode'] === 'string') {
    defaults.securityMode = section['security_mode'];
  }
  if (typeof section['max_tool_rounds'] === 'number') {
    defaults.maxToolRounds = section['max_tool_rounds'];
  }

  return defaults;
}

/**
 * Load admin configuration from /etc/codebuddy/.
 *
 * Returns an AdminConfig with empty objects if no admin config files exist.
 * This is the expected case for non-enterprise deployments.
 */
export function loadAdminConfig(configDir?: string): AdminConfig {
  const dir = configDir ?? ADMIN_CONFIG_DIR;
  const requirementsPath = path.join(dir, REQUIREMENTS_FILE);
  const managedConfigPath = path.join(dir, MANAGED_CONFIG_FILE);

  const requirementsData = parseTOMLFile(requirementsPath);
  const managedData = parseTOMLFile(managedConfigPath);

  return {
    requirements: requirementsData ? extractRequirements(requirementsData) : {},
    managedDefaults: managedData ? extractManagedDefaults(managedData) : {},
  };
}

/**
 * Apply admin requirements to a user configuration.
 *
 * - Requirements override user values unconditionally
 * - Managed defaults fill in missing values only
 *
 * @param userConfig - The user's configuration object
 * @param adminConfig - Optional pre-loaded admin config (loads from disk if omitted)
 * @returns A new config object with admin policies applied
 */
export function applyAdminRequirements(
  userConfig: Record<string, unknown>,
  adminConfig?: AdminConfig
): Record<string, unknown> {
  const config = adminConfig ?? loadAdminConfig();
  const result = { ...userConfig };

  // Enforced requirements always override user values
  const req = config.requirements;
  if (req.maxCostLimit !== undefined) {
    result['maxCost'] = req.maxCostLimit;
  }
  if (req.allowedModels !== undefined) {
    result['allowedModels'] = req.allowedModels;
    // If user's chosen model is not in allowed list, clear it
    if (
      typeof result['model'] === 'string' &&
      !req.allowedModels.includes(result['model'])
    ) {
      result['model'] = req.allowedModels[0] ?? undefined;
    }
  }
  if (req.disabledTools !== undefined) {
    result['disabledTools'] = req.disabledTools;
  }
  if (req.networkAccess !== undefined) {
    result['networkAccess'] = req.networkAccess;
  }
  if (req.sandboxMode !== undefined) {
    result['sandboxMode'] = req.sandboxMode;
  }

  // Managed defaults only apply if user has not set a value
  const defaults = config.managedDefaults;
  if (defaults.model !== undefined && result['model'] === undefined) {
    result['model'] = defaults.model;
  }
  if (defaults.securityMode !== undefined && result['securityMode'] === undefined) {
    result['securityMode'] = defaults.securityMode;
  }
  if (defaults.maxToolRounds !== undefined && result['maxToolRounds'] === undefined) {
    result['maxToolRounds'] = defaults.maxToolRounds;
  }

  return result;
}
