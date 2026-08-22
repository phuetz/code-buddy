import fs from 'fs';
import os from 'os';
import path from 'path';
import { CronScheduler, type CronJob, type JobRun } from '../../src/scheduler/cron-scheduler.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cron-chain-data-test-'));
}

describe('CronScheduler cross-job data passing', () => {
  let tmpDir: string;
  let scheduler: CronScheduler;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    scheduler = new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });
    await scheduler.loadFromDisk();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // ── outputData extraction ────────────────────────────────────────────

  it('captures outputData from executor result with `output` field', async () => {
    scheduler.setTaskExecutor(async () => {
      return { output: 'hello from parent' };
    });

    const job = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce data' },
    });

    const run = await scheduler.runJobNow(job.id);
    expect(run).not.toBeNull();
    expect(run!.outputData).toBe('hello from parent');
  });

  it('captures outputData from executor result with `outputData` field (takes precedence)', async () => {
    scheduler.setTaskExecutor(async () => {
      return { output: 'combined', outputData: 'structured data only' };
    });

    const job = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce data' },
    });

    const run = await scheduler.runJobNow(job.id);
    expect(run!.outputData).toBe('structured data only');
  });

  it('captures outputData from string executor result', async () => {
    scheduler.setTaskExecutor(async () => {
      return 'plain string result';
    });

    const job = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce data' },
    });

    const run = await scheduler.runJobNow(job.id);
    expect(run!.outputData).toBe('plain string result');
  });

  it('JSON-stringifies non-string/non-output objects as outputData', async () => {
    scheduler.setTaskExecutor(async () => {
      return { count: 42, items: ['a', 'b'] };
    });

    const job = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce data' },
    });

    const run = await scheduler.runJobNow(job.id);
    expect(run!.outputData).toBe(JSON.stringify({ count: 42, items: ['a', 'b'] }));
  });

  it('returns undefined outputData for null/undefined executor result', async () => {
    scheduler.setTaskExecutor(async () => {
      return null;
    });

    const job = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce data' },
    });

    const run = await scheduler.runJobNow(job.id);
    expect(run!.outputData).toBeUndefined();
  });

  // ── outputData truncation ────────────────────────────────────────────

  it('truncates outputData to 64KB', async () => {
    const bigOutput = 'x'.repeat(100_000);
    scheduler.setTaskExecutor(async () => {
      return { output: bigOutput };
    });

    const job = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce big data' },
    });

    const run = await scheduler.runJobNow(job.id);
    expect(run!.outputData).toHaveLength(65_536);
  });

  // ── cross-job data passing via chains ────────────────────────────────

  it('passes outputData from parent to child as inputData', async () => {
    let receivedInputData: string | undefined;

    scheduler.setTaskExecutor(async (job: CronJob, inputData?: string) => {
      if (job.name === 'consumer') {
        receivedInputData = inputData;
      }
      return { output: `result from ${job.name}` };
    });

    const consumer = await scheduler.addJob({
      name: 'consumer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'consume data' },
    });

    const producer = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce data' },
      then: consumer.id,
    });

    await scheduler.runJobNow(producer.id);

    expect(receivedInputData).toBe('result from producer');
  });

  it('records inputData in the chained job run history', async () => {
    scheduler.setTaskExecutor(async (job: CronJob) => {
      return { output: `data from ${job.name}` };
    });

    const consumer = await scheduler.addJob({
      name: 'consumer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'consume' },
    });

    const producer = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce' },
      then: consumer.id,
    });

    await scheduler.runJobNow(producer.id);

    const consumerHistory = await scheduler.getRunHistory(consumer.id);
    expect(consumerHistory).toHaveLength(1);
    expect(consumerHistory[0]!.inputData).toBe('data from producer');
  });

  it('does not pass inputData when parent outputData is undefined', async () => {
    let receivedInputData: string | undefined = 'SENTINEL';

    scheduler.setTaskExecutor(async (job: CronJob, inputData?: string) => {
      if (job.name === 'consumer') {
        receivedInputData = inputData;
      }
      return null; // no outputData
    });

    const consumer = await scheduler.addJob({
      name: 'consumer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'consume' },
    });

    const producer = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce' },
      then: consumer.id,
    });

    await scheduler.runJobNow(producer.id);

    // inputData should be undefined (not the sentinel)
    expect(receivedInputData).toBeUndefined();
  });

  it('does not pass data when the parent job fails', async () => {
    let receivedInputData: string | undefined = 'SENTINEL';

    scheduler.setTaskExecutor(async (job: CronJob, inputData?: string) => {
      if (job.name === 'consumer') {
        receivedInputData = inputData;
      }
      if (job.name === 'producer') {
        throw new Error('producer failed');
      }
      return { output: 'should not reach' };
    });

    const consumer = await scheduler.addJob({
      name: 'consumer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'consume' },
    });

    const producer = await scheduler.addJob({
      name: 'producer',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'produce' },
      then: consumer.id,
    });

    await scheduler.runJobNow(producer.id);

    // Consumer should not have run, so sentinel remains
    expect(receivedInputData).toBe('SENTINEL');
  });

  // ── three-job chain: A → B → C ──────────────────────────────────────

  it('passes data through a three-job chain (A → B → C)', async () => {
    const received: Record<string, string | undefined> = {};

    scheduler.setTaskExecutor(async (job: CronJob, inputData?: string) => {
      received[job.name] = inputData;
      return { output: `${inputData ?? 'start'} → ${job.name}` };
    });

    const c = await scheduler.addJob({
      name: 'C',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'c' },
    });
    const b = await scheduler.addJob({
      name: 'B',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'b' },
      then: c.id,
    });
    const a = await scheduler.addJob({
      name: 'A',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'a' },
      then: b.id,
    });

    await scheduler.runJobNow(a.id);

    expect(received['A']).toBeUndefined(); // A has no parent
    expect(received['B']).toBe('start → A'); // B gets A's output
    expect(received['C']).toBe('start → A → B'); // C gets B's output
  });

  // ── runJobNow with explicit inputData ────────────────────────────────

  it('runJobNow accepts inputData for manual invocation', async () => {
    let receivedInputData: string | undefined;

    scheduler.setTaskExecutor(async (_job: CronJob, inputData?: string) => {
      receivedInputData = inputData;
      return { output: 'done' };
    });

    const job = await scheduler.addJob({
      name: 'manual',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'run' },
    });

    const run = await scheduler.runJobNow(job.id, 'injected data');

    expect(receivedInputData).toBe('injected data');
    expect(run!.inputData).toBe('injected data');
  });

  // ── extractOutputData static method ──────────────────────────────────

  describe('extractOutputData', () => {
    it('returns undefined for null', () => {
      expect(CronScheduler.extractOutputData(null)).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(CronScheduler.extractOutputData(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(CronScheduler.extractOutputData('')).toBeUndefined();
    });

    it('returns the string for a string result', () => {
      expect(CronScheduler.extractOutputData('hello')).toBe('hello');
    });

    it('prefers outputData over output', () => {
      expect(CronScheduler.extractOutputData({ output: 'a', outputData: 'b' })).toBe('b');
    });

    it('falls back to output when no outputData', () => {
      expect(CronScheduler.extractOutputData({ output: 'a' })).toBe('a');
    });

    it('JSON-stringifies objects without output/outputData', () => {
      expect(CronScheduler.extractOutputData({ x: 1 })).toBe('{"x":1}');
    });

    it('truncates to 64KB', () => {
      const big = 'y'.repeat(100_000);
      expect(CronScheduler.extractOutputData(big)).toHaveLength(65_536);
    });

    it('returns string for number result', () => {
      expect(CronScheduler.extractOutputData(42)).toBe('42');
    });
  });
});
