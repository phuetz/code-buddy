#!/usr/bin/env node
// Record startup time as early as possible
const STARTUP_TIME = Date.now();

import { program } from "commander";

// Types for dynamically imported modules
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import type { SecurityMode } from "./security/security-modes.js";

// Import logger statically since it's used throughout the file synchronously
import { logger } from "./utils/logger.js";
// Import graceful shutdown for clean application termination
import {
  initializeGracefulShutdown,
  getShutdownManager,
} from "./utils/graceful-shutdown.js";

// Startup timing (enabled via PERF_TIMING=true or DEBUG=true)
const PERF_TIMING = process.env.PERF_TIMING === 'true' || process.env.DEBUG === 'true';
const startupPhases: { name: string; time: number }[] = [];

function recordStartupPhase(name: string): void {
  if (!PERF_TIMING) return;
  startupPhases.push({ name, time: Date.now() - STARTUP_TIME });
}

function logStartupMetrics(): void {
  if (!PERF_TIMING || startupPhases.length === 0) return;
  console.log('\n=== Startup Performance ===');
  console.log(`Total time: ${Date.now() - STARTUP_TIME}ms`);
  console.log('Phase breakdown:');
  for (const phase of startupPhases) {
    console.log(`  ${phase.name}: ${phase.time}ms`);
  }
  console.log('===========================\n');
}

recordStartupPhase('imports-start');

recordStartupPhase('imports-done');

// ============================================================================
// Lazy Import System - Defer heavy modules until needed
// ============================================================================

// Cached lazy imports - only loaded once when first accessed
const lazyModuleCache: Map<string, unknown> = new Map();

async function lazyLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (lazyModuleCache.has(key)) {
    return lazyModuleCache.get(key) as T;
  }
  const startTime = PERF_TIMING ? Date.now() : 0;
  const module = await loader();
  if (PERF_TIMING) {
    const loadTime = Date.now() - startTime;
    if (loadTime > 50) { // Only log slow loads
      recordStartupPhase(`lazy:${key} (${loadTime}ms)`);
    }
  }
  lazyModuleCache.set(key, module);
  return module;
}

// Lazy imports for heavy modules - only loaded when needed
const lazyImport = {
  // UI modules - heavy, only needed for interactive mode
  React: () => lazyLoad('react', () => import("react")),
  ink: () => lazyLoad('ink', () => import("ink")),
  ChatInterface: () => lazyLoad('ChatInterface', () => import("./ui/components/ChatInterface.js").then(m => m.default)),

  // Core agent - heavy, needed for all operations
  CodeBuddyAgent: () => lazyLoad('CodeBuddyAgent', () => import("./agent/codebuddy-agent.js").then(m => m.CodeBuddyAgent)),

  // Utilities - medium weight
  ConfirmationService: () => lazyLoad('ConfirmationService', () => import("./utils/confirmation-service.js").then(m => m.ConfirmationService)),
  settingsManager: () => lazyLoad('settingsManager', () => import("./utils/settings-manager.js").then(m => m.getSettingsManager)),
  credentialManager: () => lazyLoad('credentialManager', () => import("./security/credential-manager.js").then(m => m.getCredentialManager)),

  // Commands - only loaded when their command is run
  createMCPCommand: () => lazyLoad('createMCPCommand', () => import("./commands/mcp.js").then(m => m.createMCPCommand)),
  initProject: () => lazyLoad('initProject', () => import("./utils/init-project.js")),
  securityModes: () => lazyLoad('securityModes', () => import("./security/security-modes.js")),
  contextLoader: () => lazyLoad('contextLoader', () => import("./context/context-loader.js")),
  renderers: () => lazyLoad('renderers', () => import("./renderers/index.js")),
  performance: () => lazyLoad('performance', () => import("./performance/index.js")),
  pluginManager: () => lazyLoad('pluginManager', () => import("./plugins/plugin-manager.js")),
  lazyLoader: () => lazyLoad('lazyLoader', () => import("./performance/lazy-loader.js")),

  // Error handling - deferred until needed
  crashHandler: () => lazyLoad('crashHandler', () => import('./errors/crash-handler.js').then(m => m.getCrashHandler())),
  disposable: () => lazyLoad('disposable', () => import('./utils/disposable.js')),

  // Environment - load early but still lazy
  dotenv: () => lazyLoad('dotenv', () => import('dotenv')),
};

// ============================================================================
// Minimal startup - defer everything possible
// ============================================================================

// Load environment variables lazily (but early)
let envLoaded = false;
async function ensureEnvLoaded(): Promise<void> {
  if (!envLoaded) {
    const dotenv = await lazyImport.dotenv();
    dotenv.config();
    envLoaded = true;
  }
}

// Minimal logger for startup errors (no chalk dependency)
const startupLogger = {
  error: (msg: string, err?: unknown) => {
    console.error(msg, err instanceof Error ? err.message : err);
  },
  warn: (msg: string) => console.warn(msg),
};

// ============================================================================
// Process Signal Handlers - Using Graceful Shutdown Manager
// ============================================================================

// Initialize graceful shutdown system with 30s timeout
const _shutdownManager = initializeGracefulShutdown({
  timeoutMs: 30000, // 30 seconds max before force exit
  forceExitOnTimeout: true,
  showProgress: true,
});

// Note: SIGINT, SIGTERM, SIGHUP are now handled by GracefulShutdownManager
// The manager will:
// 1. Wait for pending operations to complete
// 2. Save session state
// 3. Restore terminal
// 4. Close MCP connections
// 5. Close database connections
// 6. Flush logs
// 7. Exit cleanly (or force exit after timeout)

