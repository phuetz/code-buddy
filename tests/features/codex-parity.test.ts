/**
 * Tests for Codex Parity Features
 *
 * Covers:
 * - Feature 1: Enterprise Admin Config (TOML loading, requirements enforcement)
 * - Feature 2: OpenTelemetry Monitoring (span creation, buffering, flush)
 * - Feature 3: JavaScript REPL Runtime (execution, persistence, sandboxing)
 * - Feature 4: Shell Environment Snapshots (capture, filtering, formatting)
 */

import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ============================================================================
// Feature 1: Enterprise Admin Config
// ============================================================================

describe('AdminConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty config when no files exist', async () => {
    const { loadAdminConfig } = await import('../../src/config/admin-config');
    const config = loadAdminConfig(path.join(tmpDir, 'nonexistent'));

    expect(config.requirements).toEqual({});
    expect(config.managedDefaults).toEqual({});
  });

  it('should load requirements from TOML file', async () => {
    const tomlContent = `
[requirements]
max_cost_limit = 50
allowed_models = ["grok-3", "grok-2"]
disabled_tools = ["bash", "docker"]
network_access = false
sandbox_mode = "strict"
`;
    fs.writeFileSync(path.join(tmpDir, 'requirements.toml'), tomlContent);

    const { loadAdminConfig } = await import('../../src/config/admin-config');
    const config = loadAdminConfig(tmpDir);

    expect(config.requirements.maxCostLimit).toBe(50);
    expect(config.requirements.allowedModels).toEqual(['grok-3', 'grok-2']);
    expect(config.requirements.disabledTools).toEqual(['bash', 'docker']);
    expect(config.requirements.networkAccess).toBe(false);
    expect(config.requirements.sandboxMode).toBe('strict');
  });

  it('should load managed defaults from TOML file', async () => {
    const tomlContent = `
[defaults]
model = "grok-3"
security_mode = "auto-edit"
max_tool_rounds = 25
`;
    fs.writeFileSync(path.join(tmpDir, 'managed_config.toml'), tomlContent);

    const { loadAdminConfig } = await import('../../src/config/admin-config');
    const config = loadAdminConfig(tmpDir);

    expect(config.managedDefaults.model).toBe('grok-3');
    expect(config.managedDefaults.securityMode).toBe('auto-edit');
    expect(config.managedDefaults.maxToolRounds).toBe(25);
  });

  it('should enforce requirements over user config', async () => {
    const { applyAdminRequirements } = await import('../../src/config/admin-config');
    const adminConfig = {
      requirements: {
        maxCostLimit: 20,
        allowedModels: ['grok-3'],
        disabledTools: ['docker'],
      },
      managedDefaults: {
        model: 'grok-2',
        securityMode: 'suggest',
      },
    };

    const userConfig = {
      maxCost: 100,
      model: 'gpt-4',
      securityMode: 'full-auto',
    };

    const result = applyAdminRequirements(userConfig, adminConfig);

    // Requirements override user values
    expect(result['maxCost']).toBe(20);
    expect(result['disabledTools']).toEqual(['docker']);
    // User model not in allowed list, forced to first allowed
    expect(result['model']).toBe('grok-3');
    // User already set securityMode, managed default does NOT override
    expect(result['securityMode']).toBe('full-auto');
  });

  it('should apply managed defaults only when user has no value', async () => {
    const { applyAdminRequirements } = await import('../../src/config/admin-config');
    const adminConfig = {
      requirements: {},
      managedDefaults: {
        model: 'grok-3',
        securityMode: 'auto-edit',
        maxToolRounds: 30,
      },
    };

    const userConfig: Record<string, unknown> = {};
    const result = applyAdminRequirements(userConfig, adminConfig);

    expect(result['model']).toBe('grok-3');
    expect(result['securityMode']).toBe('auto-edit');
    expect(result['maxToolRounds']).toBe(30);
  });

  it('should handle malformed TOML gracefully', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.toml'), 'this is not valid toml {{{');

    const { loadAdminConfig } = await import('../../src/config/admin-config');
    const config = loadAdminConfig(tmpDir);

    // Should not throw, returns empty
    expect(config.requirements).toEqual({});
  });
});

