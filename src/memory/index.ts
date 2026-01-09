/**
 * Memory System Exports
 *
 * Provides three memory subsystems:
 * - PersistentMemoryManager: Markdown-based project/user memories
 * - EnhancedMemory: SQLite-backed with embeddings and semantic search
 * - ProspectiveMemory: Task/goal management with triggers
 */

// Persistent Memory (markdown files)
export * from "./persistent-memory.js";

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
