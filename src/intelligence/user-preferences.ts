/**
 * User Preferences Learning
 *
 * Learns and adapts to user preferences:
 * - Coding style detection
 * - Common patterns recognition
 * - Tool usage preferences
 * - Communication style adaptation
 */

import * as path from 'path';
import * as os from 'os';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export interface CodingStyle {
  /** Indentation: spaces or tabs */
  indentation: 'spaces' | 'tabs';
  /** Indentation size */
  indentSize: number;
  /** Quote style */
  quotes: 'single' | 'double';
  /** Semicolons */
  semicolons: boolean;
  /** Trailing commas */
  trailingCommas: 'none' | 'es5' | 'all';
  /** Line length preference */
  maxLineLength: number;
  /** Brace style */
  braceStyle: 'same-line' | 'next-line';
}

export interface ToolPreference {
  name: string;
  usageCount: number;
  successRate: number;
  avgResponseTime: number;
  preferredOptions?: Record<string, unknown>;
}

export interface CommunicationStyle {
  /** Verbosity level: concise, normal, detailed */
  verbosity: 'concise' | 'normal' | 'detailed';
  /** Include explanations */
  includeExplanations: boolean;
  /** Show code comments */
  showCodeComments: boolean;
  /** Preferred response format */
  responseFormat: 'markdown' | 'plain' | 'structured';
  /** Language preference */
  language: string;
}

export interface UserPreferences {
  codingStyle: CodingStyle;
  tools: ToolPreference[];
  communication: CommunicationStyle;
  patterns: LearnedPattern[];
  customRules: CustomRule[];
  lastUpdated: Date;
}

export interface LearnedPattern {
  id: string;
  type: 'naming' | 'structure' | 'import' | 'error-handling' | 'other';
  pattern: string;
  description: string;
  frequency: number;
  confidence: number;
  examples: string[];
}

export interface CustomRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  codingStyle: {
    indentation: 'spaces',
    indentSize: 2,
    quotes: 'single',
    semicolons: true,
    trailingCommas: 'es5',
    maxLineLength: 100,
    braceStyle: 'same-line',
  },
  tools: [],
  communication: {
    verbosity: 'normal',
    includeExplanations: true,
    showCodeComments: true,
    responseFormat: 'markdown',
    language: 'en',
  },
  patterns: [],
  customRules: [],
  lastUpdated: new Date(),
};

/**
 * User Preferences Manager
 */
