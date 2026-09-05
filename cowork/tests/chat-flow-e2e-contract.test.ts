import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatFlowPath = path.resolve(process.cwd(), 'e2e/chat-flow.spec.ts');
const fixturesPath = path.resolve(process.cwd(), 'e2e/fixtures.ts');

describe('chat-flow e2e proof contract', () => {
  it('gets two consecutive assistant replies from a local OpenAI-compatible HTTP server', () => {
    const source = fs.readFileSync(chatFlowPath, 'utf8');

    expect(source).toContain("createServer");
    expect(source).toContain("listen(0, '127.0.0.1')");
    expect(source).toContain("'/v1/chat/completions'");
    expect(source).toContain('toBeGreaterThan(3100)');
    expect(source).toContain('LOCAL-OPENAI-E2E');
    expect(source).toContain('Second local server chat proof');
    expect(source).toContain('COWORK_E17_CHAT_SCREENSHOT');
    expect(source.match(/visibleComposer\(appPage\)/g)).toHaveLength(3);
    expect(source).not.toContain("webContents.send('server-event'");
  });

  it('does not plant an empty ONNX fixture to suppress first-run UI', () => {
    const source = fs.readFileSync(fixturesPath, 'utf8');

    expect(source).not.toContain("writeFileSync(modelPath, '')");
    expect(source).toContain('COWORK_E2E_TMP_ROOT');
    expect(source).toContain('BUFFALO_ONNX_FIXTURE_SKIP_REASON');
    expect(source).toMatch(/empty files lie about install/i);
  });

  it('does not plant an empty Buffalo_S ONNX in any e2e spec', () => {
    const e2eDir = path.resolve(process.cwd(), 'e2e');
    const files = fs.readdirSync(e2eDir).filter((name) => name.endsWith('.ts') || name.endsWith('.cjs'));
    const offenders: string[] = [];
    for (const name of files) {
      const source = fs.readFileSync(path.join(e2eDir, name), 'utf8');
      if (
        /writeFileSync\(\s*modelPath\s*,\s*(?:''|""|Buffer\.alloc\(\s*0\s*\))/u.test(source)
      ) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
