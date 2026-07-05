import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { JsonQueryTool } from '../../src/tools/json-query-tool.js';

describe('JsonQueryTool', () => {
  it('queries simple dotted paths and array indices', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'json-query-tool-'));
    const file = path.join(root, 'data.json');
    await fs.writeFile(file, JSON.stringify({ app: { items: [{ name: 'first' }] } }));
    const result = await new JsonQueryTool().execute({ file, path: 'app.items.0.name' });
    expect(result.success).toBe(true);
    expect((result.data as { value: string }).value).toBe('first');
  });

  it('returns a clean error for invalid paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'json-query-tool-'));
    const file = path.join(root, 'data.json');
    await fs.writeFile(file, JSON.stringify({ app: {} }));
    const result = await new JsonQueryTool().execute({ file, path: 'app.missing.name' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path segment not found');
  });
});
