/**
 * Tool Phases
 *
 * Defines phases for tool execution streaming, allowing
 * real-time updates during tool operations.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Tool execution phase
 */
export type ToolPhase = 'start' | 'update' | 'result';

/**
 * Tool phase event
 */
export interface ToolPhaseEvent {
  /** Current phase */
  phase: ToolPhase;
  /** Tool call ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Progress percentage (0-100), only for 'update' phase */
  progress?: number;
  /** Status message */
  message?: string;
  /** Tool result, only for 'result' phase */
  result?: ToolPhaseResult;
  /** Timestamp */
  timestamp: number;
}

/**
 * Tool phase result
 */
export interface ToolPhaseResult {
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Output from the tool */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Tool phase emitter events
 */
export interface ToolPhaseEvents {
  'phase': (event: ToolPhaseEvent) => void;
  'phase:start': (event: ToolPhaseEvent) => void;
  'phase:update': (event: ToolPhaseEvent) => void;
  'phase:result': (event: ToolPhaseEvent) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// Tool Phase Emitter
// ============================================================================

/**
 * Emitter for tool phase events
 */
export class ToolPhaseEmitter extends EventEmitter {
  private _toolCallId: string;
  private _toolName: string;
  private startTime: number = 0;
  private currentPhase: ToolPhase = 'start';
  private progress: number = 0;

  /** Get the tool call ID */
  get toolCallId(): string {
    return this._toolCallId;
  }

  /** Get the tool name */
  get toolName(): string {
    return this._toolName;
  }

  constructor(toolCallId: string, toolName: string) {
    super();
    this._toolCallId = toolCallId;
    this._toolName = toolName;
  }

  /**
   * Emit start phase
   */
  start(message?: string): void {
    this.startTime = Date.now();
    this.currentPhase = 'start';
    this.progress = 0;

    const event: ToolPhaseEvent = {
      phase: 'start',
      toolCallId: this.toolCallId,
      toolName: this.toolName,
      progress: 0,
      message: message || `Starting ${this.toolName}...`,
      timestamp: this.startTime,
    };

    this.emit('phase', event);
    this.emit('phase:start', event);
  }

  /**
   * Emit update phase with progress
   */
  update(progress: number, message?: string): void {
    this.currentPhase = 'update';
    this.progress = Math.min(100, Math.max(0, progress));

    const event: ToolPhaseEvent = {
      phase: 'update',
      toolCallId: this.toolCallId,
      toolName: this.toolName,
      progress: this.progress,
      message,
      timestamp: Date.now(),
    };

    this.emit('phase', event);
    this.emit('phase:update', event);
  }

  /**
   * Emit result phase
   */
  result(result: Omit<ToolPhaseResult, 'duration'>): void {
    this.currentPhase = 'result';
    this.progress = 100;

    const duration = Date.now() - this.startTime;
    const fullResult: ToolPhaseResult = {
      ...result,
      duration,
    };

    const event: ToolPhaseEvent = {
      phase: 'result',
      toolCallId: this.toolCallId,
      toolName: this.toolName,
      progress: 100,
      message: result.success ? 'Completed' : 'Failed',
      result: fullResult,
      timestamp: Date.now(),
    };

    this.emit('phase', event);
    this.emit('phase:result', event);
  }

  /**
   * Emit error
   */
  error(error: Error): void {
    this.emit('error', error);
    this.result({
      success: false,
      error: error.message,
    });
  }

  /**
   * Get current phase
   */
  getPhase(): ToolPhase {
    return this.currentPhase;
  }

  /**
   * Get current progress
   */
  getProgress(): number {
    return this.progress;
  }

  /**
   * Get elapsed time
   */
  getElapsedTime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }
}

// ============================================================================
// Phase Manager
// ============================================================================

/**
 * Manages multiple tool phase emitters
 */
export class ToolPhaseManager extends EventEmitter {
  private emitters: Map<string, ToolPhaseEmitter> = new Map();
  private phaseListeners: Set<(event: ToolPhaseEvent) => void> = new Set();

  /**
   * Create emitter for a tool call
   */
  createEmitter(toolCallId: string, toolName: string): ToolPhaseEmitter {
    const emitter = new ToolPhaseEmitter(toolCallId, toolName);

    // Forward events to manager
    emitter.on('phase', (event: ToolPhaseEvent) => {
      this.emit('phase', event);
      this.notifyListeners(event);
    });

    emitter.on('error', (error: Error) => {
      this.emit('error', { toolCallId, toolName, error });
    });

    this.emitters.set(toolCallId, emitter);
    return emitter;
  }

  /**
   * Get emitter for a tool call
   */
  getEmitter(toolCallId: string): ToolPhaseEmitter | undefined {
    return this.emitters.get(toolCallId);
  }

  /**
   * Remove emitter for a tool call
   */
  removeEmitter(toolCallId: string): boolean {
    const emitter = this.emitters.get(toolCallId);
    if (emitter) {
      emitter.removeAllListeners();
      this.emitters.delete(toolCallId);
      return true;
    }
    return false;
  }

  /**
   * Add a phase listener
   */
  addPhaseListener(listener: (event: ToolPhaseEvent) => void): void {
    this.phaseListeners.add(listener);
  }

  /**
   * Remove a phase listener
   */
  removePhaseListener(listener: (event: ToolPhaseEvent) => void): void {
    this.phaseListeners.delete(listener);
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(event: ToolPhaseEvent): void {
    for (const listener of this.phaseListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get all active tool calls
   */
  getActiveToolCalls(): Array<{ toolCallId: string; toolName: string; phase: ToolPhase; progress: number }> {
    return Array.from(this.emitters.entries())
      .filter(([_, emitter]) => emitter.getPhase() !== 'result')
      .map(([toolCallId, emitter]) => ({
        toolCallId,
        toolName: emitter.toolName,
        phase: emitter.getPhase(),
        progress: emitter.getProgress(),
      }));
  }

  /**
   * Clear all emitters
   */
  clear(): void {
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.emitters.clear();
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.clear();
    this.phaseListeners.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let phaseManagerInstance: ToolPhaseManager | null = null;

/**
 * Get or create the ToolPhaseManager singleton
 */
export function getToolPhaseManager(): ToolPhaseManager {
  if (!phaseManagerInstance) {
    phaseManagerInstance = new ToolPhaseManager();
  }
  return phaseManagerInstance;
}

/**
 * Reset the ToolPhaseManager singleton
 */
export function resetToolPhaseManager(): void {
  if (phaseManagerInstance) {
    phaseManagerInstance.dispose();
  }
  phaseManagerInstance = null;
}
