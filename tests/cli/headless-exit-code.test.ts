import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

function getCleanChildEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0] !== 'FORCE_COLOR'
    )
  );
}

function runCliAgainstFailingProvider(port: number): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const cleanEnv = getCleanChildEnv();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'src/index.ts',
      '--prompt',
      'QA headless failure exit code probe',
      '--api-key',
      'test-key',
      '--base-url',
      `http://127.0.0.1:${port}/v1`,
      '--model',
      'qa-mock-model',
      '--max-tool-rounds',
      '1',
      '--no-self-heal',
      '--ephemeral',
      '--quiet',
      '--output-format',
      'json',
    ], {
      cwd: process.cwd(),
      env: {
        ...cleanEnv,
        CODEBUDDY_DISABLE_MCP: 'true',
        CODEBUDDY_HEADLESS: 'true',
        CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function runCliAgainstSuccessfulProvider(port: number, options: {
  directory?: string;
  disableTools?: boolean;
  inheritLogLevel?: boolean;
  logLevel?: string;
  nodeEnv?: string;
  quiet?: boolean;
  responseContent?: string;
} = {}): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const cleanEnv = getCleanChildEnv();

  return new Promise((resolve, reject) => {
    const args = [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'src/index.ts',
    ];
    if (options.directory) {
      args.push('--directory', options.directory);
    }
    args.push(
      '--prompt',
      'Return HEADLESS_JSON_CONTRACT_OK exactly.',
      '--api-key',
      'test-key',
      '--base-url',
      `http://127.0.0.1:${port}/v1`,
      '--model',
      'qa-mock-model',
      '--max-tool-rounds',
      '1',
      '--no-self-heal',
      '--ephemeral',
      '--output-format',
      'json',
    );
    if (options.quiet !== false) {
      args.splice(args.length - 2, 0, '--quiet');
    }
    if (options.disableTools ?? true) {
      args.splice(args.length - 2, 0, '--disabled-tools', '*');
    }

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...cleanEnv,
        ...(options.inheritLogLevel === false ? { LOG_LEVEL: undefined } : {}),
        CODEBUDDY_DISABLE_MCP: 'true',
        CODEBUDDY_HEADLESS: 'true',
        CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
        ...(options.logLevel
          ? { LOG_LEVEL: options.logLevel }
          : options.inheritLogLevel === false
            ? { LOG_LEVEL: undefined }
            : { LOG_LEVEL: 'error' }),
        ...(options.nodeEnv ? { NODE_ENV: options.nodeEnv } : {}),
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe('headless CLI exit codes', () => {
  it('emits pipeable JSON with the final text at .result', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-headless-json-contract',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'qa-mock-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'HEADLESS_JSON_CONTRACT_OK',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
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

      const result = await runCliAgainstSuccessfulProvider(address.port);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout);
      expect(typeof parsed.result).toBe('string');
      expect(parsed.result).toBe('HEADLESS_JSON_CONTRACT_OK');
      expect(parsed.content).toBeUndefined();
      expect(Array.isArray(parsed.messages)).toBe(true);
      expect(parsed.messages.at(-1).content).toBe('HEADLESS_JSON_CONTRACT_OK');
      expect(result.stderr.trim()).toBe('');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 90_000);

  it('keeps --quiet headless stderr clean without requiring LOG_LEVEL in the parent env', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-headless-quiet-contract',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'qa-mock-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'HEADLESS_JSON_CONTRACT_OK',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
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

      const result = await runCliAgainstSuccessfulProvider(address.port, {
        inheritLogLevel: false,
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).result).toBe('HEADLESS_JSON_CONTRACT_OK');
      expect(result.stderr.trim()).toBe('');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 90_000);

  it('does not dirty a real Git workspace during ephemeral headless startup', async () => {
    let requests = 0;
    const server = http.createServer((req, res) => {
      requests += 1;
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-headless-clean-workspace',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'qa-mock-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'HEADLESS_JSON_CONTRACT_OK',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-headless-git-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'headless-clean-workspace',
        type: 'module',
        scripts: { test: 'node --test' },
        dependencies: {},
      }, null, 2));
      fs.mkdirSync(path.join(tmpDir, 'src'));
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const value = 1;\n');
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
      execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'ignore' });
      execFileSync('git', [
        '-c', 'user.name=Code Buddy Smoke',
        '-c', 'user.email=smoke@example.test',
        'commit',
        '-m',
        'init',
      ], { cwd: tmpDir, stdio: 'ignore' });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address');
      }

      const result = await runCliAgainstSuccessfulProvider(address.port, {
        directory: tmpDir,
        disableTools: false,
      });

      expect(result.exitCode).toBe(0);
      expect(requests).toBeGreaterThan(0);
      expect(JSON.parse(result.stdout).result).toBe('HEADLESS_JSON_CONTRACT_OK');
      expect(fs.existsSync(path.join(tmpDir, '.codebuddy'))).toBe(false);
      const status = execFileSync('git', ['status', '--short'], { cwd: tmpDir, encoding: 'utf8' });
      expect(status.trim()).toBe('');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 90_000);

  it('returns non-zero when the provider failure is rendered as an assistant error', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'qa forced provider failure' }, path: req.url }));
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

      const result = await runCliAgainstFailingProvider(address.port);
      expect(result.exitCode).toBe(1);

      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toContain('qa forced provider failure');
      expect(parsed.messages.at(-1).content).toContain('Sorry, I encountered an error:');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 90_000);

  it('returns a dedicated non-zero code when a known tool call is only prose', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-headless-prose-tool-call',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'qa-mock-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'create_file(path="hello.txt", content="bonjour")',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
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

      const result = await runCliAgainstSuccessfulProvider(address.port, {
        disableTools: true,
        logLevel: 'warn',
        nodeEnv: 'development',
        quiet: false,
        responseContent: 'create_file(path="hello.txt", content="bonjour")',
      });

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stdout).result).toContain('create_file(');
      expect(result.stderr).toContain('le modèle a décrit un appel d’outil sans l’exécuter');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 90_000);
});
