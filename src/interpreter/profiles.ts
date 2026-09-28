/**
 * Interpreter Profiles
 *
 * Predefined profiles for different use cases:
 * - default: General purpose
 * - fast: Quick responses with auto-run
 * - vision: Screen control and vision
 * - safe: Maximum security
 * - local: Offline with LM Studio
 * - coding: Code generation focused
 */

import type { InterpreterProfile } from './types.js';
import { runtimeDefaultModel } from '../config/runtime-default-model.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';

// ============================================================================
// Default Profile
// ============================================================================

export const DEFAULT_PROFILE: InterpreterProfile = {
  id: 'default',
  name: 'Default',
  description: 'General purpose assistant',
  provider: detectProviderFromEnv()?.provider || 'auto',
  model: runtimeDefaultModel(),
  autoRun: false,
  safeMode: 'ask',
  maxBudget: 5.00,
  temperature: 0.7,
  maxTokens: 4096,
  capabilities: {
    vision: true,
    codeExecution: true,
    fileOperations: true,
    webSearch: true,
    browserAutomation: false,
    shellCommands: true,
  },
};

// ============================================================================
// Fast Profile
// ============================================================================

export const FAST_PROFILE: InterpreterProfile = {
  id: 'fast',
  name: 'Fast',
  description: 'Quick responses with auto-execution',
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  autoRun: true,
  safeMode: 'off',
  maxBudget: 1.00,
  temperature: 0.3,
  maxTokens: 2048,
  capabilities: {
    vision: false,
    codeExecution: true,
    fileOperations: true,
    webSearch: true,
    browserAutomation: false,
    shellCommands: true,
  },
  toolRestrictions: {
    deniedCommands: ['rm -rf', 'dd', 'mkfs', 'format'],
  },
};

// ============================================================================
// Vision Profile
// ============================================================================

export const VISION_PROFILE: InterpreterProfile = {
  id: 'vision',
  name: 'Vision',
  description: 'Screen control and visual understanding',
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  autoRun: false,
  safeMode: 'ask',
  maxBudget: 5.00,
  temperature: 0.5,
  maxTokens: 4096,
  capabilities: {
    vision: true,
    codeExecution: true,
    fileOperations: true,
    webSearch: true,
    browserAutomation: true,
    shellCommands: true,
  },
  customInstructions: `You have access to the computer screen and can:
- Take screenshots to understand the current state
- Click on UI elements
- Type text
- Use keyboard shortcuts
- Scroll and navigate

When controlling the screen:
1. First take a screenshot to understand the current state
2. Identify the target element visually
3. Use precise coordinates for clicks
4. Verify actions by taking follow-up screenshots`,
};

// ============================================================================
// Safe Profile
// ============================================================================

export const SAFE_PROFILE: InterpreterProfile = {
  id: 'safe',
  name: 'Safe',
  description: 'Maximum security with approval for all actions',
  provider: detectProviderFromEnv()?.provider || 'auto',
  model: runtimeDefaultModel(),
  autoRun: false,
  safeMode: 'auto',
  maxBudget: 2.00,
  temperature: 0.5,
  maxTokens: 2048,
  capabilities: {
    vision: false,
    codeExecution: false,
    fileOperations: true,
    webSearch: true,
    browserAutomation: false,
    shellCommands: false,
  },
  toolRestrictions: {
    allowedTools: [
      'read_file',
      'list_files',
      'search_files',
      'web_search',
      'calculator',
    ],
    deniedPaths: [
      '~/.ssh',
      '~/.gnupg',
      '~/.aws',
      '/etc/passwd',
      '/etc/shadow',
    ],
  },
};

// ============================================================================
// Local Profile (LM Studio)
// ============================================================================

export const LOCAL_PROFILE: InterpreterProfile = {
  id: 'local',
  name: 'Local',
  description: 'Offline mode using LM Studio',
  provider: 'lmstudio',
  model: 'local-model',
  baseURL: 'http://localhost:1234/v1',
  apiKey: 'lm-studio',
  autoRun: false,
  safeMode: 'ask',
  maxBudget: 0, // Free
  temperature: 0.7,
  maxTokens: 4096,
  capabilities: {
    vision: false,
    codeExecution: true,
    fileOperations: true,
    webSearch: false,
    browserAutomation: false,
    shellCommands: true,
  },
};

