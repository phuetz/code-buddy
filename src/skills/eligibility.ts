/**
 * Skill Eligibility Module
 *
 * Checks if skills are eligible to run based on system requirements
 * such as available binaries, environment variables, and configuration.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill requirements specification
 */
export interface SkillRequirements {
  /** Required binaries (all must be present) */
  bins?: string[];
  /** Any of these binaries must be present */
  anyBins?: string[];
  /** Required environment variables */
  env?: string[];
  /** Required configuration files */
  configs?: string[];
  /** Required platform (linux, darwin, win32) */
  platform?: string | string[];
  /** Minimum Node.js version */
  nodeVersion?: string;
}

/**
 * Result of an eligibility check
 */
export interface EligibilityResult {
  /** Whether the skill is eligible */
  eligible: boolean;
  /** Reasons for ineligibility (empty if eligible) */
  reasons: string[];
  /** Missing binaries */
  missingBins?: string[];
  /** Missing environment variables */
  missingEnv?: string[];
  /** Missing configuration files */
  missingConfigs?: string[];
}

/**
 * Binary check cache entry
 */
interface BinaryCheckCache {
  exists: boolean;
  path?: string;
  checkedAt: number;
}

// ============================================================================
// Binary Checker
// ============================================================================

/**
 * Cache for binary checks
 */
const binaryCache = new Map<string, BinaryCheckCache>();

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Check if a binary is available in PATH
 */
export function isBinaryAvailable(name: string): boolean {
  // Check cache first
  const cached = binaryCache.get(name);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL) {
    return cached.exists;
  }

  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${command} ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const binaryPath = result.trim().split('\n')[0];
    binaryCache.set(name, {
      exists: true,
      path: binaryPath,
      checkedAt: Date.now(),
    });

    return true;
  } catch {
    binaryCache.set(name, {
      exists: false,
      checkedAt: Date.now(),
    });
    return false;
  }
}

/**
 * Get the path of a binary
 */
export function getBinaryPath(name: string): string | undefined {
  const cached = binaryCache.get(name);
  if (cached?.exists) {
    return cached.path;
  }

  // Force a check
  isBinaryAvailable(name);
  return binaryCache.get(name)?.path;
}

/**
 * Check multiple binaries at once
 */
export function checkBinaries(names: string[]): Map<string, boolean> {
  const results = new Map<string, boolean>();
  for (const name of names) {
    results.set(name, isBinaryAvailable(name));
  }
  return results;
}

/**
 * Clear the binary cache
 */
export function clearBinaryCache(): void {
  binaryCache.clear();
}

// ============================================================================
// Environment Checker
// ============================================================================

/**
 * Check if an environment variable is set
 */
export function isEnvSet(name: string): boolean {
  return process.env[name] !== undefined && process.env[name] !== '';
}

/**
 * Check multiple environment variables
 */
export function checkEnvVars(names: string[]): Map<string, boolean> {
  const results = new Map<string, boolean>();
  for (const name of names) {
    results.set(name, isEnvSet(name));
  }
  return results;
}

// ============================================================================
// Config Checker
// ============================================================================

/**
 * Check if a configuration file exists
 */
export function isConfigPresent(configPath: string): boolean {
  // Expand ~ to home directory
  const expandedPath = configPath.replace(/^~/, process.env.HOME || '');
  return fs.existsSync(expandedPath);
}

/**
 * Check multiple configuration files
 */
export function checkConfigs(paths: string[]): Map<string, boolean> {
  const results = new Map<string, boolean>();
  for (const configPath of paths) {
    results.set(configPath, isConfigPresent(configPath));
  }
  return results;
}

// ============================================================================
// Platform Checker
// ============================================================================

/**
 * Check if current platform matches requirements
 */
export function isPlatformSupported(required: string | string[]): boolean {
  const platforms = Array.isArray(required) ? required : [required];
  return platforms.includes(process.platform);
}

/**
 * Get current platform
 */
export function getCurrentPlatform(): string {
  return process.platform;
}

// ============================================================================
// Version Checker
// ============================================================================

/**
 * Parse a semver version string
 */
function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Compare two versions
 */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Check if current Node.js version meets minimum requirement
 */
export function isNodeVersionSufficient(minVersion: string): boolean {
  return compareVersions(process.version, minVersion) >= 0;
}

