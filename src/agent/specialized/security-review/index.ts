/**
 * Security Review Module
 *
 * Exports all Security Review components from the modular structure.
 */

// Re-export types
export type {
  SecuritySeverity,
  SecurityFinding,
  SecurityScanResult,
  SecurityReviewConfig,
  SecurityPattern,
} from './types.js';

// Re-export configuration
export { DEFAULT_CONFIG } from './types.js';

// Re-export patterns
export {
  SECRET_PATTERNS,
  INJECTION_PATTERNS,
  XSS_PATTERNS,
  AUTH_PATTERNS,
  NETWORK_PATTERNS,
  ALL_PATTERNS,
} from './patterns.js';

// Re-export formatters
export {
  formatAsText,
  formatAsMarkdown,
  formatAsSarif,
  generateRecommendations,
} from './formatters.js';

// Re-export agent and singleton
export {
  SecurityReviewAgent,
  getSecurityReviewAgent,
  resetSecurityReviewAgent,
} from './agent.js';
