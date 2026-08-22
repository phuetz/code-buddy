/**
 * Tests for Stream JSON, System Prompt Overrides, and Permission Patterns
 *
 * Covers:
 * - Feature 1: StreamJsonFormatter (NDJSON event formatting)
 * - Feature 2: SystemPromptOverride (replace/append system prompts)
 * - Feature 3: PermissionPatternMatcher (glob-based tool permissions)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
// Feature 1: StreamJsonFormatter
// ============================================================================

import {
  StreamJsonFormatter,
  type StreamEvent,
} from '../../src/utils/stream-json-formatter';

describe('StreamJsonFormatter', () => {
  let formatter: StreamJsonFormatter;

  beforeEach(() => {
    formatter = new StreamJsonFormatter();
  });

  it('should format start event', () => {
    const event: StreamEvent = {
      type: 'start',
      session_id: 'sess-123',
      model: 'grok-3-fast',
    };
    const line = formatter.formatEvent(event);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('start');
    expect(parsed.session_id).toBe('sess-123');
    expect(parsed.model).toBe('grok-3-fast');
  });

  it('should format text event', () => {
    const event: StreamEvent = {
      type: 'text',
      content: 'Hello, world!',
    };
    const line = formatter.formatEvent(event);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('text');
    expect(parsed.content).toBe('Hello, world!');
  });

  it('should format tool_use event', () => {
    const event: StreamEvent = {
      type: 'tool_use',
      tool: 'Bash',
      input: { command: 'ls -la' },
    };
    const line = formatter.formatEvent(event);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('tool_use');
    expect(parsed.tool).toBe('Bash');
    expect(parsed.input).toEqual({ command: 'ls -la' });
  });

  it('should format tool_result event', () => {
    const event: StreamEvent = {
      type: 'tool_result',
      tool: 'Read',
      output: 'file contents here',
      success: true,
    };
    const line = formatter.formatEvent(event);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('tool_result');
    expect(parsed.tool).toBe('Read');
    expect(parsed.output).toBe('file contents here');
    expect(parsed.success).toBe(true);
  });

  it('should format thinking event', () => {
    const event: StreamEvent = {
      type: 'thinking',
      content: 'Let me analyze this...',
    };
    const line = formatter.formatEvent(event);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('thinking');
    expect(parsed.content).toBe('Let me analyze this...');
  });

  it('should format done event', () => {
    const event: StreamEvent = {
      type: 'done',
      cost: 0.05,
      tokens: { input: 1000, output: 500 },
    };
    const line = formatter.formatEvent(event);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('done');
    expect(parsed.cost).toBe(0.05);
    expect(parsed.tokens.input).toBe(1000);
    expect(parsed.tokens.output).toBe(500);
  });

  it('should produce valid JSON for each line', () => {
    const events: StreamEvent[] = [
      { type: 'start', session_id: 's1', model: 'grok-3' },
      { type: 'text', content: 'hello' },
      { type: 'tool_use', tool: 'Bash', input: { cmd: 'echo hi' } },
      { type: 'tool_result', tool: 'Bash', output: 'hi', success: true },
      { type: 'thinking', content: 'hmm' },
      { type: 'done', cost: 0.01, tokens: { input: 100, output: 50 } },
    ];

    for (const event of events) {
      const line = formatter.formatEvent(event);
      // Should not throw
      const parsed = JSON.parse(line.trim());
      expect(parsed.type).toBe(event.type);
    }
  });

  it('should produce NDJSON format (newline separated)', () => {
    const events: StreamEvent[] = [
      { type: 'start', session_id: 's1', model: 'm1' },
      { type: 'text', content: 'hi' },
      { type: 'done', cost: 0, tokens: { input: 0, output: 0 } },
    ];

    const output = formatter.formatEvents(events);
    const lines = output.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(3);

    // Each line should be independently parseable JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ============================================================================
// Feature 2: SystemPromptOverride
// ============================================================================

import { SystemPromptOverride } from '../../src/services/system-prompt-override';

describe('SystemPromptOverride', () => {
  let override: SystemPromptOverride;
  let tmpDir: string;

  beforeEach(() => {
    override = new SystemPromptOverride();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-override-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('should replace with --system-prompt', () => {
    const result = override.apply('original prompt', {
      systemPrompt: 'custom prompt',
    });
    expect(result).toBe('custom prompt');
  });

  it('should replace with --system-prompt-file', () => {
    const filePath = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(filePath, 'prompt from file');

    const result = override.apply('original prompt', {
      systemPromptFile: filePath,
    });
    expect(result).toBe('prompt from file');
  });

  it('should append with --append-system-prompt', () => {
    const result = override.apply('base prompt', {
      appendSystemPrompt: 'extra instructions',
    });
    expect(result).toBe('base prompt\n\nextra instructions');
  });

  it('should append with --append-system-prompt-file', () => {
    const filePath = path.join(tmpDir, 'append.txt');
    fs.writeFileSync(filePath, 'appended from file');

    const result = override.apply('base prompt', {
      appendSystemPromptFile: filePath,
    });
    expect(result).toBe('base prompt\n\nappended from file');
  });

  it('should error when both replace and append are used', () => {
    expect(() => {
      override.apply('base', {
        systemPrompt: 'replace',
        appendSystemPrompt: 'append',
      });
    }).toThrow('Cannot use both replace');
  });

  it('should error when file not found', () => {
    expect(() => {
      override.apply('base', {
        systemPromptFile: '/nonexistent/path/prompt.txt',
      });
    }).toThrow('System prompt file not found');
  });

  it('should return base prompt unchanged when no overrides', () => {
    const result = override.apply('original prompt', {});
    expect(result).toBe('original prompt');
  });
});

// ============================================================================
// Feature 3: PermissionPatternMatcher
// ============================================================================

import {
  PermissionPatternMatcher,
  getPermissionMatcher,
  resetPermissionMatcher,
} from '../../src/security/permission-patterns';

describe('PermissionPatternMatcher', () => {
  let matcher: PermissionPatternMatcher;

  beforeEach(() => {
    matcher = new PermissionPatternMatcher();
  });

  it('should parse tool specifier: Bash(npm run *)', () => {
    const parsed = matcher.parseToolSpecifier('Bash(npm run *)');
    expect(parsed.tool).toBe('Bash');
    expect(parsed.pattern).toBe('npm run *');
  });

  it('should parse tool specifier without pattern: Bash', () => {
    const parsed = matcher.parseToolSpecifier('Bash');
    expect(parsed.tool).toBe('Bash');
    expect(parsed.pattern).toBeUndefined();
  });

  it('should match allow rule', () => {
    matcher.addRule({ tool: 'Bash', pattern: 'npm run *', action: 'allow' });
    expect(matcher.checkPermission('Bash', 'npm run test')).toBe('allow');
  });

  it('should match deny rule', () => {
    matcher.addRule({ tool: 'Read', pattern: './.env', action: 'deny' });
    expect(matcher.checkPermission('Read', './.env')).toBe('deny');
  });

  it('should return ask as default when no rule matches', () => {
    matcher.addRule({ tool: 'Bash', pattern: 'npm *', action: 'allow' });
    expect(matcher.checkPermission('Bash', 'rm -rf /')).toBe('ask');
  });

  it('should support * glob (matches anything except /)', () => {
    matcher.addRule({ tool: 'Edit', pattern: './src/*.ts', action: 'allow' });
    expect(matcher.checkPermission('Edit', './src/index.ts')).toBe('allow');
    expect(matcher.checkPermission('Edit', './src/deep/nested.ts')).toBe('ask');
  });

  it('should support ** glob (matches anything including /)', () => {
    matcher.addRule({ tool: 'Edit', pattern: './src/**', action: 'allow' });
    expect(matcher.checkPermission('Edit', './src/index.ts')).toBe('allow');
    expect(matcher.checkPermission('Edit', './src/deep/nested/file.ts')).toBe('allow');
  });

  it('should use first match wins', () => {
    matcher.addRule({ tool: 'Bash', pattern: 'rm **', action: 'deny' });
    matcher.addRule({ tool: 'Bash', action: 'allow' });

    expect(matcher.checkPermission('Bash', 'rm -rf /')).toBe('deny');
    expect(matcher.checkPermission('Bash', 'ls -la')).toBe('allow');
  });

  it('should support domain pattern for WebFetch', () => {
    matcher.addRule({ tool: 'WebFetch', pattern: 'domain:example.com', action: 'allow' });
    matcher.addRule({ tool: 'WebFetch', pattern: 'domain:evil.com', action: 'deny' });

    expect(matcher.checkPermission('WebFetch', 'https://example.com/api')).toBe('allow');
    expect(matcher.checkPermission('WebFetch', 'https://evil.com/hack')).toBe('deny');
    expect(matcher.checkPermission('WebFetch', 'https://other.com')).toBe('ask');
  });

  it('should load rules from strings', () => {
    matcher.loadRules([
      'allow:Bash(npm run *)',
      'deny:Read(./.env)',
      'ask:Edit(./src/**)',
    ]);

    const rules = matcher.getRules();
    expect(rules).toHaveLength(3);
    expect(rules[0]).toEqual({ tool: 'Bash', pattern: 'npm run *', action: 'allow' });
    expect(rules[1]).toEqual({ tool: 'Read', pattern: './.env', action: 'deny' });
    expect(rules[2]).toEqual({ tool: 'Edit', pattern: './src/**', action: 'ask' });
  });

  it('should clear and remove rules', () => {
    matcher.addRule({ tool: 'Bash', action: 'allow' });
    matcher.addRule({ tool: 'Read', action: 'deny' });
    matcher.addRule({ tool: 'Edit', action: 'ask' });

    expect(matcher.getRules()).toHaveLength(3);

    matcher.removeRule(1);
    expect(matcher.getRules()).toHaveLength(2);
    expect(matcher.getRules()[1].tool).toBe('Edit');

    matcher.clearRules();
    expect(matcher.getRules()).toHaveLength(0);
  });

  describe('singleton', () => {
    afterEach(() => {
      resetPermissionMatcher();
    });

    it('should return same instance from getPermissionMatcher', () => {
      const a = getPermissionMatcher();
      const b = getPermissionMatcher();
      expect(a).toBe(b);
    });

    it('should return new instance after reset', () => {
      const a = getPermissionMatcher();
      resetPermissionMatcher();
      const b = getPermissionMatcher();
      expect(a).not.toBe(b);
    });
  });
});