// ============================================================================
// Eligibility Checker
// ============================================================================

/**
 * Check skill eligibility based on requirements
 */
export function checkEligibility(requirements: SkillRequirements): EligibilityResult {
  const result: EligibilityResult = {
    eligible: true,
    reasons: [],
  };

  // Check required binaries (all must be present)
  if (requirements.bins && requirements.bins.length > 0) {
    const binResults = checkBinaries(requirements.bins);
    const missing = requirements.bins.filter(bin => !binResults.get(bin));

    if (missing.length > 0) {
      result.eligible = false;
      result.missingBins = missing;
      result.reasons.push(`Missing required binaries: ${missing.join(', ')}`);
    }
  }

  // Check anyBins (at least one must be present)
  if (requirements.anyBins && requirements.anyBins.length > 0) {
    const binResults = checkBinaries(requirements.anyBins);
    const anyPresent = requirements.anyBins.some(bin => binResults.get(bin));

    if (!anyPresent) {
      result.eligible = false;
      result.reasons.push(`None of the required binaries found: ${requirements.anyBins.join(', ')}`);
    }
  }

  // Check environment variables
  if (requirements.env && requirements.env.length > 0) {
    const envResults = checkEnvVars(requirements.env);
    const missing = requirements.env.filter(env => !envResults.get(env));

    if (missing.length > 0) {
      result.eligible = false;
      result.missingEnv = missing;
      result.reasons.push(`Missing environment variables: ${missing.join(', ')}`);
    }
  }

  // Check configuration files
  if (requirements.configs && requirements.configs.length > 0) {
    const configResults = checkConfigs(requirements.configs);
    const missing = requirements.configs.filter(cfg => !configResults.get(cfg));

    if (missing.length > 0) {
      result.eligible = false;
      result.missingConfigs = missing;
      result.reasons.push(`Missing configuration files: ${missing.join(', ')}`);
    }
  }

  // Check platform
  if (requirements.platform) {
    if (!isPlatformSupported(requirements.platform)) {
      result.eligible = false;
      const required = Array.isArray(requirements.platform)
        ? requirements.platform.join(', ')
        : requirements.platform;
      result.reasons.push(`Unsupported platform: ${process.platform} (requires: ${required})`);
    }
  }

  // Check Node.js version
  if (requirements.nodeVersion) {
    if (!isNodeVersionSufficient(requirements.nodeVersion)) {
      result.eligible = false;
      result.reasons.push(
        `Node.js version too low: ${process.version} (requires: >= ${requirements.nodeVersion})`
      );
    }
  }

  return result;
}

/**
 * Log eligibility check result
 */
export function logEligibilityResult(
  skillName: string,
  result: EligibilityResult
): void {
  if (result.eligible) {
    logger.debug(`Skill "${skillName}" is eligible`);
  } else {
    logger.debug(`Skill "${skillName}" is not eligible`, {
      reasons: result.reasons,
    });
  }
}

// ============================================================================
// Requirement Parser
// ============================================================================

/**
 * Parse requirements from skill frontmatter
 */
export function parseRequirements(
  frontmatterValue: string
): SkillRequirements | null {
  try {
    // Handle JSON format: {"bins": ["git"], "env": ["HOME"]}
    if (frontmatterValue.startsWith('{')) {
      return JSON.parse(frontmatterValue) as SkillRequirements;
    }

    // Handle simplified format: bins=git,docker env=HOME
    const requirements: SkillRequirements = {};
    const pairs = frontmatterValue.split(/\s+/);

    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (!key || !value) continue;

      const values = value.split(',').map(v => v.trim());

      switch (key.toLowerCase()) {
        case 'bins':
          requirements.bins = values;
          break;
        case 'anybins':
          requirements.anyBins = values;
          break;
        case 'env':
          requirements.env = values;
          break;
        case 'configs':
          requirements.configs = values;
          break;
        case 'platform':
          requirements.platform = values.length === 1 ? values[0] : values;
          break;
        case 'nodeversion':
          requirements.nodeVersion = values[0];
          break;
      }
    }

    return Object.keys(requirements).length > 0 ? requirements : null;
  } catch (error) {
    logger.warn('Failed to parse skill requirements', {
      value: frontmatterValue,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
