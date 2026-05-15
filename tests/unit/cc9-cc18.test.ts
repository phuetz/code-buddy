/**
 * Tests for CC9-CC18 — Enterprise parity Round 2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// CC10 — Glob Utils + Instruction Excludes
// ============================================================================

describe('CC10: Glob Utils', () => {
  it('globToRegex handles ** patterns', async () => {
    const { globToRegex } = await import('../../src/utils/glob-utils.js');
    const re = globToRegex('src/**/*.ts');
    expect(re.test('src/utils/glob.ts')).toBe(true);
    expect(re.test('src/deep/nested/file.ts')).toBe(true);
    expect(re.test('src/file.js')).toBe(false);
  });

  it('globToRegex handles * patterns', async () => {
    const { globToRegex } = await import('../../src/utils/glob-utils.js');
    const re = globToRegex('*.ts');
    expect(re.test('file.ts')).toBe(true);
    expect(re.test('dir/file.ts')).toBe(false); // * doesn't match /
  });

  it('matchGlob normalizes backslashes', async () => {
    const { matchGlob } = await import('../../src/utils/glob-utils.js');
    expect(matchGlob('src\\utils\\file.ts', 'src/**/*.ts')).toBe(true);
  });

  it('expandBraces expands {ts,tsx}', async () => {
    const { expandBraces } = await import('../../src/utils/glob-utils.js');
    expect(expandBraces('src/**/*.{ts,tsx}')).toEqual([
      'src/**/*.ts',
      'src/**/*.tsx',
    ]);
  });

  it('matchGlobPatterns handles negation', async () => {
    const { matchGlobPatterns } = await import('../../src/utils/glob-utils.js');
    expect(matchGlobPatterns('src/utils/file.ts', ['src/**', '!src/tests/**'])).toBe(true);
    expect(matchGlobPatterns('src/tests/file.ts', ['src/**', '!src/tests/**'])).toBe(false);
  });

  it('resolvePathPattern handles ~/ prefix', async () => {
    const { resolvePathPattern } = await import('../../src/utils/glob-utils.js');
    const resolved = resolvePathPattern('~/docs/*.pdf', '/project', '/home/user');
    expect(resolved).toBe('/home/user/docs/*.pdf');
  });

  it('resolvePathPattern handles // prefix', async () => {
    const { resolvePathPattern } = await import('../../src/utils/glob-utils.js');
    const resolved = resolvePathPattern('//absolute/path', '/project');
    expect(resolved).toBe('/absolute/path');
  });
});

describe('CC10: Instruction Excludes', () => {
  const tmpDir = path.join(os.tmpdir(), 'cc10-test-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, '.codebuddy'), { recursive: true });
  });

  afterEach(async () => {
    const { clearExcludesCache } = await import('../../src/context/instruction-excludes.js');
    clearExcludesCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shouldExcludeInstructionFile returns false when no excludes configured', async () => {
    const { shouldExcludeInstructionFile } = await import('../../src/context/instruction-excludes.js');
    fs.writeFileSync(path.join(tmpDir, '.codebuddy', 'settings.json'), '{}');
    expect(shouldExcludeInstructionFile(path.join(tmpDir, 'CODEBUDDY.md'), tmpDir)).toBe(false);
  });

  it('shouldExcludeInstructionFile matches exclude patterns', async () => {
    const { shouldExcludeInstructionFile, clearExcludesCache } = await import('../../src/context/instruction-excludes.js');
    clearExcludesCache();
    fs.writeFileSync(
      path.join(tmpDir, '.codebuddy', 'settings.json'),
      JSON.stringify({ codebuddyMdExcludes: ['packages/legacy/**'] })
    );

    expect(shouldExcludeInstructionFile(
      path.join(tmpDir, 'packages', 'legacy', 'CODEBUDDY.md'),
      tmpDir
    )).toBe(true);

    expect(shouldExcludeInstructionFile(
      path.join(tmpDir, 'packages', 'core', 'CODEBUDDY.md'),
      tmpDir
    )).toBe(false);
  });
});

