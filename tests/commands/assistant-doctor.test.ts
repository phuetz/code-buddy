import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doctorMocks = vi.hoisted(() => {
  const report = {
    kind: 'assistant_runtime_doctor',
    generatedAt: '2026-07-12T00:00:00.000Z',
    status: 'healthy',
    summary: { healthy: 8, unhealthy: 0, unknown: 0, total: 8 },
    probes: [],
    repair: {
      requested: false,
      candidates: [],
      attempts: [],
      skipped: [],
      policy: { cooldownMs: 300000, maxPerRun: 3, maxPerWindow: 6, windowMs: 3600000 },
    },
  };
  return {
    report,
    runAssistantRuntimeDoctor: vi.fn(async () => report),
    formatAssistantRuntimeDoctorReport: vi.fn(() => 'formatted assistant doctor'),
  };
});

vi.mock('../../src/doctor/assistant-runtime.js', () => ({
  runAssistantRuntimeDoctor: doctorMocks.runAssistantRuntimeDoctor,
  formatAssistantRuntimeDoctorReport: doctorMocks.formatAssistantRuntimeDoctorReport,
}));

import { registerAssistantCommand } from '../../src/commands/assistant.js';

async function runAssistantDoctor(...args: string[]): Promise<string> {
  const program = new Command();
  const output: string[] = [];
  program.exitOverride();
  registerAssistantCommand(program);
  const logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
    output.push(String(value ?? ''));
  });
  try {
    await program.parseAsync(['node', 'test', 'assistant', 'doctor', ...args]);
  } finally {
    logSpy.mockRestore();
  }
  return output.join('\n');
}

describe('buddy assistant doctor command', () => {
  beforeEach(() => {
    doctorMocks.runAssistantRuntimeDoctor.mockClear();
    doctorMocks.formatAssistantRuntimeDoctorReport.mockClear();
  });

  it('is safe/read-only by default and formats a human report', async () => {
    expect(await runAssistantDoctor()).toBe('formatted assistant doctor');
    expect(doctorMocks.runAssistantRuntimeDoctor).toHaveBeenCalledWith({ repair: false });
    expect(doctorMocks.formatAssistantRuntimeDoctorReport).toHaveBeenCalledWith(doctorMocks.report);
  });

  it('emits machine-readable JSON', async () => {
    const output = JSON.parse(await runAssistantDoctor('--json')) as {
      kind: string;
      summary: { total: number };
    };
    expect(output.kind).toBe('assistant_runtime_doctor');
    expect(output.summary.total).toBe(8);
    expect(doctorMocks.formatAssistantRuntimeDoctorReport).not.toHaveBeenCalled();
  });

  it('requires the explicit --repair flag before enabling repairs', async () => {
    await runAssistantDoctor('--repair', '--json');
    expect(doctorMocks.runAssistantRuntimeDoctor).toHaveBeenCalledWith({ repair: true });
  });
});
