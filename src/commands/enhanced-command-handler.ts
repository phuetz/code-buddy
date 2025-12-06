import { ChatEntry } from "../agent/grok-agent.js";
import { getAutonomyManager, AutonomyLevel } from "../utils/autonomy-manager.js";
import { AITestRunner, createAITestRunner } from "../testing/ai-integration-tests.js";
import { GrokClient } from "../grok/client.js";
import { getSlashCommandManager } from "./slash-commands.js";
import stringWidth from "string-width";
import { getMemoryManager } from "../memory/persistent-memory.js";
import { getSkillManager } from "../skills/skill-manager.js";
import { getCostTracker } from "../utils/cost-tracker.js";
import { getWorkspaceDetector } from "../utils/workspace-detector.js";
import { getBranchManager } from "../persistence/conversation-branches.js";
import { getCommentWatcher } from "../tools/comment-watcher.js";
import { getResponseCache } from "../utils/response-cache.js";
import { getContextLoader, ContextLoader } from "../context/context-loader.js";
import { getConversationExporter } from "../utils/conversation-export.js";
import { getSelfHealingEngine } from "../utils/self-healing.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { getThemeManager } from "../themes/theme-manager.js";
import { getVoiceInputManager } from "../input/voice-input-enhanced.js";
import { getTTSManager } from "../input/text-to-speech.js";
import { getPerformanceManager } from "../performance/index.js";
import { getSecurityManager, ApprovalMode } from "../security/index.js";
import { getCodeGuardianAgent, CodeGuardianMode } from "../agent/specialized/code-guardian-agent.js";

/**
 * Enhanced Command Handler - Processes special command tokens
 * Returns the chat entry to display, or null if command should be passed to AI
 */
export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

export class EnhancedCommandHandler {
  private conversationHistory: ChatEntry[] = [];
  private grokClient: GrokClient | null = null;

  setConversationHistory(history: ChatEntry[]): void {
    this.conversationHistory = history;
  }

  setGrokClient(client: GrokClient): void {
    this.grokClient = client;
  }

  /**
   * Handle a special command token
   */
  async handleCommand(
    token: string,
    args: string[],
    _fullInput: string
  ): Promise<CommandHandlerResult> {
    switch (token) {
      case "__YOLO_MODE__":
        return this.handleYoloMode(args);

      case "__PIPELINE__":
        return this.handlePipeline(args);

      case "__SKILL__":
        return this.handleSkill(args);

      case "__COST__":
        return this.handleCost(args);

      case "__STATS__":
        return this.handleStats(args);

      case "__SECURITY__":
        return this.handleSecurity(args);

      case "__FORK__":
        return this.handleFork(args);

      case "__BRANCHES__":
        return this.handleBranches();

      case "__CHECKOUT__":
        return this.handleCheckout(args);

      case "__MERGE__":
        return this.handleMerge(args);

      case "__SCAN_TODOS__":
        return this.handleScanTodos();

      case "__ADDRESS_TODO__":
        return this.handleAddressTodo(args);

      case "__MEMORY__":
        return this.handleMemory(args);

      case "__REMEMBER__":
        return this.handleRemember(args);

      case "__WORKSPACE__":
        return this.handleWorkspace();

      case "__PARALLEL__":
        return this.handleParallel(args);

      case "__MODEL_ROUTER__":
        return this.handleModelRouter(args);

      case "__GENERATE_TESTS__":
        return this.handleGenerateTests(args);

      case "__AUTONOMY__":
        return this.handleAutonomy(args);

      case "__ADD_CONTEXT__":
        return this.handleAddContext(args);

      case "__SAVE_CONVERSATION__":
        return this.handleSaveConversation(args);

      case "__CACHE__":
        return this.handleCache(args);

      case "__SELF_HEALING__":
        return this.handleSelfHealing(args);

      case "__CONTEXT__":
        return this.handleContext(args);

      case "__DRY_RUN__":
        return this.handleDryRun(args);

      case "__THEME__":
        return this.handleTheme(args);

      case "__AVATAR__":
        return this.handleAvatar(args);

      case "__VOICE__":
        return this.handleVoice(args);

      case "__SPEAK__":
        return this.handleSpeak(args);

      case "__TTS__":
        return this.handleTTS(args);

      case "__AI_TEST__":
        return this.handleAITest(args);

      case "__HELP__":
        return this.handleHelp();

      case "__GUARDIAN__":
        return this.handleGuardian(args);

      default:
        return { handled: false };
    }
  }

  /**
   * Help - Show available commands (dynamically from SlashCommandManager)
   */
  private async handleHelp(): Promise<CommandHandlerResult> {
    const slashManager = getSlashCommandManager();
    const allCommands = slashManager.getAllCommands();

    // Group commands by category
    const categories: Record<string, typeof allCommands> = {
      'Core': [],
      'Code & Development': [],
      'Git & Version Control': [],
      'Context & Memory': [],
      'Session & Export': [],
      'Settings & UI': [],
      'Advanced': [],
    };

    // Categorize commands
    for (const cmd of allCommands) {
      const name = cmd.name.toLowerCase();
      if (['help', 'clear', 'exit', 'model', 'mode'].includes(name)) {
        categories['Core'].push(cmd);
      } else if (['review', 'test', 'lint', 'explain', 'refactor', 'debug', 'docs', 'generate-tests', 'ai-test', 'guardian'].includes(name)) {
        categories['Code & Development'].push(cmd);
      } else if (['commit', 'checkpoints', 'restore', 'undo', 'diff', 'branches', 'fork', 'checkout', 'merge'].includes(name)) {
        categories['Git & Version Control'].push(cmd);
      } else if (['memory', 'remember', 'context', 'add', 'workspace', 'scan-todos', 'address-todo'].includes(name)) {
        categories['Context & Memory'].push(cmd);
      } else if (['save', 'export', 'cache', 'cost'].includes(name)) {
        categories['Session & Export'].push(cmd);
      } else if (['theme', 'avatar', 'voice', 'speak', 'tts', 'security', 'autonomy', 'dry-run'].includes(name)) {
        categories['Settings & UI'].push(cmd);
      } else {
        categories['Advanced'].push(cmd);
      }
    }

    // Build help text
    const lines: string[] = [];
    lines.push('╔══════════════════════════════════════════════════════════════════╗');
    lines.push('║                      📚 GROK CLI COMMANDS                        ║');
    lines.push('╚══════════════════════════════════════════════════════════════════╝');
    lines.push('');

    for (const [category, cmds] of Object.entries(categories)) {
      if (cmds.length === 0) continue;

      lines.push(`── ${category} ${'─'.repeat(50 - category.length)}`);
      lines.push('');

      for (const cmd of cmds) {
        // Build command signature with parameters
        let signature = `/${cmd.name}`;
        if (cmd.arguments && cmd.arguments.length > 0) {
          const params = cmd.arguments.map(arg =>
            arg.required ? `<${arg.name}>` : `[${arg.name}]`
          ).join(' ');
          signature += ` ${params}`;
        }

        lines.push(`  ${signature}`);
        lines.push(`      ${cmd.description}`);

        // Show parameter details if any
        if (cmd.arguments && cmd.arguments.length > 0) {
          for (const arg of cmd.arguments) {
            const reqText = arg.required ? '(required)' : '(optional)';
            lines.push(`      • ${arg.name}: ${arg.description} ${reqText}`);
          }
        }
        lines.push('');
      }
    }

    lines.push('─────────────────────────────────────────────────────────────────');
    lines.push('  Tip: Type naturally to chat with the AI');
    lines.push('  Use Ctrl+C to cancel, "exit" to quit');
    lines.push('─────────────────────────────────────────────────────────────────');

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  }

