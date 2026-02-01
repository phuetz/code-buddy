/**
 * Progress Tracker
 *
 * Tracks progress for long-running operations and provides
 * utilities for calculating and reporting progress.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Progress stage
 */
export interface ProgressStage {
  /** Stage name */
  name: string;
  /** Stage weight (for total progress calculation) */
  weight: number;
  /** Current progress within stage (0-100) */
  progress: number;
  /** Stage status */
  status: 'pending' | 'active' | 'completed' | 'failed';
  /** Optional message */
  message?: string;
}

/**
 * Progress update
 */
export interface ProgressUpdate {
  /** Overall progress (0-100) */
  totalProgress: number;
  /** Current stage name */
  currentStage: string;
  /** Current stage progress (0-100) */
  stageProgress: number;
  /** Status message */
  message: string;
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number;
  /** Elapsed time in milliseconds */
  elapsedTime: number;
}

/**
 * Progress tracker configuration
 */
export interface ProgressTrackerConfig {
  /** Stages to track */
  stages: Array<{ name: string; weight: number }>;
  /** Whether to estimate time remaining */
  estimateTime: boolean;
  /** Minimum progress update interval in milliseconds */
  updateIntervalMs: number;
}

// ============================================================================
// Progress Tracker
// ============================================================================

/**
 * Tracks progress across multiple stages
 */
export class ProgressTracker extends EventEmitter {
  private stages: Map<string, ProgressStage> = new Map();
  private stageOrder: string[] = [];
  private currentStageIndex: number = 0;
  private startTime: number = 0;
  private lastUpdate: number = 0;
  private config: ProgressTrackerConfig;
  private progressHistory: Array<{ time: number; progress: number }> = [];

  constructor(config: Partial<ProgressTrackerConfig> = {}) {
    super();
    this.config = {
      stages: config.stages || [{ name: 'main', weight: 1 }],
      estimateTime: config.estimateTime ?? true,
      updateIntervalMs: config.updateIntervalMs ?? 100,
    };

    this.initializeStages();
  }

  /**
   * Initialize stages from config
   */
  private initializeStages(): void {
    this.stages.clear();
    this.stageOrder = [];

    for (const stageConfig of this.config.stages) {
      this.stages.set(stageConfig.name, {
        name: stageConfig.name,
        weight: stageConfig.weight,
        progress: 0,
        status: 'pending',
      });
      this.stageOrder.push(stageConfig.name);
    }
  }

  /**
   * Start tracking
   */
  start(): void {
    this.startTime = Date.now();
    this.lastUpdate = this.startTime;
    this.currentStageIndex = 0;
    this.progressHistory = [];

    // Set first stage as active
    if (this.stageOrder.length > 0) {
      const firstStage = this.stages.get(this.stageOrder[0]);
      if (firstStage) {
        firstStage.status = 'active';
      }
    }

    this.emitUpdate();
  }

  /**
   * Update progress for current or specified stage
   */
  updateProgress(progress: number, stageName?: string, message?: string): void {
    const name = stageName || this.stageOrder[this.currentStageIndex];
    const stage = this.stages.get(name);

    if (!stage) return;

    // Update stage progress
    stage.progress = Math.min(100, Math.max(0, progress));
    stage.status = progress >= 100 ? 'completed' : 'active';
    if (message) {
      stage.message = message;
    }

    // Track progress history for time estimation
    const now = Date.now();
    const totalProgress = this.calculateTotalProgress();
    this.progressHistory.push({ time: now, progress: totalProgress });

    // Trim history to last 10 entries
    if (this.progressHistory.length > 10) {
      this.progressHistory.shift();
    }

    // Check if we should emit update (throttle)
    if (now - this.lastUpdate >= this.config.updateIntervalMs) {
      this.lastUpdate = now;
      this.emitUpdate();
    }
  }

