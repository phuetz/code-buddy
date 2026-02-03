/**
 * System Prompt Builder
 *
 * OpenClaw-inspired dynamic system prompt assembly.
 *
 * Dynamically merges:
 * - Base system instructions
 * - Available tools description
 * - Active skills
 * - Relevant memories
 * - Session context
 * - Operating mode constraints
 * - User preferences
 *
 * The builder produces context-aware system prompts that adapt to
 * the current session state, available capabilities, and user needs.
 *
 * Usage:
 * ```typescript
 * const builder = new SystemPromptBuilder();
 *
 * const prompt = builder
 *   .withBaseInstructions('You are Code Buddy...')
 *   .withTools(availableTools)
 *   .withSkills(activeSkills)
 *   .withMemory(relevantMemories)
 *   .withMode('code')
 *   .build();
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A section of the system prompt
 */
export interface PromptSection {
  /** Section identifier */
  id: string;
  /** Section title (rendered as heading) */
  title: string;
  /** Section content */
  content: string;
  /** Priority (higher = appears earlier) */
  priority: number;
  /** Whether this section is required */
  required: boolean;
  /** Maximum token budget for this section */
  maxTokens?: number;
  /** Condition for including this section */
  condition?: () => boolean;
}

/**
 * Tool information for prompt
 */
export interface ToolInfo {
  name: string;
  description: string;
  category?: string;
}

/**
 * Skill information for prompt
 */
export interface SkillInfo {
  name: string;
  description: string;
  triggers: string[];
}

/**
 * Memory entry for prompt
 */
export interface MemoryEntry {
  key: string;
  value: string;
  category: string;
  relevance?: number;
}

/**
 * Operating mode constraints
 */
export type OperatingMode = 'plan' | 'code' | 'ask' | 'architect';

/**
 * Build configuration
 */
export interface PromptBuildConfig {
  /** Maximum total tokens for system prompt */
  maxTokens: number;
  /** Include tool descriptions */
  includeTools: boolean;
  /** Include skill descriptions */
  includeSkills: boolean;
  /** Include memory context */
  includeMemory: boolean;
  /** Include datetime context */
  includeDatetime: boolean;
  /** Include OS/platform context */
  includePlatform: boolean;
  /** Compact mode (shorter descriptions) */
  compact: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_BUILD_CONFIG: PromptBuildConfig = {
  maxTokens: 4096,
  includeTools: true,
  includeSkills: true,
  includeMemory: true,
  includeDatetime: true,
  includePlatform: true,
  compact: false,
};

// ============================================================================
// System Prompt Builder
// ============================================================================

export class SystemPromptBuilder {
  private sections: Map<string, PromptSection> = new Map();
  private tools: ToolInfo[] = [];
  private skills: SkillInfo[] = [];
  private memories: MemoryEntry[] = [];
  private mode: OperatingMode = 'code';
  private buildConfig: PromptBuildConfig;
  private customInstructions: string[] = [];

  constructor(config: Partial<PromptBuildConfig> = {}) {
    this.buildConfig = { ...DEFAULT_BUILD_CONFIG, ...config };
  }

  // ==========================================================================
  // Fluent API
  // ==========================================================================

  /**
   * Set base instructions
   */
  withBaseInstructions(instructions: string): this {
    this.addSection({
      id: 'base',
      title: 'Instructions',
      content: instructions,
      priority: 100,
      required: true,
    });
    return this;
  }

  /**
   * Set available tools
   */
  withTools(tools: ToolInfo[]): this {
    this.tools = tools;
    return this;
  }

  /**
   * Set active skills
   */
  withSkills(skills: SkillInfo[]): this {
    this.skills = skills;
    return this;
  }

  /**
   * Set relevant memories
   */
  withMemory(memories: MemoryEntry[]): this {
    this.memories = memories;
    return this;
  }

  /**
   * Set operating mode
   */
  withMode(mode: OperatingMode): this {
    this.mode = mode;
    return this;
  }

  /**
   * Add custom instructions
   */
  withCustomInstructions(instructions: string): this {
    this.customInstructions.push(instructions);
    return this;
  }

  /**
   * Add a custom section
   */
  withSection(section: Omit<PromptSection, 'required'> & { required?: boolean }): this {
    this.addSection({ required: false, ...section });
    return this;
  }

  /**
   * Set project context (from CLAUDE.md or similar)
   */
  withProjectContext(context: string): this {
    if (context.trim()) {
      this.addSection({
        id: 'project-context',
        title: 'Project Context',
        content: context,
        priority: 90,
        required: false,
      });
    }
    return this;
  }

  /**
   * Set user preferences
   */
  withUserPreferences(preferences: Record<string, string>): this {
    const lines = Object.entries(preferences)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');

    if (lines) {
      this.addSection({
        id: 'user-preferences',
        title: 'User Preferences',
        content: lines,
        priority: 60,
        required: false,
      });
    }
    return this;
  }

  // ==========================================================================
  // Build
  // ==========================================================================

