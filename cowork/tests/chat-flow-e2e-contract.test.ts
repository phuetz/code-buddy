import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatFlowPath = path.resolve(process.cwd(), 'e2e/chat-flow.spec.ts');
const fixturesPath = path.resolve(process.cwd(), 'e2e/fixtures.ts');

describe('chat-flow e2e proof contract', () => {
  it('gets the assistant reply from a local OpenAI-compatible HTTP server', () => {
    const source = fs.readFileSync(chatFlowPath, 'utf8');

    expect(source).toContain("createServer");
    expect(source).toContain("listen(0, '127.0.0.1')");
    expect(source).toContain("'/v1/chat/completions'");
    expect(source).toContain('toBeGreaterThan(3100)');
    expect(source).toContain('LOCAL-OPENAI-E2E');
    expect(source).not.toContain("webContents.send('server-event'");
  });

  it('does not plant an empty ONNX fixture to suppress first-run UI', () => {
    const source = fs.readFileSync(fixturesPath, 'utf8');

    expect(source).not.toContain("writeFileSync(modelPath, '')");
    expect(source).toContain('COWORK_E2E_TMP_ROOT');
  });
});
