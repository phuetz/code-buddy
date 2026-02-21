/**
 * Tests for WritePolicy
 */

import { WritePolicy, WRITE_TOOL_NAMES } from '../../src/security/write-policy.js';

describe('WritePolicy', () => {
  let policy: WritePolicy;

  beforeEach(() => {
    WritePolicy.resetInstance();
    policy = WritePolicy.getInstance();
  });

  afterEach(() => {
    WritePolicy.resetInstance();
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const i1 = WritePolicy.getInstance();
      const i2 = WritePolicy.getInstance();
      expect(i1).toBe(i2);
    });

    it('should support test injection via setInstance', () => {
      const custom = new WritePolicy();
      WritePolicy.setInstance(custom);
      expect(WritePolicy.getInstance()).toBe(custom);
    });
  });

  describe('default mode', () => {
    it('should default to confirm mode', () => {
      expect(policy.getMode()).toBe('confirm');
    });
  });

  describe('mode: off', () => {
    beforeEach(() => policy.setMode('off'));

    it('should allow all write tools', async () => {
      const result = await policy.gate({ toolName: 'str_replace_editor', paths: ['/tmp/test.ts'] });
      expect(result.allowed).toBe(true);
      expect(result.requiresPatch).toBe(false);
    });

    it('should allow apply_patch', async () => {
      const result = await policy.gate({ toolName: 'apply_patch', paths: [] });
      expect(result.allowed).toBe(true);
    });
  });

  describe('mode: confirm', () => {
    beforeEach(() => policy.setMode('confirm'));

    it('should allow direct writes', async () => {
      const result = await policy.gate({ toolName: 'str_replace_editor', paths: ['/tmp/test.ts'] });
      expect(result.allowed).toBe(true);
      expect(result.requiresPatch).toBe(false);
    });

    it('should always allow apply_patch', async () => {
      const result = await policy.gate({ toolName: 'apply_patch', paths: [] });
      expect(result.allowed).toBe(true);
    });
  });

  describe('mode: strict', () => {
    beforeEach(() => policy.setMode('strict'));

    it('should block str_replace_editor without patch', async () => {
      const result = await policy.gate({ toolName: 'str_replace_editor', paths: ['/tmp/test.ts'] });
      expect(result.allowed).toBe(false);
      expect(result.requiresPatch).toBe(true);
      expect(result.reason).toContain('strict');
    });

    it('should block create_file without patch', async () => {
      const result = await policy.gate({ toolName: 'create_file', paths: ['/tmp/new.ts'] });
      expect(result.allowed).toBe(false);
    });

    it('should block multi_edit without patch', async () => {
      const result = await policy.gate({ toolName: 'multi_edit', paths: [] });
      expect(result.allowed).toBe(false);
    });

    it('should always allow apply_patch', async () => {
      const result = await policy.gate({ toolName: 'apply_patch', paths: [] });
      expect(result.allowed).toBe(true);
    });

    it('should allow write tools when patch is provided', async () => {
      const result = await policy.gate({
        toolName: 'str_replace_editor',
        paths: ['/tmp/test.ts'],
        patch: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('isWriteTool', () => {
    it('should identify known write tools', () => {
      expect(policy.isWriteTool('str_replace_editor')).toBe(true);
      expect(policy.isWriteTool('create_file')).toBe(true);
      expect(policy.isWriteTool('multi_edit')).toBe(true);
      expect(policy.isWriteTool('apply_patch')).toBe(true);
    });

    it('should not identify non-write tools', () => {
      expect(policy.isWriteTool('bash')).toBe(false);
      expect(policy.isWriteTool('view_file')).toBe(false);
      expect(policy.isWriteTool('search')).toBe(false);
    });
  });

  describe('WRITE_TOOL_NAMES set', () => {
    it('should include expected tools', () => {
      expect(WRITE_TOOL_NAMES.has('str_replace_editor')).toBe(true);
      expect(WRITE_TOOL_NAMES.has('create_file')).toBe(true);
      expect(WRITE_TOOL_NAMES.has('multi_edit')).toBe(true);
      expect(WRITE_TOOL_NAMES.has('apply_patch')).toBe(true);
    });
  });

  describe('onGate listener', () => {
    it('should notify listeners in confirm mode', async () => {
      policy.setMode('confirm');
      const calls: Array<{ toolName: string; allowed: boolean }> = [];

      policy.onGate((op, result) => {
        calls.push({ toolName: op.toolName, allowed: result.allowed });
      });

      await policy.gate({ toolName: 'str_replace_editor', paths: ['/tmp/test.ts'] });

      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe('str_replace_editor');
      expect(calls[0].allowed).toBe(true);
    });

    it('should notify listeners in strict mode on block', async () => {
      policy.setMode('strict');
      let blocked = false;

      policy.onGate((_op, result) => {
        if (!result.allowed) blocked = true;
      });

      await policy.gate({ toolName: 'create_file', paths: ['/tmp/test.ts'] });

      expect(blocked).toBe(true);
    });

    it('should not notify for apply_patch', async () => {
      policy.setMode('strict');
      const calls: string[] = [];

      policy.onGate((op) => {
        calls.push(op.toolName);
      });

      await policy.gate({ toolName: 'apply_patch', paths: [] });

      expect(calls).toHaveLength(0);
    });
  });

  describe('setMode / getMode', () => {
    it('should update mode', () => {
      policy.setMode('strict');
      expect(policy.getMode()).toBe('strict');

      policy.setMode('off');
      expect(policy.getMode()).toBe('off');
    });
  });
});