  /**
   * Complete current stage and move to next
   */
  completeStage(stageName?: string): void {
    const name = stageName || this.stageOrder[this.currentStageIndex];
    const stage = this.stages.get(name);

    if (stage) {
      stage.progress = 100;
      stage.status = 'completed';
    }

    // Move to next stage
    if (this.currentStageIndex < this.stageOrder.length - 1) {
      this.currentStageIndex++;
      const nextStage = this.stages.get(this.stageOrder[this.currentStageIndex]);
      if (nextStage) {
        nextStage.status = 'active';
      }
    }

    this.emitUpdate();
  }

  /**
   * Mark stage as failed
   */
  failStage(stageName?: string, message?: string): void {
    const name = stageName || this.stageOrder[this.currentStageIndex];
    const stage = this.stages.get(name);

    if (stage) {
      stage.status = 'failed';
      if (message) {
        stage.message = message;
      }
    }

    this.emitUpdate();
  }

  /**
   * Calculate total progress across all stages
   */
  calculateTotalProgress(): number {
    let totalWeight = 0;
    let weightedProgress = 0;

    for (const stage of this.stages.values()) {
      totalWeight += stage.weight;
      weightedProgress += (stage.progress / 100) * stage.weight;
    }

    if (totalWeight === 0) return 0;
    return Math.round((weightedProgress / totalWeight) * 100);
  }

  /**
   * Estimate time remaining
   */
  estimateTimeRemaining(): number | undefined {
    if (!this.config.estimateTime || this.progressHistory.length < 2) {
      return undefined;
    }

    // Calculate progress rate from history
    const first = this.progressHistory[0];
    const last = this.progressHistory[this.progressHistory.length - 1];

    const progressDelta = last.progress - first.progress;
    const timeDelta = last.time - first.time;

    if (progressDelta <= 0 || timeDelta <= 0) {
      return undefined;
    }

    const progressRate = progressDelta / timeDelta; // Progress per ms
    const remainingProgress = 100 - last.progress;

    if (remainingProgress <= 0) {
      return 0;
    }

    return Math.round(remainingProgress / progressRate);
  }

  /**
   * Get current progress update
   */
  getUpdate(): ProgressUpdate {
    const currentStageName = this.stageOrder[this.currentStageIndex] || '';
    const currentStage = this.stages.get(currentStageName);

    return {
      totalProgress: this.calculateTotalProgress(),
      currentStage: currentStageName,
      stageProgress: currentStage?.progress || 0,
      message: currentStage?.message || `Processing ${currentStageName}...`,
      estimatedTimeRemaining: this.estimateTimeRemaining(),
      elapsedTime: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Emit progress update event
   */
  private emitUpdate(): void {
    this.emit('progress', this.getUpdate());
  }

  /**
   * Get all stages
   */
  getStages(): ProgressStage[] {
    return Array.from(this.stages.values());
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.initializeStages();
    this.currentStageIndex = 0;
    this.startTime = 0;
    this.lastUpdate = 0;
    this.progressHistory = [];
  }

  /**
   * Check if all stages are completed
   */
  isCompleted(): boolean {
    for (const stage of this.stages.values()) {
      if (stage.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if any stage has failed
   */
  hasFailed(): boolean {
    for (const stage of this.stages.values()) {
      if (stage.status === 'failed') {
        return true;
      }
    }
    return false;
  }
}

// ============================================================================
// Simple Progress Helper
// ============================================================================

/**
 * Create a simple progress tracker for single operations
 */
export function createSimpleTracker(
  onProgress?: (progress: number, message?: string) => void
): {
  update: (progress: number, message?: string) => void;
  complete: () => void;
  fail: (message?: string) => void;
} {
  let currentProgress = 0;

  return {
    update(progress: number, message?: string) {
      currentProgress = Math.min(100, Math.max(0, progress));
      onProgress?.(currentProgress, message);
    },
    complete() {
      currentProgress = 100;
      onProgress?.(100, 'Completed');
    },
    fail(message?: string) {
      onProgress?.(currentProgress, message || 'Failed');
    },
  };
}

/**
 * Calculate progress for iterating over items
 */
export function calculateIterationProgress(
  current: number,
  total: number,
  baseProgress: number = 0,
  maxProgress: number = 100
): number {
  if (total <= 0) return maxProgress;
  const range = maxProgress - baseProgress;
  return baseProgress + Math.round((current / total) * range);
}
