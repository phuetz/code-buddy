/**
 * .grokrules File Support
 *
 * Project-specific AI behavior configuration:
 * - Custom instructions per project
 * - Code style preferences
 * - Framework-specific guidelines
 * - Ignore patterns
 * - Security policies
 *
 * Inspired by Cursor's .cursorrules feature.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

// ============================================================================
// Types
// ============================================================================

export interface GrokRules {
  /** Version of the rules format */
  version?: string;

  /** Project description */
  description?: string;

  /** Languages used in project */
  languages?: string[];

  /** Frameworks and libraries */
  frameworks?: string[];

  /** Custom instructions for the AI */
  instructions?: string[];

  /** Code style preferences */
  style?: {
    /** Indentation (spaces/tabs) */
    indentation?: 'spaces' | 'tabs';
    /** Indent size */
    indentSize?: number;
    /** Max line length */
    maxLineLength?: number;
    /** Quote style */
    quotes?: 'single' | 'double';
    /** Semicolons */
    semicolons?: boolean;
    /** Trailing commas */
    trailingCommas?: 'none' | 'es5' | 'all';
    /** Import order */
    importOrder?: string[];
  };

  /** Naming conventions */
  naming?: {
    /** Variables */
    variables?: 'camelCase' | 'snake_case' | 'PascalCase';
    /** Functions */
    functions?: 'camelCase' | 'snake_case' | 'PascalCase';
    /** Classes */
    classes?: 'PascalCase' | 'camelCase';
    /** Files */
    files?: 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case';
    /** Constants */
    constants?: 'UPPER_SNAKE_CASE' | 'camelCase';
  };

  /** Patterns to always include in context */
  include?: string[];

  /** Patterns to exclude from context */
  exclude?: string[];

  /** File patterns to ignore completely */
  ignore?: string[];

  /** Security policies */
  security?: {
    /** Allowed shell commands */
    allowedCommands?: string[];
    /** Blocked shell commands */
    blockedCommands?: string[];
    /** Require confirmation for destructive ops */
    confirmDestructive?: boolean;
    /** Allowed file extensions for write */
    allowedExtensions?: string[];
    /** Blocked paths */
    blockedPaths?: string[];
  };

  /** Testing preferences */
  testing?: {
    /** Test framework */
    framework?: string;
    /** Test file pattern */
    pattern?: string;
    /** Coverage threshold */
    coverageThreshold?: number;
    /** Test directory */
    directory?: string;
  };

  /** Documentation preferences */
  documentation?: {
    /** Doc style (JSDoc, docstring, etc) */
    style?: string;
    /** Require docs for public APIs */
    requirePublic?: boolean;
    /** Include examples */
    includeExamples?: boolean;
  };

  /** Git preferences */
  git?: {
    /** Commit message format */
    commitFormat?: string;
    /** Branch naming convention */
    branchFormat?: string;
    /** Require conventional commits */
    conventionalCommits?: boolean;
  };

  /** Context window management */
  context?: {
    /** Max files to include */
    maxFiles?: number;
    /** Max tokens for context */
    maxTokens?: number;
    /** Priority files (always include) */
    priorityFiles?: string[];
  };

  /** Custom prompts */
  prompts?: Record<string, string>;

  /** Persona/character for AI */
  persona?: {
    name?: string;
    tone?: 'formal' | 'casual' | 'technical' | 'friendly';
    expertise?: string[];
  };

  /** Raw additional instructions (appended to system prompt) */
  raw?: string;
}

export interface GrokRulesConfig {
  /** Search paths for rules files */
  searchPaths: string[];
  /** File names to search for */
  fileNames: string[];
  /** Enable inheritance from parent directories */
  inheritFromParent: boolean;
  /** Enable global rules from home directory */
  enableGlobalRules: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: GrokRulesConfig = {
  searchPaths: ['.', '.grok', '.config'],
  fileNames: ['.grokrules', '.grokrules.yaml', '.grokrules.yml', '.grokrules.json', 'grokrules.md'],
  inheritFromParent: true,
  enableGlobalRules: true,
};

const DEFAULT_RULES: GrokRules = {
  version: '1.0',
  style: {
    indentation: 'spaces',
    indentSize: 2,
    quotes: 'single',
    semicolons: true,
  },
  naming: {
    variables: 'camelCase',
    functions: 'camelCase',
    classes: 'PascalCase',
    files: 'kebab-case',
    constants: 'UPPER_SNAKE_CASE',
  },
  security: {
    confirmDestructive: true,
    blockedCommands: ['rm -rf /', 'dd if=/dev/zero'],
    blockedPaths: ['/etc', '/usr', '/bin', '/sbin'],
  },
  git: {
    conventionalCommits: true,
    commitFormat: '<type>(<scope>): <description>',
  },
};

// ============================================================================
// GrokRules Manager
// ============================================================================

export class GrokRulesManager extends EventEmitter {
  private config: GrokRulesConfig;
  private rules: GrokRules = {};
  private loadedFiles: string[] = [];
  private initialized = false;

