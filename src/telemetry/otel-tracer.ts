/**
 * OpenTelemetry Tracer (Lightweight)
 *
 * Manual OTLP HTTP JSON exporter without @opentelemetry/* dependencies.
 * Buffers spans in memory and flushes them to an OTLP-compatible endpoint.
 *
 * Enable via:
 * - OTEL_ENDPOINT env var
 * - --otel-endpoint CLI flag
 * - Constructor config
 */

import * as crypto from 'crypto';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface OtelAttribute {
  key: string;
  value: { stringValue?: string; intValue?: number; boolValue?: boolean };
}

export interface OtelSpanStatus {
  code: number; // 0 = UNSET, 1 = OK, 2 = ERROR
  message?: string;
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 0 = INTERNAL, 1 = SERVER, 2 = CLIENT, 3 = PRODUCER, 4 = CONSUMER
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelAttribute[];
  status: OtelSpanStatus;
}

export interface OtelTracerConfig {
  /** OTLP HTTP endpoint (e.g., http://localhost:4318/v1/traces) */
  endpoint?: string;
  /** Service name reported in telemetry */
  serviceName?: string;
  /** Enable/disable the tracer */
  enabled?: boolean;
  /** Flush interval in milliseconds (default: 30000) */
  flushIntervalMs?: number;
  /** Maximum buffer size before auto-flush (default: 100) */
  maxBufferSize?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function generateId(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function nowNano(): string {
  const [sec, nsec] = process.hrtime();
  const ms = Date.now();
  // Combine wall-clock ms with hrtime nanoseconds for sub-ms precision
  const nanos = BigInt(ms) * BigInt(1_000_000) + BigInt(nsec % 1_000_000);
  return nanos.toString();
}

function toAttribute(key: string, value: string | number | boolean): OtelAttribute {
  if (typeof value === 'string') {
    return { key, value: { stringValue: value } };
  }
  if (typeof value === 'number') {
    return { key, value: { intValue: value } };
  }
  return { key, value: { boolValue: value } };
}

// ============================================================================
// OtelTracer
// ============================================================================

export class OtelTracer {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly enabled: boolean;
  private readonly maxBufferSize: number;
  private buffer: OtelSpan[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private currentTraceId: string;

  constructor(config: OtelTracerConfig = {}) {
    this.endpoint = config.endpoint
      ?? process.env['OTEL_ENDPOINT']
      ?? '';
    this.serviceName = config.serviceName ?? 'codebuddy';
    this.enabled = config.enabled ?? (this.endpoint.length > 0);
    this.maxBufferSize = config.maxBufferSize ?? 100;
    this.currentTraceId = generateId(16);

    if (this.enabled && this.endpoint) {
      const interval = config.flushIntervalMs ?? 30_000;
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          logger.warn('OTEL flush failed', { error: String(err) });
        });
      }, interval);
      // Unref so the timer does not prevent process exit
      if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
        this.flushTimer.unref();
      }
    }
  }

  /**
   * Start a new span. Call endSpan() when the operation completes.
   */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): OtelSpan {
    const span: OtelSpan = {
      traceId: this.currentTraceId,
      spanId: generateId(8),
      name,
      kind: 0, // INTERNAL
      startTimeUnixNano: nowNano(),
      endTimeUnixNano: '0',
      attributes: [],
      status: { code: 0 },
    };

    if (attributes) {
      for (const [key, val] of Object.entries(attributes)) {
        span.attributes.push(toAttribute(key, val));
      }
    }

    return span;
  }

  /**
   * End a span and add it to the buffer for flushing.
   */
  endSpan(span: OtelSpan, status?: OtelSpanStatus): void {
    span.endTimeUnixNano = nowNano();
    if (status) {
      span.status = status;
    }

    if (!this.enabled) {
      return;
    }

    this.buffer.push(span);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch((err) => {
        logger.warn('OTEL auto-flush failed', { error: String(err) });
      });
    }
  }

  /**
   * Flush buffered spans to the OTLP endpoint.
   */
  async flush(): Promise<void> {
    if (!this.enabled || !this.endpoint || this.buffer.length === 0) {
      return;
    }

    const spans = this.buffer.splice(0);

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              toAttribute('service.name', this.serviceName),
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'codebuddy-tracer', version: '1.0.0' },
              spans,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(`OTEL export failed: HTTP ${response.status}`);
        // Put spans back for retry
        this.buffer.unshift(...spans);
      }
    } catch (error) {
      logger.warn('OTEL export error', { error: String(error) });
      // Put spans back for retry (cap buffer to avoid unbounded growth)
      if (this.buffer.length < this.maxBufferSize * 2) {
        this.buffer.unshift(...spans);
      }
    }
  }

  /**
   * Trace an LLM API call.
   */
  traceApiCall(model: string, tokens: number, duration: number): void {
    const span = this.startSpan('llm.api_call', {
      'llm.model': model,
      'llm.tokens': tokens,
      'llm.duration_ms': duration,
    });
    span.kind = 2; // CLIENT
    span.endTimeUnixNano = nowNano();
    span.status = { code: 1 }; // OK

    if (this.enabled) {
      this.buffer.push(span);
    }
  }

  /**
   * Trace a tool execution.
   */
  traceToolExecution(toolName: string, duration: number, success: boolean): void {
    const span = this.startSpan('tool.execute', {
      'tool.name': toolName,
      'tool.duration_ms': duration,
      'tool.success': success ? 'true' : 'false',
    });
    span.endTimeUnixNano = nowNano();
    span.status = { code: success ? 1 : 2, message: success ? undefined : 'Tool execution failed' };

    if (this.enabled) {
      this.buffer.push(span);
    }
  }

  /**
   * Trace a conversation turn.
   */
  traceConversation(sessionId: string, messageCount: number): void {
    const span = this.startSpan('conversation.turn', {
      'session.id': sessionId,
      'conversation.message_count': messageCount,
    });
    span.endTimeUnixNano = nowNano();
    span.status = { code: 1 };

    if (this.enabled) {
      this.buffer.push(span);
    }
  }

  /**
   * Start a new trace (generates a new traceId).
   */
  newTrace(): string {
    this.currentTraceId = generateId(16);
    return this.currentTraceId;
  }

  /**
   * Get the number of buffered spans.
   */
  get pendingSpans(): number {
    return this.buffer.length;
  }

  /**
   * Check if the tracer is enabled.
   */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Dispose the tracer, flushing remaining spans.
   */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let tracerInstance: OtelTracer | null = null;

export function getOtelTracer(config?: OtelTracerConfig): OtelTracer {
  if (!tracerInstance) {
    tracerInstance = new OtelTracer(config);
  }
  return tracerInstance;
}

export function resetOtelTracer(): void {
  if (tracerInstance) {
    tracerInstance.dispose().catch(() => {});
  }
  tracerInstance = null;
}
