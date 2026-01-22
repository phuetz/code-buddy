/**
 * Security Review Agent
 *
 * Comprehensive security analysis agent for codebase auditing.
 * Inspired by Claude Code's /security-review command.
 *
 * Features:
 * - OWASP Top 10 vulnerability detection
 * - Secret/credential scanning
 * - Dependency vulnerability audits
 * - Injection vulnerability detection (SQL, XSS, Command)
 * - Authentication flow analysis
 * - File permission audits
 * - Network security analysis
 *
 * This module re-exports from the modular security-review/ directory for
 * backwards compatibility.
 */

// Re-export types
export type {
  SecuritySeverity,
  SecurityFinding,
  SecurityScanResult,
  SecurityReviewConfig,
  SecurityPattern,
} from './security-review/types.js';

// Re-export configuration
export { DEFAULT_CONFIG } from './security-review/types.js';

// Re-export patterns
export {
  SECRET_PATTERNS,
  INJECTION_PATTERNS,
  XSS_PATTERNS,
  AUTH_PATTERNS,
  NETWORK_PATTERNS,
  ALL_PATTERNS,
} from './security-review/patterns.js';

// Re-export formatters
export {
  formatAsText,
  formatAsMarkdown,
  formatAsSarif,
  generateRecommendations,
} from './security-review/formatters.js';

// Re-export agent and singleton
export {
  SecurityReviewAgent,
  getSecurityReviewAgent,
  resetSecurityReviewAgent,
} from './security-review/agent.js';
