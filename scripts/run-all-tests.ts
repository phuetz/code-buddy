#!/usr/bin/env npx tsx
/**
 * Ultra-Complete Real-Conditions Test Runner — Extended Edition
 *
 * Runs ALL test categories (Cat 26-125) across multiple test files.
 * Cat 1-25: Original tests from test-real-conditions-gemini.ts
 * Cat 26-50: Extended tests from scripts/tests/*.ts
 * Cat 51-75: Ultra-extended tests from scripts/tests/*.ts
 * Cat 76-100: Mega-extended tests from scripts/tests/*.ts
 * Cat 101-125: Giga-extended tests from scripts/tests/*.ts
 *
 * Usage:
 *   export GOOGLE_API_KEY="AIza..."
 *   npx tsx scripts/run-all-tests.ts
 *   npx tsx scripts/run-all-tests.ts --extended-only   # Only Cat 26-50
 */

import { GeminiProvider } from '../src/providers/gemini-provider.js';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import type { CategoryDef, CategoryResult, TestReport } from './tests/types.js';
import { runCategory, sleep } from './tests/types.js';

// Extended test categories
import { cat26ContextManagerV2, cat27HybridSearch } from './tests/cat-context-memory.js';
import { cat28IdentityManager, cat29LifecycleHooks } from './tests/cat-identity-hooks.js';
import { cat30SecurityModes, cat31SkillScanner, cat32ToolPolicyGroups } from './tests/cat-security-advanced.js';
import { cat33MessagePreprocessing, cat34PromptSuggestions } from './tests/cat-messaging.js';
import { cat35GatewayTypes, cat36DaemonDailyReset, cat37BackgroundTasks } from './tests/cat-gateway-daemon.js';
import { cat38ToolRegistry, cat39ToolMetadata } from './tests/cat-tools-registry.js';
import { cat40LobsterExtended, cat41CodingStyleAnalyzer } from './tests/cat-workflow-extended.js';
import { cat42AdvancedGeminiAPI, cat43MultiTurn, cat44ProviderEdgeCases, initApiAdvanced } from './tests/cat-api-advanced.js';
import { cat45ChannelCore, cat46NicheChannels, cat47PRSessionLinker } from './tests/cat-channels-extended.js';
import { cat48CanvasUndoRender, cat49ROIExtended, cat50Observability } from './tests/cat-canvas-extended.js';

// Cat 51-75 imports
import { cat51CheckpointManager, cat52PersonaManager, cat53ConversationExporter } from './tests/cat-checkpoint-persona.js';
import { cat54TokenCounter, cat55RetryUtility, cat56LRUCache, cat57FuzzyMatch } from './tests/cat-utils-core.js';
import { cat58RateLimiter, cat59HistoryManager, cat60ResponseCache, cat61DiffGenerator } from './tests/cat-rate-history-cache.js';
import { cat62PollManager, cat63AuthMonitor, cat64AgentSDK, cat65RTKCompressor } from './tests/cat-automation-sdk.js';
import { cat66SkillParser, cat67SkillRegistry, cat68AutoSandbox, cat69ConfirmationService } from './tests/cat-skills-sandbox.js';
import { cat70GeminiStructuredOutput, cat71GeminiStreamingExtended, cat72InterpreterService, cat73CostTracker, cat74SettingsManager, cat75SecurityIntegration, initApiGeminiExtended } from './tests/cat-api-gemini-extended.js';

// Cat 76-100 imports
import { cat76ObservationVariator, cat77RestorableCompression, cat78HeadTailTruncation, cat79StableJSON, cat80ContextManagerV3 } from './tests/cat-context-engineering.js';
import { cat81Sanitize, cat82GlobMatcher, cat83BaseURL, cat84CloudDeployConfigs, cat85NixConfig } from './tests/cat-sanitize-glob-deploy.js';
import { cat86SendPolicyEngine, cat87DMPairing, cat88ReconnectionManager, cat89OfflineQueue, cat90PluginManifest } from './tests/cat-channels-plugins.js';
import { cat91LessonsTracker, cat92TodoTracker, cat93ConversationBranching, cat94SelectiveRollback, cat95ThreeWayDiff } from './tests/cat-agent-advanced.js';
import { cat96AutoMemory, cat97MemoryFlush, cat98CodeQualityScorer, cat99SingletonUtility, cat100ConfigConstants } from './tests/cat-memory-tools-config.js';

