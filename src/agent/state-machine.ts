/**
 * Agent State Machine — OpenManus-compatible
 * Enum-based state tracking with stuck detection and recovery
 */

import { EventEmitter } from 'events';

/** Agent execution states (mirrors OpenManus AgentState) */
export enum AgentStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  THINKING = 'thinking',
  ACTING = 'acting',
  FINISHED = 'finished',
  ERROR = 'error',
}

/** Valid state transitions */
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  [AgentStatus.IDLE]: [AgentStatus.RUNNING],
  [AgentStatus.RUNNING]: [AgentStatus.THINKING, AgentStatus.ACTING, AgentStatus.FINISHED, AgentStatus.ERROR],
  [AgentStatus.THINKING]: [AgentStatus.ACTING, AgentStatus.RUNNING, AgentStatus.FINISHED, AgentStatus.ERROR],
  [AgentStatus.ACTING]: [AgentStatus.THINKING, AgentStatus.RUNNING, AgentStatus.FINISHED, AgentStatus.ERROR],
  [AgentStatus.FINISHED]: [AgentStatus.IDLE],
  [AgentStatus.ERROR]: [AgentStatus.IDLE],
};

export interface StuckDetectionConfig {
  /** Number of duplicate responses before triggering stuck recovery */
  duplicateThreshold: number;
  /** Max response history to keep for duplicate detection */
  historySize: number;
  /** Perturbation prompt injected when stuck is detected */
  perturbationPrompt: string;
}

const DEFAULT_STUCK_CONFIG: StuckDetectionConfig = {
  duplicateThreshold: 3,
  historySize: 10,
  perturbationPrompt:
    'Your previous actions have been repetitive. Please try a different approach, use alternative tools, or break the problem down differently.',
};

export interface StateTransitionEvent {
  from: AgentStatus;
  to: AgentStatus;
  timestamp: number;
  reason?: string;
}

export class AgentStateMachine extends EventEmitter {
  private _status: AgentStatus = AgentStatus.IDLE;
  private _currentStep: number = 0;
  private _maxSteps: number;
  private _responseHistory: string[] = [];
  private _stuckConfig: StuckDetectionConfig;
  private _transitions: StateTransitionEvent[] = [];
  private _startTime: number = 0;
  private _error: Error | null = null;

  constructor(maxSteps: number = 30, stuckConfig?: Partial<StuckDetectionConfig>) {
    super();
    this._maxSteps = maxSteps;
    this._stuckConfig = { ...DEFAULT_STUCK_CONFIG, ...stuckConfig };
  }

  /** Current agent status */
  get status(): AgentStatus {
    return this._status;
  }

  /** Current step number */
  get currentStep(): number {
    return this._currentStep;
  }

  /** Maximum allowed steps */
  get maxSteps(): number {
    return this._maxSteps;
  }

  /** Whether the agent has finished (completed or errored) */
  get isTerminal(): boolean {
    return this._status === AgentStatus.FINISHED || this._status === AgentStatus.ERROR;
  }

  /** Whether the agent can continue stepping */
  get canContinue(): boolean {
    return !this.isTerminal && this._currentStep < this._maxSteps;
  }

  /** Elapsed time in ms since run started */
  get elapsedMs(): number {
    return this._startTime > 0 ? Date.now() - this._startTime : 0;
  }

  /** Last error if status is ERROR */
  get error(): Error | null {
    return this._error;
  }

  /** Full transition history */
  get transitions(): ReadonlyArray<StateTransitionEvent> {
    return this._transitions;
  }

  /** Transition to a new state */
  transition(to: AgentStatus, reason?: string): void {
    const from = this._status;
    const valid = VALID_TRANSITIONS[from];
    if (!valid.includes(to)) {
      throw new Error(`Invalid state transition: ${from} → ${to}. Valid: [${valid.join(', ')}]`);
    }

    this._status = to;
    const event: StateTransitionEvent = { from, to, timestamp: Date.now(), reason };
    this._transitions.push(event);
    this.emit('transition', event);

    if (to === AgentStatus.RUNNING && from === AgentStatus.IDLE) {
      this._startTime = Date.now();
      this._currentStep = 0;
      this._responseHistory = [];
      this._error = null;
      this.emit('start');
    }

    if (to === AgentStatus.FINISHED) {
      this.emit('finish', { steps: this._currentStep, elapsed: this.elapsedMs });
    }

    if (to === AgentStatus.ERROR) {
      this.emit('agent:error', this._error);
    }
  }

  /** Start the agent (IDLE → RUNNING) */
  start(reason?: string): void {
    this.transition(AgentStatus.RUNNING, reason ?? 'Agent started');
  }

  /** Mark as thinking (LLM call in progress) */
  think(reason?: string): void {
    this.transition(AgentStatus.THINKING, reason ?? 'LLM call');
  }

  /** Mark as acting (tool execution in progress) */
  act(reason?: string): void {
    this.transition(AgentStatus.ACTING, reason ?? 'Tool execution');
  }

  /** Mark as finished (RUNNING/THINKING/ACTING → FINISHED) */
  finish(reason?: string): void {
    this.transition(AgentStatus.FINISHED, reason ?? 'Agent completed');
  }

  /** Mark as errored */
  fail(error: Error): void {
    this._error = error;
    this.transition(AgentStatus.ERROR, error.message);
  }

  /** Reset to IDLE (from FINISHED or ERROR) */
  reset(): void {
    this.transition(AgentStatus.IDLE, 'Reset');
    this._currentStep = 0;
    this._responseHistory = [];
    this._error = null;
    this._startTime = 0;
  }

  /** Increment step counter, returns false if max reached */
  incrementStep(): boolean {
    this._currentStep++;
    this.emit('step', { step: this._currentStep, maxSteps: this._maxSteps });
    return this._currentStep < this._maxSteps;
  }

  /**
   * Record a response for stuck detection.
   * Returns true if the agent appears stuck (N consecutive duplicates).
   */
  recordResponse(response: string): boolean {
    // Normalize for comparison (trim, collapse whitespace)
    const normalized = response.trim().replace(/\s+/g, ' ').substring(0, 500);
    this._responseHistory.push(normalized);

    // Keep history bounded
    if (this._responseHistory.length > this._stuckConfig.historySize) {
      this._responseHistory.shift();
    }

    return this.isStuck();
  }

  /** Check if agent is stuck (duplicate consecutive responses) */
  isStuck(): boolean {
    const history = this._responseHistory;
    const threshold = this._stuckConfig.duplicateThreshold;

    if (history.length < threshold) return false;

    const recent = history.slice(-threshold);
    const allSame = recent.every((r) => r === recent[0]);

    if (allSame) {
      this.emit('stuck', {
        duplicateCount: threshold,
        response: recent[0]?.substring(0, 100),
      });
    }

    return allSame;
  }

  /** Get perturbation prompt for stuck recovery */
  getPerturbationPrompt(): string {
    return this._stuckConfig.perturbationPrompt;
  }

  /** Handle stuck state: clear recent history and return perturbation */
  handleStuckState(): string {
    // Clear the duplicate tail to allow fresh attempts
    this._responseHistory = this._responseHistory.slice(0, -this._stuckConfig.duplicateThreshold);
    this.emit('stuck:recovered');
    return this._stuckConfig.perturbationPrompt;
  }

  /** Snapshot for serialization */
  toJSON(): Record<string, unknown> {
    return {
      status: this._status,
      currentStep: this._currentStep,
      maxSteps: this._maxSteps,
      elapsedMs: this.elapsedMs,
      isStuck: this.isStuck(),
      transitionCount: this._transitions.length,
    };
  }
}
