/**
 * LoopDetectionService — Proactive loop detection in tool calls and streaming text.
 *
 * Prevents AI agents from entering unproductive infinite loops:
 * 1. Repeated tool calls with identical arguments (threshold: 5 consecutive calls).
 * 2. Multi-step repeating cycles of tool calls (e.g. A->B->A->B, cycles of period k=1..5 repeated 5 times).
 * 3. Content chanting loops in generated prose (identical 50-char chunks repeated >= 10 times outside code fences).
 *
 * Emits 'agent:loop_detected' on the global event bus when a loop is detected.
 */

import { createHash } from 'node:crypto';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

export enum LoopType {
  CONSECUTIVE_TOOL_CALL = 'consecutive_tool_call',
  CYCLE_TOOL_CALL = 'cycle_tool_call',
  CONTENT_CHANTING = 'content_chanting',
}

export interface LoopDetectionResult {
  isLoop: boolean;
  type?: LoopType;
  detail?: string;
  count?: number;
}

export const TOOL_CALL_LOOP_THRESHOLD = 5;
export const CONTENT_LOOP_THRESHOLD = 10;
export const CONTENT_CHUNK_SIZE = 50;
export const MAX_CONTENT_HISTORY_LENGTH = 5000;

/**
 * Deterministically serialize any object into a stable string by sorting keys.
 */
