import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DiffFilesTool } from '../../src/tools/diff-files-tool.js';
describe('DiffFilesTool', () => { it('creates a unified diff for files under root', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-files-tool-')); await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\nthree'); await fs.writeFile(path.join(root, 'b.txt'), 'one\nTWO\nthree\nfour'); const result = await new DiffFilesTool().execute({ root, left: 'a.txt', right: 'b.txt' }); expect(result.success).toBe(true); expect(result.output).toContain('-two'); expect(result.output).toContain('+TWO'); expect(result.output).toContain('+four'); }); });
