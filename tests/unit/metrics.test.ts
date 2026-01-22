/**
 * Tests for the Metrics Collector module
 */

import {
  MetricsCollector,
  Counter,
  Gauge,
  Histogram,
  initMetrics,
  getMetrics,
} from '../../src/metrics/metrics-collector';

describe('Counter', () => {
  let counter: Counter;

  beforeEach(() => {
    counter = new Counter('test_counter', 'Test counter description');
  });

  it('should initialize with zero values', () => {
    expect(counter.getValues()).toEqual([]);
  });

  it('should increment by 1 by default', () => {
    counter.inc();
    const values = counter.getValues();
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe(1);
  });

  it('should increment by specified value', () => {
    counter.inc({}, 5);
    const values = counter.getValues();
    expect(values[0].value).toBe(5);
  });

  it('should support labels', () => {
    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'POST', status: '201' });
    counter.inc({ method: 'GET', status: '200' }, 2);

    const values = counter.getValues();
    expect(values).toHaveLength(2);

    const getValue = values.find(
      (v) => v.labels.method === 'GET' && v.labels.status === '200'
    );
    expect(getValue?.value).toBe(3);
  });

  it('should reset all values', () => {
    counter.inc({ label: 'a' });
    counter.inc({ label: 'b' });
    counter.reset();
    expect(counter.getValues()).toEqual([]);
  });
});

describe('Gauge', () => {
  let gauge: Gauge;

  beforeEach(() => {
    gauge = new Gauge('test_gauge', 'Test gauge description');
  });

  it('should set value', () => {
    gauge.set(42);
    const values = gauge.getValues();
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe(42);
  });

  it('should increment', () => {
    gauge.set(10);
    gauge.inc({}, 5);
    const values = gauge.getValues();
    expect(values[0].value).toBe(15);
  });

  it('should decrement', () => {
    gauge.set(10);
    gauge.dec({}, 3);
    const values = gauge.getValues();
    expect(values[0].value).toBe(7);
  });

  it('should track timestamps', () => {
    gauge.set(1);
    const values = gauge.getValues();
    expect(values[0].timestamp).toBeDefined();
    expect(values[0].timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('should support labels', () => {
    gauge.set(100, { type: 'heap' });
    gauge.set(200, { type: 'rss' });
    const values = gauge.getValues();
    expect(values).toHaveLength(2);
  });
});

describe('Histogram', () => {
  let histogram: Histogram;

  beforeEach(() => {
    histogram = new Histogram(
      'test_histogram',
      'Test histogram description',
      [0.1, 0.5, 1, 5, 10]
    );
  });

  it('should observe values', () => {
    histogram.observe(0.25);
    histogram.observe(0.75);
    histogram.observe(3);

    const values = histogram.getValues();
    expect(values).toHaveLength(1);
    expect(values[0].count).toBe(3);
    expect(values[0].sum).toBe(4);
  });

  it('should track min and max', () => {
    histogram.observe(0.1);
    histogram.observe(5);
    histogram.observe(2);

    const values = histogram.getValues();
    expect(values[0].min).toBe(0.1);
    expect(values[0].max).toBe(5);
  });

  it('should populate buckets correctly', () => {
    histogram.observe(0.05); // <= 0.1
    histogram.observe(0.3); // <= 0.5
    histogram.observe(0.8); // <= 1
    histogram.observe(3); // <= 5

    const values = histogram.getValues();
    const buckets = values[0].buckets;

    expect(buckets.get(0.1)).toBe(1);
    expect(buckets.get(0.5)).toBe(2);
    expect(buckets.get(1)).toBe(3);
    expect(buckets.get(5)).toBe(4);
    expect(buckets.get(10)).toBe(4);
  });

  it('should support timer', async () => {
    const end = histogram.startTimer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const elapsed = end();

    expect(elapsed).toBeGreaterThan(0.04);
    expect(elapsed).toBeLessThan(0.2);

    const values = histogram.getValues();
    expect(values[0].count).toBe(1);
  });

  it('should support labels', () => {
    histogram.observe(1, { endpoint: '/api/chat' });
    histogram.observe(2, { endpoint: '/api/tools' });

    const values = histogram.getValues();
    expect(values).toHaveLength(2);
  });
});

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector({
      consoleExport: false,
      fileExport: false,
    });
  });

  afterEach(async () => {
    await collector.shutdown();
  });

  it('should create pre-defined metrics', () => {
    expect(collector.requestsTotal).toBeInstanceOf(Counter);
    expect(collector.requestErrors).toBeInstanceOf(Counter);
    expect(collector.tokensUsed).toBeInstanceOf(Counter);
    expect(collector.apiLatency).toBeInstanceOf(Histogram);
    expect(collector.memoryUsage).toBeInstanceOf(Gauge);
    expect(collector.activeConnections).toBeInstanceOf(Gauge);
  });

  it('should create custom counter', () => {
    const counter = collector.createCounter('custom_counter', 'Custom counter');
    expect(counter).toBeInstanceOf(Counter);
    expect(collector.getCounter('custom_counter')).toBe(counter);
  });

  it('should create custom gauge', () => {
    const gauge = collector.createGauge('custom_gauge', 'Custom gauge');
    expect(gauge).toBeInstanceOf(Gauge);
    expect(collector.getGauge('custom_gauge')).toBe(gauge);
  });

  it('should create custom histogram', () => {
    const histogram = collector.createHistogram('custom_histogram', 'Custom histogram');
    expect(histogram).toBeInstanceOf(Histogram);
    expect(collector.getHistogram('custom_histogram')).toBe(histogram);
  });

  it('should get snapshot', () => {
    collector.requestsTotal.inc({ endpoint: '/test' });
    collector.memoryUsage.set(1024);

    const snapshot = collector.getSnapshot();
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.counters).toBeDefined();
    expect(snapshot.gauges).toBeDefined();
    expect(snapshot.histograms).toBeDefined();
    expect(snapshot.system).toBeDefined();
  });

  it('should export to Prometheus format', () => {
    collector.requestsTotal.inc({ endpoint: '/test' });

    const prometheus = collector.toPrometheus();
    expect(prometheus).toContain('# HELP codebuddy_requests_total');
    expect(prometheus).toContain('# TYPE codebuddy_requests_total counter');
    expect(prometheus).toContain('codebuddy_requests_total');
  });

  it('should export to JSON format', () => {
    collector.requestsTotal.inc();

    const json = collector.toJSON();
    expect(json.timestamp).toBeDefined();
    expect(json.counters.codebuddy_requests_total).toBeDefined();
  });

  it('should collect system metrics', () => {
    const system = collector.getSystemMetrics();
    expect(system.memory.heapUsed).toBeGreaterThan(0);
    expect(system.memory.heapTotal).toBeGreaterThan(0);
    expect(system.uptime).toBeGreaterThanOrEqual(0);
    expect(system.cpu.user).toBeDefined();
    expect(system.cpu.system).toBeDefined();
  });

  it('should reset all metrics', () => {
    collector.requestsTotal.inc();
    collector.memoryUsage.set(1024);
    collector.apiLatency.observe(0.5);

    collector.reset();

    const snapshot = collector.getSnapshot();
    expect(Object.keys(snapshot.counters.codebuddy_requests_total || [])).toHaveLength(0);
  });
});

describe('Singleton instance', () => {
  it('should initialize and return singleton', () => {
    const metrics1 = initMetrics({ consoleExport: false, fileExport: false });
    const metrics2 = getMetrics();
    expect(metrics2).toBe(metrics1);
  });
});
