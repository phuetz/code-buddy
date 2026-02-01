/**
 * Session Pruning Module
 *
 * Automatic session and memory pruning based on configurable rules.
 */

// Types
export type {
  PruningRule,
  PruningCondition,
  AgePruningCondition,
  CountPruningCondition,
  SizePruningCondition,
  TokenPruningCondition,
  TypePruningCondition,
  CustomPruningCondition,
  PruningAction,
  DeletePruningAction,
  ArchivePruningAction,
  SummarizePruningAction,
  CompactPruningAction,
  PruningConfig,
  SessionPruningConfig,
  PruningThresholds,
  PrunableItem,
  PruningCandidate,
  PruningResult,
  PrunedItem,
  SkippedItem,
  PruningError,
  PruningStats,
  PruningEvents,
  PruningProgress,
} from './types.js';

export { DEFAULT_PRUNING_CONFIG } from './types.js';

// Manager
export type {
  ConditionEvaluator,
  EvaluationContext,
  SessionStats,
  GlobalStats,
} from './pruning-manager.js';

export {
  PruningManager,
  getPruningManager,
  resetPruningManager,
} from './pruning-manager.js';
