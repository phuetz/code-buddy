/**
 * Moltbot-Inspired Hooks System
 *
 * Three specialized hook types:
 * 1. Intro Hook (Readme) - Injects role instructions at session start
 * 2. Session Context Continuity - Persists conversation history across restarts
 * 3. Command Logs - Records all AI actions for security auditing
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Intro/Readme configuration
 */
export interface IntroConfig {
  enabled: boolean;
  sources: IntroSource[];
  combineMode: "prepend" | "append" | "replace";
  maxLength?: number;
}

export interface IntroSource {
  id: string;
  type: "file" | "inline" | "url";
  path?: string;
  content?: string;
  url?: string;
  priority: number;
  enabled: boolean;
  description?: string;
}

export interface IntroResult {
  content: string;
  sources: string[];
  truncated: boolean;
}

/**
 * Session persistence configuration
 */
export interface SessionPersistenceConfig {
  enabled: boolean;
  storageType: "json" | "sqlite";
  storagePath: string;
  maxSessions: number;
  maxMessagesPerSession: number;
  autoSaveInterval: number; // milliseconds
  compressOldSessions: boolean;
}

export interface PersistedSession {
  id: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedMessage[];
  metadata: Record<string, unknown>;
}

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: PersistedToolCall[];
}

export interface PersistedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  timestamp: string;
}

/**
 * Command logging configuration
 */
export interface CommandLogConfig {
  enabled: boolean;
  logPath: string;
  logLevel: "minimal" | "standard" | "verbose";
  rotateDaily: boolean;
  maxLogSize: number; // bytes
  maxLogFiles: number;
  includeTimestamps: boolean;
  includeSessionId: boolean;
  redactSecrets: boolean;
  secretPatterns: string[];
}

export interface CommandLogEntry {
  timestamp: string;
  sessionId?: string;
  type: "tool_call" | "bash" | "file_edit" | "file_create" | "api_call" | "user_input" | "assistant_response";
  action: string;
  details: Record<string, unknown>;
  duration?: number;
  success: boolean;
  error?: string;
}

/**
 * Combined Moltbot hooks configuration
 */
export interface MoltbotHooksConfig {
  intro: IntroConfig;
  persistence: SessionPersistenceConfig;
  commandLog: CommandLogConfig;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_MOLTBOT_CONFIG: MoltbotHooksConfig = {
  intro: {
    enabled: true,
    sources: [
      {
        id: "project-intro",
        type: "file",
        path: ".codebuddy/intro_hook.txt",
        priority: 1,
        enabled: true,
        description: "Project-specific AI role and instructions",
      },
      {
        id: "project-readme",
        type: "file",
        path: ".codebuddy/README.md",
        priority: 2,
        enabled: true,
        description: "Project documentation for context",
      },
      {
        id: "global-intro",
        type: "file",
        path: path.join(os.homedir(), ".codebuddy", "intro_hook.txt"),
        priority: 3,
        enabled: true,
        description: "Global AI role and instructions",
      },
    ],
    combineMode: "prepend",
    maxLength: 8000,
  },
  persistence: {
    enabled: true,
    storageType: "json",
    storagePath: path.join(os.homedir(), ".codebuddy", "sessions"),
    maxSessions: 50,
    maxMessagesPerSession: 500,
    autoSaveInterval: 30000, // 30 seconds
    compressOldSessions: true,
  },
  commandLog: {
    enabled: true,
    logPath: path.join(os.homedir(), ".codebuddy", "logs"),
    logLevel: "standard",
    rotateDaily: true,
    maxLogSize: 10 * 1024 * 1024, // 10MB
    maxLogFiles: 30,
    includeTimestamps: true,
    includeSessionId: true,
    redactSecrets: true,
    secretPatterns: [
      "(api[_-]?key|apikey)[\"']?\\s*[:=]\\s*[\"']?([a-zA-Z0-9_-]{20,})",
      "(password|passwd|pwd)[\"']?\\s*[:=]\\s*[\"']?([^\"'\\s]+)",
      "(secret|token)[\"']?\\s*[:=]\\s*[\"']?([a-zA-Z0-9_-]{16,})",
      "(bearer)\\s+([a-zA-Z0-9._-]+)",
    ],
  },
};

// ============================================================================
// Intro Hook Manager
// ============================================================================

/**
 * Manages intro/readme injection at session start
 */
export class IntroHookManager extends EventEmitter {
  private config: IntroConfig;
  private workingDirectory: string;
  private cachedContent: string | null = null;

