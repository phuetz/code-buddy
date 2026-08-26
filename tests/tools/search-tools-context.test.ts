import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FindDefinitionTool,
  FindSymbolsTool,
  UnifiedSearchTool,
  resetSearchInstance,
} from '../../src/tools/registry/search-tools.js';
import { resetEnhancedSearch } from '../../src/tools/enhanced-search.js';

const roots: string[] = [];

afterEach(async () => {
  resetSearchInstance();
  resetEnhancedSearch();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
});

describe('registry search workspace confinement', () => {
  it('uses each execution context cwd without a cross-session singleton race', async () => {
    const left = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-search-left-'));
    const right = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-search-right-'));
    roots.push(left, right);
    await fs.writeFile(path.join(left, 'left.txt'), 'shared-needle left-only-marker\n');
    await fs.writeFile(path.join(right, 'right.txt'), 'shared-needle right-only-marker\n');

    const tool = new UnifiedSearchTool();
    const [leftResult, rightResult] = await Promise.all([
      tool.execute(
        { query: 'left-only-marker', search_type: 'text' },
        { cwd: left, sessionId: 'left-session' },
      ),
      tool.execute(
        { query: 'right-only-marker', search_type: 'text' },
        { cwd: right, sessionId: 'right-session' },
      ),
    ]);

    expect(leftResult.success).toBe(true);
    expect(leftResult.output).toContain('left.txt');
    expect(leftResult.output).not.toContain('right.txt');
    expect(rightResult.success).toBe(true);
    expect(rightResult.output).toContain('right.txt');
    expect(rightResult.output).not.toContain('left.txt');
  });

  it('isolates enhanced symbol and definition caches by execution cwd', async () => {
    const left = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-symbol-left-'));
    const right = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-symbol-right-'));
    roots.push(left, right);
    await fs.writeFile(path.join(left, 'left.ts'), 'export function SharedSymbol(): string { return "left"; }\n');
    await fs.writeFile(path.join(right, 'right.ts'), 'export function SharedSymbol(): string { return "right"; }\n');

    const symbols = new FindSymbolsTool();
    const definitions = new FindDefinitionTool();
    const leftContext = { cwd: left, sessionId: 'left-session' };
    const rightContext = { cwd: right, sessionId: 'right-session' };

    const leftSymbols = await symbols.execute({ name: 'SharedSymbol' }, leftContext);
    const rightSymbols = await symbols.execute({ name: 'SharedSymbol' }, rightContext);
    const leftDefinition = await definitions.execute(
      { symbol_name: 'SharedSymbol' },
      leftContext,
    );
    const rightDefinition = await definitions.execute(
      { symbol_name: 'SharedSymbol' },
      rightContext,
    );

    expect(leftSymbols.output).toContain('left.ts');
    expect(leftSymbols.output).not.toContain('right.ts');
    expect(rightSymbols.output).toContain('right.ts');
    expect(rightSymbols.output).not.toContain('left.ts');
    expect(leftDefinition.output).toContain('left.ts');
    expect(leftDefinition.output).not.toContain('right.ts');
    expect(rightDefinition.output).toContain('right.ts');
    expect(rightDefinition.output).not.toContain('left.ts');
  });

  it.runIf(process.platform !== 'win32')('does not follow a workspace symlink outside its root', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-search-workspace-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-search-outside-'));
    roots.push(workspace, outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside-symlink-secret\n');
    await fs.symlink(outside, path.join(workspace, 'escaped'));

    const result = await new UnifiedSearchTool().execute(
      { query: 'outside-symlink-secret', search_type: 'text' },
      { cwd: workspace, sessionId: 'confined-session' },
    );

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('secret.txt');
  });
});
