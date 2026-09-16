/**
 * Moltbot Setup Utilities
 *
 * Setup, configuration check, and utility functions for the Moltbot hooks system.
 * Includes file creation, status display, and quick enable/disable commands.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import type {
  MoltbotHooksConfig,
  MoltbotSetupOptions,
  MoltbotSetupResult,
} from "./types.js";
import {
  DEFAULT_MOLTBOT_CONFIG,
  DEFAULT_INTRO_HOOK_TEMPLATE,
  DEFAULT_GLOBAL_INTRO_TEMPLATE,
} from "./config.js";
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

// ============================================================================
// Setup Check
// ============================================================================

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

// ============================================================================
// Setup Functions
// ============================================================================

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
      writeJsonAtomicSync(projectConfigPath, config, { mode: 0o600 });
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
      const config = readJsonAtomicSync<MoltbotHooksConfig | null>(configPath, null, { mode: 0o600 });
      if (!config) return;

      config.intro.enabled = false;
      config.persistence.enabled = false;
      config.commandLog.enabled = false;

      writeJsonAtomicSync(configPath, config, { mode: 0o600 });
    } catch {
      // Ignore errors
    }
  }
}

// ============================================================================
// Content Helpers
// ============================================================================

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

// ============================================================================
// Status Display
// ============================================================================

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