  /**
   * Build the complete system prompt
   */
  build(): string {
    const parts: string[] = [];

    // Add dynamic sections
    this.buildDynamicSections();

    // Sort sections by priority (descending)
    const sortedSections = Array.from(this.sections.values())
      .filter(s => !s.condition || s.condition())
      .sort((a, b) => b.priority - a.priority);

    // Build prompt within token budget
    let estimatedTokens = 0;

    for (const section of sortedSections) {
      const sectionTokens = this.estimateTokens(section.content);

      if (!section.required && estimatedTokens + sectionTokens > this.buildConfig.maxTokens) {
        continue; // Skip non-required sections if over budget
      }

      if (section.maxTokens && sectionTokens > section.maxTokens) {
        // Truncate section content
        const truncated = this.truncateToTokens(section.content, section.maxTokens);
        parts.push(this.formatSection(section.title, truncated));
        estimatedTokens += section.maxTokens;
      } else {
        parts.push(this.formatSection(section.title, section.content));
        estimatedTokens += sectionTokens;
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Build and return sections (for inspection)
   */
  buildSections(): PromptSection[] {
    this.buildDynamicSections();
    return Array.from(this.sections.values())
      .filter(s => !s.condition || s.condition())
      .sort((a, b) => b.priority - a.priority);
  }

  // ==========================================================================
  // Dynamic Section Building
  // ==========================================================================

  /**
   * Build all dynamic sections based on current state
   */
  private buildDynamicSections(): void {
    // Tools section
    if (this.buildConfig.includeTools && this.tools.length > 0) {
      this.addSection({
        id: 'tools',
        title: 'Available Tools',
        content: this.buildToolsSection(),
        priority: 80,
        required: false,
        maxTokens: 1000,
      });
    }

    // Skills section
    if (this.buildConfig.includeSkills && this.skills.length > 0) {
      this.addSection({
        id: 'skills',
        title: 'Available Skills',
        content: this.buildSkillsSection(),
        priority: 70,
        required: false,
        maxTokens: 500,
      });
    }

    // Memory section
    if (this.buildConfig.includeMemory && this.memories.length > 0) {
      this.addSection({
        id: 'memory',
        title: 'Relevant Context',
        content: this.buildMemorySection(),
        priority: 75,
        required: false,
        maxTokens: 800,
      });
    }

    // Mode constraints
    this.addSection({
      id: 'mode',
      title: 'Operating Mode',
      content: this.buildModeSection(),
      priority: 85,
      required: true,
    });

    // Datetime context
    if (this.buildConfig.includeDatetime) {
      this.addSection({
        id: 'datetime',
        title: 'Current Context',
        content: `Current date: ${new Date().toISOString().split('T')[0]}`,
        priority: 40,
        required: false,
      });
    }

    // Platform context
    if (this.buildConfig.includePlatform) {
      this.addSection({
        id: 'platform',
        title: 'Environment',
        content: `Platform: ${process.platform}, Node: ${process.version}`,
        priority: 30,
        required: false,
      });
    }

    // Custom instructions
    if (this.customInstructions.length > 0) {
      this.addSection({
        id: 'custom',
        title: 'Additional Instructions',
        content: this.customInstructions.join('\n\n'),
        priority: 50,
        required: false,
      });
    }
  }

  /**
   * Build tools description section
   */
  private buildToolsSection(): string {
    if (this.buildConfig.compact) {
      return this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    }

    // Group by category
    const groups: Record<string, ToolInfo[]> = {};
    for (const tool of this.tools) {
      const cat = tool.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(tool);
    }

    const lines: string[] = [];
    for (const [category, tools] of Object.entries(groups)) {
      lines.push(`### ${category}`);
      for (const tool of tools) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Build skills description section
   */
  private buildSkillsSection(): string {
    return this.skills.map(s => {
      const triggers = s.triggers.slice(0, 3).join(', ');
      return `- **${s.name}**: ${s.description} (triggers: ${triggers})`;
    }).join('\n');
  }

  /**
   * Build memory context section
   */
  private buildMemorySection(): string {
    // Sort by relevance
    const sorted = [...this.memories]
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

    return sorted.map(m =>
      `- [${m.category}] ${m.key}: ${m.value}`
    ).join('\n');
  }

  /**
   * Build operating mode constraints
   */
  private buildModeSection(): string {
    switch (this.mode) {
      case 'plan':
        return 'You are in PLAN mode. Focus on analyzing, planning, and breaking down tasks. Do not execute code or make changes. Provide detailed plans with clear steps.';
      case 'code':
        return 'You are in CODE mode. Execute tasks by writing and modifying code. Use available tools to accomplish goals efficiently.';
      case 'ask':
        return 'You are in ASK mode. Answer questions and provide information. Do not make changes to code or files unless explicitly asked.';
      case 'architect':
        return 'You are in ARCHITECT mode. Focus on system design, architecture decisions, and high-level patterns. Provide diagrams and design documents rather than implementation.';
      default:
        return 'You are in standard mode. Help the user with their request using available tools and knowledge.';
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Add or replace a section
   */
  private addSection(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  /**
   * Format a section with title
   */
  private formatSection(title: string, content: string): string {
    return `## ${title}\n\n${content}`;
  }

  /**
   * Estimate token count (rough: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate text to fit within token budget
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 3) + '...';
  }

  // ==========================================================================
  // Reset
  // ==========================================================================

  /**
   * Reset builder state
   */
  reset(): this {
    this.sections.clear();
    this.tools = [];
    this.skills = [];
    this.memories = [];
    this.mode = 'code';
    this.customInstructions = [];
    return this;
  }
}

export default SystemPromptBuilder;
