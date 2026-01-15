#!/usr/bin/env node
import { program } from "commander";
import * as dotenv from "dotenv";
import { getSettingsManager } from "./utils/settings-manager.js";
import { getCredentialManager } from "./security/credential-manager.js";
import { logger } from "./utils/logger.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

// Types for dynamically imported modules
import type { SecurityMode } from "./security/security-modes.js";

// Lazy imports for heavy modules - only loaded when needed
const lazyImport = {
  React: () => import("react"),
  ink: () => import("ink"),
  CodeBuddyAgent: () => import("./agent/codebuddy-agent.js").then(m => m.CodeBuddyAgent),
  ChatInterface: () => import("./ui/components/ChatInterface.js").then(m => m.default),
  ConfirmationService: () => import("./utils/confirmation-service.js").then(m => m.ConfirmationService),
  createMCPCommand: () => import("./commands/mcp.js").then(m => m.createMCPCommand),
  initProject: () => import("./utils/init-project.js"),
  securityModes: () => import("./security/security-modes.js"),
  contextLoader: () => import("./context/context-loader.js"),
  renderers: () => import("./renderers/index.js"),
  performance: () => import("./performance/index.js"),
};

// Load environment variables
dotenv.config();

// Disable default SIGINT handling to let Ink handle Ctrl+C
// We'll handle exit through the input system instead

// Import crash handler
import { getCrashHandler } from './errors/crash-handler.js';
import { disposeAll } from './utils/disposable.js';
const crashHandler = getCrashHandler();
crashHandler.initialize();

process.on("SIGTERM", async () => {
  crashHandler.restoreTerminal();
  console.log("\nGracefully shutting down...");
  await disposeAll();
  process.exit(0);
});

process.on("SIGINT", async () => {
  crashHandler.restoreTerminal();
  await disposeAll();
  process.exit(0);
});

// Handle uncaught exceptions with crash recovery
process.on("uncaughtException", (error) => {
  const crashFile = crashHandler.handleCrash(error, "Uncaught exception");
  console.error("\nUnexpected error occurred:", error.message);
  if (crashFile) {
    console.error(`\nCrash context saved to: ${crashFile}`);
    console.error("You can resume your session with: grok --resume");
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason, _promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const crashFile = crashHandler.handleCrash(error, "Unhandled rejection");
  console.error("\nUnhandled promise rejection:", error.message);
  if (crashFile) {
    console.error(`\nCrash context saved to: ${crashFile}`);
    console.error("You can resume your session with: grok --resume");
  }
  process.exit(1);
});

// Ensure user settings are initialized
function ensureUserSettingsDirectory(): void {
  try {
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch (_error) {
    // Silently ignore errors during setup
  }
}

// Load API key from environment, secure storage, or legacy settings
function loadApiKey(): string | undefined {
  // Priority: environment > secure credential storage > legacy settings file
  const credManager = getCredentialManager();
  const apiKey = credManager.getApiKey();

  if (apiKey) {
    return apiKey;
  }

  // Fall back to legacy settings manager
  const settingsManager = getSettingsManager();
  return settingsManager.getApiKey();
}

// Load base URL from user settings if not in environment
function loadBaseURL(): string {
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line settings to user settings file
async function saveCommandLineSettings(
  apiKey?: string,
  baseURL?: string
): Promise<void> {
  try {
    const settingsManager = getSettingsManager();
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

// Load model from user settings if not in environment
function loadModel(): string | undefined {
  // First check environment variables
  let model = process.env.GROK_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
    } catch (_error) {
      // Ignore errors, model will remain undefined
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Error during commit and push:", errorMessage);
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
      const baseURL = options.baseUrl || loadBaseURL();
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
        console.error(`❌ Error fetching models from ${baseURL}/models:`);
        console.error(`   ${error instanceof Error ? error.message : String(error)}`);
        console.error("\n💡 Make sure the API server is running (LM Studio, Ollama, etc.)");
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
      const lastSession = sessionStore.getLastSession();

      if (!lastSession) {
        console.error("❌ No sessions found. Start a new session first.");
        process.exit(1);
      }

      sessionStore.resumeSession(lastSession.id);
      console.log(`📂 Resuming session: ${lastSession.name} (${lastSession.id.slice(0, 8)})`);
      console.log(`   ${lastSession.messages.length} messages, last accessed: ${lastSession.lastAccessedAt.toLocaleString()}\n`);
    }

    // Handle --resume flag (resume specific session by ID, like mistral-vibe)
    if (options.resume) {
      const { getSessionStore } = await import("./persistence/session-store.js");
      const sessionStore = getSessionStore();
      const session = sessionStore.getSessionByPartialId(options.resume);

      if (!session) {
        console.error(`❌ Session not found: ${options.resume}`);
        console.log("\n📋 Recent sessions:");
        const recent = sessionStore.getRecentSessions(5);
        recent.forEach(s => {
          console.log(`   ${s.id.slice(0, 8)} - ${s.name} (${s.messages.length} messages)`);
        });
        process.exit(1);
      }

      sessionStore.resumeSession(session.id);
      console.log(`📂 Resuming session: ${session.name} (${session.id.slice(0, 8)})`);
      console.log(`   ${session.messages.length} messages, last accessed: ${session.lastAccessedAt.toLocaleString()}\n`);
    }

    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(
          `Error changing directory to ${options.directory}:`,
          errorMessage
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || loadApiKey();
      const baseURL = options.baseUrl || loadBaseURL();
      let model = options.model || loadModel();  // let: can be overridden by --agent
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        console.error(
          "❌ Error: API key required. Set GROK_API_KEY environment variable, use --api-key flag, or save to ~/.codebuddy/user-settings.json"
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
        const { CODEBUDDY_TOOLS } = await import("./codebuddy/tools.js");

        const filter = createToolFilter({
          enabledTools: options.enabledTools,
          disabledTools: options.disabledTools,
        });
        setToolFilter(filter);

        const result = filterTools(CODEBUDDY_TOOLS, filter);
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
          console.error(`❌ Agent not found: ${options.agent}`);
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

      // Configure self-healing
      if (options.selfHeal === false) {
        agent.setSelfHealing(false);
        console.log("🔧 Self-healing: DISABLED");
      }

      console.log("🤖 Starting Code Buddy Conversational Assistant...\n");

      ensureUserSettingsDirectory();

      // Support variadic positional arguments for multi-word initial message
      const initialMessage = Array.isArray(message)
        ? message.join(" ")
        : message;

      // Lazy load React and Ink for UI
      const React = await lazyImport.React();
      const { render } = await lazyImport.ink();
      const ChatInterface = await lazyImport.ChatInterface();
      render(React.createElement(ChatInterface, { agent, initialMessage }));
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(
          `Error changing directory to ${options.directory}:`,
          errorMessage
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || loadApiKey();
      const baseURL = options.baseUrl || loadBaseURL();
      const model = options.model || loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        console.error(
          "❌ Error: API key required. Set GROK_API_KEY environment variable, use --api-key flag, or save to ~/.codebuddy/user-settings.json"
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

program.parse();