export class PreferencesManager {
  private preferences: UserPreferences;
  private configPath: string;
  private learningEnabled: boolean = true;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.codebuddy', 'preferences.json');
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.loadPreferences();
  }

  /**
   * Get current preferences
   */
  getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  /**
   * Get coding style
   */
  getCodingStyle(): CodingStyle {
    return { ...this.preferences.codingStyle };
  }

  /**
   * Get communication style
   */
  getCommunicationStyle(): CommunicationStyle {
    return { ...this.preferences.communication };
  }

  /**
   * Update coding style preference
   */
  updateCodingStyle(updates: Partial<CodingStyle>): void {
    this.preferences.codingStyle = { ...this.preferences.codingStyle, ...updates };
    this.preferences.lastUpdated = new Date();
    this.savePreferences();
  }

  /**
   * Update communication style
   */
  updateCommunicationStyle(updates: Partial<CommunicationStyle>): void {
    this.preferences.communication = { ...this.preferences.communication, ...updates };
    this.preferences.lastUpdated = new Date();
    this.savePreferences();
  }

  /**
   * Learn from code sample
   */
  learnFromCode(code: string): void {
    if (!this.learningEnabled) return;

    // Detect indentation
    const indentMatch = code.match(/^(\s+)/m);
    const indent = indentMatch?.[1];
    if (indent !== undefined) {
      if (indent.includes('\t')) {
        this.preferences.codingStyle.indentation = 'tabs';
      } else {
        this.preferences.codingStyle.indentation = 'spaces';
        this.preferences.codingStyle.indentSize = indent.length;
      }
    }

    // Detect quote style
    const singleQuotes = (code.match(/'/g) || []).length;
    const doubleQuotes = (code.match(/"/g) || []).length;
    if (singleQuotes > doubleQuotes * 1.5) {
      this.preferences.codingStyle.quotes = 'single';
    } else if (doubleQuotes > singleQuotes * 1.5) {
      this.preferences.codingStyle.quotes = 'double';
    }

    // Detect semicolons
    const lines = code.split('\n').filter(l => l.trim());
    const withSemi = lines.filter(l => l.trim().endsWith(';')).length;
    this.preferences.codingStyle.semicolons = withSemi > lines.length * 0.5;

    // Detect brace style
    if (code.includes(') {\n') || code.includes('} else {')) {
      this.preferences.codingStyle.braceStyle = 'same-line';
    } else if (code.includes(')\n{') || code.includes('}\nelse')) {
      this.preferences.codingStyle.braceStyle = 'next-line';
    }

    // Detect patterns
    this.detectPatterns(code);

    this.preferences.lastUpdated = new Date();
    this.savePreferences();
  }

  /**
   * Record tool usage
   */
  recordToolUsage(
    toolName: string,
    success: boolean,
    responseTime: number,
    options?: Record<string, unknown>
  ): void {
    let tool = this.preferences.tools.find(t => t.name === toolName);

    if (!tool) {
      tool = {
        name: toolName,
        usageCount: 0,
        successRate: 0,
        avgResponseTime: 0,
      };
      this.preferences.tools.push(tool);
    }

    // Update statistics
    const oldCount = tool.usageCount;
    tool.usageCount++;

    // Update success rate (rolling average)
    tool.successRate = (tool.successRate * oldCount + (success ? 1 : 0)) / tool.usageCount;

    // Update response time (rolling average)
    tool.avgResponseTime = (tool.avgResponseTime * oldCount + responseTime) / tool.usageCount;

    // Track preferred options
    if (options && Object.keys(options).length > 0) {
      tool.preferredOptions = { ...tool.preferredOptions, ...options };
    }

    this.preferences.lastUpdated = new Date();
    this.savePreferences();
  }

  /**
   * Get preferred tool options
   */
  getToolPreferences(toolName: string): ToolPreference | undefined {
    return this.preferences.tools.find(t => t.name === toolName);
  }

  /**
   * Get most used tools
   */
  getMostUsedTools(limit: number = 10): ToolPreference[] {
    return [...this.preferences.tools]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * Add learned pattern
   */
  addPattern(pattern: Omit<LearnedPattern, 'id'>): void {
    const id = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.preferences.patterns.push({ ...pattern, id });
    this.preferences.lastUpdated = new Date();
    this.savePreferences();
  }

  /**
   * Get patterns by type
   */
  getPatterns(type?: LearnedPattern['type']): LearnedPattern[] {
    if (type) {
      return this.preferences.patterns.filter(p => p.type === type);
    }
    return [...this.preferences.patterns];
  }

  /**
   * Add custom rule
   */
  addCustomRule(rule: Omit<CustomRule, 'id'>): string {
    const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.preferences.customRules.push({ ...rule, id });
    this.preferences.lastUpdated = new Date();
    this.savePreferences();
    return id;
  }

  /**
   * Remove custom rule
   */
  removeCustomRule(id: string): boolean {
    const index = this.preferences.customRules.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.preferences.customRules.splice(index, 1);
    this.preferences.lastUpdated = new Date();
    this.savePreferences();
    return true;
  }

  /**
   * Get active custom rules
   */
  getActiveRules(): CustomRule[] {
    return this.preferences.customRules.filter(r => r.enabled);
  }

  /**
   * Enable/disable learning
   */
  setLearningEnabled(enabled: boolean): void {
    this.learningEnabled = enabled;
  }

  /**
   * Reset preferences to defaults
   */
  reset(): void {
    this.preferences = { ...DEFAULT_PREFERENCES, lastUpdated: new Date() };
    this.savePreferences();
  }

  /**
   * Export preferences
   */
  export(): string {
    return JSON.stringify(this.preferences, null, 2);
  }

  /**
   * Import preferences
   */
  import(json: string): boolean {
    try {
      const imported = JSON.parse(json) as Partial<UserPreferences>;
      this.preferences = {
        ...DEFAULT_PREFERENCES,
        ...imported,
        lastUpdated: new Date(),
      };
      this.savePreferences();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format preferences summary
   */
  formatSummary(): string {
    const { codingStyle, communication, tools, patterns } = this.preferences;

    const lines: string[] = [
      '',
      '═══════════════════════════════════════',
      '          USER PREFERENCES',
      '═══════════════════════════════════════',
      '',
      'Coding Style:',
      `  Indentation:     ${codingStyle.indentation} (${codingStyle.indentSize})`,
      `  Quotes:          ${codingStyle.quotes}`,
      `  Semicolons:      ${codingStyle.semicolons ? 'yes' : 'no'}`,
      `  Trailing Commas: ${codingStyle.trailingCommas}`,
      `  Max Line Length: ${codingStyle.maxLineLength}`,
      '',
      'Communication:',
      `  Verbosity:       ${communication.verbosity}`,
      `  Explanations:    ${communication.includeExplanations ? 'yes' : 'no'}`,
      `  Language:        ${communication.language}`,
      '',
    ];

    if (tools.length > 0) {
      lines.push('Top Tools:');
      const topTools = this.getMostUsedTools(5);
      for (const tool of topTools) {
        lines.push(`  ${tool.name}: ${tool.usageCount}x (${(tool.successRate * 100).toFixed(0)}% success)`);
      }
      lines.push('');
    }

    if (patterns.length > 0) {
      lines.push(`Learned Patterns: ${patterns.length}`);
      lines.push('');
    }

    lines.push(`Last Updated: ${this.preferences.lastUpdated.toLocaleString()}`);
    lines.push('═══════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Detect patterns in code
   */
  private detectPatterns(code: string): void {
    // Detect naming conventions
    const camelCase = (code.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || []).length;
    const snakeCase = (code.match(/\b[a-z]+_[a-z_]+\b/g) || []).length;

    if (camelCase > snakeCase * 2) {
      this.updateOrAddPattern('naming', 'camelCase', 'Uses camelCase naming', camelCase);
    } else if (snakeCase > camelCase * 2) {
      this.updateOrAddPattern('naming', 'snake_case', 'Uses snake_case naming', snakeCase);
    }

    // Detect import style
    const namedImports = (code.match(/import\s*\{[^}]+\}\s*from/g) || []).length;
    const defaultImports = (code.match(/import\s+\w+\s+from/g) || []).length;

    if (namedImports > defaultImports) {
      this.updateOrAddPattern('import', 'named-imports', 'Prefers named imports', namedImports);
    }

    // Detect error handling
    const tryCatch = (code.match(/try\s*\{/g) || []).length;
    const asyncAwait = (code.match(/async\s+/g) || []).length;

    if (tryCatch > 0) {
      this.updateOrAddPattern('error-handling', 'try-catch', 'Uses try-catch blocks', tryCatch);
    }
    if (asyncAwait > 0) {
      this.updateOrAddPattern('structure', 'async-await', 'Uses async/await', asyncAwait);
    }
  }

  /**
   * Update or add pattern
   */
  private updateOrAddPattern(
    type: LearnedPattern['type'],
    pattern: string,
    description: string,
    frequency: number
  ): void {
    const existing = this.preferences.patterns.find(
      p => p.type === type && p.pattern === pattern
    );

    if (existing) {
      existing.frequency += frequency;
      existing.confidence = Math.min(1, existing.confidence + 0.1);
    } else {
      this.addPattern({
        type,
        pattern,
        description,
        frequency,
        confidence: 0.5,
        examples: [],
      });
    }
  }

  /**
   * Load preferences from file
   */
  private loadPreferences(): void {
    try {
      const data = readJsonAtomicSync<Partial<UserPreferences>>(this.configPath, {});
      this.preferences = {
        ...DEFAULT_PREFERENCES,
        ...data,
        lastUpdated: new Date(data.lastUpdated || Date.now()),
      };
    } catch {
      // Use defaults
    }
  }

  /**
   * Save preferences to file
   */
  private savePreferences(): void {
    try {
      writeJsonAtomicSync(this.configPath, this.preferences);
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let preferencesManager: PreferencesManager | null = null;

/**
 * Get or create preferences manager
 */
export function getPreferencesManager(): PreferencesManager {
  if (!preferencesManager) {
    preferencesManager = new PreferencesManager();
  }
  return preferencesManager;
}

export default PreferencesManager;