// ============================================================================
// CC9 — Import Directive Parser
// ============================================================================

describe('CC9: Import Directive Parser', () => {
  const tmpDir = path.join(os.tmpdir(), 'cc9-test-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves relative @import directives', async () => {
    const { resolveImportDirectives } = await import('../../src/context/import-directive-parser.js');
    fs.writeFileSync(path.join(tmpDir, 'included.md'), 'Included content here');
    const result = resolveImportDirectives('@included.md', { baseDir: tmpDir });
    expect(result).toBe('Included content here');
  });

  it('handles missing files gracefully', async () => {
    const { resolveImportDirectives } = await import('../../src/context/import-directive-parser.js');
    const result = resolveImportDirectives('@nonexistent.md', { baseDir: tmpDir });
    expect(result).toContain('<!-- import not found');
  });

  it('detects circular imports', async () => {
    const { resolveImportDirectives } = await import('../../src/context/import-directive-parser.js');
    fs.writeFileSync(path.join(tmpDir, 'a.md'), '@b.md');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), '@a.md');
    const result = resolveImportDirectives('@a.md', { baseDir: tmpDir });
    expect(result).toContain('<!-- circular import');
  });

  it('respects max depth', async () => {
    const { resolveImportDirectives } = await import('../../src/context/import-directive-parser.js');
    // Create deeply nested imports
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(path.join(tmpDir, `level${i}.md`), `Level ${i}\n@level${i + 1}.md`);
    }
    fs.writeFileSync(path.join(tmpDir, 'level7.md'), 'Bottom');

    const result = resolveImportDirectives('@level0.md', { baseDir: tmpDir });
    expect(result).toContain('Level 0');
    expect(result).toContain('Level 4'); // Depth 5 should work
    // At depth 5 the recursion stops, so level5.md's import won't be resolved
  });

  it('resolves ~/ paths with custom home dir', async () => {
    const { resolveImportDirectives } = await import('../../src/context/import-directive-parser.js');
    const homeDir = path.join(tmpDir, 'home');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, 'shared.md'), 'Home content');

    const result = resolveImportDirectives('@~/shared.md', {
      baseDir: tmpDir,
      homeDir,
    });
    expect(result).toBe('Home content');
  });

  it('does not resolve non-directive @ patterns', async () => {
    const { resolveImportDirectives } = await import('../../src/context/import-directive-parser.js');
    // Inline @ mentions should not be resolved
    const content = 'Contact @user for details';
    const result = resolveImportDirectives(content, { baseDir: tmpDir });
    // The regex requires the @ to be at the start of a line
    expect(result).toBe(content);
  });
});

// ============================================================================
// CC17 — Auto-Compaction Percentage Threshold
// ============================================================================

describe('CC17: Auto-Compaction Percentage', () => {
  it('shouldAutoCompact uses percentage when env var set', async () => {
    const { ContextManagerV2 } = await import('../../src/context/context-manager-v2.js');
    const mgr = new ContextManagerV2({
      maxContextTokens: 100000,
      autoCompactThreshold: 200000, // Absolute threshold higher than max
    });

    // Without env var, absolute threshold applies (200K > 100K, so never triggers)
    const msgs = [
      { role: 'user' as const, content: 'x'.repeat(10000) },
    ];
    expect(mgr.shouldAutoCompact(msgs)).toBe(false);

    // With percentage env var at 1% (very low), should trigger
    process.env.CODEBUDDY_AUTOCOMPACT_PCT = '1';
    expect(mgr.shouldAutoCompact(msgs)).toBe(true);

    delete process.env.CODEBUDDY_AUTOCOMPACT_PCT;
  });

  it('shouldAutoCompact uses config percentage', async () => {
    const { ContextManagerV2 } = await import('../../src/context/context-manager-v2.js');
    const mgr = new ContextManagerV2({
      maxContextTokens: 100000,
      autoCompactThreshold: 200000,
      autoCompactPercent: 1, // 1% of 100K = 1K tokens
    });

    const msgs = [
      { role: 'user' as const, content: 'x'.repeat(10000) },
    ];
    // 10K chars ≈ >1K tokens, should trigger at 1%
    expect(mgr.shouldAutoCompact(msgs)).toBe(true);
  });
});

