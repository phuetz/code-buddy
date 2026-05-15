import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleScript } from '../../src/commands/handlers/script-handlers.js';
import { resetScriptManager } from '../../src/scripting/index.js';

describe('handleScript', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-handler-'));
    resetScriptManager();
  });

  afterEach(() => {
    resetScriptManager();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the actual script output for run commands', async () => {
    const scriptPath = path.join(tmpDir, 'hello.bs');
    fs.writeFileSync(scriptPath, 'print("script ok")');

    const result = await handleScript(['run', scriptPath]);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Script Output');
    expect(result.entry?.content).toContain('script ok');
    expect(result.entry?.content).toContain('Script completed');
  });

  it('returns script execution errors in the command response', async () => {
    const scriptPath = path.join(tmpDir, 'broken.bs');
    fs.writeFileSync(scriptPath, 'throw "boom"');

    const result = await handleScript(['run', scriptPath]);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Script failed');
    expect(result.entry?.content).toContain('boom');
  });
});
