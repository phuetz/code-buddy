import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LSPClient } from '../../src/lsp/lsp-client.js';
import {
  LspDefinitionTool,
  LspDiagnosticsTool,
  LspHoverTool,
  LspReferencesTool,
  LspSymbolsTool,
  type LspToolDependencies,
} from '../../src/tools/lsp-navigation-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

const mockServerPath = fileURLToPath(
  new URL('../fixtures/lsp/mock-lsp-server.mjs', import.meta.url)
);

let fixtureDirectory: string;
let sourceFile: string;
let client: LSPClient;
let dependencies: LspToolDependencies;

beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-lsp-tools-'));
  sourceFile = path.join(fixtureDirectory, 'sample.ts');
  await fs.writeFile(
    sourceFile,
    [
      'export const answer = 42;',
      'export function useAnswer() {',
      '  return answer;',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );

  client = new LSPClient();
  client.registerServer({
    language: 'typescript',
    command: process.execPath,
    args: [mockServerPath],
  });
  dependencies = {
    client,
    commandExists: async () => true,
  };
});

afterAll(async () => {
  await client.stopAll();
  await fs.rm(fixtureDirectory, { recursive: true, force: true });
});

describe('read-only LSP navigation tools with a mocked stdio server', () => {
  it('lsp_definition returns the semantic definition for a symbol', async () => {
    const result = await new LspDefinitionTool(dependencies).execute({
      file: sourceFile,
      symbol: 'answer',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain(`${sourceFile}:1:14`);
    const data = result.data as {
      locations: Array<{ file: string; line: number; column: number }>;
    };
    expect(data.locations[0]).toMatchObject({ file: sourceFile, line: 1, column: 14 });
  });

  it('lsp_references returns all semantic references for coordinates', async () => {
    const result = await new LspReferencesTool(dependencies).execute({
      file: sourceFile,
      line: 3,
      column: 10,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('References');
    const data = result.data as {
      total: number;
      locations: Array<{ line: number; column: number }>;
    };
    expect(data.total).toBe(2);
    expect(data.locations).toEqual([
      expect.objectContaining({ line: 1, column: 14 }),
      expect.objectContaining({ line: 3, column: 10 }),
    ]);
  });

  it('lsp_hover returns semantic type information', async () => {
    const result = await new LspHoverTool(dependencies).execute({
      file: sourceFile,
      symbol: 'answer',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('const answer: 42');
    const data = result.data as { hover: { content: string; range?: { file: string } } };
    expect(data.hover.content).toContain('const answer: 42');
    expect(data.hover.range?.file).toBe(sourceFile);
  });

  it('lsp_symbols returns the semantic document outline', async () => {
    const result = await new LspSymbolsTool(dependencies).execute({ file: sourceFile });

    expect(result.success).toBe(true);
    expect(result.output).toContain('[Constant] answer');
    expect(result.output).toContain('[Function] useAnswer');
    const data = result.data as { symbols: Array<{ name: string; kind: string }> };
    expect(data.symbols).toEqual([
      expect.objectContaining({ name: 'answer', kind: 'Constant' }),
      expect.objectContaining({ name: 'useAnswer', kind: 'Function' }),
    ]);
  });

  it('lsp_diagnostics returns diagnostics published by the server', async () => {
    const result = await new LspDiagnosticsTool(dependencies).execute({ file: sourceFile });

    expect(result.success).toBe(true);
    expect(result.output).toContain('WARNING');
    expect(result.output).toContain('Mock warning for answer');
    const data = result.data as { diagnostics: Array<{ file: string; severity: string }> };
    expect(data.diagnostics).toEqual([
      expect.objectContaining({ file: sourceFile, severity: 'warning' }),
    ]);
  });

  it.each([
    [
      'lsp_definition',
      (deps: LspToolDependencies) => new LspDefinitionTool(deps),
      { file: '', line: 1, column: 1 },
    ],
    [
      'lsp_references',
      (deps: LspToolDependencies) => new LspReferencesTool(deps),
      { file: '', line: 1, column: 1 },
    ],
    [
      'lsp_hover',
      (deps: LspToolDependencies) => new LspHoverTool(deps),
      { file: '', line: 1, column: 1 },
    ],
    ['lsp_symbols', (deps: LspToolDependencies) => new LspSymbolsTool(deps), { file: '' }],
    ['lsp_diagnostics', (deps: LspToolDependencies) => new LspDiagnosticsTool(deps), { file: '' }],
  ])('%s reports a missing language server without crashing', async (_name, createTool, args) => {
    const missingClient = new LSPClient();
    missingClient.registerServer({
      language: 'typescript',
      command: 'codebuddy-definitely-missing-lsp',
      args: [],
    });
    const result = await createTool({
      client: missingClient,
      commandExists: async () => false,
    }).execute({ ...args, file: sourceFile });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No LSP server is available for typescript');
    expect(result.error).toContain('codebuddy-definitely-missing-lsp');
  });

  it('marks every read-only LSP tool as fleet-safe metadata', () => {
    for (const name of [
      'lsp_definition',
      'lsp_references',
      'lsp_hover',
      'lsp_symbols',
      'lsp_diagnostics',
    ]) {
      expect(TOOL_METADATA.find((metadata) => metadata.name === name)).toMatchObject({
        name,
        fleetSafe: true,
      });
    }
  });
});