function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((val as Record<string, unknown>)[k])}`);
  return '{' + pairs.join(',') + '}';
}

export class LoopDetectionService {
  private toolCallHistory: string[] = [];
  private streamContentHistory = '';
  private contentStats = new Map<string, number[]>();
  private lastContentIndex = 0;
  private inCodeBlock = false;

  private loopDetected = false;
  private detectedCount = 0;
  private lastLoopType?: LoopType;
  private lastLoopDetail?: string;

  constructor(private emitEvents: boolean = true) {}

  /**
   * Check whether a newly scheduled or executed tool call forms an unproductive loop.
   */
  public checkToolCallLoop(toolCall: { name: string; args?: unknown }): LoopDetectionResult {
    this.resetContentTracking();

    const argsStr = canonicalStringify(toolCall.args ?? {});
    const keyString = `${toolCall.name}:${argsStr}`;
    const key = createHash('sha256').update(keyString).digest('hex');

    this.toolCallHistory.push(key);

    const maxHistory = 5 * TOOL_CALL_LOOP_THRESHOLD;
    if (this.toolCallHistory.length > maxHistory) {
      this.toolCallHistory = this.toolCallHistory.slice(-maxHistory);
    }

    const n = this.toolCallHistory.length;
    const R = TOOL_CALL_LOOP_THRESHOLD;

    // Check for cycles of period k from 1 to 5
    for (let k = 1; k <= 5; k++) {
      const requiredLength = k * R;
      if (n >= requiredLength) {
        const cycle = this.toolCallHistory.slice(-k);
        let isPatternMatch = true;

        for (let i = 0; i < requiredLength; i++) {
          const indexFromEnd = requiredLength - i;
          const actualKey = this.toolCallHistory[n - indexFromEnd];
          const expectedKey = cycle[i % k];
          if (actualKey !== expectedKey) {
            isPatternMatch = false;
            break;
          }
        }

        if (isPatternMatch) {
          const type = k === 1 ? LoopType.CONSECUTIVE_TOOL_CALL : LoopType.CYCLE_TOOL_CALL;
          const detail = k === 1
            ? `Consecutive identical tool call: ${toolCall.name} (args: ${argsStr.slice(0, 100)}) repeated ${R} times`
            : `Repeating cycle of ${k} tool actions detected over ${requiredLength} steps`;

          this.triggerLoop(type, detail);
          return { isLoop: true, type, detail, count: this.detectedCount };
        }
      }
    }

    return { isLoop: false, count: this.detectedCount };
  }

  /**
   * Check streaming text chunk for repetitive chanting loops.
   */
  public checkContentChunk(content: string): LoopDetectionResult {
    // Check code fences
    const numFences = (content.match(/```/g) ?? []).length;
    const isDivider = /^[+-_=*\u2500-\u257F]{3,}$/.test(content.trim());

    if (numFences > 0 || isDivider) {
      this.resetContentTracking();
    }

    const wasInCode = this.inCodeBlock;
    if (numFences % 2 !== 0) {
      this.inCodeBlock = !this.inCodeBlock;
    }

    // Ignore content inside code blocks or pure dividers
    if (wasInCode || this.inCodeBlock || isDivider) {
      return { isLoop: false, count: this.detectedCount };
    }

    this.streamContentHistory += content;

    // Truncate if history gets too long
    if (this.streamContentHistory.length > MAX_CONTENT_HISTORY_LENGTH) {
      const truncation = this.streamContentHistory.length - MAX_CONTENT_HISTORY_LENGTH;
      this.streamContentHistory = this.streamContentHistory.slice(truncation);
      this.lastContentIndex = Math.max(0, this.lastContentIndex - truncation);

      for (const [hash, indices] of this.contentStats.entries()) {
        const adjusted = indices.map((i) => i - truncation).filter((i) => i >= 0);
        if (adjusted.length === 0) {
          this.contentStats.delete(hash);
        } else {
          this.contentStats.set(hash, adjusted);
        }
      }
    }

    // Sliding window of 50 characters
    while (this.lastContentIndex + CONTENT_CHUNK_SIZE <= this.streamContentHistory.length) {
      const currentChunk = this.streamContentHistory.substring(
        this.lastContentIndex,
        this.lastContentIndex + CONTENT_CHUNK_SIZE
      );
      const chunkHash = createHash('sha256').update(currentChunk).digest('hex');

      let occurrences = this.contentStats.get(chunkHash);
      if (!occurrences) {
        occurrences = [];
        this.contentStats.set(chunkHash, occurrences);
      }
      occurrences.push(this.lastContentIndex);

      if (occurrences.length >= CONTENT_LOOP_THRESHOLD) {
        const recent = occurrences.slice(-CONTENT_LOOP_THRESHOLD);
        const firstIndex = recent[0] ?? 0;
        const lastIndex = recent[recent.length - 1] ?? 0;
        const totalDistance = lastIndex - firstIndex;
        const avgDistance = totalDistance / (CONTENT_LOOP_THRESHOLD - 1);
        const maxAllowedDistance = CONTENT_CHUNK_SIZE * 5;

        if (avgDistance <= maxAllowedDistance) {
          const detail = `Repeating content chunk detected: "${currentChunk.slice(0, 40)}..." repeated >= ${CONTENT_LOOP_THRESHOLD} times`;
          this.triggerLoop(LoopType.CONTENT_CHANTING, detail);
          return {
            isLoop: true,
            type: LoopType.CONTENT_CHANTING,
            detail,
            count: this.detectedCount,
          };
        }
      }

      this.lastContentIndex++;
    }

    return { isLoop: false, count: this.detectedCount };
  }

  private triggerLoop(type: LoopType, detail: string): void {
    this.loopDetected = true;
    this.detectedCount++;
    this.lastLoopType = type;
    this.lastLoopDetail = detail;

    logger.warn(`[LoopDetectionService] ${type}: ${detail}`);

    if (this.emitEvents) {
      try {
        const bus = getGlobalEventBus();
        bus.emit('agent:loop_detected', {
          loopType: type,
          detail,
          count: this.detectedCount,
        });
      } catch (err) {
        logger.debug('[LoopDetectionService] Event bus emission failed', { error: String(err) });
      }
    }
  }

  public resetContentTracking(): void {
    this.streamContentHistory = '';
    this.contentStats.clear();
    this.lastContentIndex = 0;
  }

  public reset(): void {
    this.toolCallHistory = [];
    this.resetContentTracking();
    this.inCodeBlock = false;
    this.loopDetected = false;
    this.detectedCount = 0;
    this.lastLoopType = undefined;
    this.lastLoopDetail = undefined;
  }

  public isLoopDetected(): boolean {
    return this.loopDetected;
  }

  public getDetectedCount(): number {
    return this.detectedCount;
  }

  public getLastLoopType(): LoopType | undefined {
    return this.lastLoopType;
  }

  public getLastLoopDetail(): string | undefined {
    return this.lastLoopDetail;
  }
}