// ============================================================================
// CC18 — Permission Mode Wiring
// ============================================================================

describe('CC18: Permission Mode Wiring', () => {
  it('PermissionModeManager.checkPermission returns correct decisions', async () => {
    const { PermissionModeManager } = await import('../../src/security/permission-modes.js');

    const mgr = new PermissionModeManager({ mode: 'dontAsk' });
    const result = mgr.checkPermission('edit file', 'str_replace_editor');
    expect(result.allowed).toBe(true);
    expect(result.prompted).toBe(false);

    // Destructive tools still prompt
    const bashResult = mgr.checkPermission('rm -rf', 'bash');
    expect(bashResult.prompted).toBe(true);
  });

  it('acceptEdits mode auto-approves edits', async () => {
    const { PermissionModeManager } = await import('../../src/security/permission-modes.js');

    const mgr = new PermissionModeManager({ mode: 'acceptEdits' });
    const editResult = mgr.checkPermission('edit', 'str_replace_editor');
    expect(editResult.allowed).toBe(true);
    expect(editResult.prompted).toBe(false);

    // Destructive still prompts
    const bashResult = mgr.checkPermission('bash', 'bash');
    expect(bashResult.prompted).toBe(true);
  });

  it('plan mode blocks non-read-only tools', async () => {
    const { PermissionModeManager } = await import('../../src/security/permission-modes.js');

    const mgr = new PermissionModeManager({ mode: 'plan' });
    const readResult = mgr.checkPermission('read', 'read_file');
    expect(readResult.allowed).toBe(true);

    const editResult = mgr.checkPermission('edit', 'str_replace_editor');
    expect(editResult.allowed).toBe(false);
  });
});

// ============================================================================
// CC11 — Skill Enhancements Wiring
// ============================================================================

describe('CC11: Skill Variable Resolver', () => {
  it('resolves $ARGUMENTS[N] in templates', async () => {
    const { SkillVariableResolver } = await import('../../src/skills/skill-enhancements.js');
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Hello $ARGUMENTS[0], welcome to $ARGUMENTS[1]!', {
      arguments: ['world', 'earth'],
    });
    expect(result).toBe('Hello world, welcome to earth!');
  });

  it('resolves $ARGUMENTS (all args joined)', async () => {
    const { SkillVariableResolver } = await import('../../src/skills/skill-enhancements.js');
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Run: $ARGUMENTS', {
      arguments: ['npm', 'test'],
    });
    expect(result).toBe('Run: npm test');
  });

  it('resolves $WORKING_DIR', async () => {
    const { SkillVariableResolver } = await import('../../src/skills/skill-enhancements.js');
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Dir: $WORKING_DIR', {
      workingDir: '/home/user/project',
    });
    expect(result).toBe('Dir: /home/user/project');
  });
});

describe('CC11: Bash Injection', () => {
  it('resolves !`echo hello` patterns', async () => {
    const { resolveBashInjections } = await import('../../src/skills/bash-injection.js');
    const result = resolveBashInjections('Version: !`echo 1.0.0`');
    expect(result).toBe('Version: 1.0.0');
  });

  it('handles failed commands gracefully', async () => {
    const { resolveBashInjections } = await import('../../src/skills/bash-injection.js');
    const result = resolveBashInjections('Result: !`nonexistent_command_12345`');
    expect(result).toContain('<!-- bash error');
  });

  it('hasBashInjections detects patterns', async () => {
    const { hasBashInjections } = await import('../../src/skills/bash-injection.js');
    expect(hasBashInjections('Hello !`echo world`')).toBe(true);
    expect(hasBashInjections('Hello world')).toBe(false);
  });
});

