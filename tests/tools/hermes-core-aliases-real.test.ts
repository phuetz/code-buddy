import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBashTools, resetBashInstance } from '../../src/tools/registry/bash-tools.js';
import { createSearchTools, resetSearchInstance } from '../../src/tools/registry/search-tools.js';
import { createTextEditorTools, resetTextEditorInstance } from '../../src/tools/registry/text-editor-tools.js';
import { createWebTools, resetWebSearchInstance } from '../../src/tools/registry/web-tools.js';
import { createAliasTools } from '../../src/tools/registry/tool-aliases.js';
import type { ITool, IToolExecutionContext } from '../../src/tools/registry/types.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getSSRFGuard, resetSSRFGuard } from '../../src/security/ssrf-guard.js';

describe('Hermes core aliases use real tool implementations', () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-hermes-core-'));
    oldCwd = process.cwd();
    process.chdir(tempDir);
    const confirmation = ConfirmationService.getInstance();
    confirmation.setSessionFlag('fileOperations', true);
    confirmation.setSessionFlag('bashCommands', true);
    resetSSRFGuard();
    getSSRFGuard({ allowedHosts: ['127.0.0.1'] });
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    const confirmation = ConfirmationService.getInstance();
    confirmation.setSessionFlag('fileOperations', false);
    confirmation.setSessionFlag('bashCommands', false);
    resetTextEditorInstance();
    resetSearchInstance();
    resetBashInstance();
    resetWebSearchInstance();
    resetSSRFGuard();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('routes read/write/patch/search/terminal/web_extract through live filesystem, shell, ripgrep and HTTP paths', async () => {
    const primaryTools = [
      ...createTextEditorTools(),
      ...createSearchTools(),
      ...createBashTools(),
      ...createWebTools(),
    ];
    const aliases = createAliasTools(primaryTools);
    const tool = (name: string): ITool => {
      const found = aliases.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`Missing alias: ${name}`);
      return found;
    };

    const filePath = path.join(tempDir, 'notes.txt');
    const writeResult = await tool('write_file').execute({
      path: filePath,
      content: 'Hermes original text\n',
    });
    expect(writeResult.success).toBe(true);

    const readResult = await tool('read_file').execute({ path: filePath });
    expect(readResult.success).toBe(true);
    expect(readResult.output).toContain('Hermes original text');

    const patchResult = await tool('patch').execute({
      path: filePath,
      old_str: 'original',
      new_str: 'patched',
    });
    expect(patchResult.success).toBe(true);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toContain('Hermes patched text');

    const searchResult = await tool('search_files').execute({
      query: 'Hermes patched text',
      search_type: 'text',
      max_results: 5,
    });
    expect(searchResult.success).toBe(true);
    expect(searchResult.output).toContain('notes.txt');

    const terminalResult = await tool('terminal').execute({
      command: 'node -e "console.log(\'hermes-terminal-real\')"',
      timeout: 10_000,
    });
    expect(terminalResult.success).toBe(true);
    expect(terminalResult.output).toContain('hermes-terminal-real');

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><main>Hermes web extract real</main></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('HTTP server did not bind to a TCP port');
      const webResult = await tool('web_extract').execute({
        url: `http://127.0.0.1:${address.port}/`,
      });
      expect(webResult.success).toBe(true);
      expect(webResult.output).toContain('Hermes web extract real');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }, 30_000);

  it('forwards the complete execution context to the primary tool', async () => {
    let receivedContext: IToolExecutionContext | undefined;
    const primary: ITool = {
      name: 'bash',
      description: 'context probe',
      getSchema: () => ({
        name: 'bash',
        description: 'context probe',
        parameters: { type: 'object', properties: {} },
      }),
      async execute(_input, context) {
        receivedContext = context;
        return { success: true, output: 'ok' };
      },
    };
    const terminal = createAliasTools([primary]).find((tool) => tool.name === 'terminal');
    const context: IToolExecutionContext = {
      cwd: tempDir,
      botId: 'lisa',
      sessionId: 'session-context',
      dryRun: true,
    };

    await terminal!.execute({ command: 'pwd' }, context);

    expect(receivedContext).toBe(context);
  });
});
