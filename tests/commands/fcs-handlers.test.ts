import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FCS_SCRIPT_COMPLETED_WITH_NO_OUTPUT,
  handleFCS,
} from '../../src/commands/handlers/fcs-handlers.js';

describe('handleFCS', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-handler-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the actual FCS script output for run commands', async () => {
    const scriptPath = path.join(tmpDir, 'hello.fcs');
    fs.writeFileSync(scriptPath, 'print("fcs ok")');

    const result = await handleFCS(['run', scriptPath]);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('FCS Script Output');
    expect(result.entry?.content).toContain('fcs ok');
    expect(result.entry?.content).toContain('Script completed');
  });

  it('returns FCS execution errors in the command response', async () => {
    const scriptPath = path.join(tmpDir, 'broken.fcs');
    fs.writeFileSync(scriptPath, 'throw "boom"');

    const result = await handleFCS(['run', scriptPath]);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('FCS script failed');
    expect(result.entry?.content).toContain('boom');
  });

  it('returns an explicit message when the FCS script has no output', async () => {
    const scriptPath = path.join(tmpDir, 'silent.fcs');
    fs.writeFileSync(scriptPath, '');

    const result = await handleFCS(['run', scriptPath]);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain(FCS_SCRIPT_COMPLETED_WITH_NO_OUTPUT);
  });

  it('returns template search results instead of a loading placeholder', async () => {
    const templateDir = path.join(tmpDir, 'scripts', 'templates', 'utilities');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(
      path.join(templateDir, 'cleanup.fcs'),
      '// cleanup.fcs - Cleanup code\n// Usage: /fcs run cleanup.fcs\nprint("cleanup")'
    );

    const result = await handleFCS(['templates', 'cleanup']);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('FCS Templates matching "cleanup"');
    expect(result.entry?.content).toContain('Cleanup code');
    expect(result.entry?.content).not.toContain('Loading FCS templates');
  });
});