// Handle uncaught exceptions with crash recovery
process.on("uncaughtException", async (error) => {
  let crashFile: string | null = null;
  try {
    const crashHandler = await lazyImport.crashHandler();
    crashFile = crashHandler.handleCrash(error, "Uncaught exception");
  } catch (_err) {
    // Intentionally ignored: crash handler itself may fail during fatal error recovery
  }

  startupLogger.error("\nUnexpected error occurred:", error);
  if (crashFile) {
    startupLogger.error(`\nCrash context saved to: ${crashFile}`);
    startupLogger.error("You can resume your session with: grok --resume");
  }

  // Use graceful shutdown with error exit code
  try {
    await getShutdownManager().shutdown({ exitCode: 1, showProgress: false });
  } catch (_err) {
    // Intentionally ignored: shutdown itself failed, force exit as last resort
    process.exit(1);
  }
});

process.on("unhandledRejection", async (reason, _promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  let crashFile: string | null = null;
  try {
    const crashHandler = await lazyImport.crashHandler();
    crashFile = crashHandler.handleCrash(error, "Unhandled rejection");
  } catch (_err) {
    // Intentionally ignored: crash handler itself may fail during fatal error recovery
  }

  startupLogger.error("\nUnhandled promise rejection:", error);
  if (crashFile) {
    startupLogger.error(`\nCrash context saved to: ${crashFile}`);
    startupLogger.error("You can resume your session with: grok --resume");
  }

  // Use graceful shutdown with error exit code
  try {
    await getShutdownManager().shutdown({ exitCode: 1, showProgress: false });
  } catch (_err) {
    // Intentionally ignored: shutdown itself failed, force exit as last resort
    process.exit(1);
  }
});

// ============================================================================
// Settings and Credential Loading - Now async with lazy imports
// ============================================================================

// Ensure user settings are initialized
async function ensureUserSettingsDirectory(): Promise<void> {
  try {
    const getSettingsManager = await lazyImport.settingsManager();
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch (_err) {
    logger.debug('Failed to initialize user settings directory', { error: _err });
  }
}

// Detected provider configuration
interface DetectedProvider {
  provider: 'gemini' | 'grok' | 'openai' | 'anthropic' | 'unknown';
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

// Detect provider from environment variables
function detectProviderFromEnv(): DetectedProvider | null {
  // Priority: Gemini > Grok > OpenAI > Anthropic
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };
  }

  if (process.env.GROK_API_KEY || process.env.XAI_API_KEY) {
    return {
      provider: 'grok',
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
      baseURL: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      defaultModel: process.env.GROK_MODEL || 'grok-3-fast-latest',
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com/v1',
      defaultModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    };
  }

  return null;
}

// Cache detected provider
let cachedProvider: DetectedProvider | null | undefined = undefined;

async function getDetectedProvider(): Promise<DetectedProvider | null> {
  if (cachedProvider !== undefined) return cachedProvider;

  await ensureEnvLoaded();
  cachedProvider = detectProviderFromEnv();

  if (cachedProvider) {
    logger.info(`Auto-detected provider: ${cachedProvider.provider} (model: ${cachedProvider.defaultModel})`);
  }

  return cachedProvider;
}

// Load API key from environment, secure storage, or legacy settings
async function loadApiKey(): Promise<string | undefined> {
  await ensureEnvLoaded();

  // Check environment-detected provider first
  const detected = await getDetectedProvider();
  if (detected) return detected.apiKey;

  // Priority: secure credential storage > legacy settings file
  const getCredentialManager = await lazyImport.credentialManager();
  const credManager = getCredentialManager();
  const apiKey = credManager.getApiKey();

  if (apiKey) {
    return apiKey;
  }

  // Fall back to legacy settings manager
  const getSettingsManager = await lazyImport.settingsManager();
  const settingsManager = getSettingsManager();
  return settingsManager.getApiKey();
}

