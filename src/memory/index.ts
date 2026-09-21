/**
 * Memory System Exports
 *
 * Provides three memory subsystems:
 * - PersistentMemoryManager: Markdown-based project/user memories
 * - EnhancedMemory: SQLite-backed with embeddings and semantic search
 * - ProspectiveMemory: Task/goal management with triggers
 */

// Persistent Memory (markdown files)
export {
  PersistentMemoryManager,
  getMemoryManager,
  initializeMemory,
  type Memory,
  type MemoryCategory,
  type MemoryScope,
  type MemoryUsage,
  type MemoryWriteResult,
  MemoryWriteRejectedError,
} from "./persistent-memory.js";

// Review-gated long-term memory candidates
export {
  MemoryCandidateQueue,
  getMemoryCandidateQueue,
  resetMemoryCandidateQueues,
  MEMORY_CANDIDATE_SCHEMA_VERSION,
  type MemoryCandidate,
  type MemoryCandidateCitation,
  type MemoryCandidateSource,
  type MemoryCandidateStatus,
  type MemoryCandidateStats,
  type ProposeMemoryCandidateInput,
  type ProposeMemoryCandidateResult,
  type AcceptMemoryCandidateInput,
  type AcceptMemoryCandidateResult,
  type RejectMemoryCandidateInput,
} from "./memory-candidate-queue.js";

export {
  proposeMemoryCandidatesFromSession,
  buildMemoryCitations,
  extractHeuristicMemoryCandidates,
} from "./memory-auto-proposer.js";

// Enhanced Memory (SQLite + embeddings)
export {
  EnhancedMemory,
  getEnhancedMemory,
  resetEnhancedMemory,
  type MemoryEntry,
  type MemoryType,
  type MemoryConfig,
  type ProjectMemory,
  type CodeConvention,
  type ConversationSummary,
  type UserProfile,
  type UserPreferences,
  type SkillLevel,
  type UserHistory,
  type MemorySearchOptions,
} from "./enhanced-memory.js";

// Prospective Memory (tasks, goals, reminders)
export {
  ProspectiveMemory,
  getProspectiveMemory,
  resetProspectiveMemory,
  initializeProspectiveMemory,
  type ProspectiveTask,
  type Goal,
  type Reminder,
  type TaskPriority,
  type TaskStatus,
  type TriggerType,
  type TaskTrigger,
  type TaskContext,
  type SubTask,
  type Milestone,
  type ProspectiveMemoryConfig,
} from "./prospective-memory.js";

// Auto-Capture (Enterprise-grade pattern detection)
export {
  AutoCaptureManager,
  getAutoCaptureManager,
  resetAutoCaptureManager,
  type CapturePattern,
  type CaptureResult,
  type AutoCaptureConfig,
  type MemoryRecallResult,
} from "./auto-capture.js";

// Memory Lifecycle Hooks (before/after execution)
export {
  MemoryLifecycleHooks,
  getMemoryLifecycleHooks,
  resetMemoryLifecycleHooks,
  type MemoryHookContext,
  type BeforeExecuteResult,
  type AfterResponseResult,
  type SessionEndResult,
  type MemoryLifecycleConfig,
} from "./memory-lifecycle-hooks.js";

// Semantic Memory Search
export {
  SemanticMemorySearch,
  getSemanticMemorySearch,
  resetSemanticMemorySearch,
  searchAndRetrieve,
  type SearchResult,
  type SearchOptions,
  type RetrievalOptions,
  type RetrievalResult,
  type MemorySearchConfig,
} from "./semantic-memory-search.js";

// Knowledge Graph (memU-inspired persistent entity/relation memory)
export {
  KnowledgeGraph,
  getKnowledgeGraph,
  resetKnowledgeGraph,
  type Entity,
  type Relation,
  type EntityType,
  type RelationType,
  type GraphQuery,
  type GraphContext,
  type MemoryCategory as KGMemoryCategory,
  computeSalience,
  contentHash,
  isTrivialMessage,
} from "./knowledge-graph.js";

// OCR Memory Pipeline (screenshot/image -> text -> embeddings -> search)
export {
  OCRMemoryPipeline,
  getOCRMemoryPipeline,
  resetOCRMemoryPipeline,
  type OCRMemoryEntry,
} from "./ocr-memory-pipeline.js";

// Cross-Modal Search (text <-> image semantic search)
export {
  CrossModalSearch,
  getCrossModalSearch,
  resetCrossModalSearch,
  type CrossModalResult,
  type CrossModalSearchOptions,
} from "./cross-modal-search.js";

// Session Metrics Tracker (fills SESSION_METRICS for the cron hook)
export {
  beginSession,
  recordToolCall,
  recordRecoveredError,
  recordFileTouched,
  setSessionSummary,
  endSession,
  loadSessionMetrics,
  currentSessionMetricsEnv,
  type SessionMetrics,
} from "./session-metrics-tracker.js";

// Memory Reviver (clean + promote agent memories)
export {
  reviveMemory,
  loadRevivedSummary,
  extractRealEntries,
  isPlaceholderEntry,
  type ReviverOptions,
  type ReviveResult,
} from "./memory-reviver.js";
