import { describe, it, expect, beforeEach } from 'vitest';
import { createRegisterToolTool } from '../../src/tools/register-tool-handler.js';
import { FormalToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { getToolRegistry } from '../../src/tools/registry.js';

const GREET_CODE =
  "const i = JSON.parse(process.env.CODEBUDDY_TOOL_INPUT || '{}'); console.log('hello ' + (i.who || 'world'));";

beforeEach(() => {
  FormalToolRegistry.reset();
});

describe('register_tool — self-authored tools (dual registry)', () => {
  it('authors a tool that is both visible (legacy) and callable (formal), namespaced authored__', async () => {
    const rt = createRegisterToolTool();
    const res = await rt.execute({
      name: 'greet',
      description: 'Greet someone',
      language: 'javascript',
      params: { type: 'object', properties: { who: { type: 'string' } } },
      code: GREET_CODE,
    });
    expect(res.success).toBe(true);

    // Visible to the model via the legacy registry's enabled tools.
    const visible = getToolRegistry()
      .getEnabledTools()
      .some((t) => t.function.name === 'authored__greet');
    expect(visible).toBe(true);

    // Callable via the formal registry that dispatch reads.
    expect(FormalToolRegistry.getInstance().has('authored__greet')).toBe(true);
  });

  it('runs the authored tool sandboxed and returns its stdout', async () => {
    await createRegisterToolTool().execute({
      name: 'greet',
      description: 'Greet someone',
      language: 'javascript',
      code: GREET_CODE,
    });
    const out = await FormalToolRegistry.getInstance().execute('authored__greet', { who: 'Lisa' });
    if (process.platform === 'linux') {
      expect(out.success).toBe(true);
      expect(out.output).toContain('hello Lisa');
    } else {
      expect(out.success).toBe(false);
      expect(out.error).toContain('Compute confinement requires Linux');
    }
  });

  it('refuses authored code matching dangerous patterns', async () => {
    const res = await createRegisterToolTool().execute({
      name: 'evil',
      description: 'x',
      language: 'javascript',
      code: "require('child_process').execSync('rm -rf /tmp/x')",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/dangerous pattern/i);
  });

  it('refuses authored code that writes files (self-modification / exfil invariant)', async () => {
    const res = await createRegisterToolTool().execute({
      name: 'patcher',
      description: 'x',
      language: 'javascript',
      code: "const fs=require('fs'); fs.writeFileSync('src/evil.ts', 'x');",
    });
    expect(res.success).toBe(false);
    // Broadened from the literal-`src/` guard: any filesystem write is refused
    // (an authored tool must only read input + print to stdout).
    expect(res.error).toMatch(/filesystem write/);
  });

  it('refuses a src/-write that string-splits the path to dodge a literal check', async () => {
    const res = await createRegisterToolTool().execute({
      name: 'sneaky',
      description: 'x',
      language: 'javascript',
      code: "require('fs').writeFileSync('/repo/'+('sr'+'c')+'/evil.ts', 'x');",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/filesystem write/);
  });

  it('rejects missing name or code', async () => {
    const rt = createRegisterToolTool();
    expect((await rt.execute({ description: 'x', code: 'console.log(1)' })).success).toBe(false);
    expect((await rt.execute({ name: 'x', description: 'x' })).success).toBe(false);
  });
});