// Load base URL from detected provider or user settings
async function loadBaseURL(): Promise<string> {
  await ensureEnvLoaded();

  // Check environment-detected provider first
  const detected = await getDetectedProvider();
  if (detected) return detected.baseURL;

  // Check explicit environment override
  const envBaseURL = process.env.GROK_BASE_URL;
  if (envBaseURL) return envBaseURL;

  const getSettingsManager = await lazyImport.settingsManager();
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line settings to user settings file
async function saveCommandLineSettings(
  apiKey?: string,
  baseURL?: string
): Promise<void> {
  try {
    const getSettingsManager = await lazyImport.settingsManager();
    const settingsManager = getSettingsManager();
    const getCredentialManager = await lazyImport.credentialManager();
    const credManager = getCredentialManager();

    // Save API key to secure encrypted storage
    if (apiKey) {
      credManager.setApiKey(apiKey);
      const status = credManager.getSecurityStatus();
      if (status.encryptionEnabled) {
        console.log("✅ API key saved securely (encrypted) to ~/.codebuddy/credentials.enc");
      } else {
        console.log("✅ API key saved to ~/.codebuddy/credentials.enc");
        console.log("⚠️ Consider enabling encryption for better security");
      }
    }

    // Save base URL to settings (not sensitive)
    if (baseURL) {
      settingsManager.updateUserSetting("baseURL", baseURL);
      console.log("✅ Base URL saved to ~/.codebuddy/user-settings.json");
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not save settings to file:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// Load model from detected provider or user settings
async function loadModel(): Promise<string | undefined> {
  await ensureEnvLoaded();

  // Check environment-detected provider first
  const detected = await getDetectedProvider();
  if (detected) return detected.defaultModel;

  // First check environment variables
  let model = process.env.GROK_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const getSettingsManager = await lazyImport.settingsManager();
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
    } catch (_err) {
      logger.debug('Failed to load model from settings manager', { error: _err });
    }
  }

  return model;
}

// Handle commit-and-push command in headless mode
async function handleCommitAndPushHeadless(
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number
): Promise<void> {
  try {
    const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
    const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const { ConfirmationService } = await import("./utils/confirmation-service.js");
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    console.log("🤖 Processing commit and push...\n");
    console.log("> /commit-and-push\n");

    // First check if there are any changes at all
    const initialStatusResult = await agent.executeBashCommand(
      "git status --porcelain"
    );

    if (!initialStatusResult.success || !initialStatusResult.output?.trim()) {
      console.log("❌ No changes to commit. Working directory is clean.");
      process.exit(1);
    }

    console.log("✅ git status: Changes detected");

    // Add all changes
    const addResult = await agent.executeBashCommand("git add .");

    if (!addResult.success) {
      console.log(
        `❌ git add: ${addResult.error || "Failed to stage changes"}`
      );
      process.exit(1);
    }

    console.log("✅ git add: Changes staged");

    // Get staged changes for commit message generation
    const diffResult = await agent.executeBashCommand("git diff --cached");

    // Generate commit message using AI
    const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || "No staged changes shown"}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

    console.log("🤖 Generating commit message...");

    const commitMessageEntries = await agent.processUserMessage(commitPrompt);
    let commitMessage = "";

    // Extract the commit message from the AI response
    for (const entry of commitMessageEntries) {
      if (entry.type === "assistant" && entry.content.trim()) {
        commitMessage = entry.content.trim();
        break;
      }
    }

    if (!commitMessage) {
      console.log("❌ Failed to generate commit message");
      process.exit(1);
    }

    // Clean the commit message
    const cleanCommitMessage = commitMessage.replace(/^["']|["']$/g, "");
    console.log(`✅ Generated commit message: "${cleanCommitMessage}"`);

    // Execute the commit
    const commitCommand = `git commit -m "${cleanCommitMessage}"`;
    const commitResult = await agent.executeBashCommand(commitCommand);

    if (commitResult.success) {
      console.log(
        `✅ git commit: ${
          commitResult.output?.split("\n")[0] || "Commit successful"
        }`
      );

      // If commit was successful, push to remote
      // First try regular push, if it fails try with upstream setup
      let pushResult = await agent.executeBashCommand("git push");

      if (
        !pushResult.success &&
        pushResult.error?.includes("no upstream branch")
      ) {
        console.log("🔄 Setting upstream and pushing...");
        pushResult = await agent.executeBashCommand("git push -u origin HEAD");
      }

      if (pushResult.success) {
        console.log(
          `✅ git push: ${
            pushResult.output?.split("\n")[0] || "Push successful"
          }`
        );
      } else {
        console.log(`❌ git push: ${pushResult.error || "Push failed"}`);
        process.exit(1);
      }
    } else {
      console.log(`❌ git commit: ${commitResult.error || "Commit failed"}`);
      process.exit(1);
    }
  } catch (error: unknown) {
    logger.error("Error during commit and push:", error as Error);
    process.exit(1);
  }
}

// Headless mode processing function
async function processPromptHeadless(
  prompt: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number,
  selfHealEnabled: boolean = true
): Promise<void> {
  try {
    const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
    const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure self-healing
    if (!selfHealEnabled) {
      agent.setSelfHealing(false);
    }

    // Configure confirmation service for headless mode (auto-approve all operations)
    const { ConfirmationService } = await import("./utils/confirmation-service.js");
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    // Convert chat entries to OpenAI compatible message objects
    const messages: ChatCompletionMessageParam[] = [];

    for (const entry of chatEntries) {
      switch (entry.type) {
        case "user":
          messages.push({
            role: "user",
            content: entry.content,
          });
          break;

        case "assistant":
          const assistantMessage: ChatCompletionMessageParam = {
            role: "assistant",
            content: entry.content,
          };

          // Add tool calls if present
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            assistantMessage.tool_calls = entry.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }));
          }

          messages.push(assistantMessage);
          break;

        case "tool_result":
          if (entry.toolCall) {
            messages.push({
              role: "tool",
              tool_call_id: entry.toolCall.id,
              content: entry.content,
            });
          }
          break;
      }
    }

    // Output each message as a separate JSON object
    for (const message of messages) {
      console.log(JSON.stringify(message));
    }
  } catch (error: unknown) {
    // Output error in OpenAI compatible format
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        role: "assistant",
        content: `Error: ${errorMessage}`,
      })
    );
    process.exit(1);
  }
}

