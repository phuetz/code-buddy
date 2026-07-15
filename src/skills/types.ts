/**
 * Skills Types
 *
 * Enterprise-grade natural language skills system.
 * Skills are defined in SKILL.md format with YAML frontmatter.
 */

// ============================================================================
// Skill Definition Types
// ============================================================================

/**
 * Skill metadata from YAML frontmatter
 */
export interface SkillMetadata {
  /** Unique skill name/identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Skill version (semver) */
  version?: string;
  /** Author name */
  author?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Required capabilities */
  requires?: SkillRequirements;
  /** Skill configuration schema */
  config?: SkillConfigSchema;
  /** Native Engine-specific metadata */
  nativeEngine?: NativeEngineMetadata;
  /** CC11: If true, skill runs in a forked context (isolated sub-agent) */
  contextFork?: boolean;
  /** CC11: If true, skill content is returned directly without LLM invocation */
  disableModelInvocation?: boolean;
  /** Self-improvement: if true, curation won't overwrite/remove/consolidate this skill */
  pinned?: boolean;
  /** Provenance: this skill was imported from an external source. */
  imported?: boolean;
  /** Provenance: label of the source it was imported from (e.g. "hermes"). */
  source?: string;
  /** Signed exchange provenance marker. */
  exchange?: boolean;
  /** ISO timestamp recorded by the signed exchange installer. */
  installedAt?: string;
}

export interface SkillRequirements {
  /** Required tools */
  tools?: string[];
  /** Required capabilities */
  capabilities?: string[];
  /** Minimum Code Buddy version */
  minVersion?: string;
  /** Required environment variables */
  env?: string[];
}

export interface SkillConfigSchema {
  /** Config properties */
  properties?: Record<string, SkillConfigProperty>;
  /** Required properties */
  required?: string[];
}

export interface SkillConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface NativeEngineMetadata {
  /** Skill category */
  category?: string;
  /** Priority (higher = more likely to match) */
  priority?: number;
  /** Trigger patterns */
  triggers?: string[];
  /** Example invocations */
  examples?: string[];
}

// ============================================================================
// Skill Content Types
// ============================================================================

/**
 * Parsed skill content from markdown body
 */
export interface SkillContent {
  /** Main description/instructions */
  description: string;
  /** When to use this skill */
  usage?: string;
  /** Example requests that trigger this skill */
  examples?: SkillExample[];
  /** Implementation steps */
  steps?: SkillStep[];
  /** Tools to invoke */
  tools?: SkillToolInvocation[];
  /** Code blocks to execute */
  codeBlocks?: SkillCodeBlock[];
  /** Raw markdown content */
  rawMarkdown: string;
}

export interface SkillExample {
  /** User request pattern */
  request: string;
  /** Expected response/behavior */
  response?: string;
}

export interface SkillStep {
  /** Step number */
  index: number;
  /** Step description */
  description: string;
  /** Tool to use (if any) */
  tool?: string;
  /** Code to execute (if any) */
  code?: string;
  /** Condition for step */
  condition?: string;
}

export interface SkillToolInvocation {
  /** Tool name */
  name: string;
  /** Tool arguments template */
  args?: Record<string, unknown>;
  /** Description of what this tool call does */
  description?: string;
}

export interface SkillCodeBlock {
  /** Programming language */
  language: string;
  /** Code content */
  code: string;
  /** Block label/name */
  label?: string;
}

// ============================================================================
// Full Skill Type
// ============================================================================

/**
 * Complete skill definition
 */
export interface Skill {
  /** Skill metadata from frontmatter */
  metadata: SkillMetadata;
  /** Skill content from markdown body */
  content: SkillContent;
  /** Source file path */
  sourcePath: string;
  /** Source tier (workspace, managed, bundled) */
  tier: SkillTier;
  /** Load timestamp */
  loadedAt: Date;
  /** Whether skill is enabled */
  enabled: boolean;
}

/**
 * Skill loading tiers (priority order)
 */
export type SkillTier = 'workspace' | 'managed' | 'bundled';

// ============================================================================
// Skill Registry Types
// ============================================================================

export interface SkillRegistryConfig {
  /** Workspace skills path (highest priority) */
  workspacePath: string;
  /** Managed/user skills path */
  managedPath: string;
  /** Bundled skills path (lowest priority) */
  bundledPath: string;
  /** Enable lazy loading */
  lazyLoad: boolean;
  /** Cache parsed skills */
  cacheEnabled: boolean;
  /** Watch for file changes */
  watchEnabled: boolean;
  /** Vector search for skill matching */
  vectorSearchEnabled: boolean;
}

