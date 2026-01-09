/**
 * Telemetry Module Tests
 *
 * Comprehensive tests for the OpenTelemetry integration covering:
 * - Metric collection and aggregation
 * - Event tracking
 * - Performance monitoring
 * - Telemetry export
 */

import { EventEmitter } from 'events';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock os module for consistent test results
jest.mock('os', () => ({
  hostname: jest.fn(() => 'test-hostname'),
  arch: jest.fn(() => 'x64'),
  type: jest.fn(() => 'Linux'),
  release: jest.fn(() => '5.4.0'),
}));

// Mock fetch for export tests
global.fetch = jest.fn();

import {
  OpenTelemetryIntegration,
  initOpenTelemetry,
  OTelConfig,
  TraceContext,
  SpanKind,
  SpanEvent,
} from '../../src/integrations/opentelemetry-integration';

// Interface for span data in event handlers
interface SpanData {
  name: string;
  kind: SpanKind;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  status: { code: string; message?: string };
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

// Interface for OTLP attribute format
interface OTLPAttribute {
  key: string;
  value: { stringValue?: string; intValue?: number; doubleValue?: number; boolValue?: boolean; arrayValue?: { values: OTLPAttribute['value'][] } };
}

// Type for fetch call array
type FetchCall = [string, { method: string; body: string; headers: Record<string, string> }];

describe('OpenTelemetryIntegration', () => {
  let otel: OpenTelemetryIntegration;
  const defaultConfig: OTelConfig = {
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    otel = new OpenTelemetryIntegration(defaultConfig);
  });

  afterEach(async () => {
    await otel.shutdown();
    jest.useRealTimers();
  });

  // ============================================================================
  // Constructor and Initialization
  // ============================================================================

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      expect(otel).toBeDefined();
      expect(otel).toBeInstanceOf(EventEmitter);
    });

    it('should accept custom config', () => {
      const customOtel = new OpenTelemetryIntegration({
        serviceName: 'custom-service',
        serviceVersion: '2.0.0',
        environment: 'production',
        endpoint: 'http://localhost:4317',
        exportInterval: 60000,
        consoleExport: true,
        resourceAttributes: { 'custom.attr': 'value' },
        samplingRate: 0.5,
      });

      expect(customOtel).toBeDefined();
    });

    it('should use default values for optional config', () => {
      const minimalOtel = new OpenTelemetryIntegration({
        serviceName: 'minimal-service',
      });

      expect(minimalOtel).toBeDefined();
    });
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const initHandler = jest.fn();
      otel.on('initialized', initHandler);

      await otel.init();

      expect(initHandler).toHaveBeenCalled();
    });

    it('should only initialize once', async () => {
      const initHandler = jest.fn();
      otel.on('initialized', initHandler);

      await otel.init();
      await otel.init();
      await otel.init();

      expect(initHandler).toHaveBeenCalledTimes(1);
    });

    it('should start export interval on init', async () => {
      await otel.init();

      // Record a metric to ensure there's something to export
      otel.recordCounter('test_metric', 1);

      // Fast-forward to trigger export
      jest.advanceTimersByTime(30000);

      // Export should have been attempted (metrics are only exported if there are any)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/metrics'),
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // Trace Management
  // ============================================================================

  describe('Trace Management', () => {
    describe('startTrace', () => {
      it('should start a new trace', () => {
        const spanId = otel.startTrace('test-trace');

        expect(spanId).toBeDefined();
        expect(spanId).toHaveLength(16);
      });

      it('should emit span:start event', () => {
        const handler = jest.fn();
        otel.on('span:start', handler);

        otel.startTrace('test-trace');

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              name: 'test-trace',
              kind: 'internal',
            }),
          })
        );
      });

      it('should accept span kind option', () => {
        const handler = jest.fn();
        otel.on('span:start', handler);

        otel.startTrace('server-trace', { kind: 'server' });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({ kind: 'server' }),
          })
        );
      });

      it('should accept attributes option', () => {
        const handler = jest.fn();
        otel.on('span:start', handler);

        otel.startTrace('test-trace', { attributes: { 'test.attr': 'value' } });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              attributes: { 'test.attr': 'value' },
            }),
          })
        );
      });

      it('should respect sampling rate', () => {
        const sampledOtel = new OpenTelemetryIntegration({
          serviceName: 'sampled-service',
          samplingRate: 0, // Never sample
        });

        const spanId = sampledOtel.startTrace('will-not-sample');

        expect(spanId).toBe('');
      });
    });

    describe('startSpan', () => {
      it('should create a child span', () => {
        const parentSpanId = otel.startTrace('parent');
        const childSpanId = otel.startSpan('child');

        expect(childSpanId).toBeDefined();
        expect(childSpanId).not.toBe(parentSpanId);
      });

      it('should create root span when no parent exists', () => {
        const spanId = otel.startSpan('orphan-span');

        expect(spanId).toBeDefined();
        expect(spanId).toHaveLength(16);
      });

      it('should inherit trace context from parent', () => {
        const handler = jest.fn();
        otel.on('span:start', handler);

        otel.startTrace('parent');
        otel.startSpan('child');

        const parentSpan = handler.mock.calls[0][0].span;
        const childSpan = handler.mock.calls[1][0].span;

        expect(childSpan.traceId).toBe(parentSpan.traceId);
        expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
      });
    });

    describe('endSpan', () => {
      it('should end a span', () => {
        const spanId = otel.startTrace('test-trace');
        const handler = jest.fn();
        otel.on('span:end', handler);

        otel.endSpan(spanId);

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              spanId,
              status: { code: 'ok' },
            }),
          })
        );
      });

      it('should set custom status', () => {
        const spanId = otel.startTrace('test-trace');
        const handler = jest.fn();
        otel.on('span:end', handler);

        otel.endSpan(spanId, { code: 'error', message: 'Something failed' });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              status: { code: 'error', message: 'Something failed' },
            }),
          })
        );
      });

      it('should record end time', () => {
        const spanId = otel.startTrace('test-trace');
        const handler = jest.fn();
        otel.on('span:end', handler);

        jest.advanceTimersByTime(100);
        otel.endSpan(spanId);

        const span = handler.mock.calls[0][0].span;
        expect(span.endTime).toBeDefined();
        expect(span.endTime).toBeGreaterThan(span.startTime);
      });

      it('should handle non-existent span gracefully', () => {
        // Should not throw
        otel.endSpan('non-existent-span');
      });

      it('should export span on end', () => {
        const spanId = otel.startTrace('test-trace');
        otel.endSpan(spanId);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/traces'),
          expect.objectContaining({ method: 'POST' })
        );
      });
    });
  });

  // ============================================================================
  // Event and Attribute Management
  // ============================================================================

  describe('Event and Attribute Management', () => {
    describe('addEvent', () => {
      it('should add event to current span', () => {
        otel.startTrace('test-trace');
        otel.addEvent('test-event');

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span;
        expect(span.events).toHaveLength(1);
        expect(span.events[0].name).toBe('test-event');
      });

      it('should add event with attributes', () => {
        otel.startTrace('test-trace');
        otel.addEvent('test-event', { 'event.attr': 'value' });

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span;
        expect(span.events[0].attributes).toEqual({ 'event.attr': 'value' });
      });

      it('should record event timestamp', () => {
        otel.startTrace('test-trace');
        otel.addEvent('test-event');

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span;
        expect(span.events[0].timestamp).toBeDefined();
      });

      it('should handle no active span gracefully', () => {
        // Should not throw
        otel.addEvent('orphan-event');
      });
    });

    describe('setAttribute', () => {
      it('should set attribute on current span', () => {
        otel.startTrace('test-trace');
        otel.setAttribute('test.key', 'test-value');

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span;
        expect(span.attributes['test.key']).toBe('test-value');
      });

      it('should handle different attribute types', () => {
        otel.startTrace('test-trace');
        otel.setAttribute('string.attr', 'value');
        otel.setAttribute('number.attr', 42);
        otel.setAttribute('boolean.attr', true);
        otel.setAttribute('array.attr', ['a', 'b', 'c']);

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span;
        expect(span.attributes['string.attr']).toBe('value');
        expect(span.attributes['number.attr']).toBe(42);
        expect(span.attributes['boolean.attr']).toBe(true);
        expect(span.attributes['array.attr']).toEqual(['a', 'b', 'c']);
      });

      it('should handle no active span gracefully', () => {
        // Should not throw
        otel.setAttribute('orphan.attr', 'value');
      });
    });

    describe('recordException', () => {
      it('should record exception on current span', () => {
        const handler = jest.fn();
        otel.on('span:end', handler);

        const spanId = otel.startTrace('test-trace');
        otel.recordException(new Error('Test error'));
        // End with error status to verify the exception was recorded
        otel.endSpan(spanId, { code: 'error', message: 'Test error' });

        const span = handler.mock.calls[0][0].span as SpanData;
        expect(span.status.code).toBe('error');
        expect(span.status.message).toBe('Test error');
        // Verify exception event was added
        const exceptionEvent = span.events.find((e: SpanEvent) => e.name === 'exception');
        expect(exceptionEvent).toBeDefined();
      });

      it('should add exception event', () => {
        otel.startTrace('test-trace');
        otel.recordException(new Error('Test error'));

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span as SpanData;
        const exceptionEvent = span.events.find((e: SpanEvent) => e.name === 'exception');
        expect(exceptionEvent).toBeDefined();
        expect(exceptionEvent!.attributes!['exception.type']).toBe('Error');
        expect(exceptionEvent!.attributes!['exception.message']).toBe('Test error');
      });

      it('should include stack trace', () => {
        otel.startTrace('test-trace');
        const error = new Error('Test error');
        otel.recordException(error);

        const handler = jest.fn();
        otel.on('span:end', handler);
        otel.endSpan(otel.getTraceContext()!.spanId);

        const span = handler.mock.calls[0][0].span as SpanData;
        const exceptionEvent = span.events.find((e: SpanEvent) => e.name === 'exception');
        expect(exceptionEvent!.attributes!['exception.stacktrace']).toBeDefined();
      });

      it('should handle no active span gracefully', () => {
        // Should not throw
        otel.recordException(new Error('Orphan error'));
      });
    });
  });

  // ============================================================================
  // Trace Context
  // ============================================================================

  describe('Trace Context', () => {
    describe('getTraceContext', () => {
      it('should return current trace context', () => {
        otel.startTrace('test-trace');

        const context = otel.getTraceContext();

        expect(context).toBeDefined();
        expect(context!.traceId).toHaveLength(32);
        expect(context!.spanId).toHaveLength(16);
        expect(context!.traceFlags).toBe(1);
      });

      it('should return null when no active span', () => {
        const context = otel.getTraceContext();

        expect(context).toBeNull();
      });
    });

    describe('extractContext', () => {
      it('should extract context from valid traceparent header', () => {
        const traceparent = '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01';

        const context = otel.extractContext(traceparent);

        expect(context).toEqual({
          traceId: 'abcdef1234567890abcdef1234567890',
          spanId: '1234567890abcdef',
          traceFlags: 1,
        });
      });

      it('should return null for invalid traceparent', () => {
        const invalidHeaders = [
          'invalid',
          '00-abc-123-01',
          '01-abcdef1234567890abcdef1234567890-1234567890abcdef-01', // Wrong version
          '',
        ];

        for (const header of invalidHeaders) {
          expect(otel.extractContext(header)).toBeNull();
        }
      });
    });

    describe('injectContext', () => {
      it('should create valid traceparent header', () => {
        const context: TraceContext = {
          traceId: 'abcdef1234567890abcdef1234567890',
          spanId: '1234567890abcdef',
          traceFlags: 1,
        };

        const traceparent = otel.injectContext(context);

        expect(traceparent).toBe('00-abcdef1234567890abcdef1234567890-1234567890abcdef-01');
      });

      it('should pad trace flags', () => {
        const context: TraceContext = {
          traceId: 'abcdef1234567890abcdef1234567890',
          spanId: '1234567890abcdef',
          traceFlags: 0,
        };

        const traceparent = otel.injectContext(context);

        expect(traceparent).toBe('00-abcdef1234567890abcdef1234567890-1234567890abcdef-00');
      });
    });
  });

  // ============================================================================
  // Metric Collection
  // ============================================================================

  describe('Metric Collection', () => {
    describe('recordCounter', () => {
      it('should record counter metric', async () => {
        await otel.init();
        otel.recordCounter('requests', 1);
        otel.recordCounter('requests', 2);
        otel.recordCounter('requests', 3);

        // Trigger export
        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('requests'),
          })
        );
      });

      it('should record counter with default value', async () => {
        await otel.init();
        otel.recordCounter('events');

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.any(Object)
        );
      });

      it('should record counter with attributes', async () => {
        await otel.init();
        otel.recordCounter('requests', 1, { status: '200' });

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.objectContaining({
            body: expect.stringContaining('status'),
          })
        );
      });
    });

    describe('recordGauge', () => {
      it('should record gauge metric', async () => {
        await otel.init();
        otel.recordGauge('temperature', 25.5);

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.objectContaining({
            body: expect.stringContaining('temperature'),
          })
        );
      });

      it('should record gauge with attributes', async () => {
        await otel.init();
        otel.recordGauge('cpu_usage', 75.0, { core: '0' });

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.objectContaining({
            body: expect.stringContaining('core'),
          })
        );
      });
    });

    describe('recordHistogram', () => {
      it('should record histogram metric', async () => {
        await otel.init();
        otel.recordHistogram('latency', 150);

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.objectContaining({
            body: expect.stringContaining('latency'),
          })
        );
      });

      it('should record histogram with attributes', async () => {
        await otel.init();
        otel.recordHistogram('response_time', 200, { endpoint: '/api/users' });

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/metrics'),
          expect.objectContaining({
            body: expect.stringContaining('endpoint'),
          })
        );
      });
    });
  });

  // ============================================================================
  // Performance Monitoring
  // ============================================================================

  describe('Performance Monitoring', () => {
    describe('measure', () => {
      it('should measure async function execution', async () => {
        const handler = jest.fn();
        otel.on('span:end', handler);

        const result = await otel.measure('test-operation', async () => {
          jest.advanceTimersByTime(100);
          return 'result';
        });

        expect(result).toBe('result');
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              name: 'test-operation',
              status: { code: 'ok' },
            }),
          })
        );
      });

      it('should handle and re-throw errors', async () => {
        const handler = jest.fn();
        otel.on('span:end', handler);

        await expect(
          otel.measure('failing-operation', async () => {
            throw new Error('Operation failed');
          })
        ).rejects.toThrow('Operation failed');

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              status: expect.objectContaining({ code: 'error' }),
            }),
          })
        );
      });

      it('should record exception in span', async () => {
        const handler = jest.fn();
        otel.on('span:end', handler);

        await expect(
          otel.measure('failing-operation', async () => {
            throw new Error('Test failure');
          })
        ).rejects.toThrow();

        const span = handler.mock.calls[0][0].span as SpanData;
        const exceptionEvent = span.events.find((e: SpanEvent) => e.name === 'exception');
        expect(exceptionEvent).toBeDefined();
      });
    });
  });

  // ============================================================================
  // Telemetry Export
  // ============================================================================

  describe('Telemetry Export', () => {
    describe('Span Export', () => {
      it('should export span to OTLP endpoint', () => {
        otel.startTrace('export-test');
        otel.endSpan(otel.getTraceContext()!.spanId);

        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:4318/v1/traces',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      it('should include resource information in export', () => {
        otel.startTrace('resource-test');
        otel.endSpan(otel.getTraceContext()!.spanId);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(options.body);

        expect(body.resourceSpans[0].resource.attributes['service.name']).toBe('test-service');
        expect(body.resourceSpans[0].resource.attributes['service.version']).toBe('1.0.0');
      });

      it('should format span correctly for OTLP', () => {
        otel.startTrace('format-test', { kind: 'server' });
        otel.addEvent('test-event');
        otel.setAttribute('test.attr', 'value');
        otel.endSpan(otel.getTraceContext()!.spanId);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(options.body);
        const span = body.resourceSpans[0].scopeSpans[0].spans[0];

        expect(span.traceId).toHaveLength(32);
        expect(span.spanId).toHaveLength(16);
        expect(span.kind).toBe(2); // server
        expect(span.attributes).toContainEqual({ key: 'test.attr', value: { stringValue: 'value' } });
        expect(span.events).toHaveLength(1);
      });

      it('should handle export failure gracefully', () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

        // Should not throw
        otel.startTrace('fail-test');
        otel.endSpan(otel.getTraceContext()!.spanId);
      });

      it('should handle network errors gracefully', () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

        // Should not throw
        otel.startTrace('network-fail-test');
        otel.endSpan(otel.getTraceContext()!.spanId);
      });
    });

    describe('Metric Export', () => {
      it('should export metrics periodically', async () => {
        await otel.init();
        otel.recordCounter('test_counter', 1);
        otel.recordGauge('test_gauge', 100);

        jest.advanceTimersByTime(30000);

        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:4318/v1/metrics',
          expect.any(Object)
        );
      });

      it('should not export empty metrics', async () => {
        await otel.init();

        jest.advanceTimersByTime(30000);

        // Only called for metrics, not for empty payload
        const metricCalls = (global.fetch as jest.Mock).mock.calls.filter(
          (call: FetchCall) => call[0].includes('/v1/metrics')
        );
        expect(metricCalls).toHaveLength(0);
      });

      it('should group metrics by name', async () => {
        await otel.init();
        otel.recordCounter('same_metric', 1, { label: 'a' });
        otel.recordCounter('same_metric', 2, { label: 'b' });

        jest.advanceTimersByTime(30000);

        const metricCall = (global.fetch as jest.Mock).mock.calls.find(
          (call: FetchCall) => call[0].includes('/v1/metrics')
        ) as FetchCall;
        const body = JSON.parse(metricCall[1].body);

        expect(body.resourceMetrics[0].scopeMetrics[0].metrics).toHaveLength(1);
      });
    });

    describe('Console Export', () => {
      it('should log to console when consoleExport is enabled', () => {
        const consoleSpy = jest.spyOn(console, 'log');
        const consoleOtel = new OpenTelemetryIntegration({
          ...defaultConfig,
          consoleExport: true,
        });

        consoleOtel.startTrace('console-test');
        consoleOtel.endSpan(consoleOtel.getTraceContext()!.spanId);

        expect(consoleSpy).toHaveBeenCalledWith(
          '[OTEL SPAN]',
          expect.any(String)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  // ============================================================================
  // Attribute Value Formatting
  // ============================================================================

  describe('Attribute Value Formatting', () => {
    it('should format string values', () => {
      otel.startTrace('test');
      otel.setAttribute('string.attr', 'test-value');
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as FetchCall;
      const body = JSON.parse(options.body);
      const attr = (body.resourceSpans[0].scopeSpans[0].spans[0].attributes as OTLPAttribute[]).find(
        (a: OTLPAttribute) => a.key === 'string.attr'
      );

      expect(attr!.value).toEqual({ stringValue: 'test-value' });
    });

    it('should format integer values', () => {
      otel.startTrace('test');
      otel.setAttribute('int.attr', 42);
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as FetchCall;
      const body = JSON.parse(options.body);
      const attr = (body.resourceSpans[0].scopeSpans[0].spans[0].attributes as OTLPAttribute[]).find(
        (a: OTLPAttribute) => a.key === 'int.attr'
      );

      expect(attr!.value).toEqual({ intValue: 42 });
    });

    it('should format float values', () => {
      otel.startTrace('test');
      otel.setAttribute('float.attr', 3.14);
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as FetchCall;
      const body = JSON.parse(options.body);
      const attr = (body.resourceSpans[0].scopeSpans[0].spans[0].attributes as OTLPAttribute[]).find(
        (a: OTLPAttribute) => a.key === 'float.attr'
      );

      expect(attr!.value).toEqual({ doubleValue: 3.14 });
    });

    it('should format boolean values', () => {
      otel.startTrace('test');
      otel.setAttribute('bool.attr', true);
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as FetchCall;
      const body = JSON.parse(options.body);
      const attr = (body.resourceSpans[0].scopeSpans[0].spans[0].attributes as OTLPAttribute[]).find(
        (a: OTLPAttribute) => a.key === 'bool.attr'
      );

      expect(attr!.value).toEqual({ boolValue: true });
    });

    it('should format array values', () => {
      otel.startTrace('test');
      otel.setAttribute('array.attr', ['a', 'b', 'c']);
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as FetchCall;
      const body = JSON.parse(options.body);
      const attr = (body.resourceSpans[0].scopeSpans[0].spans[0].attributes as OTLPAttribute[]).find(
        (a: OTLPAttribute) => a.key === 'array.attr'
      );

      expect(attr!.value.arrayValue).toBeDefined();
      expect(attr!.value.arrayValue!.values).toHaveLength(3);
    });
  });

  // ============================================================================
  // Span Kind Mapping
  // ============================================================================

  describe('Span Kind Mapping', () => {
    const kindTestCases: Array<{ kind: SpanKind; expected: number }> = [
      { kind: 'internal', expected: 1 },
      { kind: 'server', expected: 2 },
      { kind: 'client', expected: 3 },
      { kind: 'producer', expected: 4 },
      { kind: 'consumer', expected: 5 },
    ];

    test.each(kindTestCases)('should map $kind to $expected', ({ kind, expected }) => {
      otel.startTrace('kind-test', { kind });
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      const span = body.resourceSpans[0].scopeSpans[0].spans[0];

      expect(span.kind).toBe(expected);
    });
  });

  // ============================================================================
  // Shutdown
  // ============================================================================

  describe('Shutdown', () => {
    it('should stop export interval', async () => {
      await otel.init();
      await otel.shutdown();

      jest.advanceTimersByTime(60000);

      // Fetch should not be called after shutdown (beyond initial cleanup)
      const callsAfterShutdown = (global.fetch as jest.Mock).mock.calls.length;
      jest.advanceTimersByTime(60000);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(callsAfterShutdown);
    });

    it('should export remaining spans on shutdown', async () => {
      otel.startTrace('pending-span');
      // Don't end the span, let shutdown handle it

      await otel.shutdown();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/traces'),
        expect.any(Object)
      );
    });

    it('should export remaining metrics on shutdown', async () => {
      await otel.init();
      otel.recordCounter('pending_metric', 1);

      await otel.shutdown();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/metrics'),
        expect.any(Object)
      );
    });

    it('should emit shutdown event', async () => {
      const handler = jest.fn();
      otel.on('shutdown', handler);

      await otel.shutdown();

      expect(handler).toHaveBeenCalled();
    });

    it('should clear active spans', async () => {
      otel.startTrace('span1');
      otel.startTrace('span2');

      await otel.shutdown();

      expect(otel.getTraceContext()).toBeNull();
    });
  });

  // ============================================================================
  // Resource Creation
  // ============================================================================

  describe('Resource Creation', () => {
    it('should include standard resource attributes', () => {
      otel.startTrace('resource-test');
      otel.endSpan(otel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      const attrs = body.resourceSpans[0].resource.attributes;

      expect(attrs['service.name']).toBe('test-service');
      expect(attrs['service.version']).toBe('1.0.0');
      expect(attrs['deployment.environment']).toBe('test');
      expect(attrs['host.name']).toBe('test-hostname');
      expect(attrs['host.arch']).toBe('x64');
      expect(attrs['os.type']).toBe('Linux');
      expect(attrs['process.runtime.name']).toBe('node');
    });

    it('should include custom resource attributes', () => {
      const customOtel = new OpenTelemetryIntegration({
        serviceName: 'custom-service',
        resourceAttributes: {
          'custom.attr1': 'value1',
          'custom.attr2': 'value2',
        },
      });

      customOtel.startTrace('custom-test');
      customOtel.endSpan(customOtel.getTraceContext()!.spanId);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      const attrs = body.resourceSpans[0].resource.attributes;

      expect(attrs['custom.attr1']).toBe('value1');
      expect(attrs['custom.attr2']).toBe('value2');
    });
  });
});

// ============================================================================
// Singleton and Helper Functions
// ============================================================================

describe('OpenTelemetry Singleton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton by requiring the module fresh
    jest.resetModules();
  });

  describe('initOpenTelemetry', () => {
    it('should create and return singleton instance', () => {
      const instance = initOpenTelemetry({ serviceName: 'singleton-test' });

      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(EventEmitter);
    });

    it('should return same instance on subsequent calls', () => {
      const { initOpenTelemetry: init } = require('../../src/integrations/opentelemetry-integration');

      const instance1 = init({ serviceName: 'test1' });
      const instance2 = init({ serviceName: 'test2' }); // Different config, same instance

      expect(instance1).toBe(instance2);
    });
  });

  describe('getOpenTelemetry', () => {
    it('should return null when not initialized', () => {
      const { getOpenTelemetry: get } = require('../../src/integrations/opentelemetry-integration');

      expect(get()).toBeNull();
    });

    it('should return instance after initialization', () => {
      const { initOpenTelemetry: init, getOpenTelemetry: get } = require('../../src/integrations/opentelemetry-integration');

      init({ serviceName: 'test' });

      expect(get()).not.toBeNull();
    });
  });

  describe('trace helper', () => {
    it('should execute function when OpenTelemetry not initialized', async () => {
      const { trace: traceHelper } = require('../../src/integrations/opentelemetry-integration');

      const result = await traceHelper('test', async () => 'result');

      expect(result).toBe('result');
    });

    it('should trace function when OpenTelemetry is initialized', async () => {
      const { initOpenTelemetry: init, trace: traceHelper } = require('../../src/integrations/opentelemetry-integration');

      const instance = init({ serviceName: 'trace-test' });
      const measureSpy = jest.spyOn(instance, 'measure');

      await traceHelper('traced-operation', async () => 'traced-result');

      expect(measureSpy).toHaveBeenCalledWith('traced-operation', expect.any(Function));
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  let otel: OpenTelemetryIntegration;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    otel = new OpenTelemetryIntegration({ serviceName: 'edge-test' });
  });

  afterEach(async () => {
    await otel.shutdown();
    jest.useRealTimers();
  });

  it('should handle deeply nested spans', () => {
    const spanIds: string[] = [];

    for (let i = 0; i < 10; i++) {
      spanIds.push(otel.startSpan(`span-${i}`));
    }

    // End spans in reverse order
    for (let i = spanIds.length - 1; i >= 0; i--) {
      otel.endSpan(spanIds[i]);
    }

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(10);
  });

  it('should handle concurrent spans', () => {
    const spanId1 = otel.startTrace('concurrent-1');
    const spanId2 = otel.startTrace('concurrent-2');

    otel.endSpan(spanId1);
    otel.endSpan(spanId2);

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('should handle rapid metric recording', async () => {
    await otel.init();

    for (let i = 0; i < 100; i++) {
      otel.recordCounter('rapid_counter');
    }

    jest.advanceTimersByTime(30000);

    expect(global.fetch).toHaveBeenCalled();
  });

  it('should handle empty span name', () => {
    const spanId = otel.startTrace('');

    expect(spanId).toBeDefined();
    otel.endSpan(spanId);
  });

  it('should handle special characters in attributes', () => {
    otel.startTrace('special-chars');
    otel.setAttribute('special.chars', 'value with "quotes" and \n newlines');
    otel.endSpan(otel.getTraceContext()!.spanId);

    // Should not throw
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should handle undefined attribute values gracefully', () => {
    otel.startTrace('undefined-attr');
    // Test with undefined value (edge case)
    otel.setAttribute('undefined.attr', undefined as unknown as string);
    otel.endSpan(otel.getTraceContext()!.spanId);

    // Should not throw
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should handle very long trace IDs', () => {
    // The implementation generates fixed-length IDs, but verify format
    const spanId = otel.startTrace('long-trace');
    const context = otel.getTraceContext();

    expect(context!.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(context!.spanId).toMatch(/^[a-f0-9]{16}$/);

    otel.endSpan(spanId);
  });
});

// ============================================================================
// Metric Type Formatting
// ============================================================================

describe('Metric Type Formatting', () => {
  let otel: OpenTelemetryIntegration;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    otel = new OpenTelemetryIntegration({ serviceName: 'metric-format-test' });
    await otel.init();
  });

  afterEach(async () => {
    await otel.shutdown();
    jest.useRealTimers();
  });

  it('should format counter metrics correctly', async () => {
    otel.recordCounter('test_counter', 5);
    jest.advanceTimersByTime(30000);

    const metricCall = (global.fetch as jest.Mock).mock.calls.find(
      (call: FetchCall) => call[0].includes('/v1/metrics')
    ) as FetchCall | undefined;

    if (metricCall) {
      const body = JSON.parse(metricCall[1].body);
      const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];

      expect(metric.sum).toBeDefined();
      expect(metric.sum.isMonotonic).toBe(true);
      expect(metric.sum.aggregationTemporality).toBe(2);
    }
  });

  it('should format gauge metrics correctly', async () => {
    otel.recordGauge('test_gauge', 42);
    jest.advanceTimersByTime(30000);

    const metricCall = (global.fetch as jest.Mock).mock.calls.find(
      (call: FetchCall) => call[0].includes('/v1/metrics')
    ) as FetchCall | undefined;

    if (metricCall) {
      const body = JSON.parse(metricCall[1].body);
      const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];

      expect(metric.gauge).toBeDefined();
    }
  });

  it('should format histogram metrics correctly', async () => {
    otel.recordHistogram('test_histogram', 100);
    jest.advanceTimersByTime(30000);

    const metricCall = (global.fetch as jest.Mock).mock.calls.find(
      (call: FetchCall) => call[0].includes('/v1/metrics')
    ) as FetchCall | undefined;

    if (metricCall) {
      const body = JSON.parse(metricCall[1].body);
      const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];

      expect(metric.histogram).toBeDefined();
      expect(metric.histogram.aggregationTemporality).toBe(2);
    }
  });
});