// Cat 101-125 imports
import { cat101HookRegistry, cat102AdvancedHookRunner, cat103TOMLConfig, cat104EffortAutoCompact, cat105FallbackSettingSources } from './tests/cat-hooks-config-advanced.js';
import { cat106ToolGroupsPolicy, cat107ToolGroupMapping, cat108PlanTool, cat109CodebaseExplorer, cat110DevcontainerManager } from './tests/cat-tools-policy-explorer.js';
import { cat111ConfigBackupRotation, cat112FileSuggestionProvider, cat113TOMLRoundtrip, cat114ToolAliases, cat115AutoCompactUsage } from './tests/cat-config-backup-toml.js';
import { cat116LifecycleHooksManager, cat117LifecycleHookTypes, cat118MessagePreprocessing, cat119DefaultConfigUIAgent, cat120DefaultConfigIntegrations } from './tests/cat-lifecycle-preprocessing.js';
import { cat121ChannelCoreTypes, cat122ToolGroupsMappingExtended, cat123SettingSourceExtended, cat124ConfigBackupEdgeCases, cat125HookEventCoverage } from './tests/cat-channel-types-toolgroups.js';

dotenv.config();

const MODEL = 'gemini-2.5-flash';
const INTER_CATEGORY_DELAY = 2000;

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const provider = new GeminiProvider();

