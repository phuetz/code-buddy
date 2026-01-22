/**
 * Infrastructure Types - Service Interfaces
 *
 * These interfaces define the contracts for core services,
 * enabling dependency injection and better testability.
 */

import type { EventEmitter } from 'events';

// ============================================================================
// Settings Manager Interface
// ============================================================================

/**
 * User-level settings (global)
 */
export interface IUserSettings {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  models?: string[];
  provider?: string;
  model?: string;
}

/**
 * Project-level settings
 */
export interface IProjectSettings {
  model?: string;
  mcpServers?: Record<string, unknown>;
}

/**
 * Settings Manager interface
 * Matches the actual SettingsManager API
 */
export interface ISettingsManager {
  // User settings
  loadUserSettings(): IUserSettings;
  saveUserSettings(settings: Partial<IUserSettings>): void;
  updateUserSetting<K extends keyof IUserSettings>(key: K, value: IUserSettings[K]): void;
  getUserSetting<K extends keyof IUserSettings>(key: K): IUserSettings[K];

  // Project settings
  loadProjectSettings(): IProjectSettings;
  saveProjectSettings(settings: Partial<IProjectSettings>): void;
  updateProjectSetting<K extends keyof IProjectSettings>(key: K, value: IProjectSettings[K]): void;
  getProjectSetting<K extends keyof IProjectSettings>(key: K): IProjectSettings[K];

  // Convenience methods
  getCurrentModel(): string;
  setCurrentModel(model: string): void;
  getAvailableModels(): string[];
  getApiKey(): string | undefined;
  getBaseURL(): string;
}

// ============================================================================
// Checkpoint Manager Interface
// ============================================================================

/**
 * File snapshot for checkpoints
 */
export interface IFileSnapshot {
  path: string;
  content: string;
  existed: boolean;
}

/**
 * Checkpoint data
 */
export interface ICheckpoint {
  id: string;
  timestamp: Date;
  description: string;
  files: IFileSnapshot[];
  workingDirectory: string;
}

/**
 * Rewind result from checkpoint restoration
 */
export interface IRewindResult {
  success: boolean;
  restored: string[];
  errors: string[];
  checkpoint?: ICheckpoint;
}

/**
 * Checkpoint Manager interface
 * Matches the actual CheckpointManager API
 */
export interface ICheckpointManager extends EventEmitter {
  createCheckpoint(description: string, files?: string[]): ICheckpoint;
  checkpointBeforeEdit(filePath: string, description?: string): ICheckpoint;
  restoreCheckpoint(checkpointId: string): boolean;
  getCheckpoints(): ICheckpoint[];
  getCheckpoint(id: string): ICheckpoint | undefined;
  clearCheckpoints(): void;
  clearOldCheckpoints(maxAge?: number): void;
  rewindToLast(): IRewindResult;
  formatCheckpointList(): string;
}

// ============================================================================
// Session Store Interface
// ============================================================================

/**
 * Session metadata
 */
export interface ISessionMetadata {
  description?: string;
  tags?: string[];
  securityMode?: 'suggest' | 'auto-edit' | 'full-auto';
  agentMode?: 'plan' | 'code' | 'ask' | 'architect';
  tokenCount?: number;
  totalCost?: number;
  toolCallCount?: number;
  [key: string]: string | string[] | number | boolean | undefined;
}

/**
 * Session data
 */
export interface ISession {
  id: string;
  name: string;
  workingDirectory: string;
  model: string;
  messages: ISessionMessage[];
  createdAt: Date;
  lastAccessedAt: Date;
  metadata?: ISessionMetadata;
}

/**
 * Session message
 */
export interface ISessionMessage {
  type: 'user' | 'assistant' | 'tool_result' | 'tool_call';
  content: string;
  timestamp: string;
  toolCallName?: string;
  toolCallSuccess?: boolean;
}

/**
 * Session Store interface
 * Matches the actual SessionStore API
 */
export interface ISessionStore {
  createSession(name: string, model: string): ISession;
  getCurrentSession(): ISession | null;
  getCurrentSessionId(): string | null;
  setCurrentSession(sessionId: string): boolean;
  listSessions(): ISession[];
  getSession(id: string): ISession | null;
  deleteSession(id: string): boolean;
  addMessage(message: ISessionMessage): void;
  updateCurrentSession(chatHistory: unknown[]): void;
  formatSessionList(): string;
  exportSessionToFile(sessionId: string, outputPath?: string): string | null;
}

// ============================================================================
// Cost Tracker Interface
// ============================================================================

/**
 * Token usage data
 */
export interface ITokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  timestamp: Date;
  cost: number;
}

/**
 * Cost report
 */
export interface ICostReport {
  sessionCost: number;
  dailyCost: number;
  weeklyCost: number;
  monthlyCost: number;
  totalCost: number;
  sessionTokens: { input: number; output: number };
  modelBreakdown: Record<string, { cost: number; calls: number }>;
  recentUsage: ITokenUsage[];
}

/**
 * Cost Tracker interface
 * Matches the actual CostTracker API
 */
export interface ICostTracker extends EventEmitter {
  recordUsage(inputTokens: number, outputTokens: number, model: string): ITokenUsage;
  calculateCost(inputTokens: number, outputTokens: number, model: string): number;
  getReport(): ICostReport;
  resetSession(): void;
  clearHistory(): void;
  setBudgetLimit(limit: number): void;
  setDailyLimit(limit: number): void;
  exportToCsv(): string;
  formatDashboard(): string;
  dispose(): void;
}

// ============================================================================
// Service Container Interface
// ============================================================================

/**
 * Service Container interface
 * Provides access to all core services via dependency injection
 */
export interface IServiceContainer {
  readonly settings: ISettingsManager;
  readonly checkpoints: ICheckpointManager;
  readonly sessions: ISessionStore;
  readonly costs: ICostTracker;
}

/**
 * Service Container configuration
 */
export interface IServiceContainerConfig {
  /** Custom settings manager instance */
  settings?: ISettingsManager;
  /** Custom checkpoint manager instance */
  checkpoints?: ICheckpointManager;
  /** Custom session store instance */
  sessions?: ISessionStore;
  /** Custom cost tracker instance */
  costs?: ICostTracker;
}
