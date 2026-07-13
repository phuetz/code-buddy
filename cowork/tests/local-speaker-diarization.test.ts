import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSpeakerDiarizer } from '../src/main/meeting/local-speaker-diarization';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalSpeakerDiarizer', () => {
  it('fails the capability probe honestly when local models are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diarization-missing-'));
    roots.push(root);
    const diarizer = new LocalSpeakerDiarizer({
      segmentationModel: join(root, 'missing-segmentation.onnx'),
      embeddingModel: join(root, 'missing-embedding.onnx'),
    });

    await expect(diarizer.probe()).resolves.toMatchObject({
      available: false,
      provider: 'sherpa-onnx',
    });
  });

  it('runs the bounded ffmpeg→Sherpa worker contract and validates speaker turns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diarization-worker-'));
    roots.push(root);
    const segmentation = join(root, 'segmentation.onnx');
    const embedding = join(root, 'embedding.onnx');
    const audio = join(root, 'audio.webm');
    const python = join(root, 'python');
    const ffmpeg = join(root, 'ffmpeg');
    await Promise.all([
      writeFile(segmentation, 'model', { mode: 0o600 }),
      writeFile(embedding, 'model', { mode: 0o600 }),
      writeFile(audio, 'audio', { mode: 0o600 }),
      writeFile(python, `#!/bin/sh
if [ "$#" -eq 2 ]; then
  echo 1.13.3
else
  echo '{"segments":[{"startSeconds":0,"endSeconds":1.5,"speaker":0},{"startSeconds":1.5,"endSeconds":3,"speaker":1}],"speakerCount":2}'
fi
`, { mode: 0o700 }),
      writeFile(ffmpeg, `#!/bin/sh
if [ "$1" = "-version" ]; then
  echo ffmpeg-test
  exit 0
fi
for last do :; done
: > "$last"
`, { mode: 0o700 }),
    ]);
    await Promise.all([chmod(python, 0o700), chmod(ffmpeg, 0o700)]);
    const diarizer = new LocalSpeakerDiarizer({
      python,
      ffmpeg,
      segmentationModel: segmentation,
      embeddingModel: embedding,
      timeoutMs: 5_000,
    });

    await expect(diarizer.probe()).resolves.toMatchObject({ available: true });
    await expect(diarizer.diarize(audio)).resolves.toEqual({
      segments: [
        { startSeconds: 0, endSeconds: 1.5, speaker: 0 },
        { startSeconds: 1.5, endSeconds: 3, speaker: 1 },
      ],
      speakerCount: 2,
    });
  });
});
