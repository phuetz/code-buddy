import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTryDemo, type TryProvider } from '../../src/commands/try.js';

const provider: TryProvider = { kind: 'ollama', label: 'fixture', apiKey: 'local', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen3:4b-instruct' };

async function verifyGeneratedFiles(code: string, test: string): Promise<{ exit: number; output: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'try-oracle-'));
  const output: string[] = [];
  try {
    await writeFile(join(workspace, 'package.json'), '{"type":"commonjs"}');
    const exit = await runTryDemo({
      resolveProvider: async () => provider,
      createWorkspace: async () => workspace,
      createAgent: async () => ({ processUserMessage: async () => {
        await writeFile(join(workspace, 'fizzbuzz.js'), code);
        await writeFile(join(workspace, 'fizzbuzz.test.js'), test);
        return [];
      } }),
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
    });
    return { exit, output: output.join('\n') };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

describe('try verifies the generated behavior independently', () => {
  it('rejects empty files even though node --test reports one passing file', async () => {
    const result = await verifyGeneratedFiles('', '');
    expect(result.exit).toBe(1);
    expect(result.output).not.toContain('✅ Demo succeeded');
  });
  it('rejects incorrect code even when its own test is green', async () => {
    const result = await verifyGeneratedFiles('exports.fizzBuzz = () => "wrong";', 'require("node:test")("fake", () => {});');
    expect(result.exit).toBe(1);
    expect(result.output).not.toContain('✅ Demo succeeded');
  });
  it('accepts correct code only after its test and the independent oracle pass', async () => {
    const result = await verifyGeneratedFiles('exports.fizzBuzz = n => n % 15 === 0 ? "FizzBuzz" : n % 3 === 0 ? "Fizz" : n % 5 === 0 ? "Buzz" : String(n);', 'const { test } = require("node:test"); const assert = require("node:assert/strict"); test("Fizz", () => assert.equal(require("./fizzbuzz.js").fizzBuzz(3), "Fizz"));');
    expect(result.exit).toBe(0);
    expect(result.output).toContain('Independent FizzBuzz oracle: 7/7');
  });
});