program
  .name("codebuddy")
  .description(
    "A conversational AI CLI tool powered by AI with text editor capabilities"
  )
  .version("1.0.1")
  .argument("[message...]", "Initial message to send to Code Buddy")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "CodeBuddy API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "CodeBuddy API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "-p, --prompt <prompt>",
    "process a single prompt and exit (headless mode)"
  )
  .option(
    "-b, --browser",
    "launch browser UI instead of terminal interface"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .option(
    "-s, --security-mode <mode>",
    "security mode: suggest (default), auto-edit, or full-auto"
  )
  .option(
    "-o, --output-format <format>",
    "output format for headless mode: json, stream-json, text, markdown"
  )
  .option(
    "--init",
    "initialize .codebuddy directory with templates and exit"
  )
  .option(
    "--dry-run",
    "preview changes without applying them (simulation mode)"
  )
  .option(
    "-c, --context <patterns>",
    "load specific files into context using glob patterns (e.g., 'src/**/*.ts,!**/*.test.ts')"
  )
  .option(
    "--no-cache",
    "disable response caching"
  )
  .option(
    "--no-self-heal",
    "disable self-healing auto-correction"
  )
  .option(
    "--force-tools",
    "enable tools/function calling for local models (LM Studio)"
  )
  .option(
    "--probe-tools",
    "auto-detect tool support by testing the model at startup"
  )
  .option(
    "--plain",
    "use plain text output (minimal formatting)"
  )
  .option(
    "--no-color",
    "disable colored output"
  )
  .option(
    "--no-emoji",
    "disable emoji in output"
  )
  .option(
    "--list-models",
    "list available models from the API endpoint and exit"
  )
  .option(
    "--continue",
    "continue from the most recent saved session (like mistral-vibe)"
  )
  .option(
    "--resume <sessionId>",
    "resume a specific session by ID (supports partial matching)"
  )
  .option(
    "--max-price <dollars>",
    "maximum cost in dollars before stopping (like mistral-vibe)",
    "10.0"
  )
  .option(
    "--output <format>",
    "output format for headless mode: text, json, streaming (like mistral-vibe)",
    "json"
  )
  .option(
    "--auto-approve",
    "automatically approve all tool executions (like mistral-vibe)"
  )
  .option(
    "--system-prompt <id>",
    "system prompt to use: default, minimal, secure, code-reviewer, architect (or custom from ~/.codebuddy/prompts/)"
  )
  .option(
    "--list-prompts",
    "list available system prompts and exit"
  )
  .option(
    "--agent <name>",
    "use a custom agent configuration from ~/.codebuddy/agents/ (like mistral-vibe)"
  )
  .option(
    "--list-agents",
    "list available custom agents and exit"
  )
  .option(
    "--enabled-tools <patterns>",
    "only enable tools matching patterns (comma-separated, supports glob: bash,*file*,search)"
  )
  .option(
    "--disabled-tools <patterns>",
    "disable tools matching patterns (comma-separated, supports glob: bash,web_*)"
  )
  .option(
    "--setup",
    "run interactive setup wizard for API key and configuration"
  )
  .option(
    "--vim",
    "enable Vim keybindings for input"
  )
  .option(
    "--dangerously-skip-permissions",
    "bypass all permission checks (use in trusted containers without network access)"
  )
  .option(
    "--allowed-tools <patterns>",
    "only enable tools matching patterns (like Claude Code --allowedTools)"
  )
  .option(
    "--mcp-debug",
    "enable MCP debugging output"
  )
  .option(
    "--allow-outside",
    "allow file operations outside the workspace directory (disables workspace isolation)"
  )
  .action(async (message, options) => {
    // Handle --setup flag (interactive setup wizard)
    if (options.setup) {
      const { runSetup } = await import("./utils/interactive-setup.js");
      await runSetup();
      process.exit(0);
    }

    // Handle --init flag
    if (options.init) {
      const { initCodeBuddyProject, formatInitResult } = await lazyImport.initProject();
      const result = initCodeBuddyProject();
      console.log(formatInitResult(result));
      process.exit(result.success ? 0 : 1);
    }

    // Handle --list-models flag
    if (options.listModels) {
      const baseURL = options.baseUrl || await loadBaseURL();
      try {
        const response = await fetch(`${baseURL}/models`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };

        console.log("📋 Available models:\n");
        if (data.data && data.data.length > 0) {
          data.data.forEach((model: { id: string; owned_by?: string }) => {
            console.log(`  • ${model.id}`);
          });
          console.log(`\n  Total: ${data.data.length} model(s)`);
        } else {
          console.log("  (no models found)");
        }
        process.exit(0);
      } catch (error) {
        logger.error(`❌ Error fetching models from ${baseURL}/models:`);
        logger.error(`   ${error instanceof Error ? error.message : String(error)}`);
        logger.error("\n💡 Make sure the API server is running (LM Studio, Ollama, etc.)");
        process.exit(1);
      }
    }

    // Handle --list-prompts flag
    if (options.listPrompts) {
      const { getPromptManager } = await import("./prompts/prompt-manager.js");
      const promptManager = getPromptManager();
      const prompts = await promptManager.listPrompts();

      console.log("📋 Available system prompts:\n");
      console.log("  Built-in:");
      prompts.filter(p => p.source === 'builtin').forEach(p => {
        console.log(`    • ${p.id}`);
      });

      const userPrompts = prompts.filter(p => p.source === 'user');
      if (userPrompts.length > 0) {
        console.log("\n  User (~/.codebuddy/prompts/):");
        userPrompts.forEach(p => {
          console.log(`    • ${p.id}`);
        });
      }

      console.log("\n💡 Usage: codebuddy --system-prompt <id>");
      console.log("   Create custom prompts in ~/.codebuddy/prompts/<name>.md");
      process.exit(0);
    }

    // Handle --list-agents flag
    if (options.listAgents) {
      const { getCustomAgentLoader } = await import("./agent/custom/custom-agent-loader.js");
      const loader = getCustomAgentLoader();
      const agents = loader.listAgents();

      console.log("📋 Available custom agents:\n");

      if (agents.length === 0) {
        console.log("  (no custom agents found)");
        console.log("\n💡 Create agents in ~/.codebuddy/agents/");
        console.log("   Example: ~/.codebuddy/agents/_example.toml");
      } else {
        agents.forEach(agent => {
          const tags = agent.tags?.length ? ` [${agent.tags.join(', ')}]` : '';
          console.log(`  • ${agent.id}: ${agent.name}${tags}`);
          if (agent.description) {
            console.log(`      ${agent.description}`);
          }
        });
        console.log(`\n  Total: ${agents.length} agent(s)`);
      }

      console.log("\n💡 Usage: codebuddy --agent <id>");
      process.exit(0);
    }

    // Handle --continue flag (resume last session, like mistral-vibe)
    if (options.continue) {
      const { getSessionStore } = await import("./persistence/session-store.js");
      const sessionStore = getSessionStore();
      const lastSession = await sessionStore.getLastSession();

      if (!lastSession) {
        logger.error("❌ No sessions found. Start a new session first.");
        process.exit(1);
      }

      await sessionStore.resumeSession(lastSession.id);
      console.log(`📂 Resuming session: ${lastSession.name} (${lastSession.id.slice(0, 8)})`);
      console.log(`   ${lastSession.messages.length} messages, last accessed: ${lastSession.lastAccessedAt.toLocaleString()}\n`);
    }

    // Handle --resume flag (resume specific session by ID, like mistral-vibe)
    if (options.resume) {
      const { getSessionStore } = await import("./persistence/session-store.js");
      const sessionStore = getSessionStore();
      const session = await sessionStore.getSessionByPartialId(options.resume);

      if (!session) {
        logger.error(`❌ Session not found: ${options.resume}`);
        console.log("\n📋 Recent sessions:");
        const recent = await sessionStore.getRecentSessions(5);
        recent.forEach(s => {
          console.log(`   ${s.id.slice(0, 8)} - ${s.name} (${s.messages.length} messages)`);
        });
        process.exit(1);
      }

      await sessionStore.resumeSession(session.id);
      console.log(`📂 Resuming session: ${session.name} (${session.id.slice(0, 8)})`);
      console.log(`   ${session.messages.length} messages, last accessed: ${session.lastAccessedAt.toLocaleString()}\n`);
    }

    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: unknown) {
        logger.error(
          `Error changing directory to ${options.directory}:`,
          error as Error
        );
        process.exit(1);
      }
    }

    // Initialize workspace isolation
    const { initializeWorkspaceIsolation } = await import("./workspace/workspace-isolation.js");
    const _workspaceIsolation = initializeWorkspaceIsolation({
      allowOutside: options.allowOutside,
      directory: process.cwd(),
    });

    if (options.allowOutside) {
      console.log("Warning: Workspace isolation DISABLED - file access is unrestricted");
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || await loadApiKey();
      const baseURL = options.baseUrl || await loadBaseURL();
      let model = options.model || await loadModel();  // let: can be overridden by --agent
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        logger.error(
          "❌ Error: API key required. Set GOOGLE_API_KEY, GROK_API_KEY, or OPENAI_API_KEY environment variable, use --api-key flag, or save to ~/.codebuddy/user-settings.json"
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      // Enable force-tools mode for local models
      if (options.forceTools) {
        process.env.GROK_FORCE_TOOLS = 'true';
        console.log("🔧 Force tools: ENABLED (function calling for local models)");
      }

      // Handle auto-approve mode (like mistral-vibe)
      if (options.autoApprove) {
        const { ConfirmationService } = await import("./utils/confirmation-service.js");
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setSessionFlag("allOperations", true);
        console.log("✅ Auto-approve: ENABLED (all tool executions will be approved)");
      }

      // Handle --dangerously-skip-permissions (like Claude Code)
      if (options.dangerouslySkipPermissions) {
        const { ConfirmationService } = await import("./utils/confirmation-service.js");
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setSessionFlag("allOperations", true);
        confirmationService.setSessionFlag("fileOperations", true);
        confirmationService.setSessionFlag("bashCommands", true);
        process.env.GROK_SKIP_PERMISSIONS = 'true';
        console.log("⚠️  DANGEROUS: All permission checks BYPASSED");
        console.log("   Only use this in trusted containers without network access!");
      }

      // Handle --allowed-tools (like Claude Code --allowedTools)
      if (options.allowedTools) {
        const { setToolFilter, createToolFilter } = await import("./utils/tool-filter.js");
        setToolFilter(createToolFilter({
          enabledTools: options.allowedTools,
        }));
        console.log(`🔧 Allowed tools: ${options.allowedTools}`);
      }

      // Handle --mcp-debug
      if (options.mcpDebug) {
        process.env.MCP_DEBUG = 'true';
        console.log("🔍 MCP debug: ENABLED");
      }

      // Set max-price for cost limit (like mistral-vibe)
      const maxPrice = parseFloat(options.maxPrice) || 10.0;
      process.env.MAX_COST = maxPrice.toString();

      // Handle tool filtering (like mistral-vibe --enabled-tools)
      if (options.enabledTools || options.disabledTools) {
        const { setToolFilter, createToolFilter, formatFilterResult, filterTools } = await import("./utils/tool-filter.js");
        const { getAllCodeBuddyTools } = await import("./codebuddy/tools.js");

        const filter = createToolFilter({
          enabledTools: options.enabledTools,
          disabledTools: options.disabledTools,
        });
        setToolFilter(filter);

        // Use getAllCodeBuddyTools() instead of deprecated CODEBUDDY_TOOLS array
        const allTools = await getAllCodeBuddyTools();
        const result = filterTools(allTools, filter);
        console.log(formatFilterResult(result));
      }

      // Handle vim mode
      if (options.vim) {
        process.env.GROK_VIM_MODE = 'true';
        console.log("Vim mode: ENABLED");
      }

      // Check for piped input (like mistral-vibe: cat file.txt | grok)
      let pipedInput = '';
      if (!process.stdin.isTTY) {
        // Reading from stdin (pipe or redirect)
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        pipedInput = Buffer.concat(chunks).toString('utf-8').trim();
      }

      // Combine piped input with any CLI prompt or message args
      const combinedPrompt = [
        options.prompt,
        message?.join(' '),
        pipedInput
      ].filter(Boolean).join('\n\n');

      // Headless mode: process prompt and exit (if prompt, message, or piped input provided)
      if (combinedPrompt && (options.prompt || pipedInput)) {
        await processPromptHeadless(
          combinedPrompt,
          apiKey,
          baseURL,
          model,
          maxToolRounds,
          options.selfHeal !== false
        );
        return;
      }

      // Initialize rendering system (lazy load)
      const { initializeRenderers, configureRenderContext } = await lazyImport.renderers();
      initializeRenderers();
      configureRenderContext({
        plain: options.plain,
        noColor: options.color === false,
        noEmoji: options.emoji === false,
      });

      // Interactive mode: launch UI (lazy load heavy modules)
      const CodeBuddyAgent = await lazyImport.CodeBuddyAgent();
      let systemPromptId = options.systemPrompt;  // New: external prompt support
      let customAgentConfig = null;

      // Handle --agent flag: load custom agent configuration
      if (options.agent) {
        const { getCustomAgentLoader } = await import("./agent/custom/custom-agent-loader.js");
        const loader = getCustomAgentLoader();
        const agentConfig = loader.getAgent(options.agent);

        if (!agentConfig) {
          logger.error(`❌ Agent not found: ${options.agent}`);
          const agents = loader.listAgents();
          if (agents.length > 0) {
            console.log("\n📋 Available agents:");
            agents.forEach(a => console.log(`   • ${a.id}`));
          }
          process.exit(1);
        }

        customAgentConfig = agentConfig;
        console.log(`🤖 Using agent: ${agentConfig.name}`);

        // Override model if specified in agent config
        if (agentConfig.model) {
          model = agentConfig.model;
        }
      }

      const agent = new CodeBuddyAgent(apiKey, baseURL, model, maxToolRounds, true, systemPromptId);

      // Apply custom agent system prompt if configured
      if (customAgentConfig?.systemPrompt) {
        agent.setSystemPrompt(customAgentConfig.systemPrompt);
      }

      // Probe for tool support if requested
      if (options.probeTools) {
        console.log("🔍 Probing model for tool support...");
        const hasToolSupport = await agent.probeToolSupport();
        if (!hasToolSupport) {
          console.log("ℹ️ Tool support: NOT DETECTED (switching to chat-only mode)");
          agent.switchToChatOnlyMode();
        }
      }

      // Configure security mode if specified
      if (options.securityMode) {
        const validModes: SecurityMode[] = ["suggest", "auto-edit", "full-auto"];
        if (validModes.includes(options.securityMode)) {
          const { getSecurityModeManager } = await lazyImport.securityModes();
          const securityManager = getSecurityModeManager();
          securityManager.setMode(options.securityMode);
          console.log(`🛡️ Security mode: ${options.securityMode.toUpperCase()}`);
        } else {
          console.warn(`⚠️ Invalid security mode: ${options.securityMode}. Using default (suggest).`);
        }
      }

      // Configure dry-run mode
      if (options.dryRun) {
        const { ConfirmationService } = await import("./utils/confirmation-service.js");
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setDryRunMode(true);
        console.log("🔍 Dry-run mode: ENABLED (changes will be previewed, not applied)");
      }

      // Load context files if specified
      if (options.context) {
        const { ContextLoader, getContextLoader } = await lazyImport.contextLoader();
        const { include, exclude } = ContextLoader.parsePatternString(options.context);
        const contextLoader = getContextLoader(process.cwd(), {
          patterns: include,
          excludePatterns: exclude,
          respectGitignore: true,
        });
        const files = await contextLoader.loadFiles();
        if (files.length > 0) {
          console.log(contextLoader.getSummary(files));
        }
      }

      // Configure caching and performance
      recordStartupPhase('perf-init-start');
      if (options.cache === false) {
        console.log("📦 Response cache: DISABLED");
        // Disable performance caching when cache is disabled
        const { getPerformanceManager } = await lazyImport.performance();
        getPerformanceManager({ enabled: false });
      } else {
        // Initialize performance optimizations (lazy loading, tool caching, request optimization)
        const { initializePerformanceManager } = await lazyImport.performance();
        await initializePerformanceManager();
      }
      recordStartupPhase('perf-init-done');

      // Configure self-healing
      if (options.selfHeal === false) {
        agent.setSelfHealing(false);
        console.log("🔧 Self-healing: DISABLED");
      }

      // Initialize Plugin System
      try {
        const { getPluginManager } = await lazyImport.pluginManager();
        const pluginManager = getPluginManager();
        await pluginManager.discover();
      } catch (error) {
        logger.warn("Failed to initialize plugin system:", { error: String(error) });
      }

      console.log("🤖 Starting Code Buddy Conversational Assistant...\n");

      await ensureUserSettingsDirectory();

      // Support variadic positional arguments for multi-word initial message
      const initialMessage = Array.isArray(message)
        ? message.join(" ")
        : message;

      // Lazy load React and Ink for UI
      recordStartupPhase('ui-load-start');
      const React = await lazyImport.React();
      const { render } = await lazyImport.ink();
      const ChatInterface = await lazyImport.ChatInterface();

      // Log startup metrics before UI render
      recordStartupPhase('ui-render');
      logStartupMetrics();

      render(React.createElement(ChatInterface, { agent, initialMessage }));

      // Check for updates in background after UI renders
      setImmediate(async () => {
        try {
          const { getUpdateNotifier } = await import('./utils/update-notifier.js');
          await getUpdateNotifier().checkAndNotify();
        } catch (_err) {
          // Update check should never break the CLI
        }
      });

      // Start background preloading of common modules after UI renders
      setImmediate(async () => {
        try {
          const { initializeCLILazyLoader } = await lazyImport.lazyLoader();
          initializeCLILazyLoader();
        } catch (_err) {
          logger.debug('Failed to preload CLI lazy loader', { error: _err });
        }
      });
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Error initializing Code Buddy:", errorObj);
      process.exit(1);
    }
  });