  constructor(workingDirectory: string, config?: Partial<IntroConfig>) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_MOLTBOT_CONFIG.intro, ...config };
  }

  /**
   * Load and combine all intro sources
   */
  async loadIntro(): Promise<IntroResult> {
    if (!this.config.enabled) {
      return { content: "", sources: [], truncated: false };
    }

    const sources: string[] = [];
    const contents: { priority: number; content: string; source: string }[] = [];

    // Sort sources by priority
    const sortedSources = [...this.config.sources]
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const source of sortedSources) {
      try {
        const content = await this.loadSource(source);
        if (content) {
          contents.push({
            priority: source.priority,
            content,
            source: source.id,
          });
          sources.push(source.id);
        }
      } catch (error) {
        logger.warn(`Failed to load intro source ${source.id}: ${error}`);
      }
    }

    // Combine contents
    let combined = contents.map(c => c.content).join("\n\n---\n\n");
    let truncated = false;

    // Truncate if needed
    if (this.config.maxLength && combined.length > this.config.maxLength) {
      combined = combined.slice(0, this.config.maxLength) + "\n\n[... truncated ...]";
      truncated = true;
    }

    this.cachedContent = combined;
    this.emit("intro-loaded", { sources, truncated });

    return { content: combined, sources, truncated };
  }

  /**
   * Load content from a single source
   */
  private async loadSource(source: IntroSource): Promise<string | null> {
    switch (source.type) {
      case "inline":
        return source.content || null;

      case "file": {
        if (!source.path) return null;

        // Try absolute path first, then relative to working directory
        let filePath = source.path;
        if (!path.isAbsolute(filePath)) {
          filePath = path.join(this.workingDirectory, filePath);
        }

        if (!fs.existsSync(filePath)) {
          return null;
        }

        return fs.readFileSync(filePath, "utf-8");
      }

      case "url": {
        if (!source.url) return null;

        try {
          const response = await fetch(source.url);
          if (!response.ok) return null;
          return await response.text();
        } catch {
          return null;
        }
      }

      default:
        return null;
    }
  }

  /**
   * Get cached intro content
   */
  getCachedIntro(): string | null {
    return this.cachedContent;
  }

  /**
   * Clear cached content
   */
  clearCache(): void {
    this.cachedContent = null;
  }

  /**
   * Add a new intro source
   */
  addSource(source: IntroSource): void {
    this.config.sources.push(source);
    this.clearCache();
  }

  /**
   * Remove an intro source
   */
  removeSource(id: string): boolean {
    const index = this.config.sources.findIndex(s => s.id === id);
    if (index !== -1) {
      this.config.sources.splice(index, 1);
      this.clearCache();
      return true;
    }
    return false;
  }

  /**
   * Get configuration
   */
  getConfig(): IntroConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IntroConfig>): void {
    this.config = { ...this.config, ...config };
    this.clearCache();
  }
}

// ============================================================================
// Session Persistence Manager
// ============================================================================

/**
 * Manages session persistence for context continuity
 */
