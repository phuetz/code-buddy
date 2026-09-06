import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  formatEmptyHeadlessResponseError,
  isHeadlessFinalResponseEmpty,
  resolveHeadlessResultExitCode,
} from '../../src/cli/headless-options.js';

function getCleanChildEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0] !== 'FORCE_COLOR'
    )
  );
}

describe('headless empty final response', () => {
  it('treats blank output and stripped <think> blocks as empty', () => {
    expect(isHeadlessFinalResponseEmpty('')).toBe(true);
    expect(isHeadlessFinalResponseEmpty('   \n')).toBe(true);
    expect(isHeadlessFinalResponseEmpty('<think>plan the haiku</think>')).toBe(true);
    expect(isHeadlessFinalResponseEmpty('<think>x</think>\nVague sur le sable')).toBe(false);
    expect(isHeadlessFinalResponseEmpty('Sorry, I encountered an error: réponse vide du fournisseur')).toBe(true);
  });

  it('formats a stderr diagnostic with provider, model and duration', () => {
    expect(formatEmptyHeadlessResponseError({
      provider: 'ollama',
      model: 'qwen3.8-ctx32k:latest',
      durationMs: 14270,
    })).toBe("le modèle n'a rien renvoyé ; provider=ollama modèle=qwen3.8-ctx32k:latest durée=14s");
  });

  it('returns a non-zero exit code for an empty visible answer', () => {
    expect(resolveHeadlessResultExitCode('')).toBe(1);
    expect(resolveHeadlessResultExitCode('<think>only thinking</think>')).toBe(1);
    expect(resolveHeadlessResultExitCode('Vague sur le sable')).toBe(0);
  });

  it('exits non-zero with a stderr diagnostic when the model returns no visible text', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-headless-empty',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'qa-mock-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '<think>drafting silently</think>' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address');
      }

      const result = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const child = spawn(process.execPath, [
          path.resolve('node_modules/tsx/dist/cli.mjs'),
          'src/index.ts',
          '--prompt',
          'Écris un haïku sur la mer',
          '--api-key',
          'test-key',
          '--base-url',
          `http://127.0.0.1:${address.port}/v1`,
          '--model',
          'qa-mock-model',
          '--max-tool-rounds',
          '1',
          '--no-self-heal',
          '--ephemeral',
          '--quiet',
          '--disabled-tools',
          '*',
          '--output-format',
          'text',
        ], {
          cwd: process.cwd(),
          env: {
            ...getCleanChildEnv(),
            CODEBUDDY_DISABLE_MCP: 'true',
            CODEBUDDY_HEADLESS: 'true',
            CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
            LOG_LEVEL: 'error',
            NO_COLOR: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(result.stderr).toContain("le modèle n'a rien renvoyé");
      expect(result.stderr).toContain('modèle=qa-mock-model');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
