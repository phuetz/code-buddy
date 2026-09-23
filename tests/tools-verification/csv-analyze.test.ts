import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CsvAnalyzeTool } from '../../src/tools/csv-analyze-tool.js';

describe('CsvAnalyzeTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-analyze-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should analyze a synthetic CSV file', async () => {
    const csvPath = path.join(tmpDir, 'test.csv');
    await fs.writeFile(csvPath, 'id,name,age\n1,Alice,30\n2,Bob,25\n3,Charlie,35');

    const tool = new CsvAnalyzeTool();
    const result = await tool.execute({ path: csvPath });

    console.log('CSV_ANALYZE_OUTPUT:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.output).toContain('Alice');
  });
});
