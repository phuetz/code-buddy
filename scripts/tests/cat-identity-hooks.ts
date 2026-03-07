/**
 * Cat 28: Identity Manager (6 tests, no API)
 * Cat 29: Hooks Manager (6 tests, no API)
 */

import type { TestDef } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IdentityManager } from '../../src/identity/identity-manager.js';

// ============================================================================
// Cat 28: Identity Manager
// ============================================================================

export function cat28IdentityManager(): TestDef[] {
  return [
    {
      name: '28.1-load-from-project-dir',
      timeout: 5000,
      fn: async () => {
        const tmp = path.join(os.tmpdir(), `cb-test-identity-${Date.now()}`);
        const projDir = path.join(tmp, '.codebuddy');
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(path.join(projDir, 'SOUL.md'), 'You are a helpful assistant.');

        const mgr = new IdentityManager({ projectDir: '.codebuddy', globalDir: path.join(tmp, 'global'), watchForChanges: false });
        const files = await mgr.load(tmp);
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: files.length === 1 && files[0].name === 'SOUL.md' && files[0].source === 'project',
          metadata: { count: files.length, firstName: files[0]?.name },
        };
      },
    },
    {
      name: '28.2-global-fallback',
      timeout: 5000,
      fn: async () => {
        const tmp = path.join(os.tmpdir(), `cb-test-identity-${Date.now()}`);
        const globalDir = path.join(tmp, 'global');
        fs.mkdirSync(globalDir, { recursive: true });
        fs.mkdirSync(path.join(tmp, 'project'), { recursive: true });
        fs.writeFileSync(path.join(globalDir, 'USER.md'), 'Global user prefs');

        const mgr = new IdentityManager({ projectDir: '.codebuddy', globalDir, watchForChanges: false });
        const files = await mgr.load(path.join(tmp, 'project'));
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: files.length === 1 && files[0].name === 'USER.md' && files[0].source === 'global',
          metadata: { source: files[0]?.source },
        };
      },
    },
    {
      name: '28.3-project-overrides-global',
      timeout: 5000,
      fn: async () => {
        const tmp = path.join(os.tmpdir(), `cb-test-identity-${Date.now()}`);
        const globalDir = path.join(tmp, 'global');
        const projDir = path.join(tmp, 'project', '.codebuddy');
        fs.mkdirSync(globalDir, { recursive: true });
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(path.join(globalDir, 'SOUL.md'), 'Global soul');
        fs.writeFileSync(path.join(projDir, 'SOUL.md'), 'Project soul');

        const mgr = new IdentityManager({ projectDir: '.codebuddy', globalDir, watchForChanges: false });
        const files = await mgr.load(path.join(tmp, 'project'));
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: files.length === 1 && files[0].content === 'Project soul' && files[0].source === 'project',
          metadata: { content: files[0]?.content },
        };
      },
    },
    {
      name: '28.4-get-by-name',
      timeout: 5000,
      fn: async () => {
        const tmp = path.join(os.tmpdir(), `cb-test-identity-${Date.now()}`);
        const projDir = path.join(tmp, '.codebuddy');
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(path.join(projDir, 'AGENTS.md'), 'Agent config');

        const mgr = new IdentityManager({ projectDir: '.codebuddy', globalDir: path.join(tmp, 'global'), watchForChanges: false });
        await mgr.load(tmp);
        const file = mgr.get('AGENTS.md');
        const missing = mgr.get('NONEXISTENT.md');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: file !== undefined && file.content === 'Agent config' && missing === undefined,
        };
      },
    },
    {
      name: '28.5-prompt-injection-format',
      timeout: 5000,
      fn: async () => {
        const tmp = path.join(os.tmpdir(), `cb-test-identity-${Date.now()}`);
        const projDir = path.join(tmp, '.codebuddy');
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(path.join(projDir, 'SOUL.md'), 'Be helpful.');
        fs.writeFileSync(path.join(projDir, 'USER.md'), 'User prefs here.');

        const mgr = new IdentityManager({ projectDir: '.codebuddy', globalDir: path.join(tmp, 'global'), watchForChanges: false });
        await mgr.load(tmp);
        const injection = mgr.getPromptInjection();
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: injection.includes('SOUL.md') && injection.includes('USER.md') && injection.includes('Be helpful.'),
          metadata: { preview: injection.substring(0, 200) },
        };
      },
    },
    {
      name: '28.6-set-creates-file',
      timeout: 5000,
      fn: async () => {
        const tmp = path.join(os.tmpdir(), `cb-test-identity-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });

        const mgr = new IdentityManager({ projectDir: '.codebuddy', globalDir: path.join(tmp, 'global'), watchForChanges: false });
        await mgr.load(tmp);
        await mgr.set('CUSTOM.md', 'Custom content');
        const file = mgr.get('CUSTOM.md');
        const onDisk = fs.existsSync(path.join(tmp, '.codebuddy', 'CUSTOM.md'));
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: file !== undefined && file.content === 'Custom content' && file.source === 'project' && onDisk,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 29: Hooks Manager
// ============================================================================

export function cat29LifecycleHooks(): TestDef[] {
  return [
    {
      name: '29.1-register-and-get-hooks',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(os.tmpdir());
        mgr.registerHook({
          name: 'test-hook',
          type: 'pre-tool',
          command: 'echo ok',
          enabled: true,
        });
        const hooks = mgr.getHooks();
        const preToolHooks = hooks.get('pre-tool') ?? [];
        return {
          pass: preToolHooks.length >= 1 && preToolHooks[0].name === 'test-hook',
          metadata: { hookCount: preToolHooks.length },
        };
      },
    },
    {
      name: '29.2-execute-handler-hook',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(os.tmpdir());
        let called = false;
        mgr.registerHook({
          name: 'spy-hook',
          type: 'pre-tool',
          handler: async () => {
            called = true;
            return { exitCode: 0, stdout: 'ok', stderr: '' };
          },
          enabled: true,
        });
        await mgr.executeHooks('pre-tool', { toolName: 'test', toolInput: {} });
        return { pass: called };
      },
    },
    {
      name: '29.3-unregister-hook',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(os.tmpdir());
        mgr.registerHook({ name: 'to-remove', type: 'pre-tool', command: 'echo hi', enabled: true });
        const before = (mgr.getHooksByType('pre-tool')).length;
        const removed = mgr.unregisterHook('to-remove');
        const after = (mgr.getHooksByType('pre-tool')).length;
        return {
          pass: removed && after === before - 1,
          metadata: { before, after },
        };
      },
    },
    {
      name: '29.4-disabled-hook-not-executed',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(os.tmpdir());
        let called = false;
        mgr.registerHook({
          name: 'disabled-hook',
          type: 'pre-tool',
          handler: async () => {
            called = true;
            return { exitCode: 0, stdout: '', stderr: '' };
          },
          enabled: false,
        });
        await mgr.executeHooks('pre-tool', { toolName: 'test', toolInput: {} });
        return { pass: !called };
      },
    },
    {
      name: '29.5-get-hooks-by-type',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(os.tmpdir());
        mgr.registerHook({ name: 'a', type: 'pre-tool', command: 'echo a', enabled: true });
        mgr.registerHook({ name: 'b', type: 'post-tool', command: 'echo b', enabled: true });
        mgr.registerHook({ name: 'c', type: 'pre-tool', command: 'echo c', enabled: true });
        const preTool = mgr.getHooksByType('pre-tool');
        const postTool = mgr.getHooksByType('post-tool');
        return {
          pass: preTool.length === 2 && postTool.length === 1,
          metadata: { preTool: preTool.length, postTool: postTool.length },
        };
      },
    },
    {
      name: '29.6-format-status',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(os.tmpdir());
        mgr.registerHook({ name: 'status-test', type: 'pre-tool', command: 'echo x', enabled: true });
        const status = mgr.formatStatus();
        return {
          pass: typeof status === 'string' && status.includes('Hooks'),
          metadata: { preview: status.substring(0, 100) },
        };
      },
    },
  ];
}
