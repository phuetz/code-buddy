import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResearchScriptJobArtifact } from '../../src/agent/research-script-job-artifact.js';
import { materializeResearchScriptJobArtifact } from '../../src/agent/research-script-job-materializer.js';
import { runMaterializedResearchScriptJob } from '../../src/agent/research-script-job-runner.js';

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  const nodeFs = await import('fs');
  const nodePath = await import('path');
  return {
    ...original,
    spawn: vi.fn((...args: any[]) => {
      const command = args[0];
      if (command === 'docker' || command === 'wsl' || command === 'daytona' || command === 'sandbox') {
        const commandArgs = args[1] as string[];
        const isDaytonaOutputDownload = command === 'daytona'
          && commandArgs[0] === 'exec'
          && commandArgs.includes('cat')
          && String(commandArgs.at(-1) ?? '').endsWith('/output.json');
        (globalThis as any).__lastSpawnArgs = args;
        (globalThis as any).__spawnCalls = [
          ...((globalThis as any).__spawnCalls ?? []),
          args,
        ];
        const mockChild: any = {
          stdout: {
            setEncoding: vi.fn(),
            on: vi.fn((event, callback) => {
              if (event === 'data' && isDaytonaOutputDownload) {
                setTimeout(() => callback(JSON.stringify({ ok: true, provider: 'daytona' }, null, 2)), 0);
              }
            }),
          },
          stderr: { setEncoding: vi.fn(), on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') {
              if (command === 'sandbox' && commandArgs[0] === 'copy' && /^[^:]+:\//.test(String(commandArgs[1] ?? ''))) {
                nodeFs.mkdirSync(nodePath.dirname(commandArgs[2]), { recursive: true });
                nodeFs.writeFileSync(commandArgs[2], JSON.stringify({ ok: true, provider: 'vercel-sandbox' }, null, 2));
              }
              setTimeout(() => callback(0, null), 10);
            }
          }),
          kill: vi.fn(),
        };
        return mockChild;
      }
      return original.spawn(args[0], args[1], args[2]);
    }),
  };
});

