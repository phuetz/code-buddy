import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { QRTool } from '../../src/tools/qr-tool.js';

describe('QRTool', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should generate an ascii QR code', async () => {
    const tool = new QRTool();
    const result = await tool.generate('https://example.com', { format: 'ascii' });

    console.log('QR_OUTPUT:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.output).toContain('█'); // ASCII block chars for QR
  });
});