  /**
   * YOLO Mode - Full auto-execution with guardrails
   */
  private handleYoloMode(args: string[]): CommandHandlerResult {
    const autonomyManager = getAutonomyManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "on":
        autonomyManager.enableYOLO(false);
        autonomyManager.updateYOLOConfig({
          maxAutoEdits: 50,
          maxAutoCommands: 100,
        });
        content = `🚀 YOLO MODE: ENABLED

⚡ Auto-approval is ON for all operations
⚠️  Guardrails: 50 auto-edits, 100 commands per session

Use /yolo off to disable, /yolo safe for restricted mode`;
        break;

      case "safe":
        autonomyManager.enableYOLO(true);
        autonomyManager.updateYOLOConfig({
          maxAutoEdits: 20,
          maxAutoCommands: 30,
          allowedPaths: ["src/", "test/", "tests/"],
        });
        content = `🛡️ YOLO MODE: SAFE

✅ Auto-approval ON with restrictions:
   • Max 20 edits, 30 commands
   • Allowed paths: src/, test/, tests/

Use /yolo on for full mode, /yolo off to disable`;
        break;

      case "off":
        autonomyManager.disableYOLO();
        content = `⏸️ YOLO MODE: DISABLED

Manual approval is now required for operations.`;
        break;

      case "allow":
        if (args[1]) {
          autonomyManager.addToYOLOAllowList(args[1]);
          content = `✅ Added "${args[1]}" to YOLO allowed commands`;
        } else {
          content = `Usage: /yolo allow <command>`;
        }
        break;

      case "deny":
        if (args[1]) {
          autonomyManager.addToYOLODenyList(args[1]);
          content = `🚫 Added "${args[1]}" to YOLO denied commands`;
        } else {
          content = `Usage: /yolo deny <command>`;
        }
        break;

      case "status":
      default:
        content = autonomyManager.formatYOLOStatus();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Pipeline - Run agent workflows
   */
  private handlePipeline(args: string[]): CommandHandlerResult {
    const pipelineName = args[0];

    if (!pipelineName) {
      const content = `🔄 Available Pipelines

  • code-review: Comprehensive code review workflow
  • bug-fix: Systematic bug fixing workflow
  • feature-development: Feature development workflow
  • security-audit: Security audit workflow
  • documentation: Documentation generation workflow

Usage: /pipeline <name> [target]

Example: /pipeline code-review src/utils.ts`;

      return {
        handled: true,
        entry: {
          type: "assistant",
          content,
          timestamp: new Date(),
        },
      };
    }

    const target = args.slice(1).join(" ") || process.cwd();

    const pipelineSteps: Record<string, string> = {
      "code-review": `1. Analyze code structure
2. Check for code smells and anti-patterns
3. Review error handling
4. Check test coverage
5. Provide improvement suggestions`,
      "bug-fix": `1. Reproduce the issue
2. Analyze error messages and logs
3. Identify root cause
4. Implement fix
5. Verify fix and add tests`,
      "feature-development": `1. Understand requirements
2. Design implementation approach
3. Implement feature
4. Write tests
5. Document changes`,
      "security-audit": `1. Scan for common vulnerabilities
2. Check authentication/authorization
3. Review data handling
4. Check dependencies
5. Provide security recommendations`,
      "documentation": `1. Analyze code structure
2. Generate API documentation
3. Create usage examples
4. Update README if needed
5. Add inline comments`,
    };

    const steps = pipelineSteps[pipelineName] || "Execute the pipeline steps";

    return {
      handled: true,
      passToAI: true,
      prompt: `Run the ${pipelineName} pipeline on: ${target}

This involves:
${steps}

Execute each step and report results.`,
    };
  }

  /**
   * Skill - Manage specialized skills
   */
  private handleSkill(args: string[]): CommandHandlerResult {
    const skillManager = getSkillManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    if (!action || action === "list") {
      const skills = skillManager.getAvailableSkills();
      const active = skillManager.getActiveSkill();

      content = `🎯 Available Skills

${skills
  .map((name) => {
    const skill = skillManager.getSkill(name);
    const isActive = active?.name === name;
    return `  ${isActive ? "✅" : "⚪"} ${name}\n     ${skill?.description || ""}`;
  })
  .join("\n\n")}

Commands:
  /skill list              - Show all skills
  /skill activate <name>   - Enable a skill
  /skill deactivate        - Disable current skill
  /skill <name>            - Quick activate`;
    } else if (action === "activate" && args[1]) {
      const skill = skillManager.activateSkill(args[1]);
      content = skill
        ? `✅ Activated skill: ${skill.name}\n\n${skill.description}`
        : `❌ Skill not found: ${args[1]}`;
    } else if (action === "deactivate") {
      skillManager.deactivateSkill();
      content = `⏸️ Skill deactivated`;
    } else {
      // Try to activate as skill name
      const skill = skillManager.activateSkill(action);
      if (skill) {
        content = `✅ Activated skill: ${skill.name}\n\n${skill.description}`;
      } else {
        content = `❌ Unknown skill: ${action}\n\nUse /skill list to see available skills`;
      }
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Cost - Track API usage costs
   */
  private handleCost(args: string[]): CommandHandlerResult {
    const costTracker = getCostTracker();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "budget":
        if (args[1]) {
          const budget = parseFloat(args[1]);
          costTracker.setBudgetLimit(budget);
          content = `💰 Session budget set to $${budget.toFixed(2)}`;
        } else {
          content = `Usage: /cost budget <amount>`;
        }
        break;

      case "daily":
        if (args[1]) {
          const daily = parseFloat(args[1]);
          costTracker.setDailyLimit(daily);
          content = `📅 Daily limit set to $${daily.toFixed(2)}`;
        } else {
          content = `Usage: /cost daily <amount>`;
        }
        break;

      case "export":
        const report = costTracker.getReport();
        content = `📊 Cost Report\n\n${JSON.stringify(report, null, 2)}`;
        break;

      case "reset":
        costTracker.resetSession();
        content = `🔄 Cost tracking reset`;
        break;

      case "status":
      default:
        content = costTracker.formatDashboard();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Stats - Show performance statistics
   */
  private handleStats(args: string[]): CommandHandlerResult {
    const perfManager = getPerformanceManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "cache":
        const toolCache = perfManager.getToolCache();
        if (toolCache) {
          const stats = toolCache.getStats();
          content = `🗃️ Tool Cache Statistics

Hits: ${stats.hits}
Misses: ${stats.misses}
Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%
Saved Calls: ${stats.savedCalls}
Estimated Time Saved: ${(stats.savedTime / 1000).toFixed(1)}s`;
        } else {
          content = `⚠️ Tool cache not initialized`;
        }
        break;

      case "requests":
        const reqOptimizer = perfManager.getRequestOptimizer();
        if (reqOptimizer) {
          const stats = reqOptimizer.getStats();
          content = `📡 Request Optimizer Statistics

Total Requests: ${stats.totalRequests}
Successful: ${stats.successfulRequests}
Failed: ${stats.failedRequests}
Retried: ${stats.retriedRequests}
Deduplicated: ${stats.deduplicatedRequests}
Average Latency: ${stats.averageLatency.toFixed(0)}ms
Current Concurrency: ${stats.currentConcurrency}`;
        } else {
          content = `⚠️ Request optimizer not initialized`;
        }
        break;

      case "reset":
        perfManager.resetStats();
        content = `🔄 Performance statistics reset`;
        break;

      case "summary":
      default:
        const summary = perfManager.getSummary();
        content = `📊 Performance Summary

🧩 Lazy Loader
  Loaded: ${summary.lazyLoader.loadedModules}/${summary.lazyLoader.totalModules} modules
  Avg Load Time: ${summary.lazyLoader.averageLoadTime.toFixed(0)}ms

🗃️ Tool Cache
  Hit Rate: ${(summary.toolCache.hitRate * 100).toFixed(1)}%
  Saved Calls: ${summary.toolCache.savedCalls}

📡 Requests
  Total: ${summary.requestOptimizer.totalRequests}
  Deduplicated: ${summary.requestOptimizer.deduplicatedRequests}

🌐 API Cache
  Entries: ${summary.apiCache.entries}
  Hit Rate: ${(summary.apiCache.hitRate * 100).toFixed(1)}%

📈 Overall
  Operations: ${summary.overall.totalOperations}
  Cache Hit Rate: ${(summary.overall.cacheHitRate * 100).toFixed(1)}%
  Time Saved: ${(summary.overall.estimatedTimeSaved / 1000).toFixed(1)}s`;
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Security - Show security dashboard
   */
  private handleSecurity(args: string[]): CommandHandlerResult {
    const securityManager = getSecurityManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "mode":
        const mode = args[1]?.toLowerCase() as ApprovalMode;
        if (mode && ['read-only', 'auto', 'full-access'].includes(mode)) {
          securityManager.updateConfig({ approvalMode: mode });
          content = `🛡️ Security mode set to: ${mode.toUpperCase()}`;
        } else {
          content = `Usage: /security mode <read-only|auto|full-access>

Modes:
  read-only   - Only read operations, no writes or commands
  auto        - Auto-approve safe operations, confirm dangerous ones
  full-access - All operations auto-approved (trusted environments)`;
        }
        break;

      case "reset":
        securityManager.resetStats();
        content = `🔄 Security statistics reset`;
        break;

      case "events":
        const events = securityManager.getEvents(10);
        if (events.length === 0) {
          content = `📜 No security events recorded`;
        } else {
          const eventLines = events.map(e => {
            const time = new Date(e.timestamp).toLocaleTimeString();
            return `[${time}] ${e.type}: ${e.action} → ${e.result}`;
          });
          content = `📜 Recent Security Events\n\n${eventLines.join('\n')}`;
        }
        break;

      case "status":
      default:
        content = securityManager.formatDashboard();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Fork - Create conversation branch
   */
  private handleFork(args: string[]): CommandHandlerResult {
    const branchManager = getBranchManager();
    const branchName = args.join(" ") || `branch-${Date.now()}`;

    const branch = branchManager.fork(branchName);

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🔀 Created branch: ${branch.name}

ID: ${branch.id}
Messages: ${branch.messages.length}

Use /branches to see all branches
Use /checkout <id> to switch branches`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Branches - List conversation branches
   */
  private handleBranches(): CommandHandlerResult {
    const branchManager = getBranchManager();
    const branches = branchManager.getAllBranches();
    const currentId = branchManager.getCurrentBranchId();

    let content = `🌳 Conversation Branches\n${"═".repeat(50)}\n\n`;

    for (const branch of branches) {
      const isCurrent = branch.id === currentId;
      content += `${isCurrent ? "→ " : "  "}${branch.name} (${branch.id})\n`;
      content += `    Messages: ${branch.messages.length} | Created: ${new Date(branch.createdAt).toLocaleString()}\n\n`;
    }

    content += `\nCommands:\n  /fork <name>     - Create new branch\n  /checkout <id>   - Switch branch\n  /merge <id>      - Merge branch`;

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Checkout - Switch to a branch
   */
  private handleCheckout(args: string[]): CommandHandlerResult {
    const branchManager = getBranchManager();
    const branchId = args[0];

    if (!branchId) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `Usage: /checkout <branch-id>

Use /branches to see available branches`,
          timestamp: new Date(),
        },
      };
    }

    const result = branchManager.checkout(branchId);

    if (result) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `✅ Switched to branch: ${result.name}

Loaded ${result.messages.length} messages`,
          timestamp: new Date(),
        },
      };
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Branch not found: ${branchId}`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Merge - Merge a branch
   */
  private handleMerge(args: string[]): CommandHandlerResult {
    const branchManager = getBranchManager();
    const branchId = args[0];

    if (!branchId) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `Usage: /merge <branch-id>`,
          timestamp: new Date(),
        },
      };
    }

    const result = branchManager.merge(branchId);

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: result
          ? `✅ Merged branch: ${branchId}`
          : `❌ Merge failed: Branch not found or same as current`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Scan Todos - Find AI-directed comments
   */
  private async handleScanTodos(): Promise<CommandHandlerResult> {
    const commentWatcher = getCommentWatcher();

    await commentWatcher.scanProject();
    const content = commentWatcher.formatComments();

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Address Todo - Handle specific AI comment
   */
  private async handleAddressTodo(
    args: string[]
  ): Promise<CommandHandlerResult> {
    const commentWatcher = getCommentWatcher();
    const index = parseInt(args[0], 10);

    if (isNaN(index)) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `Usage: /address-todo <index>

Run /scan-todos first to see available items`,
          timestamp: new Date(),
        },
      };
    }

    const comments = commentWatcher.getDetectedComments();

    if (index < 1 || index > comments.length) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ Invalid index. Available: 1-${comments.length}`,
          timestamp: new Date(),
        },
      };
    }

    const comment = comments[index - 1];
    const prompt = commentWatcher.generatePromptForComment(comment);

    return {
      handled: true,
      passToAI: true,
      prompt,
    };
  }

  /**
   * Memory - Manage persistent memory
   */
  private async handleMemory(args: string[]): Promise<CommandHandlerResult> {
    const memoryManager = getMemoryManager();
    await memoryManager.initialize();

    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "recall":
        if (args[1]) {
          const value = memoryManager.recall(args[1]);
          content = value
            ? `📝 ${args[1]}: ${value}`
            : `❌ Memory not found: ${args[1]}`;
        } else {
          content = `Usage: /memory recall <key>`;
        }
        break;

      case "forget":
        if (args[1]) {
          await memoryManager.forget(args[1]);
          content = `🗑️ Forgot: ${args[1]}`;
        } else {
          content = `Usage: /memory forget <key>`;
        }
        break;

      case "list":
      default:
        content = memoryManager.formatMemories();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Remember - Quick memory store
   */
  private async handleRemember(args: string[]): Promise<CommandHandlerResult> {
    const memoryManager = getMemoryManager();
    await memoryManager.initialize();

    const key = args[0];
    const value = args.slice(1).join(" ");

    if (!key || !value) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `Usage: /remember <key> <value>`,
          timestamp: new Date(),
        },
      };
    }

    await memoryManager.remember(key, value);

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `✅ Remembered: ${key} = ${value}`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Workspace - Detect project configuration
   */
  private async handleWorkspace(): Promise<CommandHandlerResult> {
    const detector = getWorkspaceDetector();

    await detector.detect();
    const content = detector.formatDetectionResults();

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Parallel - Run parallel subagents
   */
  private handleParallel(args: string[]): CommandHandlerResult {
    const task = args.join(" ");

    if (!task) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `🔀 Parallel Subagent Runner

Usage: /parallel <task description>

Example: /parallel analyze all TypeScript files in src/

This will execute the task using parallel subagents where beneficial.`,
          timestamp: new Date(),
        },
      };
    }

    return {
      handled: true,
      passToAI: true,
      prompt: `Execute this task using parallel subagents where beneficial:

${task}

Consider splitting into parallel operations for:
- Independent file analysis
- Multiple search queries
- Concurrent API calls`,
    };
  }

  /**
   * Model Router - Configure dynamic model selection
   */
  private handleModelRouter(args: string[]): CommandHandlerResult {
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "auto":
        content = `🤖 Model Router: AUTO MODE

Models will be selected automatically based on task type.

Task Types:
  • search   → Fast model for quick searches
  • planning → Smart model for planning
  • coding   → Best model for code generation
  • review   → Smart model for reviews
  • debug    → Best model for debugging
  • docs     → Fast model for documentation
  • chat     → Default model for conversations`;
        break;

      case "manual":
        content = `🎛️ Model Router: MANUAL MODE

Use /model to change models manually.`;
        break;

      case "status":
      default:
        content = `🔄 Model Router Status

Mode: Manual (use /model-router auto to enable)

Task-to-Model Mapping:
  • search   → grok-code-fast-1
  • planning → grok-4-latest
  • coding   → grok-4-latest
  • review   → grok-4-latest
  • debug    → grok-4-latest
  • docs     → grok-code-fast-1
  • chat     → grok-code-fast-1

Commands:
  /model-router auto    - Enable auto selection
  /model-router manual  - Disable auto selection`;
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Generate Tests - Create test scaffolds
   */
  private handleGenerateTests(args: string[]): CommandHandlerResult {
    const targetFile = args[0];

    if (!targetFile) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `🧪 Test Generator

Usage: /generate-tests <file>

Example: /generate-tests src/utils/helpers.ts

This will:
1. Analyze the file
2. Detect the test framework
3. Generate comprehensive tests`,
          timestamp: new Date(),
        },
      };
    }

    return {
      handled: true,
      passToAI: true,
      prompt: `Generate comprehensive tests for: ${targetFile}

1. Read and analyze the file
2. Identify all testable functions/methods
3. Generate unit tests covering:
   - Happy paths
   - Edge cases
   - Error conditions
4. Use the detected test framework conventions
5. Create the test file in the appropriate location`,
    };
  }

  /**
   * Autonomy - Set autonomy level
   */
  private handleAutonomy(args: string[]): CommandHandlerResult {
    const autonomyManager = getAutonomyManager();
    const level = args[0]?.toLowerCase() as AutonomyLevel;

    if (level && ["suggest", "confirm", "auto", "full", "yolo"].includes(level)) {
      autonomyManager.setLevel(level);

      const descriptions: Record<AutonomyLevel, string> = {
        suggest: "Suggests changes, you approve each one",
        confirm: "Asks for confirmation on important operations",
        auto: "Auto-approves safe operations, confirms destructive ones",
        full: "Auto-approves all operations (use with caution)",
        yolo: "Full auto mode with no confirmations",
      };

      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `🎚️ Autonomy Level: ${level.toUpperCase()}

${descriptions[level]}`,
          timestamp: new Date(),
        },
      };
    }

    const current = autonomyManager.getLevel();
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🎚️ Autonomy Settings

Current: ${current.toUpperCase()}

Levels:
  suggest  - Suggests changes, you approve each
  confirm  - Confirms important operations
  auto     - Auto-approves safe operations
  full     - Auto-approves everything
  yolo     - No confirmations at all

Usage: /autonomy <level>`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Add Context - Load files into context dynamically
   */
  private async handleAddContext(args: string[]): Promise<CommandHandlerResult> {
    const pattern = args.join(" ");

    if (!pattern) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `📁 Add Files to Context

Usage: /add <pattern>

Examples:
  /add src/utils.ts           - Add single file
  /add src/**/*.ts            - Add all TypeScript files in src/
  /add src/**/*.ts,!**/*.test.ts  - Add TS files except tests

Files will be loaded and available for the AI to reference.`,
          timestamp: new Date(),
        },
      };
    }

    try {
      const { include, exclude } = ContextLoader.parsePatternString(pattern);
      const contextLoader = getContextLoader(process.cwd(), {
        patterns: include,
        excludePatterns: exclude,
        respectGitignore: true,
      });

      const files = await contextLoader.loadFiles(include);

      if (files.length === 0) {
        return {
          handled: true,
          entry: {
            type: "assistant",
            content: `❌ No files matched pattern: ${pattern}

Check your glob pattern and try again.`,
            timestamp: new Date(),
          },
        };
      }

      const summary = contextLoader.getSummary(files);
      const fileList = files.slice(0, 10).map(f => `  • ${f.relativePath}`).join('\n');
      const moreFiles = files.length > 10 ? `\n  ... and ${files.length - 10} more` : '';

      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `✅ Added ${files.length} file(s) to context

${summary}

Files:
${fileList}${moreFiles}

These files are now available for reference.`,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ Error loading files: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Save Conversation - Export chat to file
   */
  private handleSaveConversation(args: string[]): CommandHandlerResult {
    const filename = args.join(" ") || undefined;
    const exporter = getConversationExporter();

    const result = exporter.export(this.conversationHistory, {
      format: 'markdown',
      includeToolResults: true,
      includeTimestamps: true,
      outputPath: filename,
    });

    if (result.success) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `✅ Conversation saved!

📄 File: ${result.filePath}

The conversation has been exported in Markdown format.`,
          timestamp: new Date(),
        },
      };
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Failed to save conversation: ${result.error}`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Cache - Manage response cache
   */
  private handleCache(args: string[]): CommandHandlerResult {
    const cache = getResponseCache();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "clear":
        cache.clear();
        content = `🗑️ Cache cleared!

All cached responses have been removed.`;
        break;

      case "stats":
        const stats = cache.getStats();
        content = `📊 Cache Statistics

Entries: ${stats.totalEntries}
Size: ${stats.cacheSize}
Hits: ${stats.totalHits}
Misses: ${stats.totalMisses}
Hit Rate: ${stats.totalHits + stats.totalMisses > 0
  ? ((stats.totalHits / (stats.totalHits + stats.totalMisses)) * 100).toFixed(1)
  : 0}%
${stats.oldestEntry ? `Oldest: ${stats.oldestEntry.toLocaleDateString()}` : ''}
${stats.newestEntry ? `Newest: ${stats.newestEntry.toLocaleDateString()}` : ''}`;
        break;

      case "status":
      default:
        content = cache.formatStatus();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Self-Healing - Configure auto-correction
   */
  private handleSelfHealing(args: string[]): CommandHandlerResult {
    const engine = getSelfHealingEngine();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "on":
        engine.updateOptions({ enabled: true });
        content = `🔧 Self-Healing: ENABLED

The agent will automatically attempt to fix errors when commands fail.
Max retries: ${engine.getOptions().maxRetries}`;
        break;

      case "off":
        engine.updateOptions({ enabled: false });
        content = `🔧 Self-Healing: DISABLED

Errors will be reported without automatic fix attempts.`;
        break;

      case "stats":
        const stats = engine.getStats();
        content = `📊 Self-Healing Statistics

Total Attempts: ${stats.totalAttempts}
Successful: ${stats.successfulHeals}
Failed: ${stats.failedHeals}
Success Rate: ${stats.successRate}`;
        break;

      case "status":
      default:
        const options = engine.getOptions();
        content = `🔧 Self-Healing Status

Enabled: ${options.enabled ? '✅ Yes' : '❌ No'}
Max Retries: ${options.maxRetries}
Auto-Fix: ${options.autoFix ? 'Yes' : 'No'}
Verbose: ${options.verbose ? 'Yes' : 'No'}

Commands:
  /heal on     - Enable self-healing
  /heal off    - Disable self-healing
  /heal stats  - Show healing statistics`;
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Context - View/manage loaded context
   */
  private async handleContext(args: string[]): Promise<CommandHandlerResult> {
    const action = args[0]?.toLowerCase();
    const contextLoader = getContextLoader();

    let content: string;

    switch (action) {
      case "clear":
        // Context is ephemeral, just confirm
        content = `🗑️ Context cleared!

Loaded files have been removed from the current session.`;
        break;

      case "list":
        const files = await contextLoader.loadFiles();
        if (files.length === 0) {
          content = `📁 No files currently in context.

Use /add <pattern> to add files.`;
        } else {
          const fileList = files.map(f => `  • ${f.relativePath} (${f.language || 'text'})`).join('\n');
          content = `📁 Context Files (${files.length})

${fileList}`;
        }
        break;

      case "summary":
      default:
        const allFiles = await contextLoader.loadFiles();
        content = allFiles.length > 0
          ? contextLoader.getSummary(allFiles)
          : `📁 No files currently in context.

Use /add <pattern> to add files, or use --context flag when starting.`;
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Dry-Run - Toggle simulation mode
   */
  private handleDryRun(args: string[]): CommandHandlerResult {
    const confirmationService = ConfirmationService.getInstance();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "on":
        confirmationService.setDryRunMode(true);
        content = `🔍 Dry-Run Mode: ENABLED

Changes will be previewed but NOT applied.
All operations will be logged for review.

Use /dry-run off to disable and apply changes.
Use /dry-run log to see what would have executed.`;
        break;

      case "off":
        const log = confirmationService.getDryRunLog();
        confirmationService.setDryRunMode(false);
        content = `🔍 Dry-Run Mode: DISABLED

Changes will now be applied normally.

${log.length > 0 ? `📋 ${log.length} operation(s) were logged during dry-run.` : ''}`;
        break;

      case "log":
        content = confirmationService.formatDryRunLog();
        break;

      case "status":
      default:
        const isDryRun = confirmationService.isDryRunMode();
        const currentLog = confirmationService.getDryRunLog();
        content = `🔍 Dry-Run Status

Mode: ${isDryRun ? '✅ ENABLED (simulation)' : '❌ DISABLED (live)'}
Logged Operations: ${currentLog.length}

Commands:
  /dry-run on     - Enable simulation mode
  /dry-run off    - Disable and apply changes
  /dry-run log    - View logged operations

Or use --dry-run flag when starting the CLI.`;
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Theme - Change UI color theme
   */
  private handleTheme(args: string[]): CommandHandlerResult {
    const themeManager = getThemeManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    if (!action || action === "list") {
      const themes = themeManager.getAvailableThemes();
      const currentTheme = themeManager.getCurrentTheme();

      content = `🎨 Available Themes\n${"═".repeat(40)}\n\n`;

      for (const theme of themes) {
        const isCurrent = theme.id === currentTheme.id;
        const marker = isCurrent ? "▶" : " ";
        const builtinMarker = theme.isBuiltin ? "" : " (custom)";
        content += `${marker} ${theme.name}${builtinMarker}\n`;
        content += `    ${theme.description}\n\n`;
      }

      content += `\n💡 Usage: /theme <name>\n`;
      content += `   Example: /theme neon`;
    } else {
      // Try to set the theme
      const success = themeManager.setTheme(action);

      if (success) {
        const theme = themeManager.getCurrentTheme();
        content = `🎨 Theme Changed!\n\n`;
        content += `Now using: ${theme.name}\n`;
        content += `${theme.description}\n\n`;
        content += `💡 The theme will be applied to new messages.`;
      } else {
        const themes = themeManager.getAvailableThemes();
        content = `❌ Theme "${action}" not found.\n\n`;
        content += `Available themes:\n`;
        content += themes.map(t => `  • ${t.id}`).join("\n");
      }
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Avatar - Change chat avatars
   */
  private handleAvatar(args: string[]): CommandHandlerResult {
    const themeManager = getThemeManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    if (!action || action === "list") {
      const presets = themeManager.getAvatarPresets();
      const currentAvatars = themeManager.getAvatars();

      content = `👤 Avatar Presets\n${"═".repeat(40)}\n\n`;

      for (const preset of presets) {
        content += `${preset.name} (${preset.id})\n`;
        content += `    ${preset.description}\n`;
        content += `    Preview: ${preset.avatars.user} ${preset.avatars.assistant} ${preset.avatars.tool}\n\n`;
      }

      content += `\nCurrent avatars:\n`;
      content += `    User: ${currentAvatars.user}\n`;
      content += `    Assistant: ${currentAvatars.assistant}\n`;
      content += `    Tool: ${currentAvatars.tool}\n`;

      content += `\n💡 Usage: /avatar <preset>\n`;
      content += `   Example: /avatar emoji`;
    } else if (action === "custom") {
      // Custom avatar syntax: /avatar custom user 🦊
      const avatarType = args[1]?.toLowerCase() as "user" | "assistant" | "tool" | "system";
      const avatarValue = args.slice(2).join(" ");

      if (!avatarType || !avatarValue) {
        content = `Usage: /avatar custom <type> <value>\n\n`;
        content += `Types: user, assistant, tool, system\n`;
        content += `Example: /avatar custom user 🦊`;
      } else if (!["user", "assistant", "tool", "system"].includes(avatarType)) {
        content = `❌ Invalid avatar type: ${avatarType}\n\n`;
        content += `Valid types: user, assistant, tool, system`;
      } else {
        themeManager.setCustomAvatar(avatarType, avatarValue);
        content = `✅ Custom avatar set!\n\n`;
        content += `${avatarType}: ${avatarValue}`;
      }
    } else if (action === "reset") {
      themeManager.clearCustomAvatars();
      content = `✅ Avatars reset to theme defaults!`;
    } else {
      // Try to apply preset
      const success = themeManager.applyAvatarPreset(action);

      if (success) {
        const avatars = themeManager.getAvatars();
        content = `👤 Avatar Preset Applied!\n\n`;
        content += `Now using:\n`;
        content += `    User: ${avatars.user}\n`;
        content += `    Assistant: ${avatars.assistant}\n`;
        content += `    Tool: ${avatars.tool}\n`;
      } else {
        const presets = themeManager.getAvatarPresets();
        content = `❌ Avatar preset "${action}" not found.\n\n`;
        content += `Available presets:\n`;
        content += presets.map(p => `  • ${p.id}`).join("\n");
        content += `\n\nOr use: /avatar custom <type> <value>`;
      }
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Voice - Control voice input
   */
  private async handleVoice(args: string[]): Promise<CommandHandlerResult> {
    const voiceManager = getVoiceInputManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "on":
        voiceManager.enable();
        const availability = await voiceManager.isAvailable();
        if (availability.available) {
          content = `🎤 Voice Input: ENABLED

Provider: ${voiceManager.getConfig().provider}
Language: ${voiceManager.getConfig().language}
Hotkey: ${voiceManager.getConfig().hotkey}

Use /voice toggle to start/stop recording.`;
        } else {
          content = `🎤 Voice Input: ENABLED (but not available)

⚠️ ${availability.reason}

Please install the required dependencies and try again.`;
        }
        break;

      case "off":
        voiceManager.disable();
        content = `🎤 Voice Input: DISABLED

Voice recording has been turned off.`;
        break;

      case "toggle":
        const state = voiceManager.getState();
        if (state.isRecording) {
          voiceManager.stopRecording();
          content = `🎤 Recording stopped.

⏳ Processing audio with Whisper...`;
        } else {
          const avail = await voiceManager.isAvailable();
          if (avail.available) {
            await voiceManager.startRecording();
            const silenceSec = ((voiceManager.getConfig().silenceDuration || 1500) / 1000).toFixed(1);
            content = `🔴 RECORDING IN PROGRESS

┌─────────────────────────────────────┐
│  🎙️  Speak now - I'm listening!    │
│                                     │
│  Language: ${(voiceManager.getConfig().language || 'auto').padEnd(23)}│
│  Auto-stop after ${silenceSec}s silence       │
└─────────────────────────────────────┘

💡 Use /voice toggle to stop manually`;
          } else {
            content = `❌ Cannot start recording: ${avail.reason}`;
          }
        }
        break;

      case "config":
        const config = voiceManager.getConfig();
        content = `🎤 Voice Configuration

Provider: ${config.provider}
Language: ${config.language || 'auto'}
Model: ${config.model || 'base'}
Hotkey: ${config.hotkey}
Auto-send: ${config.autoSend ? 'Yes' : 'No'}
Silence Threshold: ${config.silenceThreshold}
Silence Duration: ${config.silenceDuration}ms

Configuration file: ~/.grok/voice-config.json`;
        break;

      case "status":
      default:
        content = voiceManager.formatStatus();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Speak - Text-to-speech
   */
  private async handleSpeak(args: string[]): Promise<CommandHandlerResult> {
    const ttsManager = getTTSManager();
    const text = args.join(" ");

    if (!text || text.toLowerCase() === "stop") {
      ttsManager.stop();
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `🔇 Speech stopped.`,
          timestamp: new Date(),
        },
      };
    }

    const availability = await ttsManager.isAvailable();
    if (!availability.available) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ TTS not available: ${availability.reason}

Install with: pip3 install edge-tts`,
          timestamp: new Date(),
        },
      };
    }

    // Start speaking in background
    ttsManager.speak(text, 'fr');

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🔊 Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        timestamp: new Date(),
      },
    };
  }

  /**
   * TTS - Text-to-speech settings
   */
  private async handleTTS(args: string[]): Promise<CommandHandlerResult> {
    const ttsManager = getTTSManager();
    const action = args[0]?.toLowerCase();

    let content: string;

    switch (action) {
      case "on":
        ttsManager.enable();
        content = `🔊 Text-to-Speech: ENABLED

Provider: ${ttsManager.getConfig().provider}
Use /speak <text> to speak text.`;
        break;

      case "off":
        ttsManager.disable();
        content = `🔇 Text-to-Speech: DISABLED`;
        break;

      case "auto":
        const currentAuto = ttsManager.getConfig().autoSpeak;
        ttsManager.setAutoSpeak(!currentAuto);
        content = !currentAuto
          ? `🔊 Auto-speak: ENABLED

AI responses will now be spoken aloud automatically.`
          : `🔇 Auto-speak: DISABLED

AI responses will no longer be spoken automatically.`;
        break;

      case "voices":
        const voices = await ttsManager.listVoices();
        const frVoices = voices.filter(v => v.includes('fr-'));
        content = `🎤 Available French Voices (${frVoices.length})

${frVoices.slice(0, 10).map(v => `  • ${v}`).join('\n')}
${frVoices.length > 10 ? `  ... and ${frVoices.length - 10} more` : ''}

Set voice: /tts voice <name>
Example: /tts voice fr-FR-HenriNeural`;
        break;

      case "voice":
        if (args[1]) {
          ttsManager.updateConfig({ voice: args[1] });
          content = `✅ Voice set to: ${args[1]}`;
        } else {
          content = `Usage: /tts voice <voice-name>

Example: /tts voice fr-FR-HenriNeural
Use /tts voices to list available voices.`;
        }
        break;

      case "status":
      default:
        content = ttsManager.formatStatus();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
    };
  }

  /**
   * AI Test - Run integration tests on the current AI provider
   */
  private async handleAITest(args: string[]): Promise<CommandHandlerResult> {
    const option = args[0]?.toLowerCase();

    // Check for API key
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ AI Test Failed

No GROK_API_KEY environment variable found.
Set your API key to run integration tests.`,
          timestamp: new Date(),
        },
      };
    }

    // Use current client if available, otherwise create new one from env
    let client = this.grokClient;
    if (!client) {
      // Fallback: create client from environment variables
      const model = process.env.GROK_MODEL || process.env.OPENAI_MODEL;
      const baseURL = process.env.GROK_BASE_URL || process.env.OPENAI_BASE_URL;
      client = new GrokClient(apiKey, model, baseURL);
    }

    const currentModel = client.getCurrentModel();
    const currentBaseURL = client.getBaseURL();

    // Detect local models (LM Studio, Ollama) and increase timeout
    const isLocalModel = currentBaseURL.includes(':1234') ||
                         currentBaseURL.includes(':11434') ||
                         currentBaseURL.includes('localhost') ||
                         currentBaseURL.includes('127.0.0.1') ||
                         currentBaseURL.match(/10\.\d+\.\d+\.\d+/);

    // Local models get 120s timeout (vs 30s for cloud APIs)
    const timeout = isLocalModel ? 120000 : 30000;

    // Configure test options based on argument
    const testOptions = {
      timeout,
      verbose: false,
      skipExpensive: option === 'quick',
      testTools: option !== 'stream',
      testStreaming: option !== 'tools',
    };

    // Show what we're testing
    let modeDesc = 'full';
    if (option === 'quick') modeDesc = 'quick (skipping expensive tests)';
    else if (option === 'tools') modeDesc = 'tool calling only';
    else if (option === 'stream') modeDesc = 'streaming only';

    // Fun test names and emojis
    const testEmojis: Record<string, string> = {
      'Basic Completion': '🧠',
      'Simple Math': '🔢',
      'JSON Output': '📋',
      'Code Generation': '💻',
      'Context Understanding': '🧩',
      'Streaming Response': '🌊',
      'Tool Calling': '🔧',
      'Error Handling': '🛡️',
      'Long Context': '📚',
    };

    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinnerIndex = 0;
    let currentTest = '';
    let completedTests: string[] = [];
    let spinnerInterval: NodeJS.Timeout | null = null;

    // Create client and run tests
    try {
      const runner = createAITestRunner(client, testOptions);

      // Helper to pad string to width accounting for emoji visual width
      const padEnd = (str: string, targetWidth: number): string => {
        const currentWidth = stringWidth(str);
        if (currentWidth >= targetWidth) return str;
        return str + ' '.repeat(targetWidth - currentWidth);
      };

      const W = 60; // box width

      // Build progress display with proper emoji width handling
      const buildProgressDisplay = () => {
        const lines: string[] = [];
        lines.push('┌' + '─'.repeat(W - 2) + '┐');
        lines.push('│' + padEnd('          🧪 AI INTEGRATION TESTS IN PROGRESS', W - 2) + '│');
        lines.push('├' + '─'.repeat(W - 2) + '┤');
        lines.push('│' + padEnd(`  Model: ${currentModel}`, W - 2) + '│');
        lines.push('├' + '─'.repeat(W - 2) + '┤');

        // Show completed tests
        for (const test of completedTests) {
          lines.push('│' + padEnd(`  ${test}`, W - 2) + '│');
        }

        // Show current test with spinner
        if (currentTest) {
          const emoji = testEmojis[currentTest] || '🔬';
          const spinner = spinnerFrames[spinnerIndex % spinnerFrames.length];
          lines.push('│' + padEnd(`  ${spinner} ${emoji} ${currentTest}...`, W - 2) + '│');
        }

        lines.push('└' + '─'.repeat(W - 2) + '┘');
        return lines.join('\n');
      };

      // Track progress
      runner.on('test:start', ({ name }) => {
        currentTest = name;
      });

      runner.on('test:complete', (result) => {
        const emoji = testEmojis[result.name] || '🔬';
        const status = result.passed ? '✅' : '❌';
        const duration = result.duration ? `${(result.duration / 1000).toFixed(1)}s` : '';
        completedTests.push(`${status} ${emoji} ${result.name} ${duration}`);
        currentTest = '';
      });

      runner.on('test:skipped', ({ name }) => {
        const emoji = testEmojis[name] || '🔬';
        completedTests.push(`⏭️  ${emoji} ${name} (skipped)`);
      });

      // Start spinner animation (write to stderr to not interfere with output)
      spinnerInterval = setInterval(() => {
        spinnerIndex++;
        // Clear and redraw progress (using ANSI escape codes)
        const progress = buildProgressDisplay();
        process.stderr.write(`\x1b[${completedTests.length + 7}A\x1b[0J${progress}\n`);
      }, 100);

      // Show initial progress
      process.stderr.write('\n' + buildProgressDisplay() + '\n');

      const suite = await runner.runAll();

      // Stop spinner
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
      }

      // Clear progress display
      const clearLines = completedTests.length + 8;
      process.stderr.write(`\x1b[${clearLines}A\x1b[0J`);

      // Format final results
      const resultContent = AITestRunner.formatResults(suite);

      return {
        handled: true,
        entry: {
          type: "assistant",
          content: resultContent,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      // Stop spinner on error
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
      }

      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ AI Test Error

${error instanceof Error ? error.message : String(error)}

Check your API key and network connection.`,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Guardian - Code Guardian agent for code analysis and review
   */
  private async handleGuardian(args: string[]): Promise<CommandHandlerResult> {
    const guardian = getCodeGuardianAgent();

    // Initialize if needed
    if (!guardian.isReady()) {
      await guardian.initialize();
    }

    const action = args[0]?.toLowerCase() || 'help';
    const target = args[1] || process.cwd();

    // Handle mode setting
    if (action === 'mode') {
      const modeMap: Record<string, CodeGuardianMode> = {
        'analyze': 'ANALYZE_ONLY',
        'analyze-only': 'ANALYZE_ONLY',
        'suggest': 'SUGGEST_REFACTOR',
        'plan': 'PATCH_PLAN',
        'diff': 'PATCH_DIFF',
      };
      const newMode = modeMap[args[1]?.toLowerCase() || ''];
      if (newMode) {
        guardian.setMode(newMode);
        return {
          handled: true,
          entry: {
            type: "assistant",
            content: `🛡️ Code Guardian - Mode: ${newMode}

Les modifications sont ${newMode === 'ANALYZE_ONLY' ? 'désactivées' : 'possibles'}.`,
            timestamp: new Date(),
          },
        };
      }
    }

    // Map actions to agent tasks
    const actionMap: Record<string, { action: string; description: string }> = {
      'analyze': { action: 'analyze-directory', description: 'Analyse complète du répertoire' },
      'security': { action: 'check-security', description: 'Audit de sécurité' },
      'review': { action: 'analyze-file', description: 'Revue de code' },
      'refactor': { action: 'suggest-refactor', description: 'Suggestions de refactoring' },
      'plan': { action: 'create-patch-plan', description: 'Plan de modifications' },
      'architecture': { action: 'review-architecture', description: 'Revue d\'architecture' },
      'deps': { action: 'map-dependencies', description: 'Carte des dépendances' },
      'explain': { action: 'explain-code', description: 'Explication du code' },
    };

    if (action === 'help' || !actionMap[action]) {
      const currentMode = guardian.getMode();
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `🛡️ Grokinette - Code Guardian
═══════════════════════════════════════════════════

Mode actuel: ${currentMode}

📋 Actions disponibles:
  /guardian analyze [path]     - Analyse complète du code
  /guardian security [path]    - Audit de sécurité
  /guardian review <file>      - Revue d'un fichier
  /guardian refactor [path]    - Suggestions de refactoring
  /guardian architecture       - Revue d'architecture
  /guardian deps [path]        - Carte des dépendances
  /guardian explain <file>     - Explication du code

⚙️ Modes:
  /guardian mode analyze-only  - Lecture seule
  /guardian mode suggest       - Analyse + suggestions
  /guardian mode plan          - Plans de modification
  /guardian mode diff          - Génération de diffs

🔒 Règles de sécurité:
  • Validation humaine requise pour les modifications
  • Pas de suppression massive
  • Rollback toujours disponible`,
          timestamp: new Date(),
        },
      };
    }

    const taskInfo = actionMap[action];

    try {
      // Set mode for refactoring actions
      if (['refactor', 'plan'].includes(action)) {
        if (guardian.getMode() === 'ANALYZE_ONLY') {
          guardian.setMode('SUGGEST_REFACTOR');
        }
      }

      const result = await guardian.execute({
        action: taskInfo.action,
        inputFiles: [target],
      });

      if (result.success) {
        return {
          handled: true,
          entry: {
            type: "assistant",
            content: result.output || JSON.stringify(result.data, null, 2),
            timestamp: new Date(),
          },
        };
      } else {
        return {
          handled: true,
          entry: {
            type: "assistant",
            content: `❌ Code Guardian - Erreur

${result.error || 'Une erreur inconnue s\'est produite'}`,
            timestamp: new Date(),
          },
        };
      }
    } catch (error) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ Code Guardian - Erreur

${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        },
      };
    }
  }
}

// Singleton instance
let enhancedCommandHandlerInstance: EnhancedCommandHandler | null = null;

export function getEnhancedCommandHandler(): EnhancedCommandHandler {
  if (!enhancedCommandHandlerInstance) {
    enhancedCommandHandlerInstance = new EnhancedCommandHandler();
  }
  return enhancedCommandHandlerInstance;
}

export function resetEnhancedCommandHandler(): void {
  enhancedCommandHandlerInstance = null;
}