export class SessionPersistenceManager extends EventEmitter {
  private config: SessionPersistenceConfig;
  private workingDirectory: string;
  private currentSession: PersistedSession | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor(workingDirectory: string, config?: Partial<SessionPersistenceConfig>) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_MOLTBOT_CONFIG.persistence, ...config };
    this.ensureStorageDirectory();
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true });
    }
  }

  /**
   * Generate session file path
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.config.storagePath, `session-${sessionId}.json`);
  }

  /**
   * Generate project hash for identifying sessions
   */
  private getProjectHash(): string {
    // Simple hash of project path
    const hash = this.workingDirectory
      .split("")
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
    return Math.abs(hash).toString(36);
  }

  /**
   * Start a new session or resume existing
   */
  async startSession(sessionId?: string): Promise<PersistedSession> {
    if (sessionId) {
      // Try to load existing session
      const existing = await this.loadSession(sessionId);
      if (existing) {
        this.currentSession = existing;
        this.startAutoSave();
        this.emit("session-resumed", existing);
        return existing;
      }
    }

    // Create new session
    const newSession: PersistedSession = {
      id: sessionId || `${this.getProjectHash()}-${Date.now().toString(36)}`,
      projectPath: this.workingDirectory,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      metadata: {},
    };

    this.currentSession = newSession;
    this.startAutoSave();
    this.emit("session-started", newSession);

    return newSession;
  }

  /**
   * Load a session from storage
   */
  async loadSession(sessionId: string): Promise<PersistedSession | null> {
    const sessionPath = this.getSessionPath(sessionId);

    if (!fs.existsSync(sessionPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(sessionPath, "utf-8");
      const session = JSON.parse(content) as PersistedSession;
      return session;
    } catch (error) {
      logger.warn(`Failed to load session ${sessionId}: ${error}`);
      return null;
    }
  }

  /**
   * Save current session
   */
  async saveSession(): Promise<void> {
    if (!this.currentSession || !this.config.enabled) {
      return;
    }

    this.currentSession.updatedAt = new Date().toISOString();

    // Trim messages if exceeding limit
    if (this.currentSession.messages.length > this.config.maxMessagesPerSession) {
      const excess = this.currentSession.messages.length - this.config.maxMessagesPerSession;
      this.currentSession.messages.splice(0, excess);
    }

    const sessionPath = this.getSessionPath(this.currentSession.id);

    try {
      fs.writeFileSync(sessionPath, JSON.stringify(this.currentSession, null, 2));
      this.isDirty = false;
      this.emit("session-saved", this.currentSession);
    } catch (error) {
      logger.error(`Failed to save session: ${error instanceof Error ? error : undefined}`);
    }
  }

  /**
   * Add a message to the session
   */
  addMessage(message: Omit<PersistedMessage, "id" | "timestamp">): void {
    if (!this.currentSession) {
      return;
    }

    const fullMessage: PersistedMessage = {
      ...message,
      id: `msg-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
    };

    this.currentSession.messages.push(fullMessage);
    this.isDirty = true;
    this.emit("message-added", fullMessage);
  }

  /**
   * Add a tool call to the last assistant message
   */
  addToolCall(toolCall: Omit<PersistedToolCall, "id" | "timestamp">): void {
    if (!this.currentSession) {
      return;
    }

    const lastMessage = this.currentSession.messages
      .filter(m => m.role === "assistant")
      .pop();

    if (!lastMessage) {
      return;
    }

    if (!lastMessage.toolCalls) {
      lastMessage.toolCalls = [];
    }

    const fullToolCall: PersistedToolCall = {
      ...toolCall,
      id: `tool-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
    };

    lastMessage.toolCalls.push(fullToolCall);
    this.isDirty = true;
    this.emit("tool-call-added", fullToolCall);
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    if (this.config.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(async () => {
        if (this.isDirty) {
          await this.saveSession();
        }
      }, this.config.autoSaveInterval);
    }
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * End current session
   */
  async endSession(): Promise<void> {
    if (this.currentSession) {
      await this.saveSession();
      this.emit("session-ended", this.currentSession);
      this.currentSession = null;
    }
    this.stopAutoSave();
  }

  /**
   * List all sessions for current project
   */
  listSessions(): PersistedSession[] {
    const sessions: PersistedSession[] = [];
    const projectHash = this.getProjectHash();

    try {
      const files = fs.readdirSync(this.config.storagePath);

      for (const file of files) {
        if (!file.startsWith("session-") || !file.endsWith(".json")) {
          continue;
        }

        try {
          const content = fs.readFileSync(
            path.join(this.config.storagePath, file),
            "utf-8"
          );
          const session = JSON.parse(content) as PersistedSession;

          // Filter by project
          if (session.id.startsWith(projectHash) || session.projectPath === this.workingDirectory) {
            sessions.push(session);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }

    // Sort by updatedAt, most recent first
    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get the most recent session
   */
  getMostRecentSession(): PersistedSession | null {
    const sessions = this.listSessions();
    return sessions[0] || null;
  }

  /**
   * Delete old sessions
   */
  async cleanupOldSessions(): Promise<number> {
    const sessions = this.listSessions();
    let deleted = 0;

    if (sessions.length <= this.config.maxSessions) {
      return 0;
    }

    // Delete oldest sessions
    const toDelete = sessions.slice(this.config.maxSessions);

    for (const session of toDelete) {
      const sessionPath = this.getSessionPath(session.id);
      try {
        fs.unlinkSync(sessionPath);
        deleted++;
      } catch {
        // Ignore deletion errors
      }
    }

    this.emit("sessions-cleaned", deleted);
    return deleted;
  }

  /**
   * Get current session
   */
  getCurrentSession(): PersistedSession | null {
    return this.currentSession;
  }

  /**
   * Get configuration
   */
  getConfig(): SessionPersistenceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionPersistenceConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureStorageDirectory();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopAutoSave();
    if (this.isDirty && this.currentSession) {
      // Synchronous save on dispose
      try {
        const sessionPath = this.getSessionPath(this.currentSession.id);
        fs.writeFileSync(sessionPath, JSON.stringify(this.currentSession, null, 2));
      } catch {
        // Ignore errors on dispose
      }
    }
  }
}

// ============================================================================
// Command Logger
// ============================================================================

/**
 * Logs all AI actions for security auditing
 */
export class CommandLogger extends EventEmitter {
  private config: CommandLogConfig;
  private sessionId: string | null = null;
  private currentLogFile: string | null = null;
  private writeBuffer: CommandLogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private compiledSecretPatterns: RegExp[] = [];

  constructor(config?: Partial<CommandLogConfig>) {
    super();
    this.config = { ...DEFAULT_MOLTBOT_CONFIG.commandLog, ...config };
    this.ensureLogDirectory();
    this.compileSecretPatterns();
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.config.logPath)) {
      fs.mkdirSync(this.config.logPath, { recursive: true });
    }
  }

  /**
   * Compile secret redaction patterns
   */
  private compileSecretPatterns(): void {
    this.compiledSecretPatterns = this.config.secretPatterns.map(
      pattern => new RegExp(pattern, "gi")
    );
  }

  /**
   * Get current log file path
   */
  private getLogFilePath(): string {
    if (this.config.rotateDaily) {
      const date = new Date().toISOString().split("T")[0];
      return path.join(this.config.logPath, `commands-${date}.log`);
    }
    return path.join(this.config.logPath, "commands.log");
  }

  /**
   * Redact secrets from a string
   */
  private redactSecrets(text: string): string {
    if (!this.config.redactSecrets) {
      return text;
    }

    let redacted = text;
    for (const pattern of this.compiledSecretPatterns) {
      redacted = redacted.replace(pattern, (match, _group1, _group2) => {
        // Keep the key name, redact the value
        const parts = match.split(/[:=]/);
        if (parts.length > 1) {
          return parts[0] + "=[REDACTED]";
        }
        return "[REDACTED]";
      });
    }

    return redacted;
  }

  /**
   * Redact secrets from an object
   */
  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    const sensitiveKeys = ["password", "secret", "token", "apikey", "api_key", "auth", "credential", "key"];

    // Check if this object has a "name" or "key" field that suggests the "value" is sensitive
    const nameField = obj["name"] || obj["key"];
    const hasSensitiveName = typeof nameField === "string" &&
      sensitiveKeys.some(sk => nameField.toLowerCase().includes(sk));

    for (const [key, value] of Object.entries(obj)) {
      // Check if key suggests sensitive data
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        redacted[key] = "[REDACTED]";
        continue;
      }

      // If the name/key field suggests sensitive data, redact the "value" field
      if (hasSensitiveName && key === "value") {
        redacted[key] = "[REDACTED]";
        continue;
      }

      if (typeof value === "string") {
        redacted[key] = this.redactSecrets(value);
      } else if (typeof value === "object" && value !== null) {
        redacted[key] = this.redactObject(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Set session ID for logging
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Log a command/action
   */
  log(entry: Omit<CommandLogEntry, "timestamp" | "sessionId">): void {
    if (!this.config.enabled) {
      return;
    }

    const fullEntry: CommandLogEntry = {
      ...entry,
      timestamp: this.config.includeTimestamps ? new Date().toISOString() : "",
      sessionId: this.config.includeSessionId ? this.sessionId || undefined : undefined,
      details: this.config.redactSecrets
        ? this.redactObject(entry.details)
        : entry.details,
    };

    this.writeBuffer.push(fullEntry);
    this.emit("logged", fullEntry);

    // Schedule flush
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 1000);
    }
  }

  /**
   * Log a tool call
   */
  logToolCall(
    toolName: string,
    args: Record<string, unknown>,
    result: { success: boolean; output?: string; error?: string },
    duration?: number
  ): void {
    this.log({
      type: "tool_call",
      action: toolName,
      details: {
        arguments: args,
        output: this.config.logLevel === "verbose" ? result.output : undefined,
        error: result.error,
      },
      duration,
      success: result.success,
      error: result.error,
    });
  }

  /**
   * Log a bash command
   */
  logBashCommand(
    command: string,
    result: { success: boolean; output?: string; error?: string; exitCode?: number },
    duration?: number
  ): void {
    this.log({
      type: "bash",
      action: this.redactSecrets(command),
      details: {
        exitCode: result.exitCode,
        output:
          this.config.logLevel === "verbose"
            ? this.redactSecrets(result.output || "")
            : undefined,
        error: result.error ? this.redactSecrets(result.error) : undefined,
      },
      duration,
      success: result.success,
      error: result.error,
    });
  }

  /**
   * Log a file edit
   */
  logFileEdit(
    filePath: string,
    operation: "edit" | "create" | "delete",
    success: boolean,
    error?: string
  ): void {
    this.log({
      type: operation === "create" ? "file_create" : "file_edit",
      action: `${operation}: ${filePath}`,
      details: {
        path: filePath,
        operation,
      },
      success,
      error,
    });
  }

  /**
   * Log user input (minimal, for audit trail)
   */
  logUserInput(inputLength: number): void {
    if (this.config.logLevel === "minimal") {
      return;
    }

    this.log({
      type: "user_input",
      action: "user_message",
      details: {
        length: inputLength,
      },
      success: true,
    });
  }

  /**
   * Log assistant response (minimal, for audit trail)
   */
  logAssistantResponse(responseLength: number, toolCallCount: number): void {
    if (this.config.logLevel === "minimal") {
      return;
    }

    this.log({
      type: "assistant_response",
      action: "assistant_message",
      details: {
        length: responseLength,
        toolCalls: toolCallCount,
      },
      success: true,
    });
  }

  /**
   * Flush write buffer to disk
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.writeBuffer.length === 0) {
      return;
    }

    const logFile = this.getLogFilePath();
    const entries = this.writeBuffer.splice(0, this.writeBuffer.length);

    try {
      // Check if rotation is needed
      await this.checkRotation(logFile);

      // Write entries
      const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
      fs.appendFileSync(logFile, lines);

      this.currentLogFile = logFile;
    } catch (error) {
      logger.error(`Failed to write command log: ${error instanceof Error ? error : undefined}`);
      // Put entries back in buffer
      this.writeBuffer.unshift(...entries);
    }
  }

  /**
   * Check if log rotation is needed
   */
  private async checkRotation(logFile: string): Promise<void> {
    if (!fs.existsSync(logFile)) {
      return;
    }

    const stats = fs.statSync(logFile);

    if (stats.size > this.config.maxLogSize) {
      // Rotate log
      const rotatedPath = logFile.replace(".log", `-${Date.now()}.log`);
      fs.renameSync(logFile, rotatedPath);

      // Clean up old logs
      await this.cleanupOldLogs();
    }
  }

  /**
   * Clean up old log files
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = fs.readdirSync(this.config.logPath)
        .filter(f => f.startsWith("commands-") && f.endsWith(".log"))
        .map(f => ({
          name: f,
          path: path.join(this.config.logPath, f),
          mtime: fs.statSync(path.join(this.config.logPath, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Delete oldest files beyond maxLogFiles
      const toDelete = files.slice(this.config.maxLogFiles);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Get log statistics
   */
  getStats(): { totalEntries: number; logSize: number; oldestLog: Date | null } {
    let totalEntries = 0;
    let logSize = 0;
    let oldestLog: Date | null = null;

    try {
      const files = fs.readdirSync(this.config.logPath)
        .filter(f => f.startsWith("commands") && f.endsWith(".log"));

      for (const file of files) {
        const filePath = path.join(this.config.logPath, file);
        const stats = fs.statSync(filePath);
        logSize += stats.size;

        if (!oldestLog || stats.mtime < oldestLog) {
          oldestLog = stats.mtime;
        }

        // Count entries (approximate - one per line)
        const content = fs.readFileSync(filePath, "utf-8");
        totalEntries += content.split("\n").filter(l => l.trim()).length;
      }
    } catch {
      // Ignore errors
    }

    return { totalEntries, logSize, oldestLog };
  }

  /**
   * Get configuration
   */
  getConfig(): CommandLogConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CommandLogConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureLogDirectory();
    if (config.secretPatterns) {
      this.compileSecretPatterns();
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    // Synchronous flush on dispose
    if (this.writeBuffer.length > 0) {
      const logFile = this.getLogFilePath();
      const lines = this.writeBuffer.map(e => JSON.stringify(e)).join("\n") + "\n";
      try {
        fs.appendFileSync(logFile, lines);
      } catch {
        // Ignore errors on dispose
      }
    }
  }
}

// ============================================================================
// Combined Moltbot Hooks Manager
// ============================================================================

/**
 * Unified manager for all Moltbot-inspired hooks
 */
export class MoltbotHooksManager extends EventEmitter {
  private introManager: IntroHookManager;
  private sessionManager: SessionPersistenceManager;
  private commandLogger: CommandLogger;
  private workingDirectory: string;
  private config: MoltbotHooksConfig;

  constructor(workingDirectory: string, config?: Partial<MoltbotHooksConfig>) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = {
      intro: { ...DEFAULT_MOLTBOT_CONFIG.intro, ...config?.intro },
      persistence: { ...DEFAULT_MOLTBOT_CONFIG.persistence, ...config?.persistence },
      commandLog: { ...DEFAULT_MOLTBOT_CONFIG.commandLog, ...config?.commandLog },
    };

    this.introManager = new IntroHookManager(workingDirectory, this.config.intro);
    this.sessionManager = new SessionPersistenceManager(workingDirectory, this.config.persistence);
    this.commandLogger = new CommandLogger(this.config.commandLog);

    // Forward events
    this.introManager.on("intro-loaded", (...args) => this.emit("intro-loaded", ...args));
    this.sessionManager.on("session-started", (...args) => this.emit("session-started", ...args));
    this.sessionManager.on("session-resumed", (...args) => this.emit("session-resumed", ...args));
    this.sessionManager.on("session-saved", (...args) => this.emit("session-saved", ...args));
    this.sessionManager.on("session-ended", (...args) => this.emit("session-ended", ...args));
    this.commandLogger.on("logged", (...args) => this.emit("command-logged", ...args));
  }

  /**
   * Initialize session with intro loading
   */
  async initializeSession(sessionId?: string): Promise<{
    intro: IntroResult;
    session: PersistedSession;
  }> {
    // Load intro content
    const intro = await this.introManager.loadIntro();

    // Start or resume session
    const session = await this.sessionManager.startSession(sessionId);

    // Set session ID for command logging
    this.commandLogger.setSessionId(session.id);

    return { intro, session };
  }

  /**
   * Resume the most recent session
   */
  async resumeLastSession(): Promise<{
    intro: IntroResult;
    session: PersistedSession | null;
  }> {
    const intro = await this.introManager.loadIntro();
    const lastSession = this.sessionManager.getMostRecentSession();

    if (lastSession) {
      const session = await this.sessionManager.startSession(lastSession.id);
      this.commandLogger.setSessionId(session.id);
      return { intro, session };
    }

    return { intro, session: null };
  }

  /**
   * Get intro manager
   */
  getIntroManager(): IntroHookManager {
    return this.introManager;
  }

  /**
   * Get session manager
   */
  getSessionManager(): SessionPersistenceManager {
    return this.sessionManager;
  }

  /**
   * Get command logger
   */
  getCommandLogger(): CommandLogger {
    return this.commandLogger;
  }

  /**
   * End session and cleanup
   */
  async endSession(): Promise<void> {
    await this.sessionManager.endSession();
    await this.commandLogger.flush();
  }

  /**
   * Sync config from sub-managers
   */
  private syncConfig(): void {
    this.config = {
      intro: this.introManager.getConfig(),
      persistence: this.sessionManager.getConfig(),
      commandLog: this.commandLogger.getConfig(),
    };
  }

  /**
   * Get configuration (synced from sub-managers)
   */
  getConfig(): MoltbotHooksConfig {
    this.syncConfig();
    return { ...this.config };
  }

  /**
   * Save configuration to file
   */
  saveConfig(configPath?: string): void {
    this.syncConfig(); // Sync from sub-managers before saving

    const savePath = configPath || path.join(this.workingDirectory, ".codebuddy", "moltbot-hooks.json");
    const dir = path.dirname(savePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(savePath, JSON.stringify(this.config, null, 2));
  }

  /**
   * Load configuration from file
   */
  loadConfig(configPath?: string): void {
    const loadPath = configPath || path.join(this.workingDirectory, ".codebuddy", "moltbot-hooks.json");

    if (!fs.existsSync(loadPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(loadPath, "utf-8");
      const fileConfig = JSON.parse(content) as Partial<MoltbotHooksConfig>;

      if (fileConfig.intro) {
        this.introManager.updateConfig(fileConfig.intro);
      }
      if (fileConfig.persistence) {
        this.sessionManager.updateConfig(fileConfig.persistence);
      }
      if (fileConfig.commandLog) {
        this.commandLogger.updateConfig(fileConfig.commandLog);
      }

      this.config = {
        intro: this.introManager.getConfig(),
        persistence: this.sessionManager.getConfig(),
        commandLog: this.commandLogger.getConfig(),
      };
    } catch (error) {
      logger.warn(`Failed to load moltbot config: ${error}`);
    }
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const lines: string[] = [
      "🤖 Moltbot Hooks Status",
      "═".repeat(50),
      "",
    ];

    // Intro status
    const introConfig = this.introManager.getConfig();
    lines.push(`📖 Intro Hook: ${introConfig.enabled ? "✅ Enabled" : "❌ Disabled"}`);
    if (introConfig.enabled) {
      const enabledSources = introConfig.sources.filter(s => s.enabled);
      lines.push(`   Sources: ${enabledSources.length} configured`);
      for (const source of enabledSources) {
        lines.push(`   • ${source.id} (${source.type})`);
      }
    }
    lines.push("");

    // Persistence status
    const persistConfig = this.sessionManager.getConfig();
    lines.push(`💾 Session Persistence: ${persistConfig.enabled ? "✅ Enabled" : "❌ Disabled"}`);
    if (persistConfig.enabled) {
      const sessions = this.sessionManager.listSessions();
      const current = this.sessionManager.getCurrentSession();
      lines.push(`   Storage: ${persistConfig.storageType}`);
      lines.push(`   Sessions: ${sessions.length}/${persistConfig.maxSessions}`);
      if (current) {
        lines.push(`   Current: ${current.id}`);
        lines.push(`   Messages: ${current.messages.length}`);
      }
    }
    lines.push("");

    // Command log status
    const logConfig = this.commandLogger.getConfig();
    lines.push(`📝 Command Logging: ${logConfig.enabled ? "✅ Enabled" : "❌ Disabled"}`);
    if (logConfig.enabled) {
      const stats = this.commandLogger.getStats();
      lines.push(`   Level: ${logConfig.logLevel}`);
      lines.push(`   Entries: ${stats.totalEntries}`);
      lines.push(`   Size: ${(stats.logSize / 1024).toFixed(1)} KB`);
      lines.push(`   Redact secrets: ${logConfig.redactSecrets ? "Yes" : "No"}`);
    }

    return lines.join("\n");
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.sessionManager.dispose();
    this.commandLogger.dispose();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let moltbotManagerInstance: MoltbotHooksManager | null = null;

/**
 * Get or create Moltbot hooks manager instance
 */
export function getMoltbotHooksManager(
  workingDirectory?: string,
  config?: Partial<MoltbotHooksConfig>
): MoltbotHooksManager {
  if (!moltbotManagerInstance || workingDirectory) {
    moltbotManagerInstance = new MoltbotHooksManager(
      workingDirectory || process.cwd(),
      config
    );
    // Try to load config from file
    moltbotManagerInstance.loadConfig();
  }
  return moltbotManagerInstance;
}

/**
 * Reset Moltbot hooks manager instance
 */
export function resetMoltbotHooksManager(): void {
  if (moltbotManagerInstance) {
    moltbotManagerInstance.dispose();
  }
  moltbotManagerInstance = null;
}

// ============================================================================
// Setup Utilities (Moltbot-style)
// ============================================================================

/**
 * Default intro hook template (like Moltbot's intro_hook.txt)
 */
export const DEFAULT_INTRO_HOOK_TEMPLATE = `# AI Role Configuration
# Edit this file to customize your AI assistant's behavior

## Your Role
You are an expert software developer and helpful coding assistant.

## Personality
- Be concise and direct
- Explain your reasoning when making decisions
- Ask clarifying questions when requirements are unclear
- Prioritize code quality and maintainability

## Project Context
[Describe your project here - its purpose, main technologies, coding standards]

## Rules
1. Always follow existing code patterns in this project
2. Write tests for new functionality
3. Document complex logic with comments
4. Prefer simple solutions over clever ones

## Forbidden Actions
- Never commit sensitive data (API keys, passwords)
- Never delete files without confirmation
- Never run destructive commands without warning
`;

/**
 * Default global intro hook template
 */
export const DEFAULT_GLOBAL_INTRO_TEMPLATE = `# Global AI Configuration
# This applies to all projects unless overridden by project-specific intro_hook.txt

## Default Behavior
- Be helpful and professional
- Follow best practices for each programming language
- Prioritize security and performance

## Coding Standards
- Use meaningful variable and function names
- Keep functions small and focused
- Write self-documenting code
`;

/**
 * Setup options for Moltbot hooks
 */
export interface MoltbotSetupOptions {
  enableIntroHook: boolean;
  enableSessionPersistence: boolean;
  enableCommandLogging: boolean;
  introContent?: string;
  projectLevel?: boolean;
  globalLevel?: boolean;
}

/**
 * Setup result
 */
export interface MoltbotSetupResult {
  success: boolean;
  filesCreated: string[];
  errors: string[];
}

/**
 * Check if Moltbot hooks are configured
 */
export function checkMoltbotSetup(workingDirectory: string = process.cwd()): {
  hasProjectIntro: boolean;
  hasGlobalIntro: boolean;
  hasProjectConfig: boolean;
  hasGlobalConfig: boolean;
  introPath: string | null;
  configPath: string | null;
} {
  const projectIntroPath = path.join(workingDirectory, ".codebuddy", "intro_hook.txt");
  const globalIntroPath = path.join(os.homedir(), ".codebuddy", "intro_hook.txt");
  const projectConfigPath = path.join(workingDirectory, ".codebuddy", "moltbot-hooks.json");
  const globalConfigPath = path.join(os.homedir(), ".codebuddy", "moltbot-hooks.json");

  const hasProjectIntro = fs.existsSync(projectIntroPath);
  const hasGlobalIntro = fs.existsSync(globalIntroPath);
  const hasProjectConfig = fs.existsSync(projectConfigPath);
  const hasGlobalConfig = fs.existsSync(globalConfigPath);

  // Find first available intro
  let introPath: string | null = null;
  if (hasProjectIntro) introPath = projectIntroPath;
  else if (hasGlobalIntro) introPath = globalIntroPath;

  // Find first available config
  let configPath: string | null = null;
  if (hasProjectConfig) configPath = projectConfigPath;
  else if (hasGlobalConfig) configPath = globalConfigPath;

  return {
    hasProjectIntro,
    hasGlobalIntro,
    hasProjectConfig,
    hasGlobalConfig,
    introPath,
    configPath,
  };
}

/**
 * Setup Moltbot hooks (like Moltbot's install.sh setup)
 */
export function setupMoltbotHooks(
  workingDirectory: string,
  options: MoltbotSetupOptions
): MoltbotSetupResult {
  const result: MoltbotSetupResult = {
    success: true,
    filesCreated: [],
    errors: [],
  };

  const projectDir = path.join(workingDirectory, ".codebuddy");
  const globalDir = path.join(os.homedir(), ".codebuddy");

  // Create directories
  try {
    if (options.projectLevel !== false) {
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
      }
    }
    if (options.globalLevel) {
      if (!fs.existsSync(globalDir)) {
        fs.mkdirSync(globalDir, { recursive: true });
      }
    }
  } catch (error) {
    result.errors.push(`Failed to create directories: ${error}`);
    result.success = false;
    return result;
  }

  // Create intro_hook.txt
  if (options.enableIntroHook) {
    const content = options.introContent || DEFAULT_INTRO_HOOK_TEMPLATE;

    if (options.projectLevel !== false) {
      const projectIntroPath = path.join(projectDir, "intro_hook.txt");
      try {
        fs.writeFileSync(projectIntroPath, content);
        result.filesCreated.push(projectIntroPath);
      } catch (error) {
        result.errors.push(`Failed to create project intro_hook.txt: ${error}`);
      }
    }

    if (options.globalLevel) {
      const globalIntroPath = path.join(globalDir, "intro_hook.txt");
      if (!fs.existsSync(globalIntroPath)) {
        try {
          fs.writeFileSync(globalIntroPath, DEFAULT_GLOBAL_INTRO_TEMPLATE);
          result.filesCreated.push(globalIntroPath);
        } catch (error) {
          result.errors.push(`Failed to create global intro_hook.txt: ${error}`);
        }
      }
    }
  }

  // Create moltbot-hooks.json config
  const config: MoltbotHooksConfig = {
    intro: {
      ...DEFAULT_MOLTBOT_CONFIG.intro,
      enabled: options.enableIntroHook,
    },
    persistence: {
      ...DEFAULT_MOLTBOT_CONFIG.persistence,
      enabled: options.enableSessionPersistence,
    },
    commandLog: {
      ...DEFAULT_MOLTBOT_CONFIG.commandLog,
      enabled: options.enableCommandLogging,
    },
  };

  if (options.projectLevel !== false) {
    const projectConfigPath = path.join(projectDir, "moltbot-hooks.json");
    try {
      fs.writeFileSync(projectConfigPath, JSON.stringify(config, null, 2));
      result.filesCreated.push(projectConfigPath);
    } catch (error) {
      result.errors.push(`Failed to create project config: ${error}`);
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Quick enable all Moltbot hooks with defaults
 */
export function enableMoltbotHooks(
  workingDirectory: string = process.cwd(),
  options: { global?: boolean } = {}
): MoltbotSetupResult {
  return setupMoltbotHooks(workingDirectory, {
    enableIntroHook: true,
    enableSessionPersistence: true,
    enableCommandLogging: true,
    projectLevel: true,
    globalLevel: options.global ?? false,
  });
}

/**
 * Quick disable all Moltbot hooks
 */
export function disableMoltbotHooks(workingDirectory: string = process.cwd()): void {
  const configPath = path.join(workingDirectory, ".codebuddy", "moltbot-hooks.json");

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content) as MoltbotHooksConfig;

      config.intro.enabled = false;
      config.persistence.enabled = false;
      config.commandLog.enabled = false;

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Get intro hook content for display/editing
 */
export function getIntroHookContent(workingDirectory: string = process.cwd()): string | null {
  const paths = [
    path.join(workingDirectory, ".codebuddy", "intro_hook.txt"),
    path.join(os.homedir(), ".codebuddy", "intro_hook.txt"),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf-8");
    }
  }

  return null;
}

/**
 * Set intro hook content
 */
export function setIntroHookContent(
  content: string,
  workingDirectory: string = process.cwd(),
  global: boolean = false
): string {
  const dir = global
    ? path.join(os.homedir(), ".codebuddy")
    : path.join(workingDirectory, ".codebuddy");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, "intro_hook.txt");
  fs.writeFileSync(filePath, content);

  return filePath;
}

/**
 * Format setup status for display (interactive setup output)
 */
export function formatSetupStatus(workingDirectory: string = process.cwd()): string {
  const status = checkMoltbotSetup(workingDirectory);
  const lines: string[] = [
    "",
    "╔════════════════════════════════════════════════════════════╗",
    "║            MOLTBOT HOOKS - Configuration Status            ║",
    "╠════════════════════════════════════════════════════════════╣",
    "",
  ];

  // Intro Hook Status
  lines.push("📖 INTRO HOOK (AI Role Definition)");
  if (status.hasProjectIntro) {
    lines.push(`   ✅ Project: .codebuddy/intro_hook.txt`);
  } else {
    lines.push(`   ⚪ Project: Not configured`);
  }
  if (status.hasGlobalIntro) {
    lines.push(`   ✅ Global:  ~/.codebuddy/intro_hook.txt`);
  } else {
    lines.push(`   ⚪ Global:  Not configured`);
  }
  lines.push("");

  // Session Persistence Status
  lines.push("💾 SESSION PERSISTENCE (Context Continuity)");
  const sessionsDir = path.join(os.homedir(), ".codebuddy", "sessions");
  if (fs.existsSync(sessionsDir)) {
    try {
      const sessions = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
      lines.push(`   ✅ Enabled: ${sessions.length} sessions stored`);
    } catch {
      lines.push(`   ✅ Enabled: Storage directory exists`);
    }
  } else {
    lines.push(`   ⚪ Not initialized yet`);
  }
  lines.push("");

  // Command Logging Status
  lines.push("📝 COMMAND LOGGING (Security Audit)");
  const logsDir = path.join(os.homedir(), ".codebuddy", "logs");
  if (fs.existsSync(logsDir)) {
    try {
      const logs = fs.readdirSync(logsDir).filter(f => f.endsWith(".log"));
      lines.push(`   ✅ Enabled: ${logs.length} log files`);
    } catch {
      lines.push(`   ✅ Enabled: Logs directory exists`);
    }
  } else {
    lines.push(`   ⚪ Not initialized yet`);
  }
  lines.push("");

  // Quick Setup Commands
  lines.push("╠════════════════════════════════════════════════════════════╣");
  lines.push("║                     Quick Commands                         ║");
  lines.push("╠════════════════════════════════════════════════════════════╣");
  lines.push("");
  lines.push("  To enable all hooks:");
  lines.push("    /hooks enable");
  lines.push("");
  lines.push("  To edit your intro hook:");
  lines.push("    /hooks edit");
  lines.push("");
  lines.push("  To view current intro:");
  lines.push("    /hooks intro");
  lines.push("");
  lines.push("╚════════════════════════════════════════════════════════════╝");

  return lines.join("\n");
}