// Git subcommand
const gitCommand = program
  .command("git")
  .description("Git operations with AI assistance");

gitCommand
  .command("commit-and-push")
  .description("Generate AI commit message and push to remote")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "CodeBuddy API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "CodeBuddy API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: unknown) {
        logger.error(
          `Error changing directory to ${options.directory}:`,
          error as Error
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || await loadApiKey();
      const baseURL = options.baseUrl || await loadBaseURL();
      const model = options.model || await loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        logger.error(
          "❌ Error: API key required. Set GOOGLE_API_KEY, GROK_API_KEY, or OPENAI_API_KEY environment variable, use --api-key flag, or save to ~/.codebuddy/user-settings.json"
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      await handleCommitAndPushHeadless(apiKey, baseURL, model, maxToolRounds);
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Error during git commit-and-push:", errorObj);
      process.exit(1);
    }
  });

// Provider command - manage AI providers (Claude, ChatGPT, Grok, Gemini)
program
  .command("provider")
  .description("Manage AI providers (Claude, ChatGPT, Grok, Gemini)")
  .allowUnknownOption()
  .action(async (_options, _command) => {
    // Lazy load the provider command implementation
    const { createProviderCommand } = await import("./commands/provider.js");
    const providerCmd = createProviderCommand();

    // Replace stub with real command and re-run
    const args = process.argv.slice(2);
    providerCmd.parse(args, { from: 'user' });
  });

