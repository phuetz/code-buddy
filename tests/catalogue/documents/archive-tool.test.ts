import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ArchiveExecuteTool } from '../../../src/tools/registry/multimodal-tools';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cb-test-archive-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('CODEBUDDY_HOME', tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('archive tool creates and extracts archive', async () => {
  const inputFilePath = path.join(tmpDir, 'test.txt');
  await fs.promises.writeFile(inputFilePath, 'Hello Archive', 'utf8');

  const archivePath = path.join(tmpDir, 'test.zip');
  const extractPath = path.join(tmpDir, 'extracted');

  const tool = new ArchiveExecuteTool();

  const createResult = await tool.execute({
    operation: 'create',
    sources: [inputFilePath],
    output_path: archivePath,
  });
  console.log('[archive create]', JSON.stringify(createResult));
  expect(createResult.success).toBe(true);

  const actualArchivePath = (createResult as { data: { path: string } }).data.path;
  expect(actualArchivePath.startsWith(tmpDir)).toBe(true);
  expect(fs.existsSync(actualArchivePath)).toBe(true);

  const extractResult = await tool.execute({
    operation: 'extract',
    path: actualArchivePath,
    output_dir: extractPath,
  });
  console.log('[archive extract]', JSON.stringify(extractResult));
  expect(extractResult.success).toBe(true);

  const extractedFilePath = path.join(extractPath, 'test.txt');
  const content = await fs.promises.readFile(extractedFilePath, 'utf8');
  expect(content).toBe('Hello Archive');
});
