/**
 * Application Types
 *
 * Type definitions for the application factory and configuration.
 */

import type { SecurityMode } from '../security/security-modes.js';

/**
 * Application configuration
 */
export interface ApplicationConfig {
  /** API key for the AI provider */
  apiKey?: string;
  /** Base URL for API calls */
  baseURL?: string;
  /** Model to use */
  model?: string;
  /** Maximum tool execution rounds */
  maxToolRounds?: number;
  /** Security mode (suggest, auto-edit, full-auto) */
  securityMode?: SecurityMode;
  /** Enable dry-run mode */
  dryRun?: boolean;
  /** Enable response caching */
  cache?: boolean;
  /** Enable self-healing */
  selfHeal?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
  /** Context file patterns */
  context?: string;
  /** System prompt identifier */
  systemPrompt?: string;
  /** Custom agent identifier */
  agent?: string;
  /** Probe for tool support */
  probeTools?: boolean;
}

/**
 * Command-line options from Commander
 */
export interface CommandLineOptions extends ApplicationConfig {
  /** Initial message to send */
  message?: string;
  /** Run in headless mode */
  headless?: boolean;
  /** Resume from crash */
  resume?: boolean;
  /** Save settings */
  saveSettings?: boolean;
  /** Output format */
  format?: 'text' | 'json' | 'markdown';
}

/**
 * Application run mode
 */
export type RunMode = 'interactive' | 'headless' | 'server' | 'init';

/**
 * Application instance interface
 */
export interface IApplication {
  /** Initialize the application */
  initialize(): Promise<void>;
  /** Run the application */
  run(args?: string[]): Promise<void>;
  /** Shutdown the application */
  shutdown(): Promise<void>;
}

/**
 * Lazy import registry for heavy modules
 */
export interface LazyImports {
  React: () => Promise<typeof import('react')>;
  ink: () => Promise<typeof import('ink')>;
  CodeBuddyAgent: () => Promise<typeof import('../agent/codebuddy-agent.js').CodeBuddyAgent>;
  ChatInterface: () => Promise<typeof import('../ui/components/ChatInterface.js').default>;
  ConfirmationService: () => Promise<typeof import('../utils/confirmation-service.js').ConfirmationService>;
}