describe('CC11: Skill Parser context/disable-model-invocation', () => {
  it('parses contextFork from frontmatter', async () => {
    const { parseSkillFile } = await import('../../src/skills/parser.js');
    const content = `---
name: test-skill
description: Test skill
context: fork
---

Do something`;

    const skill = parseSkillFile(content, 'test.md', 'workspace');
    expect(skill.metadata.contextFork).toBe(true);
  });

  it('parses disableModelInvocation from frontmatter', async () => {
    const { parseSkillFile } = await import('../../src/skills/parser.js');
    const content = `---
name: test-skill
description: Test skill
disable-model-invocation: true
---

Do something`;

    const skill = parseSkillFile(content, 'test.md', 'workspace');
    expect(skill.metadata.disableModelInvocation).toBe(true);
  });
});

// ============================================================================
// CC15 — Enhanced Permission Rules
// ============================================================================

describe('CC15: Enhanced Permission Rules', () => {
  it('matchGlobPatterns with negation patterns', async () => {
    const { matchGlobPatterns } = await import('../../src/utils/glob-utils.js');

    // Allow src/** but exclude src/tests/**
    expect(matchGlobPatterns('src/main.ts', ['src/**', '!src/tests/**'])).toBe(true);
    expect(matchGlobPatterns('src/tests/foo.test.ts', ['src/**', '!src/tests/**'])).toBe(false);
  });

  it('matchGlob with brace expansion', async () => {
    const { matchGlob } = await import('../../src/utils/glob-utils.js');
    expect(matchGlob('file.ts', '*.{ts,tsx}')).toBe(true);
    expect(matchGlob('file.tsx', '*.{ts,tsx}')).toBe(true);
    expect(matchGlob('file.js', '*.{ts,tsx}')).toBe(false);
  });
});

// ============================================================================
// CC12 — Extended Hook Events
// ============================================================================

describe('CC12: Extended Hook Events', () => {
  it('ExtendedHookEvent type includes new events', async () => {
    const hookTypes = await import('../../src/hooks/hook-types.js');
    // Verify the type exists by checking we can create contexts with new events
    const ctx: import('../../src/hooks/hook-types.js').ExtendedHookContext = {
      event: 'ModelRequest',
      model: 'grok-3',
      timestamp: new Date(),
    };
    expect(ctx.event).toBe('ModelRequest');
    expect(ctx.model).toBe('grok-3');

    const ctx2: import('../../src/hooks/hook-types.js').ExtendedHookContext = {
      event: 'UserPromptSubmit',
      userPrompt: 'hello',
      timestamp: new Date(),
    };
    expect(ctx2.event).toBe('UserPromptSubmit');
    expect(ctx2.userPrompt).toBe('hello');

    const ctx3: import('../../src/hooks/hook-types.js').ExtendedHookContext = {
      event: 'InstructionsLoaded',
      instructionFiles: ['CODEBUDDY.md'],
      timestamp: new Date(),
    };
    expect(ctx3.event).toBe('InstructionsLoaded');
  });
});

// ============================================================================
// CC14 — Subagent Persistent Memory
// ============================================================================

