import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectObjectsInImage: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/tools/vision/object-detection.js', () => ({
  detectObjectsInImage: mocks.detectObjectsInImage,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: mocks.logger,
}));

import { createVisionTrainCommand } from '../../src/commands/vision-train.js';

describe('buddy vision-train labeled folder mode', () => {
  const previousOptIn = process.env.CODEBUDDY_VISION_TRAIN;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-train-labels-'));
    process.env.CODEBUDDY_VISION_TRAIN = 'true';
    process.exitCode = 0;
    vi.clearAllMocks();
    mocks.detectObjectsInImage.mockResolvedValue({
      summary: { countsByLabel: { person: 1 } },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    if (previousOptIn === undefined) delete process.env.CODEBUDDY_VISION_TRAIN;
    else process.env.CODEBUDDY_VISION_TRAIN = previousOptIn;
    process.exitCode = 0;
  });

  it('filters a partial label map and emits one aggregate warning', async () => {
    const imagesDir = path.join(tempDir, 'images');
    const labelsPath = path.join(tempDir, 'labels.json');
    await fs.mkdir(imagesDir);
    await Promise.all([
      fs.writeFile(path.join(imagesDir, 'labeled.jpg'), ''),
      fs.writeFile(path.join(imagesDir, 'missing.jpg'), ''),
      fs.writeFile(labelsPath, JSON.stringify({ 'labeled.jpg': { person: 1 } })),
    ]);

    const cmd = createVisionTrainCommand();
    cmd.exitOverride();
    await cmd.parseAsync(
      ['--images', imagesDir, '--labels', labelsPath, '--out', path.join(tempDir, 'reports')],
      { from: 'user' },
    );

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalledWith('1 image ignored — no ground-truth label.');
    expect(mocks.detectObjectsInImage).toHaveBeenCalledTimes(1);
    expect(mocks.detectObjectsInImage).toHaveBeenCalledWith(
      expect.objectContaining({ imagePath: path.join(imagesDir, 'labeled.jpg') }),
      expect.any(Object),
    );
    expect(process.exitCode).toBe(0);
  });

  it('--strict fails before perception when any image has no label entry', async () => {
    const imagesDir = path.join(tempDir, 'images');
    const labelsPath = path.join(tempDir, 'labels.json');
    await fs.mkdir(imagesDir);
    await Promise.all([
      fs.writeFile(path.join(imagesDir, 'labeled.jpg'), ''),
      fs.writeFile(path.join(imagesDir, 'missing.jpg'), ''),
      fs.writeFile(labelsPath, JSON.stringify({ 'labeled.jpg': { person: 1 } })),
    ]);

    const cmd = createVisionTrainCommand();
    cmd.exitOverride();
    await cmd.parseAsync(
      ['--images', imagesDir, '--labels', labelsPath, '--strict', '--out', path.join(tempDir, 'reports')],
      { from: 'user' },
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.detectObjectsInImage).not.toHaveBeenCalled();
    expect(mocks.logger.warn).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      '1 image ignored — no ground-truth label. Aborting because --strict requires ground truth for every image.',
    );
  });

  it('documents --strict in command help', () => {
    expect(createVisionTrainCommand().helpInformation()).toContain('--strict');
  });
});
