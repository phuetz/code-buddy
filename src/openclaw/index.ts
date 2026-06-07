/**
 * Enterprise-grade Modules
 *
 * This module exports all the advanced features Advanced enterprise architecture for,
 * the most advanced LLM client project on GitHub.
 *
 * Features included:
 * - Tool Policy System (allow/deny patterns with hierarchy)
 * - Tool Lifecycle Hooks (before/after tool calls)
 * - Smart Context Compaction (provider-aware, multi-strategy)
 * - Retry Fallback Engine (provider rotation, auto-compaction)
 * - Semantic Memory Search (2-step search + retrieve)
 * - Plugin Conflict Detection (allowlist, metadata tracking)
 */

// Tool Policy System
import {
  ToolPolicyEngine,
  getToolPolicyEngine as _getToolPolicyEngine,
  resetToolPolicyEngine as _resetToolPolicyEngine,
  isToolAllowed,
  filterToolsByPolicy,
  type ToolPolicyConfig,
  type PolicyHierarchy,
  type PolicyDecision,
} from '../security/tool-policy.js';

export {
  ToolPolicyEngine,
  _getToolPolicyEngine as getToolPolicyEngine,
  _resetToolPolicyEngine as resetToolPolicyEngine,
  isToolAllowed,
  filterToolsByPolicy,
  type ToolPolicyConfig,
  type PolicyHierarchy,
  type PolicyDecision,
};

// Tool Lifecycle Hooks
import {
  ToolLifecycleHooks,
  getToolLifecycleHooks as _getToolLifecycleHooks,
  resetToolLifecycleHooks as _resetToolLifecycleHooks,
  onBeforeToolCall,
  onAfterToolCall,
  onToolResultPersist,
  createLoggingHook,
  createRateLimitHook,
  createSanitizationHook,
  type HookEvent,
  type HookContext,
  type ToolCallContext,
  type ToolResultContext,
  type BeforeToolCallResult,
  type HookHandler,
} from '../hooks/tool-lifecycle-hooks.js';

export {
  ToolLifecycleHooks,
  _getToolLifecycleHooks as getToolLifecycleHooks,
  _resetToolLifecycleHooks as resetToolLifecycleHooks,
  onBeforeToolCall,
  onAfterToolCall,
  onToolResultPersist,
  createLoggingHook,
  createRateLimitHook,
  createSanitizationHook,
  type HookEvent,
  type HookContext,
  type ToolCallContext,
  type ToolResultContext,
  type BeforeToolCallResult,
  type HookHandler,
};

// Smart Context Compaction
import {
  SmartCompactionEngine,
  getSmartCompactionEngine as _getSmartCompactionEngine,
  resetSmartCompactionEngine as _resetSmartCompactionEngine,
  compactMessages,
  needsCompaction,
  type Message,
  type Provider,
  type ChannelType,
  type CompactionConfig,
  type CompactionResult,
  type CompactionStrategy,
} from '../context/smart-compaction.js';

export {
  SmartCompactionEngine,
  _getSmartCompactionEngine as getSmartCompactionEngine,
  _resetSmartCompactionEngine as resetSmartCompactionEngine,
  compactMessages,
  needsCompaction,
  type Message,
  type Provider,
  type ChannelType,
  type CompactionConfig,
  type CompactionResult,
  type CompactionStrategy,
};

// Retry Fallback Engine
import {
  RetryFallbackEngine,
  getRetryFallbackEngine as _getRetryFallbackEngine,
  resetRetryFallbackEngine as _resetRetryFallbackEngine,
  classifyError,
  withRetry,
  type AuthProfile,
  type ExecutionConfig,
  type ErrorType,
  type ClassifiedError,
  type ExecutionAttempt,
  type ExecutionResult,
} from '../agent/execution/retry-fallback.js';

export {
  RetryFallbackEngine,
  _getRetryFallbackEngine as getRetryFallbackEngine,
  _resetRetryFallbackEngine as resetRetryFallbackEngine,
  classifyError,
  withRetry,
  type AuthProfile,
  type ExecutionConfig,
  type ErrorType,
  type ClassifiedError,
  type ExecutionAttempt,
  type ExecutionResult,
};

// Semantic Memory Search
import {
  SemanticMemorySearch,
  getSemanticMemorySearch as _getSemanticMemorySearch,
  resetSemanticMemorySearch as _resetSemanticMemorySearch,
  searchAndRetrieve,
  type MemoryEntry,
  type SearchResult,
  type SearchOptions,
  type RetrievalOptions,
  type RetrievalResult,
  type MemorySearchConfig,
} from '../memory/semantic-memory-search.js';