// ============================================================================
// Feature 2: OpenTelemetry Monitoring
// ============================================================================

describe('OtelTracer', () => {
  beforeEach(() => {
    // Clear singleton between tests
    jest.resetModules();
  });

  it('should create spans with correct structure', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');
    const tracer = new OtelTracer({ enabled: false });

    const span = tracer.startSpan('test.operation', {
      'test.key': 'value',
      'test.count': 42,
    });

    expect(span.traceId).toHaveLength(32); // 16 bytes hex
    expect(span.spanId).toHaveLength(16); // 8 bytes hex
    expect(span.name).toBe('test.operation');
    expect(span.kind).toBe(0); // INTERNAL
    expect(span.attributes).toEqual(
      expect.arrayContaining([
        { key: 'test.key', value: { stringValue: 'value' } },
        { key: 'test.count', value: { intValue: 42 } },
      ])
    );
    expect(span.status).toEqual({ code: 0 });
  });

  it('should end span with status and timestamp', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');
    const tracer = new OtelTracer({ enabled: false });

    const span = tracer.startSpan('test.op');
    expect(span.endTimeUnixNano).toBe('0');

    tracer.endSpan(span, { code: 1 });
    expect(span.endTimeUnixNano).not.toBe('0');
    expect(span.status.code).toBe(1);
  });

  it('should buffer spans when enabled', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');
    const tracer = new OtelTracer({ endpoint: 'http://localhost:4318/v1/traces', enabled: true });

    expect(tracer.pendingSpans).toBe(0);

    tracer.traceApiCall('grok-3', 1500, 250);
    expect(tracer.pendingSpans).toBe(1);

    tracer.traceToolExecution('bash', 120, true);
    expect(tracer.pendingSpans).toBe(2);

    tracer.traceConversation('sess-123', 5);
    expect(tracer.pendingSpans).toBe(3);

    await tracer.dispose();
  });

  it('should not buffer when disabled', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');
    const tracer = new OtelTracer({ enabled: false });

    tracer.traceApiCall('grok-3', 1500, 250);
    tracer.traceToolExecution('bash', 120, true);

    expect(tracer.pendingSpans).toBe(0);
    expect(tracer.isEnabled).toBe(false);
  });

  it('should flush spans via HTTP POST', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = mockFetch;

    const tracer = new OtelTracer({
      endpoint: 'http://localhost:4318/v1/traces',
      enabled: true,
      flushIntervalMs: 999999, // Prevent auto-flush
    });

    tracer.traceApiCall('grok-3', 100, 50);
    tracer.traceToolExecution('read_file', 10, true);

    expect(tracer.pendingSpans).toBe(2);
    await tracer.flush();
    expect(tracer.pendingSpans).toBe(0);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4318/v1/traces',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Verify payload structure
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.resourceSpans).toHaveLength(1);
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);

    await tracer.dispose();
  });

  it('should generate new trace IDs', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');
    const tracer = new OtelTracer({ enabled: false });

    const span1 = tracer.startSpan('op1');
    const traceId1 = span1.traceId;

    tracer.newTrace();
    const span2 = tracer.startSpan('op2');

    expect(span2.traceId).not.toBe(traceId1);
    expect(span2.traceId).toHaveLength(32);
  });

  it('should trace tool execution with success/failure status', async () => {
    const { OtelTracer } = await import('../../src/telemetry/otel-tracer');
    const tracer = new OtelTracer({ endpoint: 'http://localhost:4318/v1/traces', enabled: true });

    tracer.traceToolExecution('bash', 100, true);
    tracer.traceToolExecution('docker', 200, false);

    expect(tracer.pendingSpans).toBe(2);

    await tracer.dispose();
  });
});

// ============================================================================
// Feature 3: JavaScript REPL Runtime
// ============================================================================