describe('CC14: Agent Memory Integration', () => {
  const tmpDir = path.join(os.tmpdir(), 'cc14-test-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readAgentMemory returns empty for nonexistent', async () => {
    const { readAgentMemory } = await import('../../src/agent/multi-agent/agent-memory-integration.js');
    const result = readAgentMemory({
      agentName: 'test-agent',
      scope: 'project',
      projectRoot: tmpDir,
    });
    expect(result).toBe('');
  });

  it('writeAgentMemory creates file and readAgentMemory retrieves it', async () => {
    const { writeAgentMemory, readAgentMemory } = await import('../../src/agent/multi-agent/agent-memory-integration.js');

    writeAgentMemory(
      { agentName: 'test-agent', scope: 'project', projectRoot: tmpDir },
      '# Agent Memory\nSome context'
    );

    const result = readAgentMemory({
      agentName: 'test-agent',
      scope: 'project',
      projectRoot: tmpDir,
    });
    expect(result).toContain('Agent Memory');
    expect(result).toContain('Some context');
  });

  it('appendAgentMemory adds timestamped entry', async () => {
    const { appendAgentMemory, readAgentMemory } = await import('../../src/agent/multi-agent/agent-memory-integration.js');

    appendAgentMemory(
      { agentName: 'test-agent', scope: 'project', projectRoot: tmpDir },
      'Found important pattern'
    );

    const result = readAgentMemory({
      agentName: 'test-agent',
      scope: 'project',
      projectRoot: tmpDir,
    });
    expect(result).toContain('Found important pattern');
    expect(result).toMatch(/## \d{4}-\d{2}-\d{2}/);
  });

  it('buildAgentMemoryContext wraps in XML tags', async () => {
    const { writeAgentMemory, buildAgentMemoryContext } = await import('../../src/agent/multi-agent/agent-memory-integration.js');

    writeAgentMemory(
      { agentName: 'alice', scope: 'project', projectRoot: tmpDir },
      'Memory content'
    );

    const ctx = buildAgentMemoryContext({
      agentName: 'alice',
      scope: 'project',
      projectRoot: tmpDir,
    });
    expect(ctx).toContain('<agent_memory');
    expect(ctx).toContain('scope="project"');
    expect(ctx).toContain('agent="alice"');
    expect(ctx).toContain('Memory content');
  });

  it('listAgentMemories returns agent names', async () => {
    const { writeAgentMemory, listAgentMemories } = await import('../../src/agent/multi-agent/agent-memory-integration.js');

    writeAgentMemory({ agentName: 'Alice', scope: 'project', projectRoot: tmpDir }, 'mem1');
    writeAgentMemory({ agentName: 'Bob', scope: 'project', projectRoot: tmpDir }, 'mem2');

    const agents = listAgentMemories('project', tmpDir);
    // Names are sanitized to lowercase
    expect(agents).toContain('alice');
    expect(agents).toContain('bob');
  });
});

describe('CC14: SpawnOptions memory field', () => {
  it('SpawnOptions supports memory field', async () => {
    const { spawnAgent, completeAgent, closeAgent, resetAgentState } = await import('../../src/agent/multi-agent/agent-tools.js');

    // Reset state
    resetAgentState();

    const result = spawnAgent({
      prompt: 'test',
      memory: 'project',
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.memoryScope).toBe('project');
      completeAgent(result.id, 'done');
      closeAgent(result.id);
    }
  });
});

// ============================================================================
// CC13 — /batch Command
// ============================================================================

describe('CC13: Batch Handlers', () => {
  it('decomposeBatchGoal returns single unit without chatFn', async () => {
    const { decomposeBatchGoal } = await import('../../src/commands/handlers/batch-handlers.js');
    const plan = await decomposeBatchGoal('add logging');
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0].label).toBe('main');
    expect(plan.units[0].instruction).toBe('add logging');
  });

  it('formatBatchPlan formats correctly', async () => {
    const { formatBatchPlan } = await import('../../src/commands/handlers/batch-handlers.js');
    const output = formatBatchPlan({
      goal: 'test goal',
      units: [
        { label: 'unit-1', instruction: 'Do thing 1' },
        { label: 'unit-2', instruction: 'Do thing 2', dependsOn: ['unit-1'] },
      ],
    });
    expect(output).toContain('test goal');
    expect(output).toContain('unit-1');
    expect(output).toContain('unit-2');
    expect(output).toContain('Depends on: unit-1');
  });

  it('executeBatchPlan respects dependencies', async () => {
    const { executeBatchPlan } = await import('../../src/commands/handlers/batch-handlers.js');
    const order: string[] = [];

    const results = await executeBatchPlan(
      {
        goal: 'test',
        units: [
          { label: 'a', instruction: 'do a' },
          { label: 'b', instruction: 'do b', dependsOn: ['a'] },
        ],
      },
      async (label, _instr) => {
        order.push(label);
        return { label, success: true, summary: 'ok', durationMs: 10 };
      }
    );

    expect(results).toHaveLength(2);
    expect(order[0]).toBe('a'); // 'a' must execute before 'b'
    expect(order[1]).toBe('b');
  });

  it('executeBatchPlan does not run units whose dependency failed', async () => {
    const { executeBatchPlan } = await import('../../src/commands/handlers/batch-handlers.js');
    const order: string[] = [];

    const results = await executeBatchPlan(
      {
        goal: 'test',
        units: [
          { label: 'a', instruction: 'do a' },
          { label: 'b', instruction: 'do b', dependsOn: ['a'] },
        ],
      },
      async (label, _instr) => {
        order.push(label);
        if (label === 'a') {
          return { label, success: false, summary: 'failed', durationMs: 10 };
        }
        return { label, success: true, summary: 'should not run', durationMs: 10 };
      }
    );

    expect(order).toEqual(['a']);
    expect(results).toHaveLength(2);
    expect(results[1].label).toBe('b');
    expect(results[1].success).toBe(false);
    expect(results[1].summary).toContain('Skipped: failed dependency a');
  });

  it('formatBatchResults shows summary', async () => {
    const { formatBatchResults } = await import('../../src/commands/handlers/batch-handlers.js');
    const output = formatBatchResults([
      { label: 'unit-1', success: true, summary: 'Done', durationMs: 100 },
      { label: 'unit-2', success: false, summary: 'Failed', durationMs: 200 },
    ]);
    expect(output).toContain('1/2');
    expect(output).toContain('[OK]');
    expect(output).toContain('[FAIL]');
  });

  it('handleBatchCommand returns usage when no args', async () => {
    const { handleBatchCommand } = await import('../../src/commands/handlers/batch-handlers.js');
    const result = await handleBatchCommand('');
    expect(result).toContain('Usage');
  });
});

