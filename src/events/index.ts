/**
 * Events Module - Unified Type-Safe Event System
 *
 * This module provides a centralized, type-safe event system for the entire application.
 * It replaces the scattered use of native Node.js EventEmitter with a unified approach.
 *
 * ## Key Features
 *
 * - **Type-safe events**: Full TypeScript support with auto-completion
 * - **Event filtering**: Pattern matching and predicate-based filtering
 * - **Priority handling**: Control execution order of listeners
 * - **Once-only listeners**: Automatically removed after first call
 * - **Event history**: Track recent events for debugging
 * - **Wildcard listeners**: Subscribe to all events
 * - **Backward compatibility**: TypedEventEmitterAdapter for gradual migration
 *
 * ## Usage Examples
 *
 * ### Using TypedEventEmitter directly
 * ```typescript
 * import { TypedEventEmitter, ToolEvents } from './events/index.js';
 *
 * const emitter = new TypedEventEmitter<ToolEvents>();
 *
 * // Type-safe listener
 * emitter.on('tool:started', (event) => {
 *   console.log(`Tool ${event.toolName} started`);
 * });
 *
 * // Emit with auto-completion
 * emitter.emit('tool:started', { toolName: 'bash', args: { command: 'ls' } });
 * ```
 *
 * ### Using TypedEventEmitterAdapter for migration
 * ```typescript
 * import { TypedEventEmitterAdapter, ToolEvents } from './events/index.js';
 *
 * class MyClass extends TypedEventEmitterAdapter<ToolEvents> {
 *   doSomething() {
 *     // New type-safe API
 *     this.emitTyped('tool:started', { toolName: 'search' });
 *
 *     // Old API still works for backward compatibility
 *     this.emit('legacy-event', { data: 'value' });
 *   }
 * }
 * ```
 *
 * ### Using the global EventBus
 * ```typescript
 * import { getGlobalEventBus, AllEvents } from './events/index.js';
 *
 * const bus = getGlobalEventBus();
 * bus.on('agent:started', (event) => console.log('Agent started'));
 * bus.on('tool:completed', (event) => console.log(`Tool ${event.toolName} done`));
 * ```
 *
 * ## Event Categories
 *
 * - Agent events (`agent:*`): Agent lifecycle events
 * - Tool events (`tool:*`): Tool execution events
 * - Session events (`session:*`): User session events
 * - File events (`file:*`): File operation events
 * - Cache events (`cache:*`): Caching system events
 * - Sync events (`sync:*`): Cloud synchronization events
 * - Plugin events (`plugin:*`): Plugin system events
 * - MCP events (`mcp:*`): Model Context Protocol events
 * - Security events (`security:*`): Security-related events
 * - And many more...
 *
 * See the `AllEvents` interface for the complete list of available events.
 */

// Types - all interfaces, type definitions, and event type maps
export type {
  BaseEvent,
  EventListener,
  EventFilter,
  ListenerOptions,
  ListenerWrapper,
  EventHistoryEntry,
  EventStats,
  AgentEvent,
  ToolEvent,
  SessionEvent,
  MessageEvent,
  FileEvent,
  ApplicationEvents,
  CheckpointCreatedEvent,
  CheckpointDeletedEvent,
  UndoNoopEvent,
  RedoNoopEvent,
  UndoCompleteEvent,
  RedoCompleteEvent,
  RestoreCompleteEvent,
  CheckpointEvents,
  DatabaseInitializedEvent,
  DatabaseErrorEvent,
  DatabaseMigrationEvent,
  DatabaseVacuumEvent,
  DatabaseBackupEvent,
  DatabaseClosedEvent,
  DatabaseClearedEvent,
  DatabaseEvents,
  SyncStartedEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  SyncProgressEvent,
  SyncItemUploadedEvent,
  SyncItemDownloadedEvent,
  SyncConflictDetectedEvent,
  SyncConflictResolvedEvent,
  CloudSyncEvents,
  ToolRegisteredEvent,
  ToolInstantiatedEvent,
  ToolDisabledEvent,
  ToolEvents,
  CacheHitEvent,
  CacheMissEvent,
  CacheSetEvent,
  CacheDeleteEvent,
  CacheClearEvent,
  CacheExpiredEvent,
  CacheEvictedEvent,
  CacheEvents,
  PluginLoadedEvent,
  PluginUnloadedEvent,
  PluginErrorEvent,
  PluginInstalledEvent,
  PluginUninstalledEvent,
  PluginEvents,
  MCPConnectedEvent,
  MCPDisconnectedEvent,
  MCPErrorEvent,
  MCPToolCallEvent,
  MCPToolResultEvent,
  MCPEvents,
  ProviderConnectedEvent,
  ProviderDisconnectedEvent,
  ProviderErrorEvent,
  ProviderSwitchedEvent,
  ProviderFallbackEvent,
  ProviderEvents,
  SecurityPermissionGrantedEvent,
  SecurityPermissionDeniedEvent,
  SecurityModeChangedEvent,
  SecurityViolationEvent,
  SecurityEvents,
  WorkflowStartedEvent,
  WorkflowCompletedEvent,
  WorkflowStepStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowErrorEvent,
  WorkflowEvents,
  StreamStartedEvent,
  StreamChunkEvent,
  StreamCompletedEvent,
  StreamErrorEvent,
  StreamEvents,
  MemoryStoredEvent,
  MemoryRetrievedEvent,
  MemoryDeletedEvent,
  MemoryClearedEvent,
  MemoryEvents,
  ContextLoadedEvent,
  ContextUpdatedEvent,
  ContextCompressedEvent,
  ContextCompactionReason,
  ContextCompactionPayload,
  ContextPreCompactEvent,
  ContextPostCompactEvent,
  ContextEvents,
  PerformanceMetricEvent,
  PerformanceThresholdEvent,
  PerformanceEvents,
  SandboxCreatedEvent,
  SandboxDestroyedEvent,
  SandboxExecutionEvent,
  SandboxEvents,
  CostUpdatedEvent,
  CostLimitReachedEvent,
  CostWarningEvent,
  CostEvents,
  AllEvents,
} from './types.js';

// Classes
export { TypedEventEmitter, TypedEventEmitterAdapter } from './typed-emitter.js';
export { FilteredEventEmitter } from './filtered-emitter.js';
export { EventBus, getGlobalEventBus, getEventBus, resetEventBus } from './event-bus.js';

// Type guards
export {
  isEventType,
  isAgentEvent,
  isToolEvent,
  isSessionEvent,
  isFileEvent,
  isCacheEvent,
  isSyncEvent,
} from './type-guards.js';
