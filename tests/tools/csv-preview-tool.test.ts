import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CsvPreviewTool } from '../../src/tools/csv-preview-tool.js';

describe('CsvPreviewTool', () => {
  it('parses quoted CSV and infers column types', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-preview-tool-'));
    const file = path.join(root, 'data.csv');
    await fs.writeFile(file, 'name,amount,date,note\nAlice,12.5,2026-01-02,"hello, world"\nBob,7,2026-01-03,"quoted ""value"""\n');
    const result = await new CsvPreviewTool().execute({ file, previewRows: 1 });
    expect(result.success).toBe(true);
    const data = result.data as { columns: string[]; rowCount: number; preview: Array<Record<string, string>>; inferredTypes: Record<string, string> };
    expect(data.columns).toEqual(['name', 'amount', 'date', 'note']);
    expect(data.rowCount).toBe(2);
    expect(data.preview[0]?.note).toBe('hello, world');
    expect(data.inferredTypes.amount).toBe('number');
    expect(data.inferredTypes.date).toBe('date');
  });
});
