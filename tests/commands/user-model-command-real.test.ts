import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = path.join(repoRoot, 'src', 'index.ts');

let tempWorkDir: string;
let sessionsDir: string;

interface AnalyzeObservationJson {
  content: string;
  status: string;
}

interface AnalyzeJson {
  mode: string;
  sessionId: string;
  count: number;
  observations: AnalyzeObservationJson[];
}

function runBuddyJson(args: string[]): unknown {
  const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd: tempWorkDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEBUDDY_SESSIONS_DIR: sessionsDir,
      FORCE_COLOR: '0',
      HOME: tempWorkDir,
      NO_COLOR: '1',
      USERPROFILE: tempWorkDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    windowsHide: true,
  });

  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toMatch(/^(?:\{|\[)/);
  return JSON.parse(result.stdout);
}

async function writeSession(sessionId: string): Promise<void> {
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify({
    id: sessionId,
    name: 'Local user-model inference proof',
    workingDirectory: tempWorkDir,
    model: 'real-session-model',
    messages: [
      {
        type: 'user',
        content: 'fais des tests reels, je ne veux plus de mocks',
        timestamp: '2026-05-31T19:00:00.000Z',
      },
      {
        type: 'assistant',
        content: 'Je vais verifier avec de vrais chemins CLI.',
        timestamp: '2026-05-31T19:01:00.000Z',
      },
      {
        type: 'user',
        content: 'continue en mode autonome toutes les 10 minutes puis commit et push',
        timestamp: '2026-05-31T19:02:00.000Z',
      },
    ],
    createdAt: '2026-05-31T19:00:00.000Z',
    lastAccessedAt: '2026-05-31T19:02:00.000Z',
  }, null, 2));
}

describe('buddy user-model analyze real CLI path', () => {
  beforeEach(async () => {
    tempWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-user-model-real-'));
    sessionsDir = path.join(tempWorkDir, 'sessions');
  });

  afterEach(async () => {
    await fs.rm(tempWorkDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('proposes local observations from a real session JSON without accepting them', async () => {
    const sessionId = 'session-local-inference';
    await writeSession(sessionId);

    const firstRun = runBuddyJson(['user-model', 'analyze', '--session', sessionId, '--local', '--json']) as AnalyzeJson;

    expect(firstRun.mode).toBe('local');
    expect(firstRun.sessionId).toBe(sessionId);
    expect(firstRun.count).toBe(4);
    expect(firstRun.observations.map((obs) => obs.content)).toEqual([
      'Prefers real verification paths over mocks for completion evidence.',
      'Prefers autonomous continuation with concise periodic progress when the task is clear.',
      'Wants useful verified changes committed and pushed after completion.',
      'Prefers French for collaboration updates.',
    ]);
    expect(firstRun.observations.every((obs) => obs.status === 'pending')).toBe(true);

    const modelFile = path.join(tempWorkDir, '.codebuddy', 'user-model.json');
    const model = JSON.parse(await fs.readFile(modelFile, 'utf8'));
    expect(model.observations).toHaveLength(4);
    expect(model.observations.every((obs: { status: string }) => obs.status === 'pending')).toBe(true);

    const secondRun = runBuddyJson(['user-model', 'analyze', '--session', sessionId, '--local', '--json']) as AnalyzeJson;
    expect(secondRun.count).toBe(0);

    const accepted = runBuddyJson(['user-model', 'show', '--json']) as unknown[];
    expect(accepted).toEqual([]);
  });
});
