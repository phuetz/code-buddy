/**
 * Moltbot Hooks Manager
 *
 * Unified manager for all Moltbot-inspired hooks: intro, session persistence,
 * and command logging. Provides singleton access and configuration management.
 */

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { logger } from "../../utils/logger.js";

import type {
  MoltbotHooksConfig,
  IntroResult,
  PersistedSession,
} from "./types.js";
import { DEFAULT_MOLTBOT_CONFIG } from "./config.js";
import { IntroHookManager } from "./intro-hook-manager.js";
import { SessionPersistenceManager } from "./session-persistence-manager.js";
import { CommandLogger } from "./command-logger.js";
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

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

    writeJsonAtomicSync(savePath, this.config, { mode: 0o600 });
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
      const fileConfig = readJsonAtomicSync<Partial<MoltbotHooksConfig> | null>(loadPath, null, {
        mode: 0o600,
        isValid: (value): value is Partial<MoltbotHooksConfig> => Boolean(
          value && typeof value === 'object' && !Array.isArray(value),
        ),
      });
      if (!fileConfig) return;

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