describe('JSRepl', () => {
  it('should execute basic expressions', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('2 + 2');
    expect(result.result).toBe('4');
    expect(result.error).toBeUndefined();
  });

  it('should persist variables across calls', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    repl.execute('var x = 10');
    repl.execute('var y = 20');
    const result = repl.execute('x + y');

    expect(result.result).toBe('30');
  });

  it('should handle string results', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('"hello" + " " + "world"');
    expect(result.result).toBe('hello world');
  });

  it('should handle object results as JSON', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('({ name: "test", value: 42 })');
    expect(JSON.parse(result.result)).toEqual({ name: 'test', value: 42 });
  });

  it('should report syntax errors', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('function(');
    expect(result.error).toBeDefined();
    expect(result.result).toBe('');
  });

  it('should report runtime errors', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('undefinedVariable.property');
    expect(result.error).toBeDefined();
  });

  it('should timeout on infinite loops', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl(500); // 500ms timeout

    const result = repl.execute('while(true) {}');
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/timed out|timeout|Script execution/i);
  });

  it('should not have access to require', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('require("fs")');
    expect(result.error).toBeDefined();
  });

  it('should not have access to process', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    const result = repl.execute('process.exit(1)');
    expect(result.error).toBeDefined();
  });

  it('should reset context and clear variables', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    repl.execute('var myVar = 999');
    const before = repl.getVariables();
    expect(before['myVar']).toBe(999);

    repl.reset();
    const after = repl.getVariables();
    expect(after['myVar']).toBeUndefined();

    const result = repl.execute('myVar');
    expect(result.error).toBeDefined();
  });

  it('should list user-defined variables', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    repl.execute('var count = 5');
    repl.execute('var name = "test"');
    const vars = repl.getVariables();

    expect(vars['count']).toBe(5);
    expect(vars['name']).toBe('test');
    // Built-ins should not appear
    expect(vars['JSON']).toBeUndefined();
    expect(vars['Math']).toBeUndefined();
  });

  it('should have access to safe built-ins', async () => {
    const { JSRepl } = await import('../../src/tools/js-repl');
    const repl = new JSRepl();

    expect(repl.execute('JSON.stringify({a:1})').result).toBe('{"a":1}');
    expect(repl.execute('Math.max(1, 2, 3)').result).toBe('3');
    expect(repl.execute('Array.isArray([1, 2])').result).toBe('true');
  });
});

