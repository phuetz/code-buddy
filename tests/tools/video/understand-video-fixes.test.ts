import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createMultimodalTools } from '../../../src/tools/registry/multimodal-tools.js';
import { downloadAudioWav } from '../../../src/tools/video/media-fetch.js';
import { transcribeLong } from '../../../src/tools/video/long-transcribe.js';
import { understandVideo } from '../../../src/tools/video/video-understanding.js';

vi.mock('../../../src/tools/video/video-understanding.js', async () => {
  const actual = await vi.importActual('../../../src/tools/video/video-understanding.js');
  return {
    ...actual as object,
    understandVideo: vi.fn(),
  };
});

describe('video-understanding fixes', () => {
    describe('media-fetch stdio hanging issue', () => {
        it('properly consumes or ignores stdout to prevent process hanging', async () => {
            let spawnCallArgs: any[] = [];
            const fakeSpawn = ((_cmd: string, args: string[], options: any) => {
                spawnCallArgs = options.stdio;
                const child = new EventEmitter() as any;
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.kill = () => {};
                setImmediate(() => {
                    child.emit('close', 0);
                });
                return child;
            }) as any;

            await downloadAudioWav('https://youtu.be/dQw4w9WgXcQ', '/tmp', { spawn: fakeSpawn });
            expect(spawnCallArgs).toEqual(['ignore', 'ignore', 'pipe']);
        });
    });

    describe('long-transcribe duration probing', () => {
        it('keeps ffprobe stdout so real chunk durations determine timestamps', async () => {
            const calls: Array<{ command: string; stdio: string[] }> = [];
            const workDir = await mkdtemp(join(tmpdir(), 'test-long-tx-'));
            let probeCount = 0;
            const fakeSpawn = ((command: string, _args: string[], options: { stdio: string[] }) => {
                calls.push({ command, stdio: options.stdio });
                const child = new EventEmitter() as EventEmitter & {
                  stdout: EventEmitter;
                  stderr: EventEmitter;
                  kill: () => void;
                };
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.kill = () => {};
                setImmediate(async () => {
                    if (command === 'ffmpeg') {
                        await writeFile(join(workDir, 'chunk_0000.wav'), 'a');
                        await writeFile(join(workDir, 'chunk_0001.wav'), 'b');
                    } else {
                        child.stdout.emit('data', Buffer.from(probeCount++ === 0 ? '1.5\n' : '2.5\n'));
                    }
                    child.emit('close', 0);
                });
                return child;
            }) as never;

            try {
                const segments = await transcribeLong('/audio.wav', {
                    spawn: fakeSpawn,
                    workDir,
                    chunkSec: 45,
                    transcriber: async () => 'spoken',
                });
                expect(calls.map((call) => call.stdio)).toEqual([
                    ['ignore', 'pipe', 'pipe'],
                    ['ignore', 'pipe', 'pipe'],
                    ['ignore', 'pipe', 'pipe'],
                ]);
                expect(segments.map((segment) => [segment.t_start, segment.t_end])).toEqual([[0, 1.5], [1.5, 4]]);
            } finally {
                await rm(workDir, { recursive: true, force: true }).catch(() => {});
            }
        });
    });

    describe('understand_video tool wiring', () => {
        it('surfaces cloud answer in its output data if available', async () => {
            const tools = createMultimodalTools();
            const understandTool = tools.find(t => t.name === 'understand_video');

            vi.mocked(understandVideo).mockResolvedValue({
                segments: [],
                transcriptPath: '/tmp/x',
                source: 'y',
                method: 'direct-url',
                output: 'hello',
                cloud: { provider: 'gemini', answer: 'Here is the response' }
            });

            const result = await understandTool!.execute({ source: 'y', cloud: true });
            expect(result.success).toBe(true);
            expect((result as any).data).toHaveProperty('answer', 'Here is the response');
        });
    });
});