describe('research script job runner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-script-runner-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs a materialized local script with disabled network and captures artifacts', async () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-runner-demo',
      goal: 'Transform a local input fixture',
      title: 'Local fixture transform',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input fixture.' },
      outputContract: { OUTPUT_JSON: 'Output fixture.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'local',
        timeoutMs: 5000,
      },
    });
    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      inputData: { leads: [{ name: 'Atelier Demo' }] },
      scriptSource: [
        'const fs = require("fs");',
        'const input = JSON.parse(fs.readFileSync(process.env.INPUT_JSON, "utf8"));',
        'fs.writeFileSync(process.env.OUTPUT_JSON, JSON.stringify({ ok: true, input }, null, 2));',
        'console.log("processed", input.leads.length);',
      ].join('\n'),
    });

    const result = await runMaterializedResearchScriptJob(job, { rootDir: tempDir });

    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.outputStatus).toBe('written');
    expect(result.outputVerified).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(fs.readFileSync(result.stdoutPath, 'utf8')).toContain('processed 1');
    expect(JSON.parse(fs.readFileSync(result.outputPath, 'utf8'))).toMatchObject({
      ok: true,
      input: { leads: [{ name: 'Atelier Demo' }] },
    });
    expect(fs.readFileSync(result.summaryPath, 'utf8')).toContain('Status: completed');
  });

  it('refuses network-enabled jobs unless the caller opts in', async () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-network',
      goal: 'Network guard',
      title: 'Network guard',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
    });
    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("should not run");',
    });

    await expect(runMaterializedResearchScriptJob(job, { rootDir: tempDir }))
      .rejects
      .toThrow('requires network policy');
  });

  it('marks long-running scripts as timed out and writes logs', async () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-timeout',
      goal: 'Timeout guard',
      title: 'Timeout guard',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'local',
        timeoutMs: 1000,
      },
    });
    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("started"); setTimeout(() => {}, 5000);',
    });

    const result = await runMaterializedResearchScriptJob(job, {
      rootDir: tempDir,
      timeoutMs: 1000,
    });

    expect(result.status).toBe('timed_out');
    expect(result.outputStatus).toBe('placeholder');
    expect(result.outputVerified).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(fs.readFileSync(result.stdoutPath, 'utf8')).toContain('started');
    expect(fs.readFileSync(result.summaryPath, 'utf8')).toContain('Status: timed_out');
  });

  it('translates command and arguments correctly for docker provider', async () => {
    (globalThis as any).__lastSpawnArgs = null;
    (globalThis as any).__spawnCalls = [];

    const job = buildResearchScriptJobArtifact({
      id: 'research-script-docker-test',
      goal: 'Docker run test',
      title: 'Docker run test',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'docker',
        timeoutMs: 5000,
      },
    });

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("docker run");',
    });

    const result = await runMaterializedResearchScriptJob(job, { rootDir: tempDir });

    const spawnCall = (globalThis as any).__lastSpawnArgs;
    expect(spawnCall).toBeTruthy();
    expect(spawnCall[0]).toBe('docker');
    expect(spawnCall[1]).toContain('run');
    expect(spawnCall[1]).toContain('--rm');
    expect(spawnCall[1]).toContain('--network');
    expect(spawnCall[1]).toContain('none');
    expect(spawnCall[1]).toContain('node:20');

    expect(result.status).toBe('completed');
    expect(result.outputStatus).toBe('placeholder');
    expect(result.outputVerified).toBe(false);
  });

  it('translates command, paths, and arguments correctly for wsl provider', async () => {
    (globalThis as any).__lastSpawnArgs = null;
    (globalThis as any).__spawnCalls = [];

    const job = buildResearchScriptJobArtifact({
      id: 'research-script-wsl-test',
      goal: 'WSL run test',
      title: 'WSL run test',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'wsl',
        timeoutMs: 5000,
      },
    });

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("wsl run");',
    });

    const result = await runMaterializedResearchScriptJob(job, { rootDir: tempDir });

    const spawnCall = (globalThis as any).__lastSpawnArgs;
    expect(spawnCall).toBeTruthy();
    expect(spawnCall[0]).toBe('wsl');
    expect(spawnCall[1]).toContain('--cd');
    expect(spawnCall[1]).toContain('--exec');
    expect(spawnCall[1]).toContain('env');

    expect(result.status).toBe('completed');
    expect(result.outputStatus).toBe('placeholder');
    expect(result.outputVerified).toBe(false);
  });

  it('translates command and arguments correctly for legacy remote provider (daytona alias)', async () => {
    (globalThis as any).__lastSpawnArgs = null;
    (globalThis as any).__spawnCalls = [];

    const job = buildResearchScriptJobArtifact({
      id: 'research-script-remote-test',
      goal: 'Remote run test',
      title: 'Remote run test',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'remote',
        target: 'sandbox-legacy-remote-target',
        timeoutMs: 5000,
      },
    });

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("remote run");',
    });

    const result = await runMaterializedResearchScriptJob(job, { rootDir: tempDir });

    const spawnCalls = (globalThis as any).__spawnCalls as any[][];
    expect(spawnCalls).toHaveLength(5);
    expect(spawnCalls.every((call) => call[0] === 'daytona')).toBe(true);
    expect(spawnCalls[0][1]).toEqual([
      'exec',
      '-w',
      'sandbox-legacy-remote-target',
      '--',
      'mkdir',
      '-p',
      'codebuddy-research/research-script-remote-test',
    ]);
    expect(spawnCalls[1][1]).toEqual(expect.arrayContaining([
      'exec',
      '-w',
      'sandbox-legacy-remote-target',
      '--',
      'sh',
      '-lc',
      expect.stringContaining("cat > 'codebuddy-research/research-script-remote-test/script.js'"),
    ]));
    expect(spawnCalls[2][1]).toEqual(expect.arrayContaining([
      'exec',
      '-w',
      'sandbox-legacy-remote-target',
      '--',
      'sh',
      '-lc',
      expect.stringContaining("cat > 'codebuddy-research/research-script-remote-test/input.json'"),
    ]));
    expect(spawnCalls[3][1]).toContain('env');
    expect(spawnCalls[3][1]).toContain('INPUT_JSON=codebuddy-research/research-script-remote-test/input.json');
    expect(spawnCalls[3][1]).toContain('OUTPUT_JSON=codebuddy-research/research-script-remote-test/output.json');
    expect(spawnCalls[3][1]).toContain('codebuddy-research/research-script-remote-test/script.js');
    expect(spawnCalls[4][1]).toEqual([
      'exec',
      '-w',
      'sandbox-legacy-remote-target',
      '--',
      'cat',
      'codebuddy-research/research-script-remote-test/output.json',
    ]);

    expect(result.status).toBe('completed');
    expect(result.outputStatus).toBe('written');
    expect(result.outputVerified).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.outputPath, 'utf8'))).toMatchObject({
      ok: true,
      provider: 'daytona',
    });
  });

  it('translates command and arguments correctly for named daytona provider', async () => {
    (globalThis as any).__lastSpawnArgs = null;
    (globalThis as any).__spawnCalls = [];

    const job = buildResearchScriptJobArtifact({
      id: 'research-script-daytona-test',
      goal: 'Named Daytona run test',
      title: 'Named Daytona run test',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'daytona',
        target: 'sandbox-daytona-target',
        timeoutMs: 5000,
      },
    });

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("daytona run");',
    });

    const result = await runMaterializedResearchScriptJob(job, { rootDir: tempDir });

    const spawnCalls = (globalThis as any).__spawnCalls as any[][];
    expect(spawnCalls).toHaveLength(5);
    expect(spawnCalls.every((call) => call[0] === 'daytona')).toBe(true);
    expect(spawnCalls[0][1]).toEqual([
      'exec',
      '-w',
      'sandbox-daytona-target',
      '--',
      'mkdir',
      '-p',
      'codebuddy-research/research-script-daytona-test',
    ]);
    expect(spawnCalls[1][1]).toEqual(expect.arrayContaining([
      'exec',
      '-w',
      'sandbox-daytona-target',
      '--',
      'sh',
      '-lc',
      expect.stringContaining("cat > 'codebuddy-research/research-script-daytona-test/script.js'"),
    ]));
    expect(spawnCalls[2][1]).toEqual(expect.arrayContaining([
      'exec',
      '-w',
      'sandbox-daytona-target',
      '--',
      'sh',
      '-lc',
      expect.stringContaining("cat > 'codebuddy-research/research-script-daytona-test/input.json'"),
    ]));
    expect(spawnCalls[3][1]).toContain('env');
    expect(spawnCalls[3][1]).toContain('INPUT_JSON=codebuddy-research/research-script-daytona-test/input.json');
    expect(spawnCalls[3][1]).toContain('OUTPUT_JSON=codebuddy-research/research-script-daytona-test/output.json');
    expect(spawnCalls[3][1]).toContain('codebuddy-research/research-script-daytona-test/script.js');
    expect(spawnCalls[4][1]).toEqual([
      'exec',
      '-w',
      'sandbox-daytona-target',
      '--',
      'cat',
      'codebuddy-research/research-script-daytona-test/output.json',
    ]);

    expect(result.status).toBe('completed');
    expect(result.outputStatus).toBe('written');
    expect(result.outputVerified).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.outputPath, 'utf8'))).toMatchObject({
      ok: true,
      provider: 'daytona',
    });
  });

  it('translates command and arguments correctly for vercel sandbox provider', async () => {
    (globalThis as any).__lastSpawnArgs = null;
    (globalThis as any).__spawnCalls = [];

    const job = buildResearchScriptJobArtifact({
      id: 'research-script-vercel-test',
      goal: 'Vercel Sandbox run test',
      title: 'Vercel Sandbox run test',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
        provider: 'vercel-sandbox',
        target: 'sb_research_script_vercel_test',
        timeoutMs: 5000,
      },
    });

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("vercel sandbox run");',
    });

    const result = await runMaterializedResearchScriptJob(job, { rootDir: tempDir });

    const spawnCalls = (globalThis as any).__spawnCalls as any[][];
    expect(spawnCalls).toHaveLength(5);
    expect(spawnCalls.every((call) => call[0] === 'sandbox')).toBe(true);
    expect(spawnCalls[0][1]).toEqual([
      'exec',
      'sb_research_script_vercel_test',
      'mkdir',
      '-p',
      '/home/sandbox/codebuddy-research/research-script-vercel-test',
    ]);
    expect(spawnCalls[1][1]).toEqual(expect.arrayContaining([
      'copy',
      expect.stringContaining('script.js'),
      'sb_research_script_vercel_test:/home/sandbox/codebuddy-research/research-script-vercel-test/script.js',
    ]));
    expect(spawnCalls[2][1]).toEqual(expect.arrayContaining([
      'copy',
      expect.stringContaining('input.json'),
      'sb_research_script_vercel_test:/home/sandbox/codebuddy-research/research-script-vercel-test/input.json',
    ]));
    expect(spawnCalls[3][1]).toEqual(expect.arrayContaining([
      'exec',
      '--workdir',
      '/home/sandbox/codebuddy-research/research-script-vercel-test',
      '--env',
      'INPUT_JSON=/home/sandbox/codebuddy-research/research-script-vercel-test/input.json',
      '--env',
      'OUTPUT_JSON=/home/sandbox/codebuddy-research/research-script-vercel-test/output.json',
      'sb_research_script_vercel_test',
      'node',
      '/home/sandbox/codebuddy-research/research-script-vercel-test/script.js',
    ]));
    expect(spawnCalls[4][1]).toEqual(expect.arrayContaining([
      'copy',
      'sb_research_script_vercel_test:/home/sandbox/codebuddy-research/research-script-vercel-test/output.json',
      expect.stringContaining('output.json'),
    ]));

    expect(result.status).toBe('completed');
    expect(result.outputStatus).toBe('written');
    expect(result.outputVerified).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.outputPath, 'utf8'))).toMatchObject({
      ok: true,
      provider: 'vercel-sandbox',
    });
  });
});