  constructor(config: Partial<GrokRulesConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize and load rules for a directory
   */
  async initialize(workingDir: string = process.cwd()): Promise<void> {
    this.rules = { ...DEFAULT_RULES };
    this.loadedFiles = [];

    // Load global rules first
    if (this.config.enableGlobalRules) {
      const globalRules = await this.loadGlobalRules();
      if (globalRules) {
        this.rules = this.mergeRules(this.rules, globalRules);
      }
    }

    // Load project rules (with inheritance)
    if (this.config.inheritFromParent) {
      const hierarchy = this.getDirectoryHierarchy(workingDir);
      for (const dir of hierarchy) {
        const dirRules = await this.loadRulesFromDirectory(dir);
        if (dirRules) {
          this.rules = this.mergeRules(this.rules, dirRules);
        }
      }
    } else {
      const dirRules = await this.loadRulesFromDirectory(workingDir);
      if (dirRules) {
        this.rules = this.mergeRules(this.rules, dirRules);
      }
    }

    this.initialized = true;
    this.emit('initialized', { rules: this.rules, files: this.loadedFiles });
  }

  /**
   * Get current rules
   */
  getRules(): GrokRules {
    return { ...this.rules };
  }

  /**
   * Get loaded files
   */
  getLoadedFiles(): string[] {
    return [...this.loadedFiles];
  }

  /**
   * Check if rules are loaded
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Generate system prompt additions from rules
   */
  getSystemPromptAdditions(): string {
    const sections: string[] = [];

    // Description
    if (this.rules.description) {
      sections.push(`Project: ${this.rules.description}`);
    }

    // Languages and frameworks
    if (this.rules.languages?.length) {
      sections.push(`Languages: ${this.rules.languages.join(', ')}`);
    }
    if (this.rules.frameworks?.length) {
      sections.push(`Frameworks: ${this.rules.frameworks.join(', ')}`);
    }

    // Custom instructions
    if (this.rules.instructions?.length) {
      sections.push('');
      sections.push('Project Guidelines:');
      for (const instruction of this.rules.instructions) {
        sections.push(`- ${instruction}`);
      }
    }

    // Code style
    if (this.rules.style) {
      sections.push('');
      sections.push('Code Style:');
      if (this.rules.style.indentation) {
        sections.push(`- Use ${this.rules.style.indentation} for indentation (${this.rules.style.indentSize || 2} spaces)`);
      }
      if (this.rules.style.quotes) {
        sections.push(`- Use ${this.rules.style.quotes} quotes`);
      }
      if (this.rules.style.semicolons !== undefined) {
        sections.push(`- ${this.rules.style.semicolons ? 'Use' : 'Omit'} semicolons`);
      }
      if (this.rules.style.maxLineLength) {
        sections.push(`- Max line length: ${this.rules.style.maxLineLength} characters`);
      }
    }

    // Naming conventions
    if (this.rules.naming) {
      sections.push('');
      sections.push('Naming Conventions:');
      if (this.rules.naming.variables) {
        sections.push(`- Variables: ${this.rules.naming.variables}`);
      }
      if (this.rules.naming.functions) {
        sections.push(`- Functions: ${this.rules.naming.functions}`);
      }
      if (this.rules.naming.classes) {
        sections.push(`- Classes: ${this.rules.naming.classes}`);
      }
      if (this.rules.naming.files) {
        sections.push(`- Files: ${this.rules.naming.files}`);
      }
    }

    // Testing
    if (this.rules.testing) {
      sections.push('');
      sections.push('Testing:');
      if (this.rules.testing.framework) {
        sections.push(`- Framework: ${this.rules.testing.framework}`);
      }
      if (this.rules.testing.pattern) {
        sections.push(`- Test files: ${this.rules.testing.pattern}`);
      }
    }

    // Git
    if (this.rules.git?.conventionalCommits) {
      sections.push('');
      sections.push('Git:');
      sections.push('- Use conventional commits format');
      if (this.rules.git.commitFormat) {
        sections.push(`- Format: ${this.rules.git.commitFormat}`);
      }
    }

    // Persona
    if (this.rules.persona) {
      sections.push('');
      if (this.rules.persona.name) {
        sections.push(`Act as: ${this.rules.persona.name}`);
      }
      if (this.rules.persona.tone) {
        sections.push(`Tone: ${this.rules.persona.tone}`);
      }
      if (this.rules.persona.expertise?.length) {
        sections.push(`Expertise: ${this.rules.persona.expertise.join(', ')}`);
      }
    }

    // Raw instructions
    if (this.rules.raw) {
      sections.push('');
      sections.push(this.rules.raw);
    }

    return sections.join('\n');
  }

  /**
   * Get ignore patterns
   */
  getIgnorePatterns(): string[] {
    return [...(this.rules.ignore || []), ...(this.rules.exclude || [])];
  }

  /**
   * Get include patterns
   */
  getIncludePatterns(): string[] {
    return [...(this.rules.include || [])];
  }

  /**
   * Check if command is allowed
   */
  isCommandAllowed(command: string): boolean {
    if (!this.rules.security) return true;

    // Check blocked commands
    if (this.rules.security.blockedCommands) {
      for (const blocked of this.rules.security.blockedCommands) {
        if (command.includes(blocked)) {
          return false;
        }
      }
    }

    // Check allowed commands (if specified, only these are allowed)
    if (this.rules.security.allowedCommands?.length) {
      const cmd = command.split(/\s+/)[0];
      return this.rules.security.allowedCommands.includes(cmd);
    }

    return true;
  }

  /**
   * Check if path is allowed
   */
  isPathAllowed(filePath: string): boolean {
    if (!this.rules.security?.blockedPaths) return true;

    const resolved = path.resolve(filePath);
    for (const blocked of this.rules.security.blockedPaths) {
      if (resolved.startsWith(blocked)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get custom prompt by name
   */
  getCustomPrompt(name: string): string | undefined {
    return this.rules.prompts?.[name];
  }

  /**
   * Create default rules file
   */
  async createDefaultRules(targetDir: string): Promise<string> {
    const rulesPath = path.join(targetDir, '.grokrules');

    const defaultContent = `# Grok Rules
# Project-specific AI behavior configuration

# Project info
description: "My Project"
languages:
  - typescript
  - javascript
frameworks:
  - react
  - node

# Custom instructions for the AI
instructions:
  - "Follow the project's existing code style"
  - "Write tests for new functionality"
  - "Use meaningful variable names"

# Code style
style:
  indentation: spaces
  indentSize: 2
  quotes: single
  semicolons: true
  trailingCommas: es5

# Naming conventions
naming:
  variables: camelCase
  functions: camelCase
  classes: PascalCase
  files: kebab-case
  constants: UPPER_SNAKE_CASE

# Testing
testing:
  framework: jest
  pattern: "**/*.test.ts"
  directory: tests

# Git
git:
  conventionalCommits: true
  commitFormat: "<type>(<scope>): <description>"

# Context management
context:
  maxFiles: 20
  priorityFiles:
    - README.md
    - package.json
    - tsconfig.json

# Files to ignore
ignore:
  - node_modules/**
  - dist/**
  - coverage/**
  - "*.log"
`;

    fs.writeFileSync(rulesPath, defaultContent);
    this.emit('rules:created', { path: rulesPath });
    return rulesPath;
  }

  /**
   * Format rules summary
   */
  formatSummary(): string {
    const lines: string[] = [
      '📋 Grok Rules',
      '═'.repeat(40),
      '',
    ];

    if (this.loadedFiles.length === 0) {
      lines.push('No .grokrules file found.');
      lines.push('');
      lines.push('Create one with: /rules init');
    } else {
      lines.push('Loaded files:');
      for (const file of this.loadedFiles) {
        lines.push(`  • ${file}`);
      }
      lines.push('');

      if (this.rules.description) {
        lines.push(`Project: ${this.rules.description}`);
      }

      if (this.rules.languages?.length) {
        lines.push(`Languages: ${this.rules.languages.join(', ')}`);
      }

      if (this.rules.frameworks?.length) {
        lines.push(`Frameworks: ${this.rules.frameworks.join(', ')}`);
      }

      if (this.rules.instructions?.length) {
        lines.push('');
        lines.push(`Instructions: ${this.rules.instructions.length} custom rules`);
      }

      if (this.rules.ignore?.length) {
        lines.push(`Ignore patterns: ${this.rules.ignore.length}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async loadGlobalRules(): Promise<GrokRules | null> {
    const homeDir = os.homedir();
    const globalPaths = [
      path.join(homeDir, '.grokrules'),
      path.join(homeDir, '.config', 'grok', 'rules.yaml'),
      path.join(homeDir, '.grok', 'rules.yaml'),
    ];

    for (const globalPath of globalPaths) {
      const rules = await this.loadRulesFile(globalPath);
      if (rules) {
        return rules;
      }
    }

    return null;
  }

  private async loadRulesFromDirectory(dir: string): Promise<GrokRules | null> {
    for (const searchPath of this.config.searchPaths) {
      for (const fileName of this.config.fileNames) {
        const filePath = path.join(dir, searchPath, fileName);
        const rules = await this.loadRulesFile(filePath);
        if (rules) {
          return rules;
        }
      }
    }
    return null;
  }

  private async loadRulesFile(filePath: string): Promise<GrokRules | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      let rules: GrokRules;

      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.json') {
        rules = JSON.parse(content);
      } else if (ext === '.md') {
        // Parse markdown format (extract YAML frontmatter or code blocks)
        rules = this.parseMarkdownRules(content);
      } else {
        // YAML format (default)
        rules = yaml.load(content) as GrokRules;
      }

      this.loadedFiles.push(filePath);
      this.emit('rules:loaded', { path: filePath, rules });

      return rules;
    } catch (error) {
      this.emit('rules:error', { path: filePath, error });
      return null;
    }
  }

  private parseMarkdownRules(content: string): GrokRules {
    // Try YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      return yaml.load(frontmatterMatch[1]) as GrokRules;
    }

    // Try YAML code block
    const codeBlockMatch = content.match(/```ya?ml\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return yaml.load(codeBlockMatch[1]) as GrokRules;
    }

    // Treat entire content as raw instructions
    return {
      raw: content,
    };
  }

  private getDirectoryHierarchy(dir: string): string[] {
    const hierarchy: string[] = [];
    let current = path.resolve(dir);
    const root = path.parse(current).root;

    while (current !== root) {
      hierarchy.unshift(current);
      current = path.dirname(current);
    }

    return hierarchy;
  }

  private mergeRules(base: GrokRules, override: GrokRules): GrokRules {
    const merged: GrokRules = { ...base };

    // Simple properties
    if (override.version) merged.version = override.version;
    if (override.description) merged.description = override.description;
    if (override.raw) merged.raw = (base.raw || '') + '\n' + override.raw;

    // Arrays (concatenate)
    if (override.languages) merged.languages = [...(base.languages || []), ...override.languages];
    if (override.frameworks) merged.frameworks = [...(base.frameworks || []), ...override.frameworks];
    if (override.instructions) merged.instructions = [...(base.instructions || []), ...override.instructions];
    if (override.include) merged.include = [...(base.include || []), ...override.include];
    if (override.exclude) merged.exclude = [...(base.exclude || []), ...override.exclude];
    if (override.ignore) merged.ignore = [...(base.ignore || []), ...override.ignore];

    // Objects (deep merge)
    if (override.style) merged.style = { ...base.style, ...override.style };
    if (override.naming) merged.naming = { ...base.naming, ...override.naming };
    if (override.security) merged.security = { ...base.security, ...override.security };
    if (override.testing) merged.testing = { ...base.testing, ...override.testing };
    if (override.documentation) merged.documentation = { ...base.documentation, ...override.documentation };
    if (override.git) merged.git = { ...base.git, ...override.git };
    if (override.context) merged.context = { ...base.context, ...override.context };
    if (override.persona) merged.persona = { ...base.persona, ...override.persona };
    if (override.prompts) merged.prompts = { ...base.prompts, ...override.prompts };

    return merged;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: GrokRulesManager | null = null;

export function getGrokRulesManager(config?: Partial<GrokRulesConfig>): GrokRulesManager {
  if (!managerInstance) {
    managerInstance = new GrokRulesManager(config);
  }
  return managerInstance;
}

export async function initializeGrokRules(workingDir?: string): Promise<GrokRulesManager> {
  const manager = getGrokRulesManager();
  await manager.initialize(workingDir);
  return manager;
}

export function resetGrokRulesManager(): void {
  managerInstance = null;
}