export const DEFAULT_SKILL_REGISTRY_CONFIG: SkillRegistryConfig = {
  workspacePath: '.codebuddy/skills',
  managedPath: '~/.codebuddy/skills',
  bundledPath: '', // Set at runtime
  lazyLoad: true,
  cacheEnabled: true,
  watchEnabled: true,
  vectorSearchEnabled: false,
};

// ============================================================================
// Skill Execution Types
// ============================================================================

export interface SkillExecutionContext {
  /** User's original request */
  request: string;
  /** Conversation history */
  history?: Array<{ role: string; content: string }>;
  /** Available tools */
  tools?: string[];
  /** Current working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** User configuration */
  config?: Record<string, unknown>;
}

export interface SkillExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Output/response */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Tool calls made */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  /** Execution duration in ms */
  duration: number;
}

// ============================================================================
// Skill Matching Types
// ============================================================================

export interface SkillMatch {
  /** Matched skill */
  skill: Skill;
  /** Match confidence (0-1) */
  confidence: number;
  /** Why this skill matched */
  reason: string;
  /** Matched trigger patterns */
  matchedTriggers?: string[];
  /** Matched tags */
  matchedTags?: string[];
}

export interface SkillSearchOptions {
  /** Query string */
  query: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by tier */
  tier?: SkillTier;
  /** Maximum results */
  limit?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Include disabled skills */
  includeDisabled?: boolean;
}

// ============================================================================
// Unified Skill Types
// ============================================================================

/**
 * Source discriminator for unified skills.
 * - 'legacy': Skills from the legacy JSON-based skill system (SkillManager/SkillLoader)
 * - 'skillmd': Skills from the SKILL.md natural language system (SkillRegistry)
 * - 'bundled': Built-in/predefined skills shipped with the application
 */
export type UnifiedSkillSource = 'legacy' | 'skillmd' | 'bundled';

/**
 * Unified skill representation that encompasses both legacy JSON-based
 * skills and SKILL.md natural language skills.
 */
export interface UnifiedSkill {
  /** Unique skill name/identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Source system discriminator */
  source: UnifiedSkillSource;
  /** Whether the skill is currently enabled */
  enabled: boolean;

  // -- Metadata --
  /** Skill version (semver), if available */
  version?: string;
  /** Author name */
  author?: string;
  /** Tags for categorization and search */
  tags?: string[];
  /** Priority for matching (higher = more likely to match) */
  priority?: number;

  // -- Trigger & Matching --
  /** Trigger patterns that activate this skill */
  triggers?: string[];
  /** Example invocations */
  examples?: SkillExample[];

  // -- Execution --
  /** System prompt / instructions for this skill */
  systemPrompt?: string;
  /** Implementation steps */
  steps?: SkillStep[];
  /** Tool invocations defined by the skill */
  toolInvocations?: SkillToolInvocation[];
  /** Code blocks to execute */
  codeBlocks?: SkillCodeBlock[];
  /** Restricted tool set (empty = all tools available) */
  tools?: string[];
  /** Specific model for this skill */
  model?: string;

  // -- Loading Metadata --
  /** Source file path or 'builtin' */
  sourcePath?: string;
  /** Skill tier for SKILL.md skills */
  tier?: SkillTier;
  /** Load timestamp */
  loadedAt?: Date;

  // -- Requirements --
  /** Required capabilities (from SKILL.md system) */
  requires?: SkillRequirements;

  // -- Original References --
  /** Reference to original SKILL.md Skill if source is 'skillmd' */
  originalSkillMd?: Skill;
  /** Reference to original legacy Skill if source is 'legacy' */
  originalLegacy?: LegacySkillRef;
}

/**
 * Lightweight reference to a legacy skill's original data.
 * Avoids circular dependency by not importing the legacy Skill type directly.
 */
export interface LegacySkillRef {
  name: string;
  description: string;
  triggers: string[];
  systemPrompt: string;
  tools?: string[];
  model?: string;
  priority?: number;
  autoActivate?: boolean;
  scripts?: Array<{
    name: string;
    command: string;
    runOn: 'activate' | 'complete' | 'both';
    timeout?: number;
  }>;
}

// ============================================================================
// Events
// ============================================================================

export interface SkillEvents {
  /** Skill loaded */
  'skill:loaded': (skill: Skill) => void;
  /** Skill unloaded */
  'skill:unloaded': (skillName: string) => void;
  /** Skill executed */
  'skill:executed': (skill: Skill, result: SkillExecutionResult) => void;
  /** Skill matched */
  'skill:matched': (matches: SkillMatch[]) => void;
  /** Skill error */
  'skill:error': (skillName: string, error: Error) => void;
  /** Registry reloaded */
  'registry:reloaded': (count: number) => void;
}
