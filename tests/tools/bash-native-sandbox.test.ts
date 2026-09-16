import { afterEach, describe, expect, it } from 'vitest';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import {
  NATIVE_SANDBOX_ENV,
  confineSpawn,
} from '../../src/security/native-sandbox.js';

describe('bash native-sandbox opt-in', () => {
  afterEach(() => {
    delete process.env[NATIVE_SANDBOX_ENV];
  });

  it('leaves the shell argv unchanged when CODEBUDDY_NATIVE_SANDBOX is unset', () => {
    const original = { file: 'bash', args: ['-c', 'echo ok'], cwd: process.cwd(), env: { PATH: '/bin' } };
    const result = confineSpawn(original, { env: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toBe(original.file);
    expect(result.args).toBe(original.args);
    expect(result.backend).toBe('none');
  });

  it('BashTool still constructs without enabling the kernel sandbox', () => {
    expect(process.env[NATIVE_SANDBOX_ENV]).toBeUndefined();
    const tool = new BashTool();
    expect(tool).toBeInstanceOf(BashTool);
    tool.dispose();
  });
});
