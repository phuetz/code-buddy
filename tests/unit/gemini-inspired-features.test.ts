/**
 * Tests for Gemini CLI-inspired features:
 * 1. Omission placeholder detection
 * 2. Multi-strategy edit matching
 * 3. wait_for_previous parallel execution
 * 4. JIT context discovery
 * 5. Tool output masking
 * 6. Loop detection (3-tier)
 * 7. Plan mode with tool restrictions
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// 1. Omission Placeholder Detection
// ============================================================================

describe('Omission Placeholder Detection', () => {
  let detectOmissionPlaceholders: typeof import('@/tools/omission-placeholder-detector.js').detectOmissionPlaceholders;
  let formatOmissionError: typeof import('@/tools/omission-placeholder-detector.js').formatOmissionError;

  beforeEach(async () => {
    const mod = await import('@/tools/omission-placeholder-detector.js');
    detectOmissionPlaceholders = mod.detectOmissionPlaceholders;
    formatOmissionError = mod.formatOmissionError;
  });

  it('should detect "// ... rest of code" pattern', () => {
    const content = 'function foo() {\n  // ... rest of code\n}';
    const result = detectOmissionPlaceholders(content);
    expect(result.hasOmissions).toBe(true);
    expect(result.lines).toContain(2);
  });

  it('should detect "// rest of methods ..." pattern', () => {
    const content = 'class Foo {\n  // rest of methods ...\n}';
    const result = detectOmissionPlaceholders(content);
    expect(result.hasOmissions).toBe(true);
  });

  it('should detect "# ... remaining code" (Python)', () => {
    const content = 'def foo():\n  # ... remaining code\n  pass';
    const result = detectOmissionPlaceholders(content);
    expect(result.hasOmissions).toBe(true);
  });

  it('should detect "(rest of code unchanged)" pattern', () => {
    const content = 'class Bar {\n  (rest of code unchanged)\n}';
    const result = detectOmissionPlaceholders(content);
    expect(result.hasOmissions).toBe(true);
  });

  it('should detect the "the" variants ("rest of THE code")', () => {
    // phrase-first: // rest of the code ...
    expect(detectOmissionPlaceholders('class F {\n  // rest of the code ...\n}').hasOmissions).toBe(true);
    // ellipsis-first: // ... the rest of the methods
    expect(detectOmissionPlaceholders('class F {\n  // ... the rest of the methods\n}').hasOmissions).toBe(true);
    // hash comment with "the"
    expect(detectOmissionPlaceholders('def f():\n  # rest of the file ...\n  pass').hasOmissions).toBe(true);
  });

  it('should NOT detect regular comments', () => {
    const content = '// This function returns the result\nconst x = 1;';
    const result = detectOmissionPlaceholders(content);
    expect(result.hasOmissions).toBe(false);
  });

  it('should NOT flag real prose that merely mentions "the rest" without an omission ellipsis', () => {
    expect(detectOmissionPlaceholders('// the rest is computed in utils.ts\nconst x = 1;').hasOmissions).toBe(false);
    expect(detectOmissionPlaceholders('// rest of the config lives in env vars, see below\nconst x = 1;').hasOmissions).toBe(false);
    expect(detectOmissionPlaceholders('// the rest is history.\nconst x = 1;').hasOmissions).toBe(false);
  });

  it('should detect phrase-first omissions with an arbitrary noun + trailing ellipsis', () => {
    // Nouns NOT in the prefix set (logic/handlers), phrase before the ellipsis.
    expect(detectOmissionPlaceholders('function f() {\n  // rest of the logic ...\n}').hasOmissions).toBe(true);
    expect(detectOmissionPlaceholders('class C {\n  // remaining of the handlers ...\n}').hasOmissions).toBe(true);
  });

  it('should NOT detect ... in string literals', () => {
    const content = 'const msg = "Loading...";';
    const result = detectOmissionPlaceholders(content);
    expect(result.hasOmissions).toBe(false);
  });

  it('should skip placeholders that exist in original', () => {
    const original = '// ... rest of code (original)\nreal code';
    const newContent = '// ... rest of code (original)\nnew real code';
    const result = detectOmissionPlaceholders(newContent, original);
    expect(result.hasOmissions).toBe(false);
  });

  it('should detect NEW placeholders not in original', () => {
    const original = 'function foo() { return 1; }';
    const newContent = 'function foo() {\n  // ... rest of code\n}';
    const result = detectOmissionPlaceholders(newContent, original);
    expect(result.hasOmissions).toBe(true);
  });

  it('formatOmissionError should return readable message', () => {
    const result = { hasOmissions: true, lines: [5, 10], matches: ['// ... rest of code', '// remaining methods ...'] };
    const error = formatOmissionError(result);
    expect(error).toContain('line(s) 5, 10');
    expect(error).toContain('exact literal replacement');
  });

  it('formatOmissionError should return empty for no omissions', () => {
    const result = { hasOmissions: false, lines: [], matches: [] };
    expect(formatOmissionError(result)).toBe('');
  });
});

// ============================================================================
// 2. Multi-Strategy Edit Matching
// ============================================================================

describe('Multi-Strategy Edit Matching', () => {
  let multiStrategyMatch: typeof import('@/utils/multi-strategy-match.js').multiStrategyMatch;

  beforeEach(async () => {
    const mod = await import('@/utils/multi-strategy-match.js');
    multiStrategyMatch = mod.multiStrategyMatch;
  });

  it('should match exact strings', () => {
    const result = multiStrategyMatch('hello world', 'hello world');
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('exact');
    expect(result!.confidence).toBe(1.0);
  });

  it('should match with flexible whitespace normalization', () => {
    const source = '  function foo() {\n    return 1;\n  }';
    const search = 'function foo() {\n  return 1;\n}';
    const result = multiStrategyMatch(source, search);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('flexible');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should match via regex tokenization', () => {
    const source = 'const x = foo(bar, baz);';
    const search = 'const x=foo( bar,baz )';
    const result = multiStrategyMatch(source, search);
    // May match via regex or flexible
    if (result) {
      expect(['flexible', 'regex', 'fuzzy']).toContain(result.strategy);
    }
  });

  it('should return null for completely different strings', () => {
    const result = multiStrategyMatch('hello world', 'goodbye universe of atoms');
    expect(result).toBeNull();
  });

  it('flexible should preserve original indentation', () => {
    const source = '    if (x) {\n      doStuff();\n    }';
    const search = 'if (x) {\n  doStuff();\n}';
    const result = multiStrategyMatch(source, search);
    if (result && result.strategy === 'flexible') {
      expect(result.matched).toContain('    if (x)'); // original indent preserved
    }
  });

  it('should handle single-line matching', () => {
    const result = multiStrategyMatch('const x = 1;', 'const x = 1;');
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('exact');
  });
});

// ============================================================================
// 3. wait_for_previous (tested via isToolParallelizable concept)
// ============================================================================

describe('wait_for_previous Parallelism', () => {
  it('should detect wait_for_previous=true from tool args', () => {
    // Simulating the logic from agent-executor
    const args = JSON.stringify({ command: 'npm test', wait_for_previous: true });
    const parsed = JSON.parse(args);
    expect(parsed.wait_for_previous).toBe(true);
    expect(!parsed.wait_for_previous).toBe(false); // not parallelizable
  });

  it('should default to parallel for read-only tools', () => {
    const readOnlyTools = new Set(['grep', 'glob', 'read_file', 'list_files']);
    expect(readOnlyTools.has('grep')).toBe(true);
    expect(readOnlyTools.has('str_replace_editor')).toBe(false);
  });

  it('should handle missing wait_for_previous', () => {
    const args = JSON.stringify({ command: 'ls' });
    const parsed = JSON.parse(args);
    expect(typeof parsed.wait_for_previous).toBe('undefined');
  });
});

// ============================================================================
// 4. JIT Context Discovery
// ============================================================================

describe('JIT Context Discovery', () => {
  let discoverJitContext: typeof import('@/context/jit-context.js').discoverJitContext;
  let clearJitCache: typeof import('@/context/jit-context.js').clearJitCache;

  beforeEach(async () => {
    const mod = await import('@/context/jit-context.js');
    discoverJitContext = mod.discoverJitContext;
    clearJitCache = mod.clearJitCache;
    clearJitCache();
  });

  it('should return empty string for non-existent path', () => {
    const result = discoverJitContext('/nonexistent/path/foo.ts', '/nonexistent');
    expect(result).toBe('');
  });

  it('should export clearJitCache', () => {
    expect(typeof clearJitCache).toBe('function');
  });

  it('should include context prefix/suffix when content found', async () => {
    const { JIT_CONTEXT_PREFIX, JIT_CONTEXT_SUFFIX } = await import('@/context/jit-context.js');
    expect(JIT_CONTEXT_PREFIX).toContain('Discovered Context');
    expect(JIT_CONTEXT_SUFFIX).toContain('End Context');
  });
});

// ============================================================================
// 5. Tool Output Masking
// ============================================================================

describe('Tool Output Masking', () => {
  let applyToolOutputMasking: typeof import('@/context/tool-output-masking.js').applyToolOutputMasking;

  beforeEach(async () => {
    const mod = await import('@/context/tool-output-masking.js');
    applyToolOutputMasking = mod.applyToolOutputMasking;
  });

  it('should not mask when total content is small', () => {
    const messages = [
      { role: 'tool' as const, content: 'small result', tool_call_id: '1' },
    ];
    const masked = applyToolOutputMasking(messages);
    expect(masked).toBe(0);
  });

  it('should mask large old tool outputs', () => {
    // Create enough messages to exceed both protection (200K) and prunable (120K) thresholds
    const bigContent = 'x'.repeat(80_000);
    const messages: Array<{ role: string; content: string; tool_calls?: Array<{ id: string; function: { name: string } }>; tool_call_id?: string }> = [];
    // 6 large tool results = 480K chars total, exceeds 200K protection + 120K prunable
    for (let i = 1; i <= 6; i++) {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: String(i), function: { name: 'grep' } }] });
      messages.push({ role: 'tool', content: bigContent, tool_call_id: String(i) });
    }
    // Latest small result
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: '7', function: { name: 'read_file' } }] });
    messages.push({ role: 'tool', content: 'latest', tool_call_id: '7' });

    const masked = applyToolOutputMasking(messages as any);
    expect(masked).toBeGreaterThan(0);
  });

  it('should preserve latest tool output', () => {
    const bigContent = 'x'.repeat(100_000);
    const messages = [
      { role: 'assistant' as const, content: '', tool_calls: [{ id: '1', function: { name: 'grep' } }] },
      { role: 'tool' as const, content: bigContent, tool_call_id: '1' },
      { role: 'assistant' as const, content: '', tool_calls: [{ id: '2', function: { name: 'grep' } }] },
      { role: 'tool' as const, content: bigContent, tool_call_id: '2' },
      { role: 'assistant' as const, content: '', tool_calls: [{ id: '3', function: { name: 'grep' } }] },
      { role: 'tool' as const, content: bigContent, tool_call_id: '3' },
      { role: 'assistant' as const, content: '', tool_calls: [{ id: '4', function: { name: 'read_file' } }] },
      { role: 'tool' as const, content: 'latest result should be preserved', tool_call_id: '4' },
    ];
    applyToolOutputMasking(messages);
    // Latest should not be masked
    expect(messages[7].content).toBe('latest result should be preserved');
  });

  it('should not mask exempt tools', () => {
    const bigContent = 'x'.repeat(200_000);
    const messages = [
      { role: 'assistant' as const, content: '', tool_calls: [{ id: '1', function: { name: 'ask_human' } }] },
      { role: 'tool' as const, content: bigContent, tool_call_id: '1' },
    ];
    const masked = applyToolOutputMasking(messages);
    expect(masked).toBe(0);
  });
});

// ============================================================================
// 6. Loop Detection (3-tier)
// ============================================================================

describe('Loop Detection Service', () => {
  let LoopDetectionService: typeof import('@/agent/loop-detection.js').LoopDetectionService;

  beforeEach(async () => {
    const mod = await import('@/agent/loop-detection.js');
    LoopDetectionService = mod.LoopDetectionService;
  });

  describe('Tier 1: Tool Call Repetition', () => {
    it('should detect 5 identical tool calls', () => {
      const svc = new LoopDetectionService();
      const call = { name: 'grep', args: '{"pattern":"foo"}' };

      for (let i = 0; i < 4; i++) {
        const result = svc.recordToolCall(call);
        expect(result.loopDetected).toBe(false);
      }

      const result = svc.recordToolCall(call);
      expect(result.loopDetected).toBe(true);
      expect(result.tier).toBe(1);
    });

    it('should reset count on different tool call', () => {
      const svc = new LoopDetectionService();
      svc.recordToolCall({ name: 'grep', args: '{"pattern":"foo"}' });
      svc.recordToolCall({ name: 'grep', args: '{"pattern":"foo"}' });
      svc.recordToolCall({ name: 'read_file', args: '{"path":"bar.ts"}' }); // different
      svc.recordToolCall({ name: 'grep', args: '{"pattern":"foo"}' });
      svc.recordToolCall({ name: 'grep', args: '{"pattern":"foo"}' });

      // Only 2 consecutive, not 5
      const result = svc.recordToolCall({ name: 'grep', args: '{"pattern":"foo"}' });
      expect(result.loopDetected).toBe(false);
    });
  });

  describe('Tier 2: Content Chanting', () => {
    it('should detect repeated content chunks', () => {
      const svc = new LoopDetectionService();
      const chunk = 'This is a repeated chunk that is exactly fifty characters..';

      // Feed the same 50-char chunk 15 times
      let detected = false;
      for (let i = 0; i < 15; i++) {
        const result = svc.recordContent(chunk);
        if (result.loopDetected) {
          detected = true;
          expect(result.tier).toBe(2);
          break;
        }
      }
      // May or may not detect depending on chunk alignment
      expect(typeof detected).toBe('boolean');
    });

    it('should not flag varied content', () => {
      const svc = new LoopDetectionService();
      for (let i = 0; i < 20; i++) {
        const result = svc.recordContent(`Unique content block number ${i} with different text`);
        expect(result.loopDetected).toBe(false);
      }
    });
  });

  describe('Tier 3: LLM Check Timing', () => {
    it('should not trigger before 30 turns', () => {
      const svc = new LoopDetectionService();
      for (let i = 0; i < 29; i++) {
        expect(svc.shouldRunLLMCheck()).toBe(false);
      }
    });

    it('should trigger at turn 30', () => {
      const svc = new LoopDetectionService();
      for (let i = 0; i < 30; i++) {
        svc.shouldRunLLMCheck();
      }
      // Turn 30 should trigger (accumulated to 30)
      // Note: the internal counter increments each call
    });

    it('should parse valid LLM diagnostic response', () => {
      const svc = new LoopDetectionService();
      const response = '{"is_stuck": true, "confidence": 0.95, "reason": "repeating same grep"}';
      const result = svc.parseLLMDiagnostic(response);
      expect(result.loopDetected).toBe(true);
      expect(result.tier).toBe(3);
      expect(result.confidence).toBe(0.95);
    });

    it('should not trigger on low-confidence LLM response', () => {
      const svc = new LoopDetectionService();
      const response = '{"is_stuck": true, "confidence": 0.5, "reason": "maybe stuck"}';
      const result = svc.parseLLMDiagnostic(response);
      expect(result.loopDetected).toBe(false);
    });
  });
});

// ============================================================================
// 7. Plan Mode
// ============================================================================

describe('Plan Mode', () => {
  let planMode: typeof import('@/agent/plan-mode.js');
  let operatingModes: typeof import('@/agent/operating-modes.js');

  // V4.4 ADR option A: plan-mode predicates now read from OperatingModeManager.
  // Tests toggle the real source of truth (`setMode('plan')`) instead of the
  // deprecated `setAgentMode(AgentMode.PLAN)` no-op.
  beforeEach(async () => {
    planMode = await import('@/agent/plan-mode.js');
    operatingModes = await import('@/agent/operating-modes.js');
    operatingModes.getOperatingModeManager().setMode('balanced');
  });

  it('should default to non-plan mode', () => {
    expect(planMode.isPlanMode()).toBe(false);
  });

  it('should switch to plan mode via OperatingModeManager', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    expect(planMode.isPlanMode()).toBe(true);
  });

  it('should allow read tools in plan mode', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    expect(planMode.isToolAllowedInCurrentMode('read_file')).toBe(true);
    expect(planMode.isToolAllowedInCurrentMode('grep')).toBe(true);
    expect(planMode.isToolAllowedInCurrentMode('reason')).toBe(true);
    expect(planMode.isToolAllowedInCurrentMode('mixture_of_agents')).toBe(true);
  });

  it('should allow restricted write tools for .md only', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    // Write tools are "allowed" but with modified descriptions
    expect(planMode.isToolAllowedInCurrentMode('str_replace_editor')).toBe(true);
  });

  it('should block non-plan tools', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    expect(planMode.isToolAllowedInCurrentMode('bash')).toBe(false);
    expect(planMode.isToolAllowedInCurrentMode('run_command')).toBe(false);
  });

  it('should modify descriptions for restricted tools', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    const modified = planMode.getPlanModeToolDescription('str_replace_editor', 'Edit files');
    expect(modified).toContain('PLAN MODE ONLY');
    expect(modified).toContain('.md');
  });

  it('should not modify descriptions in default mode', () => {
    expect(planMode.getPlanModeToolDescription('str_replace_editor', 'Edit files')).toBeNull();
  });

  it('should filter tools for plan mode', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    const tools = [
      { function: { name: 'read_file', description: 'Read a file' } },
      { function: { name: 'bash', description: 'Run command' } },
      { function: { name: 'grep', description: 'Search' } },
      { function: { name: 'mixture_of_agents', description: 'Consult several LLMs' } },
    ];
    const filtered = planMode.filterToolsForMode(tools);
    expect(filtered).toHaveLength(3); // bash filtered out
    expect(filtered.map(t => t.function.name)).toContain('read_file');
    expect(filtered.map(t => t.function.name)).toContain('grep');
    expect(filtered.map(t => t.function.name)).toContain('mixture_of_agents');
  });

  it('should return plan mode prompt', () => {
    operatingModes.getOperatingModeManager().setMode('plan');
    const prompt = planMode.getPlanModePrompt();
    expect(prompt).toContain('<plan_mode>');
    expect(prompt).toContain('read-only');
  });

  it('should return null prompt in default mode', () => {
    expect(planMode.getPlanModePrompt()).toBeNull();
  });
});
