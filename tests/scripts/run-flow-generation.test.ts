import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FlowCreditBudgetError,
  planFlowRun,
  runFlowGeneration,
  type FlowGenerationDriver,
} from '../../scripts/trailers/run-flow-generation.js';
import {
  createGoogleFlowHandoff,
  type GoogleFlowHandoff,
} from '../../src/tools/video/google-flow-handoff.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-runner-'));
  temporaryDirectories.push(directory);
  return directory;
}

function handoff(jobCount = 2): GoogleFlowHandoff {
  return createGoogleFlowHandoff(
    Array.from({ length: jobCount }, (_, index) => ({
      id: `trailer-shot-${index + 1}`,
      characterName: 'Mara',
      declaredAdultAge: 31,
      sourcePath: `/approved/mara-${index + 1}.png`,
      sourceSha256: String(index + 1).repeat(64),
      motionPrompt: `Cinematic movement ${index + 1}`,
      role: index === 0 ? 'hero' as const : 'b-roll' as const,
      consumerShortIds: [`trailer-${index + 1}`],
      consumers: [{ shortId: `trailer-${index + 1}`, shotIndex: index + 1 }],
    })),
    {
      sourcePlanSha256: 'f'.repeat(64),
      batchId: 'flow-runner-test',
      model: 'fast',
      locale: 'fr-FR',
      durationSeconds: 8,
      aspectRatio: '16:9',
      upscale4k: false,
      capacity: {
        darkstar: true,
        ministar: true,
        googleFlow: true,
        remainingFlowCredits: 1_000,
        maxFlowCreditsPerBatch: 1_000,
      },
    },
  );
}

class FakeDriver implements FlowGenerationDriver {
  readonly verifyReady = vi.fn(async () => undefined);
  readonly setModel = vi.fn(async () => undefined);
  readonly setAspect = vi.fn(async () => undefined);
  readonly setIngredients = vi.fn(async () => undefined);
  readonly submitPrompt = vi.fn(async () => undefined);
  readonly downloadResult = vi.fn(async (destination: string) => {
    await fs.writeFile(destination, `mp4:${path.basename(destination)}`);
  });
  private balanceIndex = 0;

  constructor(private readonly balances: number[]) {}

  readonly readCreditBalance = vi.fn(async () => {
    const balance = this.balances[this.balanceIndex] ?? this.balances.at(-1);
    this.balanceIndex += 1;
    if (balance === undefined) throw new Error('fake balance missing');
    return balance;
  });
}

function bytes(value: GoogleFlowHandoff): Buffer {
  return Buffer.from(JSON.stringify(value));
}

describe('budget-gated Google Flow runner', () => {
  it('plans deterministic result paths, prompt hashes, model and aspect', () => {
    const packet = handoff(2);
    const plan = planFlowRun(packet, {
      resultsDirectory: '/tmp/flow-results',
      model: 'quality',
      maxCredits: 200,
    });

    expect(plan).toMatchObject({
      model: 'quality',
      driverModel: 'veo-3.1-quality',
      aspect: '16:9',
      estimatedCredits: 200,
      maxCredits: 200,
    });
    expect(plan.jobs.map((job) => path.basename(job.destination))).toEqual([
      'trailer-shot-1.mp4',
      'trailer-shot-2.mp4',
    ]);
    expect(plan.jobs[0]?.promptSha256).toBe(
      createHash('sha256').update(packet.jobs[0]!.prompt).digest('hex'),
    );
  });

  it('downloads, journals every result and invokes the fail-closed import at the end', async () => {
    const root = await temporaryDirectory();
    const resultsDirectory = path.join(root, 'results');
    const packet = handoff(2);
    const driver = new FakeDriver([100, 100, 90, 90, 80]);
    const importResults = vi.fn(async () => ({ status: 'pending-human-review' }));

    const result = await runFlowGeneration(packet, bytes(packet), {
      handoffPath: path.join(root, 'handoff.json'),
      resultsDirectory,
      model: 'fast',
      maxCredits: 20,
    }, {
      attach: async () => ({ driver }),
      importResults,
      now: () => new Date('2026-07-21T12:34:56.789Z'),
      writeOutput: vi.fn(),
    });

    expect(result).toMatchObject({ spentCredits: 20, completedJobs: 2, initialCreditBalance: 100 });
    expect(driver.submitPrompt).toHaveBeenCalledTimes(2);
    expect(driver.downloadResult).toHaveBeenCalledTimes(2);
    expect(importResults).toHaveBeenCalledTimes(1);
    expect(importResults.mock.calls[0]?.[0]).toMatchObject({
      handoff: packet,
      resultsRoot: resultsDirectory,
      outputRoot: path.join(root, 'imported'),
    });
    const log = (await fs.readFile(result.logPath!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as {
      jobId: string;
      creditsBefore: number;
      creditsAfter: number;
      sha256: string;
    });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ jobId: 'trailer-shot-1', creditsBefore: 100, creditsAfter: 90 });
    expect(log[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('stops before the first job that would exceed max credits and skips import', async () => {
    const root = await temporaryDirectory();
    const packet = handoff(2);
    const driver = new FakeDriver([100, 100, 90]);
    const importResults = vi.fn(async () => ({}));
    const records: string[] = [];

    await expect(runFlowGeneration(packet, bytes(packet), {
      handoffPath: path.join(root, 'handoff.json'),
      resultsDirectory: path.join(root, 'results'),
      maxCredits: 10,
    }, {
      attach: async () => ({ driver }),
      importResults,
      appendLog: async (_filename, record) => { records.push(record.jobId); },
      writeOutput: vi.fn(),
    })).rejects.toBeInstanceOf(FlowCreditBudgetError);

    expect(driver.submitPrompt).toHaveBeenCalledTimes(1);
    expect(records).toEqual(['trailer-shot-1']);
    expect(importResults).not.toHaveBeenCalled();
  });

  it('refuses an insufficient preflight balance before submit', async () => {
    const root = await temporaryDirectory();
    const packet = handoff(2);
    const driver = new FakeDriver([19]);

    await expect(runFlowGeneration(packet, bytes(packet), {
      handoffPath: path.join(root, 'handoff.json'),
      resultsDirectory: path.join(root, 'results'),
      maxCredits: 20,
    }, {
      attach: async () => ({ driver }),
      writeOutput: vi.fn(),
    })).rejects.toThrow(/insufficient/i);
    expect(driver.submitPrompt).not.toHaveBeenCalled();
  });

  it('dry-runs selectors and budget without submitting, downloading or importing', async () => {
    const root = await temporaryDirectory();
    const packet = handoff(2);
    const driver = new FakeDriver([100]);
    const importResults = vi.fn(async () => ({}));

    const result = await runFlowGeneration(packet, bytes(packet), {
      handoffPath: path.join(root, 'handoff.json'),
      resultsDirectory: path.join(root, 'results'),
      maxCredits: 20,
      dryRun: true,
    }, {
      attach: async () => ({ driver }),
      importResults,
      writeOutput: vi.fn(),
    });

    expect(result).toMatchObject({ dryRun: true, spentCredits: 0, completedJobs: 0 });
    expect(driver.verifyReady).toHaveBeenCalledTimes(1);
    expect(driver.setModel).toHaveBeenCalledTimes(2);
    expect(driver.setAspect).toHaveBeenCalledTimes(2);
    expect(driver.setIngredients).toHaveBeenCalledTimes(2);
    expect(driver.submitPrompt).not.toHaveBeenCalled();
    expect(driver.downloadResult).not.toHaveBeenCalled();
    expect(importResults).not.toHaveBeenCalled();
  });
});
