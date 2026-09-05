import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CLI_TIMEOUT_MS = 45_000;

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function startProvider(responseContent: string): Promise<{
  server: http.Server;
  port: number;
}> {
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl-headless-output-flags',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'qa-mock-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent,
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

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected TCP server address'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function runCli(
  port: number,
  tempDir: string,
  extraArgs: string[],
): Promise<CliResult> {
  const homeDir = path.join(tempDir, 'home');
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const child = spawn(process.execPath, [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('src/index.ts'),
    '--prompt',
    'HEADLESS_OUTPUT_FLAGS_PROBE',
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
    '--disabled-tools',
    '*',
    '--output-format',
    'text',
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: {
      ...cleanEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CODEBUDDY_SESSIONS_DIR: path.join(homeDir, '.codebuddy', 'sessions'),
      CODEBUDDY_RUNS_DIR: path.join(homeDir, '.codebuddy', 'runs'),
      CODEBUDDY_DISABLE_MCP: 'true',
      CODEBUDDY_HEADLESS: 'true',
      CODEBUDDY_REQUEST_TIMEOUT_MS: '5000',
      LOG_LEVEL: 'error',
      NODE_ENV: 'development',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(
        `CLI timed out after ${CLI_TIMEOUT_MS}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', exitCode => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe('headless output file and schema flags', () => {
  let tempDir: string;
  let provider: http.Server | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-headless-output-flags-'));
  });

  afterEach(async () => {
    if (provider) {
      await new Promise<void>(resolve => provider?.close(() => resolve()));
      provider = undefined;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function runWithResponse(responseContent: string, extraArgs: string[]): Promise<CliResult> {
    const started = await startProvider(responseContent);
    provider = started.server;
    return runCli(started.port, tempDir, extraArgs);
  }

  function writeSchema(schema: object): string {
    const schemaPath = path.join(tempDir, 'output-schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(schema));
    return schemaPath;
  }

  const responseText = '{"answer":"last assistant response"}';

  it('writes the last assistant message exactly with -o', async () => {
    const target = path.join(tempDir, 'answer.txt');
    const result = await runWithResponse(responseText, ['-o', target]);

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(responseText);
  });

  it('creates missing parent directories for -o', async () => {
    const target = path.join(tempDir, 'nested', 'deep', 'answer.txt');
    const result = await runWithResponse(responseText, ['-o', target]);

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(responseText);
  });

  it('accepts a conforming final JSON response with --output-schema', async () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        answer: { type: 'string', minLength: 1 },
      },
      required: ['answer'],
      additionalProperties: false,
    });
    const result = await runWithResponse(responseText, ['--output-schema', schemaPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${responseText}\n`);
  });

  it('rejects a final JSON response that does not conform to the schema', async () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    });
    const result = await runWithResponse('{"other":"value"}', ['--output-schema', schemaPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Output schema validation failed');
    expect(result.stderr).toContain('missing required property "answer"');
  });

  it('rejects a non-JSON final assistant response with --output-schema', async () => {
    const schemaPath = writeSchema({ type: 'object' });
    const result = await runWithResponse('not JSON', ['--output-schema', schemaPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Output schema validation failed');
    expect(result.stderr).toContain('not valid JSON');
  });

  it('does not alter the output file when combined validation fails', async () => {
    const target = path.join(tempDir, 'answer.txt');
    const originalContent = 'preserve this content';
    fs.writeFileSync(target, originalContent);
    const schemaPath = writeSchema({
      type: 'object',
      required: ['answer'],
      properties: { answer: { type: 'string' } },
    });
    const result = await runWithResponse('{"other":"value"}', [
      '-o',
      target,
      '--output-schema',
      schemaPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(fs.readFileSync(target, 'utf8')).toBe(originalContent);
  });

  it('fails with code 1 for an invalid schema file', async () => {
    const schemaPath = path.join(tempDir, 'invalid-schema.json');
    fs.writeFileSync(schemaPath, '{ invalid json');
    const result = await runWithResponse(responseText, ['--output-schema', schemaPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Failed to load or parse schema');
  });
});
