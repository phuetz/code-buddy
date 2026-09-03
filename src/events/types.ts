/**
 * Event Types Module
 *
 * All interfaces, type definitions, and event type maps for the unified event system.
 */

/**
 * Base event interface that all events must extend
 */
export interface BaseEvent {
  type: string;
  timestamp: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Event listener callback type
 * Note: Returns unknown to allow flexible listener implementations (e.g., array.push in tests)
 */
export type EventListener<T extends BaseEvent = BaseEvent> = (event: T) => unknown;

/**
 * Event filter predicate
 */
export type EventFilter<T extends BaseEvent = BaseEvent> = (event: T) => boolean;

/**
 * Listener options
 */
export interface ListenerOptions<T extends BaseEvent = BaseEvent> {
  once?: boolean;
  priority?: number;
  filter?: EventFilter<T>;
}

/**
 * Internal listener wrapper with metadata
 */
export interface ListenerWrapper<T extends BaseEvent = BaseEvent> {
  listener: EventListener<T>;
  options: ListenerOptions<T>;
  id: string;
}

/**
 * Event history entry
 */
export interface EventHistoryEntry<T extends BaseEvent = BaseEvent> {
  event: T;
  timestamp: number;
  listenerCount: number;
}

/**
 * Event statistics
 */
export interface EventStats {
  totalEmitted: number;
  totalListeners: number;
  eventCounts: Record<string, number>;
  lastEmitted?: BaseEvent;
}

// ============================================================================
// Common Application Event Types
// ============================================================================

export interface AgentEvent extends BaseEvent {
  type: 'agent:started' | 'agent:stopped' | 'agent:error';
  agentId?: string;
  error?: Error;
}

export interface ToolEvent extends BaseEvent {
  type: 'tool:started' | 'tool:completed' | 'tool:error';
  toolName: string;
  args?: Record<string, unknown>;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
  duration?: number;
}

export interface SessionEvent extends BaseEvent {
  type: 'session:started' | 'session:ended' | 'session:paused' | 'session:resumed';
  sessionId: string;
  userId?: string;
}

export interface MessageEvent extends BaseEvent {
  type: 'message:sent' | 'message:received' | 'message:error';
  messageId?: string;
  content?: string;
  role?: 'user' | 'assistant' | 'system';
}

export interface FileEvent extends BaseEvent {
  type: 'file:created' | 'file:modified' | 'file:deleted' | 'file:read';
  filePath: string;
  operation?: string;
}

// Combined application events map with index signature for compatibility
export interface ApplicationEvents extends Record<string, BaseEvent> {
  'agent:started': AgentEvent;
  'agent:stopped': AgentEvent;
  'agent:error': AgentEvent;
  'tool:started': ToolEvent;
  'tool:completed': ToolEvent;
  'tool:error': ToolEvent;
  'session:started': SessionEvent;
  'session:ended': SessionEvent;
  'session:paused': SessionEvent;
  'session:resumed': SessionEvent;
  'message:sent': MessageEvent;
  'message:received': MessageEvent;
  'message:error': MessageEvent;
  'file:created': FileEvent;
  'file:modified': FileEvent;
  'file:deleted': FileEvent;
  'file:read': FileEvent;
}

// ============================================================================
// Checkpoint Events
// ============================================================================

export interface CheckpointCreatedEvent extends BaseEvent {
  type: 'checkpoint:created';
  checkpoint: {
    id: string;
    name: string;
    timestamp: Date;
    files: Array<{ relativePath: string }>;
  };
}

export interface CheckpointDeletedEvent extends BaseEvent {
  type: 'checkpoint:deleted';
  id: string;
}

export interface UndoNoopEvent extends BaseEvent {
  type: 'undo:noop';
  reason: string;
}

export interface RedoNoopEvent extends BaseEvent {
  type: 'redo:noop';
  reason: string;
}

export interface UndoCompleteEvent extends BaseEvent {
  type: 'undo:complete';
  success: boolean;
  checkpoint: { id: string; name: string };
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface RedoCompleteEvent extends BaseEvent {
  type: 'redo:complete';
  success: boolean;
  checkpoint: { id: string; name: string };
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface RestoreCompleteEvent extends BaseEvent {
  type: 'restore:complete';
  success: boolean;
  checkpoint: { id: string; name: string };
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface CheckpointEvents extends Record<string, BaseEvent> {
  'checkpoint:created': CheckpointCreatedEvent;
  'checkpoint:deleted': CheckpointDeletedEvent;
  'undo:noop': UndoNoopEvent;
  'redo:noop': RedoNoopEvent;
  'undo:complete': UndoCompleteEvent;
  'redo:complete': RedoCompleteEvent;
  'restore:complete': RestoreCompleteEvent;
}

// ============================================================================
// Database Events
// ============================================================================

export interface DatabaseInitializedEvent extends BaseEvent {
  type: 'db:initialized';
}

export interface DatabaseErrorEvent extends BaseEvent {
  type: 'db:error';
  error: Error;
}

export interface DatabaseMigrationEvent extends BaseEvent {
  type: 'db:migration';
  version: number;
  applied: boolean;
}

export interface DatabaseVacuumEvent extends BaseEvent {
  type: 'db:vacuum';
}

export interface DatabaseBackupEvent extends BaseEvent {
  type: 'db:backup';
  path: string;
}

export interface DatabaseClosedEvent extends BaseEvent {
  type: 'db:closed';
}

export interface DatabaseClearedEvent extends BaseEvent {
  type: 'db:cleared';
}

export interface DatabaseEvents extends Record<string, BaseEvent> {
  'db:initialized': DatabaseInitializedEvent;
  'db:error': DatabaseErrorEvent;
  'db:migration': DatabaseMigrationEvent;
  'db:vacuum': DatabaseVacuumEvent;
  'db:backup': DatabaseBackupEvent;
  'db:closed': DatabaseClosedEvent;
  'db:cleared': DatabaseClearedEvent;
}

// ============================================================================
// Sync Events
// ============================================================================

export interface SyncStartedEvent extends BaseEvent {
  type: 'sync:started';
  direction?: 'push' | 'pull' | 'bidirectional';
}

export interface SyncCompletedEvent extends BaseEvent {
  type: 'sync:completed';
  result: {
    success: boolean;
    itemsSynced: number;
    bytesUploaded: number;
    bytesDownloaded: number;
    duration: number;
  };
}

export interface SyncFailedEvent extends BaseEvent {
  type: 'sync:failed';
  error: string;
}

export interface SyncProgressEvent extends BaseEvent {
  type: 'sync:progress';
  progress: number;
}

export interface SyncItemUploadedEvent extends BaseEvent {
  type: 'sync:item_uploaded';
  path: string;
  size: number;
}

export interface SyncItemDownloadedEvent extends BaseEvent {
  type: 'sync:item_downloaded';
  path: string;
  size: number;
}

export interface SyncConflictDetectedEvent extends BaseEvent {
  type: 'sync:conflict_detected';
  conflict: {
    path: string;
    local: { version: string; modifiedAt: Date; size: number };
    remote: { version: string; modifiedAt: Date; size: number };
  };
}

export interface SyncConflictResolvedEvent extends BaseEvent {
  type: 'sync:conflict_resolved';
  conflict: {
    path: string;
    resolution?: 'local' | 'remote' | 'merged';
  };
}

export interface CloudSyncEvents extends Record<string, BaseEvent> {
  'sync:started': SyncStartedEvent;
  'sync:completed': SyncCompletedEvent;
  'sync:failed': SyncFailedEvent;
  'sync:progress': SyncProgressEvent;
  'sync:item_uploaded': SyncItemUploadedEvent;
  'sync:item_downloaded': SyncItemDownloadedEvent;
  'sync:conflict_detected': SyncConflictDetectedEvent;
  'sync:conflict_resolved': SyncConflictResolvedEvent;
}

// ============================================================================
// Tool Events (Extended)
// ============================================================================

export interface ToolRegisteredEvent extends BaseEvent {
  type: 'tool:registered';
  toolName: string;
  description?: string;
}

export interface ToolInstantiatedEvent extends BaseEvent {
  type: 'tool:instantiated';
  toolName: string;
}

export interface ToolDisabledEvent extends BaseEvent {
  type: 'tool:disabled';
  toolName: string;
  reason?: string;
}

export interface ToolEvents extends Record<string, BaseEvent> {
  'tool:started': ToolEvent;
  'tool:completed': ToolEvent;
  'tool:error': ToolEvent;
  'tool:registered': ToolRegisteredEvent;
  'tool:instantiated': ToolInstantiatedEvent;
  'tool:disabled': ToolDisabledEvent;
}

// ============================================================================
// Cache Events
// ============================================================================

export interface CacheHitEvent extends BaseEvent {
  type: 'cache:hit';
  key: string;
  cacheType?: string;
}

export interface CacheMissEvent extends BaseEvent {
  type: 'cache:miss';
  key: string;
  cacheType?: string;
}

export interface CacheSetEvent extends BaseEvent {
  type: 'cache:set';
  key: string;
  size?: number;
  ttl?: number;
}

export interface CacheDeleteEvent extends BaseEvent {
  type: 'cache:delete';
  key: string;
}

export interface CacheClearEvent extends BaseEvent {
  type: 'cache:clear';
  entriesRemoved?: number;
}

export interface CacheExpiredEvent extends BaseEvent {
  type: 'cache:expired';
  key: string;
}

export interface CacheEvictedEvent extends BaseEvent {
  type: 'cache:evicted';
  key: string;
  reason: 'size' | 'ttl' | 'manual';
}

export interface CacheEvents extends Record<string, BaseEvent> {
  'cache:hit': CacheHitEvent;
  'cache:miss': CacheMissEvent;
  'cache:set': CacheSetEvent;
  'cache:delete': CacheDeleteEvent;
  'cache:clear': CacheClearEvent;
  'cache:expired': CacheExpiredEvent;
  'cache:evicted': CacheEvictedEvent;
}

// ============================================================================
// Plugin Events
// ============================================================================

export interface PluginLoadedEvent extends BaseEvent {
  type: 'plugin:loaded';
  pluginId: string;
  pluginName: string;
  version?: string;
}

export interface PluginUnloadedEvent extends BaseEvent {
  type: 'plugin:unloaded';
  pluginId: string;
}

export interface PluginErrorEvent extends BaseEvent {
  type: 'plugin:error';
  pluginId: string;
  error: string;
}

export interface PluginInstalledEvent extends BaseEvent {
  type: 'plugin:installed';
  pluginId: string;
  source: string;
}

export interface PluginUninstalledEvent extends BaseEvent {
  type: 'plugin:uninstalled';
  pluginId: string;
}

export interface PluginEvents extends Record<string, BaseEvent> {
  'plugin:loaded': PluginLoadedEvent;
  'plugin:unloaded': PluginUnloadedEvent;
  'plugin:error': PluginErrorEvent;
  'plugin:installed': PluginInstalledEvent;
  'plugin:uninstalled': PluginUninstalledEvent;
}

// ============================================================================
// MCP Events
// ============================================================================

export interface MCPConnectedEvent extends BaseEvent {
  type: 'mcp:connected';
  serverId: string;
  serverName?: string;
}

export interface MCPDisconnectedEvent extends BaseEvent {
  type: 'mcp:disconnected';
  serverId: string;
  reason?: string;
}

export interface MCPErrorEvent extends BaseEvent {
  type: 'mcp:error';
  serverId: string;
  error: string;
}

export interface MCPToolCallEvent extends BaseEvent {
  type: 'mcp:tool_call';
  serverId: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface MCPToolResultEvent extends BaseEvent {
  type: 'mcp:tool_result';
  serverId: string;
  toolName: string;
  success: boolean;
  duration?: number;
}

export interface MCPEvents extends Record<string, BaseEvent> {
  'mcp:connected': MCPConnectedEvent;
  'mcp:disconnected': MCPDisconnectedEvent;
  'mcp:error': MCPErrorEvent;
  'mcp:tool_call': MCPToolCallEvent;
  'mcp:tool_result': MCPToolResultEvent;
}

// ============================================================================
// Provider Events
// ============================================================================

export interface ProviderConnectedEvent extends BaseEvent {
  type: 'provider:connected';
  providerId: string;
  providerName: string;
}

export interface ProviderDisconnectedEvent extends BaseEvent {
  type: 'provider:disconnected';
  providerId: string;
}

export interface ProviderErrorEvent extends BaseEvent {
  type: 'provider:error';
  providerId: string;
  error: string;
}

export interface ProviderSwitchedEvent extends BaseEvent {
  type: 'provider:switched';
  fromProvider?: string;
  toProvider: string;
}

export interface ProviderFallbackEvent extends BaseEvent {
  type: 'provider:fallback';
  fromProvider: string;
  toProvider: string;
  reason: string;
}

export interface ProviderEvents extends Record<string, BaseEvent> {
  'provider:connected': ProviderConnectedEvent;
  'provider:disconnected': ProviderDisconnectedEvent;
  'provider:error': ProviderErrorEvent;
  'provider:switched': ProviderSwitchedEvent;
  'provider:fallback': ProviderFallbackEvent;
}

// ============================================================================
// Security Events
// ============================================================================

export interface SecurityPermissionGrantedEvent extends BaseEvent {
  type: 'security:permission_granted';
  permission: string;
  resource?: string;
}

export interface SecurityPermissionDeniedEvent extends BaseEvent {
  type: 'security:permission_denied';
  permission: string;
  resource?: string;
  reason?: string;
}

export interface SecurityModeChangedEvent extends BaseEvent {
  type: 'security:mode_changed';
  fromMode: string;
  toMode: string;
}

export interface SecurityViolationEvent extends BaseEvent {
  type: 'security:violation';
  violationType: string;
  details: string;
}

export interface SecurityEvents extends Record<string, BaseEvent> {
  'security:permission_granted': SecurityPermissionGrantedEvent;
  'security:permission_denied': SecurityPermissionDeniedEvent;
  'security:mode_changed': SecurityModeChangedEvent;
  'security:violation': SecurityViolationEvent;
}

// ============================================================================
// Workflow Events
// ============================================================================

export interface WorkflowStartedEvent extends BaseEvent {
  type: 'workflow:started';
  workflowId: string;
  workflowName: string;
}

export interface WorkflowCompletedEvent extends BaseEvent {
  type: 'workflow:completed';
  workflowId: string;
  success: boolean;
  duration?: number;
}

export interface WorkflowStepStartedEvent extends BaseEvent {
  type: 'workflow:step_started';
  workflowId: string;
  stepId: string;
  stepName: string;
}

export interface WorkflowStepCompletedEvent extends BaseEvent {
  type: 'workflow:step_completed';
  workflowId: string;
  stepId: string;
  success: boolean;
}

export interface WorkflowErrorEvent extends BaseEvent {
  type: 'workflow:error';
  workflowId: string;
  stepId?: string;
  error: string;
}

export interface WorkflowEvents extends Record<string, BaseEvent> {
  'workflow:started': WorkflowStartedEvent;
  'workflow:completed': WorkflowCompletedEvent;
  'workflow:step_started': WorkflowStepStartedEvent;
  'workflow:step_completed': WorkflowStepCompletedEvent;
  'workflow:error': WorkflowErrorEvent;
}

// ============================================================================
// Streaming Events
// ============================================================================

export interface StreamStartedEvent extends BaseEvent {
  type: 'stream:started';
  streamId: string;
}

export interface StreamChunkEvent extends BaseEvent {
  type: 'stream:chunk';
  streamId: string;
  chunkSize: number;
  totalReceived?: number;
}

export interface StreamCompletedEvent extends BaseEvent {
  type: 'stream:completed';
  streamId: string;
  totalSize: number;
  duration?: number;
}

export interface StreamErrorEvent extends BaseEvent {
  type: 'stream:error';
  streamId: string;
  error: string;
}

export interface StreamEvents extends Record<string, BaseEvent> {
  'stream:started': StreamStartedEvent;
  'stream:chunk': StreamChunkEvent;
  'stream:completed': StreamCompletedEvent;
  'stream:error': StreamErrorEvent;
}

// ============================================================================
// Memory Events
// ============================================================================

export interface MemoryStoredEvent extends BaseEvent {
  type: 'memory:stored';
  memoryId: string;
  memoryType: string;
}

export interface MemoryRetrievedEvent extends BaseEvent {
  type: 'memory:retrieved';
  memoryId: string;
  memoryType: string;
}

export interface MemoryDeletedEvent extends BaseEvent {
  type: 'memory:deleted';
  memoryId: string;
}

export interface MemoryClearedEvent extends BaseEvent {
  type: 'memory:cleared';
  entriesRemoved: number;
}

export interface MemoryEvents extends Record<string, BaseEvent> {
  'memory:stored': MemoryStoredEvent;
  'memory:retrieved': MemoryRetrievedEvent;
  'memory:deleted': MemoryDeletedEvent;
  'memory:cleared': MemoryClearedEvent;
}

// ============================================================================
// Context Events
// ============================================================================

export interface ContextLoadedEvent extends BaseEvent {
  type: 'context:loaded';
  contextType: string;
  size?: number;
}

export interface ContextUpdatedEvent extends BaseEvent {
  type: 'context:updated';
  contextType: string;
  changeType: 'add' | 'remove' | 'modify';
}

export interface ContextCompressedEvent extends BaseEvent {
  type: 'context:compressed';
  originalSize: number;
  compressedSize: number;
}

export type ContextCompactionReason = 'auto' | 'manual' | 'plugin';

export interface ContextCompactionPayload {
  reason: ContextCompactionReason;
  tokensBefore: number;
  tokensAfter?: number;
  messagesBefore: number;
  messagesAfter?: number;
  droppedSegmentIds?: string[];
}

export interface ContextPreCompactEvent extends BaseEvent, ContextCompactionPayload {
  type: 'context:pre_compact';
}

export interface ContextPostCompactEvent extends BaseEvent, ContextCompactionPayload {
  type: 'context:post_compact';
}

export interface ContextEvents extends Record<string, BaseEvent> {
  'context:loaded': ContextLoadedEvent;
  'context:updated': ContextUpdatedEvent;
  'context:compressed': ContextCompressedEvent;
  'context:pre_compact': ContextPreCompactEvent;
  'context:post_compact': ContextPostCompactEvent;
}

// ============================================================================
// Performance Events
// ============================================================================

export interface PerformanceMetricEvent extends BaseEvent {
  type: 'perf:metric';
  metricName: string;
  value: number;
  unit?: string;
}

export interface PerformanceThresholdEvent extends BaseEvent {
  type: 'perf:threshold';
  metricName: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

export interface PerformanceEvents extends Record<string, BaseEvent> {
  'perf:metric': PerformanceMetricEvent;
  'perf:threshold': PerformanceThresholdEvent;
}

// ============================================================================
// Sandbox Events
// ============================================================================

export interface SandboxCreatedEvent extends BaseEvent {
  type: 'sandbox:created';
  sandboxId: string;
  sandboxType: 'docker' | 'os' | 'process';
}

export interface SandboxDestroyedEvent extends BaseEvent {
  type: 'sandbox:destroyed';
  sandboxId: string;
}

export interface SandboxExecutionEvent extends BaseEvent {
  type: 'sandbox:execution';
  sandboxId: string;
  command: string;
  exitCode?: number;
}

export interface SandboxEvents extends Record<string, BaseEvent> {
  'sandbox:created': SandboxCreatedEvent;
  'sandbox:destroyed': SandboxDestroyedEvent;
  'sandbox:execution': SandboxExecutionEvent;
}

// ============================================================================
// Cost Events
// ============================================================================

export interface CostUpdatedEvent extends BaseEvent {
  type: 'cost:updated';
  currentCost: number;
  sessionLimit: number;
}

export interface CostLimitReachedEvent extends BaseEvent {
  type: 'cost:limit_reached';
  currentCost: number;
  limit: number;
}

export interface CostWarningEvent extends BaseEvent {
  type: 'cost:warning';
  currentCost: number;
  threshold: number;
  percentUsed: number;
}

export interface CostEvents extends Record<string, BaseEvent> {
  'cost:updated': CostUpdatedEvent;
  'cost:limit_reached': CostLimitReachedEvent;
  'cost:warning': CostWarningEvent;
}

// ============================================================================

// ============================================================================
// Fleet Events
// ============================================================================

export interface FleetActivityEvent extends BaseEvent {
  type: 'fleet:activity';
  activityType: string;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface FleetEvents extends Record<string, BaseEvent> {
  'fleet:activity': FleetActivityEvent;
}

// All Events Map (Unified)
// ============================================================================

/**
 * Complete map of all application events.
 * This is the master type for the unified event system.
 */
export interface AllEvents extends Record<string, BaseEvent> {
  // Agent Events
  'agent:started': AgentEvent;
  'agent:stopped': AgentEvent;
  'agent:error': AgentEvent;

  // Tool Events
  'tool:started': ToolEvent;
  'tool:completed': ToolEvent;
  'tool:error': ToolEvent;
  'tool:registered': ToolRegisteredEvent;
  'tool:instantiated': ToolInstantiatedEvent;
  'tool:disabled': ToolDisabledEvent;

  // Session Events
  'session:started': SessionEvent;
  'session:ended': SessionEvent;
  'session:paused': SessionEvent;
  'session:resumed': SessionEvent;

  // Message Events
  'message:sent': MessageEvent;
  'message:received': MessageEvent;
  'message:error': MessageEvent;

  // File Events
  'file:created': FileEvent;
  'file:modified': FileEvent;
  'file:deleted': FileEvent;
  'file:read': FileEvent;

  // Checkpoint Events
  'checkpoint:created': CheckpointCreatedEvent;
  'checkpoint:deleted': CheckpointDeletedEvent;
  'undo:noop': UndoNoopEvent;
  'redo:noop': RedoNoopEvent;
  'undo:complete': UndoCompleteEvent;
  'redo:complete': RedoCompleteEvent;
  'restore:complete': RestoreCompleteEvent;

  // Database Events
  'db:initialized': DatabaseInitializedEvent;
  'db:error': DatabaseErrorEvent;
  'db:migration': DatabaseMigrationEvent;
  'db:vacuum': DatabaseVacuumEvent;
  'db:backup': DatabaseBackupEvent;
  'db:closed': DatabaseClosedEvent;
  'db:cleared': DatabaseClearedEvent;

  // Sync Events
  'sync:started': SyncStartedEvent;
  'sync:completed': SyncCompletedEvent;
  'sync:failed': SyncFailedEvent;
  'sync:progress': SyncProgressEvent;
  'sync:item_uploaded': SyncItemUploadedEvent;
  'sync:item_downloaded': SyncItemDownloadedEvent;
  'sync:conflict_detected': SyncConflictDetectedEvent;
  'sync:conflict_resolved': SyncConflictResolvedEvent;

  // Cache Events
  'cache:hit': CacheHitEvent;
  'cache:miss': CacheMissEvent;
  'cache:set': CacheSetEvent;
  'cache:delete': CacheDeleteEvent;
  'cache:clear': CacheClearEvent;
  'cache:expired': CacheExpiredEvent;
  'cache:evicted': CacheEvictedEvent;

  // Plugin Events
  'plugin:loaded': PluginLoadedEvent;
  'plugin:unloaded': PluginUnloadedEvent;
  'plugin:error': PluginErrorEvent;
  'plugin:installed': PluginInstalledEvent;
  'plugin:uninstalled': PluginUninstalledEvent;

  // MCP Events
  'mcp:connected': MCPConnectedEvent;
  'mcp:disconnected': MCPDisconnectedEvent;
  'mcp:error': MCPErrorEvent;
  'mcp:tool_call': MCPToolCallEvent;
  'mcp:tool_result': MCPToolResultEvent;

  // Provider Events
  'provider:connected': ProviderConnectedEvent;
  'provider:disconnected': ProviderDisconnectedEvent;
  'provider:error': ProviderErrorEvent;
  'provider:switched': ProviderSwitchedEvent;
  'provider:fallback': ProviderFallbackEvent;

  // Security Events
  'security:permission_granted': SecurityPermissionGrantedEvent;
  'security:permission_denied': SecurityPermissionDeniedEvent;
  'security:mode_changed': SecurityModeChangedEvent;
  'security:violation': SecurityViolationEvent;

  // Workflow Events
  'workflow:started': WorkflowStartedEvent;
  'workflow:completed': WorkflowCompletedEvent;
  'workflow:step_started': WorkflowStepStartedEvent;
  'workflow:step_completed': WorkflowStepCompletedEvent;
  'workflow:error': WorkflowErrorEvent;

  // Stream Events
  'stream:started': StreamStartedEvent;
  'stream:chunk': StreamChunkEvent;
  'stream:completed': StreamCompletedEvent;
  'stream:error': StreamErrorEvent;

  // Memory Events
  'memory:stored': MemoryStoredEvent;
  'memory:retrieved': MemoryRetrievedEvent;
  'memory:deleted': MemoryDeletedEvent;
  'memory:cleared': MemoryClearedEvent;

  // Context Events
  'context:loaded': ContextLoadedEvent;
  'context:updated': ContextUpdatedEvent;
  'context:compressed': ContextCompressedEvent;
  'context:pre_compact': ContextPreCompactEvent;
  'context:post_compact': ContextPostCompactEvent;

  // Performance Events
  'perf:metric': PerformanceMetricEvent;
  'perf:threshold': PerformanceThresholdEvent;

  // Sandbox Events
  'sandbox:created': SandboxCreatedEvent;
  'sandbox:destroyed': SandboxDestroyedEvent;
  'sandbox:execution': SandboxExecutionEvent;

  // Fleet Events
  'fleet:activity': FleetActivityEvent;

  // Cost Events
  'cost:updated': CostUpdatedEvent;
  'cost:limit_reached': CostLimitReachedEvent;
  'cost:warning': CostWarningEvent;
}
