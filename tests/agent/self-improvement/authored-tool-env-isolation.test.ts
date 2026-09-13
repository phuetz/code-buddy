/**
 * Authored-tool sandbox env isolation — the security spine.
 *
 * Audit finding: the authored-tool "sandbox" inherited the FULL process.env
 * (every API key/token), and the code RUNS during pre-accept scoring, so even
 * a rejected proposal had already executed and could exfiltrate secrets. The
 * sandbox now runs with envMode 'isolate': no inherited secrets, HOME
 * redirected away from ~/.codebuddy.
 *
 * These tests execute REAL node child processes (no mocks) — the only honest
 * way to prove an env var does or doesn't cross the process boundary.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAuthoredTool } from '../../../src/agent/self-improvement/authored-tool-runtime.js';
import { executeCode } from '../../../src/tools/execute-code-runner.js';

const SECRET_KEY = 'CODEBUDDY_TEST_FAKE_API_KEY';
const SECRET_VALUE = 'sk-must-never-leak-1234567890';

beforeEach(() => {
  process.env[SECRET_KEY] = SECRET_VALUE;
});

afterEach(() => {
  delete process.env[SECRET_KEY];
});

describe('authored tool sandbox — env isolation', () => {
  it.skipIf(process.platform !== 'linux')('does NOT leak a parent secret to the authored code (echoes empty, not the value)', async () => {
    const tool = buildAuthoredTool({
      name: 'authored__leaker',
      description: 'tries to read a secret from the env',
      parameters: { type: 'object', properties: {} },
      language: 'javascript',
      code: `console.log(JSON.stringify({ leaked: process.env.${SECRET_KEY} ?? null }));`,
    });

    const res = await tool.execute({});
    expect(res.success).toBe(true);
    const parsed = JSON.parse(String(res.output).trim());
    expect(parsed.leaked).toBeNull(); // the secret never crossed the boundary
    expect(String(res.output)).not.toContain(SECRET_VALUE);
  }, 30_000);

  it.skipIf(process.platform !== 'linux')('redirects HOME into the throwaway run dir (real ~/.codebuddy unreachable by path)', async () => {
    const tool = buildAuthoredTool({
      name: 'authored__homeprobe',
      description: 'reports its HOME',
      parameters: { type: 'object', properties: {} },
      language: 'javascript',
      code: `console.log(JSON.stringify({ home: process.env.HOME }));`,
    });

    const res = await tool.execute({});
    const parsed = JSON.parse(String(res.output).trim());
    expect(parsed.home).toMatch(/cb-authored-/); // the sandbox run dir, not the user's home
    expect(parsed.home).not.toBe(process.env.HOME);
  }, 30_000);

  it.skipIf(process.platform !== 'linux')('still passes the tool input through (isolation does not break normal operation)', async () => {
    const tool = buildAuthoredTool({
      name: 'authored__doubler',
      description: 'doubles n',
      parameters: { type: 'object', properties: { n: { type: 'number' } } },
      language: 'javascript',
      code: `const i = JSON.parse(process.env.CODEBUDDY_TOOL_INPUT || '{}'); console.log(i.n * 2);`,
    });

    const res = await tool.execute({ n: 21 });
    expect(res.success).toBe(true);
    expect(String(res.output).trim()).toBe('42');
  }, 30_000);

  it('inherit mode (default) still exposes the env for the user-facing execute_code tool', async () => {
    // Backward-compat guard: the general tool must keep its inherited env.
    const res = await executeCode({
      code: `console.log(process.env.${SECRET_KEY} ?? 'MISSING');`,
      language: 'javascript',
    });
    expect(res.ok).toBe(true);
    expect(res.stdout.trim()).toBe(SECRET_VALUE);
  }, 30_000);
});