describe('JSReplTool', () => {
  it('should execute code via tool interface', async () => {
    const { JSReplTool } = await import('../../src/tools/js-repl');
    const tool = new JSReplTool();

    const result = await tool.execute({ code: '1 + 1' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('2');
  });

  it('should reset via tool interface', async () => {
    const { JSReplTool } = await import('../../src/tools/js-repl');
    const tool = new JSReplTool();

    await tool.execute({ code: 'var x = 10' });
    const resetResult = await tool.execute({ action: 'reset' });
    expect(resetResult.success).toBe(true);

    const result = await tool.execute({ code: 'x' });
    expect(result.success).toBe(false);
  });

  it('should list variables via tool interface', async () => {
    const { JSReplTool } = await import('../../src/tools/js-repl');
    const tool = new JSReplTool();

    await tool.execute({ code: 'var foo = 42' });
    const result = await tool.execute({ action: 'variables' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('foo');
    expect(result.output).toContain('42');
  });

  it('should return error when no code provided', async () => {
    const { JSReplTool } = await import('../../src/tools/js-repl');
    const tool = new JSReplTool();

    const result = await tool.execute({ action: 'execute' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No code');
  });

  it('should have correct schema and metadata', async () => {
    const { JSReplTool } = await import('../../src/tools/js-repl');
    const tool = new JSReplTool();

    const schema = tool.getSchema();
    expect(schema.name).toBe('js_repl');
    expect(schema.parameters.properties).toBeDefined();

    const meta = tool.getMetadata();
    expect(meta.category).toBe('utility');
    expect(meta.modifiesFiles).toBe(false);
    expect(meta.makesNetworkRequests).toBe(false);
  });
});

// ============================================================================
// Feature 4: Shell Environment Snapshots
// ============================================================================

describe('ShellSnapshot', () => {
  it('should capture shell snapshot with basic fields', async () => {
    const { captureShellSnapshot } = await import('../../src/utils/shell-snapshot');
    const snapshot = await captureShellSnapshot();

    expect(snapshot.shell).toBeDefined();
    expect(typeof snapshot.shell).toBe('string');
    expect(snapshot.env).toBeDefined();
    expect(typeof snapshot.env).toBe('object');
    expect(Array.isArray(snapshot.aliases)).toBe(true);
    expect(Array.isArray(snapshot.functions)).toBe(true);
    expect(Array.isArray(snapshot.rcFiles)).toBe(true);
  });

  it('should detect node version', async () => {
    const { captureShellSnapshot } = await import('../../src/utils/shell-snapshot');
    const snapshot = await captureShellSnapshot();

    // We are running in Node, so this should be present
    expect(snapshot.nodeVersion).toBeDefined();
    expect(snapshot.nodeVersion).toMatch(/^v?\d+\.\d+/);
  });

  it('should filter out secret env vars', async () => {
    // Set a secret env var temporarily
    const original = process.env['MY_SECRET_API_KEY'];
    process.env['MY_SECRET_API_KEY'] = 'should-not-appear';

    const { captureShellSnapshot } = await import('../../src/utils/shell-snapshot');
    const snapshot = await captureShellSnapshot();

    expect(snapshot.env['MY_SECRET_API_KEY']).toBeUndefined();

    // Cleanup
    if (original !== undefined) {
      process.env['MY_SECRET_API_KEY'] = original;
    } else {
      delete process.env['MY_SECRET_API_KEY'];
    }
  });

  it('should include safe env vars', async () => {
    const { captureShellSnapshot } = await import('../../src/utils/shell-snapshot');
    const snapshot = await captureShellSnapshot();

    // HOME and PATH should be included if they exist
    if (process.env['HOME']) {
      expect(snapshot.env['HOME']).toBe(process.env['HOME']);
    }
  });

  it('should detect rc files that exist', async () => {
    const { captureShellSnapshot } = await import('../../src/utils/shell-snapshot');
    const snapshot = await captureShellSnapshot();

    // All listed rc files should actually exist
    for (const rcFile of snapshot.rcFiles) {
      expect(fs.existsSync(rcFile)).toBe(true);
    }
  });

  it('should format snapshot for prompt', async () => {
    const { formatSnapshotForPrompt } = await import('../../src/utils/shell-snapshot');

    const mockSnapshot = {
      shell: 'bash',
      env: {
        HOME: '/home/test',
        EDITOR: 'vim',
        TERM_PROGRAM: 'iTerm2',
      },
      aliases: ['ll=ls -la', 'gs=git status'],
      functions: ['myFunc', 'deploy'],
      rcFiles: ['/home/test/.bashrc'],
      nodeVersion: 'v20.10.0',
      npmVersion: '10.2.3',
      gitVersion: '2.42.0',
      pythonVersion: '3.12.1',
    };

    const formatted = formatSnapshotForPrompt(mockSnapshot);

    expect(formatted).toContain('Shell: bash');
    expect(formatted).toContain('Node: v20.10.0');
    expect(formatted).toContain('npm: 10.2.3');
    expect(formatted).toContain('Git: 2.42.0');
    expect(formatted).toContain('Python: 3.12.1');
    expect(formatted).toContain('Editor: vim');
    expect(formatted).toContain('Terminal: iTerm2');
    expect(formatted).toContain('Shell aliases: 2 defined');
    expect(formatted).toContain('Shell functions: 2 defined');
  });

  it('should handle minimal snapshot in formatting', async () => {
    const { formatSnapshotForPrompt } = await import('../../src/utils/shell-snapshot');

    const minimalSnapshot = {
      shell: 'sh',
      env: {},
      aliases: [],
      functions: [],
      rcFiles: [],
    };

    const formatted = formatSnapshotForPrompt(minimalSnapshot);

    expect(formatted).toContain('Shell: sh');
    expect(formatted).not.toContain('aliases');
    expect(formatted).not.toContain('functions');
    expect(formatted).not.toContain('Node:');
  });
});
