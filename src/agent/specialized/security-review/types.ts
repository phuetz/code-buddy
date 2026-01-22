/**
 * Security Review Types
 *
 * Type definitions for the Security Review agent.
 */

// ============================================================================
// Types
// ============================================================================

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityFinding {
  id: string;
  title: string;
  severity: SecuritySeverity;
  category: string;
  description: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  recommendation?: string;
  cwe?: string;
  owasp?: string;
  references?: string[];
}

export interface SecurityScanResult {
  success: boolean;
  error?: string;
  output?: string;
  data?: {
    findings: SecurityFinding[];
    summary: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
      total: number;
    };
    scanDuration: number;
    filesScanned: number;
  };
  summary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  findings?: SecurityFinding[];
  recommendations?: string[];
}

export interface SecurityReviewConfig {
  /** Maximum files to scan */
  maxFiles: number;
  /** File size limit in bytes */
  maxFileSize: number;
  /** Exclude patterns */
  excludePatterns: string[];
  /** Include patterns */
  includePatterns: string[];
  /** Enable experimental checks */
  experimental: boolean;
  /** Severity threshold for reporting */
  severityThreshold: SecuritySeverity;
}

export interface SecurityPattern {
  id: string;
  title: string;
  pattern: RegExp;
  severity: SecuritySeverity;
  category: string;
  description: string;
  recommendation: string;
  cwe?: string;
  owasp?: string;
  fileTypes?: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: SecurityReviewConfig = {
  maxFiles: 1000,
  maxFileSize: 1024 * 1024, // 1MB
  excludePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.bundle.js',
  ],
  includePatterns: [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.rb',
    '**/*.go',
    '**/*.java',
    '**/*.php',
    '**/*.sql',
    '**/*.html',
    '**/*.yml',
    '**/*.yaml',
    '**/*.json',
    '**/*.env*',
    '**/Dockerfile*',
  ],
  experimental: false,
  severityThreshold: 'info',
};
