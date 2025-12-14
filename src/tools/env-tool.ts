/**
 * Environment Tool
 *
 * Manage environment variables and .env files securely.
 * Supports reading, setting, and managing environment configurations.
 */

import fs from 'fs-extra';
import * as path from 'path';
import type { ToolResult } from './index.js';

// ============================================================================
// Types
// ============================================================================

interface EnvParams {
  action: 'get' | 'set' | 'list' | 'load' | 'save' | 'delete' | 'validate';
  key?: string;
  value?: string;
  file?: string;
  format?: 'json' | 'env' | 'shell';
}

// ============================================================================
// Environment Tool
// ============================================================================

export class EnvTool {
  name = 'env';
  description = 'Manage environment variables and .env files';
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' = 'medium';

  // Sensitive key patterns to redact in output
  private sensitivePatterns = [
    /password/i, /secret/i, /key/i, /token/i, /auth/i, /credential/i,
    /private/i, /apikey/i, /api_key/i, /access/i, /bearer/i,
  ];

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'list', 'load', 'save', 'delete', 'validate'],
        description: 'Action to perform',
      },
      key: {
        type: 'string',
        description: 'Environment variable name',
      },
      value: {
        type: 'string',
        description: 'Value to set',
      },
      file: {
        type: 'string',
        description: 'Path to .env file (default: .env)',
      },
      format: {
        type: 'string',
        enum: ['json', 'env', 'shell'],
        description: 'Output format (default: env)',
      },
    },
    required: ['action'],
  };

  /**
   * Execute environment operation
   */
  async execute(params: EnvParams): Promise<ToolResult> {
    try {
      switch (params.action) {
        case 'get':
          return this.getVar(params.key!);
        case 'set':
          return this.setVar(params.key!, params.value!);
        case 'list':
          return this.listVars(params.format);
        case 'load':
          return this.loadEnvFile(params.file || '.env');
        case 'save':
          return this.saveEnvFile(params.file || '.env');
        case 'delete':
          return this.deleteVar(params.key!);
        case 'validate':
          return this.validateEnv(params.file || '.env');
        default:
          return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get environment variable
   */
  private getVar(key: string): ToolResult {
    if (!key) {
      return { success: false, error: 'Key required' };
    }

    const value = process.env[key];
    if (value === undefined) {
      return { success: false, error: `Variable not found: ${key}` };
    }

    const redacted = this.shouldRedact(key) ? this.redact(value) : value;

    return {
      success: true,
      content: `${key}=${redacted}`,
      metadata: { key, exists: true },
    };
  }

  /**
   * Set environment variable
   */
  private setVar(key: string, value: string): ToolResult {
    if (!key) {
      return { success: false, error: 'Key required' };
    }

    // Validate key format
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      return { success: false, error: 'Invalid variable name format' };
    }

    process.env[key] = value;

    return {
      success: true,
      content: `Set ${key}=${this.shouldRedact(key) ? this.redact(value) : value}`,
    };
  }

  /**
   * List environment variables
   */
  private listVars(format?: 'json' | 'env' | 'shell'): ToolResult {
    const vars = Object.entries(process.env)
      .filter(([key]) => !key.startsWith('_') && !key.startsWith('npm_'))
      .sort(([a], [b]) => a.localeCompare(b));

    // Redact sensitive values
    const safeVars = vars.map(([key, value]) => ({
      key,
      value: this.shouldRedact(key) ? this.redact(value || '') : value,
    }));

    switch (format) {
      case 'json':
        const obj: Record<string, string> = {};
        for (const { key, value } of safeVars) {
          obj[key] = value || '';
        }
        return { success: true, content: JSON.stringify(obj, null, 2) };

      case 'shell':
        const shellLines = safeVars.map(({ key, value }) =>
          `export ${key}="${(value || '').replace(/"/g, '\\"')}"`
        );
        return { success: true, content: shellLines.join('\n') };

      case 'env':
      default:
        const envLines = safeVars.map(({ key, value }) => `${key}=${value}`);
        return {
          success: true,
          content: envLines.join('\n'),
          metadata: { count: vars.length },
        };
    }
  }

  /**
   * Load .env file
   */
  private async loadEnvFile(filePath: string): Promise<ToolResult> {
    const resolvedPath = path.resolve(filePath);

    if (!await fs.pathExists(resolvedPath)) {
      return { success: false, error: `File not found: ${resolvedPath}` };
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    let loaded = 0;
    for (const line of lines) {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Parse KEY=value format
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (match) {
        const [, key, value] = match;
        // Remove surrounding quotes
        const cleanValue = value.replace(/^["']|["']$/g, '');
        process.env[key] = cleanValue;
        loaded++;
      }
    }

    return {
      success: true,
      content: `Loaded ${loaded} environment variables from ${filePath}`,
      metadata: { loaded, file: resolvedPath },
    };
  }

  /**
   * Save current env to file
   */
  private async saveEnvFile(filePath: string): Promise<ToolResult> {
    const resolvedPath = path.resolve(filePath);

    const lines: string[] = [
      '# Environment variables',
      `# Generated: ${new Date().toISOString()}`,
      '',
    ];

    const vars = Object.entries(process.env)
      .filter(([key]) => !key.startsWith('_') && !key.startsWith('npm_'))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of vars) {
      if (value !== undefined) {
        // Quote values with spaces or special characters
        const needsQuotes = /[\s"'`$]/.test(value);
        const safeValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
        lines.push(`${key}=${safeValue}`);
      }
    }

    await fs.writeFile(resolvedPath, lines.join('\n'));

    return {
      success: true,
      content: `Saved ${vars.length} variables to ${filePath}`,
      metadata: { saved: vars.length, file: resolvedPath },
    };
  }

  /**
   * Delete environment variable
   */
  private deleteVar(key: string): ToolResult {
    if (!key) {
      return { success: false, error: 'Key required' };
    }

    if (process.env[key] === undefined) {
      return { success: false, error: `Variable not found: ${key}` };
    }

    delete process.env[key];

    return { success: true, content: `Deleted ${key}` };
  }

  /**
   * Validate .env file
   */
  private async validateEnv(filePath: string): Promise<ToolResult> {
    const resolvedPath = path.resolve(filePath);

    if (!await fs.pathExists(resolvedPath)) {
      return { success: false, error: `File not found: ${resolvedPath}` };
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    const issues: string[] = [];
    const variables: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      // Skip comments and empty lines
      if (!line || line.startsWith('#')) continue;

      // Check format
      const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!match) {
        issues.push(`Line ${lineNum}: Invalid format - "${line.slice(0, 30)}..."`);
        continue;
      }

      const [, key, value] = match;
      variables.push(key);

      // Check for common issues
      if (value.startsWith(' ') || value.endsWith(' ')) {
        issues.push(`Line ${lineNum}: ${key} has leading/trailing spaces`);
      }

      if (value.includes('$') && !value.startsWith('"')) {
        issues.push(`Line ${lineNum}: ${key} contains $ but isn't quoted (variable expansion won't work)`);
      }

      // Check for sensitive vars without values
      if (this.shouldRedact(key) && !value) {
        issues.push(`Line ${lineNum}: Sensitive variable ${key} is empty`);
      }
    }

    // Check for duplicates
    const seen = new Set<string>();
    for (const v of variables) {
      if (seen.has(v)) {
        issues.push(`Duplicate variable: ${v}`);
      }
      seen.add(v);
    }

    const parts = [
      `# Validation: ${filePath}`,
      '',
      `Variables: ${variables.length}`,
      `Issues: ${issues.length}`,
    ];

    if (issues.length > 0) {
      parts.push('', '## Issues', '');
      for (const issue of issues) {
        parts.push(`- ⚠️ ${issue}`);
      }
    } else {
      parts.push('', '✅ No issues found');
    }

    return {
      success: issues.length === 0,
      content: parts.join('\n'),
      metadata: { variables: variables.length, issues: issues.length },
    };
  }

  /**
   * Check if key contains sensitive data
   */
  private shouldRedact(key: string): boolean {
    return this.sensitivePatterns.some(pattern => pattern.test(key));
  }

  /**
   * Redact sensitive value
   */
  private redact(value: string): string {
    if (value.length <= 4) return '****';
    return value.slice(0, 2) + '****' + value.slice(-2);
  }
}

// Singleton
let envToolInstance: EnvTool | null = null;

export function getEnvTool(): EnvTool {
  if (!envToolInstance) {
    envToolInstance = new EnvTool();
  }
  return envToolInstance;
}
