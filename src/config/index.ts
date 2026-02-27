/**
 * Config module - Application constants, configuration, and project rules
 */

export * from "./constants.js";
export * from "./codebuddyrules.js";

// Connection profiles and configuration resolution
export * from "./types.js";
export * from "./config-resolver.js";
export * from "./migration.js";

// 3-level settings hierarchy (global < project < project-local)
export {
  SettingsHierarchy,
  SettingsLevel,
  getSettingsHierarchy,
  resetSettingsHierarchy,
} from './settings-hierarchy.js';
export type {
  CodeBuddySettings,
  SettingsWithSource,
  HookConfig,
  McpServerConfig,
} from './settings-hierarchy.js';

// SecretRef resolution for config values
export { resolveSecretRefs, resolveSecretRef } from './secret-ref.js';