async function main() {
  if (!apiKey) {
    console.error('ERROR: Set GOOGLE_API_KEY or GEMINI_API_KEY');
    process.exit(1);
  }

  const extendedOnly = process.argv.includes('--extended-only');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Code Buddy — Extended Real-Conditions Test Suite           ║');
  console.log(`║  Categories: ${extendedOnly ? '26-125 (extended only)' : '26-125 (all)'}                              ║`);
  console.log('║  Model: Gemini 2.5 Flash                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`API Key: ${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  // Initialize provider for API tests
  await provider.initialize({ apiKey, model: MODEL });
  initApiAdvanced(provider, apiKey);
  initApiGeminiExtended(provider, apiKey);

  // Extended categories plan (Cat 26-50) — optimized order: no-API, API, no-API, API...
  const categoryPlan: CategoryDef[] = [
    // No-API batch 1
    { name: 'Cat 26: Context Manager V2', tests: cat26ContextManagerV2 },
    { name: 'Cat 27: Hybrid Memory Search', tests: cat27HybridSearch },
    { name: 'Cat 28: Identity Manager', tests: cat28IdentityManager },
    { name: 'Cat 29: Lifecycle Hooks', tests: cat29LifecycleHooks },
    { name: 'Cat 30: Security Modes', tests: cat30SecurityModes },
    { name: 'Cat 31: Skill Scanner', tests: cat31SkillScanner },
    { name: 'Cat 32: Tool Policy Groups', tests: cat32ToolPolicyGroups },
    // API batch 1
    { name: 'Cat 42: Advanced Gemini API', tests: cat42AdvancedGeminiAPI },
    // No-API batch 2
    { name: 'Cat 33: Message Preprocessing', tests: cat33MessagePreprocessing },
    { name: 'Cat 34: Prompt Suggestions', tests: cat34PromptSuggestions },
    { name: 'Cat 35: Gateway Types', tests: cat35GatewayTypes },
    { name: 'Cat 36: Daemon & Daily Reset', tests: cat36DaemonDailyReset },
    { name: 'Cat 37: Background Tasks', tests: cat37BackgroundTasks },
    // API batch 2
    { name: 'Cat 43: Multi-Turn Conversations', tests: cat43MultiTurn },
    // No-API batch 3
    { name: 'Cat 38: Tool Registry', tests: cat38ToolRegistry },
    { name: 'Cat 39: Tool Metadata', tests: cat39ToolMetadata },
    { name: 'Cat 40: Lobster Engine Extended', tests: cat40LobsterExtended },
    { name: 'Cat 41: Coding Style Analyzer', tests: cat41CodingStyleAnalyzer },
    // API batch 3
    { name: 'Cat 44: Provider Edge Cases', tests: cat44ProviderEdgeCases },
    // No-API batch 4
    { name: 'Cat 45: Channel Core', tests: cat45ChannelCore },
    { name: 'Cat 46: Niche Channels', tests: cat46NicheChannels },
    { name: 'Cat 47: PR Session Linker', tests: cat47PRSessionLinker },
    { name: 'Cat 48: Canvas Undo/Redo', tests: cat48CanvasUndoRender },
    { name: 'Cat 49: ROI Tracker Extended', tests: cat49ROIExtended },
    { name: 'Cat 50: Observability', tests: cat50Observability },

    // ===== Cat 51-75: Ultra-Extended =====

    // No-API batch 5
    { name: 'Cat 51: Checkpoint Manager', tests: cat51CheckpointManager },
    { name: 'Cat 52: Persona Manager', tests: cat52PersonaManager },
    { name: 'Cat 53: Conversation Exporter', tests: cat53ConversationExporter },
    { name: 'Cat 54: Token Counter', tests: cat54TokenCounter },
    { name: 'Cat 55: Retry Utility', tests: cat55RetryUtility },
    { name: 'Cat 56: LRU Cache', tests: cat56LRUCache },
    { name: 'Cat 57: Fuzzy Match', tests: cat57FuzzyMatch },

    // No-API batch 6
    { name: 'Cat 58: Rate Limiter', tests: cat58RateLimiter },
    { name: 'Cat 59: History Manager', tests: cat59HistoryManager },
    { name: 'Cat 60: Response Cache', tests: cat60ResponseCache },
    { name: 'Cat 61: Diff Generator', tests: cat61DiffGenerator },

    // No-API batch 7
    { name: 'Cat 62: Poll Manager', tests: cat62PollManager },
    { name: 'Cat 63: Auth Monitor', tests: cat63AuthMonitor },
    { name: 'Cat 64: Agent SDK', tests: cat64AgentSDK },
    { name: 'Cat 65: RTK Compressor', tests: cat65RTKCompressor },

    // No-API batch 8
    { name: 'Cat 66: Skill Parser', tests: cat66SkillParser },
    { name: 'Cat 67: Skill Registry', tests: cat67SkillRegistry },
    { name: 'Cat 68: Auto-Sandbox Router', tests: cat68AutoSandbox },
    { name: 'Cat 69: Confirmation Service', tests: cat69ConfirmationService },

    // API batch 4
    { name: 'Cat 70: Gemini Structured Output', tests: cat70GeminiStructuredOutput },
    { name: 'Cat 71: Gemini Streaming Extended', tests: cat71GeminiStreamingExtended },

    // No-API batch 9
    { name: 'Cat 72: Interpreter Service', tests: cat72InterpreterService },
    { name: 'Cat 73: Cost Tracker', tests: cat73CostTracker },
    { name: 'Cat 74: Settings Manager', tests: cat74SettingsManager },
    { name: 'Cat 75: Security Integration', tests: cat75SecurityIntegration },

    // ===== Cat 76-100: Mega-Extended =====

    // No-API batch 10: Context Engineering
    { name: 'Cat 76: Observation Variator', tests: cat76ObservationVariator },
    { name: 'Cat 77: Restorable Compression', tests: cat77RestorableCompression },
    { name: 'Cat 78: Head-Tail Truncation', tests: cat78HeadTailTruncation },
    { name: 'Cat 79: Stable JSON', tests: cat79StableJSON },
    { name: 'Cat 80: Context Manager V3', tests: cat80ContextManagerV3 },

    // No-API batch 11: Sanitize, Glob, Deploy
    { name: 'Cat 81: Sanitize Utilities', tests: cat81Sanitize },
    { name: 'Cat 82: Glob Matcher', tests: cat82GlobMatcher },
    { name: 'Cat 83: Base URL', tests: cat83BaseURL },
    { name: 'Cat 84: Cloud Deploy Configs', tests: cat84CloudDeployConfigs },
    { name: 'Cat 85: Nix Config', tests: cat85NixConfig },

    // No-API batch 12: Channels & Plugins
    { name: 'Cat 86: Send Policy Engine', tests: cat86SendPolicyEngine },
    { name: 'Cat 87: DM Pairing', tests: cat87DMPairing },
    { name: 'Cat 88: Reconnection Manager', tests: cat88ReconnectionManager },
    { name: 'Cat 89: Offline Queue', tests: cat89OfflineQueue },
    { name: 'Cat 90: Plugin Manifest', tests: cat90PluginManifest },

    // No-API batch 13: Agent & Advanced
    { name: 'Cat 91: Lessons Tracker', tests: cat91LessonsTracker },
    { name: 'Cat 92: Todo Tracker', tests: cat92TodoTracker },
    { name: 'Cat 93: Conversation Branching', tests: cat93ConversationBranching },
    { name: 'Cat 94: Selective Rollback', tests: cat94SelectiveRollback },
    { name: 'Cat 95: Three-Way Diff', tests: cat95ThreeWayDiff },

    // No-API batch 14: Memory, Tools, Config
    { name: 'Cat 96: Auto Memory', tests: cat96AutoMemory },
    { name: 'Cat 97: Memory Flush', tests: cat97MemoryFlush },
    { name: 'Cat 98: Code Quality Scorer', tests: cat98CodeQualityScorer },
    { name: 'Cat 99: Singleton Utility', tests: cat99SingletonUtility },
    { name: 'Cat 100: Config Constants', tests: cat100ConfigConstants },

    // ===== Cat 101-125: Giga-Extended =====

    // No-API batch 15: Hooks & Config Advanced
    { name: 'Cat 101: Hook Registry', tests: cat101HookRegistry },
    { name: 'Cat 102: Advanced Hook Runner', tests: cat102AdvancedHookRunner },
    { name: 'Cat 103: TOML Config', tests: cat103TOMLConfig },
    { name: 'Cat 104: Effort & AutoCompact', tests: cat104EffortAutoCompact },
    { name: 'Cat 105: Fallback & Setting Sources', tests: cat105FallbackSettingSources },

    // No-API batch 16: Tools, Policy & Explorer
    { name: 'Cat 106: Tool Groups Policy', tests: cat106ToolGroupsPolicy },
    { name: 'Cat 107: Tool Group Mapping', tests: cat107ToolGroupMapping },
    { name: 'Cat 108: Plan Tool', tests: cat108PlanTool },
    { name: 'Cat 109: Codebase Explorer', tests: cat109CodebaseExplorer },
    { name: 'Cat 110: Devcontainer Manager', tests: cat110DevcontainerManager },

    // No-API batch 17: Config Backup & TOML
    { name: 'Cat 111: Config Backup Rotation', tests: cat111ConfigBackupRotation },
    { name: 'Cat 112: File Suggestion Provider', tests: cat112FileSuggestionProvider },
    { name: 'Cat 113: TOML Roundtrip', tests: cat113TOMLRoundtrip },
    { name: 'Cat 114: Tool Aliases', tests: cat114ToolAliases },
    { name: 'Cat 115: AutoCompact Usage', tests: cat115AutoCompactUsage },

    // No-API batch 18: Lifecycle & Preprocessing
    { name: 'Cat 116: Lifecycle Hooks Manager', tests: cat116LifecycleHooksManager },
    { name: 'Cat 117: Lifecycle Hook Types', tests: cat117LifecycleHookTypes },
    { name: 'Cat 118: Message Preprocessing', tests: cat118MessagePreprocessing },
    { name: 'Cat 119: Default Config UI & Agent', tests: cat119DefaultConfigUIAgent },
    { name: 'Cat 120: Default Config Integrations', tests: cat120DefaultConfigIntegrations },

    // No-API batch 19: Channel Types & Tool Groups
    { name: 'Cat 121: Channel Core Types', tests: cat121ChannelCoreTypes },
    { name: 'Cat 122: Tool Groups Extended', tests: cat122ToolGroupsMappingExtended },
    { name: 'Cat 123: Setting Source Extended', tests: cat123SettingSourceExtended },
    { name: 'Cat 124: Config Backup Edge Cases', tests: cat124ConfigBackupEdgeCases },
    { name: 'Cat 125: Hook Event Coverage', tests: cat125HookEventCoverage },
  ];

  const allResults: CategoryResult[] = [];
  const totalStart = Date.now();

  for (let i = 0; i < categoryPlan.length; i++) {
    const cat = categoryPlan[i];

    console.log();
    console.log('────────────────────────────────────────────────────────────');
    console.log(`📦 ${cat.name}`);
    console.log('────────────────────────────────────────────────────────────');

    const tests = cat.tests();
    const result = await runCategory(cat.name, tests, cat.abortOnFirst);
    allResults.push(result);

    if (i < categoryPlan.length - 1) {
      await sleep(INTER_CATEGORY_DELAY);
    }
  }

  const totalDuration = Date.now() - totalStart;

  // Summary
  const totalTests = allResults.reduce((s, c) => s + c.tests.length, 0);
  const totalPassed = allResults.reduce((s, c) => s + c.passed, 0);
  const totalFailed = allResults.reduce((s, c) => s + c.failed, 0);
  const totalSkipped = allResults.reduce((s, c) => s + c.skipped, 0);
  const totalErrors = allResults.reduce((s, c) => s + c.errors, 0);
  const totalTokens = allResults.reduce((s, c) =>
    s + c.tests.reduce((ts, t) => ts + (t.tokenUsage?.totalTokens || 0), 0), 0);
  const estimatedCost = totalTokens * 0.075 / 1_000_000; // Gemini Flash pricing

  console.log();
  console.log();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                         FINAL REPORT                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  for (const cat of allResults) {
    const icon = cat.failed === 0 && cat.errors === 0 ? '✅' : '❌';
    const name = cat.name.padEnd(36);
    console.log(`║ ${icon} ${name} ${String(cat.passed).padStart(2)}/${String(cat.tests.length).padStart(2)} passed         ║`);
  }
  console.log('╠══════════════════════════════════════════════════════════════╣');
  const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';
  console.log(`║ Total: ${totalPassed}/${totalTests} passed (${passRate}%)`.padEnd(63) + '║');
  console.log(`║ Failed: ${totalFailed} | Errors: ${totalErrors} | Skipped: ${totalSkipped}`.padEnd(63) + '║');
  console.log(`║ Tokens: ${totalTokens} | Est. Cost: $${estimatedCost.toFixed(4)}`.padEnd(63) + '║');
  console.log(`║ Duration: ${(totalDuration / 1000).toFixed(1)}s`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Save report
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    totalDurationMs: totalDuration,
    categories: allResults,
    summary: {
      totalTests,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      errors: totalErrors,
      passRate: `${passRate}%`,
      totalTokensUsed: totalTokens,
      estimatedCostUSD: estimatedCost,
    },
  };

  const outDir = path.join(process.cwd(), '.custom-output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `gemini-extended-test-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved: ${path.relative(process.cwd(), reportPath)}`);

  // Exit code
  const mandatoryFailed = totalFailed + totalErrors;
  process.exit(mandatoryFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
