import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildHermesHookLifecycleManifest,
  executeHermesLifecycleHook,
  HERMES_HOOK_LIFECYCLE_SCHEMA_VERSION,
} from '../../src/hooks/hermes-lifecycle-hooks.js';
import { resetUserHooksManager } from '../../src/hooks/user-hooks.js';
import {
  getToolHooksManager,
  resetToolHooksManager,
} from '../../src/tools/hooks/tool-hooks.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-hooks-test-'));
}

function writeHooksJson(dir: string, content: object): void {
  const cbDir = path.join(dir, '.codebuddy');
  fs.mkdirSync(cbDir, { recursive: true });
  fs.writeFileSync(path.join(cbDir, 'hooks.json'), JSON.stringify(content));
}

describe('Hermes lifecycle hook contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    resetUserHooksManager();
    resetToolHooksManager();
  });

  afterEach(() => {
    resetUserHooksManager();
    resetToolHooksManager();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('maps Hermes stages to user hook events and tool hook stages', () => {
    writeHooksJson(tmpDir, {
      hooks: {
        BeforeMemoryWrite: [{ type: 'command', command: 'exit 0' }],
        BeforeScheduledDelivery: [{ type: 'http', url: 'https://example.com/hook' }],
      },
    });
    getToolHooksManager().registerBeforeHook('audit-before', () => undefined, {
      name: 'Audit before',
    });

    const manifest = buildHermesHookLifecycleManifest(tmpDir);

    expect(manifest.kind).toBe('hermes_hook_lifecycle_manifest');
    expect(manifest.schemaVersion).toBe(HERMES_HOOK_LIFECYCLE_SCHEMA_VERSION);
    expect(manifest.stages.map((stage) => stage.stage)).toEqual([
      'before_tool_call',
      'after_tool_call',
      'before_memory_write',
      'after_run_complete',
      'before_scheduled_delivery',
    ]);

    const beforeTool = manifest.stages.find((stage) => stage.stage === 'before_tool_call');
    expect(beforeTool?.userHookEvent).toBe('PreToolUse');
    expect(beforeTool?.registeredToolHooks).toBe(1);

    const beforeMemory = manifest.stages.find((stage) => stage.stage === 'before_memory_write');
    expect(beforeMemory?.userHookEvent).toBe('BeforeMemoryWrite');
    expect(beforeMemory?.configuredHandlers).toBe(1);
    expect(beforeMemory?.blocksOperation).toBe(true);
    expect(beforeMemory?.active).toBe(true);

    const scheduledDelivery = manifest.stages.find((stage) => (
      stage.stage === 'before_scheduled_delivery'
    ));
    expect(scheduledDelivery?.userHookEvent).toBe('BeforeScheduledDelivery');
    expect(scheduledDelivery?.configuredHandlers).toBe(1);
  });

  it('executes canonical lifecycle stages through configured user hooks', async () => {
    const scriptFile = path.join(tmpDir, 'block-memory-write.js');
    fs.writeFileSync(
      scriptFile,
      "process.stderr.write('memory needs review'); process.exit(2);",
    );
    const scriptSafe = scriptFile.replaceAll('\\', '/');
    writeHooksJson(tmpDir, {
      hooks: {
        BeforeMemoryWrite: [{ type: 'command', command: `node ${scriptSafe}` }],
      },
    });

    const result = await executeHermesLifecycleHook(tmpDir, 'before_memory_write', {
      toolName: 'remember',
      toolInput: { key: 'k', value: 'v' },
    });

    expect(result.allowed).toBe(false);
    expect(result.feedback).toContain('memory needs review');
  });
});
