import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import {
  runAssistantRuntimeDoctor,
  type AssistantRepairState,
  type AssistantRepairStateStore,
} from '../../src/doctor/assistant-runtime.js';

describe('assistant runtime doctor systemctl boundary', () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    execFileMock.mockReset();
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  });

  it('uses only systemctl --user on allowlisted units and passes a secret-free environment', async () => {
    process.env.OPENAI_API_KEY = 'must-not-reach-systemctl';
    execFileMock.mockImplementation(
      (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        if (args.includes('is-active')) callback(new Error('inactive'), 'inactive\n');
        else if (args.includes('show')) callback(null, 'loaded\n');
        else callback(null, '');
      },
    );

    let state: AssistantRepairState = { version: 1, attempts: [] };
    const stateStore: AssistantRepairStateStore = {
      read: vi.fn(async () => structuredClone(state)),
      write: vi.fn(async (next) => {
        state = structuredClone(next);
      }),
    };
    const report = await runAssistantRuntimeDoctor(
      { repair: true },
      {
        fetchImpl: vi.fn(async () => ({ ok: true, status: 200 })),
        tcpProbe: vi.fn(async () => true),
        repairStateStore: stateStore,
        now: () => 100_000,
        platform: 'linux',
      },
    );

    expect(report.repair.attempts).toHaveLength(3);
    const restartUnits: string[] = [];
    for (const call of execFileMock.mock.calls) {
      const [file, args, options] = call as [
        string,
        string[],
        { env: Record<string, string | undefined> },
      ];
      expect(file).toBe('systemctl');
      expect(args[0]).toBe('--user');
      expect(args.join(' ')).not.toContain('sudo');
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      if (args.includes('restart')) restartUnits.push(String(args.at(-1)));
    }
    expect(restartUnits.sort()).toEqual([
      'buddy-sense.service',
      'buddy-vision-eye.service',
      'lisa-telegram.service',
    ]);
  });
});