// ============================================================================
// Coding Profile
// ============================================================================

export const CODING_PROFILE: InterpreterProfile = {
  id: 'coding',
  name: 'Coding',
  description: 'Optimized for code generation and development',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet',
  autoRun: true,
  safeMode: 'off',
  maxBudget: 10.00,
  temperature: 0.2,
  maxTokens: 8192,
  capabilities: {
    vision: false,
    codeExecution: true,
    fileOperations: true,
    webSearch: true,
    browserAutomation: false,
    shellCommands: true,
  },
  customInstructions: `You are an expert programmer. Follow these guidelines:
- Write clean, maintainable code
- Include proper error handling
- Follow the project's existing conventions
- Write tests for new functionality
- Use TypeScript when working with JavaScript projects
- Prefer functional programming patterns when appropriate`,
  toolRestrictions: {
    allowedCommands: [
      'npm', 'npx', 'node', 'git', 'python', 'pip',
      'cargo', 'rustc', 'go', 'make', 'cmake',
      'ls', 'cat', 'grep', 'find', 'head', 'tail',
    ],
  },
};

// ============================================================================
// Research Profile
// ============================================================================

export const RESEARCH_PROFILE: InterpreterProfile = {
  id: 'research',
  name: 'Research',
  description: 'Web research and information gathering',
  provider: detectProviderFromEnv()?.provider || 'auto',
  model: runtimeDefaultModel(),
  autoRun: true,
  safeMode: 'auto',
  maxBudget: 5.00,
  temperature: 0.7,
  maxTokens: 8192,
  capabilities: {
    vision: false,
    codeExecution: false,
    fileOperations: true,
    webSearch: true,
    browserAutomation: true,
    shellCommands: false,
  },
  customInstructions: `You are a research assistant. When gathering information:
- Use multiple sources to verify facts
- Cite your sources
- Distinguish between facts and opinions
- Note when information might be outdated
- Summarize findings clearly`,
};

// ============================================================================
// All Built-in Profiles
// ============================================================================

export const BUILTIN_PROFILES: InterpreterProfile[] = [
  DEFAULT_PROFILE,
  FAST_PROFILE,
  VISION_PROFILE,
  SAFE_PROFILE,
  LOCAL_PROFILE,
  CODING_PROFILE,
  RESEARCH_PROFILE,
];

export const BUILTIN_PROFILE_MAP: Map<string, InterpreterProfile> = new Map(
  BUILTIN_PROFILES.map(p => [p.id, p])
);

// ============================================================================
// Profile Utilities
// ============================================================================

/**
 * Get a built-in profile by ID
 */
export function getBuiltinProfile(id: string): InterpreterProfile | undefined {
  return BUILTIN_PROFILE_MAP.get(id);
}

/**
 * List all built-in profile IDs
 */
export function listBuiltinProfiles(): string[] {
  return BUILTIN_PROFILES.map(p => p.id);
}

/**
 * Merge profile with overrides
 */
export function mergeProfile(
  base: InterpreterProfile,
  overrides: Partial<InterpreterProfile>
): InterpreterProfile {
  return {
    ...base,
    ...overrides,
    capabilities: {
      ...base.capabilities,
      ...overrides.capabilities,
    },
    toolRestrictions: {
      ...base.toolRestrictions,
      ...overrides.toolRestrictions,
    },
  };
}

/**
 * Validate a profile configuration
 */
export function validateProfile(profile: InterpreterProfile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!profile.id) {
    errors.push('Profile ID is required');
  }

  if (!profile.provider) {
    errors.push('Provider is required');
  }

  if (!profile.model) {
    errors.push('Model is required');
  }

  if (profile.maxBudget !== undefined && profile.maxBudget < 0) {
    errors.push('Max budget cannot be negative');
  }

  if (profile.temperature !== undefined && (profile.temperature < 0 || profile.temperature > 2)) {
    errors.push('Temperature must be between 0 and 2');
  }

  if (profile.maxTokens !== undefined && profile.maxTokens < 1) {
    errors.push('Max tokens must be at least 1');
  }

  return { valid: errors.length === 0, errors };
}