// ============================================================================
// CC16 — Tmux Manager
// ============================================================================

describe('CC16: Tmux Manager', () => {
  it('InProcessTeamSession manages agents', async () => {
    const { InProcessTeamSession } = await import('../../src/agent/teams/tmux-manager.js');
    const session = new InProcessTeamSession('test-team', ['alice', 'bob']);

    expect(session.name).toBe('test-team');
    expect(session.agents.size).toBe(2);

    session.recordOutput('alice', 'Line 1');
    session.recordOutput('alice', 'Line 2');
    session.setStatus('alice', 'working');

    expect(session.getOutput('alice')).toContain('Line 1');
    expect(session.getOutput('alice')).toContain('Line 2');

    const status = session.formatStatus();
    expect(status).toContain('alice: working');
    expect(status).toContain('bob: idle');
  });

  it('resetTmuxCache resets detection', async () => {
    const { resetTmuxCache, isTmuxAvailable } = await import('../../src/agent/teams/tmux-manager.js');
    resetTmuxCache();
    // Just verify it doesn't throw
    const available = isTmuxAvailable();
    expect(typeof available).toBe('boolean');
  });
});

// ============================================================================
// CC16: Team V2
// ============================================================================

describe('CC16: Team V2 Types', () => {
  it('TeamTaskList manages tasks with dependencies', async () => {
    const { TeamTaskList } = await import('../../src/agent/teams/team-v2.js');
    const taskList = new TeamTaskList();

    const task1 = taskList.addTask('Task 1', 'Do first thing');
    const task2 = taskList.addTask('Task 2', 'Do second thing', [task1.id]);

    // Task 2 should not be claimable (dependency not met)
    expect(taskList.claimTask(task2.id, 'agent-1')).toBe(false);

    // Complete task 1
    taskList.claimTask(task1.id, 'agent-1');
    taskList.completeTask(task1.id);

    // Now task 2 should be claimable
    expect(taskList.claimTask(task2.id, 'agent-2')).toBe(true);
  });

  it('TeamMailbox handles messages', async () => {
    const { TeamMailbox } = await import('../../src/agent/teams/team-v2.js');
    const mailbox = new TeamMailbox();

    mailbox.send('lead', 'agent-1', 'Hello');
    mailbox.broadcast('lead', 'All hands');

    const msgs = mailbox.getMessages('agent-1');
    expect(msgs).toHaveLength(2);

    const unread = mailbox.getUnread('agent-1');
    expect(unread).toHaveLength(2);

    mailbox.markAllRead('agent-1');
    expect(mailbox.getUnread('agent-1')).toHaveLength(0);
  });
});