export {
  SemanticMemorySearch,
  _getSemanticMemorySearch as getSemanticMemorySearch,
  _resetSemanticMemorySearch as resetSemanticMemorySearch,
  searchAndRetrieve,
  type MemoryEntry,
  type SearchResult,
  type SearchOptions,
  type RetrievalOptions,
  type RetrievalResult,
  type MemorySearchConfig,
};

// Plugin Conflict Detection
import {
  PluginConflictDetector,
  getPluginConflictDetector as _getPluginConflictDetector,
  resetPluginConflictDetector as _resetPluginConflictDetector,
  registerPlugins,
  type Plugin,
  type PluginTool,
  type PluginContext,
  type PluginToolMeta,
  type ConflictReport,
  type ConflictInfo,
  type AllowlistConfig,
} from '../plugins/conflict-detection.js';
export {
  attachOpenClawGateway,
  approveOpenClawPendingNode,
  buildOpenClawNodeDescriptor,
  buildOpenClawResponsePreview,
  callOpenClawGatewayWebSocket,
  discoverOpenClawGateway,
  getOpenClawGatewayAttachLogPath,
  getOpenClawGatewayLockfilePath,
  getOpenClawNodeLockfilePath,
  getOpenClawResponseSendLogPath,
  getOpenClawWebSocketCallLogPath,
  getOpenClawWebSocketProbeLogPath,
  listOpenClawPendingNodes,
  mapOpenClawChannelToCodeBuddy,
  prepareOpenClawFleetHandoffDraft,
  probeOpenClawGatewayWebSocket,
  sendOpenClawResponse,
  validateOpenClawUpstreamCompatibility,
  type OpenClawBridgeOptions,
  type OpenClawBridgeResponsePreview,
  type OpenClawFleetDispatchDraftInput,
  type OpenClawFleetHandoffDraft,
  type OpenClawGatewayAttachInput,
  type OpenClawGatewayAttachOptions,
  type OpenClawGatewayAttachRecord,
  type OpenClawGatewayAttachResult,
  type OpenClawGatewayDiscovery,
  type OpenClawGatewayDiscoveryOptions,
  type OpenClawGatewayLockfile,
  type OpenClawHttpTransport,
  type OpenClawHttpTransportResponse,
  type OpenClawInboundMessage,
  type OpenClawNodeLockfile,
  type OpenClawNodeDescriptor,
  type OpenClawNodePairingInput,
  type OpenClawApproveNodeInput,
  type OpenClawResponseSendInput,
  type OpenClawResponseSendOptions,
  type OpenClawResponseSendRecord,
  type OpenClawResponseSendResult,
  type OpenClawWebSocketCallInput,
  type OpenClawWebSocketCallOptions,
  type OpenClawWebSocketCallRecord,
  type OpenClawWebSocketCallResult,
  type OpenClawWebSocketProbeInput,
  type OpenClawWebSocketProbeOptions,
  type OpenClawWebSocketProbeRecord,
  type OpenClawWebSocketProbeResult,
  type OpenClawUpstreamValidationCheck,
  type OpenClawUpstreamValidationInput,
  type OpenClawUpstreamValidationResult,
} from './gateway-bridge.js';

export {
  PluginConflictDetector,
  _getPluginConflictDetector as getPluginConflictDetector,
  _resetPluginConflictDetector as resetPluginConflictDetector,
  registerPlugins,
  type Plugin,
  type PluginTool,
  type PluginContext,
  type PluginToolMeta,
  type ConflictReport,
  type ConflictInfo,
  type AllowlistConfig,
};

/**
 * Initialize all Native Engine modules with default configuration
 */
export function initializeNativeEngineModules(config: {
  builtInTools?: string[];
  policyHierarchy?: PolicyHierarchy;
  compactionConfig?: CompactionConfig;
  authProfiles?: AuthProfile[];
  memoryConfig?: MemorySearchConfig;
  allowlist?: AllowlistConfig;
} = {}): void {
  // Initialize Tool Policy
  if (config.policyHierarchy) {
    _getToolPolicyEngine(config.policyHierarchy);
  }

  // Initialize Compaction Engine
  if (config.compactionConfig) {
    _getSmartCompactionEngine(config.compactionConfig);
  }

  // Initialize Retry Engine
  if (config.authProfiles) {
    _getRetryFallbackEngine(config.authProfiles);
  }

  // Initialize Memory Search
  if (config.memoryConfig) {
    _getSemanticMemorySearch(config.memoryConfig);
  }

  // Initialize Plugin Conflict Detector
  _getPluginConflictDetector(config.builtInTools, config.allowlist);
}

/**
 * Reset all Native Engine module singletons
 */
export function resetAllNativeEngineModules(): void {
  _resetToolPolicyEngine();
  _resetToolLifecycleHooks();
  _resetSmartCompactionEngine();
  _resetRetryFallbackEngine();
  _resetSemanticMemorySearch();
  _resetPluginConflictDetector();
}