// MCP command - stub for help, lazy load actual implementation
program
  .command("mcp")
  .description("Manage MCP (Model Context Protocol) servers")
  .allowUnknownOption()
  .action(async (_options, _command) => {
    // Lazy load the full MCP command implementation
    const { createMCPCommand } = await import("./commands/mcp.js");
    const mcpCmd = createMCPCommand();

    // Replace stub with real command and re-run
    const args = process.argv.slice(2);
    mcpCmd.parse(args, { from: 'user' });
  });

// Pipeline command - stub for help, lazy load actual implementation
program
  .command("pipeline")
  .description("Manage and run pipeline workflows")
  .allowUnknownOption()
  .action(async (_options, _command) => {
    // Lazy load the full pipeline command implementation
    const { createPipelineCommand } = await import("./commands/pipeline.js");
    const pipelineCmd = createPipelineCommand();

    // Replace stub with real command and re-run
    const args = process.argv.slice(2);
    pipelineCmd.parse(args, { from: 'user' });
  });

// Daemon command - manage background daemon process
const daemonCommand = program
  .command("daemon")
  .description("Manage the Code Buddy daemon (background process)");

daemonCommand
  .command("start")
  .description("Start the daemon")
  .option("--detach", "run daemon in background", true)
  .option("--port <port>", "server port", "3000")
  .action(async (options) => {
    const { getDaemonManager } = await import("./daemon/index.js");
    const manager = getDaemonManager({ port: parseInt(options.port) });
    try {
      await manager.start(options.detach);
      const status = await manager.status();
      console.log(`Daemon started (PID: ${status.pid})`);
    } catch (error) {
      console.error(`Failed to start daemon: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

daemonCommand
  .command("stop")
  .description("Stop the daemon")
  .action(async () => {
    const { getDaemonManager } = await import("./daemon/index.js");
    const manager = getDaemonManager();
    try {
      await manager.stop();
      console.log("Daemon stopped");
    } catch (error) {
      console.error(`Failed to stop daemon: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

daemonCommand
  .command("restart")
  .description("Restart the daemon")
  .action(async () => {
    const { getDaemonManager } = await import("./daemon/index.js");
    const manager = getDaemonManager();
    try {
      await manager.restart();
      console.log("Daemon restarted");
    } catch (error) {
      console.error(`Failed to restart daemon: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

daemonCommand
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    const { getDaemonManager } = await import("./daemon/index.js");
    const manager = getDaemonManager();
    const status = await manager.status();
    if (status.running) {
      console.log(`Daemon: RUNNING (PID: ${status.pid})`);
      if (status.uptime) {
        console.log(`Uptime: ${Math.round(status.uptime / 1000)}s`);
      }
      if (status.services.length > 0) {
        console.log("Services:");
        for (const svc of status.services) {
          console.log(`  ${svc.running ? "+" : "-"} ${svc.name}`);
        }
      }
    } else {
      console.log("Daemon: STOPPED");
    }
  });

daemonCommand
  .command("logs")
  .description("Show daemon logs")
  .option("-n, --lines <count>", "number of lines", "50")
  .action(async (options) => {
    const { getDaemonManager } = await import("./daemon/index.js");
    const manager = getDaemonManager();
    const logs = await manager.logs(parseInt(options.lines));
    console.log(logs);
  });

// Trigger command - manage event triggers
const triggerCommand = program
  .command("trigger")
  .description("Manage event triggers for automated agent responses");

triggerCommand
  .command("list")
  .description("List all triggers")
  .action(async () => {
    const { getEventTriggerManager } = await import("./agent/observer/index.js");
    const { TriggerRegistry } = await import("./agent/observer/trigger-registry.js");
    const manager = getEventTriggerManager();
    const registry = new TriggerRegistry(manager);
    await registry.load();
    const triggers = manager.listTriggers();
    if (triggers.length === 0) {
      console.log("No triggers configured.");
      console.log("Use 'codebuddy trigger add' to create one.");
    } else {
      for (const t of triggers) {
        const status = t.enabled ? "+" : "-";
        console.log(`  ${status} [${t.id.slice(0, 8)}] ${t.name} (${t.type}: ${t.condition})`);
      }
    }
  });

triggerCommand
  .command("add <spec>")
  .description("Add a trigger (format: type:condition action:target)")
  .action(async (spec: string) => {
    const { getEventTriggerManager } = await import("./agent/observer/index.js");
    const { TriggerRegistry } = await import("./agent/observer/trigger-registry.js");
    const manager = getEventTriggerManager();
    const registry = new TriggerRegistry(manager);
    await registry.load();

    // Parse spec: "file_change:src/**/*.ts" "notify:cli"
    const parts = spec.split(/\s+/);
    const [typeCondition, actionTarget] = parts;
    const [type, ...condParts] = (typeCondition || '').split(':');
    const condition = condParts.join(':') || '*';
    const [actionType, target] = (actionTarget || 'notify:cli').split(':');

    const trigger = await registry.create({
      name: `${type} trigger`,
      type: type as 'file_change' | 'screen_change' | 'time' | 'webhook',
      condition,
      action: { type: (actionType || 'notify') as 'notify' | 'execute' | 'agent_message', target: target || 'cli' },
    });
    console.log(`Trigger created: ${trigger.id.slice(0, 8)} (${trigger.type}: ${trigger.condition})`);
  });

triggerCommand
  .command("remove <id>")
  .description("Remove a trigger by ID")
  .action(async (id: string) => {
    const { getEventTriggerManager } = await import("./agent/observer/index.js");
    const { TriggerRegistry } = await import("./agent/observer/trigger-registry.js");
    const manager = getEventTriggerManager();
    const registry = new TriggerRegistry(manager);
    await registry.load();

    // Support partial ID matching
    const triggers = manager.listTriggers();
    const match = triggers.find(t => t.id.startsWith(id));
    if (match) {
      await registry.delete(match.id);
      console.log(`Trigger removed: ${match.id.slice(0, 8)}`);
    } else {
      console.error(`Trigger not found: ${id}`);
      process.exit(1);
    }
  });

// ============================================================================
// Speak Command
// ============================================================================

const speakCommand = program
  .command("speak [text...]")
  .description("Synthesize speech using AudioReader TTS")
  .option("--voice <voice>", "Voice ID to use (e.g., af_bella, ff_siwis)")
  .option("--list-voices", "List available voices")
  .option("--speed <speed>", "Speaking speed (0.25-4.0)", "1.0")
  .option("--format <format>", "Output format (wav, mp3)", "wav")
  .option("--url <url>", "AudioReader API URL", "http://localhost:8000")
  .action(async (textParts: string[], opts: { voice?: string; listVoices?: boolean; speed: string; format: string; url: string }) => {
    const { AudioReaderTTSProvider } = await import("./talk-mode/providers/audioreader-tts.js");
    const provider = new AudioReaderTTSProvider();
    await provider.initialize({
      provider: 'audioreader',
      enabled: true,
      priority: 1,
      settings: {
        baseURL: opts.url,
        defaultVoice: opts.voice,
        speed: parseFloat(opts.speed),
        format: opts.format,
      },
    });

    const available = await provider.isAvailable();
    if (!available) {
      console.error("AudioReader is not running at " + opts.url);
      console.error("Start it with: cd ~/claude/AudioReader && python main.py");
      process.exit(1);
    }

    if (opts.listVoices) {
      const voices = await provider.listVoices();
      console.log("Available voices:\n");
      for (const v of voices) {
        const marker = v.isDefault ? " (default)" : "";
        console.log(`  ${v.providerId.padEnd(14)} ${v.name.padEnd(10)} ${v.language}  ${v.gender}${marker}`);
      }
      return;
    }

    const text = textParts.join(" ");
    if (!text) {
      console.error("No text provided. Usage: buddy speak \"Hello world\"");
      process.exit(1);
    }

    const result = await provider.synthesize(text, {
      voice: opts.voice,
      rate: parseFloat(opts.speed),
      format: opts.format as 'wav' | 'mp3',
    });

    // Write audio to stdout for piping, or play directly
    const { execSync } = await import("child_process");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tmpFile = join(tmpdir(), `codebuddy-speak-${Date.now()}.${result.format}`);
    writeFileSync(tmpFile, result.audio);

    try {
      // Try common audio players
      const players = process.platform === 'darwin'
        ? ['afplay']
        : ['aplay', 'paplay', 'play', 'mpv', 'ffplay'];

      let played = false;
      for (const player of players) {
        try {
          const args = player === 'ffplay' ? '-nodisp -autoexit' : '';
          execSync(`${player} ${args} "${tmpFile}"`, { stdio: 'inherit' });
          played = true;
          break;
        } catch {
          continue;
        }
      }

      if (!played) {
        console.log(`Audio saved to: ${tmpFile}`);
        console.error("No audio player found. Install aplay, mpv, or ffplay.");
        return;
      }
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

// Doctor command - diagnose environment and dependencies
program
  .command('doctor')
  .description('Diagnose Code Buddy environment, dependencies, and configuration')
  .option('-v, --verbose', 'Show all checks including passing ones')
  .action(async (options: { verbose?: boolean }) => {
    const { runDoctorChecks } = await import('./doctor/index.js');
    const checks = await runDoctorChecks(process.cwd());

    console.log('\n🔍 Code Buddy Doctor\n');

    const icons = { ok: '✅', warn: '⚠️', error: '❌' };

    for (const check of checks) {
      if (options.verbose || check.status !== 'ok') {
        console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
      }
    }

    const errors = checks.filter(c => c.status === 'error').length;
    const warns = checks.filter(c => c.status === 'warn').length;
    const oks = checks.filter(c => c.status === 'ok').length;

    console.log(`\n  Summary: ${oks} passed, ${warns} warnings, ${errors} errors\n`);

    if (errors > 0) process.exit(1);
  });

// Onboard command - interactive setup wizard
program
  .command('onboard')
  .description('Interactive setup wizard for Code Buddy')
  .action(async () => {
    const { runOnboarding } = await import('./wizard/onboarding.js');
    await runOnboarding();
  });

// Webhook command
const webhookCommand = program
  .command('webhook')
  .description('Manage webhook triggers');

webhookCommand
  .command('list')
  .description('List registered webhooks')
  .action(async () => {
    const { WebhookManager } = await import('./webhooks/webhook-manager.js');
    const mgr = new WebhookManager();
    const hooks = mgr.list();
    if (hooks.length === 0) {
      console.log('No webhooks registered.');
      return;
    }
    console.log('\nRegistered webhooks:\n');
    for (const h of hooks) {
      const status = h.enabled ? 'ON' : 'OFF';
      console.log(`  [${status}] ${h.name} (${h.id})`);
      console.log(`     Message: ${h.agentMessage}`);
      console.log(`     Secret: ${h.secret ? 'yes' : 'no'}\n`);
    }
  });

webhookCommand
  .command('add <name> <message>')
  .description('Register a new webhook')
  .option('-s, --secret <secret>', 'HMAC secret for signature verification')
  .action(async (name: string, message: string, opts: { secret?: string }) => {
    const { WebhookManager } = await import('./webhooks/webhook-manager.js');
    const mgr = new WebhookManager();
    const hook = mgr.register(name, message, opts.secret);
    console.log(`\nWebhook registered: ${hook.id}`);
    console.log(`Trigger URL: POST /api/webhooks/${hook.id}/trigger\n`);
  });

webhookCommand
  .command('remove <id>')
  .description('Remove a webhook')
  .action(async (id: string) => {
    const { WebhookManager } = await import('./webhooks/webhook-manager.js');
    const mgr = new WebhookManager();
    if (mgr.remove(id)) {
      console.log('Webhook removed.');
    } else {
      console.log('Webhook not found.');
    }
  });

program.parse();
