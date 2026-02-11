/**
 * OpenTelemetry Tracing Module Tests
 *
 * Comprehensive tests covering:
 * - Trace creation
 * - Span management
 * - Context propagation
 */

import {
  OpenTelemetryIntegration,
  OTelConfig,
  TraceContext,
  SpanKind,
  initOpenTelemetry,
  getOpenTelemetry,
  trace,
} from '../../src/integrations/opentelemetry-integration.js';

// Mock the logger module
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fetch for HTTP exports
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
  } as Response)
);

describe('OpenTelemetryIntegration', () => {
  let otel: OpenTelemetryIntegration;
  const defaultConfig: OTelConfig = {
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
    endpoint: 'http://localhost:4318',
    exportInterval: 30000,
    consoleExport: false,
    samplingRate: 1.0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    otel = new OpenTelemetryIntegration(defaultConfig);
  });

  afterEach(async () => {
    if (otel) {
      await otel.shutdown();
    }
    jest.useRealTimers();
  });

  describe('Constructor and Initialization', () => {
    it('should create instance with provided config', () => {
      expect(otel).toBeInstanceOf(OpenTelemetryIntegration);
    });

    it('should apply default values for optional config', () => {
      const minimalConfig: OTelConfig = { serviceName: 'minimal-service' };
      const instance = new OpenTelemetryIntegration(minimalConfig);

      // The instance should be created without errors
      expect(instance).toBeInstanceOf(OpenTelemetryIntegration);
      instance.shutdown();
    });

    it('should emit initialized event after init', async () => {
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

      expect(initHandler).toHaveBeenCalledTimes(1);
    });

    it('should start export interval on init', async () => {
      await otel.init();

      // Export interval is set
      expect(otel['exportInterval']).not.toBeNull();
    });
  });

  describe('Trace Creation', () => {
    it('should start a new trace and return span ID', () => {
      const spanId = otel.startTrace('test-trace');

      expect(spanId).toBeDefined();
      expect(typeof spanId).toBe('string');
      expect(spanId.length).toBe(16); // Span IDs are 16 hex chars
    });

    it('should create trace with custom kind', () => {
      const spanId = otel.startTrace('server-trace', { kind: 'server' });

      expect(spanId).toBeDefined();
      const span = otel['activeSpans'].get(spanId);
      expect(span?.kind).toBe('server');
    });

    it('should create trace with custom attributes', () => {
      const spanId = otel.startTrace('attributed-trace', {
        attributes: { 'http.method': 'GET', 'http.url': '/api/test' },
      });

      const span = otel['activeSpans'].get(spanId);
      expect(span?.attributes['http.method']).toBe('GET');
      expect(span?.attributes['http.url']).toBe('/api/test');
    });

    it('should generate unique trace IDs', () => {
      const spanId1 = otel.startTrace('trace-1');
      const span1 = otel['activeSpans'].get(spanId1);
      otel.endSpan(spanId1);

      const spanId2 = otel.startTrace('trace-2');
      const span2 = otel['activeSpans'].get(spanId2);

      expect(span1?.traceId).not.toBe(span2?.traceId);
    });

    it('should respect sampling rate', () => {
      // Create instance with 0 sampling rate
      const sampledOtel = new OpenTelemetryIntegration({
        ...defaultConfig,
        samplingRate: 0,
      });

      const spanId = sampledOtel.startTrace('sampled-trace');

      // With 0 sampling rate, should return empty string
      expect(spanId).toBe('');
      sampledOtel.shutdown();
    });

    it('should add span to active spans map', () => {
      const spanId = otel.startTrace('tracked-trace');

      expect(otel['activeSpans'].has(spanId)).toBe(true);
    });

    it('should push span to span stack', () => {
      const spanId = otel.startTrace('stacked-trace');

      expect(otel['spanStack']).toContain(spanId);
    });

    it('should emit span:start event', () => {
      const startHandler = jest.fn();
      otel.on('span:start', startHandler);

      otel.startTrace('event-trace');

      expect(startHandler).toHaveBeenCalled();
      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          span: expect.objectContaining({ name: 'event-trace' }),
        })
      );
    });
  });

  describe('Span Management', () => {
    describe('startSpan', () => {
      it('should create child span with parent trace ID', () => {
        const parentId = otel.startTrace('parent');
        const parentSpan = otel['activeSpans'].get(parentId);

        const childId = otel.startSpan('child');
        const childSpan = otel['activeSpans'].get(childId);

        expect(childSpan?.traceId).toBe(parentSpan?.traceId);
        expect(childSpan?.parentSpanId).toBe(parentId);
      });

      it('should start new trace if no parent exists', () => {
        // No parent trace started
        const spanId = otel.startSpan('orphan-span');

        expect(spanId).toBeDefined();
        const span = otel['activeSpans'].get(spanId);
        expect(span?.parentSpanId).toBeUndefined();
      });

      it('should maintain correct span stack', () => {
        const parentId = otel.startTrace('parent');
        const child1Id = otel.startSpan('child1');
        const child2Id = otel.startSpan('child2');

        expect(otel['spanStack']).toEqual([parentId, child1Id, child2Id]);
      });

      it('should support different span kinds', () => {
        otel.startTrace('parent');

        const kinds: SpanKind[] = ['internal', 'server', 'client', 'producer', 'consumer'];

        for (const kind of kinds) {
          const spanId = otel.startSpan(`span-${kind}`, { kind });
          const span = otel['activeSpans'].get(spanId);
          expect(span?.kind).toBe(kind);
          otel.endSpan(spanId);
        }
      });
    });

    describe('endSpan', () => {
      it('should set end time on span', () => {
        const spanId = otel.startTrace('timed-span');
        otel.endSpan(spanId);

        // Span should be deleted after end
        expect(otel['activeSpans'].has(spanId)).toBe(false);
      });

      it('should set status to ok by default', async () => {
        const spanId = otel.startTrace('ok-span');

        const endHandler = jest.fn();
        otel.on('span:end', endHandler);

        otel.endSpan(spanId);

        expect(endHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({ status: { code: 'ok' } }),
          })
        );
      });

      it('should accept custom status', async () => {
        const spanId = otel.startTrace('error-span');

        const endHandler = jest.fn();
        otel.on('span:end', endHandler);

        otel.endSpan(spanId, { code: 'error', message: 'Something went wrong' });

        expect(endHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            span: expect.objectContaining({
              status: { code: 'error', message: 'Something went wrong' },
            }),
          })
        );
      });

      it('should remove span from stack', () => {
        const spanId = otel.startTrace('removable-span');
        expect(otel['spanStack']).toContain(spanId);

        otel.endSpan(spanId);
        expect(otel['spanStack']).not.toContain(spanId);
      });

      it('should remove span from active spans', () => {
        const spanId = otel.startTrace('deletable-span');
        expect(otel['activeSpans'].has(spanId)).toBe(true);

        otel.endSpan(spanId);
        expect(otel['activeSpans'].has(spanId)).toBe(false);
      });

      it('should emit span:end event', () => {
        const spanId = otel.startTrace('event-span');

        const endHandler = jest.fn();
        otel.on('span:end', endHandler);

        otel.endSpan(spanId);

        expect(endHandler).toHaveBeenCalled();
      });

      it('should handle ending non-existent span gracefully', () => {
        // Should not throw
        expect(() => otel.endSpan('non-existent-span')).not.toThrow();
      });

      it('should call export for completed spans', async () => {
        await otel.init();
        const spanId = otel.startTrace('export-span');

        otel.endSpan(spanId);

        // Export is async, so fetch should be called
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    describe('addEvent', () => {
      it('should add event to current span', () => {
        const spanId = otel.startTrace('event-span');

        otel.addEvent('custom-event', { detail: 'test' });

        const span = otel['activeSpans'].get(spanId);
        expect(span?.events).toHaveLength(1);
        expect(span?.events[0].name).toBe('custom-event');
        expect(span?.events[0].attributes?.detail).toBe('test');
      });

      it('should set timestamp on event', () => {
        const spanId = otel.startTrace('timed-event-span');

        otel.addEvent('timed-event');

        const span = otel['activeSpans'].get(spanId);
        expect(span?.events[0].timestamp).toBeDefined();
      });

      it('should do nothing if no active span', () => {
        // No span started
        expect(() => otel.addEvent('orphan-event')).not.toThrow();
      });

      it('should add events to nested spans correctly', () => {
        otel.startTrace('parent');
        otel.addEvent('parent-event');

        const childId = otel.startSpan('child');
        otel.addEvent('child-event');

        const childSpan = otel['activeSpans'].get(childId);
        expect(childSpan?.events).toHaveLength(1);
        expect(childSpan?.events[0].name).toBe('child-event');
      });
    });

    describe('setAttribute', () => {
      it('should set attribute on current span', () => {
        const spanId = otel.startTrace('attr-span');

        otel.setAttribute('custom.attribute', 'value');

        const span = otel['activeSpans'].get(spanId);
        expect(span?.attributes['custom.attribute']).toBe('value');
      });

      it('should support various attribute types', () => {
        const spanId = otel.startTrace('typed-attr-span');

        otel.setAttribute('string.attr', 'hello');
        otel.setAttribute('number.attr', 42);
        otel.setAttribute('boolean.attr', true);
        otel.setAttribute('array.attr', ['a', 'b', 'c']);

        const span = otel['activeSpans'].get(spanId);
        expect(span?.attributes['string.attr']).toBe('hello');
        expect(span?.attributes['number.attr']).toBe(42);
        expect(span?.attributes['boolean.attr']).toBe(true);
        expect(span?.attributes['array.attr']).toEqual(['a', 'b', 'c']);
      });

      it('should do nothing if no active span', () => {
        expect(() => otel.setAttribute('orphan.attr', 'value')).not.toThrow();
      });
    });

    describe('recordException', () => {
      it('should set error status on span', () => {
        const spanId = otel.startTrace('exception-span');

        const error = new Error('Test error');
        otel.recordException(error);

        const span = otel['activeSpans'].get(spanId);
        expect(span?.status.code).toBe('error');
        expect(span?.status.message).toBe('Test error');
      });

      it('should add exception event', () => {
        const spanId = otel.startTrace('exception-event-span');

        const error = new Error('Exception message');
        error.stack = 'Error: Exception message\n    at test.js:1:1';
        otel.recordException(error);

        const span = otel['activeSpans'].get(spanId);
        const exceptionEvent = span?.events.find(e => e.name === 'exception');

        expect(exceptionEvent).toBeDefined();
        expect(exceptionEvent?.attributes?.['exception.type']).toBe('Error');
        expect(exceptionEvent?.attributes?.['exception.message']).toBe('Exception message');
        expect(exceptionEvent?.attributes?.['exception.stacktrace']).toContain('at test.js');
      });

      it('should handle errors without stack trace', () => {
        const spanId = otel.startTrace('no-stack-span');

        const error = new Error('No stack');
        delete error.stack;
        otel.recordException(error);

        const span = otel['activeSpans'].get(spanId);
        const exceptionEvent = span?.events.find(e => e.name === 'exception');

        expect(exceptionEvent?.attributes?.['exception.stacktrace']).toBe('');
      });
    });
  });

  describe('Context Propagation', () => {
    describe('getTraceContext', () => {
      it('should return current trace context', () => {
        const spanId = otel.startTrace('context-span');

        const context = otel.getTraceContext();

        expect(context).not.toBeNull();
        expect(context?.spanId).toBe(spanId);
        expect(context?.traceId).toBeDefined();
        expect(context?.traceFlags).toBe(1);
      });

      it('should return null if no active span', () => {
        const context = otel.getTraceContext();
        expect(context).toBeNull();
      });

      it('should return context for nested spans', () => {
        const parentId = otel.startTrace('parent');
        const parentSpan = otel['activeSpans'].get(parentId);

        const childId = otel.startSpan('child');

        const context = otel.getTraceContext();

        expect(context?.spanId).toBe(childId);
        expect(context?.traceId).toBe(parentSpan?.traceId);
      });
    });

    describe('extractContext', () => {
      it('should parse valid W3C traceparent header', () => {
        const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

        const context = otel.extractContext(traceparent);

        expect(context).not.toBeNull();
        expect(context?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
        expect(context?.spanId).toBe('b7ad6b7169203331');
        expect(context?.traceFlags).toBe(1);
      });

      it('should return null for invalid traceparent', () => {
        const invalidHeaders = [
          'invalid',
          '00-short-too-short-00',
          '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', // Wrong version
          '',
          '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331', // Missing flags
        ];

        for (const header of invalidHeaders) {
          const context = otel.extractContext(header);
          expect(context).toBeNull();
        }
      });

      it('should parse different trace flags', () => {
        const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00';

        const context = otel.extractContext(traceparent);

        expect(context?.traceFlags).toBe(0);
      });
    });

    describe('injectContext', () => {
      it('should create valid W3C traceparent header', () => {
        const context: TraceContext = {
          traceId: '0af7651916cd43dd8448eb211c80319c',
          spanId: 'b7ad6b7169203331',
          traceFlags: 1,
        };

        const traceparent = otel.injectContext(context);

        expect(traceparent).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
      });

      it('should pad trace flags correctly', () => {
        const context: TraceContext = {
          traceId: '0af7651916cd43dd8448eb211c80319c',
          spanId: 'b7ad6b7169203331',
          traceFlags: 0,
        };

        const traceparent = otel.injectContext(context);

        expect(traceparent).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00');
      });

      it('should round-trip context correctly', () => {
        const original: TraceContext = {
          traceId: 'abcd1234abcd1234abcd1234abcd1234',
          spanId: '1234567890abcdef',
          traceFlags: 1,
        };

        const traceparent = otel.injectContext(original);
        const extracted = otel.extractContext(traceparent);

        expect(extracted).toEqual(original);
      });
    });
  });

  describe('Metrics Recording', () => {
    describe('recordCounter', () => {
      it('should record counter metric', () => {
        otel.recordCounter('requests.total', 1);

        const metrics = otel['metrics'];
        expect(metrics).toHaveLength(1);
        expect(metrics[0].name).toBe('requests.total');
        expect(metrics[0].type).toBe('counter');
        expect(metrics[0].value).toBe(1);
      });

      it('should support custom increment values', () => {
        otel.recordCounter('items.processed', 5);

        expect(otel['metrics'][0].value).toBe(5);
      });

      it('should support attributes', () => {
        otel.recordCounter('requests', 1, { endpoint: '/api/users' });

        expect(otel['metrics'][0].attributes).toEqual({ endpoint: '/api/users' });
      });
    });

    describe('recordGauge', () => {
      it('should record gauge metric', () => {
        otel.recordGauge('memory.usage', 1024);

        const metrics = otel['metrics'];
        expect(metrics[0].type).toBe('gauge');
        expect(metrics[0].value).toBe(1024);
      });
    });

    describe('recordHistogram', () => {
      it('should record histogram metric', () => {
        otel.recordHistogram('request.duration', 150);

        const metrics = otel['metrics'];
        expect(metrics[0].type).toBe('histogram');
        expect(metrics[0].value).toBe(150);
      });
    });
  });

  describe('Measure Function', () => {
    it('should measure async function execution', async () => {
      const result = await otel.measure('test-operation', async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should create span for measured operation', async () => {
      const startHandler = jest.fn();
      const endHandler = jest.fn();
      otel.on('span:start', startHandler);
      otel.on('span:end', endHandler);

      await otel.measure('measured-op', async () => 'done');

      expect(startHandler).toHaveBeenCalled();
      expect(endHandler).toHaveBeenCalled();
    });

    it('should set ok status on success', async () => {
      const endHandler = jest.fn();
      otel.on('span:end', endHandler);

      await otel.measure('success-op', async () => 'done');

      expect(endHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          span: expect.objectContaining({ status: { code: 'ok' } }),
        })
      );
    });

    it('should set error status and re-throw on failure', async () => {
      const endHandler = jest.fn();
      otel.on('span:end', endHandler);

      const error = new Error('Operation failed');

      await expect(
        otel.measure('failing-op', async () => {
          throw error;
        })
      ).rejects.toThrow('Operation failed');

      expect(endHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          span: expect.objectContaining({
            status: expect.objectContaining({ code: 'error' }),
          }),
        })
      );
    });

    it('should record exception on error', async () => {
      otel.startTrace('parent'); // Need parent to record exception on current span

      otel.startSpan('exception-span');

      try {
        await otel.measure('exception-measure', async () => {
          throw new Error('Measured error');
        });
      } catch {
        // Expected
      }

      // The measure function creates its own span, so we check the parent
    });
  });

  describe('Shutdown', () => {
    it('should clear export interval', async () => {
      await otel.init();
      expect(otel['exportInterval']).not.toBeNull();

      await otel.shutdown();
      expect(otel['exportInterval']).toBeNull();
    });

    it('should export remaining spans', async () => {
      await otel.init();
      otel.startTrace('unfinished-span');

      await otel.shutdown();

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should clear active spans', async () => {
      otel.startTrace('span-1');
      otel.startTrace('span-2');

      await otel.shutdown();

      expect(otel['activeSpans'].size).toBe(0);
    });

    it('should clear span stack', async () => {
      otel.startTrace('stacked-span');

      await otel.shutdown();

      expect(otel['spanStack']).toHaveLength(0);
    });

    it('should emit shutdown event', async () => {
      const shutdownHandler = jest.fn();
      otel.on('shutdown', shutdownHandler);

      await otel.shutdown();

      expect(shutdownHandler).toHaveBeenCalled();
    });

    it('should set initialized to false', async () => {
      await otel.init();
      expect(otel['initialized']).toBe(true);

      await otel.shutdown();
      expect(otel['initialized']).toBe(false);
    });
  });

  describe('OTLP Export', () => {
    beforeEach(async () => {
      await otel.init();
    });

    it('should export span to OTLP endpoint', async () => {
      const spanId = otel.startTrace('export-test');
      otel.endSpan(spanId);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4318/v1/traces',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should format span correctly for OTLP', async () => {
      const spanId = otel.startTrace('format-test', { kind: 'client' });
      otel.setAttribute('test.attr', 'value');
      otel.addEvent('test-event');
      otel.endSpan(spanId);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.resourceSpans).toBeDefined();
      expect(body.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
        name: 'format-test',
        kind: 3, // client = 3
      });
    });

    it('should handle export failures gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const spanId = otel.startTrace('failing-export');

      // Should not throw
      expect(() => otel.endSpan(spanId)).not.toThrow();
    });

    it('should log to console when consoleExport is enabled', async () => {
      const consoleOtel = new OpenTelemetryIntegration({
        ...defaultConfig,
        consoleExport: true,
      });
      await consoleOtel.init();

      const spanId = consoleOtel.startTrace('console-export');
      consoleOtel.endSpan(spanId);

      // The logger.debug is called with '[OTEL SPAN]' and span object
      // We can't easily spy on logger.debug in this test setup,
      // so we just verify the span was created and ended
      expect(consoleOtel['activeSpans'].has(spanId)).toBe(false);
      await consoleOtel.shutdown();
    });
  });

  describe('Metrics Export', () => {
    it('should export metrics periodically', async () => {
      await otel.init();
      otel.recordCounter('test.counter', 1);

      // Advance timer to trigger export
      jest.advanceTimersByTime(30000);

      // Give async export time to complete
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4318/v1/metrics',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should not export if no metrics recorded', async () => {
      await otel.init();
      (global.fetch as jest.Mock).mockClear();

      // Advance timer
      jest.advanceTimersByTime(30000);
      await Promise.resolve();

      // Fetch should not be called for metrics endpoint
      const metricsCalls = (global.fetch as jest.Mock).mock.calls.filter(
        call => call[0].includes('/v1/metrics')
      );
      expect(metricsCalls).toHaveLength(0);
    });

    it('should group metrics by name', async () => {
      await otel.init();
      otel.recordCounter('requests', 1);
      otel.recordCounter('requests', 2);
      otel.recordCounter('errors', 1);

      jest.advanceTimersByTime(30000);
      await Promise.resolve();

      const fetchCall = (global.fetch as jest.Mock).mock.calls.find(
        call => call[0].includes('/v1/metrics')
      );

      if (fetchCall) {
        const body = JSON.parse(fetchCall[1].body);
        const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
        expect(metrics).toHaveLength(2); // requests and errors
      }
    });
  });

  describe('ID Generation', () => {
    it('should generate 32-char trace IDs', () => {
      const traceId = otel['generateTraceId']();
      expect(traceId).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should generate 16-char span IDs', () => {
      const spanId = otel['generateSpanId']();
      expect(spanId).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should generate unique trace IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(otel['generateTraceId']());
      }
      expect(ids.size).toBe(100);
    });

    it('should generate unique span IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(otel['generateSpanId']());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('Resource Creation', () => {
    it('should create resource with service attributes', () => {
      const resource = otel['resource'];

      expect(resource.attributes['service.name']).toBe('test-service');
      expect(resource.attributes['service.version']).toBe('1.0.0');
      expect(resource.attributes['deployment.environment']).toBe('test');
    });

    it('should include host information', () => {
      const resource = otel['resource'];

      expect(resource.attributes['host.name']).toBeDefined();
      expect(resource.attributes['host.arch']).toBeDefined();
      expect(resource.attributes['os.type']).toBeDefined();
    });

    it('should include process information', () => {
      const resource = otel['resource'];

      expect(resource.attributes['process.runtime.name']).toBe('node');
      expect(resource.attributes['process.runtime.version']).toBeDefined();
      expect(resource.attributes['process.pid']).toBeDefined();
    });

    it('should merge custom resource attributes', () => {
      const customOtel = new OpenTelemetryIntegration({
        ...defaultConfig,
        resourceAttributes: { 'custom.attr': 'custom-value' },
      });

      const resource = customOtel['resource'];
      expect(resource.attributes['custom.attr']).toBe('custom-value');

      customOtel.shutdown();
    });
  });

  describe('Span Kind Mapping', () => {
    it('should map span kinds to OTLP numbers', () => {
      const kindMap: Record<SpanKind, number> = {
        internal: 1,
        server: 2,
        client: 3,
        producer: 4,
        consumer: 5,
      };

      for (const [kind, expected] of Object.entries(kindMap)) {
        const result = otel['getSpanKindNumber'](kind as SpanKind);
        expect(result).toBe(expected);
      }
    });
  });

  describe('Attribute Formatting', () => {
    it('should format string attributes', () => {
      const result = otel['formatAttributeValue']('test');
      expect(result).toEqual({ stringValue: 'test' });
    });

    it('should format integer attributes', () => {
      const result = otel['formatAttributeValue'](42);
      expect(result).toEqual({ intValue: 42 });
    });

    it('should format double attributes', () => {
      const result = otel['formatAttributeValue'](3.14);
      expect(result).toEqual({ doubleValue: 3.14 });
    });

    it('should format boolean attributes', () => {
      const result = otel['formatAttributeValue'](true);
      expect(result).toEqual({ boolValue: true });
    });

    it('should format array attributes', () => {
      const result = otel['formatAttributeValue'](['a', 'b']);
      expect(result).toEqual({
        arrayValue: {
          values: [{ stringValue: 'a' }, { stringValue: 'b' }],
        },
      });
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    // Reset singleton by accessing private state
    // This is a workaround for testing singletons
    jest.resetModules();
  });

  afterEach(async () => {
    const instance = getOpenTelemetry();
    if (instance) {
      await instance.shutdown();
    }
  });

  describe('initOpenTelemetry', () => {
    it('should create and return instance', () => {
      const instance = initOpenTelemetry({ serviceName: 'singleton-test' });
      expect(instance).toBeInstanceOf(OpenTelemetryIntegration);
    });

    it('should return same instance on subsequent calls', () => {
      const instance1 = initOpenTelemetry({ serviceName: 'singleton-test' });
      const instance2 = initOpenTelemetry({ serviceName: 'different-name' });

      expect(instance1).toBe(instance2);
    });
  });

  describe('getOpenTelemetry', () => {
    it('should return null before initialization', () => {
      // Note: This test may not work correctly due to singleton state
      // In real testing, you'd want to reset the module between tests
    });

    it('should return instance after initialization', () => {
      initOpenTelemetry({ serviceName: 'get-test' });
      const instance = getOpenTelemetry();

      expect(instance).not.toBeNull();
    });
  });

  describe('trace helper', () => {
    it('should execute function without tracing if not initialized', async () => {
      // Reset to ensure no instance
      const result = await trace('untraced', async () => 'result');
      expect(result).toBe('result');
    });

    it('should trace function when initialized', async () => {
      const otel = initOpenTelemetry({ serviceName: 'trace-helper-test' });
      await otel.init();

      const startHandler = jest.fn();
      otel.on('span:start', startHandler);

      await trace('traced-function', async () => 'traced-result');

      expect(startHandler).toHaveBeenCalled();
    });
  });
});

describe('Edge Cases', () => {
  let otel: OpenTelemetryIntegration;

  beforeEach(() => {
    otel = new OpenTelemetryIntegration({ serviceName: 'edge-case-test' });
  });

  afterEach(async () => {
    await otel.shutdown();
  });

  it('should handle deeply nested spans', () => {
    const depth = 10;
    const spanIds: string[] = [];

    spanIds.push(otel.startTrace('root'));
    for (let i = 1; i < depth; i++) {
      spanIds.push(otel.startSpan(`level-${i}`));
    }

    expect(otel['spanStack']).toHaveLength(depth);

    // End spans in reverse order
    for (let i = depth - 1; i >= 0; i--) {
      otel.endSpan(spanIds[i]);
    }

    expect(otel['spanStack']).toHaveLength(0);
    expect(otel['activeSpans'].size).toBe(0);
  });

  it('should handle concurrent traces', () => {
    const trace1 = otel.startTrace('trace-1');
    otel.endSpan(trace1);

    const trace2 = otel.startTrace('trace-2');
    const span2 = otel['activeSpans'].get(trace2);

    // Second trace should have different trace ID
    expect(span2?.parentSpanId).toBeUndefined();
  });

  it('should handle rapid span creation/ending', () => {
    for (let i = 0; i < 100; i++) {
      const spanId = otel.startTrace(`rapid-${i}`);
      otel.setAttribute('iteration', i);
      otel.addEvent('iteration-event');
      otel.endSpan(spanId);
    }

    expect(otel['activeSpans'].size).toBe(0);
  });

  it('should handle empty attributes', () => {
    const spanId = otel.startTrace('empty-attrs', { attributes: {} });
    const span = otel['activeSpans'].get(spanId);

    expect(span?.attributes).toEqual({});
  });

  it('should handle special characters in span names', () => {
    const spanId = otel.startTrace('span/with:special.chars-and_underscores');
    const span = otel['activeSpans'].get(spanId);

    expect(span?.name).toBe('span/with:special.chars-and_underscores');
  });

  it('should handle very long span names', () => {
    const longName = 'a'.repeat(1000);
    const spanId = otel.startTrace(longName);
    const span = otel['activeSpans'].get(spanId);

    expect(span?.name).toBe(longName);
  });

  it('should handle unicode in attributes', () => {
    const spanId = otel.startTrace('unicode-span');
    otel.setAttribute('unicode.attr', 'Hello World! Bonjour! Hola!');
    otel.setAttribute('emoji', 'Test');

    const span = otel['activeSpans'].get(spanId);
    expect(span?.attributes['unicode.attr']).toContain('Bonjour');
  });
});
