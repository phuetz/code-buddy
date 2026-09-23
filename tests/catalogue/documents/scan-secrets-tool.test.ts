import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ScanSecretsExecuteTool } from '../../../src/tools/registry/secrets-tools';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cb-test-secrets-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('CODEBUDDY_HOME', tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('scan_secrets tool detects hardcoded secrets', async () => {
  const filePath = path.join(tmpDir, 'config.js');
  // Using a fake AWS access key ID format that the detector likely looks for
  const fakeSecret = 'AKIAIOSFODNN7EXAMPLE';
  await fs.promises.writeFile(filePath, `const AWS_KEY = "${fakeSecret}";`, 'utf8');

  const tool = new ScanSecretsExecuteTool();
  const result = await tool.execute({ path: tmpDir });
  
  expect(result.success).toBe(true);
  // Since secrets were found, the output should contain warnings about it
  expect(result.output).toContain('Found 1 potential secret');
  expect(result.output).toContain('AWS Access Key ID detected');
});
